//! AI proxy for v2.0 F4 — inline AI rewrite (BYOK).
//!
//! Three providers: OpenAI, Anthropic, Ollama. The user picks one in
//! settings, supplies a model + (optional) base URL + an API key. Keys are
//! stored in the OS-native credential store (macOS keychain, Windows credential
//! manager, libsecret on Linux) via the `keyring` crate — never in
//! localStorage and never logged.
//!
//! The `ai_rewrite` command kicks off a streaming chat completion request to
//! the chosen provider. Chunks are forwarded to the frontend via the
//! `solomd://ai-chunk` event, with `solomd://ai-done` terminating a clean
//! stream and `solomd://ai-error` surfacing any failure. Each request gets a
//! unique `request_id` (returned synchronously) so the overlay can match
//! events to its own pending stream and cancel via `ai_cancel`.
//!
//! Cancellation is cooperative: a per-request `Arc<AtomicBool>` flag is
//! checked on every parsed chunk; setting it makes the streaming task exit on
//! the next iteration and emit `solomd://ai-error` with `"cancelled"`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

// Use `super::` paths so this module compiles under both the lib mount
// (`pub mod ai_proxy` in lib.rs) and the bin mount (`#[path = "ai_proxy.rs"]
// mod ai_proxy` in runner.rs). Both put our siblings one scope up.
use super::agent_run::{RunHandle, RunKind, TraceStep};
use super::agent_tools;
use super::ai_keystore;
use super::ollama as ollama_addr;
use super::pricing;

// ---------------------------------------------------------------------------
// Provider aliases
// ---------------------------------------------------------------------------

/// Resolve a provider id to its canonical form. `local` → `ollama` was the
/// first alias, introduced for v4.0 Recipes (P2): YAML files written by
/// hand often say `provider: local`, which is more intuitive than the brand
/// name. v4.11.18 adds the runtime names people actually type for a
/// self-hosted OpenAI-compatible server. Both ai-providers.ts and the
/// Recipe loader call this helper so the aliasing lives in one place.
pub fn resolve_provider(id: &str) -> &str {
    match id {
        "local" => "ollama",
        "llama" | "llama-cpp" | "llamacpp" | "llama.cpp" | "lmstudio" | "lm-studio" | "vllm"
        | "custom" | "openai-compatible" => "openai-compat",
        other => other,
    }
}

/// Providers with no account behind them: a local Ollama, or a self-hosted
/// OpenAI-compatible server (llama.cpp's `llama-server`, LM Studio, vLLM,
/// Ollama's own `/v1` shim …). A key is still *allowed* — people do put a
/// reverse proxy with a token in front — but never required, and we don't
/// send an `Authorization` header when there isn't one.
pub fn is_keyless_provider(provider: &str) -> bool {
    matches!(resolve_provider(provider), "ollama" | "openai-compat")
}

/// The wire protocol for a provider/format id. `openai-compat` is a
/// *provider*, not a protocol — it speaks plain OpenAI Chat Completions —
/// so callers that omit `api_format` still reach the right runner.
fn wire_format(format: &str) -> String {
    match resolve_provider(format) {
        "openai-compat" => "openai".to_string(),
        other => other.to_string(),
    }
}

/// Attach `Authorization: Bearer …` only when we actually have a key.
/// llama-server rejects nothing, but some servers 401 on an empty bearer
/// rather than ignoring it, so sending `Bearer ` was worse than nothing.
fn with_optional_bearer(rb: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    if key.trim().is_empty() {
        rb
    } else {
        rb.bearer_auth(key)
    }
}

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------
//
// Each vendor's dialect is declared here instead of being discovered at
// request time. `ai_list_models` used to staple every plausible credential
// header onto one request — `Authorization`, `api-key`, `x-goog-api-key`,
// `x-api-key`, `anthropic-version` — and then retry with the key in the query
// string when that failed. Three problems with that: strict gateways reject
// the surplus headers, the query-string retry writes the key into logs and
// error text, and "try everything" silently masked a wrong endpoint instead of
// reporting it. Mirrored by `authStrategy` / `modelListStrategy` in
// `app/src/lib/ai-providers.ts`; keep the two in sync.

/// How a provider wants its credential presented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthStrategy {
    /// `Authorization: Bearer <key>` — OpenAI and every compatible vendor,
    /// gateway, aggregator and self-hosted runtime.
    Bearer,
    /// `x-api-key` + `anthropic-version`.
    Anthropic,
    /// `x-goog-api-key` (Google Generative Language API).
    Google,
    /// No credential (local runtime).
    None,
}

/// How (and whether) a provider exposes a model list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelListStrategy {
    /// `GET {base}/models`, OpenAI envelope.
    OpenAi,
    /// `GET {root}/v1/models`, Anthropic envelope.
    Anthropic,
    /// `GET {root}/v1beta/models`, Google envelope.
    Google,
    /// `GET {base}/api/tags`, Ollama envelope.
    Ollama,
    /// The vendor has no list endpoint at all — don't probe, say so.
    None,
}

#[derive(Debug, Clone, Copy)]
pub struct ProviderCaps {
    pub auth: AuthStrategy,
    pub models: ModelListStrategy,
    pub supports_tools: bool,
    pub supports_streaming: bool,
}

/// Capability declaration for a provider id (aliases resolved first).
pub fn provider_caps(provider: &str) -> ProviderCaps {
    let openai_like = ProviderCaps {
        auth: AuthStrategy::Bearer,
        models: ModelListStrategy::OpenAi,
        supports_tools: true,
        supports_streaming: true,
    };
    match resolve_provider(provider) {
        "anthropic" => ProviderCaps {
            auth: AuthStrategy::Anthropic,
            models: ModelListStrategy::Anthropic,
            supports_tools: true,
            supports_streaming: true,
        },
        "gemini" => ProviderCaps {
            auth: AuthStrategy::Google,
            models: ModelListStrategy::Google,
            supports_tools: true,
            supports_streaming: true,
        },
        "ollama" => ProviderCaps {
            auth: AuthStrategy::None,
            models: ModelListStrategy::Ollama,
            // The panel never wires tools for Ollama (the open models we ship
            // don't emit reliable tool_use blocks), so don't offer them.
            supports_tools: false,
            supports_streaming: true,
        },
        "volcengine" | "minimax" => ProviderCaps {
            models: ModelListStrategy::None,
            ..openai_like
        },
        // `openai-compat` plus anything unrecognised: plain OpenAI dialect.
        _ => openai_like,
    }
}

/// Apply the provider's declared credential presentation to a request.
fn apply_auth(
    rb: reqwest::RequestBuilder,
    auth: AuthStrategy,
    key: &str,
) -> reqwest::RequestBuilder {
    match auth {
        AuthStrategy::None => rb,
        AuthStrategy::Bearer => with_optional_bearer(rb, key),
        AuthStrategy::Anthropic => rb
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        AuthStrategy::Google => rb.header("x-goog-api-key", key),
    }
}

/// Credential to present when calling a vendor's **OpenAI-compatibility**
/// surface — `{base}/models`, `{base}/chat/completions` where `base` ends in
/// `/v1beta/openai` for Gemini and `/v1` for everyone else.
///
/// Deliberately *not* `provider_caps(provider).auth`: the credential a vendor
/// wants depends on which surface you are calling, and Gemini's two surfaces
/// disagree outright.
///
///   native  `…/v1beta/models`, `…/v1beta/models/x:generateContent`
///           → `x-goog-api-key` (a bare `Authorization` is not accepted)
///   compat  `…/v1beta/openai/models`, `…/v1beta/openai/chat/completions`
///           → `Authorization: Bearer`; sending only `x-goog-api-key` comes
///             back `400 Missing Authorization header`
///
/// So this is always a bearer. Everything that talks to the compat surface —
/// `ai_verify_key` here, plus the chat runners via `with_optional_bearer`
/// (note that `with_optional_bearer` also omits the header when the key is
/// empty, which is what keyless local servers need) — must agree on that.
fn compat_surface_auth() -> AuthStrategy {
    AuthStrategy::Bearer
}

/// The keychain slot a request reads/writes: the caller's profile id when one
/// was supplied, else the legacy provider-named slot.
///
/// Profiles save their keys under `profile-<timestamp>-<rand>`, so a request
/// that omits `key_id` looks in a slot nothing ever writes to — which is why a
/// key that AI Settings had just "saved and verified" was still missing at
/// chat time. The provider fallback stays for keys stored before profiles
/// owned credentials.
fn key_slot<'a>(key_id: Option<&'a str>, provider: &'a str) -> &'a str {
    match key_id {
        Some(s) if !s.trim().is_empty() => s,
        _ => provider,
    }
}

/// Read the credential for a request: the profile's slot, falling back to the
/// provider-named slot once (and only once — no double read when they match).
fn read_key_for(key_id: Option<&str>, provider: &str) -> Result<String, String> {
    let slot = key_slot(key_id, provider);
    match read_key(slot) {
        Ok(k) => Ok(k),
        Err(e) => {
            if slot == provider {
                Err(e)
            } else {
                read_key(provider)
            }
        }
    }
}

/// Root of the Anthropic Messages API for a (possibly user-supplied) base URL.
/// A base that already ends in `/v1` — which people paste, since that is what
/// every Anthropic example shows — must not become `/v1/v1/messages`.
fn anthropic_v1_root(base_url: Option<&str>) -> String {
    let base = base_url
        .map(str::trim)
        .map(|s| s.trim_end_matches('/'))
        .filter(|s| !s.is_empty())
        .unwrap_or("https://api.anthropic.com");
    if base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1")
    }
}

/// `…/v1/messages`, `…/v1/models` — the URL the real request uses AND the URL
/// verification must use. They used to disagree: verification hardcoded
/// `https://api.anthropic.com/v1/messages` with `claude-haiku-4-5` while chat
/// honoured the user's base URL and model, so a working custom gateway could
/// fail verification and vice versa.
fn anthropic_endpoint(base_url: Option<&str>, path: &str) -> String {
    format!("{}/{}", anthropic_v1_root(base_url), path)
}

/// Native Generative Language root (`…/v1beta`) for a base URL that may be
/// either the OpenAI-compatibility base (`…/v1beta/openai`) or the native one.
///
/// The old code appended `/v1beta/models` to whatever base it had, so the
/// default Gemini base produced
/// `https://generativelanguage.googleapis.com/v1beta/openai/v1beta/models`.
fn google_v1beta_root(base_url: Option<&str>) -> String {
    let raw = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta");
    let trimmed = raw.trim_end_matches('/');
    let native = trimmed.strip_suffix("/openai").unwrap_or(trimmed);
    if native.ends_with("/v1beta") || native.ends_with("/v1") {
        native.to_string()
    } else {
        format!("{native}/v1beta")
    }
}

/// Clean up a user-typed OpenAI-compatible base URL.
///
/// The convention (same as the OpenAI SDK) is that the base already carries
/// the version path — `/v1`, `/api/v3`, `/v1beta/openai` — and we append
/// `/chat/completions`. That convention silently 404s for the one address
/// people paste most often: the bare `http://192.168.1.20:8080` that
/// llama.cpp / LM Studio / vLLM print on startup. So:
///
///   * empty / whitespace-only → `None` (caller falls back to its default)
///   * no scheme → `http://` for a host:port / IP / localhost, else `https://`
///   * trailing `/` → dropped
///   * no path at all → `/v1` appended (an existing path is left alone, so
///     `/api/v3` and `/v1beta/openai` still work)
pub fn normalize_openai_base(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let has_scheme = trimmed.contains("://");
    let after_scheme = if has_scheme {
        trimmed.split_once("://").map(|x| x.1).unwrap_or("")
    } else {
        trimmed
    };
    let host = after_scheme.split('/').next().unwrap_or("");
    let host_only = host.rsplit('@').next().unwrap_or(host);
    let hostname = if let Some(rest) = host_only.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host_only.split(':').next().unwrap_or("")
    };
    let looks_local = hostname == "localhost"
        || hostname.ends_with(".local")
        || hostname.parse::<std::net::IpAddr>().is_ok();
    let with_scheme = if has_scheme {
        trimmed.to_string()
    } else if looks_local || host_only.contains(':') {
        format!("http://{trimmed}")
    } else {
        format!("https://{trimmed}")
    };
    // Does anything follow the host? If not, the server is expecting the
    // version prefix we'd otherwise skip.
    let path = with_scheme.split_once("://").map(|x| x.1)
        .and_then(|rest| rest.split_once('/'))
        .map(|(_, p)| p.trim_matches('/').to_string())
        .unwrap_or_default();
    let out = if path.is_empty() {
        format!("{}/v1", with_scheme.trim_end_matches('/'))
    } else {
        with_scheme.trim_end_matches('/').to_string()
    };
    Some(out)
}

/// The OpenAI-compatible base URL to use: the caller's, normalized, or
/// OpenAI's own endpoint.
fn openai_base(base_url: Option<&str>) -> String {
    base_url
        .and_then(normalize_openai_base)
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string())
}

// ---------------------------------------------------------------------------
// Public request/event types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct RewriteRequest {
    /// Stable id used for keychain key storage (e.g. "openai", "deepseek",
    /// "qwen"). Each provider gets its own key slot in the OS keychain so
    /// users can keep multiple keys at once.
    pub provider: String,
    /// API wire format. Maps to the streaming implementation used:
    ///   - "openai"     — OpenAI Chat Completions (also DeepSeek, Qwen,
    ///                    GLM, Kimi, Doubao, xAI, Mistral, Groq, Gemini's
    ///                    OpenAI-compat endpoint, etc.)
    ///   - "anthropic"  — Anthropic Messages API
    ///   - "ollama"     — local Ollama (no API key required)
    /// Defaults to `provider` when missing for backwards compatibility.
    #[serde(default)]
    pub api_format: Option<String>,
    /// Model id, e.g. "gpt-4.1-mini", "deepseek-chat", "qwen-plus".
    pub model: String,
    /// System prompt — describes the assistant's role.
    pub system: String,
    /// User instruction (e.g. "Rewrite this in fewer words"). The selection
    /// is appended below as `Text:\n<selection>`.
    pub user: String,
    /// The text the user highlighted in the editor.
    pub selection: String,
    /// Optional override (e.g. self-hosted OpenAI-compatible endpoint, or a
    /// non-default Ollama port). Empty / missing = provider default.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Keychain slot to authenticate with. Callers send the active AI
    /// profile's id here; when absent we fall back to the provider-named slot
    /// for keys stored before profiles owned their credentials. Same field and
    /// same rule as `ChatRequest::key_id` — the two paths must not disagree,
    /// or the panel and the inline rewrite authenticate against different
    /// credentials for the same settings screen.
    #[serde(default)]
    pub key_id: Option<String>,
    /// Optional caller-provided request id. When present, the backend uses
    /// this instead of `make_request_id()` so the frontend can wire its
    /// event listeners BEFORE invoking the command — closes a race where
    /// a fast failure (e.g. ollama 404 on a missing model) emits
    /// `ai-error` while the JS listener still has `requestId === null`
    /// and silently drops the error, leaving the inline rewrite overlay
    /// stuck on "Rewriting…" with no visible feedback.
    #[serde(default)]
    pub request_id: Option<String>,
}

