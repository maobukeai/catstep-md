//! MCP client — lets the built-in agent mount third-party MCP servers as
//! agent tools, alongside the ~20 built-in vault tools.
//!
//! The app has *served* MCP since v2.4 (`mcp-server/` sidecar). This module
//! is the consuming side: the user registers local MCP servers (typically
//! `npx some-mcp-server`), the tool loop lists their tools at run start,
//! offers them to the model under namespaced names, and routes calls back
//! to the owning server.
//!
//! ## Transport & lifecycle (v1)
//!
//! **stdio only** — the dominant pattern for local servers. One session per
//! server config, newline-delimited JSON-RPC 2.0 over the child's
//! stdin/stdout (the MCP stdio framing). Sessions live in a global registry
//! keyed by server id so several tool calls in one run share the process;
//! a session found dead is transparently respawned. A background reaper
//! kills connections idle for more than a couple of minutes — the static
//! registry never drops, so without the sweep the children would outlive
//! their usefulness. Runs, the connection test, and recipes can overlap,
//! so nothing ever shuts the whole registry down mid-flight. stderr is
//! discarded so a chatty server can't block on a full pipe.
//!
//! On Windows, `.cmd`/`.bat` shims (npx, uvx) cannot be spawned directly —
//! configure `cmd` with `["/c", "npx", …]` (the settings hint says so).
//!
//! ## Security model
//!
//! Running a user-configured command is arbitrary code execution *by
//! design* — the same trust model as Claude Desktop's MCP config. The
//! whole surface is gated by the settings toggle `agentMcpEnabled`
//! (default off) plus a per-server enabled flag, and the config travels
//! with each `ai_chat` request, so nothing persists outside the settings
//! store. Tool results are untrusted content and flow through the same
//! history cap (`cap_for_history`) as built-in tool results.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

/// Default per-call timeout when the server config doesn't override it.
const DEFAULT_CALL_TIMEOUT_SECS: u64 = 30;

/// MCP protocol version we announce. Servers negotiate their own back.
const PROTOCOL_VERSION: &str = "2024-11-05";

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

/// One user-registered MCP server. Persisted in the frontend settings store
/// and carried per-request in `ChatRequest::mcp_servers`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Stable slug used in tool namespacing (`mcp_<id>_<tool>`).
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Per-call timeout override (seconds).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// Streamable HTTP endpoint (e.g. `https://host/mcp`). When set, this
    /// server is reached over HTTP and `command`/`args` are ignored.
    #[serde(default)]
    pub url: Option<String>,
}

impl McpServerConfig {
    fn is_http(&self) -> bool {
        self.url.as_deref().map(|u| !u.trim().is_empty()).unwrap_or(false)
    }
}

fn default_true() -> bool {
    true
}

/// A tool advertised by an MCP server (`tools/list` result shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDef {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the arguments, verbatim from the server.
    #[serde(default)]
    pub input_schema: Value,
}

// ---------------------------------------------------------------------------
// Model-facing name mapping
// ---------------------------------------------------------------------------

/// OpenAI caps tool names at 64 chars of `[a-zA-Z0-9_-]`; Anthropic allows
/// more but we stay inside the stricter bound. Everything outside the set
/// (dots, slashes, CJK — server tool names are arbitrary) collapses to `_`.
pub fn sanitize_tool_name(server_id: &str, tool_name: &str) -> String {
    let raw = format!("mcp_{server_id}_{tool_name}");
    let sanitized: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    sanitized.chars().take(64).collect()
}

pub fn is_mcp_name(name: &str) -> bool {
    name.starts_with("mcp_")
}

/// server config id → per-call timeout. Filled when tools are listed.
static TIMEOUTS: Lazy<AsyncMutex<HashMap<String, Duration>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

/// model-facing name → (server config id, original tool name). Filled when
/// tools are listed (once per run) so dispatch needs no parsing of the
/// sanitized name — sanitization is lossy and a parsed id could be wrong.
static TOOL_ROUTES: Lazy<AsyncMutex<HashMap<String, (String, String)>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

async fn register_route(model_name: &str, server_id: &str, tool_name: &str) {
    TOOL_ROUTES
        .lock()
        .await
        .insert(model_name.to_string(), (server_id.to_string(), tool_name.to_string()));
}

async fn lookup_route(model_name: &str) -> Option<(String, String)> {
    TOOL_ROUTES.lock().await.get(model_name).cloned()
}

