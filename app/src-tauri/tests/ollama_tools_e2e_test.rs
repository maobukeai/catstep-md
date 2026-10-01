//! Ollama tool-loop e2e (Linux CI only — see the cfg note below).

#![cfg(not(target_os = "windows"))]
#![allow(dead_code)]

use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use app_lib::ai_proxy::{run_chat_ollama, ChatMessage, ChatRequest};
use serde_json::json;

const OLLAMA_SCRIPT: &str = r#"
const http = require('http');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    const send = (obj) => res.write(JSON.stringify(obj) + '\n');
    const hasToolResult = msg.messages.some((m) => m.role === 'tool');
    if (hasToolResult) {
      send({ model: 'test', created_at: 'now',
             message: { role: 'assistant', content: 'Vault check complete.' }, done: false });
      send({ model: 'test', created_at: 'now',
             message: { role: 'assistant', content: '' }, done: true,
             done_reason: 'stop', prompt_eval_count: 10, eval_count: 6 });
    } else {
      send({ model: 'test', created_at: 'now',
             message: { role: 'assistant', content: 'Let me check. ' }, done: false });
      send({ model: 'test', created_at: 'now',
             message: { role: 'assistant', content: '',
                        tool_calls: [{ function: { name: 'list_notes', arguments: {} } }] },
             done: false });
      send({ model: 'test', created_at: 'now',
             message: { role: 'assistant', content: '' }, done: true,
             done_reason: 'stop', prompt_eval_count: 12, eval_count: 9 });
    }
    res.end();
  });
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT:' + server.address().port + '\n');
});
"#;

fn node_available() -> bool {
    std::process::Command::new("node")
        .arg("--version")
        .output()
        .is_ok()
}

// The tauri "test" feature's mock runtime fails DLL load on Windows
// (STATUS_ENTRYPOINT_NOT_FOUND), so the full-loop e2e runs on Linux CI
// only; the wire format itself is covered cross-platform by the
// absorb_ollama_chunk unit tests in ai_proxy.
#[cfg(not(target_os = "windows"))]
#[tokio::test]
async fn ollama_tool_loop_round_trips_a_real_server() {
    if !node_available() {
        eprintln!("node not on PATH — skipping ollama tool loop e2e test");
        return;
    }

    // Node fake Ollama — panic-safe reaper, same pattern as the MCP suite.
    use std::process::{Command, Stdio};
    let mut child = Command::new("node")
        .arg("-e")
        .arg(OLLAMA_SCRIPT)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn node fake ollama");
    struct Reaper(std::process::Child);
    impl Drop for Reaper {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut reaper = Reaper(child);
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

    // Temp vault with one note so list_notes has something to find.
    let tmp = std::env::temp_dir().join(format!(
        "solomd-ollama-e2e-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join("note-a.md"), "# A\n\nhello\n").unwrap();

    let app = tauri::test::mock_app();
    let handle = app.handle().clone();

    let req = ChatRequest {
        provider: "ollama".into(),
        api_format: Some("ollama".into()),
        model: "test-model".into(),
        messages: vec![ChatMessage {
            role: "user".into(),
            content: "list the notes".into(),
            tool_call_id: None,
            images: None,
        }],
        base_url: Some(format!("http://127.0.0.1:{port}")),
        tools: None,
        allow_write: Some(false),
        run_id: None,
        workspace: Some(tmp.to_string_lossy().to_string()),
        tool_loop_cap: None,
        key_id: None,
        request_id: None,
        mcp_servers: None,
    };

    let cancel = Arc::new(AtomicBool::new(false));
    let (text, tokens_in, tokens_out) = tokio::time::timeout(
        Duration::from_secs(30),
        run_chat_ollama(&handle, "e2e-req", &req, cancel, None),
    )
    .await
    .expect("loop within timeout")
    .expect("loop ok");

    // Final turn's text, and token totals summed across BOTH turns.
    assert_eq!(text, "Vault check complete.");
    assert_eq!(tokens_in, 22, "12 (tool turn) + 10 (final turn)");
    assert_eq!(tokens_out, 15, "9 (tool turn) + 6 (final turn)");

    std::fs::remove_dir_all(&tmp).ok();
}
