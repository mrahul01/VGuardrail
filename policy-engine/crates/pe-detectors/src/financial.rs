//! Financial-information detection (category 5 of 15): IBANs (mod-97
//! validated), US ABA routing numbers (checksum + context), SWIFT/BIC codes
//! (context-gated), and financial-report vocabulary. Credit cards remain in the
//! PII module ([`crate::CreditCardDetector`], Luhn-validated).

use once_cell::sync::Lazy;
use pe_core::{redact, Budget, Category, Detector, Finding, ScanInput, Severity, Span};
use regex::Regex;

use crate::lexicon::{builtin_phrase_regex, phrase_findings};

static IBAN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b").unwrap());
static ROUTING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{9}\b").unwrap());
static ROUTING_CTX_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\brouting\b|\bABA\b").unwrap());
static BIC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b").unwrap());
static BIC_CTX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bswift\b|\bbic\b|\bwire transfer\b|\bbank\b").unwrap());

/// Financial-report vocabulary (revenue data, statements, invoices, payroll).
const REPORT_PHRASES: &[&str] = &[
    "quarterly revenue",
    "annual revenue",
    "revenue forecast",
    "financial projections",
    "profit and loss",
    "p&l statement",
    "balance sheet",
    "income statement",
    "cash flow statement",
    "ebitda",
    "gross margin",
    "earnings report",
    "invoice number",
    "payroll data",
    "bank account number",
];

static REPORT_RE: Lazy<Regex> = Lazy::new(|| builtin_phrase_regex(REPORT_PHRASES));

/// How far (in bytes) a context keyword may sit from a candidate number.
const CTX_WINDOW: usize = 48;

/// Detects financial identifiers and financial-report content.
pub struct FinancialDetector;

impl FinancialDetector {
    fn context_near(re: &Regex, text: &str, start: usize, end: usize) -> bool {
        let lo = start.saturating_sub(CTX_WINDOW);
        let hi = (end + CTX_WINDOW).min(text.len());
        // Clamp to char boundaries so slicing never panics on UTF-8 input.
        let lo = (0..=lo).rev().find(|&i| text.is_char_boundary(i)).unwrap_or(0);
        let hi = (hi..=text.len())
            .find(|&i| text.is_char_boundary(i))
            .unwrap_or(text.len());
        re.is_match(&text[lo..hi])
    }
}

impl Detector for FinancialDetector {
    fn id(&self) -> &'static str {
        "financial.data"
    }
    fn category(&self) -> Category {
        Category::Financial
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let text = input.text;
        let mut out = Vec::new();

        for m in IBAN_RE.find_iter(text) {
            if iban_valid(m.as_str()) {
                out.push(Finding::new(
                    self.id(),
                    Category::Financial,
                    "iban",
                    Span::new(m.start(), m.end()),
                    0.95,
                    Severity::High,
                    redact(m.as_str(), 4),
                ));
            }
        }

        for m in ROUTING_RE.find_iter(text) {
            if aba_routing_valid(m.as_str())
                && Self::context_near(&ROUTING_CTX_RE, text, m.start(), m.end())
            {
                out.push(Finding::new(
                    self.id(),
                    Category::Financial,
                    "us_routing_number",
                    Span::new(m.start(), m.end()),
                    0.85,
                    Severity::High,
                    redact(m.as_str(), 2),
                ));
            }
        }

        for m in BIC_RE.find_iter(text) {
            // Skip anything already claimed as an IBAN and require banking context.
            if out.iter().any(|f| f.span.start <= m.start() && m.end() <= f.span.end) {
                continue;
            }
            if Self::context_near(&BIC_CTX_RE, text, m.start(), m.end()) {
                out.push(Finding::new(
                    self.id(),
                    Category::Financial,
                    "swift_bic",
                    Span::new(m.start(), m.end()),
                    0.7,
                    Severity::Medium,
                    redact(m.as_str(), 3),
                ));
            }
        }

        out.extend(phrase_findings(
            Some(&REPORT_RE),
            text,
            self.id(),
            Category::Financial,
            "financial_report",
            0.75,
            Severity::Medium,
        ));
        out
    }
}

/// IBAN mod-97 check (ISO 13616): move the first four chars to the end, map
/// letters to 10..35, and the resulting number must be ≡ 1 (mod 97).
fn iban_valid(candidate: &str) -> bool {
    let len = candidate.len();
    if !(15..=34).contains(&len) {
        return false;
    }
    let rearranged = format!("{}{}", &candidate[4..], &candidate[..4]);
    let mut rem: u32 = 0;
    for c in rearranged.chars() {
        let v = match c {
            '0'..='9' => c as u32 - '0' as u32,
            'A'..='Z' => c as u32 - 'A' as u32 + 10,
            _ => return false,
        };
        rem = if v < 10 { (rem * 10 + v) % 97 } else { (rem * 100 + v) % 97 };
    }
    rem == 1
}

/// ABA routing-number checksum: 3(d₁+d₄+d₇) + 7(d₂+d₅+d₈) + (d₃+d₆+d₉) ≡ 0 (mod 10).
fn aba_routing_valid(digits: &str) -> bool {
    let ds: Vec<u32> = digits.chars().filter_map(|c| c.to_digit(10)).collect();
    if ds.len() != 9 {
        return false;
    }
    let sum = 3 * (ds[0] + ds[3] + ds[6]) + 7 * (ds[1] + ds[4] + ds[7]) + (ds[2] + ds[5] + ds[8]);
    sum % 10 == 0 && sum > 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(text: &str) -> Vec<Finding> {
        FinancialDetector.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn valid_iban_detected_and_redacted() {
        // Well-known IBAN example (valid mod-97).
        let f = scan("transfer to GB82WEST12345698765432 today");
        assert!(f.iter().any(|f| f.kind == "iban"));
        let iban = f.iter().find(|f| f.kind == "iban").unwrap();
        assert!(!iban.redacted_preview.contains("12345698765432"));
    }

    #[test]
    fn invalid_iban_checksum_rejected() {
        assert!(!scan("GB00WEST12345698765432").iter().any(|f| f.kind == "iban"));
    }

    #[test]
    fn routing_number_needs_checksum_and_context() {
        // 021000021 is a valid ABA number (JPMorgan Chase).
        assert!(scan("our routing number is 021000021")
            .iter()
            .any(|f| f.kind == "us_routing_number"));
        // Same digits without context are ignored…
        assert!(!scan("the id 021000021 was assigned")
            .iter()
            .any(|f| f.kind == "us_routing_number"));
        // …and a checksum-failing number with context is ignored.
        assert!(!scan("routing number 123456789")
            .iter()
            .any(|f| f.kind == "us_routing_number"));
    }

    #[test]
    fn swift_bic_needs_banking_context() {
        assert!(scan("wire via SWIFT code DEUTDEFF500 please")
            .iter()
            .any(|f| f.kind == "swift_bic"));
        assert!(!scan("the constant DEUTDEFF500 is used")
            .iter()
            .any(|f| f.kind == "swift_bic"));
    }

    #[test]
    fn report_vocabulary_detected() {
        let f = scan("paste of our Q3 balance sheet and EBITDA numbers");
        assert!(f.iter().filter(|f| f.kind == "financial_report").count() >= 2);
    }
}
