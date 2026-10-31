//! Real provider loops against a deliberately noncompliant local model endpoint.
//! A schema is not an authorization boundary: each returned call must be checked.
use app_lib::ai_proxy::{self, ChatMessage, ChatRequest};
use serde_json::{json, Value};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn response(protocol: &str, first: bool) -> String {
    let args = json!({"path":"target.md", "content":"MODEL CONTENT", "allow_overwrite":true});
    let frames = match protocol {
        "ollama" => vec![json!({"message": if first {
            json!({"role":"assistant","content":"","tool_calls":[{"function":{"name":"write_note","arguments":args}}]})
        } else { json!({"role":"assistant","content":"Done"}) }, "done":true})],
        "anthropic" => {
            if first {
                vec![
                    json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call1","name":"write_note","input":{}}}),
                    json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":args.to_string()}}),
                    json!({"type":"message_delta","delta":{"stop_reason":"tool_use"}}),
                    json!({"type":"message_stop"}),
                ]
            } else {
                vec![
                    json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
                    json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}),
                    json!({"type":"message_delta","delta":{"stop_reason":"end_turn"}}),
                    json!({"type":"message_stop"}),
                ]
            }
        }
        _ => vec![json!({"choices":[{"delta": if first {
            json!({"tool_calls":[{"index":0,"id":"call1","type":"function","function":{"name":"write_note","arguments":args.to_string()}}]})
        } else { json!({"content":"Done"}) }, "finish_reason":if first { "tool_calls" } else { "stop" }}]})],
    };
    let mut body: String = frames
        .into_iter()
        .map(|f| {
            if protocol == "ollama" {
                format!("{f}\n")
            } else {
                format!("data: {f}\n\n")
            }
        })
        .collect();
    if protocol == "openai" {
        body.push_str("data: [DONE]\n\n");
    }
    body
}

async fn fake_model(protocol: &'static str) -> (String, tokio::task::JoinHandle<Vec<Value>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for first in [true, false] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let header_end = loop {
                let mut chunk = [0; 4096];
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                buf.extend_from_slice(&chunk[..n]);
                if let Some(i) = buf.windows(4).position(|v| v == b"\r\n\r\n") {
                    break i + 4;
                }
            };
            let length: usize = String::from_utf8_lossy(&buf[..header_end])
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse().unwrap())
                })
                .unwrap();
            while buf.len() < header_end + length {
                let mut chunk = [0; 4096];
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                buf.extend_from_slice(&chunk[..n]);
            }
            requests.push(serde_json::from_slice(&buf[header_end..header_end + length]).unwrap());
            let body = response(protocol, first);
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", if protocol == "ollama" { "application/x-ndjson" } else { "text/event-stream" }, body.len());
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(body.as_bytes()).await.unwrap();
            socket.shutdown().await.unwrap();
        }
        requests
    });
    (base, task)
}

#[tokio::test]
async fn all_provider_loops_enforce_request_permissions_before_writing() {
    struct Events;
    impl ai_proxy::AiEventSink for Events {
        fn emit_ai<S: serde::Serialize + Clone>(&self, _: &str, _: S) -> Result<(), String> {
            Ok(())
        }
    }
    let app = Events;
    for protocol in ["openai", "anthropic", "ollama"] {
        for (allow_write, explicit_tool, permitted) in [
            (false, None, false),
            (true, Some("read_note"), false),
            (true, Some("write_note"), true),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let target = dir.path().join("target.md");
            std::fs::write(&target, "ORIGINAL").unwrap();
            let (base, server) = fake_model(protocol).await;
            let req = ChatRequest {
                provider: protocol.into(),
                api_format: Some(protocol.into()),
                model: "fake".into(),
                messages: vec![ChatMessage {
                    role: "user".into(),
                    content: "Read only".into(),
                    tool_call_id: None,
                    images: None,
                }],
                base_url: Some(base),
                tools: explicit_tool.map(|name| vec![name.into()]),
                allow_write: Some(allow_write),
                run_id: None,
                workspace: Some(dir.path().to_string_lossy().into()),
                active_note_path: None,
                open_notes: None,
                active_selection: None,
                tool_loop_cap: Some(3),
                key_id: None,
                request_id: None,
                mcp_servers: None,
            };
            let cancel = Arc::new(AtomicBool::new(false));
            let result = tokio::time::timeout(Duration::from_secs(10), async {
                match protocol {
                    "openai" => {
                        ai_proxy::run_chat_openai_loop(
                            &app,
                            "authorization-test",
                            &req,
                            "fake",
                            cancel,
                            None,
                        )
                        .await
                    }
                    "anthropic" => {
                        ai_proxy::run_chat_anthropic_loop(
                            &app,
                            "authorization-test",
                            &req,
                            "fake",
                            cancel,
                            None,
                        )
                        .await
                    }
                    _ => {
                        ai_proxy::run_chat_ollama(&app, "authorization-test", &req, cancel, None)
                            .await
                    }
                }
            })
            .await
            .expect("bounded model loop")
            .expect("loop returns tool refusal to model");
            assert_eq!(result.0, "Done", "{protocol}");
            assert_eq!(
                std::fs::read_to_string(&target).unwrap(),
                if permitted {
                    "MODEL CONTENT"
                } else {
                    "ORIGINAL"
                },
                "{protocol} allow_write={allow_write}"
            );
            let requests = server.await.unwrap();
            assert_eq!(
                requests[1]["messages"]
                    .to_string()
                    .contains("was not offered for this request"),
                !permitted,
                "{protocol}: {}",
                requests[1]
            );
            assert_eq!(
                dir.path().join(".backup").exists(),
                permitted,
                "only authorized writes create backups"
            );
        }
    }
}
