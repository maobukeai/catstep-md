#[tokio::main]
async fn main() {
    let make = |id: &str, label: &str| McpServerConfig {
        id: id.to_string(), command: "node".to_string(),
        args: vec!["-e".into(), format!(r#"const rl=require('readline').createInterface({{input:process.stdin}});rl.on('line',s=>{{let m=JSON.parse(s);if(m.id===undefined)return;let result=m.method==='initialize'?{{protocolVersion:'2024-11-05',capabilities:{{}}}}:m.method==='tools/list'?{{tools:[{{name:'read.note',inputSchema:{{type:'object'}}}},{{name:'read_note',inputSchema:{{type:'object'}}}}]}}:{{content:[{{type:'text',text:'{label}:'+m.params.name}}]}};process.stdout.write(JSON.stringify({{jsonrpc:'2.0',id:m.id,result}})+'\n')}});"#)],
        env: HashMap::new(), enabled: true, timeout_secs: Some(1), url: None, headers: HashMap::new(),
    };
    let config = make("audit", "A");
    let defs = list_server_tools(&config).await.unwrap();
    println!("NAMES={:?}", defs.iter().map(|(n,_)| n).collect::<Vec<_>>());
    println!("FIRST_DISPATCH={}", dispatch(&defs[0].0, serde_json::json!({})).await.unwrap());
    let updated = make("audit", "B");
    let updated_defs = list_server_tools(&updated).await.unwrap();
    println!("AFTER_CONFIG_UPDATE={}", dispatch(&updated_defs[0].0, serde_json::json!({})).await.unwrap());
    let mut silent = make("silent", "X");
    silent.args = vec!["-e".into(), "process.stdin.resume()".into()];
    let t = std::time::Instant::now();
    let r = tokio::time::timeout(Duration::from_millis(1600), list_server_tools(&silent)).await;
    println!("CONFIG_TIMEOUT_1SEC_ACTUAL={:?}; OUTER_TIMEOUT={}", t.elapsed(), r.is_err());
    shutdown_all().await;
}

