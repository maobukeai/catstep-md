//! Local RAG / semantic search (v2.3).
//!
//! Goal: when the user types a natural-language query, surface notes by
//! **semantic similarity** rather than keyword match. 100% on-device, no
//! network, no model download required out of the box.
//!
//! ## Design notes (read this before changing anything)
//!
//! The big choices, and *why*:
//!
//! 1. **Pluggable embedder, hash trigram default.** Shipping `fastembed-rs`
//!    in the default build pulls in `ort` (ONNX Runtime), `tokenizers`, and
//!    a transitively-vendored libonnxruntime — that's ~80 MB extra binary,
//!    minutes of extra compile time, and brittle cross-compilation (CI
//!    fails on Windows + Linux musl). We instead default to a deterministic
//!    **hashed character-trigram + random projection** embedder which:
//!    - has zero extra deps,
//!    - works fully offline with no model file,
//!    - produces 256-dim L2-normalized vectors (cosine similarity ≈ dot),
//!      scores measurably better than keyword search for short queries
//!      because trigrams pick up morphology + CJK substrings,
//!    - is gated behind the same opt-in setting, so the constraint
//!      "off by default = zero overhead" is preserved.
//!
//!    A heavier `fastembed` backend can be added later behind a cargo
//!    feature without changing the on-disk schema (just bump
//!    `INDEX_VERSION` and the embedder will rebuild on next launch).
//!
//! 2. **Vector index = single SQLite file w/ raw-blob vectors.** No
//!    `sqlite-vec` extension (cross-platform shipping is finicky and the
//!    workspace is small). Brute-force cosine over 500 notes × ~6 chunks
//!    × 256 floats = ~3 MB scan per query, comfortably under <100ms. We
//!    revisit IVF/HNSW only when a user has 5k+ notes.
//!
//! 3. **Async + spawn_blocking.** Every Tauri command wraps the sync
//!    `_inner` in `spawn_blocking` per the v2.2.1 Win11 sync-command rule.
//!
//! 4. **Off by default.** `rag_set_enabled(true)` flips a flag in this
//!    module's state and triggers indexing. Without it, no scan, no DB
//!    file, no overhead.
//!
//! 5. **Incremental.** We hook into the same `notify` watcher pattern used
//!    by `workspace_index`. On a single-file change, we only re-embed
//!    *that* file's chunks. The DB key is `(path, chunk_idx)` and we
//!    `DELETE` then re-insert.
//!
//! Tauri commands exported (registered in `lib.rs`):
//!   * `rag_set_enabled`     — toggle indexing on/off
//!   * `rag_index_status`    — { enabled, ready, total_files, indexed_files }
//!   * `rag_reindex`         — force a full rescan
//!   * `rag_search`          — top-K semantic hits for a natural-language query

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock};
use std::time::SystemTime;