/// v4.0 pillar 1 — Inline Agent Panel chat message.
///
/// Roles follow the OpenAI chat convention: `system` / `user` / `assistant`.
/// `tool` is added in the v4.0 tool-call loop — the message body for a
/// `tool` role is the tool result string, paired with `tool_call_id`.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    /// Set on `tool` role messages — the id of the tool_call this is
    /// answering. Frontend doesn't have to populate this on user messages;
    /// the tool-call loop fills it in for results it appends.
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

/// Multi-turn chat request. Same provider/model/base_url plumbing as
/// `RewriteRequest` but takes a full `messages` array — the caller is
/// responsible for assembling history + system prompt.
///
/// v4.0 fields per C3.2:
/// - `tools`: which tool names to enable (None = all read-only).
/// - `allow_write`: gates write_note / append_to_note. Default false.
/// - `run_id`: existing run id to attach to. If absent, ai_chat mints one.
/// - `workspace`: absolute path. Required if run_id is absent (so we know
///   where to write the run dir). Optional if run_id is supplied (the run
///   dir is already created and we resolve back to its workspace).
/// - `tool_loop_cap`: max number of tool-use iterations. Default 8.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatRequest {
    pub provider: String,
    #[serde(default)]
    pub api_format: Option<String>,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub tools: Option<Vec<String>>,
    #[serde(default)]
    pub allow_write: Option<bool>,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub tool_loop_cap: Option<u32>,
    #[serde(default)]
    pub key_id: Option<String>,
    /// Optional caller-provided request id. When present, the backend uses
    /// this instead of `make_request_id()` so the frontend can wire its
    /// event listeners BEFORE invoking the command — closes a race where
    /// a fast failure (e.g. ollama 404 on a missing model) emits
    /// `ai-error` while the JS listener still has `currentRunId === null`
    /// and silently drops the error, leaving the panel stuck on
    /// "streaming…" with no visible feedback.
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ChunkEvent {
    request_id: String,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
struct DoneEvent {
    request_id: String,
    full_text: String,
}

#[derive(Debug, Clone, Serialize)]
struct ErrorEvent {
    request_id: String,
    error: String,
}

/// v4.0 — emitted before each tool dispatch so the frontend can show a
/// pending tool-call card. Matches C3.2 step 1.
#[derive(Debug, Clone, Serialize)]
struct ToolCallEvent {
    request_id: String,
    run_id: String,
    tool_call_id: String,
    tool: String,
    args: Value,
}

/// v4.0 — emitted after the in-process tool returns. Matches C3.2 step 3.
#[derive(Debug, Clone, Serialize)]
struct ToolResultEvent {
    request_id: String,
    run_id: String,
    tool_call_id: String,
    result: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Emitted alongside `solomd://ai-done` — gives the frontend the run_id so
/// it can stash a "view trace" pointer per assistant message. The legacy
/// `DoneEvent` keeps shipping for backwards compat with the existing UI.
#[derive(Debug, Clone, Serialize)]
struct RunStartedEvent {
    request_id: String,
    run_id: String,
}

// ---------------------------------------------------------------------------
// Cancellation registry
// ---------------------------------------------------------------------------

static CANCEL_FLAGS: Lazy<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Bug O: per-(provider, base_url) memo of OpenAI-compat servers that
/// reject `stream_options.include_usage` with a 400. Some older self-hosted
/// vLLM forks and a couple of SiliconFlow tiers don't recognise the field
/// and respond `{"error": "unknown body param: stream_options"}`. The
/// streaming path retries once without the field on first 400 and caches
/// the key here so subsequent requests skip directly to the no-options
/// body. Keyed as `"<provider>|<base_url>"`. In-memory only — re-checks
/// once per process restart, no persistence.
static STREAM_OPTIONS_UNSUPPORTED: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

fn stream_options_cache_key(provider: &str, base_url: &str) -> String {
    format!("{provider}|{base_url}")
}

fn stream_options_unsupported(key: &str) -> bool {
    STREAM_OPTIONS_UNSUPPORTED
        .get_or_init(|| Mutex::new(std::collections::HashSet::new()))
        .lock()
        .map(|s| s.contains(key))
        .unwrap_or(false)
}

fn mark_stream_options_unsupported(key: &str) {
    if let Ok(mut s) = STREAM_OPTIONS_UNSUPPORTED
        .get_or_init(|| Mutex::new(std::collections::HashSet::new()))
        .lock()
    {
        s.insert(key.to_string());
    }
}

/// Monotonic suffix so two requests created in the same millisecond don't
/// collide on `request_id`.
static REQ_COUNTER: AtomicU64 = AtomicU64::new(0);

fn make_request_id() -> String {
    let n = REQ_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("req-{ts}-{n}")
}

fn make_tool_call_id(idx: u64) -> String {
    let n = REQ_COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("call_{idx}_{ts}_{n}")
}

fn register_cancel_flag(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = CANCEL_FLAGS.lock() {
        map.insert(id.to_string(), flag.clone());
    }
    flag
}

fn drop_cancel_flag(id: &str) {
    if let Ok(mut map) = CANCEL_FLAGS.lock() {
        map.remove(id);
    }
}

// ---------------------------------------------------------------------------
// Key storage commands
// ---------------------------------------------------------------------------
//
// #102 — key storage is abstracted behind `ai_keystore`: the OS keyring on
// macOS / Windows / Linux, an encrypted file in `app_config_dir` on Android
// (where keyring has no backend and silently dropped keys on restart). The
// command wrappers below just prime the config dir (so the file backend can
// resolve its path) and delegate.

/// One-token chat completion, used to verify an OpenAI-compatible endpoint
/// that doesn't serve `GET /models` (#261). Returns the endpoint's own error
/// text on failure so the UI can show it verbatim.
async fn openai_chat_ping(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let model = model
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .ok_or_else(|| "no /models list and no model name configured to test with".to_string())?;
    let url = format!("{base}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1,
        "messages": [{"role": "user", "content": "ping"}]
    });
    let res = with_optional_bearer(client.post(&url), key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    if status.is_success() {
        Ok(format!("OK · {model} responded (endpoint has no /models list)"))
    } else {
        let txt = res.text().await.unwrap_or_default();
        Err(format!("chat ping HTTP {status}: {}", truncate(&txt, 200)))
    }
}

/// Make a minimal call to the provider to confirm the key + base_url work.
/// Returns Ok with a short message (e.g. model count) on success, Err with
/// a human-readable reason on failure. Used by AISettings to show a green
/// "Verified ✓" / red "Invalid key" pill right after the user clicks Save.
#[tauri::command]
pub async fn ai_verify_key(
    provider: String,
    key: Option<String>,
    api_format: Option<String>,
    base_url: Option<String>,
    // Model for the chat-ping fallback when the endpoint has no
    // `GET /models`. Optional — callers that don't know one yet just get
    // the original error back.
    model: Option<String>,
    key_id: Option<String>,
) -> Result<String, String> {
    let format = wire_format(&api_format.unwrap_or_else(|| provider.clone()));
    let key_str = match key {
        Some(k) if !k.trim().is_empty() => k,
        // A keyless provider (local Ollama / self-hosted OpenAI-compatible
        // server) verifies fine with no key at all — don't fail the probe
        // just because the keychain has nothing for it.
        _ if is_keyless_provider(&provider) => {
            read_key_for(key_id.as_deref(), &provider).unwrap_or_default()
        }
        _ => match read_key_for(key_id.as_deref(), &provider) {
            Ok(k) => k,
            Err(e) => return Err(e),
        },
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    match format.as_str() {
        "openai" => {
            let base = openai_base(base_url.as_deref());
            // The OpenAI-compatibility surface lives at `{base}/models` for
            // every vendor that exposes one, including Gemini's `/v1beta/openai`.
            let url = format!("{base}/models");
            // The credential header follows the *surface*, not the vendor —
            // see `compat_surface_auth`. Keying this off
            // `provider_caps(provider).auth` sent Gemini's key in the one form
            // its compat endpoint rejects, so verification only ever passed by
            // falling through to the chat ping below.
            let res = apply_auth(client.get(&url), compat_surface_auth(), &key_str)
                .send()
                .await
                .map_err(|e| format!("network: {e}"))?;
            let status = res.status();
            if status.is_success() {
                let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
                let n = body
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                return Ok(format!("OK · {n} models available"));
            }
            let txt = res.text().await.unwrap_or_default();
            // 401/403 is the endpoint telling us the key is wrong. That IS
            // a verification failure — don't paper over it with a ping that
            // would fail the same way.
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                return Err(format!("HTTP {status}: {}", truncate(&txt, 200)));
            }
            // #261 — `GET /models` is optional in practice. Corporate
            // gateways and some self-hosted runtimes 404 it while chat
            // completions work fine, and refusing to verify left those
            // users unable to finish setup. Ask the endpoint the question
            // that actually matters instead.
            match openai_chat_ping(&client, &base, &key_str, model.as_deref()).await {
                Ok(msg) => Ok(msg),
                Err(ping_err) => Err(format!(
                    "HTTP {status}: {} · {ping_err}",
                    truncate(&txt, 200)
                )),
            }
        }
        "anthropic" => {
            // Verify the endpoint the user actually configured, not a
            // hardcoded host. This used to POST to `api.anthropic.com` with
            // `claude-haiku-4-5` no matter what the caller passed, so a
            // working custom gateway failed verification while a broken
            // custom base URL passed it.
            let base = base_url.as_deref();
            // Anthropic serves `GET /v1/models` — try that first, since it
            // costs nothing and doesn't depend on the model being valid.
            let models_url = anthropic_endpoint(base, "models");
            let res = apply_auth(client.get(&models_url), AuthStrategy::Anthropic, &key_str)
                .send()
                .await
                .map_err(|e| format!("network: {e}"))?;
            let status = res.status();
            if status.is_success() {
                let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
                let n = body
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                return Ok(format!("OK · {n} models available"));
            }
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                let txt = res.text().await.unwrap_or_default();
                return Err(format!("HTTP {status}: {}", truncate(&txt, 200)));
            }
            // Gateways that only proxy `/v1/messages` will 404 the list —
            // fall back to a 1-token ping on the caller's own model.
            let list_txt = res.text().await.unwrap_or_default();
            let model = model
                .as_deref()
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .ok_or_else(|| {
                    format!(
                        "HTTP {status}: {} · no model name configured to test with",
                        truncate(&list_txt, 160)
                    )
                })?;
            let url = anthropic_endpoint(base, "messages");
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1,
                "messages": [{"role":"user","content":"ping"}]
            });
            let res = apply_auth(client.post(&url), AuthStrategy::Anthropic, &key_str)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("network: {e}"))?;
            let status = res.status();
            if status.is_success() {
                Ok(format!("OK · {model} responded"))
            } else {
                let txt = res.text().await.unwrap_or_default();
                Err(format!("HTTP {status}: {}", truncate(&txt, 200)))
            }
        }
        "ollama" => {
            // Same normalization the detect probe uses, so a LAN address
            // typed without a scheme ("192.168.1.20:11434") verifies too.
            let base = ollama_addr::base_url(base_url.as_deref());
            let url = format!("{base}/api/tags");
            let res = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("network: {e} (is Ollama running?)"))?;
            if res.status().is_success() {
                let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
                let n = body
                    .get("models")
                    .and_then(|d| d.as_array())
                    .map(|a| a.len())
                    .unwrap_or(0);
                Ok(format!("OK · {n} local models"))
            } else {
                Err(format!("HTTP {}: ollama not reachable", res.status()))
            }
        }
        other => Err(format!("unknown api_format: {other}")),
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

/// Result of probing an OpenAI-compatible server's `/models` endpoint.
///
/// Mirrors `ollama::Detection` so AI Settings can render one status pill for
/// both local runtimes. Unlike `ai_verify_key` this never returns `Err` —
/// the failure text rides along in `error` so the panel can show *why*
/// ("HTTP 404", "connection refused") instead of a bare red dot. That
/// message is the whole point: a self-hosted server that "似乎不成功" is
/// almost always a wrong path or a wrong port, and the user can't tell
/// which without seeing the server's own answer.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ModelProbe {
    pub ok: bool,
    pub models: Vec<String>,
    /// The address actually probed, after normalization — so the user can
    /// see that `192.168.1.20:8080` became `http://192.168.1.20:8080/v1`.
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn default_base_for_provider(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1"),
        "anthropic" => Some("https://api.anthropic.com/v1"),
        "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        "xai" => Some("https://api.x.ai/v1"),
        "mistral" => Some("https://api.mistral.ai/v1"),
        "groq" => Some("https://api.groq.com/openai/v1"),
        "deepseek" => Some("https://api.deepseek.com/v1"),
        "qwen" => Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
        "glm" => Some("https://open.bigmodel.cn/api/paas/v4"),
        "kimi" => Some("https://api.moonshot.cn/v1"),
        "volcengine" => Some("https://ark.cn-beijing.volces.com/api/v3"),
        "siliconflow" => Some("https://api.siliconflow.cn/v1"),
        "minimax" => Some("https://api.minimax.io/v1"),
        "openrouter" => Some("https://openrouter.ai/api/v1"),
        "opencode-go" => Some("https://opencode.ai/zen/go/v1"),
        "ollama" => Some("http://localhost:11434"),
        _ => None,
    }
}

