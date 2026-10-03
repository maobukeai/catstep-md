//! v4.0 pillar 1 — agent_tools integration tests.
//!
//! Drives `dispatch_tool_inner` against a real on-disk workspace so the
//! C3.1 contract surface (list_notes, read_note, search, write_note,
//! get_outline, get_backlinks, list_tags, append_to_note) is exercised
//! end-to-end without mocking the filesystem.
//!
//! Self-test obligation per /tmp/solomd-v4-contracts.md C7: this test is the
//! Rust integration test the panel agent ships with.

use app_lib::agent_tools::dispatch_tool_inner;
use app_lib::commands::read_text_detected;
use encoding_rs::GBK;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn make_workspace(label: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!(
        "solomd-agent-tools-e2e-{}-{}-{}",
        label,
        std::process::id(),
        stamp
    ));
    fs::create_dir_all(&dir).unwrap();

    fs::write(
        dir.join("Welcome.md"),
        "---\ntitle: Welcome\ntags: [intro, demo]\n---\n# Welcome\n\n\
         First paragraph mentions banana.\n\n## Subsection\n\nSee [[Daily/2026-04-30]].\n",
    )
    .unwrap();
    fs::create_dir_all(dir.join("Daily")).unwrap();
    fs::write(
        dir.join("Daily/2026-04-30.md"),
        "# Today\n\n#topic\n\nA needle line about apples.\n\n[[Welcome]]\n",
    )
    .unwrap();
    fs::create_dir_all(dir.join(".solomd")).unwrap();
    dir
}

