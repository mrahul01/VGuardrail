//! End-to-end engine tests: load a signed policy, evaluate prompts through the
//! full pipeline, and verify decisions, risk, exceptions, fail-closed loading,
//! and audit-event enqueueing.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, RwLock};

use ed25519_dalek::SigningKey;
use pe_core::{
    Action, Classification, ManualClock, RiskLevel, Role, ScanContext, ScanInput, Severity,
    UserContext,
};
use pe_detectors::DetectorRegistry;
use pe_dsl::{
    sign_bundle, Condition, DetectorOp, DetectorPredicate, Exception, FieldOp, FieldPredicate,
    PolicyBundle, PolicySet, Rule, Subject, SubjectKind,
};
use pe_engine::{EngineConfig, EngineService};
use pe_store::{EventStatus, Store};

const POLICY_SEED: [u8; 32] = [21u8; 32];
const EVENT_SEED: [u8; 32] = [22u8; 32];

fn policy_key() -> SigningKey {
    SigningKey::from_bytes(&POLICY_SEED)
}

fn block_rule() -> Rule {
    Rule {
        rule_id: "rule_aws_block".into(),
        name: "Block AWS keys to external AI".into(),
        description: String::new(),
        enabled: true,
        severity: Severity::Critical,
        priority: 100,
        action: Action::Block,
        min_confidence: 0.8,
        match_: Condition::All {
            all: vec![
                Condition::Field(FieldPredicate {
                    field: "provider".into(),
                    op: FieldOp::In,
                    value: Some(serde_json::json!(["openai", "anthropic"])),
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
        message: "AWS credentials may not be sent to external AI.".into(),
        tags: vec![],
    }
}

fn bundle(rules: Vec<Rule>, exceptions: Vec<Exception>) -> PolicyBundle {
    PolicyBundle {
        schema: "vguardrail.policy/v1".into(),
        version: 1,
        previous_version: None,
        org_id: "org".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        default_action: Action::Allow,
        exceptions,
        rules,
        signature: None,
    }
}

fn signed_bytes(b: &PolicyBundle) -> Vec<u8> {
    serde_json::to_vec(&sign_bundle(b, &policy_key(), "k")).unwrap()
}

fn build_service(now_ms: i64) -> EngineService {
    let registry = DetectorRegistry::default_set();
    let known = registry.ids().into_iter().map(String::from).collect();
    let policy = PolicySet::new(policy_key().verifying_key(), known);
    let store = Store::open_in_memory().unwrap();
    let clock = Arc::new(ManualClock::new(now_ms));
    let config = EngineConfig::new(SigningKey::from_bytes(&EVENT_SEED));
    EngineService::new(
        Arc::new(registry),
        Arc::new(RwLock::new(policy)),
        Arc::new(Mutex::new(store)),
        clock,
        "dev-1".into(),
        config,
    )
}

fn input<'a>(text: &'a str, provider: &str, user: &str, groups: Vec<&str>) -> ScanInput<'a> {
    let ctx = ScanContext {
        provider: Some(provider.to_string()),
        user: UserContext {
            user_id: user.to_string(),
            role: Role::User,
            groups: groups.into_iter().map(String::from).collect(),
        },
        ..Default::default()
    };
    ScanInput::new(text, ctx)
}

#[test]
fn loads_policy_and_blocks_aws_key() {
    let svc = build_service(1_000);
    let out = svc.load_policy_bytes(&signed_bytes(&bundle(vec![block_rule()], vec![])));
    assert!(out.accepted);
    assert_eq!(out.active_version, 1);

    let decision = svc.process(&input(
        "deploy with AKIAIOSFODNN7EXAMPLE now",
        "openai",
        "alice",
        vec![],
    ));
    assert_eq!(decision.action, Action::Block);
    assert_eq!(decision.matched_rule_id.as_deref(), Some("rule_aws_block"));
    assert_eq!(decision.risk_level, RiskLevel::Critical);
    assert_eq!(decision.classification, Classification::Restricted);
    assert!(decision.findings.iter().any(|f| f.kind == "aws_access_key"));
    // No raw secret leaks into the decision.
    let blob = format!("{decision:?}");
    assert!(!blob.contains("AKIAIOSFODNN7EXAMPLE"));
}

#[test]
fn clean_prompt_falls_through_to_default_allow() {
    let svc = build_service(1_000);
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![block_rule()], vec![])));
    let decision = svc.process(&input("just a normal question", "openai", "alice", vec![]));
    assert_eq!(decision.action, Action::Allow);
    assert!(decision.matched_rule_id.is_none());
}

