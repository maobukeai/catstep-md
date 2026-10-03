//! Global recursive search & replace across a directory tree.
//!
//! Walks `root` (following the caller-controlled path) and returns every line
//! in every text-ish file that matches `query`, capped at `max_results`.
//! Hidden directories and a small deny-list of heavy build/VCS directories
//! are skipped. The Aa / whole-word / regex toggles from GlobalSearch.vue map
//! onto [`MatchOptions`]; a bare query with all toggles off keeps the
//! original case-insensitive substring behavior.
//!
//! `search_replace` is the destructive sibling: it re-walks the same
//! candidate set, rewrites every file that contains a match through the
//! shared detection + atomic-write pipeline (`read_text_detected` →
//! `atomic_write_encoded`, so legacy-encoded notes keep their encoding and
//! BOM), and reports a files-changed / replacements summary.
//!
//! This module is intentionally self-contained: register the commands from
//! BOTH compile roots (`lib.rs` and `runner.rs` — see the
//! command_registration_test drift guard) with `mod search;` and add
//! `search::search_in_dir` / `search::search_replace` to the
//! `invoke_handler!` lists.

use globset::GlobBuilder;
use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchHit {
    pub file: String,
    pub line: usize,
    pub snippet: String,
}

/// Advanced match toggles — 1:1 with the GlobalSearch.vue switches. All off
/// (the default) reproduces the original lowercase-substring search.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// Search result plus walk telemetry. `files_scanned` counts candidate files
/// the walker visited (read attempts included), `elapsed_ms` times the whole
/// blocking pass — surfaced in the GlobalSearch footer so a slow full-vault
/// walk never looks like a hang.
///
/// `truncated` is set when the walk stopped early because `max_results` hits
/// were already in hand: the returned list is then a *prefix* of the real
/// match set (and `files_scanned` only counts files inspected up to that
/// point — the early stop is the whole point of the cap). The GlobalSearch
/// panel surfaces this so a big vault never mistakes the capped list for the
/// full result set, and so the replace confirmation can say out loud that
/// matches beyond the displayed list are rewritten too.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub files_scanned: usize,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

/// Summary of a cross-file replace pass. `errors` carries per-file reasons
/// (unreadable, undecodable bytes, write failure) so one bad note can't
/// silently swallow the rest of the batch.
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceSummary {
    pub files_changed: usize,
    pub replacements: usize,
    pub errors: Vec<String>,
    pub elapsed_ms: u64,
}

/// File extensions we are willing to open and scan. Anything else is skipped
/// without even opening the file, so binary assets won't slow the walker.
const ALLOWED_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

/// Directory names that should never be descended into. We match by name
/// (not full path), which is enough for the usual suspects.
const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist"];