// ---------------------------------------------------------------------------
// Session — one stdio MCP server process
// ---------------------------------------------------------------------------

type PendingMap = Arc<AsyncMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct McpSession {
    child: tokio::process::Child,
    stdin: Arc<AsyncMutex<tokio::process::ChildStdin>>,
    pending: PendingMap,
    next_id: AtomicU64,
    initialized: AtomicBool,
}

impl McpSession {
    fn spawn(config: &McpServerConfig) -> Result<Self, String> {
        let mut cmd = tokio::process::Command::new(&config.command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        // The Windows CREATE_NO_WINDOW dance matters for visible console
        // flashes; a long-lived server process must not open one either.
        #[cfg(target_os = "windows")]
        {
            // tokio::process::Command carries creation_flags natively.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn MCP server `{}` failed: {e}", config.command))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "MCP server stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "MCP server stdout unavailable".to_string())?;

        let pending: PendingMap = Arc::new(AsyncMutex::new(HashMap::new()));
        spawn_reader(stdout, Arc::clone(&pending));

        Ok(Self {
            child,
            stdin: Arc::new(AsyncMutex::new(stdin)),
            pending,
            next_id: AtomicU64::new(0),
            initialized: AtomicBool::new(false),
        })
    }

    /// True once the handshake has completed in this session.
    fn is_initialized(&self) -> bool {
        self.initialized.load(Ordering::Acquire)
    }

    async fn send_raw(&self, msg: &Value) -> Result<(), String> {
        let line = format!("{msg}\n");
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("MCP server write failed (process exited?): {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("MCP server flush failed: {e}"))?;
        Ok(())
    }

    /// JSON-RPC request/response over the pending map.
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.send_raw(&msg).await?;
        match rx.await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(format!("MCP server dropped the response to `{method}`")),
        }
    }

    /// MCP initialize handshake + the `notifications/initialized` ack.
    async fn initialize(&self) -> Result<(), String> {
        let result = self
            .request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {
                        "name": "catstep-md",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                }),
            )
            .await?;
        // A malformed handshake result is still a talking server; we only
        // need it to not have errored. Record and ack.
        let _ = result;
        // Notification — no id, no response expected.
        self.send_raw(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }))
        .await?;
        self.initialized.store(true, Ordering::Release);
        Ok(())
    }

    async fn ensure_initialized(&self) -> Result<(), String> {
        if !self.is_initialized() {
            self.initialize().await?;
        }
        Ok(())
    }

    async fn list_tools(&self) -> Result<Vec<McpToolDef>, String> {
        self.ensure_initialized().await?;
        let result = self
            .request("tools/list", serde_json::json!({}))
            .await?;
        parse_tools_list(&result)
    }

    async fn call_tool(
        &self,
        tool: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.ensure_initialized().await?;
        let fut = self.request(
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": args }),
        );
        let result = tokio::time::timeout(timeout, fut)
            .await
            .map_err(|_| format!("MCP tool `{tool}` timed out"))??;
        tool_result_to_text(&result)
    }

    /// Best-effort liveness probe.
    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// Kill the child process. Sessions live in a static registry that
    /// never drops, so `kill_on_drop` alone never fires — explicit shutdown
    /// is the only way children get reaped.
    async fn kill(&mut self) {
        let _ = self.child.kill().await;
    }
}

fn spawn_reader(stdout: tokio::process::ChildStdout, pending: PendingMap) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue; // stray stdout noise (banners etc.) — ignore
            };
            // Requests from the server are out of scope (v1 client only).
            let Some(id) = v.get("id").and_then(|x| x.as_u64()) else {
                continue; // notification
            };
            if let Some(tx) = pending.lock().await.remove(&id) {
                if let Some(err) = v.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("MCP server error")
                        .to_string();
                    let _ = tx.send(Err(msg));
                } else {
                    let _ = tx.send(Ok(v.get("result").cloned().unwrap_or(Value::Null)));
                }
            }
        }
        // EOF — the server died; fail everything in flight.
        let mut map = pending.lock().await;
        for (_, tx) in map.drain() {
            let _ = tx.send(Err("MCP server process exited".to_string()));
        }
    });
}

// ---------------------------------------------------------------------------
// Pure response parsing (unit-tested without a live server)
// ---------------------------------------------------------------------------

