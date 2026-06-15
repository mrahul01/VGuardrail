//! Domain-content lexicon detectors for the June-2026 taxonomy expansion:
//! legal, medical, HR, security, R&D, internal communication, procurement,
//! and government/export-controlled material.
//!
//! One generic detector instantiated eight times: built-in phrase lists plus
//! org-configured additions, all pure lexicon scans (the always-on offline
//! baseline; the LLM layer can attribute these categories on ambiguous text).

use once_cell::sync::Lazy;
use pe_core::{Budget, Category, Detector, Finding, ScanInput, Severity};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings, phrase_regex};

const LEGAL: &[&str] = &[
    "attorney-client privilege",
    "attorney client privilege",
    "legal hold",
    "settlement agreement",
    "litigation strategy",
    "cease and desist",
    "privileged and confidential",
];

const MEDICAL: &[&str] = &[
    "patient record",
    "patient records",
    "protected health information",
    "medical record number",
    "diagnosis code",
    "treatment plan",
    "hipaa",
];

const HR: &[&str] = &[
    "performance improvement plan",
    "salary band",
    "termination letter",
    "disciplinary action",
    "severance package",
    "compensation review",
];

const SECURITY: &[&str] = &[
    "penetration test",
    "pentest report",
    "vulnerability report",
    "incident response plan",
    "security audit findings",
    "zero-day",
    "threat model",
];

const RESEARCH_DEVELOPMENT: &[&str] = &[
    "unpublished research",
    "experiment results",
    "research prototype",
    "patent application draft",
    "lab notebook",
];

const COMMUNICATION: &[&str] = &[
    "internal memo",
    "all-hands notes",
    "board minutes",
    "executive briefing",
    "leadership offsite notes",
];

const PROCUREMENT: &[&str] = &[
    "vendor contract",
    "purchase order",
    "rfp response",
    "supplier pricing",
    "bid evaluation",
];

const GOVERNMENT: &[&str] = &[
    "classified information",
    "for official use only",
    "fouo",
    "itar",
    "export controlled",
    "security clearance",
];

/// One (category, severity, builtin list) triple per domain. The regexes are
/// compiled lazily once and shared by every detector instance.
struct DomainSpec {
    id: &'static str,
    category: Category,
    severity: Severity,
    builtin: &'static Lazy<Regex>,
}

static LEGAL_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(LEGAL));
static MEDICAL_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(MEDICAL));
static HR_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(HR));
static SECURITY_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(SECURITY));
static RD_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(RESEARCH_DEVELOPMENT));
static COMMUNICATION_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(COMMUNICATION));
static PROCUREMENT_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(PROCUREMENT));
static GOVERNMENT_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(GOVERNMENT));

// `static` (not `const`): the entries borrow the lazily-compiled regex statics.
static SPECS: &[DomainSpec] = &[
    DomainSpec { id: "legal.content", category: Category::Legal, severity: Severity::Medium, builtin: &LEGAL_RE },
    DomainSpec { id: "medical.content", category: Category::Medical, severity: Severity::High, builtin: &MEDICAL_RE },
    DomainSpec { id: "hr.content", category: Category::Hr, severity: Severity::Medium, builtin: &HR_RE },
    DomainSpec { id: "security.content", category: Category::Security, severity: Severity::High, builtin: &SECURITY_RE },
    DomainSpec { id: "research_development.content", category: Category::ResearchDevelopment, severity: Severity::High, builtin: &RD_RE },
    DomainSpec { id: "communication.content", category: Category::Communication, severity: Severity::Low, builtin: &COMMUNICATION_RE },
    DomainSpec { id: "procurement.content", category: Category::Procurement, severity: Severity::Medium, builtin: &PROCUREMENT_RE },
    DomainSpec { id: "government.content", category: Category::Government, severity: Severity::High, builtin: &GOVERNMENT_RE },
];

/// Lexicon detector for one domain category (legal/medical/hr/…).
pub struct DomainLexiconDetector {
    spec: &'static DomainSpec,
    custom: Option<Regex>,
}

impl DomainLexiconDetector {
    fn new(spec: &'static DomainSpec, extra_phrases: &[String]) -> Result<Self, regex::Error> {
        Ok(Self {
            spec,
            custom: phrase_regex(extra_phrases)?,
        })
    }
}

