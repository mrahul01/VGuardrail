//! ZIP archive recursive text extraction (Tier 2). Walks the archive, reads
//! text + nested-structured entries, scans nothing itself — it just returns the
//! concatenated text for the detector pipeline.
//!
//! Zip-bomb guards (all enforced here, never trust declared sizes blindly):
//!   - at most `MAX_ENTRIES` files are read,
//!   - at most `MAX_TOTAL_UNCOMPRESSED` bytes are extracted cumulatively,
//!   - nested archives are NOT descended (depth ≤ 1) — they're noted, not opened.

use std::io::Read;

use super::mime::{classify, Tier};
use super::office::{extract_ooxml, open_zip};
use super::pdf::extract_pdf;
use super::ExtractError;

const MAX_ENTRIES: usize = 50;
const MAX_TOTAL_UNCOMPRESSED: usize = 5 * 1024 * 1024;
/// Per-entry read cap (also bounds a single lying entry).
const MAX_ENTRY_BYTES: u64 = 5 * 1024 * 1024;

/// Extracts concatenated text from the readable entries of a ZIP archive.
pub fn extract_archive(bytes: &[u8]) -> Result<String, ExtractError> {
    let mut zip = open_zip(bytes)?;
    let mut out = String::new();
    let mut total = 0usize;

    let count = zip.len().min(MAX_ENTRIES);
    for i in 0..count {
        if total >= MAX_TOTAL_UNCOMPRESSED {
            out.push_str("\n[vguardrail: archive truncated at size cap]\n");
            break;
        }
        // Read the entry name + bounded content.
        let (name, raw) = {
            let entry = match zip.by_index(i) {
                Ok(e) => e,
                Err(_) => continue,
            };
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();
            if entry.size() > MAX_ENTRY_BYTES {
                out.push_str(&format!("\n[vguardrail: skipped oversize entry {name}]\n"));
                continue;
            }
            let remaining = MAX_TOTAL_UNCOMPRESSED - total;
            let mut buf = Vec::new();
            // Bound the actual read so a deflate bomb can't exceed the budget.
            if entry.take(remaining as u64).read_to_end(&mut buf).is_err() {
                continue;
            }
            (name, buf)
        };
        total += raw.len();

        match classify(&name, None, &raw) {
            Tier::Text => {
                out.push_str(&format!("\n--- {name} ---\n"));
                out.push_str(&String::from_utf8_lossy(&raw));
            }
            Tier::Structured => {
                // Depth ≤ 1: extract OOXML/PDF entries, but do NOT open a nested
                // .zip — flag its presence instead.
                let lname = name.to_ascii_lowercase();
                let nested = if lname.ends_with(".pdf") {
                    extract_pdf(&raw).ok()
                } else if lname.ends_with(".zip") {
                    out.push_str(&format!("\n[vguardrail: nested archive {name} not descended]\n"));
                    None
                } else {
                    extract_ooxml(&raw).ok()
                };
                if let Some(text) = nested {
                    out.push_str(&format!("\n--- {name} ---\n"));
                    out.push_str(&text);
                }
            }
            Tier::Binary => {
                out.push_str(&format!("\n[vguardrail: binary entry {name}]\n"));
            }
        }
    }

    if zip.len() > MAX_ENTRIES {
        out.push_str(&format!(
            "\n[vguardrail: archive has {} entries; scanned first {MAX_ENTRIES}]\n",
            zip.len()
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default();
            for (name, content) in entries {
                zip.start_file(*name, opts).unwrap();
                zip.write_all(content).unwrap();
            }
            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_env_file_from_archive() {
        let z = build_zip(&[(".env", b"AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\n")]);
        let text = extract_archive(&z).unwrap();
        assert!(text.contains("AKIAIOSFODNN7EXAMPLE"), "got: {text:?}");
    }

    #[test]
    fn nested_archive_is_flagged_not_descended() {
        let inner = build_zip(&[("secret.txt", b"AKIAIOSFODNN7EXAMPLE")]);
        let outer = build_zip(&[("inner.zip", &inner)]);
        let text = extract_archive(&outer).unwrap();
        assert!(text.contains("not descended"), "got: {text:?}");
        assert!(!text.contains("AKIAIOSFODNN7EXAMPLE"), "inner content must not be read");
    }
}
