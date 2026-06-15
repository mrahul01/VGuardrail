# VGuardrail macOS Endpoint Agent (MVP)

The macOS endpoint agent for the VGuardrail / AI Governance Platform. It submits
prompts to the local policy engine (`pe-engined`) over gRPC, receives decisions,
and owns the audit-event pipeline: store → queue offline → upload later.

> **Scope (MVP):** LaunchDaemon, XPC service, menu bar app, gRPC client, policy
> sync, event queue, upload worker. **Not yet:** browser monitoring, IDE
> integrations, dashboard (those live in their own top-level folders).

## Architecture

```
 vgctl / connectors / menu bar ──XPC──► vguardiand (LaunchDaemon)
                                          │  AgentCore (actor)
                                          ├─ PolicyEngineClient ─(UDS)─► pe-engined
                                          ├─ EventQueue (SQLite, agent-owned)
                                          ├─ Policy sync ─ LoadPolicy ─► pe-engined
                                          └─ Upload worker ─(HTTPS)─► AWS (future)
```

## Modules

| Target | Kind | What |
|--------|------|------|
| `VGCore` | lib | wire-stable models, `AuditEvent`, identity, UUIDv7 |
| `VGSQLite` | lib | `libsqlite3` wrapper (no external deps) |
| `VGEventQueue` | lib | actor over SQLite: queue state machine + tables |
| `VGXPCProtocol` | lib | `@objc AgentControl`, codec, `AgentXPCClient` |
| `VGAgentCore` | lib | orchestration actor + seams + loopback double |
| `VGGRPCClient` | lib | grpc-swift v2 client (**gated `VG_GRPC=1`**) |
| `vguardiand` | exe | the daemon: XPC listener + workers |
| `VGuardrailMenuBar` | exe | SwiftUI `MenuBarExtra` status app |
| `vgctl` | exe | dev CLI / MVP prompt-submission path |
| `vgselfcheck` | exe | runtime verification harness (see Testing) |

## Integration with the policy engine

No engine changes. The agent consumes the existing
[`pe-grpc` contract](../policy-engine/crates/pe-grpc/proto/policy_engine/v1/policy_engine.proto)
(`Evaluate` / `LoadPolicy` / `Health`) over the UDS `pe-engined` already serves
(`/var/run/vguardrail/policy.sock`). `Scripts/gen-proto.sh` syncs the proto.

## Build modes

```bash
# Offline core (default): builds & verifies without network or Xcode.
swift build
swift run vgselfcheck

# Full build (real gRPC client + daemon): needs network SPM + Xcode + protoc.
Scripts/gen-proto.sh
VG_GRPC=1 swift build -c release
```

## Testing — important environment note

Unit tests are written with **swift-testing** (`import Testing`). **XCTest is
unavailable in a Command-Line-Tools-only environment** (it ships with full Xcode),
and SwiftPM under CLT builds but does **not execute** test bundles. So:

- **`vgselfcheck`** is the runtime verifier that *runs here* (`swift run
  vgselfcheck`) — 35 checks across the offline modules, exit non-zero on failure.
  Use it as a CI gate on non-Xcode machines.
- **`swift test`** compiles the swift-testing suites (catching errors) and runs
  them on an Xcode/CI host.

What was verified in this build environment: all offline modules compile; the 35
`vgselfcheck` assertions pass; `vguardiand` boots, creates its store, writes an
`AgentStarted` event, and persists identity + signing key at `0600`; `vgctl`
prints usage and handles an unavailable daemon gracefully. **Not** exercisable
here (need network/Xcode/signing): the live gRPC client, the GUI, launchd
registration, and signed XPC peer validation.

## Run the daemon locally (dev, offline)

```bash
VG_ALLOW_LOOPBACK=1 VG_XPC_ALLOW_UNSIGNED=1 \
VG_STORE_PATH=/tmp/agent.db VG_IDENTITY_DIR=/tmp/vg-id \
swift run vguardiand
```

(The loopback client returns WARN — never silent ALLOW — and the daemon refuses
to start in loopback mode unless `VG_ALLOW_LOOPBACK=1`.)

## Install (production)

```bash
sudo Scripts/install.sh         # builds release, installs daemon + plist, bootstraps
```

Set `VG_XPC_REQUIREMENT` to your Team ID code requirement and Developer ID-sign
the binaries, or the daemon rejects XPC peers (fail-closed). Dev-only escape
hatch: `VG_XPC_ALLOW_UNSIGNED=1`. When `VG_UPLOAD_URL` is set the daemon also
registers the device with the backend and uploads a process/extension
inventory snapshot every 10 minutes (`--inventory-once` for a one-shot run).

## Security posture

- **Privacy:** the agent builds audit events from the engine's *redacted*
  response; raw prompts and secrets are never queued or uploaded.
- **Fail-closed:** unavailable engine → no decision recorded; missing policy →
  WARN; unsigned/rolled-back policy rejected by the engine; XPC peers rejected
  without a configured code requirement.
- **At rest:** event signing key + identity at `0600`; SQLCipher (AES-256) is the
  `VGSQLite` swap point for the queue DB.
