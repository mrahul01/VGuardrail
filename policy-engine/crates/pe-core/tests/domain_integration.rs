//! Integration tests exercising the public `pe-core` surface as a consumer would.

use std::collections::BTreeMap;

use pe_core::{
    redact, Action, Budget, Category, Classification, Clock, Decision, Detector, Finding,
    ManualClock, RiskLevel, Role, ScanContext, ScanInput, Severity, Span, Suppression, UserContext,
};

/// A detector that flags the literal `AKIA...` prefix, used to prove the public
/// trait surface composes end-to-end.
struct FakeAwsDetector;

impl Detector for FakeAwsDetector {
    fn id(&self) -> &'static str {
        "secret.aws_access_key"
    }
    fn category(&self) -> Category {
        Category::Secret
    }
    fn scan(&self, input: &ScanInput<'_>, _budget: &Budget) -> Vec<Finding> {
        let mut out = Vec::new();
        if let Some(idx) = input.text.find("AKIA") {
            let raw = &input.text[idx..(idx + 20).min(input.text.len())];
            out.push(Finding::new(
                self.id(),
                Category::Secret,
                "aws_access_key",
                Span::new(idx, idx + raw.len()),
                0.99,
                Severity::Critical,
                redact(raw, 4),
            ));
        }
        out
    }
}

#[test]
fn detector_to_decision_flow_via_public_api() {
    let ctx = ScanContext {
        provider: Some("openai".to_string()),
        user: UserContext {
            user_id: "user_1".to_string(),
            role: Role::User,
            groups: vec!["eng".to_string()],
        },
        ..Default::default()
    };
    let input = ScanInput::new("here is AKIAIOSFODNN7EXAMPLE in my prompt", ctx);

    let detector = FakeAwsDetector;
    let findings = detector.scan(&input, &Budget::unlimited());
    assert_eq!(findings.len(), 1);
    assert_eq!(findings[0].kind, "aws_access_key");
    assert!(!findings[0].redacted_preview.contains("IOSFODNN"));

    // Assemble a decision as the engine would.
    let decision = Decision {
        action: Action::Block,
        matched_rule_id: Some("rule_aws_block".to_string()),
        severity: Some(Severity::Critical),
        risk_level: RiskLevel::Critical,
        classification: Classification::Restricted,
        category: Some(Category::Secret),
        findings: findings.clone(),
        suppressions: vec![Suppression {
            rule_id: "rule_other".to_string(),
            exception_id: "exc_1".to_string(),
        }],
        reason: "matched secret.aws_access_key".to_string(),
        policy_version: 42,
        incomplete: false,
    };

    assert!(decision.is_block());

    // Round-trips through JSON without leaking the raw secret.
    let json = serde_json::to_string(&decision).unwrap();
    assert!(!json.contains("AKIAIOSFODNN7EXAMPLE"));
    let back: Decision = serde_json::from_str(&json).unwrap();
    assert_eq!(back, decision);
}

#[test]
fn manual_clock_supports_exception_expiry_logic() {
    let clock = ManualClock::new(1_000);
    let expires_at = 1_500;
    assert!(clock.now_millis() < expires_at, "exception still active");
    clock.advance(1_000);
    assert!(clock.now_millis() >= expires_at, "exception expired");
}

#[test]
fn finding_meta_is_preserved() {
    let mut expected = BTreeMap::new();
    expected.insert("card_network".to_string(), "visa".to_string());
    let f = Finding::new(
        "pii.credit_card",
        Category::Pii,
        "credit_card",
        Span::new(0, 16),
        0.95,
        Severity::High,
        "…",
    )
    .with_meta("card_network", "visa");
    assert_eq!(f.meta, expected);
}
