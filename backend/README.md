# VGuardrail AWS Audit Cloud (MVP)

The backend closing the agent loop: **device registration → policy download →
event upload → audit storage**, plus the `/admin/*` API the dashboard consumes
and the dev `/scan` endpoint (runs the real detector pipeline in-process).
Two deployment shapes share the same `app` crate: AWS Lambda binaries
(`lambdas/`) and the local/server axum binary (`server/`, axum 0.7 — path
params are `/:id`, not `{id}`).

## Layout

```
backend/
├── openapi/openapi.yaml          # OpenAPI 3.1 contract (4 endpoints)
├── lambdas/                      # Rust workspace (reuses pe-core / pe-dsl)
│   └── crates/
│       ├── audit-core/           # event types, hash chain, idempotency keys
│       ├── app/                  # handler logic over ports + in-memory fakes + tests
│       ├── aws/                  # DynamoDB / S3 / Cognito / Secrets adapters
│       └── functions/            # 4 Lambda binaries (lambda_http)
├── terraform/
│   ├── modules/                  # kms, dynamodb, s3-audit, cognito, secrets,
│   │                             #   lambda, api, observability, stack
│   ├── stacks/{dev,staging,prod} # thin env callers of modules/stack
│   └── global/                   # remote-state + GitHub OIDC CI bootstrap
├── localstack/                   # docker-compose + provision + data-plane e2e
└── scripts/build-lambdas.sh      # cargo-lambda build + zip
```

## Endpoints

| Method/Path | Auth | Function |
|-------------|------|----------|
| `GET /health` | none | `fn-health` |
| `POST /devices/register` | enrollment secret | `fn-register` (Cognito + Dynamo) |
| `GET /policies/latest` | Cognito JWT | `fn-policy-latest` (verify + serve, `304`) |
| `POST /events/batch` | Cognito JWT | `fn-events-batch` (chain + idempotency + S3) |

## Audit integrity (new requirements)

- **Tamper-evident chain:** each stored event has `event_hash =
  SHA-256(canonical_content ‖ previous_event_hash)`, linked per device. Any
  insert/delete/edit breaks the chain.
- **Idempotent ingestion:** `upload_id` replays the original result; `event_id`
  conditional writes prevent duplicate records. The chain advance + dedup are a
  single DynamoDB `TransactWriteItems` (atomic).

## Build, test, validate (what runs here)

```bash
# Rust handlers + integrity logic (verified natively, no AWS):
cd lambdas && cargo test --workspace            # 23 tests; cargo clippy clean
cargo test -p app --test e2e_flow               # full agent flow over fakes

# Terraform (all stacks validate):
cd terraform/stacks/dev && terraform init -backend=false && terraform validate
```

## Deploy (needs AWS + tooling)

```bash
scripts/build-lambdas.sh                         # needs cargo-lambda + zig
cd terraform/stacks/dev
terraform init && terraform apply                # needs AWS credentials
```

## What was verified vs. not (this environment)

- **Verified here:** all Rust crates compile; **23 unit/integration tests pass**
  (hash chain, idempotency, dedup, device scoping, policy ETag, register, full
  e2e flow); `cargo clippy` clean; **all 4 Terraform stacks `terraform validate`**;
  `terraform fmt` clean.
- **Not run here (documented):** `terraform apply` (no AWS creds), the
  `cargo-lambda` cross-compile (no cargo-lambda/zig), and LocalStack e2e (Docker
  daemon unavailable). The native `e2e_flow` test is the executed equivalent of
  the LocalStack data-plane e2e. The register→Cognito path needs an AWS dev
  account to validate (review S-2).
