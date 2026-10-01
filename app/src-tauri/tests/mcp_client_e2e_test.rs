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
    }
}

#[tokio::test]
async fn mcp_client_round_trips_a_real_server() {
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
