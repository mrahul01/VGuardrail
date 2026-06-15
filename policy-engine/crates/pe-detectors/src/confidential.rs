//! Company-confidential content detection (category 4 of 15).
//!
//! Two signals: explicit confidentiality markers ("internal use only", …) and
//! org-configured project codenames. Both are pure lexicon scans; an optional
//! local LLM can refine ambiguous cases at the engine layer (see pe-engine's
//! `llm` module) — this detector is the always-on, offline baseline.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings, phrase_regex};

/// Built-in confidentiality markers commonly stamped on internal material.
const MARKERS: &[&str] = &[
    "company confidential",
    "internal use only",
    "internal only",
    "do not distribute",
    "not for external distribution",
    "not for public release",
    "proprietary and confidential",
    "strictly confidential",
    "confidential - do not share",
    "nda required",
    "under nda",
    "board materials",
    "draft - confidential",
];

static MARKER_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(MARKERS));

/// Detects company-confidential content via markers and project codenames.
pub struct CompanyConfidentialDetector {
    codenames: Option<Regex>,
}

impl CompanyConfidentialDetector {
    /// Builds the detector with org-specific `project_codenames` (may be empty).
    ///
    /// # Errors
    /// Returns a [`regex::Error`] if a configured codename cannot be compiled.
    pub fn new(project_codenames: &[String]) -> Result<Self, regex::Error> {
        Ok(Self {
            codenames: phrase_regex(project_codenames)?,
        })
    }
}

impl Detector for CompanyConfidentialDetector {
    fn id(&self) -> &'static str {
        "company_confidential.content"
    }
    fn category(&self) -> Category {
        Category::CompanyConfidential
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = phrase_findings(
            Some(&MARKER_RE),
            input.text,
            self.id(),
            Category::CompanyConfidential,
            "confidentiality_marker",
            0.85,
            Severity::Medium,
        );
        out.extend(phrase_findings(
            self.codenames.as_ref(),
            input.text,
            self.id(),
            Category::CompanyConfidential,
            "project_codename",
            0.9,
            Severity::High,
        ));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(d: &CompanyConfidentialDetector, text: &str) -> Vec<Finding> {
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn marker_detected() {
        let d = CompanyConfidentialDetector::new(&[]).unwrap();
        let f = scan(&d, "This deck is INTERNAL USE ONLY, please review.");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "confidentiality_marker");
        assert_eq!(f[0].category, Category::CompanyConfidential);
    }

    #[test]
    fn project_codename_detected() {
        let d = CompanyConfidentialDetector::new(&["Project Falcon".to_string()]).unwrap();
        let f = scan(&d, "Summarize the project falcon launch timeline");
        assert!(f.iter().any(|f| f.kind == "project_codename"));
        assert_eq!(
            f.iter().find(|f| f.kind == "project_codename").unwrap().severity,
            Severity::High
        );
    }

    #[test]
    fn plain_prose_is_clean() {
        let d = CompanyConfidentialDetector::new(&[]).unwrap();
        assert!(scan(&d, "What is the capital of France?").is_empty());
    }
}
