//! Intellectual-property detection (category 6 of 15): patents, designs,
//! roadmaps, and trade-secret vocabulary. Pure lexicon scan — the always-on,
//! offline baseline beneath any LLM refinement at the engine layer.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings};

/// IP vocabulary. "trade secret" is deliberately here (not in
/// company-confidential): legally it is an IP construct.
const PHRASES: &[&str] = &[
    "patent application",
    "patent pending",
    "provisional patent",
    "patent claim",
    "invention disclosure",
    "trade secret",
    "product roadmap",
    "feature roadmap",
    "unreleased product",
    "unannounced product",
    "unreleased feature",
    "confidential design",
    "design partner agreement",
    "proprietary algorithm",
    "launch plan",
];

static IP_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(PHRASES));

/// Detects intellectual-property content.
pub struct IntellectualPropertyDetector;

impl Detector for IntellectualPropertyDetector {
    fn id(&self) -> &'static str {
        "intellectual_property.content"
    }
    fn category(&self) -> Category {
        Category::IntellectualProperty
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        phrase_findings(
            Some(&IP_RE),
            input.text,
            self.id(),
            Category::IntellectualProperty,
            "intellectual_property",
            0.8,
            Severity::High,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(text: &str) -> Vec<Finding> {
        IntellectualPropertyDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn roadmap_detected() {
        let f = scan("Here is our product roadmap for 2027, summarize it");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "intellectual_property");
        assert_eq!(f[0].severity, Severity::High);
    }

    #[test]
    fn patent_language_detected() {
        assert!(!scan("draft the patent application for our compression scheme").is_empty());
    }

    #[test]
    fn benign_prompt_is_clean() {
        assert!(scan("Compare Rust and Go for systems programming").is_empty());
    }
}