#[test]
fn no_policy_uses_bootstrap_warn() {
    let svc = build_service(1_000);
    // No policy loaded → fail-closed bootstrap (Warn), never silent Allow.
    // (A non-critical finding: criticals now force-block regardless.)
    let decision = svc.process(&input("mail me at someone@example.com", "openai", "alice", vec![]));
    assert_eq!(decision.action, Action::Warn);
    assert_eq!(decision.policy_version, 0);

    // A critical finding escalates past the bootstrap Warn.
    let critical = svc.process(&input("AKIAIOSFODNN7EXAMPLE", "openai", "alice", vec![]));
    assert_eq!(critical.action, Action::Block);
}

#[test]
fn active_exception_suppresses_block() {
    let exc = Exception {
        exception_id: "exc1".into(),
        rule_id: "rule_aws_block".into(),
        subject: Subject {
            kind: SubjectKind::User,
            id: "alice".into(),
        },
        approved_by: "secadmin".into(),
        reason: "sanctioned rotation tool".into(),
        created_at: "2026-06-04T00:00:00Z".into(),
        expires_at: 10_000,
    };
    let svc = build_service(1_000); // now=1_000 < expiry=10_000
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![block_rule()], vec![exc])));
    let decision = svc.process(&input("AKIAIOSFODNN7EXAMPLE", "openai", "alice", vec![]));
    assert_eq!(decision.action, Action::Allow, "suppressed → default allow");
    assert_eq!(decision.suppressions.len(), 1);
    assert_eq!(decision.suppressions[0].exception_id, "exc1");
}

#[test]
fn tampered_bundle_is_rejected_fail_closed() {
    let svc = build_service(1_000);
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![block_rule()], vec![])));

    // Tamper after signing.
    let signed = sign_bundle(&bundle(vec![block_rule()], vec![]), &policy_key(), "k");
    let mut v = serde_json::to_value(&signed).unwrap();
    v["version"] = serde_json::json!(99);
    let out = svc.load_policy_bytes(&serde_json::to_vec(&v).unwrap());
    assert!(!out.accepted);
    assert_eq!(
        out.active_version, 1,
        "active policy unchanged on rejection"
    );
}

#[test]
fn evaluation_enqueues_audit_events() {
    let svc = build_service(1_000);
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![block_rule()], vec![])));
    let _ = svc.process(&input("AKIAIOSFODNN7EXAMPLE", "openai", "alice", vec![]));

    // A block produces PolicyEvaluated + PromptBlocked → 2 pending events.
    let (_, queued) = svc.health_snapshot();
    assert_eq!(queued, 2);
    let _ = EventStatus::Pending; // status type referenced
}

// ── High-critical force block (doc 3C) ───────────────────────────────────────

#[test]
fn critical_finding_force_blocks_even_without_matching_rule() {
    // No rules at all; tenant default is Allow — but a critical detection
    // (destructive command) must still block.
    let svc = build_service(1_000);
    let out = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));
    assert!(out.accepted);

    let decision = svc.process(&input("please run rm -rf / on the box", "openai", "alice", vec![]));
    assert_eq!(decision.action, Action::Block);
    assert!(decision.reason.contains("force-block"));
    assert_eq!(decision.risk_level, RiskLevel::Critical);

    let dbstr = svc.process(&input(
        "connect via postgres://root:s3cret@10.0.0.5:5432/prod",
        "openai",
        "alice",
        vec![],
    ));
    assert_eq!(dbstr.action, Action::Block, "credentialed conn string is critical");
}

#[test]
fn non_critical_findings_do_not_force_block() {
    let svc = build_service(1_000);
    let out = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));
    assert!(out.accepted);

    // Internal IP alone is Medium severity → default Allow stands.
    let decision = svc.process(&input("ping 192.168.1.10 for me", "openai", "alice", vec![]));
    assert_ne!(decision.action, Action::Block);
}

#[test]
fn force_block_can_be_disabled_by_config() {
    use ed25519_dalek::SigningKey;
    let registry = DetectorRegistry::default_set();
    let known = registry.ids().into_iter().map(String::from).collect();
    let policy = PolicySet::new(policy_key().verifying_key(), known);
    let store = Store::open_in_memory().unwrap();
    let mut config = EngineConfig::new(SigningKey::from_bytes(&EVENT_SEED));
    config.critical_force_block = false;
    let svc = EngineService::new(
        Arc::new(registry),
        Arc::new(RwLock::new(policy)),
        Arc::new(Mutex::new(store)),
        Arc::new(ManualClock::new(1_000)),
        "dev-1".into(),
        config,
    );
    let out = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));
    assert!(out.accepted);

    let decision = svc.process(&input("run rm -rf / now", "openai", "alice", vec![]));
    assert_ne!(
        decision.action,
        Action::Block,
        "with force-block disabled the tenant default applies"
    );
}