use once_cell::sync::Lazy;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/// Embedding dimension. Bumping this forces a reindex (`INDEX_VERSION`).
const EMBED_DIM: usize = 256;
/// Chunk vectors with at least this many tokens — small fragments are
/// noisy; we glue them onto neighbours via the paragraph splitter.
const MIN_CHUNK_TOKENS: usize = 8;
/// Soft upper bound on a single chunk; long paragraphs get split.
const MAX_CHUNK_CHARS: usize = 1500;
/// Bumped whenever the embedder semantics change. The DB schema is keyed
/// to this, so old rows are wiped on first launch after a bump.
/// v3: chunk full text is stored alongside the vector to power the
/// two-stage hybrid re-ranker (vector cosine prefilter + lexical overlap).
const INDEX_VERSION: u32 = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct RagStatus {
    pub enabled: bool,
    pub ready: bool,
    pub total_files: usize,
    pub indexed_files: usize,
    pub total_chunks: usize,
    pub backend: String,
    pub index_version: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RagHit {
    pub path: String,
    pub name: String,
    pub chunk_idx: u32,
    pub char_start: u32,
    pub char_end: u32,
    /// Cosine similarity in [-1, 1]; the frontend just uses it for sort.
    pub score: f32,
    /// First ~240 chars of the matching chunk, suitable for display.
    pub snippet: String,
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct RagState {
    enabled: bool,
    folder: Option<PathBuf>,
    db_path: Option<PathBuf>,
    /// path -> mtime at indexing time. Lets us skip unchanged files on rescan.
    file_mtimes: HashMap<PathBuf, u64>,
}

static STATE: Lazy<RwLock<RagState>> = Lazy::new(|| {
    RwLock::new(RagState {
        enabled: false,
        folder: None,
        db_path: None,
        file_mtimes: HashMap::new(),
    })
});

/// Serialize concurrent indexers — multiple Tauri command threads can all
/// land on `rag_reindex` at once during testing, and the Mutex keeps the
/// SQLite writes ordered without forcing the whole index into a single
/// task.
static INDEX_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

// ---------------------------------------------------------------------------
// Embedding (hashed-trigram + random projection)
// ---------------------------------------------------------------------------
//
// Why this approximates a real embedding well enough for a v2.3 ship:
//   - Each character trigram h is hashed to a "word" id. Trigrams capture
//     morphology (`-ing`, `-ed`) and CJK substrings — both 1-grams and
//     bag-of-words miss those.
//   - We accumulate signed contributions into a 256-dim vector; sign is
//     determined by another hash of the trigram, which is the random-
//     projection trick used by FeatureHasher / SimHash. Two texts that
//     share many trigrams will end up with positively-correlated vectors;
//     unrelated texts cancel out.
//   - L2-normalize at the end so dot product == cosine similarity.
//
// This is *not* a transformer. It will not understand "the capital of
// France is Paris" semantically. But it will rank "encryption" closer to
// "encrypt" than to "calendar", which is the bar set by the spec ("rank
// notes by semantic similarity, not just keyword match"). When the user
// installs a heavier model later we swap the impl out behind the same
// trait — the on-disk vectors get rebuilt because INDEX_VERSION bumps.

fn embed(text: &str) -> Vec<f32> {
    let mut v = vec![0f32; EMBED_DIM];
    if text.is_empty() {
        return v;
    }
    let normalized: String = text
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .collect::<String>();
    let chars: Vec<char> = normalized.chars().collect();
    // Char bigrams + trigrams — bigrams matter for short CJK queries
    // ("翻译" is 2 chars, no trigram fits) and for short morphological
    // overlap ("en", "yp", etc.).
    add_char_ngrams(&chars, 2, 0.5, &mut v);
    add_char_ngrams(&chars, 3, 1.0, &mut v);
    // Word-level hashing — "encryption" still hashes as a unit even
    // when the trigrams are identical to "encrypt" and "ciphertext".
    for word in normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
    {
        let h = fnv1a64(word.as_bytes());
        let idx = (h as usize) % EMBED_DIM;
        let sign = if (h >> 32) & 1 == 0 { 1.0 } else { -1.0 };
        v[idx] += 2.0 * sign;
        // Word prefix — gives stem-like behaviour ("encrypt" matches
        // "encryption" because both share the 5-char prefix "encry").
        let prefix_len = word.chars().count().min(5);
        if prefix_len >= 3 {
            let prefix: String = word.chars().take(prefix_len).collect();
            let h2 = fnv1a64(prefix.as_bytes());
            let idx2 = (h2 as usize) % EMBED_DIM;
            let sign2 = if (h2 >> 32) & 1 == 0 { 1.0 } else { -1.0 };
            v[idx2] += 1.0 * sign2;
        }
    }
    l2_normalize_in_place(&mut v);
    v
}

/// Hash all char n-grams of length `n` into `v` with the given weight.
fn add_char_ngrams(chars: &[char], n: usize, weight: f32, v: &mut [f32]) {
    if chars.len() < n {
        // Whole-string fallback for very short input.
        let s: String = chars.iter().collect();
        let h = fnv1a64(s.as_bytes());
        let idx = (h as usize) % v.len();
        let sign = if (h >> 32) & 1 == 0 { 1.0 } else { -1.0 };
        v[idx] += weight * sign;
        return;
    }
    let mut buf = [0u8; 16];
    for i in 0..=(chars.len() - n) {
        let mut len = 0;
        for &c in &chars[i..i + n] {
            let s = c.encode_utf8(&mut buf[len..]);
            len += s.len();
        }
        let h = fnv1a64(&buf[..len]);
        let idx = (h as usize) % v.len();
        let sign = if (h >> 32) & 1 == 0 { 1.0 } else { -1.0 };
        v[idx] += weight * sign;
    }
}

fn l2_normalize_in_place(v: &mut [f32]) {
    let mag: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag > 0.0 {
        for x in v.iter_mut() {
            *x /= mag;
        }
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    // Both are pre-normalized → dot product = cosine.
    let n = a.len().min(b.len());
    let mut s = 0f32;
    for i in 0..n {
        s += a[i] * b[i];
    }
    s
}

/// FNV-1a 64-bit. We don't need crypto strength — speed + good distribution.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn vec_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn bytes_to_vec(b: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(b.len() / 4);
    for chunk in b.chunks_exact(4) {
        let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
        out.push(f32::from_le_bytes(arr));
    }
    out
}

// ---------------------------------------------------------------------------
// Embedder backends (pluggable)
// ---------------------------------------------------------------------------

/// Which embedding backend the index uses. Persisted in the index DB's
/// `rag_meta` table — the DB is the single source of truth, so a backend
/// switch always triggers a full reindex and stale vectors can never mix
/// with fresh ones (dimensions differ per backend).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EmbedderConfig {
    /// Built-in hashed n-gram + random-projection sketch. Offline default;
    /// 256-dim; honest keyword-similarity, not transformer semantics.
    Hash,
    /// Transformer embeddings served by a local Ollama instance
    /// (`/api/embed`, batched). Dimension comes from the model
    /// (nomic-embed-text: 768, mxbai-embed-large: 1024, …).
    Ollama {
        model: String,
        #[serde(default)]
        base_url: Option<String>,
    },
}

impl EmbedderConfig {
    /// Stable identity written to `rag_meta.backend`. Bumping this string
    /// (model change included) is what forces the reindex.
    pub fn id(&self) -> String {
        match self {
            EmbedderConfig::Hash => "hash-trigram-256".to_string(),
            EmbedderConfig::Ollama { model, .. } => format!("ollama:{model}"),
        }
    }
}

/// A ready-to-use embedding backend. `embed_batch` preserves input order;
/// every returned vector is L2-normalized so dot == cosine. Implementations
/// run under `spawn_blocking`, so blocking I/O is fine here.
trait Embedder: Send {
    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

struct HashEmbedder;

impl Embedder for HashEmbedder {
    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        Ok(texts.iter().map(|t| embed(t)).collect())
    }
}

struct OllamaEmbedder {
    base: String,
    model: String,
}

/// How many texts per `/api/embed` call. Bounds both request size and the
/// blast radius of a transient failure.
const OLLAMA_EMBED_BATCH: usize = 16;

impl OllamaEmbedder {
    fn client(&self) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|e| format!("http client: {e}"))
    }

    /// One `/api/embed` call. Older Ollama (pre-0.3) only has the
    /// single-input `/api/embeddings`; we fall back to it per text when the
    /// batch endpoint 404s, so the backend works across install ages.
    async fn embed_one_call(&self, client: &reqwest::Client, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let url = format!("{}/api/embed", self.base);
        let resp = client
            .post(&url)
            .json(&serde_json::json!({ "model": self.model, "input": texts }))
            .send()
            .await
            .map_err(|e| {
                format!(
                    "ollama embed failed at {url} — is Ollama running and is the model pulled? ({e})"
                )
            })?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            // Legacy endpoint, one call per text.
            return self.embed_one_by_one_legacy(client, texts).await;
        }
        if !status.is_success() {
            return Err(format!("ollama embed {status}: {body}"));
        }
        let v: Value = serde_json::from_str(&body)
            .map_err(|e| format!("ollama embed response not JSON: {e}"))?;
        parse_ollama_embeddings(&v)
    }

    async fn embed_one_by_one_legacy(&self, client: &reqwest::Client, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let url = format!("{}/api/embeddings", self.base);
        let mut out = Vec::with_capacity(texts.len());
        for t in texts {
            let resp = client
                .post(&url)
                .json(&serde_json::json!({ "model": self.model, "prompt": t }))
                .send()
                .await
                .map_err(|e| format!("ollama embed failed at {url}: {e}"))?;
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(format!("ollama embeddings {status}: {body}"));
            }
            let v: Value = serde_json::from_str(&body)
                .map_err(|e| format!("ollama embeddings response not JSON: {e}"))?;
            out.push(parse_single_embedding(&v)?);
        }
        Ok(out)
    }
}

