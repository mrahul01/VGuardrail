# VGuardrail — Local Policy Engine

> **Status: IMPLEMENTED.** All six crates compile independently, pass their unit +
> integration tests, are clippy-clean (`-D warnings`) and rustfmt-clean, and the
> `pe-engined` binary boots and serves over a `0600` Unix socket.

The Policy Engine is the local DLP / secrets / PII detection and rule-evaluation
core of the AGP/VGuardrail platform. It runs as a `LaunchDaemon`-managed Rust
gRPC server on the macOS endpoint, evaluates outbound AI prompts against signed
org policies in **< 50 ms**, and returns **Allow / Warn / Block** while queuing
redacted audit events for upload.

## Classification pipeline

Detectors (24 categories: secret, pii, source_code, company_confidential,
financial, intellectual_property, usage_policy, prompt_injection,
sensitive_document, customer_data, compliance, keyword, file_policy,
image_policy, destructive_command, legal, medical, hr, security,
research_development, communication, procurement, government, plus the
synthetic ai_classification aggregate) → risk score/tier (safe / low /
sensitive / confidential / restricted) → optional LLM + code-classifier
refinement (both **raise-only** and **fail-open**) → signed-bundle rule
evaluation → critical force-block.

Detector tuning is loaded from `VG_DETECTOR_CONFIG` (YAML, see
[`config/detectors.example.yaml`](config/detectors.example.yaml) — unknown
keys fail loudly).

### Optional LLM refinement (Granite Guardian 3.0 2B)

| Env | Meaning | Default |
|---|---|---|
| `VG_LLM_ENDPOINT` | `host:port` of a llama.cpp `/completion` server | unset (disabled) |
| `VG_LLM_TIMEOUT_MS` | per-call timeout | `2500` |

`./provision-policy-rules.sh` (repo root) downloads the GGUF;
`docker compose -f docker-compose.local.yml --profile llm up -d llm` serves it.
The verdict is grammar-constrained to `"<tier> <category>"`; the tier can only
be raised, never lowered, and any transport/parse failure falls back to the
deterministic score.

### Optional code classifier (second stage of the source-code chain)

The source-code detector gates cheap language/config-format detection; when it
fires, an optional fine-tuned classifier (CodeBERT/DeBERTa, TEI-style
`POST /predict` → `[{"label": "sensitive", "score": 0.93}, …]`) can raise the
tier to the Confidential floor when `label == "sensitive" && score >= 0.8`.

| Env | Meaning | Default |
|---|---|---|
| `VG_CODE_CLASSIFIER_ENDPOINT` | `host:port` of the classifier | unset (stage disabled) |
| `VG_CODE_CLASSIFIER_TIMEOUT_MS` | per-call timeout | `400` |

## Folder structure (Cargo workspace, Clean Architecture)

```
policy-engine/
├── Cargo.toml                  # workspace manifest
├── rust-toolchain.toml         # pinned MSRV
├── deny.toml                   # cargo-deny (licenses/advisories)
├── README.md
├── proto/
│   └── policy_engine/v1/policy_engine.proto
├── crates/
│   ├── pe-core/                # domain: types, traits, Decision (no deps)
│   │   ├── src/{lib,types,finding,decision,traits}.rs
│   │   └── tests/
│   ├── pe-dsl/                 # rule parse / validate / evaluate / signature
│   │   ├── src/{lib,model,parse,eval,signature}.rs
│   │   └── tests/
│   ├── pe-detectors/           # secret / pii / sourcecode / classification
│   │   ├── src/{lib,secret,pii,sourcecode,classification,registry}.rs
│   │   ├── tests/
│   │   └── corpora/<id>/{positives,negatives,thresholds.toml}
│   ├── pe-engine/              # orchestration pipeline, risk, classify
│   │   ├── src/{lib,pipeline,risk,classify,budget}.rs
│   │   └── tests/
│   ├── pe-store/               # SQLite/SQLCipher queue + cache
│   │   ├── src/{lib,queue,policy_cache,device,upload}.rs
│   │   ├── migrations/0001_init.sql
│   │   └── tests/
│   ├── pe-grpc/                # tonic server, UDS, peer-cred auth
│   │   ├── build.rs            # tonic-build
│   │   ├── src/{lib,server,map,auth}.rs
│   │   └── tests/
│   └── pe-cli/                 # dev harness / local eval REPL
│       └── src/main.rs
├── benches/                    # criterion perf gates (50ms SLO)
└── tests/
    ├── contract/               # shared gRPC request/response fixtures
    └── integration/            # end-to-end engine+store+grpc
```

## Key design decisions

- **Separate local process** over UDS `/var/run/vguardrail/policy.sock` (0600),
  not an in-Swift library — crash isolation + independent restart.
- **Pure, deterministic evaluation** — no clock/RNG on the request path; time and
  IDs injected for testability.
- **Privacy invariant** — raw prompt content and raw secrets are *never* stored or
  returned; only metadata + redacted previews.
- **Fail-closed** — bad/rolled-back/unsigned policies are rejected (keep last-good);
  no policy ⇒ default WARN, never silent ALLOW.

## Build & test

Prerequisites: a Rust toolchain (stable, MSRV 1.82 — see `rust-toolchain.toml`)
and `protoc` on `PATH` for the gRPC codegen.

```bash
# From policy-engine/
cargo build --workspace                 # build all six crates + the daemon binary
cargo test  --workspace                 # 104 unit + integration tests, all passing
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo bench --workspace                 # criterion benches (50ms SLO gates)

# Per-crate (each compiles independently):
cargo test -p pe-core
cargo test -p pe-dsl
cargo test -p pe-detectors              # includes the corpus precision/recall gate
cargo test -p pe-store
cargo test -p pe-grpc
cargo test -p pe-engine

# Production at-rest encryption for the local store:
cargo build -p pe-store --features sqlcipher

# Run the daemon (env-configured):
cargo build --release --bin pe-engined
VG_POLICY_PUBKEY=<base64 ed25519 pubkey> \
VG_EVENT_SIGNING_SEED=<base64 32-byte seed> \
VG_STORE_PATH=:memory: VG_SOCKET_PATH=/tmp/policy.sock \
  ./target/release/pe-engined
```

## Status of the open questions

Both questions from the design phase are resolved per the approval:
`default_action` is **tenant-configurable** (`allow`/`warn`/`block`); exceptions
are a **first-class, auditable construct** evaluated before rules; and bundles
carry `previous_version` with the agent retaining current / previous /
last_known_good.

## Next slices (out of scope here)

Swift endpoint agent, AWS backend + Terraform, and the Next.js dashboard — each a
separate vertical slice that consumes this engine's gRPC contract
(`crates/pe-grpc/proto`).
