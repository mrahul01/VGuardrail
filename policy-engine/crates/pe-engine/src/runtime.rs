//! Runtime assembly: builds a ready [`EngineService`] from configuration,
//! re-hydrating any cached policy so a restart keeps enforcing.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, RwLock};

use base64::Engine as _;
use ed25519_dalek::SigningKey;
use pe_core::{Clock, SystemClock};
use pe_detectors::DetectorRegistry;
use pe_dsl::{verifying_key_from_b64, PolicySet};
use pe_store::Store;
use thiserror::Error;

use crate::config::EngineConfig;
use crate::service::EngineService;

/// Errors assembling the runtime.
#[derive(Debug, Error)]
pub enum RuntimeError {
    /// The pinned policy public key was invalid.
    #[error("invalid policy public key: {0}")]
    BadKey(String),

    /// A detector could not be built (e.g. invalid customer-id pattern).
    #[error("detector init failed: {0}")]
    Detectors(String),

    /// The local store could not be opened/migrated.
    #[error("store error: {0}")]
    Store(#[from] pe_store::StoreError),

    /// A required environment variable was missing.
    #[error("missing required environment variable: {0}")]
    MissingEnv(&'static str),

    /// The event-signing seed was not a valid base64 32-byte value.
    #[error("invalid event signing seed: {0}")]
    BadSeed(String),

    /// The detector-policy YAML (`VG_DETECTOR_CONFIG`) could not be read/parsed.
    #[error("invalid detector config: {0}")]
    BadDetectorConfig(String),
}

/// Reads [`RuntimeParams`] from the process environment (see `main.rs`).
///
/// # Errors
/// Returns [`RuntimeError::MissingEnv`]/[`RuntimeError::BadSeed`] on bad config.
pub fn runtime_params_from_env() -> Result<RuntimeParams, RuntimeError> {
    let policy_pubkey_b64 = std::env::var("VG_POLICY_PUBKEY")
        .map_err(|_| RuntimeError::MissingEnv("VG_POLICY_PUBKEY"))?;
    let seed_b64 = std::env::var("VG_EVENT_SIGNING_SEED")
        .map_err(|_| RuntimeError::MissingEnv("VG_EVENT_SIGNING_SEED"))?;
    let seed_raw = base64::engine::general_purpose::STANDARD
        .decode(seed_b64.trim())
        .map_err(|e| RuntimeError::BadSeed(e.to_string()))?;
    let event_signing_seed: [u8; 32] = seed_raw
        .as_slice()
        .try_into()
        .map_err(|_| RuntimeError::BadSeed("seed must be 32 bytes".to_string()))?;

    Ok(RuntimeParams {
        store_path: std::env::var("VG_STORE_PATH")
            .unwrap_or_else(|_| "/var/db/vguardrail/queue.db".to_string()),
        policy_pubkey_b64,
        event_signing_seed,
        device_id: std::env::var("VG_DEVICE_ID").ok(),
        detector_config_path: std::env::var("VG_DETECTOR_CONFIG").ok(),
        llm: crate::llm::LlmConfig::from_env(),
        code_classifier: crate::code_classifier::CodeClassifierConfig::from_env(),
    })
}

/// Parameters needed to bring up the engine.
pub struct RuntimeParams {
    /// SQLite path, or `":memory:"` for an ephemeral store.
    pub store_path: String,
    /// Base64 Ed25519 public key that signs policy bundles (pinned).
    pub policy_pubkey_b64: String,
    /// 32-byte seed for the event-signing key (from the Keychain in production).
    pub event_signing_seed: [u8; 32],
    /// Device id; falls back to the stored device id, then `"unknown-device"`.
    pub device_id: Option<String>,
    /// Path to the YAML detector-policy file (`VG_DETECTOR_CONFIG`); defaults
    /// apply when unset.
    pub detector_config_path: Option<String>,
    /// Optional local-LLM enrichment config (`VG_LLM_ENDPOINT`).
    pub llm: Option<crate::llm::LlmConfig>,
    /// Optional second-stage code classifier (`VG_CODE_CLASSIFIER_ENDPOINT`).
    pub code_classifier: Option<crate::code_classifier::CodeClassifierConfig>,
}

/// Loads the [`pe_detectors::DetectorConfig`] from a YAML file, or defaults.
fn load_detector_config(
    path: Option<&str>,
) -> Result<pe_detectors::DetectorConfig, RuntimeError> {
    let Some(path) = path else {
        return Ok(pe_detectors::DetectorConfig::default());
    };
    let raw = std::fs::read_to_string(path)
        .map_err(|e| RuntimeError::BadDetectorConfig(format!("{path}: {e}")))?;
    serde_yaml::from_str(&raw).map_err(|e| RuntimeError::BadDetectorConfig(format!("{path}: {e}")))
}

/// Assembles an [`EngineService`] and re-hydrates the cached policy, if any.
///
/// # Errors
/// Returns a [`RuntimeError`] if the key is invalid or the store cannot open.
pub fn build_runtime(params: RuntimeParams) -> Result<EngineService, RuntimeError> {
    let detector_config = load_detector_config(params.detector_config_path.as_deref())?;
    let registry = DetectorRegistry::from_config(&detector_config)
        .map_err(|e| RuntimeError::Detectors(e.to_string()))?;
    let known: HashSet<String> = registry.ids().into_iter().map(String::from).collect();

    let verifying_key = verifying_key_from_b64(&params.policy_pubkey_b64)
        .map_err(|e| RuntimeError::BadKey(e.to_string()))?;
    let mut policy = PolicySet::new(verifying_key, known);

    let store = if params.store_path == ":memory:" {
        Store::open_in_memory()?
    } else {
        Store::open(&params.store_path)?
    };

    // Re-hydrate the cached active policy (fail-closed: ignore a bad cache).
    if let Ok(Some(cached)) = store.active_policy() {
        if let Err(e) = policy.load(&cached.bundle_json) {
            tracing::warn!(error = %e, "cached policy failed to load; starting with no policy");
        }
    }

    let device_id = params
        .device_id
        .or_else(|| store.load_device().ok().flatten().map(|d| d.device_id))
        .unwrap_or_else(|| "unknown-device".to_string());

    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    let mut config = EngineConfig::new(SigningKey::from_bytes(&params.event_signing_seed));
    config.critical_force_block = detector_config.critical_force_block;

    let mut service = EngineService::new(
        Arc::new(registry),
        Arc::new(RwLock::new(policy)),
        Arc::new(Mutex::new(store)),
        clock,
        device_id,
        config,
    );
    if let Some(llm_config) = params.llm {
        tracing::info!(endpoint = %llm_config.endpoint, "LLM classification enabled");
        service = service.with_llm(Arc::new(crate::llm::LlmClassifier::new(llm_config)));
    }
    if let Some(code_config) = params.code_classifier {
        tracing::info!(endpoint = %code_config.endpoint, "code classifier enabled");
        service = service.with_code_classifier(Arc::new(
            crate::code_classifier::CodeClassifier::new(code_config),
        ));
    }
    Ok(service)
}
