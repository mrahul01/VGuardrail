//! Secret / credential detectors (doc 02 §5).
//!
//! Each is validated beyond a bare regex (prefix + structure + entropy / JWT
//! header decode) to keep false positives low, and never emits the raw value.

use base64::Engine as _;
use once_cell::sync::Lazy;
use pe_core::{
    redact, Budget, Category, Detector, Finding, ScanInput, SecretDetector, Severity, Span,
};
use regex::Regex;

use crate::util::shannon_entropy;

static AWS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:AKIA|ASIA)[0-9A-Z]{16}").unwrap());
static GITHUB_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"gh[pousr]_[A-Za-z0-9]{36,}").unwrap());
static JWT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+").unwrap());
static SSH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----").unwrap());
static GENERIC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)"?\s*[:=]\s*"?([A-Za-z0-9/+_\-]{20,})"#)
        .unwrap()
});

/// Detects AWS access key ids (`AKIA…`/`ASIA…`).
pub struct AwsKeyDetector;
impl Detector for AwsKeyDetector {
    fn id(&self) -> &'static str {
        "secret.aws_access_key"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        AWS_RE
            .find_iter(input.text)
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Secret,
                    "aws_access_key",
                    Span::new(m.start(), m.end()),
                    0.99,
                    Severity::Critical,
                    redact(m.as_str(), 4),
                )
            })
            .collect()
    }
}
impl SecretDetector for AwsKeyDetector {}

/// Detects GitHub personal/OAuth/app tokens (`ghp_`, `gho_`, …).
pub struct GithubTokenDetector;
impl Detector for GithubTokenDetector {
    fn id(&self) -> &'static str {
        "secret.github_token"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        GITHUB_RE
            .find_iter(input.text)
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Secret,
                    "github_token",
                    Span::new(m.start(), m.end()),
                    0.97,
                    Severity::High,
                    redact(m.as_str(), 4),
                )
            })
            .collect()
    }
}
impl SecretDetector for GithubTokenDetector {}

/// Detects JSON Web Tokens, validating that the header decodes to JSON with an
/// `alg` field (rejects coincidental `eyJ…` strings).
pub struct JwtDetector;
impl Detector for JwtDetector {
    fn id(&self) -> &'static str {
        "secret.jwt"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = Vec::new();
        for m in JWT_RE.find_iter(input.text) {
            let header_seg = m.as_str().split('.').next().unwrap_or("");
            if header_has_alg(header_seg) {
                out.push(Finding::new(
                    self.id(),
                    Category::Secret,
                    "jwt",
                    Span::new(m.start(), m.end()),
                    0.9,
                    Severity::High,
                    redact(m.as_str(), 4),
                ));
            }
        }
        out
    }
}
impl SecretDetector for JwtDetector {}

fn header_has_alg(b64url: &str) -> bool {
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    // Tolerate padding variations by trimming '='.
    let trimmed = b64url.trim_end_matches('=');
    let Ok(bytes) = engine.decode(trimmed) else {
        return false;
    };
    serde_json::from_slice::<serde_json::Value>(&bytes)
        .ok()
        .and_then(|v| v.get("alg").cloned())
        .is_some()
}

/// Detects PEM-armored private keys.
pub struct SshKeyDetector;
impl Detector for SshKeyDetector {
    fn id(&self) -> &'static str {
        "secret.ssh_private_key"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        SSH_RE
            .find_iter(input.text)
            .map(|m| {
                Finding::new(
                    self.id(),
                    Category::Secret,
                    "ssh_private_key",
                    Span::new(m.start(), m.end()),
                    0.99,
                    Severity::Critical,
                    "-----BEGIN…PRIVATE KEY-----".to_string(),
                )
            })
            .collect()
    }
}
impl SecretDetector for SshKeyDetector {}

/// Detects generic high-entropy secrets assigned to key-like identifiers.
pub struct GenericKeyDetector {
    /// Minimum entropy (bits/char) for the assigned value to count as a secret.
    pub entropy_threshold: f64,
}

impl Default for GenericKeyDetector {
    fn default() -> Self {
        Self {
            entropy_threshold: 3.5,
        }
    }
}

impl Detector for GenericKeyDetector {
    fn id(&self) -> &'static str {
        "secret.generic_api_key"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = Vec::new();
        for caps in GENERIC_RE.captures_iter(input.text) {
            let Some(val) = caps.get(1) else { continue };
            let entropy = shannon_entropy(val.as_str());
            if entropy < self.entropy_threshold {
                continue;
            }
            // Map entropy to a confidence in [0.7, 0.9].
            let confidence = (0.7 + (entropy - self.entropy_threshold) * 0.1).min(0.9) as f32;
            out.push(
                Finding::new(
                    self.id(),
                    Category::Secret,
                    "generic_api_key",
                    Span::new(val.start(), val.end()),
                    confidence,
                    Severity::Medium,
                    redact(val.as_str(), 3),
                )
                .with_meta("entropy", format!("{entropy:.2}")),
            );
        }
        out
    }
}
impl SecretDetector for GenericKeyDetector {}

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
    fn aws_key_detected_and_redacted() {
        let f = scan(&AwsKeyDetector, "key=AKIAIOSFODNN7EXAMPLE end");
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].kind, "aws_access_key");
        assert!(!f[0].redacted_preview.contains("IOSFODNN"));
    }

    #[test]
    fn aws_key_not_falsely_detected() {
        assert!(scan(&AwsKeyDetector, "just some normal prose here").is_empty());
    }

    #[test]
    fn github_token_detected() {
        let token = format!("ghp_{}", "a".repeat(36));
        assert_eq!(scan(&GithubTokenDetector, &token).len(), 1);
    }

    #[test]
    fn jwt_requires_valid_header() {
        // Real JWT header {"alg":"HS256","typ":"JWT"} base64url:
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123signature";
        assert_eq!(scan(&JwtDetector, jwt).len(), 1);
        // A look-alike whose header is not valid JSON-with-alg is ignored.
        let fake = "eyJxxxx.eyJzdWIiOiIxIn0.sig";
        assert!(scan(&JwtDetector, fake).is_empty());
    }

    #[test]
    fn ssh_private_key_detected() {
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----";
        assert_eq!(scan(&SshKeyDetector, pem).len(), 1);
    }

    #[test]
    fn generic_key_uses_entropy() {
        let d = GenericKeyDetector::default();
        // High-entropy value → detected.
        let hits = scan(&d, "api_key = \"aZ3kQ8pL2xR9tW4nB7mC1vD6\"");
        assert_eq!(hits.len(), 1);
        // Low-entropy value → ignored.
        assert!(scan(&d, "api_key = \"aaaaaaaaaaaaaaaaaaaaaa\"").is_empty());
    }
}