fn extract_models_from_json(json: &serde_json::Value) -> Vec<String> {
    let arr = json
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| json.get("models").and_then(|d| d.as_array()))
        .or_else(|| json.as_array())
        .cloned()
        .unwrap_or_default();

    let mut models = Vec::new();
    for m in arr {
        if let Some(methods) = m.get("supportedGenerationMethods").and_then(|v| v.as_array()) {
            let can_generate = methods.iter().any(|method| {
                method.as_str() == Some("generateContent")
            });
            if !can_generate {
                continue;
            }
        }
        let raw_id = m.get("id")
            .and_then(|v| v.as_str())
            .or_else(|| m.get("name").and_then(|v| v.as_str()))
            .or_else(|| m.get("model").and_then(|v| v.as_str()))
            .or_else(|| m.as_str());

        if let Some(id_str) = raw_id {
            let stripped = id_str.strip_prefix("models/").unwrap_or(id_str).trim();
            if !stripped.is_empty() {
                models.push(stripped.to_string());
            }
        }
    }
    models.sort();
    models.dedup();
    models
}

/// `GET {base}/models` against the provider and return the model ids it
/// advertises.
///
/// One request, aimed with the provider's declared `ModelListStrategy`. The
/// previous version built a list of guessed URLs and, on any 404/401, retried
/// with the API key appended as `?key=…` after stapling five different auth
/// headers onto the first attempt. That had to go: keys in query strings end
/// up in server logs and in the error text we show the user, and "try
/// everything" reported a wrong endpoint as a generic failure instead of the
/// endpoint's own answer.
#[tauri::command]
pub async fn ai_list_models(
    provider: String,
    base_url: Option<String>,
    key: Option<String>,
    key_id: Option<String>,
) -> ModelProbe {
    let caps = provider_caps(&provider);
    let strategy = caps.models;
    let default_base = default_base_for_provider(&provider);
    let supplied = base_url.as_deref().map(str::trim).filter(|s| !s.is_empty());

    if strategy == ModelListStrategy::None {
        return ModelProbe {
            ok: false,
            models: Vec::new(),
            url: String::new(),
            error: Some(format!(
                "{provider} has no model-list endpoint here — enter the model name manually"
            )),
        };
    }

    // The list endpoint does not always share the chat base. Gemini chats
    // against `…/v1beta/openai` but lists on `…/v1beta/models`, and Anthropic's
    // base is the bare host while both endpoints live under `/v1`.
    let base = match strategy {
        ModelListStrategy::Ollama => ollama_addr::base_url(supplied.or(default_base)),
        ModelListStrategy::Anthropic => anthropic_v1_root(supplied.or(default_base)),
        ModelListStrategy::Google => google_v1beta_root(supplied.or(default_base)),
        ModelListStrategy::OpenAi => {
            let raw = supplied.or(default_base).unwrap_or("https://api.openai.com/v1");
            normalize_openai_base(raw)
                .unwrap_or_else(|| raw.trim_end_matches('/').to_string())
        }
        ModelListStrategy::None => unreachable!("handled above"),
    };

    let key_str = match key {
        Some(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => read_key_for(key_id.as_deref(), &provider).unwrap_or_default(),
    };

    let url = match strategy {
        ModelListStrategy::Ollama => format!("{base}/api/tags"),
        // Anthropic base is already the `/v1` root; Google's is the `v1beta`.
        _ => format!("{base}/models"),
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ModelProbe {
                url,
                error: Some(e.to_string()),
                ..Default::default()
            }
        }
    };

    let resp = match apply_auth(client.get(&url), caps.auth, &key_str).send().await {
        Ok(r) => r,
        Err(e) => {
            return ModelProbe {
                url,
                error: Some(format!("network: {e}")),
                ..Default::default()
            }
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return ModelProbe {
            ok: false,
            models: Vec::new(),
            url,
            error: Some(format!("HTTP {status}: {}", truncate(&txt, 160))),
        };
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return ModelProbe {
                ok: false,
                models: Vec::new(),
                url,
                error: Some(format!("bad JSON: {e}")),
            }
        }
    };

    ModelProbe {
        ok: true,
        models: extract_models_from_json(&json),
        url,
        error: None,
    }
}

/// Store an API key. `key_id` is the profile id the key belongs to; when the
/// caller omits it the key lands in the provider-named slot, which is the
/// pre-multi-profile convention. Prefer passing `key_id` — every request path
/// resolves the profile slot first, so a key written to the provider slot is
/// only found via the legacy fallback.
#[tauri::command]
pub fn ai_set_key(
    app: AppHandle,
    provider: String,
    key: String,
    key_id: Option<String>,
) -> Result<(), String> {
    ai_keystore::prime_config_dir(&app);
    ai_keystore::set_key(key_slot(key_id.as_deref(), &provider), &key)
}

#[tauri::command]
pub fn ai_has_key(
    app: AppHandle,
    provider: String,
    key_id: Option<String>,
) -> Result<bool, String> {
    ai_keystore::prime_config_dir(&app);
    ai_keystore::has_key(key_slot(key_id.as_deref(), &provider))
}

#[tauri::command]
pub fn ai_clear_key(
    app: AppHandle,
    provider: String,
    key_id: Option<String>,
) -> Result<(), String> {
    ai_keystore::prime_config_dir(&app);
    ai_keystore::clear_key(key_slot(key_id.as_deref(), &provider))
}

fn read_key(provider: &str) -> Result<String, String> {
    ai_keystore::read_key(provider)
}

/// Public counterpart of `read_key`. The recipe runner (and any future
/// outside-of-`ai_chat` caller that wants to drive `run_chat_*_loop`) needs
/// this to fetch the per-provider key the same way the streaming
/// entrypoint does. No new logic — just delegates to the keystore.
pub fn get_api_key(provider: &str) -> Result<String, String> {
    read_key(provider)
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn ai_cancel(request_id: String) -> Result<(), String> {
    if let Ok(map) = CANCEL_FLAGS.lock() {
        if let Some(flag) = map.get(&request_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Streaming entrypoint
// ---------------------------------------------------------------------------

/// v4.0 pillar 1 — multi-turn chat streaming entrypoint with tool-call loop.
///
/// Returns a request id; events are emitted on:
///   - `solomd://ai-chunk` — streaming text deltas
///   - `solomd://ai-tool-call` — about to dispatch a tool (C3.2 step 1)
///   - `solomd://ai-tool-result` — tool returned (C3.2 step 3)
///   - `solomd://ai-done` — final assistant turn ended cleanly
///   - `solomd://ai-error` — any failure
///   - `solomd://ai-run-started` — emitted right after run dir is created;
///                                 carries the run_id for trace replay UI
///
/// Workspace persistence: when `run_id` is absent and `workspace` is
/// provided, ai_chat mints a new run dir under
/// `<workspace>/.solomd/agent-runs/<run-id>/` and persists the conversation
/// + every tool call to `trace.jsonl` + `run.md` per C1 / C2.
///
/// Ollama path stays single-turn — we don't wire tools because the open
/// models we ship don't reliably emit tool_use blocks. Degrades gracefully:
/// if the user has tools enabled but selects Ollama, the chat just runs
/// without tool calls.
#[tauri::command]
pub async fn ai_chat(app: AppHandle, request: ChatRequest) -> Result<String, String> {
    // #102 — prime the config dir so the Android encrypted-file key backend
    // can resolve its path before `read_key` runs below.
    ai_keystore::prime_config_dir(&app);
    let request_id = request
        .request_id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(make_request_id);
    let cancel = register_cancel_flag(&request_id);

    let format = wire_format(
        &request
            .api_format
            .clone()
            .unwrap_or_else(|| request.provider.clone()),
    );

    // Every runner below is written against a streamed response. A provider
    // declared non-streaming would be parsed as if it were streaming and fail
    // in a confusing way, so refuse up front instead.
    if !provider_caps(&request.provider).supports_streaming {
        drop_cancel_flag(&request_id);
        return Err(format!(
            "{} does not support streaming responses, which this client requires",
            request.provider
        ));
    }

    let key_id = request.key_id.clone().filter(|s| !s.trim().is_empty());

    // Ollama and self-hosted OpenAI-compatible servers have no account
    // behind them: an absent key is the normal case, not a failure.
    let api_key = if format == "ollama" {
        String::new()
    } else if is_keyless_provider(&request.provider) {
        read_key_for(key_id.as_deref(), &request.provider).unwrap_or_default()
    } else {
        match read_key_for(key_id.as_deref(), &request.provider) {
            Ok(k) => k,
            Err(e) => {
                drop_cancel_flag(&request_id);
                return Err(e);
            }
        }
    };

    // Set up the run handle if a workspace was supplied. We can't fail the
    // command outright if the dir creation hits a permission error — the
    // chat should still happen, just without on-disk persistence. In that
    // case `run_handle` stays None and trace writes silently no-op.
    let run_handle: Option<Arc<RunHandle>> = match (&request.run_id, &request.workspace) {
        (Some(_run_id), Some(_ws)) => {
            // P3 will land "attach to existing run". For v4.0, panel chats
            // always start a fresh run; this branch is a placeholder.
            None
        }
        (None, Some(ws)) if !ws.is_empty() => {
            let path = std::path::Path::new(ws);
            match RunHandle::start(
                path,
                RunKind::Panel,
                &request.provider,
                &request.model,
                None,
            ) {
                Ok(h) => {
                    let h = Arc::new(h);
                    let _ = app.emit(
                        "solomd://ai-run-started",
                        RunStartedEvent {
                            request_id: request_id.clone(),
                            run_id: h.run_id.clone(),
                        },
                    );
                    Some(h)
                }
                Err(_e) => None,
            }
        }
        _ => None,
    };

    // Persist the user prompt(s) into run.md / trace.jsonl up front so
    // partial runs are inspectable.
    if let Some(rh) = &run_handle {
        for m in &request.messages {
            if m.role == "system" {
                let _ = rh.append_trace(TraceStep {
                    kind: "prompt".to_string(),
                    role: Some("system".to_string()),
                    content: Some(m.content.clone()),
                    ..Default::default()
                });
            }
        }
        if let Some(last_user) = request
            .messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .cloned()
        {
            let _ = rh.append_trace(TraceStep {
                kind: "prompt".to_string(),
                role: Some("user".to_string()),
                content: Some(last_user.content.clone()),
                ..Default::default()
            });
            let _ = rh.append_run_md(&format!("## User\n\n{}\n\n", last_user.content));
        }
    }

    let id_for_task = request_id.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // Each provider runner now returns `(full_text, tokens_in_total,
        // tokens_out_total)` so the panel can persist real numbers into
        // meta.json + the run_ended trace step. The cost is computed
        // here with the shared pricing table — provider+model aware,
        // 0 for unknown pairs.
        let result: Result<(String, u64, u64), String> = match format.as_str() {
            "openai" => {
                run_chat_openai_loop(
                    &app_clone,
                    &id_for_task,
                    &request,
                    &api_key,
                    cancel.clone(),
                    run_handle.clone(),
                )
                .await
            }
            "anthropic" => {
                run_chat_anthropic_loop(
                    &app_clone,
                    &id_for_task,
                    &request,
                    &api_key,
                    cancel.clone(),
                    run_handle.clone(),
                )
                .await
            }
            "ollama" => {
                run_chat_ollama(&app_clone, &id_for_task, &request, cancel.clone()).await
            }
            other => Err(format!("unknown api_format: {other}")),
        };

        match &result {
            Ok((full_text, tokens_in, tokens_out)) => {
                let cost = pricing::estimate_cost_usd(
                    &request.provider,
                    &request.model,
                    *tokens_in,
                    *tokens_out,
                );
                if let Some(rh) = &run_handle {
                    let _ = rh.append_run_md(&format!("## Assistant\n\n{}\n\n", full_text));
                    let _ = rh.finish("ok", *tokens_in, *tokens_out, cost, None);
                }
                let _ = app_clone.emit(
                    "solomd://ai-done",
                    DoneEvent {
                        request_id: id_for_task.clone(),
                        full_text: full_text.clone(),
                    },
                );
            }
            Err(err) => {
                if let Some(rh) = &run_handle {
                    let status = if err == "cancelled" { "cancelled" } else { "error" };
                    // We don't have per-turn totals on the error path —
                    // the runner returned early. Persist 0/0 + 0 cost and
                    // let the user see the "error" status; partial token
                    // counts can be read from any model_done lines in the
                    // trace.jsonl if needed.
                    let _ = rh.finish(status, 0, 0, 0.0, Some(err.clone()));
                }
                let _ = app_clone.emit(
                    "solomd://ai-error",
                    ErrorEvent {
                        request_id: id_for_task.clone(),
                        error: err.clone(),
                    },
                );
            }
        }
        drop_cancel_flag(&id_for_task);
    });

    Ok(request_id)
}

/// Kicks off a streaming AI rewrite. Returns the synthetic request id; the
/// caller listens for `solomd://ai-chunk`, `solomd://ai-done`, and
/// `solomd://ai-error` events filtered by that id.
#[tauri::command]
pub async fn ai_rewrite(app: AppHandle, request: RewriteRequest) -> Result<String, String> {
    // #102 — prime the config dir so the Android encrypted-file key backend
    // can resolve its path before `read_key` runs below.
    ai_keystore::prime_config_dir(&app);
    let request_id = request
        .request_id
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(make_request_id);
    let cancel = register_cancel_flag(&request_id);

    // Resolve which wire format to use: explicit `api_format` from the
    // frontend, or the legacy `provider` value as a fallback. Apply the
    // `local` → `ollama` alias here too so Recipes (v4.0 P2) that say
    // `provider: local` work without a separate code path.
    let format = wire_format(
        &request
            .api_format
            .clone()
            .unwrap_or_else(|| request.provider.clone()),
    );

    if !provider_caps(&request.provider).supports_streaming {
        drop_cancel_flag(&request_id);
        return Err(format!(
            "{} does not support streaming responses, which this client requires",
            request.provider
        ));
    }

    // Ollama and self-hosted OpenAI-compatible servers don't need a key —
    // every hosted provider does.
    let api_key = if format == "ollama" {
        String::new()
    } else if is_keyless_provider(&request.provider) {
        read_key_for(request.key_id.as_deref(), &request.provider).unwrap_or_default()
    } else {
        match read_key_for(request.key_id.as_deref(), &request.provider) {
            Ok(k) => k,
            Err(e) => {
                drop_cancel_flag(&request_id);
                return Err(e);
            }
        }
    };

    let id_for_task = request_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = match format.as_str() {
            "openai" => run_openai(&app, &id_for_task, &request, &api_key, cancel.clone()).await,
            "anthropic" => {
                run_anthropic(&app, &id_for_task, &request, &api_key, cancel.clone()).await
            }
            "ollama" => run_ollama(&app, &id_for_task, &request, cancel.clone()).await,
            other => Err(format!("unknown api_format: {other}")),
        };

        match result {
            Ok(full_text) => {
                let _ = app.emit(
                    "solomd://ai-done",
                    DoneEvent {
                        request_id: id_for_task.clone(),
                        full_text,
                    },
                );
            }
            Err(err) => {
                let _ = app.emit(
                    "solomd://ai-error",
                    ErrorEvent {
                        request_id: id_for_task.clone(),
                        error: err,
                    },
                );
            }
        }
        drop_cancel_flag(&id_for_task);
    });

    Ok(request_id)
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

fn build_user_message(req: &RewriteRequest) -> String {
    format!("{}\n\nText:\n{}", req.user, req.selection)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // Generous timeout per request; streaming connections can be long.
        .timeout(Duration::from_secs(180))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("http client init failed: {e}"))
}