impl Embedder for OllamaEmbedder {
    fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        if texts.is_empty() {
            return Ok(vec![]);
        }
        // The trait is sync because indexing/search run under
        // `spawn_blocking` (which is not an async context) — bridge to the
        // async reqwest calls with the ambient runtime handle.
        let handle = tokio::runtime::Handle::try_current()
            .map_err(|_| "ollama embedder requires a tokio runtime".to_string())?;
        handle.block_on(async {
            let client = self.client()?;
            let mut out = Vec::with_capacity(texts.len());
            for chunk in texts.chunks(OLLAMA_EMBED_BATCH) {
                out.extend(self.embed_one_call(&client, chunk).await?);
            }
            Ok(out)
        })
    }
}

/// Extract `embeddings: [[…], …]` from a `/api/embed` response, validating
/// shape and normalizing each vector.
fn parse_ollama_embeddings(v: &Value) -> Result<Vec<Vec<f32>>, String> {
    let arr = v
        .get("embeddings")
        .and_then(|e| e.as_array())
        .ok_or_else(|| "ollama embed response missing `embeddings` array".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for e in arr {
        let mut vec: Vec<f32> = e
            .as_array()
            .ok_or_else(|| "ollama embed row is not an array".to_string())?
            .iter()
            .map(|x| x.as_f64().unwrap_or(0.0) as f32)
            .collect();
        if vec.is_empty() {
            return Err("ollama returned an empty embedding".to_string());
        }
        // Enforce the Embedder contract (dot == cosine) regardless of what
        // the model emits.
        l2_normalize_in_place(&mut vec);
        out.push(vec);
    }
    Ok(out)
}

/// Extract a single `embedding: […]` from a legacy `/api/embeddings` response.
fn parse_single_embedding(v: &Value) -> Result<Vec<f32>, String> {
    let mut vec: Vec<f32> = v
        .get("embedding")
        .and_then(|e| e.as_array())
        .ok_or_else(|| "ollama embeddings response missing `embedding`".to_string())?
        .iter()
        .map(|x| x.as_f64().unwrap_or(0.0) as f32)
        .collect();
    if vec.is_empty() {
        return Err("ollama returned an empty embedding".to_string());
    }
    l2_normalize_in_place(&mut vec);
    Ok(vec)
}

fn build_embedder(cfg: &EmbedderConfig) -> Box<dyn Embedder> {
    match cfg {
        EmbedderConfig::Hash => Box::new(HashEmbedder),
        EmbedderConfig::Ollama { model, base_url } => Box::new(OllamaEmbedder {
            base: super::ollama::base_url(base_url.as_deref()),
            model: model.clone(),
        }),
    }
}

// ---------------------------------------------------------------------------
// Two-stage ranking (vector prefilter + lexical re-rank)
// ---------------------------------------------------------------------------

/// How many cosine-prefiltered candidates get the (point-queried, exact)
/// lexical re-rank. Bounds the pass-2 point queries; the final answer is
/// `limit` hits, so 40 leaves plenty of headroom.
const REORDER_CANDIDATES: usize = 40;

/// Weight of the vector cosine vs the lexical overlap in the final score.
/// The lexical term exists to rescue exact-name/exact-term matches that a
/// transformer cosine can bury a few ranks deep. At 0.8 a perfect overlap
/// (max bonus 0.2) can never outrank a 0.3-point cosine gap — the vector
/// signal stays dominant.
const HYBRID_COSINE_WEIGHT: f32 = 0.8;

/// Tokenize a query for the lexical term: lowercase alphanumeric words plus
/// adjacent CJK character pairs (a two-char CJK query yields no word tokens
/// but one bigram — the common Chinese search shape).
fn query_tokens(q: &str) -> Vec<String> {
    let lower: String = q.chars().map(|c| c.to_ascii_lowercase()).collect();
    let mut out: Vec<String> = Vec::new();
    let is_cjk = |c: char| {
        // Hiragana/katakana live inside the CJK ideograph range bound, so
        // no separate arm for them here.
        matches!(c as u32, 0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xAC00..=0xD7AF)
    };
    let chars: Vec<char> = lower.chars().collect();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut Vec<String>| {
        if !word.is_empty() {
            out.push(std::mem::take(word));
        }
    };
    for i in 0..chars.len() {
        let c = chars[i];
        // CJK is covered by the bigrams below (and `char::is_alphanumeric`
        // is true for CJK, which would double-count it as a whole-run
        // "word"), so only ASCII alphanumerics form words.
        if c.is_ascii_alphanumeric() {
            word.push(c);
        } else {
            flush(&mut word, &mut out);
        }
        if is_cjk(c) && i + 1 < chars.len() && is_cjk(chars[i + 1]) {
            out.push(format!("{}{}", c, chars[i + 1]));
        }
    }
    flush(&mut word, &mut out);
    out
}

/// Fraction of query tokens (words + CJK bigrams) present in `text`, [0, 1].
fn lexical_overlap(q: &str, text: &str) -> f32 {
    let tokens = query_tokens(q);
    if tokens.is_empty() {
        return 0.0;
    }
    let lower: String = text.chars().map(|c| c.to_ascii_lowercase()).collect();
    let hits = tokens.iter().filter(|t| lower.contains(t.as_str())).count();
    hits as f32 / tokens.len() as f32
}

/// Final ranking score: cosine still dominates, exact-term overlap breaks
/// near-ties in favor of literally-matching notes.
fn combined_score(cos: f32, overlap: f32) -> f32 {
    HYBRID_COSINE_WEIGHT * cos + (1.0 - HYBRID_COSINE_WEIGHT) * overlap
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Chunk {
    /// 0-based char offset inside the *full file content*.
    char_start: u32,
    /// Exclusive end (char offset).
    char_end: u32,
    text: String,
}

/// Split `body` into (mostly) paragraph-sized chunks. We also peel off
/// front matter (first `---\n…\n---\n` block) so YAML doesn't pollute
/// embeddings. Long paragraphs get sub-split at sentence boundaries.
fn chunk_text(content: &str) -> Vec<Chunk> {
    let body = strip_front_matter(content);
    let offset_to_body = content.chars().count() - body.chars().count();

    let mut chunks: Vec<Chunk> = Vec::new();
    let mut buf = String::new();
    let mut buf_start: usize = 0;
    let mut cur_offset: usize = 0;

    let lines: Vec<&str> = body.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let line_chars = line.chars().count();
        if line.trim().is_empty() {
            if !buf.trim().is_empty() {
                push_chunk(&mut chunks, &buf, buf_start + offset_to_body);
                buf.clear();
            }
            // +1 for the newline we're about to skip
            cur_offset += line_chars + 1;
            buf_start = cur_offset;
            continue;
        }
        if buf.is_empty() {
            buf_start = cur_offset;
        } else {
            buf.push('\n');
        }
        buf.push_str(line);
        cur_offset += line_chars;
        if i < lines.len() - 1 {
            cur_offset += 1; // newline
        }
        if buf.chars().count() >= MAX_CHUNK_CHARS {
            push_chunk(&mut chunks, &buf, buf_start + offset_to_body);
            buf.clear();
            buf_start = cur_offset;
        }
    }
    if !buf.trim().is_empty() {
        push_chunk(&mut chunks, &buf, buf_start + offset_to_body);
    }
    chunks
}

fn push_chunk(out: &mut Vec<Chunk>, text: &str, char_start: usize) {
    let trimmed = text.trim_end_matches('\n').to_string();
    let n = trimmed.chars().count();
    if n == 0 {
        return;
    }
    let token_count = trimmed.split_whitespace().count();
    if token_count < MIN_CHUNK_TOKENS && n < 20 {
        // Glue micro-fragments onto the previous chunk if there is one;
        // otherwise keep them as a standalone chunk so single-line notes
        // are still indexed at all.
        if let Some(prev) = out.last_mut() {
            // Append with a separator so the embedder treats it as the
            // same paragraph rather than a single super-long token.
            prev.text.push('\n');
            prev.text.push_str(&trimmed);
            prev.char_end = (char_start + n) as u32;
            return;
        }
    }
    out.push(Chunk {
        char_start: char_start as u32,
        char_end: (char_start + n) as u32,
        text: trimmed,
    });
}

fn strip_front_matter(raw: &str) -> &str {
    let trimmed = raw.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return raw;
    }
    let after_first = match trimmed.find('\n') {
        Some(i) => &trimmed[i + 1..],
        None => return raw,
    };
    if let Some(end) = after_first.find("\n---") {
        let rest_offset_in_after = end + "\n---".len();
        let rest = &after_first[rest_offset_in_after..];
        return rest.strip_prefix('\n').unwrap_or(rest);
    }
    raw
}

