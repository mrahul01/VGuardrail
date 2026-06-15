//! Microbenchmark for the evaluator hot path (contributes to the 50ms SLO).

use std::collections::BTreeMap;

use criterion::{criterion_group, criterion_main, Criterion};
use pe_core::{
    Action, Category, Finding, Role, ScanContext, ScanInput, Severity, Span, UserContext,
};
use pe_dsl::{
    evaluate, Condition, DetectorOp, DetectorPredicate, EvalFacts, FieldOp, FieldPredicate,
    PolicyBundle, Rule,
};

fn many_rules(n: usize) -> Vec<Rule> {
    (0..n)
        .map(|i| Rule {
            rule_id: format!("rule_{i}"),
            name: format!("rule {i}"),
            description: String::new(),
            enabled: true,
            severity: Severity::High,
            priority: i as u16,
            action: Action::Warn,
            min_confidence: 0.8,
            match_: Condition::All {
                all: vec![
                    Condition::Field(FieldPredicate {
                        field: "provider".into(),
                        op: FieldOp::In,
                        value: Some(serde_json::json!(["openai", "google"])),
                    }),
                    Condition::Detector(DetectorPredicate {
                        detector: "secret.aws_access_key".into(),
                        op: DetectorOp::Found,
                        min_count: None,
                        value: None,
                    }),
                ],
            },
            params: BTreeMap::new(),
            message: String::new(),
            tags: vec![],
        })
        .collect()
}

fn bench_evaluate(c: &mut Criterion) {
    let bundle = PolicyBundle {
        schema: "vguardrail.policy/v1".into(),
        version: 1,
        previous_version: None,
        org_id: "org".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        default_action: Action::Allow,
        exceptions: vec![],
        rules: many_rules(50),
        signature: None,
    };
    let ctx = ScanContext {
        provider: Some("openai".to_string()),
        user: UserContext {
            user_id: "u1".into(),
            role: Role::User,
            groups: vec![],
        },
        ..Default::default()
    };
    let input = ScanInput::new("AKIAIOSFODNN7EXAMPLE in prompt", ctx);
    let facts = EvalFacts {
        findings: vec![Finding::new(
            "secret.aws_access_key",
            Category::Secret,
            "aws_access_key",
            Span::new(0, 20),
            0.99,
            Severity::Critical,
            "AKIA…MPLE",
        )],
        ..Default::default()
    };

    c.bench_function("evaluate_50_rules", |b| {
        b.iter(|| evaluate(&bundle, &input, &facts, 1_000))
    });
}

criterion_group!(benches, bench_evaluate);
criterion_main!(benches);