impl Detector for DomainLexiconDetector {
    fn id(&self) -> &'static str {
        self.spec.id
    }
    fn category(&self) -> Category {
        self.spec.category
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = phrase_findings(
            Some(self.spec.builtin),
            input.text,
            self.spec.id,
            self.spec.category,
            "domain_phrase",
            0.8,
            self.spec.severity,
        );
        out.extend(phrase_findings(
            self.custom.as_ref(),
            input.text,
            self.spec.id,
            self.spec.category,
            "domain_phrase_custom",
            0.85,
            self.spec.severity,
        ));
        out
    }
}

/// Per-category extra phrase lists (appended to the built-ins).
#[derive(Debug, Clone, Default)]
pub struct DomainPhrases {
    /// Extra legal phrases.
    pub legal: Vec<String>,
    /// Extra medical phrases.
    pub medical: Vec<String>,
    /// Extra HR phrases.
    pub hr: Vec<String>,
    /// Extra security phrases.
    pub security: Vec<String>,
    /// Extra R&D phrases.
    pub research_development: Vec<String>,
    /// Extra internal-communication phrases.
    pub communication: Vec<String>,
    /// Extra procurement phrases.
    pub procurement: Vec<String>,
    /// Extra government/export phrases.
    pub government: Vec<String>,
}

/// Builds all eight domain detectors with the configured extra phrases.
///
/// # Errors
/// Returns a [`regex::Error`] if a configured phrase cannot be compiled.
pub fn build_all(phrases: &DomainPhrases) -> Result<Vec<DomainLexiconDetector>, regex::Error> {
    let extras: [&Vec<String>; 8] = [
        &phrases.legal,
        &phrases.medical,
        &phrases.hr,
        &phrases.security,
        &phrases.research_development,
        &phrases.communication,
        &phrases.procurement,
        &phrases.government,
    ];
    SPECS
        .iter()
        .zip(extras)
        .map(|(spec, extra)| DomainLexiconDetector::new(spec, extra))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan_one(id: &str, text: &str) -> Vec<Finding> {
        let detectors = build_all(&DomainPhrases::default()).unwrap();
        let d = detectors.iter().find(|d| d.id() == id).unwrap();
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn each_domain_detects_its_builtin_phrases() {
        let cases = [
            ("legal.content", "this is covered by attorney-client privilege", Category::Legal),
            ("medical.content", "attached patient record and treatment plan", Category::Medical),
            ("hr.content", "draft a performance improvement plan for the report", Category::Hr),
            ("security.content", "summarize the penetration test findings", Category::Security),
            ("research_development.content", "upload my lab notebook scans", Category::ResearchDevelopment),
            ("communication.content", "paste of the board minutes from May", Category::Communication),
            ("procurement.content", "compare supplier pricing across vendors", Category::Procurement),
            ("government.content", "this document is export controlled under ITAR", Category::Government),
        ];
        for (id, text, category) in cases {
            let f = scan_one(id, text);
            assert!(!f.is_empty(), "{id} should fire on: {text}");
            assert!(f.iter().all(|f| f.category == category), "{id} category");
            assert!(f.iter().all(|f| f.kind == "domain_phrase"));
        }
    }

    #[test]
    fn benign_prose_is_clean_across_domains() {
        for spec in SPECS {
            let f = scan_one(spec.id, "What is the capital of France? My secretary loves government cheese facts.");
            // "government cheese" must not fire: phrases are multi-word and word-bounded.
            assert!(
                f.is_empty(),
                "{} fired on benign prose: {:?}",
                spec.id,
                f.iter().map(|f| &f.redacted_preview).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn custom_phrases_are_appended() {
        let detectors = build_all(&DomainPhrases {
            legal: vec!["case zebra".to_string()],
            ..DomainPhrases::default()
        })
        .unwrap();
        let d = detectors.iter().find(|d| d.id() == "legal.content").unwrap();
        let f = d.scan(
            &ScanInput::new("notes on Case Zebra hearing", ScanContext::default()),
            &Budget::unlimited(),
        );
        assert!(f.iter().any(|f| f.kind == "domain_phrase_custom"));
    }

    #[test]
    fn severities_match_spec() {
        assert!(scan_one("medical.content", "protected health information")
            .iter()
            .all(|f| f.severity == Severity::High));
        assert!(scan_one("communication.content", "internal memo attached")
            .iter()
            .all(|f| f.severity == Severity::Low));
    }
}
