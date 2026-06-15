//! End-to-end evaluator tests: precedence, exceptions, expiry, default action,
//! and a full signed-bundle load path.

use std::collections::{BTreeMap, HashSet};

use ed25519_dalek::SigningKey;
use pe_core::{
    Action, Category, Classification, Finding, Role, ScanContext, ScanInput, Severity, Span,
    UserContext,
};
use pe_dsl::{
    evaluate, sign_bundle, Condition, DetectorOp, DetectorPredicate, EvalFacts, Exception, FieldOp,
    FieldPredicate, PolicyBundle, PolicySet, Rule, Subject, SubjectKind,
};

fn detector_cond(detector: &str, op: DetectorOp) -> Condition {
    Condition::Detector(DetectorPredicate {
        detector: detector.to_string(),
        op,
        min_count: None,
        value: None,
    })
}

fn rule(rule_id: &str, action: Action, severity: Severity, priority: u16, cond: Condition) -> Rule {
    Rule {
        rule_id: rule_id.to_string(),
        name: rule_id.to_string(),
        description: String::new(),
        enabled: true,
        severity,
        priority,
        action,
        min_confidence: 0.8,
        match_: cond,
        params: BTreeMap::new(),
        message: String::new(),
        tags: vec![],
    }
}

fn bundle(default: Action, rules: Vec<Rule>, exceptions: Vec<Exception>) -> PolicyBundle {
    PolicyBundle {
        schema: "vguardrail.policy/v1".into(),
        version: 1,
        previous_version: None,
        org_id: "org".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        default_action: default,
        exceptions,
        rules,
        signature: None,
    }
}

fn input_with_user(user_id: &str, groups: Vec<&str>) -> (ScanContext,) {
    (ScanContext {
        provider: Some("openai".to_string()),
        user: UserContext {
            user_id: user_id.to_string(),
            role: Role::User,
            groups: groups.into_iter().map(String::from).collect(),
        },
        ..Default::default()
    },)
}

fn aws_finding() -> Finding {
    Finding::new(
        "secret.aws_access_key",
        Category::Secret,
        "aws_access_key",
        Span::new(0, 20),
        0.99,
        Severity::Critical,
        "AKIA…MPLE",
    )
}

