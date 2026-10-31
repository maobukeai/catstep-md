use app_lib::commands::{
    delete_frontmatter_property_inner, read_file_inner, update_frontmatter_property_inner,
    write_file_inner, write_file_with_options_inner,
};
use serde_json::json;
use std::fs;

#[test]
fn utf16_byte_order_surrogate_pairs_and_bom_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    for (encoding, bom, body) in [
        ("UTF-16LE", vec![0xff, 0xfe], vec![0x41, 0, 0x2d, 0x4e, 0x3d, 0xd8, 0, 0xde]),
        ("UTF-16BE", vec![0xfe, 0xff], vec![0, 0x41, 0x4e, 0x2d, 0xd8, 0x3d, 0xde, 0]),
    ] {
        let path = dir.path().join(format!("{encoding}.md")).to_string_lossy().into_owned();
        for had_bom in [false, true] {
            write_file_with_options_inner(path.clone(), "A中😀".into(), encoding.into(), Some(had_bom)).unwrap();
            let expected = if had_bom { [bom.clone(), body.clone()].concat() } else { body.clone() };
            assert_eq!(fs::read(&path).unwrap(), expected, "{encoding}, BOM={had_bom}");
            if had_bom {
                let read = read_file_inner(path.clone()).unwrap();
                assert_eq!(read.content, "A中😀");
                assert_eq!(read.encoding, encoding);
                assert!(read.had_bom);
            }
        }
    }
}

#[test]
fn ordinary_save_preserves_utf8_bom_and_supports_explicit_removal() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bom.md").to_string_lossy().into_owned();
    fs::write(&path, [b"\xef\xbb\xbf".as_slice(), "旧稿".as_bytes()].concat()).unwrap();
    write_file_inner(path.clone(), "中文😀\r\n新稿".into(), "UTF-8".into()).unwrap();
    assert!(fs::read(&path).unwrap().starts_with(b"\xef\xbb\xbf"));
    assert_eq!(read_file_inner(path.clone()).unwrap().content, "中文😀\r\n新稿");
    write_file_with_options_inner(path.clone(), "无 BOM".into(), "UTF-8".into(), Some(false)).unwrap();
    assert_eq!(fs::read(&path).unwrap(), "无 BOM".as_bytes());
}

#[test]
fn utf16_frontmatter_edits_preserve_body_and_encoding() {
    let dir = tempfile::tempdir().unwrap();
    for encoding in ["UTF-16LE", "UTF-16BE"] {
        let path = dir.path().join(format!("{encoding}.md")).to_string_lossy().into_owned();
        let text = "---\ntitle: 中文\n---\n\n# 正文\n\nemoji 😀\n";
        write_file_with_options_inner(path.clone(), text.into(), encoding.into(), Some(true)).unwrap();
        update_frontmatter_property_inner(path.clone(), "status".into(), json!("完成")).unwrap();
        let result = read_file_inner(path.clone()).unwrap();
        assert_eq!(result.encoding, encoding);
        assert!(result.had_bom);
        assert!(result.content.contains("status: 完成"));
        assert!(result.content.ends_with("\n\n# 正文\n\nemoji 😀\n"));
        delete_frontmatter_property_inner(path.clone(), "status".into()).unwrap();
        let result = read_file_inner(path).unwrap();
        assert_eq!(result.encoding, encoding);
        assert!(result.had_bom);
        assert!(!result.content.contains("status:"));
        assert!(result.content.ends_with("\n\n# 正文\n\nemoji 😀\n"));
    }
}

#[test]
fn encoding_failure_never_replaces_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.md").to_string_lossy().into_owned();
    fs::write(&path, b"original").unwrap();
    assert!(write_file_inner(path.clone(), "emoji 😀".into(), "GBK".into()).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"original");
    assert!(write_file_inner(path.clone(), "new".into(), "unknown-encoding".into()).is_err());
    assert_eq!(fs::read(path).unwrap(), b"original");
}