fn cancelled() -> String {
    "cancelled".to_string()
}

/// Returned by every streaming runner when the connection ends without the
/// provider's completion marker (`[DONE]`, `message_stop`, `done: true`).
///
/// This has to be an error rather than "return what we got": a dropped
/// connection a third of the way through a rewrite otherwise reaches the UI as
/// a finished answer. The partial text is deliberately not emitted — a
/// truncated rewrite silently applied to the user's document is worse than a
/// visible failure they can retry.
fn stream_ended_early(provider: &str) -> String {
    format!(
        "{provider} stream ended before the completion marker — the connection closed \
         early and the partial output was discarded. Check your network and retry."
    )
}

fn emit_chunk(app: &AppHandle, request_id: &str, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    let _ = app.emit(
        "solomd://ai-chunk",
        ChunkEvent {
            request_id: request_id.to_string(),
            chunk: chunk.to_string(),
        },
    );
}

fn emit_thought(app: &AppHandle, request_id: &str, chunk: &str) {
    if chunk.is_empty() {
        return;
    }
    let _ = app.emit(
        "solomd://ai-thought",
        ChunkEvent {
            request_id: request_id.to_string(),
            chunk: chunk.to_string(),
        },
    );
}

// --- OpenAI -----------------------------------------------------------------

async fn run_openai(
    app: &AppHandle,
    request_id: &str,
    req: &RewriteRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let base = openai_base(req.base_url.as_deref());
    // Convention: base URL already includes the version path (`/v1`,
    // `/api/v3`, `/v1beta/openai`, etc.) — same as the OpenAI SDK default.
    // The Rust side just appends `/chat/completions`.
    let url = format!("{base}/chat/completions");

    let body = serde_json::json!({
        "model": req.model,
        "stream": true,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": build_user_message(req)},
        ],
    });

    let client = http_client()?;
    let resp = with_optional_bearer(client.post(&url), api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openai request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("openai {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    // Terminal markers. `[DONE]` ends an OpenAI stream; a non-empty
    // `finish_reason` counts too, because a few OpenAI-compatible servers
    // close the connection without ever sending `[DONE]`. Neither one means
    // the connection dropped mid-answer, which used to be indistinguishable
    // from success: the runner returned whatever had arrived and the overlay
    // showed half a rewrite as if it were the whole thing.
    let mut saw_done = false;
    let mut finish_reason = String::new();
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("openai stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                // A final event can still be sitting in the buffer without its
                // terminating blank line — the server closed right after the
                // last `data:`. Give it the separator it was missing so it is
                // parsed like every other event instead of being dropped.
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        // Process complete SSE events terminated by blank line.
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            // Drop the boundary (\n\n or \r\n\r\n).
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                if payload == "[DONE]" {
                    saw_done = true;
                    break 'stream;
                }
                let json: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let choice = json.get("choices").and_then(|c| c.get(0));
                if let Some(c) = choice {
                    if let Some(reason) = c.get("finish_reason").and_then(|s| s.as_str()) {
                        if !reason.is_empty() {
                            finish_reason = reason.to_string();
                        }
                    }
                    if let Some(d) = c.get("delta") {
                        if let Some(reasoning) = d
                            .get("reasoning_content")
                            .or_else(|| d.get("reasoning"))
                            .or_else(|| d.get("thought"))
                            .and_then(|s| s.as_str())
                        {
                            if !reasoning.is_empty() {
                                emit_thought(app, request_id, reasoning);
                            }
                        }
                        if let Some(content) = d.get("content").and_then(|s| s.as_str()) {
                            if !content.is_empty() {
                                full.push_str(content);
                                emit_chunk(app, request_id, content);
                            }
                        }
                    }
                }
            }
        }
    }
    if !saw_done && finish_reason.is_empty() {
        return Err(stream_ended_early("openai"));
    }
    Ok(full)
}

/// Legacy single-turn OpenAI chat — retained for the off chance that v3.x
/// callers still hit it. v4.0's panel goes through `run_chat_openai_loop`.
#[allow(dead_code)]
async fn run_chat_openai(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let base = openai_base(req.base_url.as_deref());
    let url = format!("{base}/chat/completions");

    let messages_json: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let body = serde_json::json!({
        "model": req.model,
        "stream": true,
        "messages": messages_json,
    });

    let client = http_client()?;
    let resp = with_optional_bearer(client.post(&url), api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("openai request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("openai {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut saw_done = false;
    let mut finish_reason = String::new();
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("openai stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                if payload == "[DONE]" {
                    saw_done = true;
                    break 'stream;
                }
                let json: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let choice = json.get("choices").and_then(|c| c.get(0));
                if let Some(c) = choice {
                    if let Some(reason) = c.get("finish_reason").and_then(|s| s.as_str()) {
                        if !reason.is_empty() {
                            finish_reason = reason.to_string();
                        }
                    }
                    if let Some(d) = c.get("delta") {
                        if let Some(reasoning) = d
                            .get("reasoning_content")
                            .or_else(|| d.get("reasoning"))
                            .or_else(|| d.get("thought"))
                            .and_then(|s| s.as_str())
                        {
                            if !reasoning.is_empty() {
                                emit_thought(app, request_id, reasoning);
                            }
                        }
                        if let Some(content) = d.get("content").and_then(|s| s.as_str()) {
                            if !content.is_empty() {
                                full.push_str(content);
                                emit_chunk(app, request_id, content);
                            }
                        }
                    }
                }
            }
        }
    }
    if !saw_done && finish_reason.is_empty() {
        return Err(stream_ended_early("openai"));
    }
    Ok(full)
}

// --- Anthropic --------------------------------------------------------------

async fn run_anthropic(
    app: &AppHandle,
    request_id: &str,
    req: &RewriteRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    // One derivation shared with verification and the model probe, so the URL
    // we test is the URL we use.
    let url = anthropic_endpoint(req.base_url.as_deref(), "messages");

    let body = serde_json::json!({
        "model": req.model,
        "system": req.system,
        "messages": [
            {"role": "user", "content": build_user_message(req)},
        ],
        "stream": true,
        "max_tokens": 4096,
    });

    let client = http_client()?;
    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("anthropic {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    // `message_stop` is Anthropic's completion marker. Without it the stream
    // was cut short, and the old code returned the partial text as a finished
    // rewrite.
    let mut saw_message_stop = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("anthropic stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                // Parse a trailing event that arrived without its blank-line
                // separator before the connection closed.
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            // Anthropic SSE: `event: <type>\ndata: <json>`. We only need the
            // `data:` line; type is encoded in the JSON's `type` field too.
            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                let json: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let kind = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match kind {
                    "content_block_delta" => {
                        if let Some(text) = json
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|s| s.as_str())
                        {
                            if !text.is_empty() {
                                full.push_str(text);
                                emit_chunk(app, request_id, text);
                            }
                        }
                    }
                    "message_stop" => {
                        saw_message_stop = true;
                        break 'stream;
                    }
                    "error" => {
                        let msg = json
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("anthropic stream error");
                        return Err(msg.to_string());
                    }
                    _ => {}
                }
            }
        }
    }
    if !saw_message_stop {
        return Err(stream_ended_early("anthropic"));
    }
    Ok(full)
}

pub(crate) fn normalize_anthropic_messages(messages: &[ChatMessage]) -> Vec<Value> {
    let non_system: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    if non_system.is_empty() {
        return vec![serde_json::json!({"role": "user", "content": "Hello"})];
    }
    let mut normalized: Vec<Value> = Vec::new();
    for m in non_system {
        let is_tool = m.role == "tool";
        let role = if is_tool { "user" } else { &m.role };
        let content_val = if is_tool {
            serde_json::json!([{
                "type": "tool_result",
                "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                "content": m.content.clone(),
            }])
        } else {
            serde_json::json!(m.content)
        };

        if let Some(last) = normalized.last_mut() {
            let last_role = last.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if last_role == role && !is_tool {
                // Merge consecutive messages with the same role
                if let (Some(last_content), Some(new_content)) = (last.get_mut("content"), content_val.as_str()) {
                    if let Some(last_str) = last_content.as_str() {
                        *last_content = Value::String(format!("{last_str}\n\n{new_content}"));
                        continue;
                    }
                }
            }
        }

        // Anthropic requires the first message to have role "user"
        if normalized.is_empty() && role != "user" {
            normalized.push(serde_json::json!({
                "role": "user",
                "content": "Continue."
            }));
        }

        normalized.push(serde_json::json!({
            "role": role,
            "content": content_val,
        }));
    }

    if normalized.is_empty() {
        normalized.push(serde_json::json!({
            "role": "user",
            "content": "Hello"
        }));
    }
    normalized
}

/// Legacy single-turn Anthropic chat — retained for callers still routed
/// outside the tool-call loop. Panel goes through `run_chat_anthropic_loop`.
#[allow(dead_code)]
async fn run_chat_anthropic(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    // One derivation shared with verification and the model probe, so the URL
    // we test is the URL we use.
    let url = anthropic_endpoint(req.base_url.as_deref(), "messages");

    // Anthropic separates `system` from `messages`. Pull every system-role
    // message out of the chat history into a single concatenated system
    // string; everything else stays in `messages`.
    let system_str = req
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");
    let chat_msgs = normalize_anthropic_messages(&req.messages);

    let body = serde_json::json!({
        "model": req.model,
        "system": system_str,
        "messages": chat_msgs,
        "stream": true,
        "max_tokens": 4096,
    });

    let client = http_client()?;
    let resp = client
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("anthropic {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut saw_message_stop = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("anthropic stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                let json: serde_json::Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let kind = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match kind {
                    "content_block_delta" => {
                        if let Some(text) = json
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|s| s.as_str())
                        {
                            if !text.is_empty() {
                                full.push_str(text);
                                emit_chunk(app, request_id, text);
                            }
                        }
                    }
                    "message_stop" => {
                        // Legacy single-turn Anthropic path (dead code today —
                        // the panel and the rewrite overlay both go through the
                        // tool loop / one-turn helpers). Kept behaviourally in
                        // step with them, including the completion check.
                        saw_message_stop = true;
                        break 'stream;
                    }
                    "error" => {
                        let msg = json
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("anthropic stream error");
                        return Err(msg.to_string());
                    }
                    _ => {}
                }
            }
        }
    }
    if !saw_message_stop {
        return Err(stream_ended_early("anthropic"));
    }
    Ok(full)
}

// --- Ollama -----------------------------------------------------------------

async fn run_ollama(
    app: &AppHandle,
    request_id: &str,
    req: &RewriteRequest,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    let base = ollama_addr::base_url(req.base_url.as_deref());
    let url = format!("{base}/api/chat");

    let body = serde_json::json!({
        "model": req.model,
        "stream": true,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": build_user_message(req)},
        ],
    });

    let client = http_client()?;
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("ollama {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    // `done: true` is Ollama's completion marker. Without it the connection
    // dropped and the text so far is only part of the answer.
    let mut saw_done = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("ollama stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => eof = true,
        }
        // Ollama emits one JSON object per line.
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            let json: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(content) = json
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|s| s.as_str())
            {
                if !content.is_empty() {
                    full.push_str(content);
                    emit_chunk(app, request_id, content);
                }
            }
            if json.get("done").and_then(|b| b.as_bool()).unwrap_or(false) {
                saw_done = true;
                break 'stream;
            }
            if let Some(err) = json.get("error").and_then(|s| s.as_str()) {
                return Err(format!("ollama: {err}"));
            }
        }
    }
    if !saw_done {
        return Err(stream_ended_early("ollama"));
    }
    Ok(full)
}

pub async fn run_chat_ollama(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    cancel: Arc<AtomicBool>,
) -> Result<(String, u64, u64), String> {
    let base = ollama_addr::base_url(req.base_url.as_deref());
    let url = format!("{base}/api/chat");

    let messages_json: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let body = serde_json::json!({
        "model": req.model,
        "stream": true,
        "messages": messages_json,
    });

    let client = http_client()?;
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("ollama {status}: {txt}"));
    }

    let mut full = String::new();
    let mut buf = String::new();
    // Ollama's final `done: true` chunk carries `prompt_eval_count` (input
    // tokens consumed by the prompt + system) and `eval_count` (output
    // tokens generated). Cost lookup is 0 for ollama anyway, but we still
    // surface the counts for the trace footer + Recent Runs list.
    let mut tokens_in: u64 = 0;
    let mut tokens_out: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut saw_done = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("ollama stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => eof = true,
        }
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf = buf[nl + 1..].to_string();
            if line.is_empty() {
                continue;
            }
            let json: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(content) = json
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|s| s.as_str())
            {
                if !content.is_empty() {
                    full.push_str(content);
                    emit_chunk(app, request_id, content);
                }
            }
            // `prompt_eval_count` / `eval_count` are typically only present
            // on the final `done: true` chunk, but read them every chunk
            // and keep the latest non-zero values just in case a build
            // backports them earlier.
            if let Some(n) = json.get("prompt_eval_count").and_then(|v| v.as_u64()) {
                if n > tokens_in {
                    tokens_in = n;
                }
            }
            if let Some(n) = json.get("eval_count").and_then(|v| v.as_u64()) {
                if n > tokens_out {
                    tokens_out = n;
                }
            }
            if json.get("done").and_then(|b| b.as_bool()).unwrap_or(false) {
                saw_done = true;
                break 'stream;
            }
            if let Some(err) = json.get("error").and_then(|s| s.as_str()) {
                return Err(format!("ollama: {err}"));
            }
        }
    }
    if !saw_done {
        return Err(stream_ended_early("ollama"));
    }
    Ok((full, tokens_in, tokens_out))
}

// ---------------------------------------------------------------------------
// v4.0 — tool-call loops (Anthropic + OpenAI)
// ---------------------------------------------------------------------------