#[test]
fn block_beats_warn_on_same_input() {
    let rules = vec![
        rule(
            "warn_rule",
            Action::Warn,
            Severity::Medium,
            100,
            detector_cond("secret.aws_access_key", DetectorOp::Found),
        ),
        rule(
            "block_rule",
            Action::Block,
            Severity::Critical,
            100,
            detector_cond("secret.aws_access_key", DetectorOp::Found),
        ),
    ];
    let b = bundle(Action::Allow, rules, vec![]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    let d = evaluate(&b, &input, &facts, 1_000);
    assert_eq!(d.action, Action::Block);
    assert_eq!(d.matched_rule_id.as_deref(), Some("block_rule"));
}

#[test]
fn confidence_below_threshold_does_not_trigger() {
    let rules = vec![rule(
        "block_rule",
        Action::Block,
        Severity::Critical,
        100,
        detector_cond("secret.aws_access_key", DetectorOp::Found),
    )];
    let b = bundle(Action::Allow, rules, vec![]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("maybe", ctx);
    let mut low = aws_finding();
    low.confidence = 0.5; // below rule min_confidence 0.8
    let facts = EvalFacts {
        findings: vec![low],
        ..Default::default()
    };
    let d = evaluate(&b, &input, &facts, 1_000);
    assert_eq!(
        d.action,
        Action::Allow,
        "default action since finding gated"
    );
    assert!(d.matched_rule_id.is_none());
}

#[test]
fn active_exception_suppresses_rule_and_is_recorded() {
    let rules = vec![rule(
        "block_rule",
        Action::Block,
        Severity::Critical,
        100,
        detector_cond("secret.aws_access_key", DetectorOp::Found),
    )];
    let exc = Exception {
        exception_id: "exc1".into(),
        rule_id: "block_rule".into(),
        subject: Subject {
            kind: SubjectKind::User,
            id: "u1".into(),
        },
        approved_by: "secadmin".into(),
        reason: "sanctioned tool".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        expires_at: 10_000,
    };
    let b = bundle(Action::Warn, rules, vec![exc]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    // now < expiry → suppressed → falls through to default (warn).
    let d = evaluate(&b, &input, &facts, 1_000);
    assert_eq!(d.action, Action::Warn);
    assert!(d.matched_rule_id.is_none());
    assert_eq!(d.suppressions.len(), 1);
    assert_eq!(d.suppressions[0].exception_id, "exc1");
}

#[test]
fn expired_exception_does_not_suppress() {
    let rules = vec![rule(
        "block_rule",
        Action::Block,
        Severity::Critical,
        100,
        detector_cond("secret.aws_access_key", DetectorOp::Found),
    )];
    let exc = Exception {
        exception_id: "exc1".into(),
        rule_id: "block_rule".into(),
        subject: Subject {
            kind: SubjectKind::User,
            id: "u1".into(),
        },
        approved_by: "secadmin".into(),
        reason: "sanctioned tool".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        expires_at: 500,
    };
    let b = bundle(Action::Warn, rules, vec![exc]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    // now > expiry → exception inert → block enforced.
    let d = evaluate(&b, &input, &facts, 1_000);
    assert_eq!(d.action, Action::Block);
    assert!(d.suppressions.is_empty());
}

#[test]
fn exception_for_other_user_does_not_apply() {
    let rules = vec![rule(
        "block_rule",
        Action::Block,
        Severity::Critical,
        100,
        detector_cond("secret.aws_access_key", DetectorOp::Found),
    )];
    let exc = Exception {
        exception_id: "exc1".into(),
        rule_id: "block_rule".into(),
        subject: Subject {
            kind: SubjectKind::User,
            id: "someone_else".into(),
        },
        approved_by: "secadmin".into(),
        reason: "n/a".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        expires_at: 10_000,
    };
    let b = bundle(Action::Warn, rules, vec![exc]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    let d = evaluate(&b, &input, &facts, 1_000);
    assert_eq!(d.action, Action::Block);
}

#[test]
fn field_and_detector_combine() {
    let cond = Condition::All {
        all: vec![
            Condition::Field(FieldPredicate {
                field: "provider".into(),
                op: FieldOp::In,
                value: Some(serde_json::json!(["openai", "google"])),
            }),
            detector_cond("secret.aws_access_key", DetectorOp::Found),
        ],
    };
    let rules = vec![rule("r", Action::Block, Severity::High, 100, cond)];
    let b = bundle(Action::Allow, rules, vec![]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    assert_eq!(evaluate(&b, &input, &facts, 1).action, Action::Block);
}

#[test]
fn classification_at_least_predicate() {
    let cond = Condition::Detector(DetectorPredicate {
        detector: "classification".into(),
        op: DetectorOp::AtLeast,
        min_count: None,
        value: Some(serde_json::json!("confidential")),
    });
    let rules = vec![rule("r", Action::Warn, Severity::Medium, 100, cond)];
    let b = bundle(Action::Allow, rules, vec![]);
    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("text", ctx);

    let restricted = EvalFacts {
        classification: Classification::Restricted,
        ..Default::default()
    };
    assert_eq!(evaluate(&b, &input, &restricted, 1).action, Action::Warn);

    let public = EvalFacts {
        classification: Classification::Public,
        ..Default::default()
    };
    assert_eq!(evaluate(&b, &input, &public, 1).action, Action::Allow);
}

#[test]
fn full_signed_bundle_loads_and_evaluates() {
    let sk = SigningKey::from_bytes(&[11u8; 32]);
    let rules = vec![rule(
        "block_rule",
        Action::Block,
        Severity::Critical,
        100,
        detector_cond("secret.aws_access_key", DetectorOp::Found),
    )];
    let signed = sign_bundle(&bundle(Action::Warn, rules, vec![]), &sk, "k");
    let json = serde_json::to_vec(&signed).unwrap();

    let mut known = HashSet::new();
    known.insert("secret.aws_access_key".to_string());
    let mut set = PolicySet::new(sk.verifying_key(), known);
    let res = set.load(&json).unwrap();
    assert_eq!(res.active_version, 1);

    let (ctx,) = input_with_user("u1", vec![]);
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE", ctx);
    let facts = EvalFacts {
        findings: vec![aws_finding()],
        ..Default::default()
    };
    let d = evaluate(set.current().unwrap(), &input, &facts, 1_000);
    assert_eq!(d.action, Action::Block);
}
