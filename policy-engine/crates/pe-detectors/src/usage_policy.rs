//! AI usage-policy detection (category 7 of 15): requests that violate
//! organisational acceptable-use rules (legal/medical advice, competitor
//! material, …). Pure lexicon scan; the org can extend the vocabulary via
//! [`crate::DetectorConfig::usage_policy_phrases`].

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings, phrase_regex};

/// Built-in acceptable-use trigger phrases.
const PHRASES: &[&str] = &[
    "legal advice",
    "medical advice",
    "medical diagnosis",
    "diagnose my",
    "prescribe medication",
    "tax advice",
    "investment advice",
    "financial advice for my client",
    "resume for a competitor",
    "cover letter for a competitor",
    "application to a competitor",
    "insider trading",
    "circumvent a non-compete",
];

static BUILTIN_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(PHRASES));

/// Detects prompts that trip organisational AI acceptable-use policies.
pub struct UsagePolicyDetector {
    extra: Option<Regex>,
}

impl UsagePolicyDetector {
    /// Builds the detector with org-specific extra phrases (may be empty).
    ///
    /// # Errors
    /// Returns a [`regex::Error`] if a configured phrase cannot be compiled.
    pub fn new(extra_phrases: &[String]) -> Result<Self, regex::Error> {
        Ok(Self {
            extra: phrase_regex(extra_phrases)?,
        })
    }
}

impl Detector for UsagePolicyDetector {
    fn id(&self) -> &'static str {
        "usage_policy.restricted_use"
    }
    fn category(&self) -> Category {
        Category::UsagePolicy
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = phrase_findings(
            Some(&BUILTIN_RE),
            input.text,
            self.id(),
            Category::UsagePolicy,
            "restricted_use",
            0.8,
            Severity::Medium,
        );
        out.extend(phrase_findings(
            self.extra.as_ref(),
            input.text,
            self.id(),
            Category::UsagePolicy,
            "restricted_use",
            0.8,
            Severity::Medium,
        ));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(d: &UsagePolicyDetector, text: &str) -> Vec<Finding> {
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn legal_advice_detected() {
        let d = UsagePolicyDetector::new(&[]).unwrap();
        let f = scan(&d, "Give me legal advice about firing an employee");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "restricted_use");
    }

    #[test]
    fn org_phrases_extend_vocabulary() {
        let d = UsagePolicyDetector::new(&["ghostwrite my thesis".to_string()]).unwrap();
        assert_eq!(scan(&d, "Please ghostwrite my thesis intro").len(), 1);
    }

    #[test]
    fn benign_prompt_is_clean() {
        let d = UsagePolicyDetector::new(&[]).unwrap();
        assert!(scan(&d, "Explain how TLS certificates work").is_empty());
    }
}