// ── LLM category attribution + code-classifier chain ────────────────────────

/// One-shot stub HTTP server answering any POST with `body`.
fn serve_raw_once(body: &'static str) -> String {
    use std::io::{BufRead, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() {
                if line == "\r\n" || !line.ends_with('\n') {
                    break;
                }
                line.clear();
            }
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    addr
}

fn llm_for(addr: String) -> Arc<pe_engine::LlmClassifier> {
    Arc::new(pe_engine::LlmClassifier::new(pe_engine::LlmConfig {
        endpoint: addr,
        timeout_ms: 1000,
        cache_capacity: 8,
    }))
}

#[test]
fn llm_category_attributed_when_no_detector_category() {
    let addr = serve_raw_once(r#"{"content": "sensitive medical"}"#);
    let svc = build_service(1_000).with_llm(llm_for(addr));
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));

    // Prose with zero detector findings: the LLM category becomes the
    // decision category and rides the synthetic finding's meta.
    let decision = svc.process(&input(
        "summary of yesterday's checkup conversation",
        "openai",
        "alice",
        vec![],
    ));
    assert_eq!(decision.category, Some(pe_core::Category::Medical));
    let synthetic = decision
        .findings
        .iter()
        .find(|f| f.detector_id == "ai_classification.risk_score")
        .unwrap();
    assert_eq!(
        synthetic.meta.get("llm_category").map(String::as_str),
        Some("medical")
    );
    assert_eq!(synthetic.meta.get("tier").map(String::as_str), Some("sensitive"));
}

#[test]
fn detector_category_wins_over_llm_category() {
    let addr = serve_raw_once(r#"{"content": "sensitive medical"}"#);
    let svc = build_service(1_000).with_llm(llm_for(addr));
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));

    let decision = svc.process(&input("AKIAIOSFODNN7EXAMPLE", "openai", "alice", vec![]));
    assert_eq!(
        decision.category,
        Some(pe_core::Category::Secret),
        "primary detector category outranks the LLM fallback"
    );
}

#[test]
fn code_classifier_raises_confident_sensitive_code() {
    let addr = serve_raw_once(
        r#"[{"label": "sensitive", "score": 0.93}, {"label": "public", "score": 0.07}]"#,
    );
    let classifier = Arc::new(pe_engine::CodeClassifier::new(
        pe_engine::CodeClassifierConfig {
            endpoint: addr,
            timeout_ms: 1000,
            cache_capacity: 8,
        },
    ));
    let svc = build_service(1_000).with_code_classifier(classifier);
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));

    // Rust snippet → the source-code gate fires → the classifier runs and
    // raises the tier to the Confidential floor.
    let decision = svc.process(&input(
        "pub fn rotate() { let mut k = load(); println!(\"{}\", k); }",
        "openai",
        "alice",
        vec![],
    ));
    let synthetic = decision
        .findings
        .iter()
        .find(|f| f.detector_id == "ai_classification.risk_score")
        .unwrap();
    assert_eq!(
        synthetic.meta.get("code_classifier").map(String::as_str),
        Some("sensitive")
    );
    let score: u8 = synthetic.meta.get("score").unwrap().parse().unwrap();
    assert!(score >= 60, "Confidential floor applied, got {score}");
}

#[test]
fn code_classifier_skipped_without_code_gate() {
    // Dead endpoint: if the gate misfired and called it anyway the call
    // would just fail open, but the meta must stay absent for prose.
    let classifier = Arc::new(pe_engine::CodeClassifier::new(
        pe_engine::CodeClassifierConfig {
            endpoint: "127.0.0.1:1".to_string(),
            timeout_ms: 100,
            cache_capacity: 8,
        },
    ));
    let svc = build_service(1_000).with_code_classifier(classifier);
    let _ = svc.load_policy_bytes(&signed_bytes(&bundle(vec![], vec![])));
    let decision = svc.process(&input("what is the capital of France?", "openai", "alice", vec![]));
    let synthetic = decision
        .findings
        .iter()
        .find(|f| f.detector_id == "ai_classification.risk_score")
        .unwrap();
    assert!(synthetic.meta.get("code_classifier").is_none());
}
