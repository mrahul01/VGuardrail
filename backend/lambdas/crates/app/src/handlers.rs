//! The four endpoint handlers, written against the [`crate::ports`] traits so
//! they are exercised end-to-end with in-memory fakes (no AWS needed).

use audit_core::{compute_event_hash, effective_upload_id, ApiError, AuditEvent, GENESIS_PREV};

use crate::dto::{BatchRequest, BatchResponse, Health, RegisterRequest, RegisterResponse};
use crate::ports::{
    AppendOutcome, ArchiveStore, AuditStore, ChainHead, DeviceDirectory, DeviceIdentityIssuer,
    DeviceRecord, EnrollmentVerifier, IdempotencyStore, PolicyRepo, RequestContext, StoreError,
    UploadRecord,
};

/// Max events per batch.
pub const MAX_BATCH_EVENTS: usize = 1000;
/// Max raw batch body size (bytes).
pub const MAX_BATCH_BYTES: usize = 5 * 1024 * 1024;
/// Max chain-conflict retries per event.
const MAX_CHAIN_RETRIES: u32 = 8;

fn backend(e: StoreError) -> ApiError {
    ApiError::Internal(e.to_string())
}

// ── Health ───────────────────────────────────────────────────────────────────

/// Builds the health payload.
#[must_use]
pub fn handle_health(version: &str, now_iso: &str) -> Health {
    Health {
        status: "healthy".to_string(),
        version: version.to_string(),
        time: now_iso.to_string(),
    }
}

// ── Register ─────────────────────────────────────────────────────────────────

/// Registers a device: validates the org enrollment secret, upserts the device
/// (idempotent), and issues credentials.
pub async fn handle_register(
    enrollment: &dyn EnrollmentVerifier,
    devices: &dyn DeviceDirectory,
    identity: &dyn DeviceIdentityIssuer,
    enrollment_token: Option<&str>,
    req: RegisterRequest,
    now_ms: i64,
) -> Result<RegisterResponse, ApiError> {
    let token = enrollment_token
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| ApiError::Unauthorized("missing enrollment token".into()))?;

    let org_id = enrollment
        .resolve_org(token)
        .await
        .map_err(backend)?
        .ok_or_else(|| ApiError::Unauthorized("invalid enrollment token".into()))?;

    if req.device_id.trim().is_empty() {
        return Err(ApiError::BadRequest("device_id is required".into()));
    }
    if req.platform != "macos" {
        return Err(ApiError::BadRequest("unsupported platform".into()));
    }

    let record = DeviceRecord {
        device_id: req.device_id.clone(),
        org_id: org_id.clone(),
        hostname: req.hostname,
        platform: req.platform,
        agent_version: req.agent_version,
        registered_at_ms: now_ms,
        model: req.model,
        os_version: req.os_version,
        last_user: req.username,
        // Lambda path: the client IP comes from the API-gateway event, which
        // this handler does not see; the HTTP server path populates it.
        ip_address: None,
        hostname_full: req.hostname_full,
    };
    devices.upsert(&record).await.map_err(backend)?;

    let tokens = identity
        .ensure_user_and_issue(&req.device_id, &org_id)
        .await
        .map_err(backend)?;

    Ok(RegisterResponse {
        status: "registered".to_string(),
        org_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
    })
}

// ── Policy download ──────────────────────────────────────────────────────────

/// Outcome of a policy-latest request.
#[derive(Debug)]
pub enum PolicyOutcome {
    /// Client already has the latest version.
    NotModified,
    /// The latest signed bundle.
    Bundle {
        /// Version (ETag).
        version: u32,
        /// Raw signed bundle bytes.
        bytes: Vec<u8>,
    },
}

/// Returns the latest signed policy bundle for the caller's org, honoring
/// `If-None-Match`. If a pinned verifying key is configured, the bundle's
/// Ed25519 signature is verified before it is served (the cloud verifies, never
/// signs).
pub async fn handle_policy_latest(
    repo: &dyn PolicyRepo,
    org_id: &str,
    if_none_match: Option<&str>,
    verifying_key_b64: Option<&str>,
) -> Result<PolicyOutcome, ApiError> {
    let artifact = repo
        .latest(org_id)
        .await
        .map_err(backend)?
        .ok_or_else(|| ApiError::NotFound("no policy published for org".into()))?;

    if if_none_match.is_some_and(|etag| etag.trim_matches('"') == artifact.version.to_string()) {
        return Ok(PolicyOutcome::NotModified);
    }

    if let Some(key_b64) = verifying_key_b64 {
        verify_bundle_bytes(&artifact.bytes, key_b64)?;
    }

    Ok(PolicyOutcome::Bundle {
        version: artifact.version,
        bytes: artifact.bytes,
    })
}

