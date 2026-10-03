//! Encoding detection + faithful write-back for note files.
//!
//! Independent copy of the pipeline in `app/src-tauri/src/commands.rs`
//! (`sniff_bom` / `decode_text_detected` / `read_text_detected` /
//! `atomic_write` / `atomic_write_encoded`) — per the contracts, `catstep-mcp`
//! duplicates app helpers instead of path-depending on the app crate (same
//! precedent as `trace_reader.rs`). Before this module every read tool went
//! through `fs::read_to_string`, which hard-fails on non-UTF-8 bytes: a note
//! saved in GBK / Big5 / UTF-16 was invisible to `read_note`, `search`,
//! `get_outline`, `list_tags`, `get_backlinks` and `list_tasks` even though
//! the editor opened it fine. And once reads detect, a plain-UTF-8 write in
//! `append_to_note` would silently transcode the whole note — so the
//! write-back half is copied too and re-encodes with the label the read
//! reported, keeping the BOM the file carried.

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, UTF_8};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

// ---------------------------------------------------------------------------
// atomic_write — crash/power-loss-safe overwrite.
//
// Copy of `app/src-tauri/src/commands.rs::atomic_write`. Write a sibling temp
// file → fsync it → rename over the target. The temp lives in the target's
// directory (rename is only atomic within one filesystem) and is unique per
// process so two concurrent writes can never interleave. Failed temp files are
// removed best-effort; the target is never left truncated.
// ---------------------------------------------------------------------------
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);

    let file_name = path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp = path.with_file_name(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        seq
    ));

    let write_tmp = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        // fsync BEFORE rename — a power cut after the rename must not find
        // the data blocks still in flight.
        f.sync_all()?;
        Ok(())
        // `f` drops here, releasing the handle before the rename.
    };
    if let Err(e) = write_tmp() {
        let _ = fs::remove_file(&tmp);
        return Err(format!("atomic write failed (temp): {e}"));
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("atomic write failed (rename): {e}"));
    }
    Ok(())
}

/// Overwrite `path` with `content` re-encoded to `encoding_label`, keeping
/// the BOM the original file carried. Companion to `read_text_detected`:
/// callers that read with detection (append_to_note) must write back in the
/// SAME encoding — writing plain UTF-8 here would silently transcode a
/// GBK / Big5 archive note the moment one line was appended.
///
/// Fails loudly when `content` holds characters the target encoding cannot
/// represent — the caller surfaces that instead of writing U+FFFD litter
/// into a legacy file.
pub fn atomic_write_encoded(
    path: &Path,
    content: &str,
    encoding_label: &str,
    had_bom: bool,
) -> Result<(), String> {
    let enc = Encoding::for_label(encoding_label.as_bytes()).unwrap_or(UTF_8);
    let (cow, _, had_errors) = enc.encode(content);
    if had_errors {
        return Err(format!(
            "Some characters cannot be represented in {}",
            enc.name()
        ));
    }
    // `encode()` never emits a BOM; re-add the one the original had.
    // `had_bom` only ever comes from `sniff_bom`, so the encoding here is
    // always one of these three; anything else just gets no BOM.
    let mut bytes = Vec::with_capacity(cow.len() + 3);
    if had_bom {
        match enc.name() {
            "UTF-8" => bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]),
            "UTF-16LE" => bytes.extend_from_slice(&[0xFF, 0xFE]),
            "UTF-16BE" => bytes.extend_from_slice(&[0xFE, 0xFF]),
            _ => {}
        }
    }
    bytes.extend_from_slice(cow.as_ref());
    atomic_write(path, &bytes)
}

