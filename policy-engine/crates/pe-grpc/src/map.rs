//! Conversions between the gRPC wire types ([`crate::pb`]) and the `pe-core`
//! domain model. Centralising the mapping keeps enum ↔ i32 plumbing in one place.

use std::collections::HashMap;

use pe_core::{
    Action, Category, Classification, Decision, Finding, RiskLevel, Role, ScanContext, Severity,
    Source, Span,
};

use crate::pb;

// ── Domain → wire ───────────────────────────────────────────────────────────

/// Maps a domain [`Action`] to the proto enum value.
#[must_use]
pub fn action_to_i32(a: Action) -> i32 {
    match a {
        Action::Allow => pb::Action::Allow as i32,
        Action::Warn => pb::Action::Warn as i32,
        Action::Block => pb::Action::Block as i32,
    }
}

/// Maps a domain [`RiskLevel`] to the proto enum value.
#[must_use]
pub fn risk_to_i32(r: RiskLevel) -> i32 {
    match r {
        RiskLevel::Low => pb::RiskLevel::Low as i32,
        RiskLevel::Medium => pb::RiskLevel::Medium as i32,
        RiskLevel::High => pb::RiskLevel::High as i32,
        RiskLevel::Critical => pb::RiskLevel::Critical as i32,
    }
}

/// Maps a domain [`Severity`] to the proto enum value.
#[must_use]
pub fn severity_to_i32(s: Severity) -> i32 {
    match s {
        Severity::Low => pb::Severity::SevLow as i32,
        Severity::Medium => pb::Severity::SevMedium as i32,
        Severity::High => pb::Severity::SevHigh as i32,
        Severity::Critical => pb::Severity::SevCritical as i32,
    }
}

/// Maps a domain [`Classification`] to the proto enum value.
#[must_use]
pub fn classification_to_i32(c: Classification) -> i32 {
    match c {
        Classification::Public => pb::Classification::Public as i32,
        Classification::Internal => pb::Classification::Internal as i32,
        Classification::Confidential => pb::Classification::Confidential as i32,
        Classification::Restricted => pb::Classification::Restricted as i32,
    }
}

/// Maps a domain [`Category`] to the proto enum value.
#[must_use]
pub fn category_to_i32(c: Category) -> i32 {
    match c {
        Category::Secret => pb::Category::Secret as i32,
        Category::Pii => pb::Category::Pii as i32,
        Category::SourceCode => pb::Category::SourceCode as i32,
        Category::Classification => pb::Category::Classification as i32,
        Category::CompanyConfidential => pb::Category::CompanyConfidential as i32,
        Category::Financial => pb::Category::Financial as i32,
        Category::IntellectualProperty => pb::Category::IntellectualProperty as i32,
        Category::UsagePolicy => pb::Category::UsagePolicy as i32,
        Category::PromptInjection => pb::Category::PromptInjection as i32,
        Category::SensitiveDocument => pb::Category::SensitiveDocument as i32,
        Category::CustomerData => pb::Category::CustomerData as i32,
        Category::Compliance => pb::Category::Compliance as i32,
        Category::Keyword => pb::Category::Keyword as i32,
        Category::FilePolicy => pb::Category::FilePolicy as i32,
        Category::ImagePolicy => pb::Category::ImagePolicy as i32,
        Category::AiClassification => pb::Category::AiClassification as i32,
        Category::DestructiveCommand => pb::Category::DestructiveCommand as i32,
        Category::Legal => pb::Category::Legal as i32,
        Category::Medical => pb::Category::Medical as i32,
        Category::Hr => pb::Category::Hr as i32,
        Category::Security => pb::Category::Security as i32,
        Category::ResearchDevelopment => pb::Category::ResearchDevelopment as i32,
        Category::Communication => pb::Category::Communication as i32,
        Category::Procurement => pb::Category::Procurement as i32,
        Category::Government => pb::Category::Government as i32,
    }
}

fn finding_to_pb(f: &Finding) -> pb::Finding {
    pb::Finding {
        detector_id: f.detector_id.clone(),
        category: category_to_i32(f.category),
        kind: f.kind.clone(),
        span_start: f.span.start as u32,
        span_end: f.span.end as u32,
        confidence: f.confidence,
        severity: severity_to_i32(f.severity),
        redacted_preview: f.redacted_preview.clone(),
        meta: f.meta.clone().into_iter().collect::<HashMap<_, _>>(),
    }
}

