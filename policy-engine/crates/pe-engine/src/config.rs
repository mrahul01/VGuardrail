//! Engine configuration.

use ed25519_dalek::SigningKey;
use pe_core::Action;

/// Runtime configuration for the [`crate::EngineService`].
#[derive(Clone)]
pub struct EngineConfig {
    /// Detector time budget per evaluation, in milliseconds (the 50 ms SLO).
    pub budget_ms: u64,
    /// Action used when no policy is loaded yet (fail-closed bootstrap, P-12).
    pub bootstrap_action: Action,
    /// Key used to sign outbound audit events (doc 04 §4).
    pub event_signing_key: SigningKey,
    /// When true (default), any critical finding forces the final decision to
    /// BLOCK, overriding rule-level allow/warn outcomes.
    pub critical_force_block: bool,
}

impl EngineConfig {
    /// Builds a config with production defaults (50 ms budget, bootstrap `Warn`,
    /// critical force-block on).
    #[must_use]
    pub fn new(event_signing_key: SigningKey) -> Self {
        Self {
            budget_ms: 50,
            bootstrap_action: Action::Warn,
            event_signing_key,
            critical_force_block: true,
        }
    }
}
