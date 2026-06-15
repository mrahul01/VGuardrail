// @vguardrail/connector-sdk — the single integration layer all connectors use
// to talk to the macOS agent daemon over the xpc-bridge.
//
// Quick start:
//   import { ConnectorClient } from '@vguardrail/connector-sdk';
//   const client = new ConnectorClient();
//   const res = await client.scan({ text, context });   // throws if unavailable
//   // or, fail-closed:
//   const res = await client.safeScan({ text, context }); // res.decision.action === 'block' on failure

// ── Client ───────────────────────────────────────────────────────────────────
export { ConnectorClient } from './client/connector-client.js';
export {
  DEFAULT_RETRY,
  DEFAULT_TIMEOUT_MS,
  type ClientOptions,
  type RetryConfig,
} from './client/options.js';

// ── Models ───────────────────────────────────────────────────────────────────
export {
  ActionSchema,
  CategorySchema,
  ClassificationSchema,
  EventTypeSchema,
  RiskLevelSchema,
  RoleSchema,
  SeveritySchema,
  SourceSchema,
  primaryEventType,
  type Action,
  type Category,
  type Classification,
  type EventType,
  type RiskLevel,
  type Role,
  type Severity,
  type Source,
} from './models/enums.js';

export {
  decodeScanRequest,
  encodeScanRequest,
  type FileContext,
  type RepoContext,
  type ScanContext,
  type ScanRequest,
  type UserContext,
} from './models/scan-request.js';

export {
  decodeDecision,
  encodeDecision,
  type Decision,
  type Finding,
  type Suppression,
} from './models/decision.js';

export {
  makeScanResponse,
  syntheticDecision,
  type ScanResponse,
} from './models/scan-response.js';

export { violationsFrom, type Violation } from './models/violation.js';

export {
  auditEventCanonicalJSON,
  decodeAuditEvent,
  encodeAuditEvent,
  makeAuditEvent,
  type AuditEvent,
} from './models/audit-event.js';

export {
  decodeAgentStatus,
  decodeDecisionSummaries,
  decodeDecisionSummary,
  type AgentStatus,
  type DecisionSummary,
} from './models/agent-status.js';

export { SCHEMA_VERSION, canonicalJSON } from './models/schema.js';

// ── Transport ────────────────────────────────────────────────────────────────
export type { Transport } from './transport/transport.js';
export { XpcBridgeTransport, type XpcBridgeOptions } from './transport/xpc-bridge-transport.js';
export { MockTransport, type MockResponder, type MockCallContext } from './transport/mock-transport.js';

// ── Protocol ─────────────────────────────────────────────────────────────────
export { Method, type MethodName } from './protocol/methods.js';
export {
  PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  encodeFrame,
  parseReplyEnvelope,
  FrameDecoder,
  type ReplyEnvelope,
  type RequestEnvelope,
} from './protocol/envelope.js';
export {
  SDK_VERSION,
  SUPPORTED_PROTOCOLS,
  helloParams,
  negotiate,
  type HelloParams,
  type NegotiatedVersion,
} from './protocol/version.js';

// ── Resilience ───────────────────────────────────────────────────────────────
export {
  ConnectorError,
  ConnectorErrorCode,
  EngineUnavailableError,
  NotConnectedError,
  RemoteError,
  RetryExhaustedError,
  TimeoutError,
  TransportError,
  ValidationError,
  VersionMismatchError,
  connectorErrorFromWire,
  isRetryable,
} from './resilience/errors.js';
export { backoffDelay, withRetry, type RetryOptions } from './resilience/retry.js';
export { withTimeout } from './resilience/timeout.js';

// ── Logging ──────────────────────────────────────────────────────────────────
export { consoleLogger, noopLogger, type Logger, type LogFields } from './util/logger.js';