#[test]
fn list_notes_returns_seed_files() {
    let ws = make_workspace("list");
    let res: Value = dispatch_tool_inner(&ws, "list_notes", json!({})).unwrap();
    let count = res["count"].as_u64().unwrap();
    assert!(count >= 2, "expected ≥2 notes, got {count}");
    let names: Vec<String> = res["notes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["name"].as_str().unwrap_or("").to_string())
        .collect();
    assert!(names.iter().any(|n| n == "Welcome.md"));
    assert!(names.iter().any(|n| n == "2026-04-30.md"));
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn list_notes_scoped_by_folder() {
    let ws = make_workspace("list-folder");
    let res: Value = dispatch_tool_inner(&ws, "list_notes", json!({"folder": "Daily"})).unwrap();
    let count = res["count"].as_u64().unwrap();
    assert_eq!(count, 1, "Daily should have exactly 1 note: {res}");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn read_note_round_trips_frontmatter_and_links() {
    let ws = make_workspace("read");
    let res: Value =
        dispatch_tool_inner(&ws, "read_note", json!({"path": "Welcome.md"})).unwrap();
    assert_eq!(res["frontmatter"]["title"], "Welcome");
    let tags: Vec<String> = res["tags"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(tags.contains(&"intro".to_string()));
    assert!(tags.contains(&"demo".to_string()));
    assert!(res["content"]
        .as_str()
        .unwrap()
        .contains("First paragraph"));
    let wl = res["wikilinks"].as_array().unwrap();
    assert_eq!(wl.len(), 1);
    assert_eq!(wl[0]["target"], "Daily/2026-04-30");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn search_finds_literal_match() {
    let ws = make_workspace("search");
    let res: Value =
        dispatch_tool_inner(&ws, "search", json!({"query": "needle"})).unwrap();
    assert!(res["count"].as_u64().unwrap() >= 1);
    let hit = &res["hits"][0];
    assert!(hit["snippet"].as_str().unwrap().to_lowercase().contains("needle"));
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn write_note_creates_file_and_refuses_clobber() {
    let ws = make_workspace("write");

    let res: Value = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "weekly/2026-W17.md", "content": "# Weekly review\n\nHi.\n"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);
    assert!(ws.join("weekly/2026-W17.md").exists());

    // Default refuses to clobber.
    let dup = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "weekly/2026-W17.md", "content": "x"}),
    );
    assert!(dup.is_err(), "expected refusal w/o allow_overwrite");

    // With allow_overwrite, succeeds.
    let ok: Value = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({
            "path": "weekly/2026-W17.md",
            "content": "# v2\n",
            "allow_overwrite": true,
        }),
    )
    .unwrap();
    assert_eq!(ok["ok"], true);
    let raw = fs::read_to_string(ws.join("weekly/2026-W17.md")).unwrap();
    assert_eq!(raw, "# v2\n");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn append_to_note_extends_existing_file() {
    let ws = make_workspace("append");
    let target = "Daily/2026-04-30.md";
    let before = fs::read_to_string(ws.join(target)).unwrap();
    let res: Value = dispatch_tool_inner(
        &ws,
        "append_to_note",
        json!({"path": target, "content": "\n## Appended\n"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);
    let after = fs::read_to_string(ws.join(target)).unwrap();
    assert!(after.starts_with(&before));
    assert!(after.ends_with("## Appended\n"));
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn get_outline_returns_heading_tree() {
    let ws = make_workspace("outline");
    let res: Value =
        dispatch_tool_inner(&ws, "get_outline", json!({"path": "Welcome.md"})).unwrap();
    let outline = res["outline"].as_array().unwrap();
    assert!(!outline.is_empty());
    let texts: Vec<String> = outline
        .iter()
        .map(|h| h["text"].as_str().unwrap_or("").to_string())
        .collect();
    assert!(texts.contains(&"Welcome".to_string()));
    assert!(texts.contains(&"Subsection".to_string()));
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn list_tags_aggregates_counts() {
    let ws = make_workspace("tags");
    let res: Value = dispatch_tool_inner(&ws, "list_tags", json!({})).unwrap();
    let tags = res["tags"].as_array().unwrap();
    let names: Vec<String> = tags
        .iter()
        .map(|v| v["tag"].as_str().unwrap_or("").to_string())
        .collect();
    assert!(names.contains(&"intro".to_string()));
    assert!(names.contains(&"demo".to_string()));
    assert!(names.contains(&"topic".to_string()));
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn get_backlinks_finds_referencing_notes() {
    let ws = make_workspace("backlinks");
    let res: Value =
        dispatch_tool_inner(&ws, "get_backlinks", json!({"note_name": "Welcome"})).unwrap();
    let count = res["count"].as_u64().unwrap();
    assert_eq!(count, 1, "exactly one note links to Welcome: {res}");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn unknown_tool_errors() {
    let ws = make_workspace("unknown");
    let res = dispatch_tool_inner(&ws, "nope_not_a_tool", json!({}));
    assert!(res.is_err());
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn workspace_traversal_blocked() {
    let ws = make_workspace("escape");
    let res = dispatch_tool_inner(&ws, "read_note", json!({"path": "../escape.md"}));
    assert!(res.is_err(), "should refuse traversal: {:?}", res);
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn read_agent_trace_parses_stored_steps() {
    use app_lib::agent_run::{RunHandle, RunKind, TraceStep};
    let ws = make_workspace("trace");
    let h = RunHandle::start(&ws, RunKind::Panel, "anthropic", "claude-test", None).unwrap();
    h.append_trace(TraceStep {
        kind: "prompt".to_string(),
        role: Some("user".to_string()),
        content: Some("hello".to_string()),
        ..Default::default()
    })
    .unwrap();
    h.finish("ok", 0, 0, 0.0, None).unwrap();

    let run_id = h.run_id.clone();
    let res: Value =
        dispatch_tool_inner(&ws, "read_agent_trace", json!({"run_id": run_id})).unwrap();
    let steps = res["steps"].as_array().unwrap();
    assert!(steps.len() >= 3);
    assert_eq!(steps[0]["kind"], "run_started");
    let last = steps.last().unwrap();
    assert_eq!(last["kind"], "run_ended");
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn semantic_search_e2e_fallback_and_indexed() {
    let ws = make_workspace("semantic");
    // 1. Unindexed workspace falls back gracefully
    let res: Value = dispatch_tool_inner(&ws, "semantic_search", json!({"query": "needle"})).unwrap();
    assert_eq!(res["mode"], "fallback_literal");
    assert!(res["count"].as_u64().unwrap() >= 1);
    assert!(res["warning"].as_str().unwrap().contains("unavailable"));

    // 2. Search tool with mode: "semantic" also falls back
    let res_search: Value = dispatch_tool_inner(&ws, "search", json!({"query": "needle", "mode": "semantic"})).unwrap();
    assert_eq!(res_search["mode"], "fallback_literal");
    assert!(res_search["count"].as_u64().unwrap() >= 1);

    // 3. Build RAG index and test semantic search
    let folder = ws.to_string_lossy().to_string();
    let _ = app_lib::rag::rag_set_enabled_inner(folder.clone(), true).unwrap();
    let _ = app_lib::rag::rag_reindex_inner(folder).unwrap();

    let res_indexed: Value = dispatch_tool_inner(&ws, "semantic_search", json!({"query": "Welcome banana"})).unwrap();
    assert_eq!(res_indexed["mode"], "semantic");
    assert!(res_indexed["count"].as_u64().unwrap() >= 1);
    let hits = res_indexed["hits"].as_array().unwrap();
    assert!(hits[0]["score"].as_f64().is_some());
    assert!(hits[0]["snippet"].as_str().is_some());

    let _ = fs::remove_dir_all(&ws);
}

// ---------------------------------------------------------------------------
// S09 — encoding everywhere, agent-tool side. Style mirrors
// tests/encoding_detection_test.rs: write raw legacy bytes, drive the tool,
// and pin down that the FILE stays in the encoding it was found in — the
// pre-fix tools wrote plain UTF-8 bytes, so a GBK archive note was invisible
// to the agent (read) or silently transcoded (append / overwrite).
// ---------------------------------------------------------------------------

fn write_raw_note(ws: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let p = ws.join(name);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&p, bytes).unwrap();
    p
}

/// write_note with `encoding: "GBK"` must put GBK bytes on disk (not UTF-8),
/// and the result must be readable again by both the editor-side detector and
/// the agent's own read_note.
#[test]
fn write_note_gbk_encoding_roundtrips_byte_exactly() {
    let ws = make_workspace("write-gbk");
    let text = "# 存档\n\n这条笔记用 GBK 编码由 agent 直接写入，足够长以让编码检测稳定锁定。\
                不再出现读侧贯通后写侧静默转码的问题。\n";
    let res: Value = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "archive/gbk.md", "content": text, "encoding": "GBK"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);

    let raw = fs::read(ws.join("archive/gbk.md")).unwrap();
    assert!(
        std::str::from_utf8(&raw).is_err(),
        "file was written as UTF-8 despite encoding=GBK"
    );

    let det = read_text_detected(Path::new(&ws.join("archive/gbk.md"))).unwrap();
    assert_eq!(det.content, text);
    assert!(!det.had_errors);
    // chardetng may label GBK input GBK or GB18030 (a superset — same bytes
    // for GBK-range characters); either must re-encode identically.
    assert!(
        det.encoding == "GBK" || det.encoding == "GB18030",
        "unexpected label: {}",
        det.encoding
    );

    // And the agent's own read path must see it — this used to be an
    // "invalid utf-8 sequence" hard error.
    let read: Value =
        dispatch_tool_inner(&ws, "read_note", json!({"path": "archive/gbk.md"})).unwrap();
    assert_eq!(read["content"].as_str().unwrap(), text);
    let _ = fs::remove_dir_all(&ws);
}

/// No `encoding` argument → UTF-8, byte-identical to the old behavior.
#[test]
fn write_note_default_encoding_stays_utf8() {
    let ws = make_workspace("write-default");
    let res: Value = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "plain.md", "content": "# 你好\n默认编码不变。\n"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);
    assert_eq!(
        fs::read(ws.join("plain.md")).unwrap(),
        "# 你好\n默认编码不变。\n".as_bytes()
    );
    let _ = fs::remove_dir_all(&ws);
}

/// Content the target encoding cannot represent fails loudly instead of
/// writing U+FFFD litter — and creates nothing.
#[test]
fn write_note_gbk_rejects_unrepresentable_characters() {
    let ws = make_workspace("write-gbk-unrep");
    let err = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "e.md", "content": "emoji 😀", "encoding": "GBK"}),
    )
    .unwrap_err();
    assert!(err.contains("cannot be represented"), "got: {err}");
    assert!(!ws.join("e.md").exists(), "failed write must not create the file");
    let _ = fs::remove_dir_all(&ws);
}

/// An unknown encoding label is an explicit error — silently falling back to
/// UTF-8 would be exactly the silent-transcode behavior this pipeline exists
/// to prevent.
#[test]
fn write_note_rejects_unknown_encoding_label() {
    let ws = make_workspace("write-badlabel");
    let err = dispatch_tool_inner(
        &ws,
        "write_note",
        json!({"path": "x.md", "content": "hi", "encoding": "iso-9999-unknown"}),
    )
    .unwrap_err();
    assert!(err.contains("unknown encoding label"), "got: {err}");
    assert!(!ws.join("x.md").exists(), "must fail before creating anything");
    let _ = fs::remove_dir_all(&ws);
}

/// Appending to a GBK note must leave the FILE in GBK: read with detection,
/// append, write the whole thing back re-encoded (with the original BOM).
#[test]
fn append_to_note_preserves_gbk_encoding() {
    let ws = make_workspace("append-gbk");
    let original = "# 会议纪要\n\n今天讨论了 GBK 编码存档的旧笔记在 agent 追加后如何保持编码不变。\
                    这段正文需要足够长，让检测器稳定锁定编码。\n";
    let (gbk_bytes, _, _) = GBK.encode(original);
    let path = write_raw_note(&ws, "gbk.md", gbk_bytes.as_ref());

    let appended = "\n## 新增段落\n\n这是 agent 追加的一行中文。\n";
    let res: Value = dispatch_tool_inner(
        &ws,
        "append_to_note",
        json!({"path": "gbk.md", "content": appended}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);

    let raw = fs::read(&path).unwrap();
    assert!(
        std::str::from_utf8(&raw).is_err(),
        "file was silently transcoded to UTF-8 by append_to_note"
    );
    let det = read_text_detected(Path::new(&path)).unwrap();
    assert_eq!(det.content, format!("{original}{appended}"));
    assert!(!det.had_errors);
    assert!(det.encoding == "GBK" || det.encoding == "GB18030");
    // Byte-exact: re-encoding with the detected label reproduces the file.
    let (re, _, _) = encoding_rs::Encoding::for_label(det.encoding.as_bytes())
        .unwrap()
        .encode(&det.content);
    assert_eq!(re.as_ref(), &raw[..], "re-encoding changed the bytes");
    let _ = fs::remove_dir_all(&ws);
}

/// BOM fidelity: a UTF-8-BOM note keeps its BOM through an append.
#[test]
fn append_to_note_preserves_utf8_bom() {
    let ws = make_workspace("append-bom");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("# BOM note\n\nbody\n".as_bytes());
    let path = write_raw_note(&ws, "bom.md", &bytes);

    let res: Value = dispatch_tool_inner(
        &ws,
        "append_to_note",
        json!({"path": "bom.md", "content": "\nappended\n"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);

    let raw = fs::read(&path).unwrap();
    assert!(raw.starts_with(&[0xEF, 0xBB, 0xBF]), "BOM lost");
    let det = read_text_detected(Path::new(&path)).unwrap();
    assert!(det.had_bom);
    assert!(det.content.contains("appended"));
    let _ = fs::remove_dir_all(&ws);
}

/// A file whose bytes never decode cleanly (0xFF is illegal in GBK) must be
/// refused, not silently rewritten as the lossy rendering.
#[test]
fn append_to_note_refuses_undecodable_file() {
    let ws = make_workspace("append-bad");
    // chardetng needs ≥ ~100 bytes to lock on GBK (see
    // tests/encoding_detection_test.rs); with a shorter sample it falls back
    // to windows-1252, where almost anything still decodes. 0xFF is illegal
    // in GBK, so the detected GBK decode fails → `had_errors`.
    let text = "今天的会议记录，讨论了下个版本的排期与测试资源不足的问题。\
                这段时间团队集中处理编码检测贯通的遗留任务，确保 GBK 存档笔记在 agent \
                读写两侧都保持字节级保真，不再出现静默转码或不可见的情况。\
                检测器需要足够的上下文才能给出稳定的判定结果。\n";
    let mut gbk_bytes = GBK.encode(text).0.into_owned();
    gbk_bytes.push(0xFF); // illegal GBK byte — malformed under the detected encoding
    let path = write_raw_note(&ws, "broken.md", &gbk_bytes);

    let err = dispatch_tool_inner(
        &ws,
        "append_to_note",
        json!({"path": "broken.md", "content": "x"}),
    )
    .unwrap_err();
    assert!(err.contains("not decodable"), "got: {err}");
    // The broken file is untouched by the refused append.
    assert_eq!(fs::read(&path).unwrap(), gbk_bytes);
    let _ = fs::remove_dir_all(&ws);
}

/// Back-compat: a missing target is still created, as UTF-8.
#[test]
fn append_to_note_missing_file_created_as_utf8() {
    let ws = make_workspace("append-new");
    let res: Value = dispatch_tool_inner(
        &ws,
        "append_to_note",
        json!({"path": "new.md", "content": "# New\n"}),
    )
    .unwrap();
    assert_eq!(res["ok"], true);
    assert_eq!(fs::read(ws.join("new.md")).unwrap(), "# New\n".as_bytes());
    let _ = fs::remove_dir_all(&ws);
}
