//! Sensitive infrastructure-information detection: extends the secret category
//! with identifiers that reveal internal topology or grant access — RFC-1918
//! internal IPs, AWS account ids / ARNs, database connection strings, and
//! org-configured internal domain names.
//!
//! Findings stay in [`Category::Secret`] (kinds distinguish them) so existing
//! secret-targeting rules apply; connection strings with embedded credentials
//! are `Critical` (engine force-block), topology identifiers are `Medium`.

use once_cell::sync::Lazy;
use pe_core::{redact, Budget, Category, Detector, Finding, ScanInput, SecretDetector, Severity, Span};
use regex::Regex;

static IPV4_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b").unwrap());
/// 12-digit AWS account id, gated on nearby AWS context to avoid flagging any
/// 12-digit number.
static AWS_ACCOUNT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{12}\b").unwrap());
static AWS_CTX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\baws\b|\baccount\s*(?:id)?\b|\biam\b|\bsts\b").unwrap());
static ARN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\barn:aws[a-z\-]*:[a-z0-9\-]+:[a-z0-9\-]*:\d{12}:\S+").unwrap());
/// Connection strings with embedded credentials (`scheme://user:pass@host`).
static DB_CONN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql|jdbc:[a-z]+)://[^\s:@/]+:[^\s@/]+@[^\s/]+",
    )
    .unwrap()
});

const CTX_WINDOW: usize = 48;

fn is_rfc1918(octets: [u8; 4]) -> bool {
    matches!(octets, [10, ..])
        || matches!(octets, [172, b, ..] if (16..=31).contains(&b))
        || matches!(octets, [192, 168, ..])
}

/// Detects internal IPs, AWS identifiers, DB connection strings, and internal
/// domains. Individual signal families are switchable via config.
pub struct SensitiveInfoDetector {
    enabled: bool,
    internal_ip: bool,
    aws_account_id: bool,
    domains: Option<Regex>,
}

impl SensitiveInfoDetector {
    /// Builds the detector from config; `internal_domains` are literal domain
    /// suffixes (e.g. `corp.example.com`, `.internal`).
    ///
    /// # Errors
    /// Returns a [`regex::Error`] if a configured domain cannot compile.
    pub fn new(
        enabled: bool,
        internal_ip: bool,
        aws_account_id: bool,
        internal_domains: &[String],
    ) -> Result<Self, regex::Error> {
        let suffixes: Vec<String> = internal_domains
            .iter()
            .map(|d| d.trim().trim_start_matches('.'))
            .filter(|d| !d.is_empty())
            .map(regex::escape)
            .collect();
        let domains = if suffixes.is_empty() {
            None
        } else {
            Some(Regex::new(&format!(
                r"(?i)\b[\w.-]*\.(?:{})\b",
                suffixes.join("|")
            ))?)
        };
        Ok(Self {
            enabled,
            internal_ip,
            aws_account_id,
            domains,
        })
    }

    fn context_near(text: &str, start: usize, end: usize) -> bool {
        let lo = start.saturating_sub(CTX_WINDOW);
        let hi = (end + CTX_WINDOW).min(text.len());
        let lo = (0..=lo).rev().find(|&i| text.is_char_boundary(i)).unwrap_or(0);
        let hi = (hi..=text.len())
            .find(|&i| text.is_char_boundary(i))
            .unwrap_or(text.len());
        AWS_CTX_RE.is_match(&text[lo..hi])
    }
}

impl Detector for SensitiveInfoDetector {
    fn id(&self) -> &'static str {
        "secret.sensitive_info"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        if !self.enabled {
            return Vec::new();
        }
        let text = input.text;
        let mut out = Vec::new();

