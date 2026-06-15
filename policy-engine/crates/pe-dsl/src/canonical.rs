//! Deterministic JSON canonicalization for signing/verifying bundles.
//!
//! Two semantically-equal bundles must produce identical signing bytes
//! regardless of key order, so we recursively sort object keys and emit compact
//! JSON. The `signature` field is removed before canonicalization.

use serde_json::{Map, Value};

/// Returns the canonical signing bytes for a bundle `Value`: the value with any
/// top-level `signature` key removed, object keys sorted recursively, compact.
#[must_use]
pub fn signing_bytes(bundle: &Value) -> Vec<u8> {
    let mut clone = bundle.clone();
    if let Value::Object(map) = &mut clone {
        map.remove("signature");
    }
    let canonical = canonicalize(&clone);
    serde_json::to_vec(&canonical).expect("canonical Value always serializes")
}

/// Recursively rebuilds a [`Value`] with all object keys sorted.
#[must_use]
pub fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            // BTreeMap-style ordering: collect into a sorted Map.
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
    use serde_json::json;

    #[test]
    fn key_order_does_not_affect_signing_bytes() {
        let a = json!({"b": 1, "a": 2, "nested": {"y": 1, "x": 2}});
        let b = json!({"a": 2, "nested": {"x": 2, "y": 1}, "b": 1});
        assert_eq!(signing_bytes(&a), signing_bytes(&b));
    }

    #[test]
    fn signature_field_is_excluded() {
        let signed = json!({"version": 1, "signature": {"value": "abc"}});
        let unsigned = json!({"version": 1});
        assert_eq!(signing_bytes(&signed), signing_bytes(&unsigned));
    }

    #[test]
    fn arrays_preserve_order() {
        let a = json!({"rules": [3, 1, 2]});
        let b = json!({"rules": [1, 2, 3]});
        assert_ne!(signing_bytes(&a), signing_bytes(&b));
    }
}
