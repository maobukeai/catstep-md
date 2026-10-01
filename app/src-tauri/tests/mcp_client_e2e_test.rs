//! End-to-end test for the MCP client: spawns a real minimal MCP stdio
//! server (a ~30-line Node script written to a temp dir) and exercises the
//! full chain — spawn, initialize handshake, tools/list, tools/call —
//! through the same `list_server_tools` / `dispatch` entry points the agent
//! tool loop uses.
//!
//! Skipped silently when `node` is not on PATH (the same env-gating style
//! as the network-dependent suites).

use std::time::Duration;

use app_lib::mcp_client::{self, McpServerConfig};
use serde_json::json;

const SERVER_SCRIPT: &str = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const tools = [{
  name: 'echo',
  description: 'Echo the given text back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
}];
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // notification — no response
  let result;
  if (msg.method === 'initialize') {
    result = { protocolVersion: '2024-11-05', capabilities: { tools: {} },
               serverInfo: { name: 'test-server', version: '0.0.1' } };
  } else if (msg.method === 'tools/list') {
    result = { tools };
  } else if (msg.method === 'tools/call') {
    result = { content: [{ type: 'text', text: 'echo:' + (msg.params.arguments.text || '') }],
               isError: false };
  } else {
    result = {};
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
});
"#;

fn node_available() -> bool {
    std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_ok()
}

fn test_config(script_path: &std::path::Path) -> McpServerConfig {
    McpServerConfig {
        id: "test".into(),
        command: "node".into(),
        args: vec![script_path.to_string_lossy().to_string()],
        env: Default::default(),
        enabled: true,
        timeout_secs: Some(15),
        url: None,
        headers: Default::default(),
    }
}

async fn stdio_flow() {
    if !node_available() {
        eprintln!("node not on PATH — skipping mcp_client e2e test");
        return;
    }
    let dir = std::env::temp_dir().join(format!(
        "solomd-mcp-e2e-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("mcp-test-server.cjs");
    std::fs::write(&script, SERVER_SCRIPT).unwrap();

    let cfg = test_config(&script);

    // list → spawn + handshake + tools/list + route registration.
    let listed = tokio::time::timeout(
        Duration::from_secs(20),
        mcp_client::list_server_tools(&cfg),
    )
    .await
    .expect("list within timeout")
    .expect("list ok");
    assert_eq!(listed.len(), 1);
    let (model_name, def) = &listed[0];
    assert_eq!(model_name, "mcp_test_echo", "namespaced tool name");
    assert_eq!(def.name, "echo");
    assert_eq!(def.description, "Echo the given text back");

    // call → route lookup + tools/call + text flattening.
    let out = tokio::time::timeout(
        Duration::from_secs(20),
        mcp_client::dispatch("mcp_test_echo", json!({ "text": "hi" })),
    )
    .await
    .expect("call within timeout")
    .expect("call ok");
    assert_eq!(out, json!("echo:hi"));

    // Unknown MCP name fails with the registry error, not a hang.
    let err = mcp_client::dispatch("mcp_test_nonexistent", json!({}))
        .await
        .expect_err("unknown tool must error");
    assert!(err.contains("unknown MCP tool"), "got: {err}");

    // Reap the spawned server — the registry is static, so without this
    // the node child would outlive the test and hang cargo's pipes.
    mcp_client::shutdown_all().await;

    let _ = std::fs::remove_dir_all(&dir);
}

const HTTP_SERVER_SCRIPT: &str = r#"
const http = require('http');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    const sid = req.headers['mcp-session-id'];
    if (msg.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-e2e-1' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'http-test', version: '0.0.1' } } }));
      return;
    }
    if (sid !== 'sess-e2e-1') { res.writeHead(404); res.end('no session'); return; }
    if (msg.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (req.headers['x-api-key'] !== 'secret123') { res.writeHead(401); res.end('bad key'); return; }
    if (msg.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
        { name: 'echo', description: 'Echo text over HTTP',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } } } ] } }));
      return;
    }
    if (msg.method === 'tools/call') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
        content: [{ type: 'text', text: 'http-echo:' + (msg.params.arguments.text || '') }],
        isError: false } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
  });
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT:' + server.address().port + '\n');
});
// Keep stderr quiet; the client discards it anyway.
"#;

async fn http_flow() {
    if !node_available() {
        eprintln!("node not on PATH — skipping mcp_client http e2e test");
        return;
    }
    use std::process::{Command, Stdio};
    let child = Command::new("node")
        .arg("-e")
        .arg(HTTP_SERVER_SCRIPT)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn node http server");
    // Panic-safe reaper: if any assert below fails, the node server must
    // still die — a surviving child holds the output pipe open and hangs
    // the whole cargo/grep pipeline (observed in practice).
    struct Reaper(std::process::Child);
    impl Drop for Reaper {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut reaper = Reaper(child);
    // Read the port line.
    use std::io::BufRead;
    let stdout = reaper.0.stdout.take().unwrap();
    let mut reader = std::io::BufReader::new(stdout);
    let mut port_line = String::new();
    reader.read_line(&mut port_line).expect("port line");
    let port: u16 = port_line
        .trim()
        .strip_prefix("PORT:")
        .expect("PORT: prefix")
        .parse()
        .expect("port number");

    let cfg = McpServerConfig {
        id: "httptest".into(),
        command: String::new(),
        args: vec![],
        env: Default::default(),
        enabled: true,
        timeout_secs: Some(10),
        url: Some(format!("http://127.0.0.1:{port}/mcp")),
        headers: [("x-api-key".to_string(), "secret123".to_string())]
            .into_iter()
            .collect(),
    };

    // list → initialize (captures Mcp-Session-Id) + tools/list.
    let listed = tokio::time::timeout(
        Duration::from_secs(20),
        mcp_client::list_server_tools(&cfg),
    )
    .await
    .expect("list within timeout")
    .expect("list ok");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].0, "mcp_httptest_echo");
    assert_eq!(listed[0].1.description, "Echo text over HTTP");

    // call → session id rides along (server 404s without it).
    let out = tokio::time::timeout(
        Duration::from_secs(20),
        mcp_client::dispatch("mcp_httptest_echo", json!({ "text": "hi" })),
    )
    .await
    .expect("call within timeout")
    .expect("call ok");
    assert_eq!(out, json!("http-echo:hi"));

    mcp_client::shutdown_all().await;
}

/// One sequential test: both flows share the global session registry and
/// route maps, so running them in parallel (cargo's default) lets one
/// flow's shutdown_all yank the other's session mid-test. Sequential with
/// explicit cleanup between the flows is deterministic.
#[tokio::test]
async fn mcp_transports_round_trip_real_servers() {
    stdio_flow().await;
    http_flow().await;
}
