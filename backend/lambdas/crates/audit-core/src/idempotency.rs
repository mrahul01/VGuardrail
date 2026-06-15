//! Idempotency keys for safe upload retries.
//!
//! Two layers protect against duplicates:
//! 1. **upload_id** — a whole-batch idempotency key. If the client doesn't supply
//!    one (`Idempotency-Key` header / `upload_id` body field), the server derives
//!    a deterministic id from the batch's event-id set, so a retried identical
//!    batch maps to the same upload_id.
//! 2. **event_id uniqueness** — enforced at the store layer (conditional write),
//!    so overlapping batches never create duplicate audit records.

use sha2::{Digest, Sha256};

/// Prefix for derived upload ids (distinguishes them from client-supplied ones).
const DERIVED_PREFIX: &str = "upl_";

/// Derives a deterministic upload id from the set of event ids in a batch.
///
/// Order-independent and duplicate-insensitive: the same logical batch always
/// yields the same id.
#[must_use]
pub fn derive_upload_id(event_ids: &[String]) -> String {
    let mut unique: Vec<&str> = event_ids.iter().map(String::as_str).collect();
    unique.sort_unstable();
    unique.dedup();

    let mut hasher = Sha256::new();
    for id in unique {
        hasher.update(id.as_bytes());
        hasher.update([0x00]); // length-independent separator
    }
    format!("{DERIVED_PREFIX}{}", hex::encode(hasher.finalize()))
}

/// Normalizes the effective upload id: a non-empty client-supplied id wins,
/// otherwise one is derived from the batch.
#[must_use]
pub fn effective_upload_id(client_supplied: Option<&str>, event_ids: &[String]) -> String {
    match client_supplied {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => derive_upload_id(event_ids),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_id_is_order_independent() {
        let a = derive_upload_id(&["e1".into(), "e2".into(), "e3".into()]);
        let b = derive_upload_id(&["e3".into(), "e1".into(), "e2".into()]);
        assert_eq!(a, b);
        assert!(a.starts_with("upl_"));
    }

    #[test]
    fn derived_id_ignores_duplicates() {
        let a = derive_upload_id(&["e1".into(), "e2".into()]);
        let b = derive_upload_id(&["e1".into(), "e1".into(), "e2".into()]);
        assert_eq!(a, b);
    }

    #[test]
    fn different_batches_differ() {
        let a = derive_upload_id(&["e1".into(), "e2".into()]);
        let b = derive_upload_id(&["e1".into(), "e3".into()]);
        assert_ne!(a, b);
    }

    #[test]
    fn client_supplied_wins() {
        assert_eq!(
            effective_upload_id(Some("client-123"), &["e1".into()]),
            "client-123"
        );
        assert!(effective_upload_id(Some("  "), &["e1".into()]).starts_with("upl_"));
        assert!(effective_upload_id(None, &["e1".into()]).starts_with("upl_"));
    }
}
