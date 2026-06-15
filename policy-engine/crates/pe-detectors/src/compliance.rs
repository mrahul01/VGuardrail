//! Compliance-policy detection (category 11 of 15): content that implicates a
//! regulatory framework (GDPR, HIPAA, PCI-DSS, SOC 2 / ISO 27001). Findings
//! carry the framework in metadata so rules can target a specific regime.

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

use crate::lexicon::builtin_phrase_regex;

struct FrameworkRule {
    framework: &'static str,
    re: Regex,
}

static FRAMEWORKS: Lazy<Vec<FrameworkRule>> = Lazy::new(|| {
    vec![
        FrameworkRule {
            framework: "gdpr",
            re: builtin_phrase_regex(&[
                "export user data",
                "data subject request",
                "right to be forgotten",
                "personal data of eu users",
                "gdpr",
            ]),
        },
        FrameworkRule {
            framework: "hipaa",
            re: builtin_phrase_regex(&[
                "patient record",
                "patient data",
                "health record",
                "medical record",
                "protected health information",
                "hipaa",
            ]),
        },
        FrameworkRule {
            framework: "pci_dss",
            re: builtin_phrase_regex(&[
                "cardholder data",
                "card verification value",
                "magnetic stripe data",
                "pci-dss",
                "pci dss",
            ]),
        },
        FrameworkRule {
            framework: "soc2_iso27001",
            re: builtin_phrase_regex(&[
                "soc 2 report",
                "iso 27001 audit",
                "penetration test report",
                "security audit findings",
            ]),
        },
    ]
});

/// Case-sensitive acronyms that are too noisy lowercased (e.g. "phi" in prose).
static ACRONYM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(?:PHI|CVV)\b").unwrap());

fn acronym_framework(text: &str) -> &'static str {
    if text == "CVV" {
        "pci_dss"
    } else {
        "hipaa"
    }
}

/// Detects content implicating regulatory compliance frameworks.
pub struct ComplianceDetector;

impl Detector for ComplianceDetector {
    fn id(&self) -> &'static str {
        "compliance.regulated_data"
    }
    fn category(&self) -> Category {
        Category::Compliance
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = Vec::new();
        for rule in FRAMEWORKS.iter() {
            for m in rule.re.find_iter(input.text) {
                out.push(
                    Finding::new(
                        self.id(),
                        Category::Compliance,
                        "compliance",
                        Span::new(m.start(), m.end()),
                        0.8,
                        Severity::High,
                        m.as_str().to_lowercase(),
                    )
                    .with_meta("framework", rule.framework),
                );
            }
        }
        for m in ACRONYM_RE.find_iter(input.text) {
            out.push(
                Finding::new(
                    self.id(),
                    Category::Compliance,
                    "compliance",
                    Span::new(m.start(), m.end()),
                    0.7,
                    Severity::High,
                    m.as_str().to_string(),
                )
                .with_meta("framework", acronym_framework(m.as_str())),
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
        ComplianceDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    fn frameworks(text: &str) -> Vec<String> {
        scan(text)
            .into_iter()
            .filter_map(|f| f.meta.get("framework").cloned())
            .collect()
    }

    #[test]
    fn gdpr_phrases_detected() {
        assert_eq!(frameworks("script to export user data for all accounts"), vec!["gdpr"]);
    }

    #[test]
    fn hipaa_phrases_and_acronym_detected() {
        assert_eq!(frameworks("summarize this patient record"), vec!["hipaa"]);
        assert_eq!(frameworks("we store PHI in this table"), vec!["hipaa"]);
        // Lowercase "phi" (e.g. the Greek letter / golden ratio) must NOT fire.
        assert!(frameworks("the golden ratio phi is 1.618").is_empty());
    }

    #[test]
    fn pci_phrases_detected() {
        assert_eq!(frameworks("where is cardholder data stored"), vec!["pci_dss"]);
        assert_eq!(frameworks("the CVV is checked here"), vec!["pci_dss"]);
    }

    #[test]
    fn benign_prompt_is_clean() {
        assert!(scan("Write a haiku about autumn leaves").is_empty());
    }
}