fn verify_bundle_bytes(bytes: &[u8], key_b64: &str) -> Result<(), ApiError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| ApiError::Internal(format!("stored policy not JSON: {e}")))?;
    let key = pe_dsl::verifying_key_from_b64(key_b64)
        .map_err(|e| ApiError::Internal(format!("bad pinned key: {e}")))?;
    pe_dsl::verify_bundle(&value, &key)
        .map_err(|e| ApiError::Internal(format!("stored policy failed verification: {e}")))
}

// ── Event ingestion (hash chain + idempotency) ───────────────────────────────

/// Ingests a batch of audit events: idempotent on `upload_id` and `event_id`,
/// archiving the raw batch and chaining each new event per device.
pub async fn handle_events_batch(
    store: &dyn AuditStore,
    archive: &dyn ArchiveStore,
    idem: &dyn IdempotencyStore,
    ctx: &RequestContext,
    header_upload_id: Option<&str>,
    body: &[u8],
) -> Result<BatchResponse, ApiError> {
    if body.len() > MAX_BATCH_BYTES {
        return Err(ApiError::PayloadTooLarge("batch exceeds 5 MiB".into()));
    }
    let request: BatchRequest = serde_json::from_slice(body)
        .map_err(|e| ApiError::Unprocessable(format!("malformed batch: {e}")))?;
    if request.events.is_empty() {
        return Err(ApiError::Unprocessable("batch is empty".into()));
    }
    if request.events.len() > MAX_BATCH_EVENTS {
        return Err(ApiError::PayloadTooLarge(
            "batch exceeds 1000 events".into(),
        ));
    }

    let event_ids: Vec<String> = request.events.iter().map(|e| e.event_id.clone()).collect();
    let client_id = header_upload_id.or(request.upload_id.as_deref());
    let upload_id = effective_upload_id(client_id, &event_ids);

    // Whole-batch idempotency: replay a previously-processed upload verbatim.
    if let Some(record) = idem.get(&upload_id).await.map_err(backend)? {
        return Ok(BatchResponse {
            accepted: record.accepted,
            rejected: record.rejected,
            upload_id,
            replayed: true,
        });
    }

    // Validate; a device may only upload its own events.
    let mut valid: Vec<AuditEvent> = Vec::with_capacity(request.events.len());
    let mut rejected: u32 = 0;
    for event in request.events {
        if event.event_id.trim().is_empty() || event.device_id != ctx.device_id {
            rejected += 1;
            continue;
        }
        valid.push(event);
    }

    // Durability first: archive the raw batch (immutable) before indexing.
    archive
        .put_raw(&ctx.org_id, &ctx.device_id, &upload_id, body)
        .await
        .map_err(backend)?;

    // Deterministic chain order.
    valid.sort_by(|a, b| {
        a.timestamp_ms
            .cmp(&b.timestamp_ms)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });

    let mut accepted: u32 = 0;
    let mut head = store.chain_head(&ctx.device_id).await.map_err(backend)?;

    for mut event in valid {
        let mut attempts = 0;
        loop {
            let prev = head
                .as_ref()
                .map_or_else(|| GENESIS_PREV.to_string(), |h| h.hash.clone());
            event.previous_event_hash = Some(prev.clone());
            let hash = compute_event_hash(&event, &prev);
            event.event_hash = Some(hash.clone());
            let count = head.as_ref().map_or(0, |h| h.count) + 1;
            let new_head = ChainHead {
                hash: hash.clone(),
                event_id: event.event_id.clone(),
                count,
            };

            match store
                .append_if_head(&event, head.as_deref_hash(), &new_head)
                .await
                .map_err(backend)?
            {
                AppendOutcome::Stored => {
                    head = Some(new_head);
                    accepted += 1;
                    break;
                }
                AppendOutcome::DuplicateEvent => {
                    // Already chained on a prior upload; resync the head and move on.
                    head = store.chain_head(&ctx.device_id).await.map_err(backend)?;
                    accepted += 1;
                    break;
                }
                AppendOutcome::ChainConflict => {
                    attempts += 1;
                    head = store.chain_head(&ctx.device_id).await.map_err(backend)?;
                    if attempts >= MAX_CHAIN_RETRIES {
                        rejected += 1;
                        break;
                    }
                }
            }
        }
    }

    let record = UploadRecord { accepted, rejected };
    idem.put(&upload_id, &ctx.device_id, &record)
        .await
        .map_err(backend)?;

    Ok(BatchResponse {
        accepted,
        rejected,
        upload_id,
        replayed: false,
    })
}

/// Helper to read the optional head hash as `Option<&str>`.
trait HeadHash {
    fn as_deref_hash(&self) -> Option<&str>;
}
impl HeadHash for Option<ChainHead> {
    fn as_deref_hash(&self) -> Option<&str> {
        self.as_ref().map(|h| h.hash.as_str())
    }
}