/// Single LLM turn that may emit either text-only or tool_use blocks.
/// Returned to the loop so it can decide whether to dispatch tools and
/// re-iterate.
#[derive(Debug, Default, Clone)]
struct TurnOutcome {
    text: String,
    /// `tool_use` blocks parsed from the stream. Empty when the model
    /// finished with text-only. Each entry: (tool_call_id, name, args_json).
    tool_uses: Vec<(String, String, Value)>,
    /// `stop_reason` (Anthropic) / `finish_reason` (OpenAI) verbatim.
    finish_reason: String,
    /// Provider-specific passthrough fields on the tool_call object that
    /// must be echoed back verbatim on the next turn. Today this captures
    /// Gemini's `extra_content.google.thought_signature` (its OpenAI-compat
    /// layer 400s on the next request without it). Keyed by tool_call_id;
    /// only populated by the OpenAI-format streaming parser.
    tool_extras: std::collections::HashMap<String, Value>,
    /// Usage extracted from this turn's stream end. Sum across loop
    /// iterations to get the run-level totals. Stays at 0 when the
    /// provider didn't emit a `usage` block (some self-hosted
    /// OpenAI-compat servers and older models skip it).
    tokens_in: u64,
    tokens_out: u64,
}

/// Build the Anthropic-flavored `tools: [...]` array from the requested
/// tool list. Strips write-tools when `allow_write` is false.
fn build_anthropic_tools(req: &ChatRequest) -> Value {
    let allow_write = req.allow_write.unwrap_or(false);
    // #247 — the default set has to follow `allow_write`. It used to be
    // READ_TOOLS unconditionally, and the filter below can only *remove*
    // entries, never add one — so `write_note` / `append_to_note` were never
    // offered to the model no matter what the Agent-panel toggle said. The
    // chat panel sends `tools: null`, which is exactly this branch; recipes
    // pass an explicit list and so were unaffected, which is why writing
    // worked there and only there.
    let names: Vec<String> = match &req.tools {
        Some(v) => v.clone(),
        None if allow_write => agent_tools::all_tools().iter().map(|s| s.to_string()).collect(),
        None => agent_tools::READ_TOOLS.iter().map(|s| s.to_string()).collect(),
    };
    let arr: Vec<Value> = names
        .iter()
        .filter(|n| allow_write || !agent_tools::is_write_tool(n))
        .filter_map(|n| {
            agent_tools::tool_descriptor(n).map(|(desc, schema)| {
                serde_json::json!({
                    "name": n,
                    "description": desc,
                    "input_schema": schema,
                })
            })
        })
        .collect();
    Value::Array(arr)
}

/// OpenAI-flavored tool array — wraps the same schema as
/// `{"type":"function","function":{...}}`.
fn build_openai_tools(req: &ChatRequest) -> Value {
    let allow_write = req.allow_write.unwrap_or(false);
    // #247 — the default set has to follow `allow_write`. It used to be
    // READ_TOOLS unconditionally, and the filter below can only *remove*
    // entries, never add one — so `write_note` / `append_to_note` were never
    // offered to the model no matter what the Agent-panel toggle said. The
    // chat panel sends `tools: null`, which is exactly this branch; recipes
    // pass an explicit list and so were unaffected, which is why writing
    // worked there and only there.
    let names: Vec<String> = match &req.tools {
        Some(v) => v.clone(),
        None if allow_write => agent_tools::all_tools().iter().map(|s| s.to_string()).collect(),
        None => agent_tools::READ_TOOLS.iter().map(|s| s.to_string()).collect(),
    };
    let arr: Vec<Value> = names
        .iter()
        .filter(|n| allow_write || !agent_tools::is_write_tool(n))
        .filter_map(|n| {
            agent_tools::tool_descriptor(n).map(|(desc, schema)| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": n,
                        "description": desc,
                        "parameters": schema,
                    }
                })
            })
        })
        .collect();
    Value::Array(arr)
}

/// Resolve the workspace path the loop should pass to `dispatch_tool`. We
/// need it for every tool. If the request didn't carry one, tools that
/// require workspace access fail loudly — better than silently using $CWD.
fn workspace_from_req(req: &ChatRequest) -> Option<PathBuf> {
    req.workspace
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// Trim a result Value to a string preview suitable for the trace's
/// truncated `result` field. Keeps the full JSON in memory only briefly.
fn json_preview(v: &Value) -> String {
    match serde_json::to_string(v) {
        Ok(s) => s,
        Err(_) => v.to_string(),
    }
}

// ---- Anthropic tool-call loop --------------------------------------------

pub async fn run_chat_anthropic_loop(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
    run_handle: Option<Arc<RunHandle>>,
) -> Result<(String, u64, u64), String> {
    let cap = req.tool_loop_cap.unwrap_or(8).max(1).min(20);
    let workspace = workspace_from_req(req);
    // Accumulate run-level token totals across each turn. Anthropic
    // resets `usage` per request, so summing per-turn is the right move.
    let mut tokens_in_total: u64 = 0;
    let mut tokens_out_total: u64 = 0;

    // Anthropic uses a separate `system` field. Pull system messages out.
    let system_str = req
        .messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut history: Vec<Value> = normalize_anthropic_messages(&req.messages);

    let tools = build_anthropic_tools(req);
    let tools_n = tools.as_array().map(|a| a.len() as u64).unwrap_or(0);
    let empty_tools = serde_json::json!([]);
    let mut has_written_note = false;
    let mut write_fail_count: u32 = 0;
    let mut last_text = String::new();

    for iter in 0..cap {
        if cancel.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        let current_tools = if has_written_note {
            &empty_tools
        } else {
            &tools
        };
        if let Some(rh) = &run_handle {
            let _ = rh.append_trace(TraceStep {
                kind: "model_call".to_string(),
                provider: Some("anthropic".to_string()),
                model: Some(req.model.clone()),
                messages_n: Some(history.len() as u64),
                tools_n: Some(if has_written_note { 0 } else { tools_n }),
                ..Default::default()
            });
        }
        let outcome = anthropic_one_turn(
            app,
            request_id,
            req,
            api_key,
            &system_str,
            &history,
            current_tools,
            cancel.clone(),
        )
        .await?;
        // Sum per-turn usage into the run-level totals. Anthropic returns
        // fresh numbers each turn (not cumulative) so plain addition works.
        tokens_in_total = tokens_in_total.saturating_add(outcome.tokens_in);
        tokens_out_total = tokens_out_total.saturating_add(outcome.tokens_out);
        if let Some(rh) = &run_handle {
            let _ = rh.append_trace(TraceStep {
                kind: "model_done".to_string(),
                provider: Some("anthropic".to_string()),
                model: Some(req.model.clone()),
                text: Some(outcome.text.clone()),
                finish_reason: Some(outcome.finish_reason.clone()),
                tokens_in: Some(outcome.tokens_in),
                tokens_out: Some(outcome.tokens_out),
                ..Default::default()
            });
        }
        last_text = outcome.text.clone();

        // No tool_use blocks → done.
        if outcome.tool_uses.is_empty() {
            return Ok((last_text, tokens_in_total, tokens_out_total));
        }

        // Hit cap on the *previous* iteration check — safe since cap >= 1.
        if iter + 1 >= cap {
            // Treat as final turn even though the model wanted to call a tool.
            return Ok((last_text, tokens_in_total, tokens_out_total));
        }

        // Append the assistant message verbatim (text + tool_use blocks).
        let mut assistant_blocks: Vec<Value> = Vec::new();
        if !outcome.text.is_empty() {
            assistant_blocks.push(serde_json::json!({"type":"text","text": outcome.text}));
        }
        for (id, name, args) in &outcome.tool_uses {
            assistant_blocks.push(serde_json::json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": args,
            }));
        }
        history.push(serde_json::json!({
            "role": "assistant",
            "content": assistant_blocks,
        }));

        // Dispatch each tool, append a single user message containing all
        // tool_result blocks (Anthropic's expected pairing).
        let mut result_blocks: Vec<Value> = Vec::new();
        for (id, name, args) in outcome.tool_uses.iter() {
            // Emit tool-call event.
            let _ = app.emit(
                "solomd://ai-tool-call",
                ToolCallEvent {
                    request_id: request_id.to_string(),
                    run_id: run_handle
                        .as_ref()
                        .map(|h| h.run_id.clone())
                        .unwrap_or_default(),
                    tool_call_id: id.clone(),
                    tool: name.clone(),
                    args: args.clone(),
                },
            );
            if let Some(rh) = &run_handle {
                let _ = rh.append_trace(TraceStep {
                    kind: "tool_call".to_string(),
                    tool: Some(name.clone()),
                    args: Some(args.clone()),
                    tool_call_id: Some(id.clone()),
                    ..Default::default()
                });
                let _ = rh.append_run_md(&format!(
                    "### Tool: {} {}\n\n",
                    name,
                    serde_json::to_string(args).unwrap_or_default()
                ));
            }

            let (result_value, error_str) = match &workspace {
                Some(ws) => match agent_tools::dispatch_tool(app, ws, name, args.clone()).await {
                    Ok(v) => (v, None),
                    Err(e) => (Value::String(e.clone()), Some(e)),
                },
                None => {
                    let err = "no workspace provided".to_string();
                    (Value::String(err.clone()), Some(err))
                }
            };
            if name == "patch_note" || name == "write_note" || name == "append_to_note" {
                if error_str.is_none() {
                    has_written_note = true;
                } else {
                    write_fail_count += 1;
                    if write_fail_count >= 2 {
                        has_written_note = true;
                    }
                }
            }
            let preview = json_preview(&result_value);
            // Emit tool-result event.
            let _ = app.emit(
                "solomd://ai-tool-result",
                ToolResultEvent {
                    request_id: request_id.to_string(),
                    run_id: run_handle
                        .as_ref()
                        .map(|h| h.run_id.clone())
                        .unwrap_or_default(),
                    tool_call_id: id.clone(),
                    result: result_value.clone(),
                    error: error_str.clone(),
                },
            );
            if let Some(rh) = &run_handle {
                let _ = rh.append_trace(TraceStep {
                    kind: "tool_result".to_string(),
                    tool_call_id: Some(id.clone()),
                    result: Some(preview.clone()),
                    error: error_str.clone(),
                    ..Default::default()
                });
                let body_preview: String = preview.chars().take(2048).collect();
                let _ = rh.append_run_md(&format!("```\n{}\n```\n\n", body_preview));
            }
            result_blocks.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": id,
                "content": preview,
                "is_error": error_str.is_some(),
            }));
        }
        history.push(serde_json::json!({"role": "user", "content": result_blocks}));
    }

    // Loop exited via cap. last_text is the final assistant text we got.
    Ok((last_text, tokens_in_total, tokens_out_total))
}

