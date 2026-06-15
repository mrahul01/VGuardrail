//! Integration tests for the local store: queue state machine, backoff/dead
//! transitions, policy cache invariants, device state, and migrations.

use pe_store::{
    CachedPolicy, DeviceState, EventStatus, QueuedEvent, Store, UploadOutcome, UploadRecord,
};

fn event(id: &str) -> QueuedEvent {
    QueuedEvent {
        event_id: id.to_string(),
        event_type: "PolicyEvaluated".to_string(),
        created_at: format!("2026-06-04T00:00:{id:0>2}Z"),
        payload: b"{\"decision\":\"block\"}".to_vec(),
        payload_sig: "ed25519:sig".to_string(),
    }
}

#[test]
fn enqueue_claim_and_ack_flow() {
    let mut store = Store::open_in_memory().unwrap();
    store.enqueue(&event("01")).unwrap();
    store.enqueue(&event("02")).unwrap();
    assert_eq!(store.queue_depth().unwrap(), 2);

    let batch = store.claim_batch(10, 1_000).unwrap();
    assert_eq!(batch.len(), 2);
    assert_eq!(store.count_by_status(EventStatus::Inflight).unwrap(), 2);

    // Claiming again returns nothing (all inflight).
    assert!(store.claim_batch(10, 1_000).unwrap().is_empty());

    store
        .mark_uploaded(&batch.iter().map(|e| e.event_id.clone()).collect::<Vec<_>>())
        .unwrap();
    assert_eq!(store.count_by_status(EventStatus::Uploaded).unwrap(), 2);
    assert_eq!(store.queue_depth().unwrap(), 0);

    assert_eq!(store.purge_uploaded().unwrap(), 2);
    assert_eq!(store.count_by_status(EventStatus::Uploaded).unwrap(), 0);
}

#[test]
fn failure_backoff_then_dead() {
    let mut store = Store::open_in_memory().unwrap();
    store.enqueue(&event("01")).unwrap();
    store.claim_batch(10, 0).unwrap();

    // First failure → failed with a future retry time.
    let s = store.mark_failed("01", "network", 1_000, 100, 3).unwrap();
    assert_eq!(s, EventStatus::Failed);
    // Not yet retryable at now=1_000 (next_retry_at = 1_000 + 100*2^0 = 1_100).
    assert!(store.claim_batch(10, 1_050).unwrap().is_empty());
    // Retryable once the backoff elapses.
    assert_eq!(store.claim_batch(10, 2_000).unwrap().len(), 1);

    let s = store.mark_failed("01", "network", 2_000, 100, 3).unwrap();
    assert_eq!(s, EventStatus::Failed);
    store.claim_batch(10, 10_000).unwrap();
    // Third failure reaches max_attempts → dead.
    let s = store.mark_failed("01", "network", 10_000, 100, 3).unwrap();
    assert_eq!(s, EventStatus::Dead);
    assert_eq!(store.count_by_status(EventStatus::Dead).unwrap(), 1);
    // Dead events are not reclaimed.
    assert!(store.claim_batch(10, 1_000_000).unwrap().is_empty());
}

#[test]
fn policy_cache_single_active_invariant() {
    let mut store = Store::open_in_memory().unwrap();
    let p1 = CachedPolicy {
        version: 1,
        bundle_json: b"{\"version\":1}".to_vec(),
        signature: "sig1".into(),
        key_id: "k".into(),
        is_active: true,
    };
    let p2 = CachedPolicy {
        version: 2,
        bundle_json: b"{\"version\":2}".to_vec(),
        signature: "sig2".into(),
        key_id: "k".into(),
        is_active: true,
    };
    store.install_policy(&p1, "t", "t", true).unwrap();
    assert_eq!(store.active_policy().unwrap().unwrap().version, 1);

    store.install_policy(&p2, "t", "t", true).unwrap();
    let active = store.active_policy().unwrap().unwrap();
    assert_eq!(active.version, 2, "newer policy becomes the sole active");
    assert_eq!(store.policy_versions().unwrap(), vec![1, 2]);
}

#[test]
fn policy_prune_keeps_recent_and_active() {
    let mut store = Store::open_in_memory().unwrap();
    for v in 1..=5 {
        let p = CachedPolicy {
            version: v,
            bundle_json: vec![],
            signature: "s".into(),
            key_id: "k".into(),
            is_active: v == 5,
        };
        store.install_policy(&p, "t", "t", v == 5).unwrap();
    }
    // Keep the 3 most recent (3,4,5).
    store.prune_policies(3).unwrap();
    assert_eq!(store.policy_versions().unwrap(), vec![3, 4, 5]);
    assert_eq!(store.active_policy().unwrap().unwrap().version, 5);
}

#[test]
fn device_state_round_trips() {
    let store = Store::open_in_memory().unwrap();
    assert!(store.load_device().unwrap().is_none());
    let d = DeviceState {
        device_id: "dev_1".into(),
        hostname: "macbook".into(),
        agent_version: "0.1.0".into(),
        registered: true,
        last_policy_sync: Some("2026-06-04T00:00:00Z".into()),
        last_seen: None,
    };
    store.save_device(&d).unwrap();
    assert_eq!(store.load_device().unwrap().unwrap(), d);

    // Singleton: a second save replaces, not duplicates.
    let mut d2 = d.clone();
    d2.registered = false;
    store.save_device(&d2).unwrap();
    assert_eq!(store.load_device().unwrap().unwrap(), d2);
}

#[test]
fn upload_records_persist() {
    let store = Store::open_in_memory().unwrap();
    let rec = UploadRecord {
        batch_id: "b1".into(),
        started_at: "t0".into(),
        finished_at: Some("t1".into()),
        event_count: 10,
        accepted: Some(9),
        rejected: Some(1),
        outcome: UploadOutcome::Partial,
    };
    store.record_upload(&rec).unwrap();
}

#[test]
fn duplicate_event_id_is_rejected() {
    let store = Store::open_in_memory().unwrap();
    store.enqueue(&event("01")).unwrap();
    assert!(store.enqueue(&event("01")).is_err());
}

#[test]
fn migrations_are_idempotent_on_disk() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    let path = tmp.path().to_str().unwrap();
    {
        let store = Store::open(path).unwrap();
        store.enqueue(&event("01")).unwrap();
    }
    // Re-opening runs migrations again without error and preserves data.
    let store = Store::open(path).unwrap();
    assert_eq!(store.queue_depth().unwrap(), 1);
}
