//! Dev tool: sign a policy bundle JSON so `pe-engined` will accept it.
//!
//! The engine only ever *verifies* bundles (against the pinned
//! `VG_POLICY_PUBKEY`); production signing happens in the dashboard signer.
//! This example exists so local/dev environments can produce a valid signed
//! bundle from the seed in the repo's `.env`.
//!
//! Usage:
//!   VG_POLICY_SIGNING_SEED=<base64 32-byte seed> \
//!     cargo run -p pe-dsl --example sign_bundle -- unsigned.json signed.json [key_id]

use base64::Engine as _;
use ed25519_dalek::SigningKey;
use pe_dsl::{sign_bundle, PolicyBundle};

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args.next().expect("usage: sign_bundle <in.json> <out.json> [key_id]");
    let output = args.next().expect("usage: sign_bundle <in.json> <out.json> [key_id]");
    let key_id = args.next().unwrap_or_else(|| "local-dev".to_string());

    let seed_b64 = std::env::var("VG_POLICY_SIGNING_SEED")
        .expect("VG_POLICY_SIGNING_SEED must hold the base64 32-byte signing seed");
    let seed_raw = base64::engine::general_purpose::STANDARD
        .decode(seed_b64.trim())
        .expect("seed is not valid base64");
    let seed: [u8; 32] = seed_raw
        .as_slice()
        .try_into()
        .expect("seed must decode to exactly 32 bytes");
    let signing_key = SigningKey::from_bytes(&seed);

    let bytes = std::fs::read(&input).expect("read input bundle");
    let bundle: PolicyBundle = serde_json::from_slice(&bytes).expect("parse input bundle");
    let signed = sign_bundle(&bundle, &signing_key, &key_id);
    std::fs::write(&output, serde_json::to_vec_pretty(&signed).expect("serialize"))
        .expect("write signed bundle");

    let pubkey = base64::engine::general_purpose::STANDARD
        .encode(signing_key.verifying_key().to_bytes());
    eprintln!("signed {input} -> {output} (version {}, pubkey {pubkey})", signed.version);
}