/// Builds an [`pb::EvaluateResponse`] from a domain [`Decision`].
#[must_use]
pub fn evaluate_response(
    request_id: String,
    d: &Decision,
    elapsed_micros: u32,
) -> pb::EvaluateResponse {
    pb::EvaluateResponse {
        request_id,
        action: action_to_i32(d.action),
        risk_level: risk_to_i32(d.risk_level),
        classification: classification_to_i32(d.classification),
        matched_rule_id: d.matched_rule_id.clone().unwrap_or_default(),
        severity: d
            .severity
            .map_or(pb::Severity::Unspecified as i32, severity_to_i32),
        findings: d.findings.iter().map(finding_to_pb).collect(),
        suppressions: d
            .suppressions
            .iter()
            .map(|s| pb::Suppression {
                rule_id: s.rule_id.clone(),
                exception_id: s.exception_id.clone(),
            })
            .collect(),
        reason: d.reason.clone(),
        policy_version: d.policy_version,
        elapsed_micros,
        incomplete: d.incomplete,
        category: d
            .category
            .map_or(pb::Category::Unspecified as i32, category_to_i32),
    }
}

// ── Wire → domain ───────────────────────────────────────────────────────────

/// Maps a proto [`pb::Source`] value to the domain [`Source`].
#[must_use]
pub fn source_from_i32(v: i32) -> Option<Source> {
    match pb::Source::try_from(v).ok()? {
        pb::Source::Unspecified => None,
        pb::Source::Browser => Some(Source::Browser),
        pb::Source::Ide => Some(Source::Ide),
        pb::Source::Cli => Some(Source::Cli),
        pb::Source::Api => Some(Source::Api),
    }
}

/// Maps a proto [`pb::Role`] value to the domain [`Role`] (defaulting to `User`).
#[must_use]
pub fn role_from_i32(v: i32) -> Role {
    match pb::Role::try_from(v).unwrap_or(pb::Role::User) {
        pb::Role::SuperAdmin => Role::SuperAdmin,
        pb::Role::SecurityAdmin => Role::SecurityAdmin,
        pb::Role::Auditor => Role::Auditor,
        pb::Role::Manager => Role::Manager,
        pb::Role::User | pb::Role::Unspecified => Role::User,
    }
}

/// Maps a proto [`pb::Classification`] value to the domain [`Classification`].
#[must_use]
pub fn classification_from_i32(v: i32) -> Option<Classification> {
    match pb::Classification::try_from(v).ok()? {
        pb::Classification::Unspecified => None,
        pb::Classification::Public => Some(Classification::Public),
        pb::Classification::Internal => Some(Classification::Internal),
        pb::Classification::Confidential => Some(Classification::Confidential),
        pb::Classification::Restricted => Some(Classification::Restricted),
    }
}

fn non_empty(s: String) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Builds a domain [`ScanContext`] from a proto request context.
#[must_use]
pub fn scan_context_from_pb(ctx: Option<pb::ScanContext>) -> ScanContext {
    let Some(c) = ctx else {
        return ScanContext::default();
    };
    let user = c.user.unwrap_or_default();
    ScanContext {
        source: source_from_i32(c.source),
        provider: non_empty(c.provider),
        model: non_empty(c.model),
        app: non_empty(c.app),
        repo: c.repo.map(|r| pe_core::RepoContext {
            name: r.name,
            classification: classification_from_i32(r.classification),
        }),
        file: c.file.map(|f| pe_core::FileContext {
            path: f.path,
            extension: non_empty(f.extension),
        }),
        user: pe_core::UserContext {
            user_id: user.user_id,
            role: role_from_i32(user.role),
            groups: user.groups,
        },
    }
}

/// Reconstructs a [`Finding`] from its proto form (used in contract tests).
#[must_use]
pub fn finding_from_pb(f: &pb::Finding) -> Finding {
    let mut finding = Finding::new(
        f.detector_id.clone(),
        category_from_i32(f.category),
        f.kind.clone(),
        Span::new(f.span_start as usize, f.span_end as usize),
        f.confidence,
        severity_from_i32(f.severity),
        f.redacted_preview.clone(),
    );
    for (k, v) in &f.meta {
        finding = finding.with_meta(k.clone(), v.clone());
    }
    finding
}