async fn anthropic_one_turn(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    system_str: &str,
    history: &[Value],
    tools: &Value,
    cancel: Arc<AtomicBool>,
) -> Result<TurnOutcome, String> {
    // One derivation shared with verification and the model probe, so the URL
    // we test is the URL we use.
    let url = anthropic_endpoint(req.base_url.as_deref(), "messages");

    // Build the body, dropping `tools` when the endpoint refuses them. Claude
    // models all take tools, but a user can point this provider at any
    // Anthropic-dialect base URL, and `claude-2.1`-era ids reject `tool_use`
    // outright with a 400. Mirrors what `openai_one_turn` does, because the
    // failure mode is the same: the model answers fine without tool use, so
    // one silent retry is better than a dead panel.
    let tools_offered = provider_caps(&req.provider).supports_tools
        && tools.as_array().map(|a| !a.is_empty()).unwrap_or(false);
    let build_body = |with_tools: bool| -> Value {
        let mut body = serde_json::json!({
            "model": req.model,
            "system": system_str,
            "messages": history,
            "stream": true,
            "max_tokens": 4096,
        });
        if with_tools && tools_offered {
            body["tools"] = tools.clone();
        }
        body
    };

    let client = http_client()?;
    let send_once = |body: Value| {
        let url = url.clone();
        let api_key = api_key.to_string();
        let client = client.clone();
        async move {
            let mut attempts = 0;
            loop {
                attempts += 1;
                let res = client
                    .post(&url)
                    .header("x-api-key", api_key.as_str())
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .json(&body)
                    .send()
                    .await;
                match res {
                    Ok(resp) => return Ok(resp),
                    Err(e) if attempts <= 2 && (e.is_connect() || e.is_timeout() || e.is_request()) => {
                        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        continue;
                    }
                    Err(e) => return Err(format!("anthropic request failed: {e}")),
                }
            }
        }
    };

    let mut resp = send_once(build_body(true)).await?;

    if !resp.status().is_success() {
        let status = resp.status();
        if status == reqwest::StatusCode::BAD_REQUEST && tools_offered {
            let txt = resp.text().await.unwrap_or_default();
            let lower = txt.to_lowercase();
            if lower.contains("tools")
                || lower.contains("tool_use")
                || lower.contains("tool_choice")
                || lower.contains("functions")
            {
                resp = send_once(build_body(false)).await?;
                if !resp.status().is_success() {
                    let s = resp.status();
                    let t = resp.text().await.unwrap_or_default();
                    return Err(format!("anthropic {s}: {t}"));
                }
            } else {
                return Err(format!("anthropic {status}: {txt}"));
            }
        } else {
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("anthropic {status}: {txt}"));
        }
    }

    // Block accumulators keyed by `index` from `content_block_start`.
    // Anthropic streams: content_block_start (type=text|tool_use) →
    //   content_block_delta (text_delta or input_json_delta) →
    //   content_block_stop. Final message_delta gives `stop_reason`.
    use std::collections::BTreeMap;
    #[derive(Default)]
    struct Block {
        kind: String,         // "text" or "tool_use"
        text: String,
        tool_id: String,
        tool_name: String,
        partial_json: String, // accumulator for tool_use input_json_delta
    }
    let mut blocks: BTreeMap<u64, Block> = BTreeMap::new();
    let mut stop_reason = String::new();
    // Anthropic splits usage across two events:
    //   - `message_start` carries `usage.input_tokens` (and any cache_*
    //     fields). Output_tokens here is "1" as a placeholder.
    //   - `message_delta` near the end carries the final `usage.output_tokens`.
    // We capture both. cache_read_input_tokens is folded into tokens_in if
    // present (the user paid for it on the route either way).
    let mut tokens_in: u64 = 0;
    let mut tokens_out: u64 = 0;

    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    // `message_stop` is Anthropic's completion marker — see the other runners.
    let mut saw_message_stop = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("anthropic stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                // Parse a trailing event that arrived without its blank-line
                // separator before the connection closed.
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                let json: Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let kind = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match kind {
                    "message_start" => {
                        // `message_start` payload shape:
                        //   { "type": "message_start",
                        //     "message": { ..., "usage": { "input_tokens": N,
                        //                                  "cache_read_input_tokens": K,
                        //                                  "cache_creation_input_tokens": C,
                        //                                  "output_tokens": 1 } } }
                        if let Some(usage) = json.pointer("/message/usage") {
                            let inp = usage
                                .get("input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            let cache_read = usage
                                .get("cache_read_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            let cache_create = usage
                                .get("cache_creation_input_tokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            // Anthropic bills cache_creation_input_tokens at
                            // a premium and cache_read_input_tokens at a
                            // discount, but the user's pricing table is
                            // per-token regardless — sum everything into
                            // tokens_in so downstream cost math doesn't
                            // under-count cached prefixes.
                            tokens_in = inp.saturating_add(cache_read).saturating_add(cache_create);
                        }
                    }
                    "content_block_start" => {
                        let i = json.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                        let block_v = json.get("content_block").cloned().unwrap_or(Value::Null);
                        let btype = block_v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        let mut b = Block::default();
                        b.kind = btype.to_string();
                        if btype == "tool_use" {
                            b.tool_id = block_v
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            b.tool_name = block_v
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                        }
                        blocks.insert(i, b);
                    }
                    "content_block_delta" => {
                        let i = json.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                        let delta = json.get("delta").cloned().unwrap_or(Value::Null);
                        let dtype = delta.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        let entry = blocks.entry(i).or_default();
                        if dtype == "text_delta" {
                            if let Some(t) =
                                delta.get("text").and_then(|s| s.as_str())
                            {
                                if !t.is_empty() {
                                    entry.text.push_str(t);
                                    emit_chunk(app, request_id, t);
                                }
                            }
                        } else if dtype == "thinking_delta" {
                            if let Some(t) = delta.get("thinking").and_then(|s| s.as_str()) {
                                if !t.is_empty() {
                                    emit_thought(app, request_id, t);
                                }
                            }
                        } else if dtype == "input_json_delta" {
                            if let Some(p) =
                                delta.get("partial_json").and_then(|s| s.as_str())
                            {
                                entry.partial_json.push_str(p);
                            }
                        }
                    }
                    "message_delta" => {
                        if let Some(d) = json.get("delta") {
                            if let Some(reason) = d.get("stop_reason").and_then(|s| s.as_str()) {
                                stop_reason = reason.to_string();
                            }
                        }
                        // `message_delta` is where Anthropic finalises
                        // output_tokens (sibling of `delta`, not nested
                        // inside it).
                        if let Some(usage) = json.get("usage") {
                            if let Some(n) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                                if n > tokens_out {
                                    tokens_out = n;
                                }
                            }
                        }
                    }
                    "message_stop" => {
                        // Drain into TurnOutcome after the loop. Leaving via
                        // the shared epilogue (instead of returning here) lets
                        // the EOF pass parse a trailing event that arrived
                        // without its blank-line separator.
                        saw_message_stop = true;
                        break 'stream;
                    }
                    "error" => {
                        let msg = json
                            .get("error")
                            .and_then(|e| e.get("message"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("anthropic stream error");
                        return Err(msg.to_string());
                    }
                    _ => {}
                }
            }
        }
    }

    // A stream that never reached `message_stop` was cut short. Flushing the
    // blocks here is what used to make a truncated turn look like a finished
    // one — the panel would render half an answer, or replay a half-parsed
    // tool call built from incomplete `input_json_delta` fragments.
    if !saw_message_stop {
        return Err(stream_ended_early("anthropic"));
    }

    let mut outcome = TurnOutcome::default();
    outcome.finish_reason = stop_reason;
    outcome.tokens_in = tokens_in;
    outcome.tokens_out = tokens_out;
    for (_, b) in blocks {
        match b.kind.as_str() {
            "text" => outcome.text.push_str(&b.text),
            "tool_use" => {
                let args: Value = if b.partial_json.trim().is_empty() {
                    Value::Object(Default::default())
                } else {
                    serde_json::from_str(&b.partial_json)
                        .unwrap_or(Value::String(b.partial_json.clone()))
                };
                outcome.tool_uses.push((b.tool_id, b.tool_name, args));
            }
            _ => {}
        }
    }
    Ok(outcome)
}

// ---- OpenAI tool-call loop -----------------------------------------------

pub async fn run_chat_openai_loop(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    cancel: Arc<AtomicBool>,
    run_handle: Option<Arc<RunHandle>>,
) -> Result<(String, u64, u64), String> {
    let cap = req.tool_loop_cap.unwrap_or(8).max(1).min(20);
    let workspace = workspace_from_req(req);
    // Run-level token totals — OpenAI Chat Completions resets `usage`
    // per request, so a per-turn sum is the right accounting.
    let mut tokens_in_total: u64 = 0;
    let mut tokens_out_total: u64 = 0;

    // OpenAI Chat Completions wants `messages` as flat objects with optional
    // `tool_calls` / `tool_call_id`. Build the initial array preserving any
    // tool messages from the frontend.
    let mut history: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            if m.role == "tool" {
                serde_json::json!({
                    "role": "tool",
                    "content": m.content.clone(),
                    "tool_call_id": m.tool_call_id.clone().unwrap_or_default(),
                })
            } else {
                serde_json::json!({"role": m.role, "content": m.content})
            }
        })
        .collect();

    let tools = build_openai_tools(req);
    let tools_n = tools.as_array().map(|a| a.len() as u64).unwrap_or(0);
    let empty_tools = serde_json::json!([]);
    let mut has_written_note = false;
    let mut write_fail_count: u32 = 0;
    let mut last_text = String::new();
    let mut last_tool_sig: Option<String> = None;
    let mut consecutive_duplicate_count: u32 = 0;

    for iter in 0..cap {
        if cancel.load(Ordering::SeqCst) {
            return Err(cancelled());
        }
        let current_tools = if has_written_note {
            &empty_tools
        } else {
            &tools
        };
        if let Some(rh) = &run_handle {
            let _ = rh.append_trace(TraceStep {
                kind: "model_call".to_string(),
                provider: Some("openai".to_string()),
                model: Some(req.model.clone()),
                messages_n: Some(history.len() as u64),
                tools_n: Some(if has_written_note { 0 } else { tools_n }),
                ..Default::default()
            });
        }
        let outcome = openai_one_turn(
            app,
            request_id,
            req,
            api_key,
            &history,
            current_tools,
            cancel.clone(),
        )
        .await?;
        // Sum per-turn usage; OpenAI-compat servers reset the counters
        // every request so a plain add is correct.
        tokens_in_total = tokens_in_total.saturating_add(outcome.tokens_in);
        tokens_out_total = tokens_out_total.saturating_add(outcome.tokens_out);
        if let Some(rh) = &run_handle {
            let _ = rh.append_trace(TraceStep {
                kind: "model_done".to_string(),
                provider: Some("openai".to_string()),
                model: Some(req.model.clone()),
                text: Some(outcome.text.clone()),
                finish_reason: Some(outcome.finish_reason.clone()),
                tokens_in: Some(outcome.tokens_in),
                tokens_out: Some(outcome.tokens_out),
                ..Default::default()
            });
        }
        last_text = outcome.text.clone();

        if outcome.tool_uses.is_empty() {
            return Ok((last_text, tokens_in_total, tokens_out_total));
        }
        if iter + 1 >= cap {
            return Ok((last_text, tokens_in_total, tokens_out_total));
        }

        // Loop detection: if the model calls the exact same tool with identical arguments repeatedly
        let current_sig: String = outcome
            .tool_uses
            .iter()
            .map(|(_, name, args)| format!("{}:{}", name, serde_json::to_string(args).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join(";");

        if let Some(last_sig) = &last_tool_sig {
            if *last_sig == current_sig {
                consecutive_duplicate_count += 1;
            } else {
                consecutive_duplicate_count = 0;
            }
        }
        last_tool_sig = Some(current_sig);

        // If duplicate calls happen 2+ times, force break out to prevent spinning in list_notes
        if consecutive_duplicate_count >= 2 {
            return Ok((last_text, tokens_in_total, tokens_out_total));
        }

        // Append assistant message with tool_calls. content may be empty or null.
        let tool_calls_v: Vec<Value> = outcome
            .tool_uses
            .iter()
            .map(|(id, name, args)| {
                let mut tc = serde_json::json!({
                    "id": id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string()),
                    }
                });
                if let Some(extras) = outcome.tool_extras.get(id) {
                    if let (Some(obj), Some(extras_obj)) =
                        (tc.as_object_mut(), extras.as_object())
                    {
                        for (k, v) in extras_obj {
                            obj.insert(k.clone(), v.clone());
                        }
                    }
                }
                tc
            })
            .collect();
        let assistant_msg = serde_json::json!({
            "role": "assistant",
            "content": if outcome.text.is_empty() { Value::Null } else { Value::String(outcome.text.clone()) },
            "tool_calls": tool_calls_v,
        });
        history.push(assistant_msg);

        // Dispatch each tool, append one `tool` role message per call.
        for (id, name, args) in outcome.tool_uses.iter() {
            let _ = app.emit(
                "solomd://ai-tool-call",
                ToolCallEvent {
                    request_id: request_id.to_string(),
                    run_id: run_handle
                        .as_ref()
                        .map(|h| h.run_id.clone())
                        .unwrap_or_default(),
                    tool_call_id: id.clone(),
                    tool: name.clone(),
                    args: args.clone(),
                },
            );
            if let Some(rh) = &run_handle {
                let _ = rh.append_trace(TraceStep {
                    kind: "tool_call".to_string(),
                    tool: Some(name.clone()),
                    args: Some(args.clone()),
                    tool_call_id: Some(id.clone()),
                    ..Default::default()
                });
                let _ = rh.append_run_md(&format!(
                    "### Tool: {} {}\n\n",
                    name,
                    serde_json::to_string(args).unwrap_or_default()
                ));
            }

            let (result_value, error_str) = match &workspace {
                Some(ws) => match agent_tools::dispatch_tool(app, ws, name, args.clone()).await {
                    Ok(v) => (v, None),
                    Err(e) => (Value::String(e.clone()), Some(e)),
                },
                None => {
                    let err = "no workspace provided".to_string();
                    (Value::String(err.clone()), Some(err))
                }
            };
            let mut preview = json_preview(&result_value);
            if name == "patch_note" || name == "write_note" || name == "append_to_note" {
                if error_str.is_none() {
                    has_written_note = true;
                    preview.push_str("\n\n[SYSTEM DIRECTIVE: File modification completed and physically synced to the editor. Do NOT call patch_note, write_note, or read_note again for this request. Please provide your summary of the changes to the user and finish your reply.]");
                } else {
                    write_fail_count += 1;
                    if write_fail_count >= 2 {
                        has_written_note = true;
                        preview.push_str("\n\n[SYSTEM DIRECTIVE: File modification failed multiple times. Do NOT call any more tools. Please directly explain the issue and present your suggested modifications to the user.]");
                    }
                }
            }
            if consecutive_duplicate_count >= 2 {
                has_written_note = true;
                preview.push_str("\n\n[SYSTEM DIRECTIVE: Repeated tool calls detected. Tool calls are now halted. Please synthesize your response directly to the user.]");
            } else if consecutive_duplicate_count == 1 {
                preview.push_str("\n\n[SYSTEM DIRECTIVE: You already called this tool with the exact same parameters in the previous turn. Results have already been provided above. Do NOT call this tool again with identical arguments. Please synthesize your response or use a targeted search query.]");
            }
            let _ = app.emit(
                "solomd://ai-tool-result",
                ToolResultEvent {
                    request_id: request_id.to_string(),
                    run_id: run_handle
                        .as_ref()
                        .map(|h| h.run_id.clone())
                        .unwrap_or_default(),
                    tool_call_id: id.clone(),
                    result: result_value.clone(),
                    error: error_str.clone(),
                },
            );
            if let Some(rh) = &run_handle {
                let _ = rh.append_trace(TraceStep {
                    kind: "tool_result".to_string(),
                    tool_call_id: Some(id.clone()),
                    result: Some(preview.clone()),
                    error: error_str.clone(),
                    ..Default::default()
                });
                let body_preview: String = preview.chars().take(2048).collect();
                let _ = rh.append_run_md(&format!("```\n{}\n```\n\n", body_preview));
            }
            history.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": id,
                "content": preview,
            }));
        }
    }

    Ok((last_text, tokens_in_total, tokens_out_total))
}

