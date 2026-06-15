//! Ed25519 signing and verification of policy bundles (doc 00 P-11).
//!
//! Signing is provided for tooling and tests; the engine only ever *verifies*.

use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde_json::Value;

use crate::canonical::signing_bytes;
use crate::error::PolicyError;
use crate::model::{PolicyBundle, SignatureBlock};

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// Signs `bundle` with `signing_key`, returning a copy with the `signature`
/// block populated. Intended for the dashboard signer and tests.
#[must_use]
pub fn sign_bundle(bundle: &PolicyBundle, signing_key: &SigningKey, key_id: &str) -> PolicyBundle {
    // Canonicalize the *textual* JSON form (round-trip through bytes) so the
    // signer hashes exactly what the verifier will parse off the wire. Signing
    // `to_value` directly would diverge on f32→f64 rounding (e.g. min_confidence).
    let bytes = serde_json::to_vec(bundle).expect("bundle serializes");
    let value: Value = serde_json::from_slice(&bytes).expect("bundle re-parses");
    let msg = signing_bytes(&value);
    let sig: Signature = signing_key.sign(&msg);
    let mut signed = bundle.clone();
    signed.signature = Some(SignatureBlock {
        alg: "ed25519".to_string(),
        key_id: key_id.to_string(),
        value: B64.encode(sig.to_bytes()),
    });
    signed
}

/// Verifies a bundle's signature against `verifying_key`.
///
/// `bundle_value` is the **raw parsed JSON** of the bundle (so canonicalization
/// matches what was signed, independent of Rust struct field order).
///
/// # Errors
/// Returns [`PolicyError::Unsigned`], [`PolicyError::BadSignatureAlg`], or
/// [`PolicyError::BadSignature`] on failure.
pub fn verify_bundle(
    bundle_value: &Value,
    verifying_key: &VerifyingKey,
) -> Result<(), PolicyError> {
    let sig_obj = bundle_value
        .get("signature")
        .and_then(Value::as_object)
        .ok_or(PolicyError::Unsigned)?;

    let alg = sig_obj.get("alg").and_then(Value::as_str).unwrap_or("");
    if alg != "ed25519" {
        return Err(PolicyError::BadSignatureAlg(alg.to_string()));
    }

    let b64 = sig_obj
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| PolicyError::BadSignature("missing signature value".into()))?;
    let raw = B64
        .decode(b64)
        .map_err(|e| PolicyError::BadSignature(format!("base64: {e}")))?;
    let bytes: [u8; 64] = raw
        .as_slice()
        .try_into()
        .map_err(|_| PolicyError::BadSignature("signature is not 64 bytes".into()))?;
    let signature = Signature::from_bytes(&bytes);

    let msg = signing_bytes(bundle_value);
    verifying_key
        .verify_strict(&msg, &signature)
        .map_err(|e| PolicyError::BadSignature(e.to_string()))
}

/// Parses a 32-byte Ed25519 public key from base64 (config/pinning helper).
///
/// # Errors
/// Returns [`PolicyError::BadSignature`] if the key is malformed.
pub fn verifying_key_from_b64(b64: &str) -> Result<VerifyingKey, PolicyError> {
    let raw = B64
        .decode(b64)
        .map_err(|e| PolicyError::BadSignature(format!("key base64: {e}")))?;
    let bytes: [u8; 32] = raw
        .as_slice()
        .try_into()
        .map_err(|_| PolicyError::BadSignature("public key is not 32 bytes".into()))?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| PolicyError::BadSignature(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PolicyBundle;
    use pe_core::Action;

    fn fixed_key() -> SigningKey {
        // Deterministic key for tests (never used in production).
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn sample_bundle() -> PolicyBundle {
        PolicyBundle {
            schema: "vguardrail.policy/v1".into(),
            version: 1,
            previous_version: None,
            org_id: "org_test".into(),
            created_at: "2026-06-04T00:00:00Z".into(),
            default_action: Action::Warn,
            exceptions: vec![],
            rules: vec![],
            signature: None,
        }
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let sk = fixed_key();
        let signed = sign_bundle(&sample_bundle(), &sk, "test-key");
        let value = serde_json::to_value(&signed).unwrap();
        assert!(verify_bundle(&value, &sk.verifying_key()).is_ok());
    }

    #[test]
    fn tampered_bundle_fails_verification() {
        let sk = fixed_key();
        let signed = sign_bundle(&sample_bundle(), &sk, "test-key");
        let mut value = serde_json::to_value(&signed).unwrap();
        value["version"] = serde_json::json!(999); // tamper after signing
        assert!(matches!(
            verify_bundle(&value, &sk.verifying_key()),
            Err(PolicyError::BadSignature(_))
        ));
    }

    #[test]
    fn wrong_key_fails_verification() {
        let signed = sign_bundle(&sample_bundle(), &fixed_key(), "test-key");
        let value = serde_json::to_value(&signed).unwrap();
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(verify_bundle(&value, &other.verifying_key()).is_err());
    }

    #[test]
    fn unsigned_bundle_is_rejected() {
        let value = serde_json::to_value(sample_bundle()).unwrap();
        let sk = fixed_key();
        assert!(matches!(
            verify_bundle(&value, &sk.verifying_key()),
            Err(PolicyError::Unsigned)
        ));
    }
}
