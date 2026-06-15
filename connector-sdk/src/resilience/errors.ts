// Typed error taxonomy. Every failure surfaced by the SDK is a `ConnectorError`
// subclass carrying a stable `code` and a `retryable` flag the retry layer keys
// off. Error messages never include prompt text or finding previews.

/** Stable, machine-readable error codes. */
export enum ConnectorErrorCode {
  /** The transport (helper process / IPC) failed to spawn, connect, or write. */
  Transport = 'TRANSPORT',
  /** A per-call deadline elapsed before a reply arrived. */
  Timeout = 'TIMEOUT',
  /** No active connection (transport not connected / closed). */
  NotConnected = 'NOT_CONNECTED',
  /** The daemon returned an error string for the request. */
  Remote = 'REMOTE',
  /**
   * The daemon is reachable but the policy engine (`pe-engined`) is not, so no
   * decision could be obtained. An availability condition — distinct from a
   * `REMOTE` policy error — and eligible for a `safeScan` fail-closed fallback.
   */
  Unavailable = 'UNAVAILABLE',
  /** SDK and agent could not agree on a protocol/schema version. */
  VersionMismatch = 'VERSION_MISMATCH',
  /** A payload failed schema validation (malformed / unknown enum or schema). */
  Validation = 'VALIDATION',
  /** Retries were exhausted; `cause` holds the last underlying error. */
  RetryExhausted = 'RETRY_EXHAUSTED',
}

/** Base class for all SDK errors. */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
    // Preserve prototype chain across the TS/ES class transpilation boundary.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Transport/IPC failure (helper spawn, connect, write). Retryable. */
export class TransportError extends ConnectorError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(ConnectorErrorCode.Transport, message, { retryable: true, cause: options.cause });
  }
}

/** A per-call deadline elapsed. Not auto-retried by default (see retry policy). */
export class TimeoutError extends ConnectorError {
  readonly timeoutMs: number;
  constructor(message: string, timeoutMs: number) {
    super(ConnectorErrorCode.Timeout, message, { retryable: false });
    this.timeoutMs = timeoutMs;
  }
}

/** No active connection. Retryable (a reconnect may succeed). */
export class NotConnectedError extends ConnectorError {
  constructor(message = 'transport is not connected') {
    super(ConnectorErrorCode.NotConnected, message, { retryable: true });
  }
}

/** The daemon returned an explicit error for the request. Not retryable. */
export class RemoteError extends ConnectorError {
  constructor(message: string) {
    super(ConnectorErrorCode.Remote, message, { retryable: false });
  }
}

/**
 * The daemon is up but the policy engine (`pe-engined`) is unreachable, so no
 * decision was produced. Not retryable at the transport level (the daemon owns
 * the engine round-trip and already failed it); `safeScan` maps it to a
 * fail-closed fallback so the caller never silently allows the prompt through.
 */
export class EngineUnavailableError extends ConnectorError {
  constructor(message = 'policy engine unavailable') {
    super(ConnectorErrorCode.Unavailable, message, { retryable: false });
  }
}

/** SDK/agent version or schema mismatch. Not retryable. */
export class VersionMismatchError extends ConnectorError {
  constructor(message: string) {
    super(ConnectorErrorCode.VersionMismatch, message, { retryable: false });
  }
}

/** A payload failed schema validation. Not retryable. */
export class ValidationError extends ConnectorError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(ConnectorErrorCode.Validation, message, { retryable: false, cause: options.cause });
  }
}

/** Retries were exhausted; `cause` is the last underlying error. */
export class RetryExhaustedError extends ConnectorError {
  readonly attempts: number;
  constructor(attempts: number, cause: unknown) {
    super(ConnectorErrorCode.RetryExhausted, `retries exhausted after ${attempts} attempt(s)`, {
      retryable: false,
      cause,
    });
    this.attempts = attempts;
  }
}

/** Whether an arbitrary thrown value should be treated as retryable. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ConnectorError && error.retryable;
}

/**
 * Reconstructs a typed `ConnectorError` from a bridge `{ ok:false, error }`
 * reply. The bridge carries a stable, machine-readable `code`; preserving it
 * (rather than collapsing every reply to `RemoteError`) is what lets the client
 * tell an *availability* failure — engine down, agent not reachable — apart from
 * a definitive `REMOTE` policy error, so only the former feeds the fail-closed
 * fallback. Unknown codes degrade to `RemoteError` (definitive, non-retryable).
 */
export function connectorErrorFromWire(code: string, message: string): ConnectorError {
  switch (code) {
    case ConnectorErrorCode.Unavailable:
      return new EngineUnavailableError(message);
    case ConnectorErrorCode.NotConnected:
      return new NotConnectedError(message);
    case ConnectorErrorCode.Transport:
      return new TransportError(message);
    case ConnectorErrorCode.Timeout:
      // A bridge-side deadline; the original budget is not carried on the wire.
      return new TimeoutError(message, 0);
    case ConnectorErrorCode.Validation:
      return new ValidationError(message);
    case ConnectorErrorCode.VersionMismatch:
      return new VersionMismatchError(message);
    default:
      return new RemoteError(message);
  }
}
