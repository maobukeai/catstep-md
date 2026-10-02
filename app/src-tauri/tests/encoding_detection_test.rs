//! Encoding detection for opened files.
//!
//! `read_file_inner` sniffs a BOM, then falls back to chardetng. The existing
//! `read_file_test.rs` covers the BOM cases and one long GBK sample, with a
//! note that chardetng "needs ≥ ~100 bytes to confidently detect GBK" — which
//! would make short CJK notes a mojibake risk. These pin down that the short
//! cases decode correctly too, across the encodings a CJK user's existing
//! notes are actually saved in.
//!
//! The S09 (encoding everywhere) tests at the bottom pin the second half of
//! the contract: `read_text_detected` exposes the detected label, and the
//! frontmatter editor writes back in THAT encoding instead of transcoding a
//! legacy archive note to UTF-8.
use app_lib::commands::read_file_inner as read_file;
use app_lib::commands::{
    delete_frontmatter_property_inner, read_text_detected, update_frontmatter_property_inner,
    write_file_inner,
};
use encoding_rs::{Encoding, BIG5, EUC_KR, GBK, SHIFT_JIS};
use serde_json::json;
use std::fs;
use std::path::Path;

fn write_raw(name: &str, bytes: &[u8]) -> String {
    let dir = std::env::temp_dir().join("solomd_encoding_tests");
    fs::create_dir_all(&dir).unwrap();
    let p = dir.join(name);
    fs::write(&p, bytes).unwrap();
    p.to_string_lossy().into_owned()
}

fn roundtrip(name: &str, enc: &'static Encoding, text: &str) -> String {
    let (bytes, _, _) = enc.encode(text);
    read_file(write_raw(name, &bytes)).unwrap().content
}

/// Most .md files in the wild are UTF-8 with no BOM. A misdetection here
/// would garble every character of the document.
#[test]
fn utf8_without_bom_survives_at_any_length() {
    for (i, text) in [
        "一",
        "你好",
        "会议记录",
        "今天的会议记录",
        "# 标题\n\n正文内容。",
        "备忘\n- 买菜\n- 交电费\n- 给妈妈打电话",
    ]
    .iter()
    .enumerate()
    {
        let got = read_file(write_raw(&format!("u8_{i}.md"), text.as_bytes()))
            .unwrap()
            .content;
        assert_eq!(&got, text, "UTF-8 sample {i} decoded wrong");
    }
}

/// A short GBK note is the case the ≥100-byte caveat predicts would fail.
#[test]
fn short_gbk_note() {
    assert_eq!(roundtrip("gbk_short.md", GBK, "今天的会议记录"), "今天的会议记录");
}

#[test]
fn medium_gbk_note() {
    let text = "项目进度\n\n今天和团队讨论了下个版本的排期，主要问题是测试资源不足。";
    assert_eq!(roundtrip("gbk_medium.md", GBK, text), text);
}

/// Traditional Chinese, Japanese and Korean legacy encodings — all plausible
/// for a user's pre-existing notes, none covered before.
#[test]
fn other_cjk_legacy_encodings() {
    assert_eq!(roundtrip("big5_short.md", BIG5, "會議記錄"), "會議記錄");
    let big5_long = "今天的會議記錄，討論了下個版本的排期與測試資源。";
    assert_eq!(roundtrip("big5_long.md", BIG5, big5_long), big5_long);
    assert_eq!(roundtrip("sjis.md", SHIFT_JIS, "会議メモ"), "会議メモ");
    assert_eq!(roundtrip("euckr.md", EUC_KR, "회의 기록"), "회의 기록");
}

// ---------------------------------------------------------------------------
// S09 — encoding everywhere: detect + re-encode in the same encoding.
// ---------------------------------------------------------------------------