// ---------------------------------------------------------------------------
// SQLite schema + helpers
// ---------------------------------------------------------------------------

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS rag_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rag_chunks (
    path TEXT NOT NULL,
    chunk_idx INTEGER NOT NULL,
    char_start INTEGER NOT NULL,
    char_end INTEGER NOT NULL,
    snippet TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    PRIMARY KEY (path, chunk_idx)
);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_path ON rag_chunks(path);
CREATE TABLE IF NOT EXISTS rag_files (
    path TEXT PRIMARY KEY,
    mtime INTEGER NOT NULL,
    size INTEGER NOT NULL
);
"#;

fn open_db(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create dir {}: {e}", parent.display()))?;
    }
    let conn = Connection::open(path)
        .map_err(|e| format!("open db at {}: {e}", path.display()))?;
    conn.execute_batch(SCHEMA).map_err(|e| format!("schema: {e}"))?;

    // Wipe + start fresh if INDEX_VERSION moved.
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM rag_meta WHERE key='index_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    let want = INDEX_VERSION.to_string();
    if stored.as_deref() != Some(want.as_str()) {
        conn.execute_batch(
            "DELETE FROM rag_chunks; DELETE FROM rag_files;",
        )
        .map_err(|e| format!("reset on version bump: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO rag_meta(key, value) VALUES('index_version', ?1)",
            params![want],
        )
        .map_err(|e| format!("write version: {e}"))?;
    }
    Ok(conn)
}

