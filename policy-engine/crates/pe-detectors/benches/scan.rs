//! Benchmark for the full detector sweep (contributes to the 50ms SLO).

use criterion::{criterion_group, criterion_main, Criterion};
use pe_core::{Budget, ScanContext, ScanInput};
use pe_detectors::DetectorRegistry;

const SAMPLE: &str = r#"
Hi team, deploying with AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE and a token
ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa. Reach me at dev@example.com or
+1 415-555-0132. Test card 4111 1111 1111 1111. Here is some code:

pub fn handler() -> i32 {
    let mut total = 0;
    for i in 0..10 { total += i; }
    println!("{}", total);
    total
}
"#;

fn bench_scan(c: &mut Criterion) {
    let reg = DetectorRegistry::default_set();
    let input = ScanInput::new(SAMPLE, ScanContext::default());
    c.bench_function("scan_all_detectors", |b| {
        b.iter(|| reg.scan_all(&input, &Budget::unlimited()))
    });
}

criterion_group!(benches, bench_scan);
criterion_main!(benches);
