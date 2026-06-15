//! Sensitive-document detection (category 9 of 15): content pasted out of
//! PDFs, Office documents, internal wikis, or legal material. Detects the
//! artifacts such exports leave behind rather than trying to classify prose.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

static PAGE_MARKER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bpage\s+\d+\s+of\s+\d+\b").unwrap());
static PRIVILEGED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\battorney[\s-]client\s+privileged?\b|\bprivileged\s+(?:and|&)\s+confidential\b")
        .unwrap()
});
static FILE_ARTIFACT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"%PDF-\d\.\d|\[Content_Types\]\.xml|word/document\.xml|xl/workbook\.xml").unwrap()
});
static WIKI_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[\w.-]*confluence[\w.-]*\.[a-z]{2,}/|\bwiki\.internal\b|sharepoint\.com/sites/")
        .unwrap()
});

/// Minimum data lines that look tabular (≥3 cell separators) to flag an export.
const TABULAR_MIN_LINES: usize = 5;

/// Detects document-export artifacts in prompt text.
pub struct SensitiveDocumentDetector;

impl SensitiveDocumentDetector {
    fn tabular_span(text: &str) -> Option<Span> {
        let mut run_start = None;
        let mut run_lines = 0usize;
        let mut offset = 0usize;
        for line in text.split_inclusive('\n') {
            let separators = line.matches('\t').count() + line.matches(',').count();
            if separators >= 3 && !line.trim().is_empty() {
                if run_start.is_none() {
                    run_start = Some(offset);
                }
                run_lines += 1;
                if run_lines >= TABULAR_MIN_LINES {
                    return Some(Span::new(run_start.unwrap_or(0), offset + line.len()));
                }
            } else {
                run_start = None;
                run_lines = 0;
            }
            offset += line.len();
        }
        None
    }
}

impl Detector for SensitiveDocumentDetector {
    fn id(&self) -> &'static str {
        "sensitive_document.content"
    }
    fn category(&self) -> Category {
        Category::SensitiveDocument
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let text = input.text;
        let mut out = Vec::new();

        for m in PRIVILEGED_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::SensitiveDocument,
                "privileged_document",
                Span::new(m.start(), m.end()),
                0.9,
                Severity::High,
                m.as_str().to_lowercase(),
            ));
        }
        // Page markers indicate a document paste once they repeat.
        let pages: Vec<_> = PAGE_MARKER_RE.find_iter(text).collect();
        if pages.len() >= 2 {
            let first = &pages[0];
            out.push(
                Finding::new(
                    self.id(),
                    Category::SensitiveDocument,
                    "document_paste",
                    Span::new(first.start(), first.end()),
                    0.75,
                    Severity::Medium,
                    "page N of M ×repeat",
                )
                .with_meta("page_markers", pages.len().to_string()),
            );
        }
        for m in FILE_ARTIFACT_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::SensitiveDocument,
                "document_artifact",
                Span::new(m.start(), m.end()),
                0.85,
                Severity::Medium,
                m.as_str().to_string(),
            ));
        }
        for m in WIKI_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::SensitiveDocument,
                "internal_wiki_reference",
                Span::new(m.start(), m.end()),
                0.7,
                Severity::Medium,
                m.as_str().to_lowercase(),
            ));
        }
        if let Some(span) = Self::tabular_span(text) {
            out.push(
                Finding::new(
                    self.id(),
                    Category::SensitiveDocument,
                    "tabular_export",
                    span,
                    0.65,
                    Severity::Medium,
                    "tabular data block",
                )
                .with_meta("min_lines", TABULAR_MIN_LINES.to_string()),
            );
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(text: &str) -> Vec<Finding> {
        SensitiveDocumentDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    fn kinds(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn privileged_marker_detected() {
        assert_eq!(
            kinds("ATTORNEY-CLIENT PRIVILEGED — settlement summary"),
            vec!["privileged_document"]
        );
    }

    #[test]
    fn repeated_page_markers_flag_a_paste() {
        let text = "intro\nPage 1 of 12\nbody\nPage 2 of 12\nmore";
        assert_eq!(kinds(text), vec!["document_paste"]);
        // A single marker is not enough.
        assert!(kinds("see Page 3 of 10 for details").is_empty());
    }

    #[test]
    fn pdf_artifact_detected() {
        assert_eq!(kinds("%PDF-1.7 stream object dump"), vec!["document_artifact"]);
    }

    #[test]
    fn tabular_export_detected() {
        let csv = "id,name,email,plan\n1,a,a@x.com,pro\n2,b,b@x.com,pro\n3,c,c@x.com,free\n4,d,d@x.com,pro\n5,e,e@x.com,pro\n";
        assert!(kinds(csv).contains(&"tabular_export".to_string()));
    }

    #[test]
    fn prose_is_clean() {
        assert!(scan("Summarize the plot of Hamlet").is_empty());
    }
}