async fn openai_one_turn(
    app: &AppHandle,
    request_id: &str,
    req: &ChatRequest,
    api_key: &str,
    history: &[Value],
    tools: &Value,
    cancel: Arc<AtomicBool>,
) -> Result<TurnOutcome, String> {
    let base = openai_base(req.base_url.as_deref());
    let url = format!("{base}/chat/completions");

    // Bug O: build the body, omitting `stream_options` if a previous
    // request to this (provider, base_url) returned 400 because the
    // server didn't recognise the field. See STREAM_OPTIONS_UNSUPPORTED.
    let caps = provider_caps(&req.provider);
    let cache_key = stream_options_cache_key(&req.provider, &base);
    let include_stream_options = !stream_options_unsupported(&cache_key);
    let build_body = |with_options: bool| -> Value {
        let mut b = serde_json::json!({
            "model": req.model,
            "stream": true,
            "messages": history,
        });
        if with_options {
            // OpenAI-compat servers only emit the final `usage` block when
            // the client opts in via `stream_options.include_usage`. The
            // Chat Completions API has accepted this since mid-2024;
            // older self-hosted forks (older vLLM, certain SiliconFlow
            // tiers) reject it with a 400 — handled below.
            b["stream_options"] = serde_json::json!({"include_usage": true});
        }
        if caps.supports_tools && tools.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            b["tools"] = tools.clone();
        }
        b
    };

    let client = http_client()?;
    let send_once = |body: Value| {
        let url = url.clone();
        let api_key = api_key.to_string();
        let client = client.clone();
        async move {
            let mut attempts = 0;
            loop {
                attempts += 1;
                let res = with_optional_bearer(client.post(&url), &api_key)
                    .header("content-type", "application/json")
                    .json(&body)
                    .send()
                    .await;
                match res {
                    Ok(resp) => return Ok(resp),
                    Err(e) if attempts <= 2 && (e.is_connect() || e.is_timeout() || e.is_request()) => {
                        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        continue;
                    }
                    Err(e) => return Err(format!("openai request failed: {e}")),
                }
            }
        }
    };

    let mut resp = send_once(build_body(include_stream_options)).await?;

    if !resp.status().is_success() {
        let status = resp.status();
        if status == reqwest::StatusCode::BAD_REQUEST {
            let txt = resp.text().await.unwrap_or_default();
            let lower = txt.to_lowercase();
            if (lower.contains("stream_options")
                || lower.contains("include_usage")
                || lower.contains("unknown")) && include_stream_options
            {
                mark_stream_options_unsupported(&cache_key);
                resp = send_once(build_body(false)).await?;
                if !resp.status().is_success() {
                    let s = resp.status();
                    let t = resp.text().await.unwrap_or_default();
                    return Err(format!("openai {s}: {t}"));
                }
            } else if (lower.contains("tools") || lower.contains("tool_calls") || lower.contains("functions"))
                && tools.as_array().map(|a| !a.is_empty()).unwrap_or(false)
            {
                // Fallback for models/endpoints that reject the tools parameter
                let mut body_no_tools = build_body(false);
                if let Some(obj) = body_no_tools.as_object_mut() {
                    obj.remove("tools");
                }
                resp = send_once(body_no_tools).await?;
                if !resp.status().is_success() {
                    let s = resp.status();
                    let t = resp.text().await.unwrap_or_default();
                    return Err(format!("openai {s}: {t}"));
                }
            } else {
                return Err(format!("openai {status}: {txt}"));
            }
        } else {
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("openai {status}: {txt}"));
        }
    }

    // DEBUG (gemini thought_signature hunt): if the env var is set, dump
    // every raw SSE line to that file so we can see what fields Gemini's
    // OpenAI-compat layer puts on tool_call deltas. Set with:
    //   SOLOMD_OPENAI_DEBUG_DUMP=/tmp/openai-stream.log pnpm tauri dev
    let debug_dump_path: Option<std::path::PathBuf> = std::env::var("SOLOMD_OPENAI_DEBUG_DUMP")
        .ok()
        .map(std::path::PathBuf::from);

    // Streamed tool_calls come back as deltas keyed by `index`; we
    // accumulate per-index id/name + a string buffer for `arguments`.
    use std::collections::BTreeMap;
    #[derive(Default)]
    struct ToolAccum {
        id: String,
        name: String,
        arguments: String,
        /// Provider-specific passthrough fields seen on this tool_call delta
        /// (anything outside id / type / function). Gemini's OpenAI-compat
        /// layer puts `extra_content.google.thought_signature` here and
        /// requires it back on the next turn.
        extras: serde_json::Map<String, Value>,
    }
    let mut text = String::new();
    let mut tools_acc: BTreeMap<u64, ToolAccum> = BTreeMap::new();
    let mut finish_reason = String::new();
    // Most providers send `usage` as a separate top-level field on the
    // last data chunk (the one with empty choices, or a sibling of the
    // `[DONE]` chunk). DeepSeek attaches it to the last choice's chunk
    // instead. Capture both shapes and prefer the larger numbers when
    // they conflict — the totals are monotonic-non-decreasing across the
    // stream so this stays robust.
    let mut tokens_in: u64 = 0;
    let mut tokens_out: u64 = 0;

    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    let mut saw_done = false;
    let mut eof = false;
    'stream: while !eof {
        match stream.next().await {
            Some(chunk) => {
                if cancel.load(Ordering::SeqCst) {
                    return Err(cancelled());
                }
                let bytes = chunk.map_err(|e| format!("openai stream error: {e}"))?;
                buf.push_str(&String::from_utf8_lossy(&bytes));
            }
            None => {
                eof = true;
                // Parse a trailing event that arrived without its blank-line
                // separator before the connection closed.
                if !buf.trim().is_empty() {
                    buf.push_str("\n\n");
                }
            }
        }
        while let Some(idx) = find_event_boundary(&buf) {
            let event = buf[..idx].to_string();
            let after = if buf[idx..].starts_with("\r\n\r\n") {
                idx + 4
            } else {
                idx + 2
            };
            buf = buf[after..].to_string();

            for line in event.lines() {
                let line = line.trim_start();
                let payload = match line.strip_prefix("data:") {
                    Some(p) => p.trim(),
                    None => continue,
                };
                if let Some(dp) = &debug_dump_path {
                    let _ = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(dp)
                        .and_then(|mut f| {
                            use std::io::Write;
                            writeln!(f, "{payload}")
                        });
                }
                if payload == "[DONE]" {
                    // Build the outcome in the shared epilogue so the EOF pass
                    // gets to parse a trailing event too.
                    saw_done = true;
                    break 'stream;
                }
                let json: Value = match serde_json::from_str(payload) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // `usage` is emitted on the last chunk before [DONE] when
                // include_usage is set. Some providers (DeepSeek) put it on
                // the same chunk as the last delta, so we read it on every
                // payload and keep the latest non-zero numbers.
                if let Some(usage) = json.get("usage") {
                    if let Some(n) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                        if n > tokens_in {
                            tokens_in = n;
                        }
                    }
                    if let Some(n) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                        if n > tokens_out {
                            tokens_out = n;
                        }
                    }
                }
                let choice = json.get("choices").and_then(|c| c.get(0));
                if let Some(c) = choice {
                    if let Some(reason) = c.get("finish_reason").and_then(|s| s.as_str()) {
                        if !reason.is_empty() {
                            finish_reason = reason.to_string();
                        }
                    }
                    let delta = c.get("delta").cloned().unwrap_or(Value::Null);
                    if let Some(reasoning) = delta
                        .get("reasoning_content")
                        .or_else(|| delta.get("reasoning"))
                        .or_else(|| delta.get("thought"))
                        .and_then(|s| s.as_str())
                    {
                        if !reasoning.is_empty() {
                            emit_thought(app, request_id, reasoning);
                        }
                    }
                    if let Some(content) = delta.get("content").and_then(|s| s.as_str()) {
                        if !content.is_empty() {
                            text.push_str(content);
                            emit_chunk(app, request_id, content);
                        }
                    }
                    if let Some(tcs) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                        for tc in tcs {
                            let i = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
                            let entry = tools_acc.entry(i).or_default();
                            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                                if !id.is_empty() {
                                    entry.id = id.to_string();
                                }
                            }
                            if let Some(f) = tc.get("function") {
                                if let Some(n) = f.get("name").and_then(|v| v.as_str()) {
                                    if !n.is_empty() {
                                        entry.name = n.to_string();
                                    }
                                }
                                if let Some(a) = f.get("arguments").and_then(|v| v.as_str()) {
                                    entry.arguments.push_str(a);
                                }
                            }
                            // Capture any non-standard fields (Gemini's
                            // extra_content with thought_signature, future
                            // provider quirks). Last-write-wins per delta —
                            // providers tend to send these once at end-of-call.
                            if let Some(obj) = tc.as_object() {
                                for (k, v) in obj {
                                    if !matches!(k.as_str(), "index" | "id" | "type" | "function") {
                                        entry.extras.insert(k.clone(), v.clone());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // A cut connection used to yield a "successful" turn made of whatever
    // arrived — including a half-parsed tool call assembled from incomplete
    // `arguments` fragments, which the loop would then dispatch. Fail instead.
    if !saw_done && finish_reason.is_empty() {
        return Err(stream_ended_early("openai"));
    }
    let mut outcome = TurnOutcome::default();
    outcome.text = text;
    outcome.finish_reason = finish_reason;
    outcome.tokens_in = tokens_in;
    outcome.tokens_out = tokens_out;
    for (idx, t) in tools_acc {
        let call_id = if t.id.is_empty() {
            make_tool_call_id(idx)
        } else {
            t.id
        };
        let args: Value = if t.arguments.trim().is_empty() {
            Value::Object(Default::default())
        } else {
            serde_json::from_str(&t.arguments).unwrap_or(Value::String(t.arguments.clone()))
        };
        if !t.extras.is_empty() {
            outcome
                .tool_extras
                .insert(call_id.clone(), Value::Object(t.extras));
        }
        outcome.tool_uses.push((call_id, t.name, args));
    }
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/// Returns the byte index of the start of the blank-line separator that
/// terminates an SSE event, or None if no complete event is buffered yet.
/// Handles both `\n\n` and `\r\n\r\n` separators.
fn find_event_boundary(buf: &str) -> Option<usize> {
    match (buf.find("\r\n\r\n"), buf.find("\n\n")) {
        (Some(crlf), Some(lf)) => Some(crlf.min(lf)),
        (Some(crlf), None) => Some(crlf),
        (None, Some(lf)) => Some(lf),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    /// #247 — the Agent panel sends `tools: null` and relies on `allow_write`
    /// to decide the default set. It used to always start from READ_TOOLS,
    /// and the filter can only remove, so the write tools were unreachable
    /// from the chat panel however the toggle was set.
    fn req_with(allow_write: Option<bool>, tools: Option<Vec<String>>) -> super::ChatRequest {
        super::ChatRequest {
            provider: "openai".into(),
            api_format: None,
            model: "m".into(),
            messages: vec![],
            base_url: None,
            tools,
            allow_write,
            run_id: None,
            workspace: None,
            tool_loop_cap: None,
            key_id: None,
            request_id: None,
        }
    }

    #[test]
    fn normalize_openai_base_appends_the_version_path_only_when_missing() {
        // The address llama.cpp / LM Studio / vLLM print on startup.
        assert_eq!(
            super::normalize_openai_base("http://192.168.1.20:8080").as_deref(),
            Some("http://192.168.1.20:8080/v1"),
        );
        assert_eq!(
            super::normalize_openai_base("192.168.1.20:8080").as_deref(),
            Some("http://192.168.1.20:8080/v1"),
        );
        assert_eq!(
            super::normalize_openai_base("localhost:1234/v1/").as_deref(),
            Some("http://localhost:1234/v1"),
        );
        // An explicit path is the caller's business — never rewritten.
        assert_eq!(
            super::normalize_openai_base("https://api.example.com/api/v3").as_deref(),
            Some("https://api.example.com/api/v3"),
        );
        assert_eq!(
            super::normalize_openai_base(
                "https://generativelanguage.googleapis.com/v1beta/openai"
            )
            .as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        );
        // A bare public hostname is https; a bare host:port / IP is http.
        assert_eq!(
            super::normalize_openai_base("api.example.com").as_deref(),
            Some("https://api.example.com/v1"),
        );
        assert_eq!(super::normalize_openai_base("   "), None);
    }

    #[test]
    fn openai_compat_is_keyless_and_speaks_the_openai_wire_format() {
        assert!(super::is_keyless_provider("openai-compat"));
        assert!(super::is_keyless_provider("ollama"));
        assert!(super::is_keyless_provider("llama-cpp"));
        assert!(!super::is_keyless_provider("openai"));
        assert!(!super::is_keyless_provider("deepseek"));

        assert_eq!(super::resolve_provider("lmstudio"), "openai-compat");
        assert_eq!(super::resolve_provider("vllm"), "openai-compat");
        assert_eq!(super::resolve_provider("llama.cpp"), "openai-compat");
        // A provider id with no `api_format` still lands on the right runner.
        assert_eq!(super::wire_format("openai-compat"), "openai");
        assert_eq!(super::wire_format("lmstudio"), "openai");
        assert_eq!(super::wire_format("anthropic"), "anthropic");
    }

    fn tool_names(v: &serde_json::Value) -> Vec<String> {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|t| {
                        t.get("function")
                            .and_then(|f| f.get("name"))
                            .or_else(|| t.get("name"))
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn write_tools_are_offered_when_allow_write_is_on() {
        for build in [super::build_openai_tools, super::build_anthropic_tools] {
            let names = tool_names(&build(&req_with(Some(true), None)));
            assert!(
                names.iter().any(|n| n == "write_note"),
                "write_note must be offered when allow_write is true, got {names:?}"
            );
            assert!(
                names.iter().any(|n| n == "read_note"),
                "read tools must still be present, got {names:?}"
            );
        }
    }

    #[test]
    fn write_tools_stay_hidden_when_allow_write_is_off() {
        for build in [super::build_openai_tools, super::build_anthropic_tools] {
            let names = tool_names(&build(&req_with(Some(false), None)));
            assert!(
                !names.iter().any(|n| n == "write_note" || n == "append_to_note"),
                "no write tool may leak when allow_write is false, got {names:?}"
            );
            assert!(!names.is_empty(), "read tools must still be offered");
        }
    }

    #[test]
    fn an_explicit_tool_list_is_still_filtered_by_allow_write() {
        let explicit = Some(vec!["read_note".to_string(), "write_note".to_string()]);
        let names = tool_names(&super::build_openai_tools(&req_with(Some(false), explicit)));
        assert_eq!(names, vec!["read_note".to_string()]);
    }

    use super::*;

    #[test]
    fn local_aliases_to_ollama() {
        assert_eq!(resolve_provider("local"), "ollama");
    }

    #[test]
    fn other_providers_pass_through_unchanged() {
        for id in ["openai", "anthropic", "ollama", "deepseek", "qwen"] {
            assert_eq!(resolve_provider(id), id, "provider {id} should not be rewritten");
        }
    }

    /// Bug C — `ai_rewrite` must reuse a caller-provided `request_id` so
    /// the frontend can wire its event listeners BEFORE invoking the
    /// command. We can't drive the network from a unit test, so we
    /// exercise the same `unwrap_or_else(make_request_id)` selector on a
    /// constructed `RewriteRequest` and confirm the supplied id wins.
    #[test]
    fn rewrite_request_uses_caller_provided_request_id() {
        fn pick(req: &RewriteRequest) -> String {
            req.request_id
                .clone()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(make_request_id)
        }

        let with_id = RewriteRequest {
            provider: "openai".to_string(),
            api_format: Some("openai".to_string()),
            model: "gpt-4o-mini".to_string(),
            system: "s".to_string(),
            user: "u".to_string(),
            selection: "sel".to_string(),
            base_url: None,
            key_id: None,
            request_id: Some("xyz".to_string()),
        };
        assert_eq!(pick(&with_id), "xyz");

        // Empty string falls through to the generated id (treat empty as
        // "none" — matches the same rule applied to ChatRequest).
        let empty = RewriteRequest {
            request_id: Some(String::new()),
            ..with_id.clone()
        };
        let id = pick(&empty);
        assert!(id.starts_with("req-"), "expected generated id, got {id}");

        // Missing field → generated id.
        let missing = RewriteRequest {
            request_id: None,
            ..with_id
        };
        let id = pick(&missing);
        assert!(id.starts_with("req-"), "expected generated id, got {id}");
    }

    /// Bug O — the per-(provider, base_url) cache flips a server from
    /// "try with stream_options" to "skip it" after a single failure.
    #[test]
    fn stream_options_cache_marks_and_reads_back() {
        let key = stream_options_cache_key("test-provider", "http://localhost:9999");
        // OnceLock-backed sets persist for the test process; pick a key
        // that no other test touches.
        assert!(!stream_options_unsupported(&key));
        mark_stream_options_unsupported(&key);
        assert!(stream_options_unsupported(&key));
    }

    // ---- #261: verifying an endpoint with no GET /models -----------------
    //
    // Corporate gateways and some self-hosted runtimes 404 `/models` while
    // chat completions work fine. Verification used to hard-fail there,
    // which left those users unable to finish setup.

    /// Minimal OpenAI-ish endpoint: answers `/models` with `models_status`
    /// and `/chat/completions` with `chat_status`, routing on the path.
    async fn serve_openai_ish(models_status: u16, chat_status: u16) -> std::net::SocketAddr {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            for _ in 0..8 {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = [0u8; 2048];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let is_chat = req.contains("/chat/completions");
                let (status, body) = if is_chat {
                    (
                        chat_status,
                        r#"{"choices":[{"message":{"role":"assistant","content":"pong"}}]}"#,
                    )
                } else {
                    (models_status, r#"{"data":[{"id":"m1"},{"id":"m2"}]}"#)
                };
                let body = if status >= 400 {
                    r#"{"error":{"message":"Resource not found"}}"#
                } else {
                    body
                };
                let resp = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(resp.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        addr
    }

    async fn verify_against(addr: std::net::SocketAddr, model: Option<&str>) -> Result<String, String> {
        super::ai_verify_key(
            "openai-compat".into(),
            Some("k".into()),
            Some("openai".into()),
            Some(format!("http://{addr}/v1")),
            model.map(|m| m.to_string()),
            None,
        )
        .await
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn models_list_is_used_when_the_endpoint_serves_one() {
        let addr = serve_openai_ish(200, 200).await;
        let out = verify_against(addr, Some("m1")).await.expect("should verify");
        assert!(out.contains("2 models"), "got {out}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn missing_models_endpoint_falls_back_to_a_chat_ping() {
        let addr = serve_openai_ish(404, 200).await;
        let out = verify_against(addr, Some("my-model")).await.expect("should verify via ping");
        assert!(out.contains("my-model"), "got {out}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bad_key_is_still_a_failure_and_skips_the_ping() {
        let addr = serve_openai_ish(401, 200).await;
        let err = verify_against(addr, Some("m1")).await.expect_err("401 must fail");
        assert!(err.contains("401"), "got {err}");
        // The ping would have succeeded here; a 401 must not be masked by it.
        assert!(!err.contains("responded"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn both_failing_reports_both_errors() {
        let addr = serve_openai_ish(404, 400).await;
        let err = verify_against(addr, Some("m1")).await.expect_err("should fail");
        assert!(err.contains("404") && err.contains("400"), "got {err}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn no_model_configured_reports_why_it_could_not_ping() {
        let addr = serve_openai_ish(404, 200).await;
        let err = verify_against(addr, None).await.expect_err("should fail");
        assert!(err.contains("no model name"), "got {err}");
    }

    #[test]
    fn test_normalize_anthropic_messages_merges_consecutive_user() {
        use super::ChatMessage;
        let msgs = vec![
            ChatMessage { role: "system".into(), content: "sys".into(), tool_call_id: None },
            ChatMessage { role: "user".into(), content: "hello".into(), tool_call_id: None },
            ChatMessage { role: "user".into(), content: "world".into(), tool_call_id: None },
        ];
        let norm = super::normalize_anthropic_messages(&msgs);
        assert_eq!(norm.len(), 1);
        assert_eq!(norm[0]["role"], "user");
        assert_eq!(norm[0]["content"], "hello\n\nworld");
    }

    #[test]
    fn test_normalize_anthropic_messages_prepends_user_if_starts_with_assistant() {
        use super::ChatMessage;
        let msgs = vec![
            ChatMessage { role: "assistant".into(), content: "I am ready".into(), tool_call_id: None },
            ChatMessage { role: "user".into(), content: "hi".into(), tool_call_id: None },
        ];
        let norm = super::normalize_anthropic_messages(&msgs);
        assert_eq!(norm.len(), 3);
        assert_eq!(norm[0]["role"], "user");
        assert_eq!(norm[1]["role"], "assistant");
        assert_eq!(norm[2]["role"], "user");
    }

    // ---- provider capabilities, endpoints, key slots ----------------------

    #[test]
    fn capabilities_are_declared_per_provider_instead_of_probed() {
        let deepseek = super::provider_caps("deepseek");
        assert_eq!(deepseek.auth, super::AuthStrategy::Bearer);
        assert_eq!(deepseek.models, super::ModelListStrategy::OpenAi);
        assert!(deepseek.supports_tools);

        let anthropic = super::provider_caps("anthropic");
        assert_eq!(anthropic.auth, super::AuthStrategy::Anthropic);
        assert_eq!(anthropic.models, super::ModelListStrategy::Anthropic);

        let gemini = super::provider_caps("gemini");
        assert_eq!(gemini.auth, super::AuthStrategy::Google);
        assert_eq!(gemini.models, super::ModelListStrategy::Google);

        let ollama = super::provider_caps("ollama");
        assert_eq!(ollama.auth, super::AuthStrategy::None);
        assert_eq!(ollama.models, super::ModelListStrategy::Ollama);
        assert!(!ollama.supports_tools, "tools are not wired for ollama");

        // Aliases resolve first, and unknown ids land on the plain OpenAI
        // dialect — which is exactly what a self-hosted compatible server is.
        assert_eq!(super::provider_caps("lmstudio").models, super::ModelListStrategy::OpenAi);
        assert_eq!(super::provider_caps("local").models, super::ModelListStrategy::Ollama);
        assert_eq!(super::provider_caps("brand-new-vendor").auth, super::AuthStrategy::Bearer);
    }

    #[test]
    fn the_openai_compat_surface_takes_a_bearer_not_the_vendor_auth() {
        // `compat_surface_auth` exists to keep this from being re-derived from
        // `provider_caps`, which is right for the native surface and wrong for
        // the compat one.
        assert_eq!(super::compat_surface_auth(), super::AuthStrategy::Bearer);

        // Gemini is the provider where the two answers differ, and the only one
        // that was actually broken: its compat endpoint
        // (`…/v1beta/openai/models`) answers `x-goog-api-key` with
        // `400 Missing Authorization header`.
        assert_eq!(super::provider_caps("gemini").auth, super::AuthStrategy::Google);
        assert_ne!(
            super::compat_surface_auth(),
            super::provider_caps("gemini").auth,
            "the compat surface must not be authenticated the way the native one is"
        );

        // Its native surface — the one `ai_list_models` derives from
        // `ModelListStrategy::Google` — does want the Google header, and does
        // have to be reached by stripping `/openai` off the chat base.
        assert_eq!(super::provider_caps("gemini").models, super::ModelListStrategy::Google);
        assert_eq!(
            super::google_v1beta_root(Some(
                "https://generativelanguage.googleapis.com/v1beta/openai"
            )),
            "https://generativelanguage.googleapis.com/v1beta"
        );
    }

    // ---- frontend / backend capability-table agreement --------------------

    /// The frontend table the UI renders. Read at compile time so the two
    /// tables can be compared without shipping the file.
    const PROVIDERS_TS: &str = include_str!("../../src/lib/ai-providers.ts");

    /// Top-level entries of the `PROVIDERS` and `LEGACY_PROVIDERS` arrays.
    fn ts_provider_chunks() -> Vec<&'static str> {
        let mut chunks = Vec::new();
        for marker in ["export const PROVIDERS", "export const LEGACY_PROVIDERS"] {
            if let Some(start) = PROVIDERS_TS.find(marker) {
                let rest = &PROVIDERS_TS[start..];
                if let Some(end) = rest.find("\n];") {
                    let block = &rest[..end];
                    for c in block.split("\n  {") {
                        if c.contains("\n    apiFormat:") {
                            chunks.push(c);
                        }
                    }
                }
            }
        }
        chunks
    }

    fn ts_str(chunk: &str, key: &str) -> Option<String> {
        let at = chunk.find(&format!("\n    {key}:"))?;
        let after = chunk[at..].split_once(':')?.1.trim_start();
        let inner = after.strip_prefix('\'')?;
        Some(inner[..inner.find('\'')?].to_string())
    }

    fn ts_bool(chunk: &str, key: &str) -> Option<bool> {
        let at = chunk.find(&format!("\n    {key}:"))?;
        let after = chunk[at..].split_once(':')?.1.trim_start();
        if after.starts_with("true") {
            Some(true)
        } else if after.starts_with("false") {
            Some(false)
        } else {
            None
        }
    }

    /// `ai-providers.ts` and `provider_caps()` are two sources of truth for the
    /// same facts, and nothing tied them together — they agreed by coincidence.
    /// Adding a provider with, say, an `api-key` scheme to the frontend would
    /// have left the Rust fallback sending a bearer token, and the only symptom
    /// would be a 401 in one user's panel. This asserts they agree.
    #[test]
    fn the_frontend_provider_table_and_the_rust_capability_table_agree() {
        let chunks = ts_provider_chunks();
        assert!(
            chunks.len() >= 17,
            "parsed only {} providers out of ai-providers.ts — the table's \
             shape probably changed and stopped being checked",
            chunks.len()
        );

        let mut seen: Vec<String> = Vec::new();
        for chunk in chunks {
            let id = ts_str(chunk, "id").expect("provider id");
            let caps = super::provider_caps(&id);

            let auth = ts_str(chunk, "authStrategy").expect("authStrategy");
            let want_auth = match auth.as_str() {
                "bearer" => super::AuthStrategy::Bearer,
                "anthropic" => super::AuthStrategy::Anthropic,
                "google" => super::AuthStrategy::Google,
                "none" => super::AuthStrategy::None,
                other => panic!(
                    "{id}: unknown authStrategy {other:?} — `provider_caps()` \
                     needs an arm for it, or requests will 401"
                ),
            };
            assert_eq!(caps.auth, want_auth, "{id}: authStrategy");

            let models = ts_str(chunk, "modelListStrategy").expect("modelListStrategy");
            let want_models = match models.as_str() {
                "openai" => super::ModelListStrategy::OpenAi,
                "anthropic" => super::ModelListStrategy::Anthropic,
                "google" => super::ModelListStrategy::Google,
                "ollama" => super::ModelListStrategy::Ollama,
                "none" => super::ModelListStrategy::None,
                other => panic!("{id}: unknown modelListStrategy {other:?}"),
            };
            assert_eq!(caps.models, want_models, "{id}: modelListStrategy");

            assert_eq!(
                caps.supports_tools,
                ts_bool(chunk, "supportsTools").expect("supportsTools"),
                "{id}: supportsTools"
            );
            assert_eq!(
                caps.supports_streaming,
                ts_bool(chunk, "supportsStreaming").expect("supportsStreaming"),
                "{id}: supportsStreaming"
            );
            // `is_keyless_provider` also drives the legacy alias list, so this
            // is the pair that decides whether an absent key is an error.
            assert_eq!(
                super::is_keyless_provider(&id),
                ts_bool(chunk, "keyless").unwrap_or(false),
                "{id}: keyless"
            );

            seen.push(id);
        }

        // The non-OpenAI dialects are the entries a drifted table gets wrong,
        // so prove the parser reached them instead of parsing seventeen
        // similar-looking OpenAI rows.
        for id in ["anthropic", "gemini", "ollama"] {
            assert!(seen.iter().any(|s| s == id), "parser never saw {id}");
        }
    }

    #[test]
    fn key_slot_prefers_the_profile_id_and_falls_back_to_the_provider() {
        assert_eq!(super::key_slot(Some("profile-1712-ab12"), "deepseek"), "profile-1712-ab12");
        assert_eq!(super::key_slot(None, "deepseek"), "deepseek");
        // Blank counts as "not supplied", matching the rule the request-id
        // selector and the frontend both use.
        assert_eq!(super::key_slot(Some(""), "deepseek"), "deepseek");
        assert_eq!(super::key_slot(Some("   "), "deepseek"), "deepseek");
    }

    #[test]
    fn anthropic_endpoint_honours_the_configured_base_without_doubling_v1() {
        assert_eq!(
            super::anthropic_endpoint(None, "messages"),
            "https://api.anthropic.com/v1/messages"
        );
        // A custom gateway — the case the hardcoded URL used to break.
        assert_eq!(
            super::anthropic_endpoint(Some("https://gw.internal.example"), "messages"),
            "https://gw.internal.example/v1/messages"
        );
        // A base that already carries `/v1` must not become `/v1/v1`.
        assert_eq!(
            super::anthropic_endpoint(Some("https://gw.internal.example/v1"), "messages"),
            "https://gw.internal.example/v1/messages"
        );
        assert_eq!(
            super::anthropic_endpoint(Some("https://gw.internal.example/v1/"), "models"),
            "https://gw.internal.example/v1/models"
        );
    }

    #[test]
    fn google_model_list_does_not_staple_v1beta_onto_the_openai_base() {
        // Regression: the default Gemini base is the OpenAI-compatibility one,
        // and appending `/v1beta/models` to it produced
        // `…/v1beta/openai/v1beta/models`.
        assert_eq!(
            super::google_v1beta_root(Some(
                "https://generativelanguage.googleapis.com/v1beta/openai"
            )),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            super::google_v1beta_root(Some("https://generativelanguage.googleapis.com/v1beta")),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            super::google_v1beta_root(Some("https://generativelanguage.googleapis.com")),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            super::google_v1beta_root(None),
            "https://generativelanguage.googleapis.com/v1beta"
        );
        assert_eq!(
            format!(
                "{}/models",
                super::google_v1beta_root(Some(
                    "https://generativelanguage.googleapis.com/v1beta/openai"
                ))
            ),
            "https://generativelanguage.googleapis.com/v1beta/models"
        );
    }

    #[test]
    fn a_stream_cut_before_its_completion_marker_is_an_error_not_a_result() {
        let msg = super::stream_ended_early("openai");
        assert!(msg.contains("openai"), "should name the provider, got {msg}");
        assert!(
            msg.contains("completion marker"),
            "should say what was missing, got {msg}"
        );
        // It must be actionable, not just a code.
        assert!(msg.contains("retry"), "should tell the user what to do, got {msg}");
    }
}