/// Parse a `tools/list` result into tool definitions.
fn parse_tools_list(result: &Value) -> Result<Vec<McpToolDef>, String> {
    let arr = result
        .get("tools")
        .and_then(|t| t.as_array())
        .ok_or_else(|| "MCP tools/list response missing `tools` array".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for t in arr {
        let name = t
            .get("name")
            .and_then(|n| n.as_str())
            .ok_or_else(|| "MCP tool entry missing `name`".to_string())?;
        out.push(McpToolDef {
            name: name.to_string(),
            description: t
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string(),
            input_schema: t.get("inputSchema").cloned().unwrap_or_else(|| {
                serde_json::json!({"type": "object", "properties": {}})
            }),
        });
    }
    Ok(out)
}

/// Convert a `tools/call` result into the Value that enters model history.
/// `isError: true` becomes an Err so it flows down the existing error path
/// (and gets the `is_error` trace flag). Text content parts are joined;
/// non-text parts are noted as placeholders.
fn tool_result_to_text(result: &Value) -> Result<Value, String> {
    if result.get("isError").and_then(|b| b.as_bool()).unwrap_or(false) {
        let msg = result
            .get("content")
            .and_then(|c| c.as_array())
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_else(|| "MCP tool reported an error".to_string());
        return Err(msg);
    }
    let mut text = String::new();
    if let Some(parts) = result.get("content").and_then(|c| c.as_array()) {
        for p in parts {
            match p.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(t);
                    }
                }
                Some(other) => {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(&format!("[non-text content part: {other}]"));
                }
                None => {}
            }
        }
    }
    Ok(Value::String(text))
}

// ---------------------------------------------------------------------------
// HTTP transport (Streamable HTTP)
// ---------------------------------------------------------------------------

/// One Streamable HTTP server endpoint. No child process: the server may
/// hand us an `Mcp-Session-Id` at initialize time which rides along on
/// every later call. Responses are either a single JSON document or an
/// SSE stream — both are handled.
struct HttpMcpSession {
    endpoint: String,
    client: reqwest::Client,
    session_id: Option<String>,
    next_id: u64,
    initialized: bool,
}

impl HttpMcpSession {
    fn new(endpoint: &str) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("http client: {e}"))?;
        Ok(Self {
            endpoint: endpoint.trim().trim_end_matches('/').to_string(),
            client,
            session_id: None,
            next_id: 0,
            initialized: false,
        })
    }

    /// POST one JSON-RPC message. Returns `Ok(None)` for 202-style
    /// notification acks, `Ok(Some(v))` for a single JSON response,
    /// extracted from an SSE stream when the server chose
    /// `text/event-stream`, and captures the `Mcp-Session-Id` header when
    /// the server mints one (initialize).
    async fn post(&mut self, msg: &Value) -> Result<Option<Value>, String> {
        let mut req = self
            .client
            .post(&self.endpoint)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(msg);
        if let Some(sid) = &self.session_id {
            req = req.header("Mcp-Session-Id", sid);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("MCP HTTP request failed ({}): {e}", self.endpoint))?;
        let status = resp.status();
        if status == reqwest::StatusCode::ACCEPTED {
            return Ok(None);
        }
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            if status == reqwest::StatusCode::NOT_FOUND && self.session_id.is_some() {
                return Err("MCP HTTP session expired (404) — reconnect needed".into());
            }
            return Err(format!("MCP HTTP {status}: {body}"));
        }
        if let Some(sid) = resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            self.session_id = Some(sid.to_string());
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if content_type.contains("text/event-stream") {
            let body = resp.text().await.unwrap_or_default();
            let id = msg.get("id").and_then(|x| x.as_u64()).unwrap_or(0);
            match sse_response_for(&body, id) {
                Some(r) => r.map(Some),
                None => Err("MCP HTTP SSE stream ended without a matching response".into()),
            }
        } else {
            let body = resp.text().await.unwrap_or_default();
            let v: Value = serde_json::from_str(&body)
                .map_err(|e| format!("MCP HTTP response not JSON: {e}"))?;
            Ok(Some(v))
        }
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let resp = self.post(&msg).await?;
        let v = resp.ok_or_else(|| format!("MCP HTTP server sent no response to `{method}`"))?;
        if let Some(err) = v.get("error") {
            let m = err
                .get("message")
                .and_then(|x| x.as_str())
                .unwrap_or("MCP server error");
            return Err(m.to_string());
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn notify(&mut self, method: &str) -> Result<(), String> {
        let msg = serde_json::json!({ "jsonrpc": "2.0", "method": method });
        self.post(&msg).await.map(|_| ())
    }

    async fn initialize(&mut self) -> Result<(), String> {
        self.next_id += 1;
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": self.next_id,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "catstep-md", "version": env!("CARGO_PKG_VERSION") },
            },
        });
        let resp = self.post(&msg).await?;
        if resp.is_none() {
            return Err("MCP HTTP initialize got no response".into());
        }
        self.initialized = true;
        self.notify("notifications/initialized").await
    }
}

