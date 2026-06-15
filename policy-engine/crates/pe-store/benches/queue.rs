//! Benchmark for the enqueue + claim hot path of the local queue.

use criterion::{criterion_group, criterion_main, Criterion};
use pe_store::{QueuedEvent, Store};

fn event(i: usize) -> QueuedEvent {
    QueuedEvent {
        event_id: format!("evt-{i:08}"),
        event_type: "PolicyEvaluated".to_string(),
        created_at: "2026-06-04T00:00:00Z".to_string(),
        payload: b"{\"decision\":\"allow\"}".to_vec(),
        payload_sig: "ed25519:sig".to_string(),
    }
}

fn bench_queue(c: &mut Criterion) {
    c.bench_function("enqueue_then_claim_100", |b| {
        b.iter(|| {
            let mut store = Store::open_in_memory().unwrap();
            for i in 0..100 {
                store.enqueue(&event(i)).unwrap();
            }
            let batch = store.claim_batch(100, 1).unwrap();
            assert_eq!(batch.len(), 100);
        })
    });
}

criterion_group!(benches, bench_queue);
criterion_main!(benches);
