// File-to-Markdown conversion.
//
// Strategy:
//   - Built-in (Rust): DOCX, HTML, CSV, XLSX — zero external deps, instant.
//   - Fallback (markitdown CLI): PDF, PPTX, images, audio — if installed.
//
// The Tauri command `convert_file_to_markdown` is called when a non-.md file
// is dragged into the editor or opened via File → Open.

use std::io::Read;
use std::path::Path;
use std::process::Command;

/// Build a `Command` that never flashes a console window on Windows
/// (CREATE_NO_WINDOW). markitdown detection/conversion spawns would otherwise
/// pop a black cmd window for a frame. No-op off Windows.
fn no_window_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}
use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::UTF_8;

/// Main entry point. Returns Markdown string or error.
#[tauri::command]
pub async fn convert_file_to_markdown(path: String) -> Result<String, String> {
    // Importing an external file is a read primitive — same guard as read_file.
    super::commands::path_guard::ensure_authorized(&path)?;
    tauri::async_runtime::spawn_blocking(move || convert_file_to_markdown_inner(path))
        .await
        .map_err(|e| format!("join: {e}"))?
}

pub fn convert_file_to_markdown_inner(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        // ---- Built-in conversions ----
        "docx" => convert_docx(&path),
        "html" | "htm" => convert_html(&path),
        "csv" => convert_csv(&path),
        "xlsx" | "xls" => convert_xlsx(&path),
        "json" => convert_json(&path),
        "xml" => convert_xml_file(&path),

        "pptx" => convert_pptx(&path),

        "pdf" => convert_pdf(&path),

        // ---- Fallback to markitdown CLI ----
        "epub" => convert_via_markitdown(&path),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" => convert_via_markitdown(&path),
        "mp3" | "wav" | "m4a" | "ogg" | "flac" => convert_via_markitdown(&path),

        _ => Err(format!("Unsupported file type: .{ext}")),
    }
}

// ====================================================================
// DOCX → Markdown (ZIP of XML)
// ====================================================================

fn convert_docx(path: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Can't open file: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid DOCX: {e}"))?;

    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| format!("No document.xml in DOCX: {e}"))?
        .read_to_string(&mut xml)
        .map_err(|e| format!("Read error: {e}"))?;

    docx_xml_to_markdown(&xml)
}

