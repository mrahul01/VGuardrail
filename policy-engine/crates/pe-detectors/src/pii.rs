//! PII detectors (doc 02 §5): email, phone (NANP/E.164), credit card (Luhn),
//! and a configurable customer-id detector.

use once_cell::sync::Lazy;
use pe_core::{
    redact, Budget, Category, Detector, Finding, PiiDetector, ScanInput, Severity, Span,
};
use regex::Regex;

use crate::util::{card_network, luhn_valid};

static EMAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").unwrap());
static PHONE_RE: Lazy<Regex> = Lazy::new(|| {
    // NANP with optional +1 and separators, or E.164.
    Regex::new(r"(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}|\+\d{8,15}").unwrap()
});
static CARD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d(?:[ \-]?\d){12,18}").unwrap());

/// Detects email addresses.
pub struct EmailDetector;
impl Detector for EmailDetector {
    fn id(&self) -> &'static str {
        "pii.email"
    }
    fn category(&self) -> Category {
        Category::Pii
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        EMAIL_RE
            .find_iter(input.text)
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Pii,
                    "email",
                    Span::new(m.start(), m.end()),
                    0.9,
                    Severity::Medium,
                    redact(m.as_str(), 2),
                )
            })
            .collect()
    }
}
impl PiiDetector for EmailDetector {}

/// Detects phone numbers (NANP and E.164).
pub struct PhoneDetector;
impl Detector for PhoneDetector {
    fn id(&self) -> &'static str {
        "pii.phone"
    }
    fn category(&self) -> Category {
        Category::Pii
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        PHONE_RE
            .find_iter(input.text)
            .filter(|m| {
                // Require at least 10 digits to avoid matching short numerics.
                m.as_str().chars().filter(char::is_ascii_digit).count() >= 10
            })
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Pii,
                    "phone",
                    Span::new(m.start(), m.end()),
                    0.8,
                    Severity::Medium,
                    redact(m.as_str(), 2),
                )
            })
            .collect()
    }
}
impl PiiDetector for PhoneDetector {}

/// Detects credit-card numbers via IIN + Luhn (rejects most non-card digit runs).
pub struct CreditCardDetector;
impl Detector for CreditCardDetector {
    fn id(&self) -> &'static str {
        "pii.credit_card"
    }
    fn category(&self) -> Category {
        Category::Pii
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = Vec::new();
        for m in CARD_RE.find_iter(input.text) {
            let digits: String = m.as_str().chars().filter(char::is_ascii_digit).collect();
            if !luhn_valid(&digits) {
                continue;
            }
            out.push(
                Finding::new(
                    self.id(),
                    Category::Pii,
                    "credit_card",
                    Span::new(m.start(), m.end()),
                    0.97,
                    Severity::High,
                    redact(&digits, 2),
                )
                .with_meta("card_network", card_network(&digits)),
            );
        }
        out
    }
}
impl PiiDetector for CreditCardDetector {}

/// Detects organisation-specific customer ids via a configurable pattern.
pub struct CustomerIdDetector {
    re: Regex,
}

impl CustomerIdDetector {
    /// Builds a detector from a regex pattern (engine-level config, doc 00 P-08).
    ///
    /// # Errors
    /// Returns the [`regex::Error`] if `pattern` does not compile.
    pub fn new(pattern: &str) -> Result<Self, regex::Error> {
        Ok(Self {
            re: Regex::new(pattern)?,
        })
    }
}

impl Default for CustomerIdDetector {
    fn default() -> Self {
        // Conservative default; tenants override via DetectorConfig.
        Self::new(r"\bCUST-\d{6,}\b").expect("default customer-id pattern is valid")
    }
}

impl Detector for CustomerIdDetector {
    fn id(&self) -> &'static str {
        "pii.customer_id"
    }
    fn category(&self) -> Category {
        Category::Pii
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        self.re
            .find_iter(input.text)
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Pii,
                    "customer_id",
                    Span::new(m.start(), m.end()),
                    0.85,
                    Severity::Medium,
                    redact(m.as_str(), 3),
                )
            })
            .collect()
    }
}
impl PiiDetector for CustomerIdDetector {}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn scan(d: &dyn Detector, text: &str) -> Vec<Finding> {
        d.scan(
            &ScanInput::new(text, ScanContext::default()),
            &Budget::unlimited(),
        )
    }

    #[test]
    fn email_detected() {
        let f = scan(&EmailDetector, "contact alice@example.com please");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "email");
    }

    #[test]
    fn phone_detected_nanp_and_e164() {
        assert_eq!(scan(&PhoneDetector, "call 415-555-0132 now").len(), 1);
        assert_eq!(scan(&PhoneDetector, "intl +442071838750 ok").len(), 1);
        assert!(scan(&PhoneDetector, "order 12 items").is_empty());
    }

    #[test]
    fn credit_card_requires_luhn() {
        let f = scan(&CreditCardDetector, "card 4111 1111 1111 1111 ok");
        assert_eq!(f.len(), 1);
        assert_eq!(
            f[0].meta.get("card_network").map(String::as_str),
            Some("visa")
        );
        // Luhn-invalid digit run is ignored.
        assert!(scan(&CreditCardDetector, "id 1234567890123456 here").is_empty());
    }

    #[test]
    fn customer_id_default_pattern() {
        assert_eq!(
            scan(&CustomerIdDetector::default(), "user CUST-001234 logged in").len(),
            1
        );
        assert!(scan(&CustomerIdDetector::default(), "user 001234").is_empty());
    }

    #[test]
    fn customer_id_custom_pattern() {
        let d = CustomerIdDetector::new(r"\bACME\d{4}\b").unwrap();
        assert_eq!(scan(&d, "acct ACME9999 active").len(), 1);
    }
}
