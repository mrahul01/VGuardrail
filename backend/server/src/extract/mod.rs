//! Multi-tier file-content extraction for `POST /scan`.
//!
//! A file arriving at the scan point is classified (Tier 1 text / Tier 2
//! structured / Tier 3 binary) and, for Tier 1–2, reduced to plain text that
//! the existing 24-category detector pipeline scans. Tier 3 (images) is the
//! agent's OCR job, not handled here.
//!
//! Extraction is **fail-open**: a corrupt or unsupported file returns an error
//! and yields no text. It never panics the request, and "no extracted text" is
//! never treated as an implicit allow — the `file_policy`/`image` detectors
//! already flag the raw blob in the prompt path.

pub mod archive;
pub mod mime;
pub mod office;
pub mod pdf;

pub use mime::Tier;

/// Per-file decoded-size cap (bytes). Larger files are not extracted.
pub const MAX_FILE_BYTES: usize = 10 * 1024 * 1024;

/// Why extraction produced no text.
#[derive(Debug, Clone)]
pub enum ExtractError {
    /// The format is recognized but unsupported for text extraction (e.g. image).
    Unsupported,
    /// The file exceeded a size cap.
    TooLarge,
    /// The file was recognized but could not be parsed.
    Parse(String),
}

impl std::fmt::Display for ExtractError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExtractError::Unsupported => write!(f, "unsupported file type"),
            ExtractError::TooLarge => write!(f, "file too large"),
            ExtractError::Parse(e) => write!(f, "parse error: {e}"),
        }
    }
}

/// Extracts scannable text from a file's raw bytes, dispatching by tier. Pure
/// and synchronous (CPU-bound) — the caller wraps it in `spawn_blocking` +
/// timeout for the latency-capped hybrid path.
pub fn extract_text(name: &str, declared_mime: Option<&str>, bytes: &[u8]) -> Result<String, ExtractError> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(ExtractError::TooLarge);
    }
    match mime::classify(name, declared_mime, bytes) {
        Tier::Text => Ok(String::from_utf8_lossy(bytes).into_owned()),
        Tier::Structured => extract_structured(name, bytes),
        Tier::Binary => Err(ExtractError::Unsupported),
    }
}

fn extract_structured(name: &str, bytes: &[u8]) -> Result<String, ExtractError> {
    let lname = name.to_ascii_lowercase();
    if lname.ends_with(".pdf") || bytes.starts_with(b"%PDF") {
        return pdf::extract_pdf(bytes);
    }
    if lname.ends_with(".zip") {
        // OOXML docs also start with PK; prefer the OOXML reader when the
        // archive carries the OOXML content-types part.
        if let Ok(mut zip) = office::open_zip(bytes) {
            if office::is_ooxml(&mut zip) {
                return office::extract_ooxml(bytes);
            }
        }
        return archive::extract_archive(bytes);
    }
    // .docx/.xlsx/.pptx (and friends) — OOXML.
    office::extract_ooxml(bytes)
}