/// A GBK note read through `read_text_detected` must round-trip byte-exactly
/// when re-encoded with the label the read reported (via `write_file_inner`,
/// which uses the same `Encoding::for_label` + encode path as
/// `atomic_write_encoded`). A GBK archive note edited this way never changes
/// encoding underneath the user.
#[test]
fn read_text_detected_gbk_roundtrips_byte_exactly() {
    let text = "项目进度\n\n今天和团队讨论了下个版本的排期，主要问题是测试资源不足。\
                这条笔记用 GBK 编码存档，用来验证读写贯通后字节不再被静默转码。\
                再补一句确保检测器有足够的上下文。";
    let (gbk_bytes, _, _) = GBK.encode(text);
    let path = write_raw("s09_gbk_roundtrip.md", gbk_bytes.as_ref());

    let det = read_text_detected(Path::new(&path)).unwrap();
    assert_eq!(det.content, text);
    assert!(!det.had_errors);
    assert!(!det.had_bom);
    // chardetng may label GBK input GBK or GB18030 (a superset — same bytes
    // for GBK-range characters); either must re-encode identically.
    assert!(
        det.encoding == "GBK" || det.encoding == "GB18030",
        "unexpected label: {}",
        det.encoding
    );

    write_file_inner(path.clone(), det.content.clone(), det.encoding.clone()).unwrap();
    assert_eq!(
        fs::read(&path).unwrap(),
        gbk_bytes.as_ref(),
        "re-encoding with the detected label changed the bytes"
    );
}

/// The whole S09 point for the frontmatter editor: updating one property of a
/// GBK note must leave the FILE in GBK (not silently transcoded to UTF-8),
/// preserve the untouched body, and make the new value readable again.
#[test]
fn frontmatter_update_preserves_gbk_encoding() {
    let body = "\n# 会议纪要\n\n今天讨论了 GBK 编码存档的旧笔记如何在搜索、反链和 RAG 中可见。\
                这段正文需要足够长，让检测器稳定锁定编码。\n";
    let raw = format!("---\ntitle: 会议纪要\ntags: [工作, 存档]\n---{body}");
    let (gbk_bytes, _, _) = GBK.encode(&raw);
    let path = write_raw("s09_gbk_frontmatter.md", gbk_bytes.as_ref());

    let next =
        update_frontmatter_property_inner(path.clone(), "status".into(), json!("已归档")).unwrap();
    assert!(next.contains("status: 已归档"));
    assert!(next.contains("# 会议纪要"), "body must survive the edit");

    let written = fs::read(&path).unwrap();
    assert!(
        std::str::from_utf8(&written).is_err(),
        "file was silently transcoded to UTF-8"
    );
    // Decode with the encoding the file still carries and re-detect to prove
    // the result is a faithful GBK file, not a lucky byte match.
    let det = read_text_detected(Path::new(&path)).unwrap();
    assert!(det.encoding == "GBK" || det.encoding == "GB18030");
    assert!(det.content.contains("status: 已归档"));
    assert!(det.content.contains("搜索、反链和 RAG"));
}

/// Deleting the last… or just one property of a GBK note — same contract as
/// the update twin.
#[test]
fn frontmatter_delete_preserves_gbk_encoding() {
    let raw = "---\ntitle: 会议纪要\ntags: [工作, 存档]\n---\n\n# 会议纪要\n\n正文内容，\
               足够长以保证编码检测稳定。\n";
    let (gbk_bytes, _, _) = GBK.encode(raw);
    let path = write_raw("s09_gbk_frontmatter_del.md", gbk_bytes.as_ref());

    let next = delete_frontmatter_property_inner(path.clone(), "tags".into()).unwrap();
    assert!(!next.contains("tags:"));
    assert!(next.contains("title: 会议纪要"));

    let written = fs::read(&path).unwrap();
    assert!(
        std::str::from_utf8(&written).is_err(),
        "file was silently transcoded to UTF-8"
    );
}

/// BOM fidelity: a UTF-8-BOM note edited through the frontmatter path keeps
/// its BOM — `atomic_write_encoded` re-adds what the read stripped.
#[test]
fn frontmatter_update_preserves_utf8_bom() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(b"---\ntitle: BOM note\n---\n\n# Hello\n\nbody\n");
    let path = write_raw("s09_bom_frontmatter.md", &bytes);

    update_frontmatter_property_inner(path.clone(), "status".into(), json!("kept")).unwrap();

    let written = fs::read(&path).unwrap();
    assert!(written.starts_with(&[0xEF, 0xBB, 0xBF]), "BOM lost");
    let det = read_text_detected(Path::new(&path)).unwrap();
    assert!(det.had_bom);
    assert!(det.content.contains("status: kept"));
}
