use encoding_rs::{Encoding, UTF_8};
use std::{fs,path::Path};
mod watcher { pub fn mark_self_write(_: &str) {} }
mod audited {
    use super::*;
    fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> { fs::write(path, bytes).map_err(|e| e.to_string()) }
pub(crate) fn atomic_write_encoded(
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
pub fn write_file_inner(path: String, content: String, encoding: String) -> Result<(), String> {
    let enc = Encoding::for_label(encoding.as_bytes()).unwrap_or(UTF_8);
    let (cow, _, had_errors) = enc.encode(&content);
    if had_errors {
        return Err(format!(
            "Some characters cannot be represented in {}",
            enc.name()
        ));
    }
    atomic_write(Path::new(&path), cow.as_ref())?;

    super::watcher::mark_self_write(&path);

    Ok(())
}
}
fn main() {
 let base=std::env::args().nth(1).map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("catstep-encoding-probe")); fs::create_dir_all(&base).unwrap();
 let text="中文 Hello";
 let p=base.join("save-utf16le.md");
 audited::write_file_inner(p.to_string_lossy().into(), text.into(), "UTF-16LE".into()).unwrap();
 let bytes=fs::read(&p).unwrap();
 assert_eq!(bytes, text.as_bytes());
 println!("normal save requested UTF-16LE -> actual UTF-8: {:?}",bytes);
 let p=base.join("property-utf16le.md");
 audited::atomic_write_encoded(&p,text,"UTF-16LE",true).unwrap();
 let bytes=fs::read(&p).unwrap();
 assert_eq!(&bytes[..2], &[255,254]); assert_eq!(&bytes[2..],text.as_bytes());
 let (decoded,_,errors)=Encoding::for_label(b"UTF-16LE").unwrap().decode(&bytes);
 assert_ne!(decoded.as_ref(),text);
 println!("property edit requested UTF-16LE BOM -> UTF-16 BOM + UTF-8 payload: {:?}; reread={:?}; errors={}",bytes,decoded,errors);
 let p=base.join("save-utf8bom.md");
 fs::write(&p, [vec![239,187,191],text.as_bytes().to_vec()].concat()).unwrap();
 audited::write_file_inner(p.to_string_lossy().into(),text.into(),"UTF-8".into()).unwrap();
 assert!(!fs::read(&p).unwrap().starts_with(&[239,187,191]));
 println!("normal UTF-8 BOM save -> BOM removed");
}