fn category_from_i32(v: i32) -> Category {
    match pb::Category::try_from(v).unwrap_or(pb::Category::Unspecified) {
        pb::Category::Pii => Category::Pii,
        pb::Category::SourceCode => Category::SourceCode,
        pb::Category::Classification => Category::Classification,
        pb::Category::CompanyConfidential => Category::CompanyConfidential,
        pb::Category::Financial => Category::Financial,
        pb::Category::IntellectualProperty => Category::IntellectualProperty,
        pb::Category::UsagePolicy => Category::UsagePolicy,
        pb::Category::PromptInjection => Category::PromptInjection,
        pb::Category::SensitiveDocument => Category::SensitiveDocument,
        pb::Category::CustomerData => Category::CustomerData,
        pb::Category::Compliance => Category::Compliance,
        pb::Category::Keyword => Category::Keyword,
        pb::Category::FilePolicy => Category::FilePolicy,
        pb::Category::ImagePolicy => Category::ImagePolicy,
        pb::Category::AiClassification => Category::AiClassification,
        pb::Category::DestructiveCommand => Category::DestructiveCommand,
        pb::Category::Legal => Category::Legal,
        pb::Category::Medical => Category::Medical,
        pb::Category::Hr => Category::Hr,
        pb::Category::Security => Category::Security,
        pb::Category::ResearchDevelopment => Category::ResearchDevelopment,
        pb::Category::Communication => Category::Communication,
        pb::Category::Procurement => Category::Procurement,
        pb::Category::Government => Category::Government,
        pb::Category::Secret | pb::Category::Unspecified => Category::Secret,
    }
}

fn severity_from_i32(v: i32) -> Severity {
    match pb::Severity::try_from(v).unwrap_or(pb::Severity::SevLow) {
        pb::Severity::SevMedium => Severity::Medium,
        pb::Severity::SevHigh => Severity::High,
        pb::Severity::SevCritical => Severity::Critical,
        pb::Severity::SevLow | pb::Severity::Unspecified => Severity::Low,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::{Decision, RiskLevel};

    #[test]
    fn action_round_trips() {
        for a in [Action::Allow, Action::Warn, Action::Block] {
            let v = action_to_i32(a);
            assert_eq!(pb::Action::try_from(v).unwrap() as i32, v);
        }
    }

    #[test]
    fn response_maps_default_action_decision() {
        let d = Decision::default_action(Action::Warn, 7);
        let r = evaluate_response("req1".into(), &d, 1234);
        assert_eq!(r.request_id, "req1");
        assert_eq!(r.action, pb::Action::Warn as i32);
        assert_eq!(r.matched_rule_id, "");
        assert_eq!(r.policy_version, 7);
        assert_eq!(r.elapsed_micros, 1234);
        assert_eq!(r.severity, pb::Severity::Unspecified as i32);
    }

    #[test]
    fn scan_context_maps_fields() {
        let pb_ctx = pb::ScanContext {
            source: pb::Source::Ide as i32,
            provider: "openai".into(),
            model: String::new(),
            app: "Cursor".into(),
            repo: Some(pb::RepoContext {
                name: "repo".into(),
                classification: pb::Classification::Confidential as i32,
            }),
            file: None,
            user: Some(pb::UserContext {
                user_id: "u1".into(),
                role: pb::Role::SecurityAdmin as i32,
                groups: vec!["eng".into()],
            }),
        };
        let ctx = scan_context_from_pb(Some(pb_ctx));
        assert_eq!(ctx.source, Some(Source::Ide));
        assert_eq!(ctx.provider.as_deref(), Some("openai"));
        assert!(ctx.model.is_none(), "empty string maps to None");
        assert_eq!(ctx.user.role, Role::SecurityAdmin);
        assert_eq!(
            ctx.repo.unwrap().classification,
            Some(Classification::Confidential)
        );
    }

    #[test]
    fn finding_round_trips_through_pb() {
        let f = Finding::new(
            "secret.aws_access_key",
            Category::Secret,
            "aws_access_key",
            Span::new(3, 23),
            0.99,
            Severity::Critical,
            "AKIA…MPLE",
        )
        .with_meta("k", "v");
        let back = finding_from_pb(&finding_to_pb(&f));
        assert_eq!(back, f);
    }

    #[test]
    fn full_decision_maps_findings_and_risk() {
        let mut d = Decision::default_action(Action::Block, 3);
        d.risk_level = RiskLevel::Critical;
        d.findings.push(Finding::new(
            "secret.aws_access_key",
            Category::Secret,
            "aws_access_key",
            Span::new(0, 20),
            0.99,
            Severity::Critical,
            "AKIA…MPLE",
        ));
        let r = evaluate_response("x".into(), &d, 0);
        assert_eq!(r.risk_level, pb::RiskLevel::Critical as i32);
        assert_eq!(r.findings.len(), 1);
        assert!(!r.findings[0].redacted_preview.contains("IOSFODNN"));
    }
}