/// Escape imported literal text before adding Markdown formatting of our own.
fn markdown_literal(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\\' | '*' | '_' | '`' | '[' | ']' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Shared by Word, CSV and spreadsheets. Paragraph boundaries stay in one cell.
fn markdown_table_cell(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('|', "\\|")
        .replace('\n', "<br>")
}

fn push_markdown_row(out: &mut String, cells: &[String]) {
    out.push_str("| ");
    out.push_str(
        &cells
            .iter()
            .map(|s| markdown_table_cell(s))
            .collect::<Vec<_>>()
            .join(" | "),
    );
    out.push_str(" |\n");
}

fn docx_xml_to_markdown(xml: &str) -> Result<String, String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().expand_empty_elements = true;
    let mut out = String::new();
    let mut paragraph = String::new();
    let mut run = String::new();
    let mut in_text = false;
    let mut bold = false;
    let mut italic = false;
    let mut heading = 0usize;
    let mut list = false;
    let mut in_table = false;
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut cells = Vec::new();
    let mut cell_paragraphs = Vec::new();
    let mut cell_span = 1usize;
    let mut previous_style = None;

    fn finish_run(
        paragraph: &mut String,
        run: &mut String,
        bold: bool,
        italic: bool,
        previous_style: &mut Option<(bool, bool)>,
    ) {
        if run.is_empty() {
            return;
        } // Property-only runs must not change emitted formatting.
        let core = run.trim();
        if core.is_empty() {
            paragraph.push_str(run);
        } else {
            let start = run.len() - run.trim_start().len();
            let end = run.trim_end().len();
            let marker = match (bold, italic) {
                (true, true) => "***",
                (true, false) => "**",
                (false, true) => "*",
                _ => "",
            };
            let merge = !marker.is_empty()
                && *previous_style == Some((bold, italic))
                && paragraph.ends_with(marker);
            if merge {
                paragraph.truncate(paragraph.len() - marker.len());
            }
            paragraph.push_str(&run[..start]);
            if !merge {
                paragraph.push_str(marker);
            }
            paragraph.push_str(&markdown_literal(core));
            paragraph.push_str(marker);
            paragraph.push_str(&run[end..]);
        }
        *previous_style = Some((bold, italic));
        run.clear();
    }

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = e.local_name();
                let val = e
                    .attributes()
                    .flatten()
                    .find(|a| a.key.local_name().as_ref() == b"val")
                    .map(|a| String::from_utf8_lossy(&a.value).into_owned());
                match name.as_ref() {
                    b"tbl" => {
                        if in_table {
                            return Err(
                                "Nested Word tables cannot be represented as a Markdown table"
                                    .into(),
                            );
                        }
                        in_table = true;
                        rows.clear();
                    }
                    b"tr" => cells.clear(),
                    b"tc" => {
                        cell_paragraphs.clear();
                        cell_span = 1;
                    }
                    b"gridSpan" => {
                        cell_span = val.and_then(|v| v.parse().ok()).unwrap_or(1).clamp(1, 1000)
                    }
                    b"p" => {
                        paragraph.clear();
                        previous_style = None;
                        heading = 0;
                        list = false;
                    }
                    b"pStyle" => {
                        let style = val.unwrap_or_default().to_ascii_lowercase();
                        if let Some(level) = style.strip_prefix("heading") {
                            heading = level.parse::<usize>().unwrap_or(1).clamp(1, 6);
                        } else if style.starts_with("title") {
                            heading = 1;
                        }
                        list = style.contains("list");
                    }
                    b"numPr" => list = true,
                    b"r" => {
                        run.clear();
                        bold = false;
                        italic = false;
                    }
                    b"b" => bold = !matches!(val.as_deref(), Some("0" | "false" | "off")),
                    b"i" => italic = !matches!(val.as_deref(), Some("0" | "false" | "off")),
                    b"t" => in_text = true,
                    b"tab" => run.push('\t'),
                    b"br" | b"cr" => run.push('\n'),
                    _ => {}
                }
            }
            Ok(Event::Text(e)) if in_text => {
                run.push_str(&e.unescape().map_err(|e| format!("XML text: {e}"))?)
            }
            Ok(Event::CData(e)) if in_text => run.push_str(&String::from_utf8_lossy(e.as_ref())),
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_text = false,
                b"r" => {
                    finish_run(&mut paragraph, &mut run, bold, italic, &mut previous_style);
                    bold = false;
                    italic = false;
                }
                b"p" => {
                    if in_table {
                        cell_paragraphs.push(paragraph.trim().to_string());
                    } else if !paragraph.trim().is_empty() {
                        if heading > 0 {
                            out.push_str(&format!("{} ", "#".repeat(heading)));
                        } else if list {
                            out.push_str("- ");
                        }
                        out.push_str(paragraph.trim());
                        out.push_str(if list { "\n" } else { "\n\n" });
                    }
                    paragraph.clear();
                }
                b"tc" => {
                    cells.push(cell_paragraphs.join("\n"));
                    cells.extend(std::iter::repeat_n(String::new(), cell_span - 1));
                }
                b"tr" => rows.push(std::mem::take(&mut cells)),
                b"tbl" => {
                    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
                    for (i, row) in rows.iter_mut().enumerate() {
                        row.resize(width, String::new());
                        push_markdown_row(&mut out, row);
                        if i == 0 {
                            push_markdown_row(&mut out, &vec!["---".to_string(); width]);
                        }
                    }
                    out.push('\n');
                    in_table = false;
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
    }
    Ok(out.trim().to_string())
}

// ====================================================================
// HTML → Markdown
// ====================================================================

fn convert_html(path: &str) -> Result<String, String> {
    let raw = read_with_encoding(path)?;
    // Strip <style>, <script>, <head> blocks — htmd doesn't filter these
    // and would output their contents as plain text.
    let clean = strip_html_noise(&raw);
    htmd::convert(&clean).map_err(|e| format!("HTML conversion failed: {e}"))
}

/// Remove <style>…</style>, <script>…</script>, <head>…</head>, and HTML
/// comments before converting to Markdown.
fn strip_html_noise(html: &str) -> String {
    use std::borrow::Cow;
    let mut s: Cow<str> = Cow::Borrowed(html);
    // Each pattern: case-insensitive, dotall (. matches newline via [\s\S])
    for tag in &["style", "script", "head", "nav", "footer", "noscript"] {
        let re_str = format!(r"(?i)<{tag}[\s>][\s\S]*?</{tag}\s*>", tag = tag);
        if let Ok(re) = regex_lite::Regex::new(&re_str) {
            let replaced = re.replace_all(&s, "");
            if let Cow::Owned(o) = replaced {
                s = Cow::Owned(o);
            }
        }
    }
    // Also strip HTML comments
    if let Ok(re) = regex_lite::Regex::new(r"<!--[\s\S]*?-->") {
        let replaced = re.replace_all(&s, "");
        if let Cow::Owned(o) = replaced {
            s = Cow::Owned(o);
        }
    }
    s.into_owned()
}

/// Read a file with automatic encoding detection (UTF-8, GBK, Big5, etc.)
/// Reuses the same chardetng logic as the main read_file command.
fn read_with_encoding(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Can't read file: {e}"))?;

    // Try BOM first
    let (encoding, skip) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        (UTF_8 as &encoding_rs::Encoding, 3)
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        (encoding_rs::UTF_16LE as &encoding_rs::Encoding, 2)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        (encoding_rs::UTF_16BE as &encoding_rs::Encoding, 2)
    } else {
        // Auto-detect with chardetng
        let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
        detector.feed(&bytes, true);
        let enc = detector.guess(None, Utf8Detection::Allow);
        (enc, 0)
    };

    let body = &bytes[skip..];
    let (text, _, _) = encoding.decode(body);
    Ok(text.into_owned())
}

// ====================================================================
// CSV → Markdown table
// ====================================================================

fn convert_csv(path: &str) -> Result<String, String> {
    // CSV files are often GBK-encoded in China. Read with encoding detection
    // first, then parse the resulting UTF-8 string.
    let text = read_with_encoding(path)?;
    let mut rdr = csv::Reader::from_reader(text.as_bytes());
    let mut out = String::new();

    // Header
    let headers: Vec<String> = rdr
        .headers()
        .map_err(|e| format!("CSV header error: {e}"))?
        .iter()
        .map(markdown_literal)
        .collect();

    if !headers.is_empty() {
        out.push_str("| ");
        out.push_str(
            &headers
                .iter()
                .map(|s| markdown_table_cell(s))
                .collect::<Vec<_>>()
                .join(" | "),
        );
        out.push_str(" |\n|");
        for _ in &headers {
            out.push_str(" --- |");
        }
        out.push('\n');
    }

    // Rows
    for result in rdr.records() {
        let record = result.map_err(|e| format!("CSV row error: {e}"))?;
        out.push_str("| ");
        let cells: Vec<String> = record
            .iter()
            .map(|s| markdown_table_cell(&markdown_literal(s)))
            .collect();
        out.push_str(&cells.join(" | "));
        out.push_str(" |\n");
    }

    Ok(out.trim().to_string())
}

// ====================================================================
// XLSX → Markdown table(s)
// ====================================================================

fn convert_xlsx(path: &str) -> Result<String, String> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Can't open spreadsheet: {e}"))?;

    let mut out = String::new();
    let sheet_names: Vec<String> = workbook.sheet_names().to_vec();

    for name in &sheet_names {
        if let Ok(range) = workbook.worksheet_range(name) {
            if sheet_names.len() > 1 {
                out.push_str(&format!("## {name}\n\n"));
            }
            let mut first_row = true;
            for row in range.rows() {
                out.push_str("| ");
                let cells: Vec<String> = row
                    .iter()
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        Data::String(s) => s.clone(),
                        Data::Float(f) => format!("{f}"),
                        Data::Int(i) => format!("{i}"),
                        Data::Bool(b) => format!("{b}"),
                        Data::Error(e) => format!("#{e:?}"),
                        _ => cell.to_string(),
                    })
                    .collect();
                out.push_str(
                    &cells
                        .iter()
                        .map(|s| markdown_table_cell(&markdown_literal(s)))
                        .collect::<Vec<_>>()
                        .join(" | "),
                );
                out.push_str(" |\n");
                if first_row {
                    out.push('|');
                    for _ in &cells {
                        out.push_str(" --- |");
                    }
                    out.push('\n');
                    first_row = false;
                }
            }
            out.push('\n');
        }
    }

    Ok(out.trim().to_string())
}

// ====================================================================
// JSON → fenced code block
// ====================================================================

fn convert_json(path: &str) -> Result<String, String> {
    let raw = read_with_encoding(path)?;
    // Pretty-print if valid JSON
    let pretty = serde_json::from_str::<serde_json::Value>(&raw)
        .map(|v| serde_json::to_string_pretty(&v).unwrap_or(raw.clone()))
        .unwrap_or(raw);
    Ok(format!("```json\n{pretty}\n```"))
}

// ====================================================================
// XML → fenced code block
// ====================================================================

fn convert_xml_file(path: &str) -> Result<String, String> {
    let raw = read_with_encoding(path)?;
    Ok(format!("```xml\n{raw}\n```"))
}

// ====================================================================
// PDF → Markdown (text extraction)
// ====================================================================

fn convert_pdf(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Can't read file: {e}"))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("PDF extraction failed: {e}"))?;

    if text.trim().is_empty() {
        return Err("No text found in PDF (scanned/image PDF). \
             For OCR, install markitdown: pip install 'markitdown[all]'"
            .to_string());
    }

    // Clean up: PDF extraction often includes garbage strings like resource
    // IDs, font hashes, image references (e.g. "30fad226...HZ-3dW6...~~").
    let mut out = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push('\n');
            continue;
        }
        if is_pdf_garbage(trimmed) {
            continue;
        }
        // Clean inline garbage within a line
        let cleaned = clean_pdf_line(trimmed);
        let cleaned = cleaned.trim();
        if !cleaned.is_empty() {
            out.push_str(cleaned);
            out.push('\n');
        }
    }

    // Collapse 3+ newlines to 2
    let re = regex_lite::Regex::new(r"\n{3,}").unwrap();
    let out = re.replace_all(&out, "\n\n");

    Ok(out.trim().to_string())
}

/// Detect garbage lines from PDF extraction: resource IDs, font hashes, etc.
fn is_pdf_garbage(line: &str) -> bool {
    // Lines that are mostly hex/base64 hash-like characters (no spaces, long)
    if line.len() > 20 && !line.contains(' ') {
        let alnum = line
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '~')
            .count();
        if alnum as f64 / line.len() as f64 > 0.85 {
            return true;
        }
    }
    // Lines ending with ~~ are typically resource references
    if line.ends_with("~~") && line.len() > 10 {
        return true;
    }
    false
}

/// Remove inline garbage tokens from a line (hash-like strings mixed with text).
fn clean_pdf_line(line: &str) -> String {
    let mut result = String::new();
    for word in line.split_whitespace() {
        if is_pdf_garbage(word) {
            continue;
        }
        if !result.is_empty() {
            result.push(' ');
        }
        result.push_str(word);
    }
    result
}

// ====================================================================
// PPTX → Markdown (ZIP of XML, similar to DOCX)
// ====================================================================

fn convert_pptx(path: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Can't open file: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Not a valid PPTX: {e}"))?;

    // Collect slide filenames (ppt/slides/slide1.xml, slide2.xml, ...)
    let mut slide_names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            let name = entry.name().to_string();
            if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
                slide_names.push(name);
            }
        }
    }
    slide_names.sort();

    let mut out = String::new();

    for (idx, slide_name) in slide_names.iter().enumerate() {
        let mut xml = String::new();
        archive
            .by_name(slide_name)
            .map_err(|e| format!("Can't read {slide_name}: {e}"))?
            .read_to_string(&mut xml)
            .map_err(|e| format!("Read error: {e}"))?;

        let texts = extract_pptx_texts(&xml);
        if !texts.is_empty() {
            out.push_str(&format!("## Slide {}\n\n", idx + 1));
            for text in &texts {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    out.push_str(trimmed);
                    out.push_str("\n\n");
                }
            }
        }
    }

    if out.is_empty() {
        return Err("No text content found in PPTX".to_string());
    }

    Ok(out.trim().to_string())
}

/// Extract text runs from a PPTX slide XML. Each <a:p> becomes a separate
/// text block; <a:r><a:t> elements provide the actual text.
fn extract_pptx_texts(xml: &str) -> Vec<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().expand_empty_elements = true;
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_text = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "t" {
                    in_text = true;
                } else if name == "p" {
                    current.clear();
                }
            }
            Ok(Event::Text(ref e)) if in_text => {
                if let Ok(text) = e.unescape() {
                    current.push_str(&text);
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).to_string();
                if name == "t" {
                    in_text = false;
                } else if name == "p" {
                    let trimmed = current.trim().to_string();
                    if !trimmed.is_empty() {
                        paragraphs.push(trimmed);
                    }
                    current.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    paragraphs
}

// ====================================================================
// Fallback: markitdown CLI
// ====================================================================

fn convert_via_markitdown(path: &str) -> Result<String, String> {
    // Check if markitdown is installed
    let which = if cfg!(target_os = "windows") {
        no_window_command("where").arg("markitdown").output()
    } else {
        no_window_command("which").arg("markitdown").output()
    };

    match which {
        Ok(out) if out.status.success() => {}
        _ => {
            let ext = Path::new(path)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("?");
            return Err(format!(
                "Converting .{ext} files requires markitdown. Install with:\n\
                 pip install 'markitdown[all]'\n\n\
                 Then try again."
            ));
        }
    }

    let output = no_window_command("markitdown")
        .arg(path)
        .output()
        .map_err(|e| format!("Failed to run markitdown: {e}"))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("Output encoding error: {e}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("markitdown failed: {stderr}"))
    }
}

#[cfg(test)]
mod fidelity_tests {
    use super::*;

    #[test]
    fn word_run_properties_do_not_leak_and_false_properties_are_respected() {
        let xml = r#"<w:document xmlns:w="urn:w"><w:body>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t>Plain</w:t></w:r>
        <w:r><w:rPr><w:i/></w:rPr><w:t> italic </w:t></w:r>
        <w:r><w:rPr><w:b w:val="0"/><w:i w:val="false"/></w:rPr><w:t>normal</w:t></w:r></w:p>
        </w:body></w:document>"#;
        assert_eq!(
            docx_xml_to_markdown(xml).unwrap(),
            "**Bold**Plain *italic* normal"
        );
    }

    #[test]
    fn word_adjacent_styled_runs_form_one_valid_emphasis_span() {
        let xml = r#"<w:p xmlns:w="urn:w"><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r><w:r><w:rPr><w:i/></w:rPr></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r><w:r><w:t>Plain</w:t></w:r></w:p>"#;
        assert_eq!(docx_xml_to_markdown(xml).unwrap(), "**AB**Plain");
    }

    #[test]
    fn word_cell_paragraphs_and_empty_cells_keep_the_original_columns() {
        let xml = r#"<w:document xmlns:w="urn:w"><w:body><w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p><w:p><w:r><w:t>A2|part</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc/><w:tc><w:p><w:r><w:t>D</w:t><w:br/><w:t>E</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl></w:body></w:document>"#;
        assert_eq!(
            docx_xml_to_markdown(xml).unwrap(),
            "| A1<br>A2\\|part | B |\n| --- | --- |\n|  | D<br>E |"
        );
    }

    #[test]
    fn word_horizontal_spans_are_padded_without_shifting_later_cells() {
        let xml = r#"<w:tbl xmlns:w="urn:w"><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"#;
        assert_eq!(
            docx_xml_to_markdown(xml).unwrap(),
            "| Wide |  | C |\n| --- | --- | --- |"
        );
    }

    #[test]
    fn csv_import_keeps_literal_pipes_backslashes_markup_and_newlines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("table.csv");
        std::fs::write(
            &path,
            "name,value\nalpha,\"a|b\"\nbeta,\"line1\r\nline2\"\ngamma,\"\\*literal*\"\n",
        )
        .unwrap();
        assert_eq!(convert_csv(path.to_str().unwrap()).unwrap(),
            "| name | value |\n| --- | --- |\n| alpha | a\\|b |\n| beta | line1<br>line2 |\n| gamma | \\\\\\*literal\\* |");
    }

    #[test]
    fn real_xlsx_import_keeps_cells_with_pipes_and_newlines() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("table.xlsx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let files = [
            (
                "[Content_Types].xml",
                r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>value</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>alpha</t></is></c><c r="B2" t="inlineStr"><is><t>a|b&#10;c</t></is></c></row></sheetData></worksheet>"#,
            ),
        ];
        for (name, xml) in files {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        assert_eq!(
            convert_xlsx(path.to_str().unwrap()).unwrap(),
            "| name | value |\n| --- | --- |\n| alpha | a\\|b<br>c |"
        );
    }
}
