# @vguardrail/connector-sdk

The single TypeScript integration layer every VGuardrail connector (Chrome
extension, Cursor, VS Code, CLI) uses to talk to the macOS agent daemon. It owns
the data models, the IPC protocol, and the cross-cutting concerns — retries,
timeouts, version negotiation, and error handling — so connectors contain only
their surface-specific capture logic.

> Status: **SDK + bridge protocol + mock transport are complete and tested.** The
> native Swift `xpc-bridge` helper that the default transport spawns lives in
> [`bridge/`](bridge/).

## Why a bridge?

The daemon vends an NSXPC Mach service (`com.vguardrail.agent.xpc`) and
authenticates callers by code-signing (`SecCodeCheckValidity`). A Node/TS
process cannot open an `NSXPCConnection`, so the SDK spawns a small **signed**
Swift helper that holds the XPC connection and relays length-prefixed JSON over
stdio. The daemon's peer check still authenticates the helper, so the XPC trust
boundary is preserved — the SDK does not weaken it with a loopback socket.

```
connector ──> ConnectorClient ──> Transport ──> xpc-bridge (signed) ──NSXPC──> vguardiand
                  (this SDK)                       (Swift helper)
```

## Quick start

```ts
import { ConnectorClient } from '@vguardrail/connector-sdk';

const client = new ConnectorClient();

// Throws if the engine is unreachable — the caller decides what to do:
const res = await client.scan({
  text: prompt,
  context: { source: 'browser', provider: 'openai', app: 'chatgpt',
             user: { userId, role: 'user', groups: [] } },
});
if (res.decision.action === 'block') { /* prevent send */ }

// …or fail closed automatically:
const safe = await client.safeScan({ text: prompt, context });
// safe.decision.action === 'block' and safe.fromFallback === true when unavailable
```

## API

| Method | Returns | Notes |
|---|---|---|
| `connect()` | `NegotiatedVersion` | `hello` handshake; auto-called on first use |
| `scan(request)` | `ScanResponse` | throws on failure (caller decides enforcement) |
| `safeScan(request, { fallbackAction })` | `ScanResponse` | maps unavailability to a fallback (default `block`) |
| `status()` | `AgentStatus` | engine/queue health |
| `acknowledgeWarning(eventId, accepted)` | `boolean` | records a WARN response |
| `recentDecisions(limit)` | `DecisionSummary[]` | recent decisions |
| `close()` | `void` | tears down the transport |

`ClientOptions`: `transport` (default `XpcBridgeTransport`), `timeoutMs`
(default 2000), `retry` (`maxAttempts` 3 / `baseDelayMs` 50 / `maxDelayMs` 1000),
`logger` (default no-op; never receives payloads).

The full model/method contracts and the stdio bridge wire protocol are
documented inline in `src/models/` and `src/transport/xpc-bridge-transport.ts`.

## Design notes

- **Models mirror the Swift wire format.** Every model is validated with `zod`
  and (de)serialized to the exact keys the Swift `VGCore` models use — snake_case
  for most (`request_id`, `risk_level`, `span_start`, file `extension`), and the
  raw camelCase Swift property names for `AgentStatus`/`DecisionSummary` (which
  declare no `CodingKeys`). Golden fixtures lock this.
- **`Violation` is a projection.** The engine emits a `Decision` with `findings`
  and a `matchedRuleId`, not a `Violation` struct. `violationsFrom(decision)`
  derives the normalized view so every connector agrees on it.
- **Fail-closed by choice, never by accident.** `scan` throws; `safeScan`
  applies an explicit fallback defaulting to `block`. Retries never mask a
  definitive engine verdict, and a write (`scan`/`acknowledgeWarning`) is not
  auto-retried after it may have reached the daemon (avoids duplicate audit
  events).
- **No sensitive data leaves the SDK.** Prompt text, finding previews, and spans
  are never logged.

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # eslint
npm test             # vitest: 67 unit + integration tests, no native deps
npm run build        # tsc → dist/ (ESM + .d.ts)
```

All tests run against `MockTransport`, so neither the daemon nor the native
helper is required to develop or verify the SDK.
