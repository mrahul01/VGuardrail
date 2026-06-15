//! Tamper-evident hashing for the per-device audit chain.
//!
//! `event_hash = SHA-256( canonical_content || 0x1E || previous_event_hash )`
//! where `canonical_content` is the event JSON with the two hash fields removed
//! and all object keys sorted recursively. Linking each event to the prior one's
//! hash makes any insertion, deletion, or mutation detectable by re-walking the
//! chain.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::event::AuditEvent;

/// The `previous_event_hash` of the first event in a device's chain.
pub const GENESIS_PREV: &str = "";

/// Record-separator byte domain-separating content from the previous hash.
const SEP: u8 = 0x1E;

/// Computes the chained `event_hash` for `event` given `previous_event_hash`.
///
/// The event's own `event_hash`/`previous_event_hash` are excluded from the
/// content so the result depends only on the event's data and the chain link.
#[must_use]
pub fn compute_event_hash(event: &AuditEvent, previous_event_hash: &str) -> String {
    let mut value = serde_json::to_value(event).expect("audit event serializes");
    if let Value::Object(map) = &mut value {
        map.remove("event_hash");
        map.remove("previous_event_hash");
    }
    let canonical = canonical_bytes(&value);

    let mut hasher = Sha256::new();
    hasher.update(&canonical);
    hasher.update([SEP]);
    hasher.update(previous_event_hash.as_bytes());
    hex::encode(hasher.finalize())
}

/// Verifies a fully-chained event's `event_hash` against its content + link.
#[must_use]
pub fn verify_event_hash(event: &AuditEvent) -> bool {
    match (&event.event_hash, &event.previous_event_hash) {
        (Some(hash), Some(prev)) => compute_event_hash(event, prev) == *hash,
        _ => false,
    }
}

/// Deterministic, key-sorted JSON bytes for `value`.
fn canonical_bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(&canonicalize(value)).expect("canonical value serializes")
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted: Vec<(&String, &Value)> = map.iter().collect();
            sorted.sort_by(|a, b| a.0.cmp(b.0));
            let mut out = Map::with_capacity(map.len());
            for (k, v) in sorted {
                out.insert(k.clone(), canonicalize(v));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventType;
    use pe_core::{Action, Classification, RiskLevel};

    fn event(id: &str, ts: i64) -> AuditEvent {
        AuditEvent {
            event_id: id.to_string(),
            schema: "vguardrail.event/v1".to_string(),
            event_type: EventType::PolicyEvaluated,
            timestamp_ms: ts,
            user_id: "u1".to_string(),
            device_id: "dev-1".to_string(),
            source: None,
            provider: Some("openai".to_string()),
            model: None,
            app: None,
            decision: Action::Allow,
            risk_level: RiskLevel::Low,
            classification: Classification::Public,
            policy_version: 1,
            matched_rule_id: None,
            category: None,
            reason: None,
            suppressions: vec![],
            incomplete: false,
            findings: vec![],
            event_hash: None,
            previous_event_hash: None,
        }
    }

    #[test]
    fn hash_is_deterministic() {
        let e = event("e1", 1);
        assert_eq!(
            compute_event_hash(&e, GENESIS_PREV),
            compute_event_hash(&e, GENESIS_PREV)
        );
    }

    #[test]
    fn hash_depends_on_previous() {
        let e = event("e1", 1);
        assert_ne!(
            compute_event_hash(&e, GENESIS_PREV),
            compute_event_hash(&e, "abc")
        );
    }

    #[test]
    fn hash_ignores_preexisting_hash_fields() {
        let mut e = event("e1", 1);
        let baseline = compute_event_hash(&e, "p");
        e.event_hash = Some("tampered".to_string());
        e.previous_event_hash = Some("tampered".to_string());
        assert_eq!(
            compute_event_hash(&e, "p"),
            baseline,
            "hash fields excluded from content"
        );
    }

    #[test]
    fn mutation_changes_hash() {
        let mut e = event("e1", 1);
        let h = compute_event_hash(&e, GENESIS_PREV);
        e.decision = Action::Block; // tamper
        assert_ne!(compute_event_hash(&e, GENESIS_PREV), h);
    }

    /// Unset `category`/`reason` are skipped on serialize, so events from old
    /// engines canonicalize byte-for-byte as before the fields existed —
    /// existing per-device chains are unaffected.
    #[test]
    fn absent_category_and_reason_do_not_enter_canonical_content() {
        let e = event("e1", 1);
        let value = serde_json::to_value(&e).unwrap();
        let map = value.as_object().unwrap();
        assert!(!map.contains_key("category"));
        assert!(!map.contains_key("reason"));
    }

    /// Set `category`/`reason` are part of the hashed content for new events.
    #[test]
    fn category_and_reason_change_hash_when_present() {
        let mut e = event("e1", 1);
        let baseline = compute_event_hash(&e, GENESIS_PREV);
        e.category = Some("secret".to_string());
        let with_category = compute_event_hash(&e, GENESIS_PREV);
        assert_ne!(with_category, baseline);
        e.reason = Some("AWS access key detected".to_string());
        assert_ne!(compute_event_hash(&e, GENESIS_PREV), with_category);
    }

    #[test]
    fn verify_round_trips() {
        let mut e = event("e1", 1);
        let prev = GENESIS_PREV.to_string();
        e.previous_event_hash = Some(prev.clone());
        e.event_hash = Some(compute_event_hash(&e, &prev));
        assert!(verify_event_hash(&e));
        // Tamper and re-check.
        e.provider = Some("anthropic".to_string());
        assert!(!verify_event_hash(&e));
    }
}