/// Scan an SSE body for the `data:` payload whose JSON `id` matches `id`
/// (or that carries a JSON-RPC error). Pure — unit-tested.
fn sse_response_for(body: &str, id: u64) -> Option<Result<Value, String>> {
    for line in body.lines() {
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        let msg_id = v.get("id").and_then(|x| x.as_u64());
        if msg_id == Some(id) {
            if let Some(err) = v.get("error") {
                let m = err
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("MCP server error");
                return Some(Err(m.to_string()));
            }
            return Some(Ok(v.get("result").cloned().unwrap_or(Value::Null)));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Connection enum — one live remote or local server
// ---------------------------------------------------------------------------

enum McpConn {
    // Boxed: the stdio session is much larger than the HTTP one, and the
    // enum lives behind a registry Arc where indirection costs nothing.
    Stdio(Box<McpSession>),
    Http(HttpMcpSession),
}

impl McpConn {
    async fn ensure_initialized(&mut self) -> Result<(), String> {
        match self {
            McpConn::Stdio(s) => s.ensure_initialized().await,
            McpConn::Http(h) => {
                if !h.initialized {
                    h.initialize().await?;
                }
                Ok(())
            }
        }
    }

    async fn list_tools(&mut self) -> Result<Vec<McpToolDef>, String> {
        self.ensure_initialized().await?;
        match self {
            McpConn::Stdio(s) => s.list_tools().await,
            McpConn::Http(h) => {
                let result = h.request("tools/list", serde_json::json!({})).await?;
                parse_tools_list(&result)
            }
        }
    }

    async fn call_tool(
        &mut self,
        tool: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.ensure_initialized().await?;
        match self {
            McpConn::Stdio(s) => s.call_tool(tool, args, timeout).await,
            McpConn::Http(h) => {
                let fut = h.request(
                    "tools/call",
                    serde_json::json!({ "name": tool, "arguments": args }),
                );
                let result = tokio::time::timeout(timeout, fut)
                    .await
                    .map_err(|_| format!("MCP tool `{tool}` timed out"))??;
                tool_result_to_text(&result)
            }
        }
    }

    /// Kill/terminate. Stdio kills the child; HTTP sends the session
    /// DELETE (best-effort) and resets handshake state.
    async fn kill(&mut self) {
        match self {
            McpConn::Stdio(s) => s.kill().await,
            McpConn::Http(h) => {
                if let Some(sid) = h.session_id.clone() {
                    let _ = h
                        .client
                        .delete(&h.endpoint)
                        .header("Mcp-Session-Id", sid)
                        .send()
                        .await;
                }
                h.initialized = false;
                h.session_id = None;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Registry — connections keyed by server config id
// ---------------------------------------------------------------------------

type RegistryEntry = (Arc<AsyncMutex<McpConn>>, std::time::Instant);

static REGISTRY: Lazy<AsyncMutex<HashMap<String, RegistryEntry>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

/// Kill a connection after this long without a call. The chat run is NOT
/// the lifetime unit — panel chats, recipes and the connection test can
/// overlap, so a global shutdown at run end would yank servers out from
/// under concurrent runs (the e2e suite caught exactly this race).
const IDLE_TTL: Duration = Duration::from_secs(120);
/// How often the reaper sweeps.
const REAPER_INTERVAL: Duration = Duration::from_secs(30);

fn start_idle_reaper() {
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(REAPER_INTERVAL);
        tick.tick().await; // first tick fires immediately — nothing to reap yet
        loop {
            tick.tick().await;
            let mut reg = REGISTRY.lock().await;
            let expired: Vec<String> = reg
                .iter()
                .filter(|(_, (_, used))| used.elapsed() > IDLE_TTL)
                .map(|(id, _)| id.clone())
                .collect();
            for id in expired {
                if let Some((conn, _)) = reg.remove(&id) {
                    conn.lock().await.kill().await;
                }
                TOOL_ROUTES.lock().await.retain(|_, (sid, _)| sid != &id);
                TIMEOUTS.lock().await.remove(&id);
            }
        }
    });
}

async fn get_or_spawn_session(config: &McpServerConfig) -> Result<Arc<AsyncMutex<McpConn>>, String> {
    start_idle_reaper();
    let mut reg = REGISTRY.lock().await;
    if let Some((existing, used)) = reg.get_mut(&config.id) {
        // Reuse unless the process died underneath us (HTTP connections
        // are always considered alive — a dead server errors on call and
        // is dropped there).
        let dead = {
            let mut conn = existing.lock().await;
            match &mut *conn {
                McpConn::Stdio(s) => !s.is_alive(),
                McpConn::Http(_) => false,
            }
        };
        if !dead {
            *used = std::time::Instant::now();
            return Ok(Arc::clone(existing));
        }
        reg.remove(&config.id);
    }
    let conn = if config.is_http() {
        let url = config.url.as_deref().unwrap_or_default();
        McpConn::Http(HttpMcpSession::new(url).map_err(|e| format!("server `{}`: {e}", config.id))?)
    } else {
        McpConn::Stdio(Box::new(
            McpSession::spawn(config).map_err(|e| format!("server `{}`: {e}", config.id))?,
        ))
    };
    let conn = Arc::new(AsyncMutex::new(conn));
    reg.insert(config.id.clone(), (Arc::clone(&conn), std::time::Instant::now()));
    Ok(conn)
}

async fn drop_session(server_id: &str) {
    REGISTRY.lock().await.remove(server_id);
}

fn touch_session(server_id: &str) {
    if let Ok(mut reg) = REGISTRY.try_lock() {
        if let Some((_, used)) = reg.get_mut(server_id) {
            *used = std::time::Instant::now();
        }
    }
}

/// Kill every live session and clear the routing tables. Called when a
/// chat run (or connection test) that used MCP finishes — sessions are
/// deliberately not kept warm across runs, because a static registry
/// never drops and the children would outlive the app's usefulness.
/// Kill every connection and clear the routing tables. Not used on the
/// normal path (the idle reaper owns the lifecycle, and concurrent runs
/// share the registry) — this is the e2e suite's cleanup and the reserved
/// hook for an app-exit handler.
#[allow(dead_code)]
pub async fn shutdown_all() {
    let mut reg = REGISTRY.lock().await;
    for (_, (conn, _)) in reg.drain() {
        conn.lock().await.kill().await;
    }
    TOOL_ROUTES.lock().await.clear();
    TIMEOUTS.lock().await.clear();
}

/// List a server's tools (spawning + handshaking if needed), registering the
/// model-facing route for each. Called by the tool loop once per run.
pub async fn list_server_tools(config: &McpServerConfig) -> Result<Vec<(String, McpToolDef)>, String> {
    let conn = get_or_spawn_session(config).await?;
    touch_session(&config.id);
    let listed = {
        let mut c = conn.lock().await;
        c.list_tools().await
    };
    if let Err(e) = listed {
        // A broken/handshake-failing server poisons the session — drop it so
        // the next attempt starts from a fresh process.
        drop_session(&config.id).await;
        return Err(e);
    }
    let listed = listed.unwrap();
    TIMEOUTS.lock().await.insert(
        config.id.clone(),
        Duration::from_secs(config.timeout_secs.unwrap_or(DEFAULT_CALL_TIMEOUT_SECS)),
    );
    let mut out = Vec::with_capacity(listed.len());
    for def in listed {
        let model_name = sanitize_tool_name(&config.id, &def.name);
        register_route(&model_name, &config.id, &def.name).await;
        out.push((model_name, def));
    }
    Ok(out)
}

/// Route a model tool call to its server. `model_name` must have been
/// registered by `list_server_tools` earlier in the same run.
pub async fn dispatch(model_name: &str, args: Value) -> Result<Value, String> {
    let Some((server_id, tool)) = lookup_route(model_name).await else {
        return Err(format!("unknown MCP tool `{model_name}`"));
    };
    let timeout = TIMEOUTS
        .lock()
        .await
        .get(&server_id)
        .copied()
        .unwrap_or_else(|| Duration::from_secs(DEFAULT_CALL_TIMEOUT_SECS));
    let conn = {
        let reg = REGISTRY.lock().await;
        reg.get(&server_id).map(|(c, _)| Arc::clone(c))
    };
    let Some(conn) = conn else {
        return Err(format!("MCP server `{server_id}` is not connected"));
    };
    touch_session(&server_id);
    let call = {
        let mut c = conn.lock().await;
        c.call_tool(&tool, args, timeout).await
    };
    if call.is_err() {
        // Process-level failures (write failed / dropped response) poison the
        // session; drop it so the next call respawns. Tool-level errors
        // (isError=true) keep the session.
        let err = call.clone().err().unwrap();
        if err.contains("process exited") || err.contains("write failed") {
            drop_session(&server_id).await;
        }
    }
    call
}

/// Test command for the settings UI: connect + list, return model-facing
/// tool names. Also warms the session.
#[tauri::command]
pub async fn mcp_test_server(config: McpServerConfig) -> Result<Vec<String>, String> {
    if config.id.trim().is_empty() {
        return Err("server id is required".into());
    }
    if config.command.trim().is_empty() {
        return Err("command is required".into());
    }
    let tools = list_server_tools(&config).await?;
    // The connection test's session is reaped by the idle reaper like any
    // other — a global shutdown here would hit concurrent chat runs.
    Ok(tools.into_iter().map(|(name, _)| name).collect())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_produces_openai_safe_names() {
        // Allowed charset passes through with the mcp_ prefix.
        assert_eq!(
            sanitize_tool_name("fetch", "get_page"),
            "mcp_fetch_get_page"
        );
        // Dots, slashes, colons and non-ASCII collapse to underscores.
        assert_eq!(
            sanitize_tool_name("my.server", "docs/read"),
            "mcp_my_server_docs_read"
        );
        // 9 chars (mcp_ + 2 + _ + 2), every non-ASCII one becomes an underscore.
        assert_eq!(sanitize_tool_name("笔记", "搜索"), "mcp______");
        // OpenAI's 64-char cap is enforced.
        let long = sanitize_tool_name(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        assert!(long.chars().count() <= 64);
        assert!(long.starts_with("mcp_"));
    }

    #[test]
    fn parse_tools_list_reads_and_defaults() {
        let v: Value = serde_json::json!({
            "tools": [
                {"name": "search", "description": "Search the web",
                 "inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}}},
                {"name": "no_schema"}
            ]
        });
        let tools = parse_tools_list(&v).expect("valid");
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name, "search");
        assert_eq!(tools[0].description, "Search the web");
        assert_eq!(tools[1].input_schema["type"], "object", "missing schema defaults to empty object");

        assert!(parse_tools_list(&serde_json::json!({})).is_err());
    }

    #[test]
    fn tool_results_become_text_and_errors() {
        // Text parts join; isError routes to Err.
        let ok: Value = serde_json::json!({
            "content": [
                {"type": "text", "text": "line one"},
                {"type": "text", "text": "line two"},
                {"type": "image", "data": "..."}
            ]
        });
        let out = tool_result_to_text(&ok).expect("ok result");
        assert_eq!(
            out,
            Value::String("line one\nline two\n[non-text content part: image]".into())
        );

        let err: Value = serde_json::json!({
            "isError": true,
            "content": [{"type": "text", "text": "boom"}]
        });
        assert_eq!(tool_result_to_text(&err).unwrap_err(), "boom");

        // Content-less result still yields a string, not an object.
        let empty = tool_result_to_text(&serde_json::json!({})).expect("empty ok");
        assert_eq!(empty, Value::String(String::new()));
    }

    #[test]
    fn sse_response_picks_the_matching_id() {
        let body = concat!(
            "event: message
",
            r#"data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}"#,
            "

",
            "data: not json

",
        );
        let out = sse_response_for(body, 7).expect("found").expect("ok result");
        assert_eq!(out["ok"], serde_json::json!(true));
        // No matching id -> None.
        assert!(sse_response_for(body, 9).is_none());
        // Error payload surfaces as Err.
        let err_body = r#"data: {"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"nope"}}"#;
        assert_eq!(sse_response_for(err_body, 3).unwrap().unwrap_err(), "nope");
    }

    #[test]
    fn mcp_names_are_recognized_by_prefix() {
        assert!(is_mcp_name("mcp_fetch_get_page"));
        assert!(!is_mcp_name("read_note"));
        assert!(!is_mcp_name("mcp")); // exact "mcp" is not a namespaced tool
    }
}
