//! Audit event construction (doc 04). Builds the redacted, signed envelope the
//! engine persists to the local queue for the upload worker.

use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use pe_core::{Clock, Decision, ScanContext};
use pe_store::QueuedEvent;

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// Selects the primary event type for a decision (doc 04 §2).
#[must_use]
pub fn primary_event_type(decision: &Decision) -> &'static str {
    match decision.action {
        pe_core::Action::Allow => "PromptAllowed",
        pe_core::Action::Warn => "PromptWarned",
        pe_core::Action::Block => "PromptBlocked",
    }
}

/// Builds a signed [`QueuedEvent`] of `event_type` from a decision and context.
///
/// The payload contains only metadata and **redacted** findings — never the raw
/// prompt or secret (doc 04 privacy invariant).
#[must_use]
pub fn build_event(
    event_type: &str,
    decision: &Decision,
    ctx: &ScanContext,
    clock: &dyn Clock,
    signing_key: &SigningKey,
) -> QueuedEvent {
    let now_ms = clock.now_millis();
    let event_id = uuid::Uuid::now_v7().to_string();

    let payload = serde_json::json!({
        "event_id": event_id,
        "schema": "vguardrail.event/v1",
        "type": event_type,
        "timestamp_ms": now_ms,
        "user_id": ctx.user.user_id,
        "source": ctx.source,
        "provider": ctx.provider,
        "model": ctx.model,
        "app": ctx.app,
        "decision": decision.action,
        "risk_level": decision.risk_level,
        "classification": decision.classification,
        "category": decision.category,
        "reason": decision.reason,
        "policy_version": decision.policy_version,
        "matched_rule_id": decision.matched_rule_id,
        "suppressions": decision.suppressions,
        "incomplete": decision.incomplete,
        "findings": decision.findings,  // redacted previews only
    });
    let payload_bytes = serde_json::to_vec(&payload).expect("event payload serializes");

    let sig = signing_key.sign(&payload_bytes);
    let payload_sig = format!("ed25519:{}", B64.encode(sig.to_bytes()));

    QueuedEvent {
        event_id,
        event_type: event_type.to_string(),
        created_at: now_ms.to_string(),
        payload: payload_bytes,
        payload_sig,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pe_core::{Action, Category, Finding, ManualClock, Severity, Span};

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[5u8; 32])
    }

    #[test]
    fn event_is_signed_and_redacted() {
        let mut decision = Decision::default_action(Action::Block, 1);
        decision.findings.push(Finding::new(
            "secret.aws_access_key",
            Category::Secret,
            "aws_access_key",
            Span::new(0, 20),
            0.99,
            Severity::Critical,
            "AKIA…MPLE",
        ));
        let clock = ManualClock::new(1_700_000_000_000);
        let evt = build_event(
            "PromptBlocked",
            &decision,
            &ScanContext::default(),
            &clock,
            &signing_key(),
        );

        assert_eq!(evt.event_type, "PromptBlocked");
        assert!(evt.payload_sig.starts_with("ed25519:"));
        // No raw secret in the persisted payload.
        let text = String::from_utf8(evt.payload.clone()).unwrap();
        assert!(!text.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(text.contains("AKIA…MPLE"));
    }

    #[test]
    fn primary_type_tracks_action() {
        let allow = Decision::default_action(Action::Allow, 1);
        assert_eq!(primary_event_type(&allow), "PromptAllowed");
        let block = Decision::default_action(Action::Block, 1);
        assert_eq!(primary_event_type(&block), "PromptBlocked");
    }
}
