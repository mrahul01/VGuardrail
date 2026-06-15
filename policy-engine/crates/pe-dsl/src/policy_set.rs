//! Three-slot policy retention (doc 01 §2.1): `current`, `previous`, and
//! `last_known_good`, with fail-closed loading (signature → schema → anti-rollback
//! → chain → static validation).

use std::collections::HashSet;

use ed25519_dalek::VerifyingKey;

use crate::error::PolicyError;
use crate::model::PolicyBundle;
use crate::signature::verify_bundle;
use crate::validate::validate_bundle;

/// Outcome of a successful [`PolicySet::load`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadResult {
    /// The now-active version.
    pub active_version: u32,
    /// The version demoted to `previous`, if any.
    pub previous_version: Option<u32>,
}

/// Holds the three retained bundles and the pinned verifying key.
pub struct PolicySet {
    current: Option<PolicyBundle>,
    previous: Option<PolicyBundle>,
    last_known_good: Option<PolicyBundle>,
    verifying_key: VerifyingKey,
    known_detectors: HashSet<String>,
}

impl PolicySet {
    /// Creates an empty set pinned to `verifying_key`, validating rules against
    /// `known_detectors` (the engine's registry ids).
    #[must_use]
    pub fn new(verifying_key: VerifyingKey, known_detectors: HashSet<String>) -> Self {
        Self {
            current: None,
            previous: None,
            last_known_good: None,
            verifying_key,
            known_detectors,
        }
    }

    /// The active bundle, if any.
    #[must_use]
    pub fn current(&self) -> Option<&PolicyBundle> {
        self.current.as_ref()
    }

    /// The previously-active bundle, if any.
    #[must_use]
    pub fn previous(&self) -> Option<&PolicyBundle> {
        self.previous.as_ref()
    }

    /// The last bundle that fully validated and loaded.
    #[must_use]
    pub fn last_known_good(&self) -> Option<&PolicyBundle> {
        self.last_known_good.as_ref()
    }

    /// Active version, or `0` when no policy is loaded.
    #[must_use]
    pub fn active_version(&self) -> u32 {
        self.current.as_ref().map_or(0, |b| b.version)
    }

    /// Validates and installs a new bundle from its raw JSON bytes.
    ///
    /// Fail-closed: on any error the existing slots are left untouched so the
    /// engine keeps enforcing the last-good policy.
    ///
    /// # Errors
    /// Returns the first [`PolicyError`] that fails the load pipeline.
    pub fn load(&mut self, bundle_json: &[u8]) -> Result<LoadResult, PolicyError> {
        // Parse to Value first so signature verification canonicalizes exactly
        // what was transmitted, independent of struct field order.
        let value: serde_json::Value = serde_json::from_slice(bundle_json)
            .map_err(|e| PolicyError::Malformed(e.to_string()))?;

        verify_bundle(&value, &self.verifying_key)?;

        let bundle: PolicyBundle =
            serde_json::from_value(value).map_err(|e| PolicyError::Malformed(e.to_string()))?;

        validate_bundle(&bundle, &self.known_detectors)?;

        // Anti-rollback + chain integrity against the active version.
        if let Some(cur) = &self.current {
            if bundle.version <= cur.version {
                return Err(PolicyError::VersionRollback {
                    incoming: bundle.version,
                    current: cur.version,
                });
            }
            if bundle.previous_version != Some(cur.version) {
                return Err(PolicyError::BrokenChain {
                    incoming_prev: bundle.previous_version,
                    current: cur.version,
                });
            }
        }

        let previous_version = self.current.as_ref().map(|b| b.version);
        let new_version = bundle.version;
        self.previous = self.current.take();
        self.last_known_good = Some(bundle.clone());
        self.current = Some(bundle);

        Ok(LoadResult {
            active_version: new_version,
            previous_version,
        })
    }

    /// Reverts `current` to `last_known_good`. Used by the engine when a loaded
    /// policy is later found faulty at runtime. Returns the restored version.
    pub fn rollback_to_last_known_good(&mut self) -> Option<u32> {
        if let Some(lkg) = self.last_known_good.clone() {
            let v = lkg.version;
            self.previous = self.current.take();
            self.current = Some(lkg);
            return Some(v);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::PolicyBundle;
    use crate::signature::sign_bundle;
    use ed25519_dalek::SigningKey;
    use pe_core::Action;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[3u8; 32])
    }

    fn bundle(version: u32, previous: Option<u32>) -> PolicyBundle {
        PolicyBundle {
            schema: "vguardrail.policy/v1".into(),
            version,
            previous_version: previous,
            org_id: "org".into(),
            created_at: "2026-06-04T00:00:00Z".into(),
            default_action: Action::Warn,
            exceptions: vec![],
            rules: vec![],
            signature: None,
        }
    }

    fn signed_json(version: u32, previous: Option<u32>, sk: &SigningKey) -> Vec<u8> {
        let signed = sign_bundle(&bundle(version, previous), sk, "k");
        serde_json::to_vec(&signed).unwrap()
    }

    fn empty_set(sk: &SigningKey) -> PolicySet {
        PolicySet::new(sk.verifying_key(), HashSet::new())
    }

    #[test]
    fn genesis_then_successor_loads_and_rotates_slots() {
        let sk = key();
        let mut set = empty_set(&sk);

        let r1 = set.load(&signed_json(1, None, &sk)).unwrap();
        assert_eq!(r1.active_version, 1);
        assert_eq!(set.active_version(), 1);
        assert!(set.previous().is_none());

        let r2 = set.load(&signed_json(2, Some(1), &sk)).unwrap();
        assert_eq!(r2.active_version, 2);
        assert_eq!(r2.previous_version, Some(1));
        assert_eq!(set.previous().unwrap().version, 1);
        assert_eq!(set.last_known_good().unwrap().version, 2);
    }

    #[test]
    fn rollback_is_rejected() {
        let sk = key();
        let mut set = empty_set(&sk);
        set.load(&signed_json(5, None, &sk)).unwrap();
        let err = set.load(&signed_json(4, Some(5), &sk)).unwrap_err();
        assert!(matches!(err, PolicyError::VersionRollback { .. }));
        assert_eq!(
            set.active_version(),
            5,
            "active policy unchanged on failure"
        );
    }

    #[test]
    fn broken_chain_is_rejected() {
        let sk = key();
        let mut set = empty_set(&sk);
        set.load(&signed_json(1, None, &sk)).unwrap();
        // version 3 claims to supersede 2, but current is 1 → broken chain.
        let err = set.load(&signed_json(3, Some(2), &sk)).unwrap_err();
        assert!(matches!(err, PolicyError::BrokenChain { .. }));
    }

    #[test]
    fn tampered_bundle_is_rejected_and_state_preserved() {
        let sk = key();
        let mut set = empty_set(&sk);
        set.load(&signed_json(1, None, &sk)).unwrap();

        let signed = sign_bundle(&bundle(2, Some(1)), &sk, "k");
        let mut v = serde_json::to_value(&signed).unwrap();
        v["version"] = serde_json::json!(2_000); // tamper post-signing
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(matches!(
            set.load(&bytes),
            Err(PolicyError::BadSignature(_))
        ));
        assert_eq!(set.active_version(), 1);
    }

    #[test]
    fn rollback_to_last_known_good_restores_version() {
        let sk = key();
        let mut set = empty_set(&sk);
        set.load(&signed_json(1, None, &sk)).unwrap();
        set.load(&signed_json(2, Some(1), &sk)).unwrap();
        let restored = set.rollback_to_last_known_good();
        assert_eq!(restored, Some(2));
    }
}
