//! Keyword-policy detection (category 12 of 15): a simple, org-configurable
//! list of confidential keywords. Defaults cover common sensitivity labels;
//! custom org terms are appended via [`crate::DetectorConfig::custom_keywords`].

use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity};
use regex::Regex;

use crate::lexicon::{phrase_findings, phrase_regex};

/// Default sensitivity-label keywords.
pub(crate) const DEFAULT_KEYWORDS: &[&str] =
    &["confidential", "restricted", "internal only", "do not share"];

/// Detects configured confidential keywords.
pub struct KeywordPolicyDetector {
    keywords: Option<Regex>,
}

impl KeywordPolicyDetector {
    /// Builds the detector from the configured keyword list (already merged
    /// defaults + org custom terms; an empty list disables the detector).
    ///
    /// # Errors
    /// Returns a [`regex::Error`] if a configured keyword cannot be compiled.
    pub fn new(keywords: &[String]) -> Result<Self, regex::Error> {
        Ok(Self {
            keywords: phrase_regex(keywords)?,
        })
    }
}

impl Detector for KeywordPolicyDetector {
    fn id(&self) -> &'static str {
        "keyword.configured"
    }
    fn category(&self) -> Category {
        Category::Keyword
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        phrase_findings(
            self.keywords.as_ref(),
            input.text,
            self.id(),
            Category::Keyword,
            "keyword",
            0.95,
            Severity::Low,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn detector(extra: &[&str]) -> KeywordPolicyDetector {
        let mut words: Vec<String> = DEFAULT_KEYWORDS.iter().map(|s| s.to_string()).collect();
        words.extend(extra.iter().map(|s| s.to_string()));
        KeywordPolicyDetector::new(&words).unwrap()
    }

    fn scan(d: &KeywordPolicyDetector, text: &str) -> Vec<Finding> {
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn default_keyword_detected() {
        let f = scan(&detector(&[]), "this document is CONFIDENTIAL");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "keyword");
        assert_eq!(f[0].severity, Severity::Low);
    }

    #[test]
    fn custom_org_keyword_detected() {
        let f = scan(&detector(&["atlas-next"]), "share the atlas-next spec");
        assert!(f.iter().any(|f| f.redacted_preview == "atlas-next"));
    }

    #[test]
    fn empty_list_disables_detector() {
        let d = KeywordPolicyDetector::new(&[]).unwrap();
        assert!(scan(&d, "confidential").is_empty());
    }
}
