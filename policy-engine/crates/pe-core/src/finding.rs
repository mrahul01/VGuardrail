//! Detector output: a [`Finding`] and its byte [`Span`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::enums::{Category, Severity};

/// A half-open byte range `[start, end)` into the scanned text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    /// Inclusive start byte offset.
    pub start: usize,
    /// Exclusive end byte offset.
    pub end: usize,
}

impl Span {
    /// Constructs a span, panicking only in debug builds on an inverted range.
    #[must_use]
    pub fn new(start: usize, end: usize) -> Self {
        debug_assert!(start <= end, "span start must be <= end");
        Self { start, end }
    }

    /// Length of the span in bytes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.end.saturating_sub(self.start)
    }

    /// Whether the span is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

/// A single detection produced by a [`crate::Detector`].
///
/// A finding **never** carries the raw matched value (doc 00 P-10). Only the byte
/// span, a confidence score, and a redacted preview are retained, so audit events
/// can be produced without leaking secrets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Finding {
    /// Stable, namespaced detector id, e.g. `"secret.aws_access_key"`.
    pub detector_id: String,
    /// Detector category.
    pub category: Category,
    /// Specific kind, e.g. `"aws_access_key"`, `"credit_card"`.
    pub kind: String,
    /// Byte span of the match in the scanned text.
    pub span: Span,
    /// Confidence in `[0.0, 1.0]`.
    pub confidence: f32,
    /// Severity contributed by this finding.
    pub severity: Severity,
    /// A redacted preview such as `"AKIA…1Xff"` — never the full secret.
    pub redacted_preview: String,
    /// Detector-specific metadata (e.g. `{"card_network": "visa"}`).
    #[serde(default)]
    pub meta: BTreeMap<String, String>,
}

impl Finding {
    /// Builds a finding with no metadata.
    #[must_use]
    pub fn new(
        detector_id: impl Into<String>,
        category: Category,
        kind: impl Into<String>,
        span: Span,
        confidence: f32,
        severity: Severity,
        redacted_preview: impl Into<String>,
    ) -> Self {
        Self {
            detector_id: detector_id.into(),
            category,
            kind: kind.into(),
            span,
            confidence: confidence.clamp(0.0, 1.0),
            severity,
            redacted_preview: redacted_preview.into(),
            meta: BTreeMap::new(),
        }
    }

    /// Adds a metadata key/value, builder-style.
    #[must_use]
    pub fn with_meta(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.meta.insert(key.into(), value.into());
        self
    }
}

/// Returns the category of the highest-severity finding (the first such finding
/// wins on ties), or `None` for an empty set. This is the "primary category"
/// surfaced on decisions and audit events.
#[must_use]
pub fn primary_category(findings: &[Finding]) -> Option<Category> {
    findings
        .iter()
        .max_by(|a, b| {
            a.severity
                .cmp(&b.severity)
                .then(a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal))
        })
        .map(|f| f.category)
}

/// Produces a redacted preview `first…last` from a raw match, keeping at most
/// `keep` leading and trailing characters. The middle is replaced with `…`.
///
/// This is the single sanctioned helper for building previews so the redaction
/// invariant is enforced in one place.
#[must_use]
pub fn redact(raw: &str, keep: usize) -> String {
    let chars: Vec<char> = raw.chars().collect();
    if chars.len() <= keep * 2 {
        // Too short to safely show both ends without revealing the whole value.
        return "…".to_string();
    }
    let head: String = chars[..keep].iter().collect();
    let tail: String = chars[chars.len() - keep..].iter().collect();
    format!("{head}…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_hides_the_middle() {
        assert_eq!(redact("AKIAIOSFODNN7EXAMPLE", 4), "AKIA…MPLE");
    }

    #[test]
    fn redact_collapses_short_values() {
        assert_eq!(redact("short", 4), "…");
        assert_eq!(redact("12345678", 4), "…");
    }

    #[test]
    fn confidence_is_clamped() {
        let f = Finding::new(
            "x",
            Category::Secret,
            "k",
            Span::new(0, 1),
            5.0,
            Severity::High,
            "…",
        );
        assert_eq!(f.confidence, 1.0);
    }

    #[test]
    fn finding_round_trips_json_without_raw_value() {
        let f = Finding::new(
            "secret.aws_access_key",
            Category::Secret,
            "aws_access_key",
            Span::new(10, 30),
            0.99,
            Severity::Critical,
            "AKIA…MPLE",
        )
        .with_meta("source", "test");
        let json = serde_json::to_string(&f).unwrap();
        assert!(!json.contains("AKIAIOSFODNN7EXAMPLE"));
        let back: Finding = serde_json::from_str(&json).unwrap();
        assert_eq!(back, f);
    }
}
