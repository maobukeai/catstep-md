fn main() { audit_csv();
    let bold = r#"<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t>Plain</w:t></w:r></w:p></w:body></w:document>"#;
    println!("BOLD={}", docx_xml_to_markdown(bold).unwrap());
    let table = r#"<w:document xmlns:w="urn:w"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
    println!("TABLE=\n{}", docx_xml_to_markdown(table).unwrap());
}
fn read_with_encoding(path: &str) -> Result<String, String> { std::fs::read_to_string(path).map_err(|e| e.to_string()) }
fn audit_csv() {
    let p = std::env::temp_dir().join(format!("catstep-audit-table-{}.csv", std::process::id()));
    std::fs::write(&p, "name,value\nalpha,\"a|b\"\nbeta,\"line1\nline2\"\n").unwrap();
    println!("CSV=\n{}", convert_csv(p.to_str().unwrap()).unwrap());
}


