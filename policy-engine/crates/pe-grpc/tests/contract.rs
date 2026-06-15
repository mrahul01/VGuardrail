//! Contract test: a wire request maps to a domain context, and a domain decision
//! maps back to a wire response, preserving the redaction invariant. This is the
//! golden round-trip the Swift client must also satisfy (doc 06 §6).

use pe_core::{Action, Category, Classification, Decision, Finding, RiskLevel, Severity, Span};
use pe_grpc::map;
use pe_grpc::pb;

#[test]
fn request_context_to_domain_to_response() {
    // 1. A wire request as the Swift agent would send.
    let request = pb::EvaluateRequest {
        request_id: "req-123".into(),
        text: "AKIAIOSFODNN7EXAMPLE".into(),
        context: Some(pb::ScanContext {
            source: pb::Source::Cli as i32,
            provider: "anthropic".into(),
            model: "claude".into(),
            app: "claude-code".into(),
            repo: Some(pb::RepoContext {
                name: "monorepo".into(),
                classification: pb::Classification::Restricted as i32,
            }),
            file: Some(pb::FileContext {
                path: "src/main.rs".into(),
                extension: "rs".into(),
            }),
            user: Some(pb::UserContext {
                user_id: "user-7".into(),
                role: pb::Role::User as i32,
                groups: vec!["platform".into()],
            }),
        }),
    };

    // 2. Map to the domain context the engine evaluates against.
    let ctx = map::scan_context_from_pb(request.context);
    assert_eq!(ctx.provider.as_deref(), Some("anthropic"));
    assert_eq!(
        ctx.repo.as_ref().unwrap().classification,
        Some(Classification::Restricted)
    );
    assert_eq!(ctx.file.as_ref().unwrap().extension.as_deref(), Some("rs"));
    assert_eq!(ctx.user.groups, vec!["platform".to_string()]);

    // 3. A decision the engine would produce.
    let mut decision = Decision::default_action(Action::Block, 42);
    decision.risk_level = RiskLevel::Critical;
    decision.classification = Classification::Restricted;
    decision.matched_rule_id = Some("rule_aws_block".into());
    decision.severity = Some(Severity::Critical);
    decision.findings.push(Finding::new(
        "secret.aws_access_key",
        Category::Secret,
        "aws_access_key",
        Span::new(0, 20),
        0.99,
        Severity::Critical,
        "AKIA…MPLE",
    ));

    // 4. Map back to the wire response.
    let resp = map::evaluate_response(request.request_id, &decision, 850);
    assert_eq!(resp.request_id, "req-123");
    assert_eq!(resp.action, pb::Action::Block as i32);
    assert_eq!(resp.risk_level, pb::RiskLevel::Critical as i32);
    assert_eq!(resp.matched_rule_id, "rule_aws_block");
    assert_eq!(resp.policy_version, 42);
    assert_eq!(resp.elapsed_micros, 850);
    assert_eq!(resp.findings.len(), 1);

    // Redaction invariant holds across the wire boundary.
    let blob = format!("{resp:?}");
    assert!(!blob.contains("AKIAIOSFODNN7EXAMPLE"));
}
