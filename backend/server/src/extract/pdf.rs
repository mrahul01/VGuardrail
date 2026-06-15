//! PDF text extraction (Tier 2). Uses `pdf-extract` (which wraps `lopdf`).
//!
//! Scanned / image-only PDFs contain no text layer and yield an empty string —
//! those are an OCR job (the Swift agent), not this path. Extraction is
//! fail-open: a corrupt PDF returns an error rather than panicking, and the
//! handler treats "no extracted text" as "nothing more to scan" (never as an
//! implicit allow — the file-policy detector still flagged the blob).

use super::ExtractError;

/// Extracts the text layer of a PDF. `pdf-extract` can panic on some malformed
/// inputs, so the call is isolated with `catch_unwind`.
pub fn extract_pdf(bytes: &[u8]) -> Result<String, ExtractError> {
    let owned = bytes.to_vec();
    let result = std::panic::catch_unwind(move || pdf_extract::extract_text_from_mem(&owned));
    match result {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(ExtractError::Parse(format!("pdf: {e}"))),
        Err(_) => Err(ExtractError::Parse("pdf: extractor panicked".into())),
    }
}
