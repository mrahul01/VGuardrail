//! Customer-data detection (category 10 of 15): CRM records, customer lists,
//! and support tickets. Combines identifier patterns (ticket ids, Salesforce
//! record ids), a bulk-email heuristic for list exports, and CRM vocabulary.

use once_cell::sync::Lazy;
use pe_core::{redact, Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings};

static TICKET_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(?:ZD|ZEN|CASE|TKT|SUP|INC|HD)-\d{3,}\b").unwrap());
/// Salesforce record ids: 3-char object-key prefix + 12 or 15 more chars.
static SALESFORCE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(?:001|003|006|00Q|500)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b").unwrap());
static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").unwrap());

const PHRASES: &[&str] = &[
    "customer list",
    "customer database",
    "customer export",
    "customer records",
    "crm export",
    "churn list",
    "support ticket",
    "account list",
    "contact list",
];

static CRM_PHRASE_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(PHRASES));

/// Detects customer data: ticket/CRM identifiers, bulk address lists, and CRM
/// vocabulary.
pub struct CustomerDataDetector {
    /// Distinct email addresses at/above which a prompt counts as a list export.
    pub bulk_email_threshold: usize,
}

impl Default for CustomerDataDetector {
    fn default() -> Self {
        Self {
            bulk_email_threshold: 3,
        }
    }
}

impl Detector for CustomerDataDetector {
    fn id(&self) -> &'static str {
        "customer_data.records"
    }
    fn category(&self) -> Category {
        Category::CustomerData
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let text = input.text;
        let mut out = Vec::new();

        for m in TICKET_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::CustomerData,
                "support_ticket",
                Span::new(m.start(), m.end()),
                0.8,
                Severity::Medium,
                m.as_str().to_string(),
            ));
        }
        for m in SALESFORCE_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::CustomerData,
                "crm_record_id",
                Span::new(m.start(), m.end()),
                0.85,
                Severity::High,
                redact(m.as_str(), 4),
            ));
        }
        // Bulk-email heuristic: N or more distinct addresses ≈ a list export.
        let emails: Vec<_> = EMAIL_RE.find_iter(text).collect();
        let distinct: std::collections::BTreeSet<&str> =
            emails.iter().map(|m| m.as_str()).collect();
        if self.bulk_email_threshold > 0 && distinct.len() >= self.bulk_email_threshold {
            let first = &emails[0];
            out.push(
                Finding::new(
                    self.id(),
                    Category::CustomerData,
                    "bulk_customer_emails",
                    Span::new(first.start(), first.end()),
                    0.9,
                    Severity::High,
                    format!("{} distinct addresses", distinct.len()),
                )
                .with_meta("distinct_emails", distinct.len().to_string()),
            );
        }
        out.extend(phrase_findings(
            Some(&CRM_PHRASE_RE),
            text,
            self.id(),
            Category::CustomerData,
            "customer_data_reference",
            0.75,
            Severity::Medium,
        ));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(text: &str) -> Vec<Finding> {
        CustomerDataDetector::default().scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    fn kinds(text: &str) -> Vec<String> {
        scan(text).into_iter().map(|f| f.kind).collect()
    }

    #[test]
    fn ticket_ids_detected() {
        assert_eq!(kinds("see ZD-48211 for the escalation"), vec!["support_ticket"]);
    }

    #[test]
    fn salesforce_id_detected_and_redacted() {
        let f = scan("record 001A000001BcDeFGhI please");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "crm_record_id");
        assert!(!f[0].redacted_preview.contains("00001BcDe"));
    }

    #[test]
    fn bulk_emails_flag_a_list_export() {
        let text = "a@x.com, b@y.com, c@z.com signed up this week";
        assert!(kinds(text).contains(&"bulk_customer_emails".to_string()));
        // Two addresses stay under the default threshold.
        assert!(!kinds("mail a@x.com and b@y.com").contains(&"bulk_customer_emails".to_string()));
    }

    #[test]
    fn crm_vocabulary_detected() {
        assert!(kinds("paste of our customer list for Q2").contains(&"customer_data_reference".to_string()));
    }
}
