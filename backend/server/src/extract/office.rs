//! OOXML (Office Open XML: .docx / .xlsx / .pptx) text extraction (Tier 2).
//!
//! OOXML files are ZIP archives of XML parts. We pull the human-readable text
//! out of the relevant parts and concatenate it — enough for the detector
//! pipeline to find secrets/PII/etc. We do NOT attempt faithful layout.
//!
//! Parts read:
//!   - Word:       word/document.xml            (+ headers/footers)
//!   - Excel:      xl/sharedStrings.xml          (cell string pool)
//!   - PowerPoint: ppt/slides/slide*.xml         (slide text)
//!
//! The same ZIP reader backs `archive.rs`; see `open_zip`.

use std::io::Read;

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

use super::ExtractError;

/// Hard caps to bound work / memory regardless of the declared sizes.
const MAX_PART_BYTES: u64 = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

type Zip = ZipArchive<std::io::Cursor<Vec<u8>>>;

/// Opens an in-memory ZIP/OOXML archive. Shared with `archive.rs`.
pub(super) fn open_zip(bytes: &[u8]) -> Result<Zip, ExtractError> {
    ZipArchive::new(std::io::Cursor::new(bytes.to_vec()))
        .map_err(|e| ExtractError::Parse(format!("zip: {e}")))
}

/// True when the archive is an OOXML document (has the OOXML content-types part).
pub(super) fn is_ooxml(zip: &mut Zip) -> bool {
    zip.by_name("[Content_Types].xml").is_ok()
        && (0..zip.len()).any(|i| {
            zip.by_index(i)
                .map(|f| {
                    let n = f.name();
                    n.starts_with("word/")
                        || n.starts_with("xl/")
                        || n.starts_with("ppt/")
                })
                .unwrap_or(false)
        })
}

/// Extracts concatenated text from an OOXML document.
pub fn extract_ooxml(bytes: &[u8]) -> Result<String, ExtractError> {
    let mut zip = open_zip(bytes)?;
    let mut out = String::new();

    // Collect the part names first (can't hold a borrow across by_name calls).
    let names: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    for name in names {
        if !wants_part(&name) {
            continue;
        }
        let xml = match read_part(&mut zip, &name) {
            Ok(x) => x,
            Err(_) => continue, // skip unreadable parts (fail-open)
        };
        extract_xml_text(&xml, &mut out);
        if out.len() >= MAX_TOTAL_BYTES {
            break;
        }
    }

    Ok(out)
}

/// Which OOXML parts carry user text.
fn wants_part(name: &str) -> bool {
    name == "word/document.xml"
        || (name.starts_with("word/header") && name.ends_with(".xml"))
        || (name.starts_with("word/footer") && name.ends_with(".xml"))
        || name == "word/comments.xml"
        || name == "xl/sharedStrings.xml"
        || (name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
        || (name.starts_with("ppt/notesSlides/") && name.ends_with(".xml"))
}

fn read_part(zip: &mut Zip, name: &str) -> Result<String, ExtractError> {
    let mut file = zip
        .by_name(name)
        .map_err(|e| ExtractError::Parse(format!("zip part {name}: {e}")))?;
    if file.size() > MAX_PART_BYTES {
        return Err(ExtractError::TooLarge);
    }
    let mut buf = String::new();
    file.read_to_string(&mut buf)
        .map_err(|e| ExtractError::Parse(format!("read {name}: {e}")))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Builds a minimal .docx (OOXML) carrying `body` as the document text.
    fn build_docx(body: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            zip.start_file("[Content_Types].xml", opts).unwrap();
            zip.write_all(b"<?xml version=\"1.0\"?><Types/>").unwrap();
            zip.start_file("word/document.xml", opts).unwrap();
            let xml = format!(
                "<w:document><w:body><w:p><w:r><w:t>{body}</w:t></w:r></w:p></w:body></w:document>"
            );
            zip.write_all(xml.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_word_document_text() {
        let docx = build_docx("AKIAIOSFODNN7EXAMPLE is the key");
        let text = extract_ooxml(&docx).unwrap();
        assert!(text.contains("AKIAIOSFODNN7EXAMPLE"), "got: {text:?}");
    }

    #[test]
    fn is_ooxml_detects_the_content_types_part() {
        let docx = build_docx("hello");
        let mut zip = open_zip(&docx).unwrap();
        assert!(is_ooxml(&mut zip));
    }

    #[test]
    fn garbage_is_an_error_not_a_panic() {
        assert!(extract_ooxml(b"not a zip at all").is_err());
    }
}

/// Appends the character data of every XML text node, inserting spaces at
/// element boundaries so adjacent runs/cells don't fuse into one token.
fn extract_xml_text(xml: &str, out: &mut String) {
    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                if let Ok(t) = e.unescape() {
                    let t = t.trim();
                    if !t.is_empty() {
                        out.push_str(t);
                        out.push(' ');
                    }
                }
            }
            Ok(Event::End(_)) => out.push(' '),
            Ok(Event::Eof) => break,
            Err(_) => break, // tolerate malformed XML — keep what we have
            _ => {}
        }
        buf.clear();
    }
}