fn db_path_for(folder: &Path) -> PathBuf {
    folder.join(".solomd").join("embeddings.sqlite")
}

/// Read the persisted embedder config. Missing rows (pre-pluggable indexes)
/// mean the original hash backend. Malformed rows fall back to Hash rather
/// than bricking the index — the user can re-select the backend, which
/// rewrites the row and rebuilds.
fn read_embedder_config(conn: &Connection) -> EmbedderConfig {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM rag_meta WHERE key='backend_config'",
            [],
            |r| r.get(0),
        )
        .ok();
    raw.and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(EmbedderConfig::Hash)
}

fn write_embedder_config(conn: &Connection, cfg: &EmbedderConfig) -> Result<(), String> {
    let json = serde_json::to_string(cfg).map_err(|e| format!("serialize config: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO rag_meta(key, value) VALUES('backend_config', ?1)",
        params![json],
    )
    .map_err(|e| format!("write backend_config: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO rag_meta(key, value) VALUES('backend', ?1)",
        params![cfg.id()],
    )
    .map_err(|e| format!("write backend id: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

fn list_markdown(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        // Skip our own DB and any `.solomd/` machinery.
        if p.components().any(|c| c.as_os_str() == ".solomd") {
            continue;
        }
        let lower = p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if matches!(lower.as_str(), "md" | "markdown" | "mdown" | "txt") {
            out.push(p.to_path_buf());
        }
    }
    out
}

fn mtime_of(p: &Path) -> u64 {
    fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn size_of(p: &Path) -> u64 {
    fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

fn index_one_file(conn: &Connection, embedder: &dyn Embedder, path: &Path) -> Result<usize, String> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        // Binary or unreadable file — drop existing rows, skip.
        Err(_) => {
            let p = path.to_string_lossy().to_string();
            let _ = conn.execute("DELETE FROM rag_chunks WHERE path = ?1", params![&p]);
            let _ = conn.execute("DELETE FROM rag_files WHERE path = ?1", params![&p]);
            return Ok(0);
        }
    };
    let chunks = chunk_text(&raw);
    let p = path.to_string_lossy().to_string();
    conn.execute("DELETE FROM rag_chunks WHERE path = ?1", params![&p])
        .map_err(|e| format!("delete chunks: {e}"))?;

    // One batched embed call per file — the Ollama backend turns this into
    // a single HTTP round-trip instead of one per chunk.
    let vectors = embedder.embed_batch(
        &chunks.iter().map(|c| c.text.clone()).collect::<Vec<_>>(),
    )?;

    let mut stmt = conn
        .prepare(
            "INSERT INTO rag_chunks(path, chunk_idx, char_start, char_end, snippet, text, embedding)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(|e| format!("prepare insert: {e}"))?;
    for (i, (ch, v)) in chunks.iter().zip(vectors).enumerate() {
        let bytes = vec_to_bytes(&v);
        let snippet: String = ch.text.chars().take(240).collect();
        stmt.execute(params![
            &p,
            i as i64,
            ch.char_start as i64,
            ch.char_end as i64,
            &snippet,
            &ch.text,
            &bytes
        ])
        .map_err(|e| format!("insert chunk: {e}"))?;
    }
    drop(stmt);
    conn.execute(
        "INSERT OR REPLACE INTO rag_files(path, mtime, size) VALUES(?1, ?2, ?3)",
        params![&p, mtime_of(path) as i64, size_of(path) as i64],
    )
    .map_err(|e| format!("upsert file: {e}"))?;
    Ok(chunks.len())
}

/// Full or incremental scan of `folder`. If `full` is true we wipe the
/// entire `rag_files` / `rag_chunks` tables first.
fn run_indexer(folder: &Path, full: bool) -> Result<(), String> {
    let _g = INDEX_LOCK
        .lock()
        .map_err(|e| format!("index lock poisoned: {e}"))?;
    let db_path = db_path_for(folder);
    let conn = open_db(&db_path)?;
    let embedder = build_embedder(&read_embedder_config(&conn));
    if full {
        conn.execute("DELETE FROM rag_chunks", [])
            .map_err(|e| format!("wipe chunks: {e}"))?;
        conn.execute("DELETE FROM rag_files", [])
            .map_err(|e| format!("wipe files: {e}"))?;
    }
    let mut known: HashMap<String, (u64, u64)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT path, mtime, size FROM rag_files")
            .map_err(|e| format!("prepare files: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, i64>(2)? as u64,
                ))
            })
            .map_err(|e| format!("query files: {e}"))?;
        for r in rows.flatten() {
            known.insert(r.0, (r.1, r.2));
        }
    }

    let live = list_markdown(folder);
    let live_set: HashSet<String> = live.iter().map(|p| p.to_string_lossy().to_string()).collect();

    // Drop stale rows for files that no longer exist.
    for path in known.keys() {
        if !live_set.contains(path) {
            let _ = conn.execute("DELETE FROM rag_chunks WHERE path = ?1", params![path]);
            let _ = conn.execute("DELETE FROM rag_files WHERE path = ?1", params![path]);
        }
    }

    let mut mtimes: HashMap<PathBuf, u64> = HashMap::new();
    for path in &live {
        let key = path.to_string_lossy().to_string();
        let m = mtime_of(path);
        let s = size_of(path);
        mtimes.insert(path.clone(), m);
        if let Some(prev) = known.get(&key) {
            if prev.0 == m && prev.1 == s {
                continue; // unchanged
            }
        }
        index_one_file(&conn, embedder.as_ref(), path)?;
    }

    if let Ok(mut state) = STATE.write() {
        state.file_mtimes = mtimes;
        state.db_path = Some(db_path);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Public sync impls (testable; Tauri commands wrap these in spawn_blocking)
// ---------------------------------------------------------------------------

pub fn rag_set_enabled_inner(folder: String, enabled: bool) -> Result<RagStatus, String> {
    {
        let mut s = STATE.write().map_err(|e| format!("state lock: {e}"))?;
        s.enabled = enabled;
        if !folder.is_empty() {
            s.folder = Some(PathBuf::from(&folder));
        }
    }
    if enabled && !folder.is_empty() {
        let f = PathBuf::from(&folder);
        // Ensure .solomd ignored on git side too — append (idempotent).
        ensure_gitignore(&f);
        run_indexer(&f, false)?;
    }
    rag_index_status_inner(folder)
}

pub fn rag_index_status_inner(folder: String) -> Result<RagStatus, String> {
    let enabled = STATE.read().map(|s| s.enabled).unwrap_or(false);
    // The persisted config decides the reported backend — an index built
    // with Ollama still reports so even before this process touched it.
    let backend = if folder.is_empty() {
        EmbedderConfig::Hash.id()
    } else {
        let db_p = db_path_for(&PathBuf::from(&folder));
        if db_p.exists() {
            open_db(&db_p)
                .map(|conn| read_embedder_config(&conn).id())
                .unwrap_or_else(|_| EmbedderConfig::Hash.id())
        } else {
            EmbedderConfig::Hash.id()
        }
    };

    if folder.is_empty() {
        return Ok(RagStatus {
            enabled,
            ready: false,
            total_files: 0,
            indexed_files: 0,
            total_chunks: 0,
            backend,
            index_version: INDEX_VERSION,
        });
    }
    let folder_p = PathBuf::from(&folder);
    let total_files = if folder_p.is_dir() {
        list_markdown(&folder_p).len()
    } else {
        0
    };
    let db_p = db_path_for(&folder_p);
    if !db_p.exists() {
        return Ok(RagStatus {
            enabled,
            ready: false,
            total_files,
            indexed_files: 0,
            total_chunks: 0,
            backend,
            index_version: INDEX_VERSION,
        });
    }
    let conn = open_db(&db_p)?;
    let indexed_files: i64 = conn
        .query_row("SELECT COUNT(*) FROM rag_files", [], |r| r.get(0))
        .unwrap_or(0);
    let total_chunks: i64 = conn
        .query_row("SELECT COUNT(*) FROM rag_chunks", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(RagStatus {
        enabled,
        ready: indexed_files > 0,
        total_files,
        indexed_files: indexed_files as usize,
        total_chunks: total_chunks as usize,
        backend,
        index_version: INDEX_VERSION,
    })
}

/// Switch the embedding backend and rebuild the index from scratch. The
/// Ollama variant is probed up front (one real embed call) so a missing
/// server or unpulled model fails here with an actionable message instead
/// of poisoning the index with a half-finished reindex.
pub fn rag_set_embedder_inner(folder: String, config: EmbedderConfig) -> Result<RagStatus, String> {
    if folder.is_empty() {
        return Err("workspace folder not set".into());
    }
    if let EmbedderConfig::Ollama { model, .. } = &config {
        if model.trim().is_empty() {
            return Err("ollama embedder requires a model name".into());
        }
    }
    let f = PathBuf::from(&folder);
    if !f.is_dir() {
        return Err(format!("not a directory: {folder}"));
    }
    // Probe before touching anything on disk.
    let embedder = build_embedder(&config);
    embedder
        .embed_batch(&["catstep embedder probe".to_string()])
        .map_err(|e| format!("embedder probe failed — index left unchanged: {e}"))?;

    let db_path = db_path_for(&f);
    {
        let conn = open_db(&db_path)?;
        // Backend change invalidates every stored vector (dimensions and
        // semantics differ) — wipe and record the new config before the
        // reindex below repopulates.
        conn.execute("DELETE FROM rag_chunks", [])
            .map_err(|e| format!("wipe chunks: {e}"))?;
        conn.execute("DELETE FROM rag_files", [])
            .map_err(|e| format!("wipe files: {e}"))?;
        write_embedder_config(&conn, &config)?;
    }
    let enabled = STATE.read().map(|s| s.enabled).unwrap_or(false);
    if enabled {
        run_indexer(&f, false)?;
    }
    rag_index_status_inner(folder)
}

pub fn rag_reindex_inner(folder: String) -> Result<RagStatus, String> {
    if folder.is_empty() {
        return Err("workspace folder not set".into());
    }
    let f = PathBuf::from(&folder);
    if !f.is_dir() {
        return Err(format!("not a directory: {folder}"));
    }
    ensure_gitignore(&f);
    run_indexer(&f, true)?;
    rag_index_status_inner(folder)
}

pub fn rag_search_inner(
    folder: String,
    query: String,
    limit: u32,
) -> Result<Vec<RagHit>, String> {
    if folder.is_empty() {
        return Err("workspace folder not set".into());
    }
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let cap = if limit == 0 { 20 } else { limit as usize };
    let folder_p = PathBuf::from(&folder);
    let db_p = db_path_for(&folder_p);
    if !db_p.exists() {
        return Err("index not built yet — call rag_reindex first".into());
    }
    let conn = open_db(&db_p)?;
    let embedder = build_embedder(&read_embedder_config(&conn));
    let qv = embedder
        .embed_batch(&[q.to_string()])?
        .into_iter()
        .next()
        .ok_or_else(|| "embedding backend returned no vector".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT path, chunk_idx, char_start, char_end, snippet, embedding FROM rag_chunks",
        )
        .map_err(|e| format!("prepare scan: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Vec<u8>>(5)?,
            ))
        })
        .map_err(|e| format!("scan: {e}"))?;

    // Stage 1 (vector prefilter): per-file best chunk by cosine — one hit
    // per note, full-index scan, no text loaded (memory-bounded).
    let mut best: HashMap<String, RagHit> = HashMap::new();
    for row in rows.flatten() {
        let (path, idx, cs, ce, snippet, blob) = row;
        let v = bytes_to_vec(&blob);
        let s = cosine(&qv, &v);
        let name = Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let hit = RagHit {
            path: path.clone(),
            name,
            chunk_idx: idx as u32,
            char_start: cs as u32,
            char_end: ce as u32,
            score: s,
            snippet,
        };
        match best.get(&path) {
            Some(prev) if prev.score >= s => {}
            _ => {
                best.insert(path, hit);
            }
        }
    }
    let mut hits: Vec<RagHit> = best.into_values().collect();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(REORDER_CANDIDATES);

    // Stage 2 (lexical re-rank): point-query the full chunk text for just
    // the candidates and blend an exact-term overlap into the ranking.
    // `score` stays the cosine (the UI labels it as such); only the ORDER
    // is hybrid.
    let mut ranked: Vec<(f32, RagHit)> = Vec::with_capacity(hits.len());
    {
        let mut stmt = conn
            .prepare("SELECT text FROM rag_chunks WHERE path = ?1 AND chunk_idx = ?2")
            .map_err(|e| format!("prepare text lookup: {e}"))?;
        for hit in hits {
            let text: Option<String> = stmt
                .query_row(params![&hit.path, hit.chunk_idx as i64], |r| r.get(0))
                .ok();
            let overlap = text
                .as_deref()
                .map(|t| lexical_overlap(q, t))
                .unwrap_or(0.0);
            ranked.push((combined_score(hit.score, overlap), hit));
        }
    }
    ranked.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    Ok(ranked.into_iter().map(|(_, h)| h).take(cap).collect())
}

/// Re-embed a single file (used by the watcher hook in `lib.rs`).
pub fn rag_reindex_file_inner(folder: String, file_path: String) -> Result<(), String> {
    if folder.is_empty() || file_path.is_empty() {
        return Ok(());
    }
    let enabled = STATE.read().map(|s| s.enabled).unwrap_or(false);
    if !enabled {
        return Ok(());
    }
    let _g = INDEX_LOCK
        .lock()
        .map_err(|e| format!("index lock: {e}"))?;
    let db_p = db_path_for(Path::new(&folder));
    let conn = open_db(&db_p)?;
    let p = Path::new(&file_path);
    if !p.exists() {
        let s = file_path.clone();
        let _ = conn.execute("DELETE FROM rag_chunks WHERE path = ?1", params![s]);
        let _ = conn.execute("DELETE FROM rag_files WHERE path = ?1", params![file_path]);
        return Ok(());
    }
    let embedder = build_embedder(&read_embedder_config(&conn));
    index_one_file(&conn, embedder.as_ref(), p).map(|_| ())
}

// ---------------------------------------------------------------------------
// .gitignore guard — keep .solomd/ out of AutoGit history
// ---------------------------------------------------------------------------

fn ensure_gitignore(folder: &Path) {
    let gi = folder.join(".gitignore");
    let line = ".solomd/";
    let existing = fs::read_to_string(&gi).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == line) {
        return;
    }
    let mut new_body = existing;
    if !new_body.is_empty() && !new_body.ends_with('\n') {
        new_body.push('\n');
    }
    new_body.push_str(line);
    new_body.push('\n');
    let _ = fs::write(&gi, new_body);
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn rag_set_enabled(folder: String, enabled: bool) -> Result<RagStatus, String> {
    // Caller-supplied workspace path — prove it is inside an authorized
    // root. Empty means "no workspace yet" and is allowed through.
    if !folder.trim().is_empty() {
        super::commands::authorize(&folder)?;
    }
    tauri::async_runtime::spawn_blocking(move || rag_set_enabled_inner(folder, enabled))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn rag_index_status(folder: String) -> Result<RagStatus, String> {
    // Caller-supplied workspace path — prove it is inside an authorized
    // root. Empty means "no workspace yet" and is allowed through.
    if !folder.trim().is_empty() {
        super::commands::authorize(&folder)?;
    }
    tauri::async_runtime::spawn_blocking(move || rag_index_status_inner(folder))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn rag_reindex(folder: String) -> Result<RagStatus, String> {
    // Caller-supplied workspace path — prove it is inside an authorized
    // root. Empty is left to the inner, which reports it as an error.
    if !folder.trim().is_empty() {
        super::commands::authorize(&folder)?;
    }
    tauri::async_runtime::spawn_blocking(move || rag_reindex_inner(folder))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn rag_set_embedder(folder: String, config: EmbedderConfig) -> Result<RagStatus, String> {
    // Caller-supplied workspace path — prove it is inside an authorized
    // root. Empty is left to the inner, which reports it as an error.
    if !folder.trim().is_empty() {
        super::commands::authorize(&folder)?;
    }
    tauri::async_runtime::spawn_blocking(move || rag_set_embedder_inner(folder, config))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[derive(Debug, Deserialize)]
pub struct SearchArgs {
    pub folder: String,
    pub query: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[tauri::command]
pub async fn rag_search(args: SearchArgs) -> Result<Vec<RagHit>, String> {
    let lim = args.limit.unwrap_or(20);
    let folder = args.folder;
    let query = args.query;
    tauri::async_runtime::spawn_blocking(move || rag_search_inner(folder, query, lim))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[tauri::command]
pub async fn rag_reindex_file(folder: String, file_path: String) -> Result<(), String> {
    // Both paths are caller-supplied — prove each is inside an authorized
    // root. Empty inputs are a no-op in the inner, so skip them here.
    if !folder.trim().is_empty() {
        super::commands::authorize(&folder)?;
    }
    if !file_path.trim().is_empty() {
        super::commands::authorize(&file_path)?;
    }
    tauri::async_runtime::spawn_blocking(move || rag_reindex_file_inner(folder, file_path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_self_is_one() {
        let v = embed("hello world");
        let c = cosine(&v, &v);
        assert!((c - 1.0).abs() < 1e-4, "cosine of vec with self = {c}");
    }

    #[test]
    fn similar_text_scores_higher_than_unrelated() {
        let q = embed("encryption");
        let related = embed("we use AES encryption to secure files at rest");
        let unrelated = embed("today's weather is sunny in Paris");
        let s_rel = cosine(&q, &related);
        let s_unrel = cosine(&q, &unrelated);
        assert!(
            s_rel > s_unrel,
            "expected related>unrelated, got rel={s_rel} unrel={s_unrel}"
        );
    }

    #[test]
    fn chunk_strips_front_matter() {
        let raw = "---\ntitle: x\n---\nfirst para\n\nsecond para\n";
        let chunks = chunk_text(raw);
        assert!(chunks.iter().all(|c| !c.text.contains("title:")));
        assert!(chunks.iter().any(|c| c.text.contains("first para")));
        assert!(chunks.iter().any(|c| c.text.contains("second para")));
    }

    // --- pluggable embedders -------------------------------------------------

    #[test]
    fn parse_ollama_embeddings_normalizes_rows() {
        let v: Value = serde_json::json!({ "embeddings": [[3.0, 4.0], [1.0, 0.0]] });
        let out = parse_ollama_embeddings(&v).expect("valid");
        assert_eq!(out.len(), 2);
        let mag: f32 = out[0].iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((mag - 1.0).abs() < 1e-4, "row must be L2-normalized, mag={mag}");

        assert!(parse_ollama_embeddings(&serde_json::json!({})).is_err());
        assert!(parse_ollama_embeddings(&serde_json::json!({ "embeddings": [[]] })).is_err());
    }

    #[test]
    fn parse_single_embedding_shape() {
        let out =
            parse_single_embedding(&serde_json::json!({ "embedding": [3.0, 4.0] })).expect("valid");
        assert!((out[0] - 0.6).abs() < 1e-4 && (out[1] - 0.8).abs() < 1e-4, "normalized: {out:?}");
        assert!(parse_single_embedding(&serde_json::json!({ "nope": [] })).is_err());
    }

    #[test]
    fn embedder_config_ids_and_serde_roundtrip() {
        assert_eq!(EmbedderConfig::Hash.id(), "hash-trigram-256");
        let cfg = EmbedderConfig::Ollama {
            model: "nomic-embed-text".into(),
            base_url: None,
        };
        assert_eq!(cfg.id(), "ollama:nomic-embed-text");
        // A model change must change the id — that is what forces the rebuild.
        let cfg2 = EmbedderConfig::Ollama {
            model: "mxbai-embed-large".into(),
            base_url: None,
        };
        assert_ne!(cfg.id(), cfg2.id());

        let json = serde_json::to_string(&cfg).unwrap();
        let back: EmbedderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn query_tokens_cover_words_and_cjk_pairs() {
        // Latin words split on non-alphanumerics, lowercased.
        assert_eq!(query_tokens("RAG Search!"), vec!["rag", "search"]);
        // A 2-char CJK query yields one bigram and no empty-word noise.
        assert_eq!(query_tokens("翻译"), vec!["翻译"]);
        // A 3-char CJK query yields two overlapping bigrams.
        assert_eq!(query_tokens("语义搜索"), vec!["语义", "义搜", "搜索"]);
        // Mixed text produces both shapes.
        assert_eq!(query_tokens("use RAG 翻译"), vec!["use", "rag", "翻译"]);
        assert!(query_tokens("!!!").is_empty());
    }

    #[test]
    fn lexical_overlap_is_fraction_of_present_tokens() {
        let text = "We use AES encryption to secure files. 翻译支持内置。";
        assert_eq!(lexical_overlap("encryption aes", text), 1.0);
        assert!((lexical_overlap("encryption calendar", text) - 0.5).abs() < 1e-6);
        assert_eq!(lexical_overlap("翻译", text), 1.0);
        assert_eq!(lexical_overlap("absent", text), 0.0);
        assert_eq!(lexical_overlap("!!!", text), 0.0, "empty token list scores 0");
    }

    #[test]
    fn combined_score_blends_in_lexical_tiebreak() {
        // Identical cosines: the lexically-matching note ranks higher.
        let a = combined_score(0.60, 0.0);
        let b = combined_score(0.60, 1.0);
        assert!(b > a);
        // Cosine still dominates: a big cosine gap beats a perfect overlap.
        assert!(combined_score(0.90, 0.0) > combined_score(0.60, 1.0));
        // Weighted blend is a convex combination.
        let c = combined_score(0.8, 0.4);
        assert!((c - (0.8 * 0.8 + 0.2 * 0.4)).abs() < 1e-6);
    }

    #[test]
    fn embedder_config_persists_through_meta_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        // Missing rows mean the original hash backend (pre-pluggable indexes).
        assert_eq!(read_embedder_config(&conn), EmbedderConfig::Hash);

        let cfg = EmbedderConfig::Ollama {
            model: "nomic-embed-text".into(),
            base_url: Some("http://192.168.1.20:11434".into()),
        };
        write_embedder_config(&conn, &cfg).unwrap();
        assert_eq!(read_embedder_config(&conn), cfg);
    }
}
