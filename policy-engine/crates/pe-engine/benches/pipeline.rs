//! End-to-end pipeline benchmark (detectors → classify → risk → evaluate →
//! enqueue). Gates the < 50 ms p99 SLO at the engine level.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, RwLock};

use criterion::{criterion_group, criterion_main, Criterion};
use ed25519_dalek::SigningKey;
use pe_core::{Action, ManualClock, Role, ScanContext, ScanInput, Severity, UserContext};
use pe_detectors::DetectorRegistry;
use pe_dsl::{
    sign_bundle, Condition, DetectorOp, DetectorPredicate, PolicyBundle, PolicySet, Rule,
};
use pe_engine::{EngineConfig, EngineService};
use pe_store::Store;

fn service() -> EngineService {
    let key = SigningKey::from_bytes(&[1u8; 32]);
    let registry = DetectorRegistry::default_set();
    let known = registry.ids().into_iter().map(String::from).collect();
    let mut policy = PolicySet::new(key.verifying_key(), known);

    let rule = Rule {
        rule_id: "r".into(),
        name: "r".into(),
        description: String::new(),
        enabled: true,
        severity: Severity::Critical,
        priority: 1,
        action: Action::Block,
        min_confidence: 0.8,
        match_: Condition::Detector(DetectorPredicate {
            detector: "secret.aws_access_key".into(),
            op: DetectorOp::Found,
            min_count: None,
            value: None,
        }),
        params: BTreeMap::new(),
        message: String::new(),
        tags: vec![],
    };
    let bundle = PolicyBundle {
        schema: "vguardrail.policy/v1".into(),
        version: 1,
        previous_version: None,
        org_id: "org".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        default_action: Action::Allow,
        exceptions: vec![],
        rules: vec![rule],
        signature: None,
    };
    let signed = serde_json::to_vec(&sign_bundle(&bundle, &key, "k")).unwrap();
    policy.load(&signed).unwrap();

    EngineService::new(
        Arc::new(registry),
        Arc::new(RwLock::new(policy)),
        Arc::new(Mutex::new(Store::open_in_memory().unwrap())),
        Arc::new(ManualClock::new(1_000)),
        "dev-1".into(),
        EngineConfig::new(SigningKey::from_bytes(&[2u8; 32])),
    )
}

fn bench_pipeline(c: &mut Criterion) {
    let svc = service();
    let ctx = ScanContext {
        provider: Some("openai".to_string()),
        user: UserContext {
            user_id: "u1".into(),
            role: Role::User,
            groups: vec![],
        },
        ..Default::default()
    };
    let text = "Please review: AKIAIOSFODNN7EXAMPLE and email me at dev@example.com.";
    c.bench_function("engine_process_evaluate", |b| {
        b.iter(|| {
            let input = ScanInput::new(text, ctx.clone());
            svc.process(&input)
        })
    });
}

criterion_group!(benches, bench_pipeline);
criterion_main!(benches);