/// Decoded text plus the metadata needed to write it back faithfully.
///
/// When the bytes could not be decoded cleanly this is the lossy UTF-8
/// rendering (U+FFFD for bad bytes) and `had_errors` is set — callers that
/// would PERSIST the text back to disk (`append_to_note`) must refuse rather
/// than enshrine mojibake.
#[derive(Debug, Clone)]
pub struct DetectedText {
    /// Decoded content (lossy rendering when `had_errors`).
    pub content: String,
    /// Encoding label as reported by `encoding_rs` (`"UTF-8"`, `"GBK"`,
    /// `"Big5"`, `"UTF-16LE"`, ...). Feed it to `atomic_write_encoded` (or
    /// `Encoding::for_label`) to re-encode in the same encoding.
    pub encoding: String,
    /// The file carried a BOM; it is stripped from `content`.
    pub had_bom: bool,
    /// Malformed bytes were hit and `content` came from the lossy fallback.
    pub had_errors: bool,
}

fn sniff_bom(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        Some((encoding_rs::UTF_8, 3))
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        Some((encoding_rs::UTF_16LE, 2))
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        Some((encoding_rs::UTF_16BE, 2))
    } else {
        None
    }
}

/// Decode raw bytes: BOM sniff first, then a cheap UTF-8 validation fast
/// path, and only when that fails chardetng — the exact pipeline the desktop
/// app has always used for the editor. Pure function (no I/O) so callers
/// holding a buffer — e.g. `workspace::scan_meta` with its 8 KB prefix read —
/// can run the same detection without re-reading the file.
pub fn decode_text_detected(bytes: &[u8]) -> DetectedText {
    // Try BOM first.
    let (encoding, had_bom, body) = if let Some((enc, bom_len)) = sniff_bom(bytes) {
        (enc, true, &bytes[bom_len..])
    } else if let Ok(s) = std::str::from_utf8(bytes) {
        // Fast path: the file is already valid UTF-8 — skip the chardetng
        // scan entirely. This is virtually every note in a modern vault, so
        // the vault-wide readers pay no detection cost over `read_to_string`.
        return DetectedText {
            content: s.to_owned(),
            encoding: "UTF-8".to_string(),
            had_bom: false,
            had_errors: false,
        };
    } else {
        // chardetng for everything else.
        let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
        detector.feed(bytes, true);
        let enc = detector.guess(None, Utf8Detection::Allow);
        (enc, false, bytes)
    };

    let (cow, _used_enc, had_errors) = encoding
        .decode_without_bom_handling_and_without_replacement(body)
        .map(|c| (c, encoding, false))
        .unwrap_or_else(|| {
            let (c, _used, errs) = encoding.decode(body);
            (c, _used, errs)
        });

    if had_errors {
        // Fall back to lossy UTF-8 so the caller sees something rather than
        // an error — same behavior as the desktop editor.
        return DetectedText {
            content: String::from_utf8_lossy(body).into_owned(),
            encoding: encoding.name().to_string(),
            had_bom,
            had_errors: true,
        };
    }

    DetectedText {
        content: cow.into_owned(),
        encoding: encoding.name().to_string(),
        had_bom,
        had_errors: false,
    }
}