        // Connection strings first: highest severity, and their host part must
        // not be re-reported as an internal IP/domain below.
        for m in DB_CONN_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::Secret,
                "db_connection_string",
                Span::new(m.start(), m.end()),
                0.95,
                Severity::Critical,
                redact(m.as_str(), 8),
            ));
        }
        let claimed = |s: usize, e: usize, out: &[Finding]| {
            out.iter().any(|f| f.span.start <= s && e <= f.span.end)
        };

        if self.internal_ip {
            for caps in IPV4_RE.captures_iter(text) {
                let m = caps.get(0).expect("whole match");
                if claimed(m.start(), m.end(), &out) {
                    continue;
                }
                let octets: Option<Vec<u8>> =
                    (1..=4).map(|i| caps[i].parse::<u8>().ok()).collect();
                let Some(o) = octets else { continue };
                if is_rfc1918([o[0], o[1], o[2], o[3]]) {
                    out.push(Finding::new(
                        self.id(),
                        Category::Secret,
                        "internal_ip",
                        Span::new(m.start(), m.end()),
                        0.8,
                        Severity::Medium,
                        redact(m.as_str(), 3),
                    ));
                }
            }
        }

        for m in ARN_RE.find_iter(text) {
            out.push(Finding::new(
                self.id(),
                Category::Secret,
                "aws_arn",
                Span::new(m.start(), m.end()),
                0.95,
                Severity::High,
                redact(m.as_str(), 8),
            ));
        }

        if self.aws_account_id {
            for m in AWS_ACCOUNT_RE.find_iter(text) {
                if claimed(m.start(), m.end(), &out) {
                    continue; // already inside an ARN
                }
                if Self::context_near(text, m.start(), m.end()) {
                    out.push(Finding::new(
                        self.id(),
                        Category::Secret,
                        "aws_account_id",
                        Span::new(m.start(), m.end()),
                        0.85,
                        Severity::High,
                        redact(m.as_str(), 3),
                    ));
                }
            }
        }

        if let Some(re) = &self.domains {
            for m in re.find_iter(text) {
                if claimed(m.start(), m.end(), &out) {
                    continue;
                }
                out.push(Finding::new(
                    self.id(),
                    Category::Secret,
                    "internal_domain",
                    Span::new(m.start(), m.end()),
                    0.85,
                    Severity::Medium,
                    m.as_str().to_lowercase(),
                ));
            }
        }
        out
    }
}
impl SecretDetector for SensitiveInfoDetector {}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::ScanContext;

    fn detector() -> SensitiveInfoDetector {
        SensitiveInfoDetector::new(true, true, true, &["corp.example.com".to_string()]).unwrap()
    }

    fn kinds(text: &str) -> Vec<String> {
        detector()
            .scan(
                &ScanInput::new(text, ScanContext::default()),
                &Budget::unlimited(),
            )
            .into_iter()
            .map(|f| f.kind)
            .collect()
    }

    #[test]
    fn rfc1918_ips_detected_public_ips_ignored() {
        assert_eq!(kinds("ssh into 10.1.2.3 please"), vec!["internal_ip"]);
        assert_eq!(kinds("server at 172.20.0.9"), vec!["internal_ip"]);
        assert_eq!(kinds("router 192.168.1.1"), vec!["internal_ip"]);
        assert!(kinds("ping 8.8.8.8 and 172.32.0.1").is_empty(), "public IPs ignored");
    }

    #[test]
    fn aws_account_needs_context_arn_does_not() {
        assert_eq!(kinds("our AWS account id is 123456789012"), vec!["aws_account_id"]);
        assert!(kinds("invoice number 123456789012 attached").is_empty());
        assert_eq!(
            kinds("role arn:aws:iam::123456789012:role/admin"),
            vec!["aws_arn"]
        );
    }

    #[test]
    fn db_connection_string_is_critical_and_redacted() {
        let f = detector().scan(
            &ScanInput::new(
                "use postgres://admin:hunter2@db.prod:5432/main",
                ScanContext::default(),
            ),
            &Budget::unlimited(),
        );
        assert_eq!(f.len(), 1, "host IP/domain not double-reported");
        assert_eq!(f[0].kind, "db_connection_string");
        assert_eq!(f[0].severity, Severity::Critical);
        assert!(!f[0].redacted_preview.contains("hunter2"));
    }

    #[test]
    fn internal_domains_are_configurable() {
        assert_eq!(
            kinds("deploy to api.corp.example.com today"),
            vec!["internal_domain"]
        );
        assert!(kinds("see example.com docs").is_empty());
        let none = SensitiveInfoDetector::new(true, true, true, &[]).unwrap();
        assert!(none
            .scan(
                &ScanInput::new("api.corp.example.com", ScanContext::default()),
                &Budget::unlimited()
            )
            .is_empty());
    }

    #[test]
    fn switches_disable_families() {
        let d = SensitiveInfoDetector::new(true, false, false, &[]).unwrap();
        let f = d.scan(
            &ScanInput::new("10.0.0.5 in AWS account 123456789012", ScanContext::default()),
            &Budget::unlimited(),
        );
        assert!(f.is_empty());
        let off = SensitiveInfoDetector::new(false, true, true, &[]).unwrap();
        assert!(off
            .scan(
                &ScanInput::new("10.0.0.5", ScanContext::default()),
                &Budget::unlimited()
            )
            .is_empty());
    }
}
