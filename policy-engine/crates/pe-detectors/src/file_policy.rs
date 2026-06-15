//! File-policy detection (category 13 of 15): prompts that embed file
//! *content* — base64 blobs (sniffed by magic prefix), `.env` bodies, SQL
//! dumps — or reference sensitive file types by name.

use once_cell::sync::Lazy;
use pe_core::{redact, Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

/// Minimum length for a base64 run to count as an embedded file payload.
const BASE64_MIN: usize = 240;

static BASE64_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[A-Za-z0-9+/]{240,}={0,2}").unwrap());
/// `.env`-style assignment lines (`KEY=value`), matched per line.
static ENV_LINE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^[A-Z][A-Z0-9_]{2,}=\S+$").unwrap());
static SQL_TABLE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bCREATE\s+TABLE\b").unwrap());
static SQL_INSERT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bINSERT\s+INTO\s+\S+\s+(?:\([^)]*\)\s+)?VALUES\b").unwrap());
static SQL_DUMP_TOOL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bmysqldump\b|\bpg_dump\b").unwrap());
static SENSITIVE_FILE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[\w./\\-]+\.(?:pem|key|env|sql|zip|p12|pfx|sqlite|dump|bak)\b").unwrap()
});

/// Base64 image magics handled by the image-policy detector, not here.
const IMAGE_MAGICS: &[&str] = &["iVBORw0KGgo", "/9j/", "R0lGOD", "UklGR"];

fn blob_kind(blob: &str) -> Option<(&'static str, Severity)> {
    if IMAGE_MAGICS.iter().any(|m| blob.starts_with(m)) {
        return None; // image_policy.embedded_image owns these
    }
    if blob.starts_with("UEsDB") {
        Some(("base64_zip_archive", Severity::High))
    } else if blob.starts_with("JVBERi") {
        Some(("base64_pdf", Severity::High))
    } else if blob.starts_with("LS0tLS1CRUdJTi") {
        // "-----BEGIN" — an armored key smuggled as base64.
        Some(("base64_pem_key", Severity::Critical))
    } else {
        Some(("base64_blob", Severity::Medium))
    }
}

/// Detects embedded file content and sensitive file references.
pub struct FilePolicyDetector;

impl Detector for FilePolicyDetector {
    fn id(&self) -> &'static str {
        "file_policy.embedded_file"
    }
    fn category(&self) -> Category {
        Category::FilePolicy
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let text = input.text;
        let mut out = Vec::new();

        for m in BASE64_RE.find_iter(text) {
            debug_assert!(m.as_str().len() >= BASE64_MIN);
            if let Some((kind, severity)) = blob_kind(m.as_str()) {
                let confidence = if kind == "base64_blob" { 0.7 } else { 0.95 };
                out.push(
                    Finding::new(
                        self.id(),
                        Category::FilePolicy,
                        kind,
                        Span::new(m.start(), m.end()),
                        confidence,
                        severity,
                        redact(m.as_str(), 6),
                    )
                    .with_meta("bytes", m.as_str().len().to_string()),
                );
            }
        }

        let env_lines: Vec<_> = ENV_LINE_RE.find_iter(text).collect();
        if env_lines.len() >= 2 {
            let first = &env_lines[0];
            out.push(
                Finding::new(
                    self.id(),
                    Category::FilePolicy,
                    "env_file",
                    Span::new(first.start(), env_lines[env_lines.len() - 1].end()),
                    0.85,
                    Severity::High,
                    format!("{} assignment lines", env_lines.len()),
                )
                .with_meta("lines", env_lines.len().to_string()),
            );
        }

        let sql_signals = usize::from(SQL_TABLE_RE.is_match(text))
            + usize::from(SQL_INSERT_RE.is_match(text))
            + usize::from(SQL_DUMP_TOOL_RE.is_match(text));
        if sql_signals >= 2 || SQL_INSERT_RE.is_match(text) {
            let m = SQL_INSERT_RE
                .find(text)
                .or_else(|| SQL_TABLE_RE.find(text))
                .or_else(|| SQL_DUMP_TOOL_RE.find(text));
            if let Some(m) = m {
                out.push(Finding::new(
                    self.id(),
                    Category::FilePolicy,
                    "sql_dump",
                    Span::new(m.start(), m.end()),
                    0.8,
                    Severity::High,
                    "SQL dump content",
                ));
            }
        }

        for m in SENSITIVE_FILE_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::FilePolicy,
                "sensitive_file_reference",
                Span::new(m.start(), m.end()),
                0.6,
                Severity::Low,
                m.as_str().to_string(),
            ));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(text: &str) -> Vec<Finding> {
        FilePolicyDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    fn kinds(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn zip_blob_detected_by_magic() {
        let blob = format!("UEsDB{}", "A".repeat(300));
        let f = scan(&blob);
        assert_eq!(f[0].kind, "base64_zip_archive");
        assert_eq!(f[0].severity, Severity::High);
        assert!(f[0].redacted_preview.contains('…'));
    }

    #[test]
    fn base64_images_are_left_to_the_image_detector() {
        let blob = format!("iVBORw0KGgo{}", "A".repeat(300));
        assert!(!kinds(&blob).iter().any(|k| k.starts_with("base64")));
    }

    #[test]
    fn env_file_body_detected() {
        let env = "DATABASE_URL=postgres://u:p@h/db\nSTRIPE_KEY=sk_live_abc\n";
        assert!(kinds(env).contains(&"env_file".to_string()));
        // A single assignment is not an .env paste.
        assert!(!kinds("PATH=/usr/bin").contains(&"env_file".to_string()));
    }

    #[test]
    fn sql_dump_detected() {
        let sql = "CREATE TABLE users (id int);\nINSERT INTO users VALUES (1, 'a');";
        assert!(kinds(sql).contains(&"sql_dump".to_string()));
    }

    #[test]
    fn sensitive_file_reference_detected() {
        assert!(kinds("here is my server.pem content").contains(&"sensitive_file_reference".to_string()));
    }

    #[test]
    fn short_base64_ignored() {
        assert!(!kinds("dGVzdA== is base64").iter().any(|k| k.starts_with("base64")));
    }
}
