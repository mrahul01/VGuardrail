# VGuardrail

AI-governance / DLP platform for macOS fleets: every prompt a user sends to an
AI tool — from a browser, an IDE, or a CLI — is scanned by a local policy
engine before it leaves the machine, and every decision is recorded in a
tamper-evident audit trail with an admin dashboard.

## Components

| Folder | What it is |
|---|---|
| [`policy-engine/`](policy-engine/) | Rust policy engine (`pe-engined`): 24-category detector pipeline, signed policy bundles (ed25519), risk scoring, optional Granite Guardian LLM refinement, gRPC over UDS. |
| [`agent/`](agent/) | Swift macOS agent (`vguardiand`): XPC enforcement endpoint, event queue/signing, device registration + process/extension inventory, menu bar app. |
| [`connector-sdk/`](connector-sdk/) | TypeScript SDK + native XPC bridge all connectors use to reach the agent. |
| [`browser-connectors/`](browser-connectors/) | Chrome/Edge/Brave/Firefox/Safari extensions that gate prompts on AI websites. |
| [`ide-connectors/`](ide-connectors/) | VS Code-family extension, JetBrains plugin, Xcode source-editor extension. |
| [`cli-connectors/`](cli-connectors/) | `vg-claude`, `vg-gemini`, `vg-codex`, `vg-aider`, `vg-ollama`, `vg-llama`, `vg-mlx`, `vg-sgpt`, `vg-gh-copilot` wrappers. |
| [`backend/`](backend/) | Audit Cloud: Rust axum server (+ AWS Lambda variants), DynamoDB storage, hash-chained audit events, admin API. |
| [`dashboard/`](dashboard/) | Next.js admin dashboard (devices, violations, policies, exceptions, audit, settings). |

## Enforcement spine

```
connector (browser / IDE / CLI)
  → connector-sdk → XPC (com.vguardrail.agent.xpc)
    → vguardiand (Swift daemon)
      → gRPC over /var/run/vguardrail/policy.sock
        → pe-engined (Rust policy engine)
```

Fail-closed everywhere: if any hop is down, the prompt is blocked, never
silently allowed. Decisions are uploaded to the backend and surfaced in the
dashboard (violations, per-device event timelines, audit chain).

## Local development quickstart

```bash
./start-local.sh             # DynamoDB-local + MinIO + backend (docker-compose.local.yml) + dashboard
./seed-local-data.sh         # demo devices/policies/users/inventory
open http://localhost:3000   # dashboard (local mode: DISABLE_AUTH=true)
```

- Backend rebuilds must use the local compose file:
  `docker compose -f docker-compose.local.yml build backend && docker compose -f docker-compose.local.yml up -d backend`.
  The default `docker-compose.yml` targets the real AWS dev environment.
- Browser extension: `cd browser-connectors/chrome/extension && npm run build`,
  then load `dist/` unpacked. In local dev it scans via `POST localhost:8080/scan`,
  which runs the real detector pipeline in-process.
- Optional local LLM (Granite Guardian 3.0 2B via llama.cpp):
  `./provision-policy-rules.sh && docker compose -f docker-compose.local.yml --profile llm up -d llm`,
  then set `VG_LLM_ENDPOINT` (see `docker-compose.local.yml` comments).

## Verification

```bash
( cd policy-engine && cargo test --workspace )       # needs PROTOC=/usr/local/bin/protoc
( cd backend/lambdas && cargo test ) && ( cd backend/server && cargo test )
( cd agent && swift build && swift run vgselfcheck )
( cd connector-sdk && npm test )
( cd dashboard && npx tsc --noEmit && npm test )
```

Each component folder has its own `README.md` with details.!
