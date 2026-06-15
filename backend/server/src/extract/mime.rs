//! Tier-1 (<5 ms) MIME / extension classification. Routes each file to a scan
//! tier so the handler knows whether to read it as text directly (Tier 1),
//! extract structured text (Tier 2), or treat it as opaque binary (Tier 3 —
//! handled by the agent's OCR, not here).

/// Scan tier for a file's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    /// Plain text / source / config: scan the bytes directly (synchronous).
    Text,
    /// PDF / Office / archive: extract embedded text (may be slow).
    Structured,
    /// Image / opaque binary: no backend extraction (OCR lives in the agent).
    Binary,
}

/// Extensions we treat as Tier-1 text even when magic-byte sniffing is
/// inconclusive (most text formats have no magic bytes).
const TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "yaml", "yml", "toml", "ini",
    "cfg", "conf", "env", "xml", "svg", "html", "htm", "rtf", "tex", "sql", "sh", "bash", "zsh",
    "py", "rb", "js", "jsx", "ts", "tsx", "go", "rs", "java", "kt", "kts", "c", "h", "cpp", "cc",
    "hpp", "cs", "php", "swift", "scala", "pl", "pm", "lua", "r", "m", "mm", "dockerfile",
    "gitignore", "properties", "gradle", "make", "mk", "diff", "patch",
];

const STRUCTURED_EXTS: &[&str] =
    &["pdf", "docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "zip"];

fn extension_of(name: &str) -> Option<String> {
    name.rsplit('.').next().filter(|e| *e != name).map(|e| e.to_ascii_lowercase())
}

/// Classifies a file by its declared MIME (if any), filename extension, and a
/// magic-byte sniff of its first bytes. Extension wins for text (no reliable
/// magic), magic-byte wins for binary/structured.
pub fn classify(name: &str, declared_mime: Option<&str>, bytes: &[u8]) -> Tier {
    // 1. Magic-byte sniff (authoritative for the binary/structured formats).
    if let Some(kind) = infer::get(bytes) {
        let mime = kind.mime_type();
        if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime == "application/octet-stream"
        {
            return Tier::Binary;
        }
        if mime == "application/pdf"
            || mime == "application/zip"
            // OOXML and other zip-based office docs sniff as zip.
            || mime.contains("officedocument")
            || mime.contains("opendocument")
        {
            return Tier::Structured;
        }
        if mime.starts_with("text/") {
            return Tier::Text;
        }
    }

    // 2. Declared MIME hint.
    if let Some(m) = declared_mime {
        let m = m.to_ascii_lowercase();
        if m.starts_with("image/") || m.starts_with("audio/") || m.starts_with("video/") {
            return Tier::Binary;
        }
        if m == "application/pdf"
            || m == "application/zip"
            || m.contains("officedocument")
            || m.contains("opendocument")
        {
            return Tier::Structured;
        }
        if m.starts_with("text/")
            || m == "application/json"
            || m == "application/xml"
            || m == "application/x-yaml"
        {
            return Tier::Text;
        }
    }

    // 3. Extension hint (the only signal for most text formats).
    if let Some(ext) = extension_of(name) {
        if STRUCTURED_EXTS.contains(&ext.as_str()) {
            return Tier::Structured;
        }
        if TEXT_EXTS.contains(&ext.as_str()) {
            return Tier::Text;
        }
    }

    // 4. Heuristic last resort: looks like UTF-8 text → Text, else Binary.
    let sniff = &bytes[..bytes.len().min(2048)];
    if !sniff.is_empty() && std::str::from_utf8(sniff).is_ok() {
        Tier::Text
    } else {
        Tier::Binary
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_by_extension() {
        assert_eq!(classify("notes.py", None, b"print('hi')"), Tier::Text);
        assert_eq!(classify("config.env", None, b"AWS_KEY=x"), Tier::Text);
    }

    #[test]
    fn pdf_by_magic() {
        assert_eq!(classify("x.pdf", None, b"%PDF-1.7\n..."), Tier::Structured);
    }

    #[test]
    fn png_is_binary() {
        let png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR";
        assert_eq!(classify("shot.png", Some("image/png"), png), Tier::Binary);
    }

    #[test]
    fn zip_is_structured() {
        // PK magic.
        assert_eq!(classify("archive.zip", None, b"PK\x03\x04rest"), Tier::Structured);
    }

    #[test]
    fn unknown_utf8_falls_back_to_text() {
        assert_eq!(classify("mystery", None, b"just some words here"), Tier::Text);
    }
}