/// Read a whole file from disk and decode it through `decode_text_detected`.
///
/// The entry point for every whole-vault reader — `workspace::read_full`
/// (read_note / get_backlinks / list_tags / list_tasks), `read_context`
/// (snippets), `tools::get_outline` and `tools::search_native`. These used to
/// call `fs::read_to_string` directly, which hard-fails on legacy-encoded
/// notes. Decoding failures surface as the lossy rendering with `had_errors`
/// set, so scanners can skip junk the same way they used to skip unreadable
/// files.
pub fn read_text_detected(path: &Path) -> Result<DetectedText, String> {
    let bytes = fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    Ok(decode_text_detected(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace;
    use encoding_rs::GBK;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fresh_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("catstep-mcp-enc-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The core contract: a GBK note read through detection round-trips
    /// byte-exactly when re-encoded with the label the read reported. A GBK
    /// archive note appended to this way never changes encoding underneath
    /// the user.
    #[test]
    fn gbk_roundtrip_reencodes_byte_exactly() {
        let text = "项目进度\n\n今天和团队讨论了下个版本的排期，主要问题是测试资源不足。\
                    这条笔记用 GBK 编码存档，用来验证读写贯通后字节不再被静默转码。\
                    再补一句确保检测器有足够的上下文。";
        let (gbk_bytes, _, _) = GBK.encode(text);
        let path = fresh_dir("gbk").join("note.md");
        fs::write(&path, gbk_bytes.as_ref()).unwrap();

        let det = read_text_detected(&path).unwrap();
        assert_eq!(det.content, text);
        assert!(!det.had_errors);
        assert!(!det.had_bom);
        // chardetng may label GBK input GBK or GB18030 (a superset — same
        // bytes for GBK-range characters); either must re-encode identically.
        assert!(
            det.encoding == "GBK" || det.encoding == "GB18030",
            "unexpected label: {}",
            det.encoding
        );

        atomic_write_encoded(&path, &det.content, &det.encoding, det.had_bom).unwrap();
        assert_eq!(
            fs::read(&path).unwrap(),
            gbk_bytes.as_ref(),
            "re-encoding with the detected label changed the bytes"
        );
    }

    /// Short UTF-8 CJK notes hit the fast path and must not be mangled by
    /// any detection heuristic.
    #[test]
    fn utf8_short_cjk_notes_survive() {
        for (i, text) in ["一", "你好", "# 标题\n\n正文内容。"].iter().enumerate() {
            let dir = fresh_dir("u8");
            let path = dir.join(format!("u8_{i}.md"));
            fs::write(&path, text.as_bytes()).unwrap();
            let det = read_text_detected(&path).unwrap();
            assert_eq!(&det.content, text);
            assert_eq!(det.encoding, "UTF-8");
            assert!(!det.had_bom && !det.had_errors);
        }
    }

    /// BOM fidelity: a UTF-8-BOM file re-written through the encoded path
    /// keeps its BOM.
    #[test]
    fn utf8_bom_is_readded_on_write_back() {
        let dir = fresh_dir("bom");
        let path = dir.join("bom.md");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("# Hello\n\nbody\n".as_bytes());
        fs::write(&path, &bytes).unwrap();

        let det = read_text_detected(&path).unwrap();
        assert!(det.had_bom);
        assert_eq!(det.encoding, "UTF-8");

        atomic_write_encoded(&path, &det.content, &det.encoding, det.had_bom).unwrap();
        let written = fs::read(&path).unwrap();
        assert!(written.starts_with(&[0xEF, 0xBB, 0xBF]), "BOM lost");
    }

    /// Content the target encoding cannot represent must fail loudly — the
    /// caller surfaces it instead of writing U+FFFD litter into a legacy file.
    #[test]
    fn atomic_write_encoded_rejects_unrepresentable_characters() {
        let dir = fresh_dir("unrep");
        let path = dir.join("gbk.md");
        fs::write(&path, "existing\n".as_bytes()).unwrap();
        let err = atomic_write_encoded(&path, "emoji 😀 in GBK", "GBK", false).unwrap_err();
        assert!(err.contains("cannot be represented"), "got: {err}");
        // The original file is untouched by the failed write.
        assert_eq!(fs::read(&path).unwrap(), b"existing\n");
    }

    /// End-to-end through the note reader: `workspace::read_full` sees a GBK
    /// note's content and headings instead of erroring out.
    #[test]
    fn workspace_read_full_decodes_gbk_note() {
        let dir = fresh_dir("readfull");
        let text = "# 会议纪要\n\n今天讨论了 GBK 编码存档的旧笔记在 MCP 工具中的可见性。\
                    这段正文足够长，让检测器稳定锁定编码。";
        let (gbk_bytes, _, _) = GBK.encode(text);
        fs::write(dir.join("gbk.md"), gbk_bytes.as_ref()).unwrap();

        let note = workspace::read_full(&dir.join("gbk.md")).unwrap();
        assert_eq!(note.content, text);
        assert_eq!(note.headings.len(), 1);
        assert_eq!(note.headings[0].text, "会议纪要");
    }
}