#[tauri::command]
pub async fn search_in_dir(
    root: String,
    query: String,
    max_results: usize,
    options: Option<MatchOptions>,
    path_filter: Option<String>,
) -> Result<SearchOutcome, String> {
    // Recursive search reads file contents — an unguarded `root` would be a
    // "read any text file on disk" primitive for injected markup.
    super::commands::path_guard::ensure_authorized(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        search_in_dir_scoped(
            root,
            query,
            max_results,
            &options.unwrap_or_default(),
            path_filter.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// Legacy 3-arg entry point kept for the agent-tools literal search
/// (`agent_tools.rs`) and `tests/search_test.rs`: default options, no path
/// filter, hits only.
pub fn search_in_dir_inner(
    root: String,
    query: String,
    max_results: usize,
) -> Result<Vec<SearchHit>, String> {
    Ok(search_in_dir_scoped(
        root,
        query,
        max_results,
        &MatchOptions::default(),
        None,
    )?
    .hits)
}

pub fn search_in_dir_scoped(
    root: String,
    query: String,
    max_results: usize,
    options: &MatchOptions,
    path_filter: Option<&str>,
) -> Result<SearchOutcome, String> {
    let started = Instant::now();
    if query.is_empty() {
        return Ok(SearchOutcome::default());
    }
    let matcher = build_matcher(&query, options)?;
    let mut hits: Vec<SearchHit> = Vec::new();
    let mut files_scanned: usize = 0;
    // Set exactly when the walk stops *because* the cap bound — there were
    // still uninspected candidate files or (mid-file) unread lines when
    // `max_results` filled up. A walk that finishes with exactly
    // `max_results` matches and nothing left over stays `false`.
    let mut truncated = false;

    // The candidate set is materialized up-front (path walk only — no file
    // reads) so search and replace share one walker. The extra walk cost is
    // milliseconds on a vault-sized tree, and search still stops early once
    // `max_results` hits are in hand.
    for path in collect_files(Path::new(&root), path_filter) {
        if hits.len() >= max_results {
            truncated = true;
            break;
        }
        files_scanned += 1;
        // Read with the shared detection pipeline: `fs::read_to_string` used
        // to hard-fail on legacy-encoded (GBK / Big5 / ...) notes, which made
        // them invisible to global search even though the editor opened them
        // fine. Truly undecodable files still come back lossy with
        // `had_errors` — skip those, mirroring the old "unreadable → skip".
        let det = match super::commands::read_text_detected(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if det.had_errors {
            continue;
        }
        for (i, line) in det.content.lines().enumerate() {
            if hits.len() >= max_results {
                truncated = true;
                break;
            }
            if !matcher.find_spans(line).is_empty() {
                // Cap snippet length so a single giant line can't blow up the IPC payload.
                let snippet: String = line.chars().take(200).collect();
                hits.push(SearchHit {
                    file: path.to_string_lossy().to_string(),
                    line: i + 1,
                    snippet,
                });
            }
        }
        if truncated {
            break;
        }
    }

    Ok(SearchOutcome {
        hits,
        files_scanned,
        elapsed_ms: started.elapsed().as_millis() as u64,
        truncated,
    })
}

#[tauri::command]
pub async fn search_replace(
    root: String,
    query: String,
    replacement: String,
    options: Option<MatchOptions>,
    path_filter: Option<String>,
) -> Result<ReplaceSummary, String> {
    // Same guard as search — a replace is a *write* primitive, so an
    // unguarded root would be even worse.
    super::commands::path_guard::ensure_authorized(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        search_replace_inner(
            root,
            query,
            replacement,
            &options.unwrap_or_default(),
            path_filter.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

pub fn search_replace_inner(
    root: String,
    query: String,
    replacement: String,
    options: &MatchOptions,
    path_filter: Option<&str>,
) -> Result<ReplaceSummary, String> {
    let started = Instant::now();
    // An empty query would match everywhere; replacing "nothing" across a
    // vault is never what anyone wants. Refuse loudly.
    if query.is_empty() {
        return Err("search_replace: empty query".to_string());
    }
    let matcher = build_matcher(&query, options)?;
    let mut files_changed = 0usize;
    let mut replacements = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for path in collect_files(Path::new(&root), path_filter) {
        let det = match super::commands::read_text_detected(&path) {
            Ok(d) => d,
            Err(e) => {
                errors.push(format!("{}: {e}", path.display()));
                continue;
            }
        };
        if det.had_errors {
            // Lossy decode — persisting would enshrine mojibake. The
            // contract on `DetectedText` says callers that PERSIST must
            // refuse; record it and move on to the rest of the batch.
            errors.push(format!("{}: undecodable bytes, skipped", path.display()));
            continue;
        }
        let (next, n) = replace_preserving_eol(&det.content, &matcher, &replacement);
        if n == 0 {
            continue;
        }
        // Write back in the encoding the file was FOUND in (BOM included),
        // through the same temp + fsync + rename overwrite as every other
        // user-facing write.
        match super::commands::atomic_write_encoded(&path, &next, &det.encoding, det.had_bom) {
            Ok(()) => {
                files_changed += 1;
                replacements += n;
            }
            Err(e) => errors.push(format!("{}: {e}", path.display())),
        }
    }

    Ok(ReplaceSummary {
        files_changed,
        replacements,
        errors,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Matcher — the pure core shared by search and replace.
// ---------------------------------------------------------------------------

/// Compiled query matcher. Built once per query by [`build_matcher`]; both
/// the search pass and the replace pass consume the same instance so they
/// can never disagree on what "a match" is.
pub struct Matcher {
    re: Regex,
    /// `true` when the user wrote the pattern themselves (regex mode) —
    /// replacement then honors `$1`-style capture expansion. Literal mode
    /// splices the replacement in verbatim, `$` and all.
    regex_mode: bool,
}

impl Matcher {
    /// Byte-offset spans of every non-overlapping match in `text`.
    pub fn find_spans(&self, text: &str) -> Vec<(usize, usize)> {
        self.re.find_iter(text).map(|m| (m.start(), m.end())).collect()
    }

    /// Replace every match in `text`; returns the new text and how many
    /// replacements were made.
    pub fn replace_in_text(&self, text: &str, replacement: &str) -> (String, usize) {
        let count = self.re.find_iter(text).count();
        if count == 0 {
            return (text.to_string(), 0);
        }
        if self.regex_mode {
            let out = self.re.replace_all(text, replacement).into_owned();
            (out, count)
        } else {
            // Manual splice: regex-lite's replace_all would expand `$` in a
            // literal replacement — a note containing "$&" must survive.
            let mut out = String::with_capacity(text.len());
            let mut last = 0usize;
            for (s, e) in self.find_spans(text) {
                out.push_str(&text[last..s]);
                out.push_str(replacement);
                last = e;
            }
            out.push_str(&text[last..]);
            (out, count)
        }
    }
}

/// Pure matcher construction — the single place where the Aa / whole-word /
/// regex toggles become a pattern. Keep it free of I/O; unit-tested below.
pub fn build_matcher(query: &str, opts: &MatchOptions) -> Result<Matcher, String> {
    let body = if opts.regex {
        query.to_string()
    } else {
        escape_regex(query)
    };
    let mut pattern = String::with_capacity(body.len() + 16);
    if !opts.case_sensitive {
        pattern.push_str("(?i)");
    }
    if opts.whole_word {
        // Non-capturing wrap so an alternation like `foo|bar` gets BOTH
        // boundaries (`\bfoo` + `bar\b` would be wrong).
        pattern.push_str("\\b(?:");
        pattern.push_str(&body);
        pattern.push_str(")\\b");
    } else {
        pattern.push_str(&body);
    }
    let re = Regex::new(&pattern).map_err(|e| format!("invalid pattern: {e}"))?;
    Ok(Matcher { re, regex_mode: opts.regex })
}

/// Escape regex metacharacters so a literal query matches itself. Same
/// character set as the frontend's `escapeRe` (GlobalSearch.vue).
pub fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if "\\.+*?()|[]{}^$".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Replace every match in `content` line-by-line, preserving each line's own
/// EOL (`\n`, `\r\n`, or none at EOF). Matching happens on the EOL-stripped
/// body so `^` / `$` / `\b` behave identically to the per-line search hits,
/// and CRLF archives don't get silently normalized to LF.
fn replace_preserving_eol(content: &str, matcher: &Matcher, replacement: &str) -> (String, usize) {
    let mut out = String::with_capacity(content.len());
    let mut total = 0usize;
    for line_with in content.split_inclusive('\n') {
        let (body, eol) = match line_with.strip_suffix('\n') {
            Some(rest) => match rest.strip_suffix('\r') {
                Some(b) => (b, "\r\n"),
                None => (rest, "\n"),
            },
            None => (line_with, ""),
        };
        let (new_body, n) = matcher.replace_in_text(body, replacement);
        total += n;
        out.push_str(&new_body);
        out.push_str(eol);
    }
    (out, total)
}

// ---------------------------------------------------------------------------
// Walker — shared candidate set for search and replace.
// ---------------------------------------------------------------------------

/// Walk `root` once and return every allowed text file whose workspace-
/// relative path passes `path_filter` (`None` / blank = everything).
fn collect_files(root: &Path, path_filter: Option<&str>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let walker = WalkDir::new(root).follow_links(false).into_iter();
    for entry in walker.filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        // Skip dotfiles/dotdirs and the explicit deny-list.
        !name.starts_with('.') && !SKIP_DIRS.iter().any(|d| name == *d)
    }) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase());
        if !ext
            .map(|e| ALLOWED_EXT.contains(&e.as_str()))
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(f) = path_filter {
            // Normalize to `/` so a filter typed as `docs/` matches on
            // Windows too, where walkdir hands back `\`.
            let rel = path
                .strip_prefix(root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");
            if !path_matches(&rel, f) {
                continue;
            }
        }
        out.push(path.to_path_buf());
    }
    out
}

/// Path-filter matching. A plain substring (`docs/`) matches case-
/// insensitively anywhere in the relative path; a filter containing glob
/// metacharacters (`*.md`, `*/2024/*`) is matched as a glob against the
/// whole relative path, with `*` allowed to cross `/` (so `*.md` reaches
/// nested folders). An unparseable glob matches nothing — better a silent
/// empty result than a half-understood filter on a destructive pass.
fn path_matches(rel: &str, filter: &str) -> bool {
    let f = filter.trim();
    if f.is_empty() {
        return true;
    }
    if f.contains('*') || f.contains('?') {
        let glob = GlobBuilder::new(f)
            .case_insensitive(true)
            .literal_separator(false)
            .build();
        return match glob {
            Ok(g) => g.compile_matcher().is_match(rel),
            Err(_) => false,
        };
    }
    rel.to_lowercase().contains(&f.to_lowercase())
}

#[cfg(test)]
mod matcher_tests {
    use super::*;

    fn m(query: &str) -> Matcher {
        build_matcher(query, &MatchOptions::default()).unwrap()
    }

    #[test]
    fn literal_is_case_insensitive_by_default() {
        assert_eq!(m("Needle").find_spans("a NEEDLE here"), vec![(2, 8)]);
    }

    #[test]
    fn case_sensitive_toggle() {
        let opts = MatchOptions {
            case_sensitive: true,
            ..Default::default()
        };
        let matcher = build_matcher("Needle", &opts).unwrap();
        assert!(matcher.find_spans("a NEEDLE here").is_empty());
        assert_eq!(matcher.find_spans("a Needle here"), vec![(2, 8)]);
    }

    #[test]
    fn whole_word_rejects_substring() {
        let opts = MatchOptions {
            whole_word: true,
            ..Default::default()
        };
        let matcher = build_matcher("cat", &opts).unwrap();
        // Only the standalone `cat` — not the one inside `concatenate`.
        assert_eq!(matcher.find_spans("concatenate the cat"), vec![(16, 19)]);
    }

    #[test]
    fn whole_word_wraps_alternation() {
        // Alternation only exists in regex mode (literal mode escapes `|`),
        // so exercise the boundary wrap through it.
        let opts = MatchOptions {
            whole_word: true,
            regex: true,
            ..Default::default()
        };
        let matcher = build_matcher("foo|bar", &opts).unwrap();
        // `foobar` must NOT match: both alternatives need both boundaries.
        assert_eq!(matcher.find_spans("foobar foo"), vec![(7, 10)]);
    }

    #[test]
    fn regex_mode_matches_alternation() {
        let opts = MatchOptions {
            regex: true,
            ..Default::default()
        };
        let matcher = build_matcher("h(i|ey)", &opts).unwrap();
        assert_eq!(matcher.find_spans("hey hi hello"), vec![(0, 3), (4, 6)]);
    }

    #[test]
    fn literal_dollars_are_not_expanded() {
        let matcher = m("(a)");
        let (out, n) = matcher.replace_in_text("x (a) y (a)", "$1");
        assert_eq!(n, 2);
        assert_eq!(out, "x $1 y $1");
    }

    #[test]
    fn regex_replacement_expands_captures() {
        let opts = MatchOptions {
            regex: true,
            ..Default::default()
        };
        let matcher = build_matcher("(\\w+)@(\\w+)", &opts).unwrap();
        let (out, n) = matcher.replace_in_text("mail bob@corp now", "$2:$1");
        assert_eq!(n, 1);
        assert_eq!(out, "mail corp:bob now");
    }

    #[test]
    fn invalid_regex_is_reported() {
        let opts = MatchOptions {
            regex: true,
            ..Default::default()
        };
        assert!(build_matcher("([unclosed", &opts).is_err());
        // Literal mode never fails — the query gets escaped.
        assert!(build_matcher("([unclosed", &MatchOptions::default()).is_ok());
    }

    #[test]
    fn default_mode_agrees_with_lowercase_contains() {
        // The pre-options implementation was
        // `line.to_lowercase().contains(&query.to_lowercase())`; the matcher
        // must keep agreeing so existing search behavior doesn't shift.
        for line in ["The Needle", "NEEDLE haystack", "no match here", "needle"] {
            for q in ["needle", "Needle", "THE", "zzz"] {
                let old = line.to_lowercase().contains(&q.to_lowercase());
                let new = !m(q).find_spans(line).is_empty();
                assert_eq!(old, new, "line={line:?} q={q:?}");
            }
        }
    }

    #[test]
    fn eol_style_is_preserved_per_line() {
        let matcher = m("a");
        let (out, n) = replace_preserving_eol("a\r\nb\r\nca", &matcher, "X");
        assert_eq!(out, "X\r\nb\r\ncX");
        assert_eq!(n, 2);
    }

    #[test]
    fn path_filter_substring_and_glob() {
        assert!(path_matches("docs/notes/a.md", "docs/"));
        assert!(!path_matches("src/a.md", "docs/"));
        assert!(path_matches("docs/a.md", "*.MD"));
        assert!(path_matches("deep/dir/notes/b.md", "*.md"));
        assert!(path_matches("notes/2024/x.md", "*/2024/*"));
        assert!(!path_matches("notes/2024/x.md", "2019/"));
    }
}
