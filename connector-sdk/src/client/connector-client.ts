// ConnectorClient — the single typed entry point every connector uses. Wraps a
// Transport with version negotiation, per-call timeouts, connection retry,
// schema validation, and a structured error taxonomy.
//
// Enforcement posture (see the security review's fail-open finding): the client
// never silently decides Allow/Block. `scan` throws on failure so the caller
// decides; `safeScan` offers an explicit, configurable fallback that defaults
// to fail-closed (`block`).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { decodeDecision } from '../models/decision.js';
import { encodeScanRequest, type ScanRequest } from '../models/scan-request.js';
import {
  makeScanResponse,
  syntheticDecision,
  type ScanResponse,
} from '../models/scan-response.js';
import {
  decodeAgentStatus,
  decodeDecisionSummaries,
  type AgentStatus,
  type DecisionSummary,
} from '../models/agent-status.js';
import type { Action } from '../models/enums.js';

import { Method } from '../protocol/methods.js';
import { helloParams, negotiate, type NegotiatedVersion } from '../protocol/version.js';

import { withRetry } from '../resilience/retry.js';
import { withTimeout } from '../resilience/timeout.js';
import {
  ConnectorError,
  ConnectorErrorCode,
  NotConnectedError,
  TimeoutError,
  ValidationError,
} from '../resilience/errors.js';

import { XpcBridgeTransport } from '../transport/xpc-bridge-transport.js';
import type { Transport } from '../transport/transport.js';

import {
  DEFAULT_TIMEOUT_MS,
  resolveRetry,
  type ClientOptions,
  type ResolvedRetry,
} from './options.js';
import { noopLogger, type Logger } from '../util/logger.js';

/** How a given call classifies retryable errors. */
type RetryClass = 'read' | 'write';

export class ConnectorClient {
  private readonly transport: Transport;
  private readonly timeoutMs: number;
  private readonly retry: ResolvedRetry;
  private readonly logger: Logger;

  private negotiated: NegotiatedVersion | undefined;
  private connecting: Promise<NegotiatedVersion> | undefined;

  constructor(options: ClientOptions = {}) {
    this.transport = options.transport ?? new XpcBridgeTransport({ logger: options.logger });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = resolveRetry(options.retry);
    this.logger = options.logger ?? noopLogger;
  }

  /** The negotiated agreement, once `connect()` has completed. */
  get version(): NegotiatedVersion | undefined {
    return this.negotiated;
  }

  /**
   * Connects the transport and performs the `hello` version handshake. Idempotent
   * and concurrency-safe: overlapping callers share one in-flight handshake.
   */
  async connect(): Promise<NegotiatedVersion> {
    if (this.negotiated !== undefined) return this.negotiated;
    if (this.connecting !== undefined) return this.connecting;

    this.connecting = (async () => {
      await this.transport.connect();
      // The handshake is a read-style call: safe to retry on transport flakiness.
      const result = await this.invoke(Method.Hello, helloParams(), 'read');
      const negotiated = negotiate(result);
      this.negotiated = negotiated;
      this.logger.info('connected', { proto: negotiated.proto, agent: negotiated.agent });
      return negotiated;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  /** Tears down the transport. The client may be reconnected afterwards. */
  async close(): Promise<void> {
    this.negotiated = undefined;
    await this.transport.close();
  }

  /**
   * Submits a prompt for evaluation. Throws a `ConnectorError` on any failure —
   * the caller owns the Allow/Block decision when the engine is unreachable.
   *
   * Retry posture: a submit may cause the daemon to enqueue an audit event, so
   * only clearly pre-send failures (`NotConnected`) are auto-retried; a
   * post-send `TimeoutError` is surfaced, not retried (avoids duplicate events).
   * A client-generated `requestId` correlates the call across logs/retries.
   */
  async scan(request: ScanRequest): Promise<ScanResponse> {
    await this.ensureConnected();
    const requestId = randomUUID();
    const params = encodeScanRequest(request);

    const startedAt = Date.now();
    const result = await this.invoke(Method.SubmitScan, params, 'write');
    const elapsedMs = Date.now() - startedAt;

    const decision = this.decode('Decision', () => decodeDecision(result));
    this.logger.debug('scan complete', {
      requestId,
      action: decision.action,
      riskLevel: decision.riskLevel,
      elapsedMs,
    });
    return makeScanResponse(decision, { requestId, elapsedMs });
  }

  /**
   * Like `scan`, but maps an availability failure (transport/timeout/not-connected/
   * retries-exhausted) to a synthetic decision with a configurable fallback
   * action, defaulting to fail-closed `block`. Programmer/protocol errors
   * (validation, version mismatch, explicit remote errors) still throw.
   */
  async safeScan(
    request: ScanRequest,
    opts: { fallbackAction?: Action } = {},
  ): Promise<ScanResponse> {
    const fallbackAction = opts.fallbackAction ?? 'block';
    try {
      return await this.scan(request);
    } catch (error) {
      if (!isAvailabilityError(error)) throw error;
      const requestId = randomUUID();
      const decision = syntheticDecision({
        requestId,
        action: fallbackAction,
        reason: unavailableReason(error as ConnectorError, fallbackAction),
      });
      this.logger.warn('safeScan fallback', {
        requestId,
        fallbackAction,
        code: (error as ConnectorError).code,
      });
      return makeScanResponse(decision, { requestId, elapsedMs: 0, fromFallback: true });
    }
  }

  /** Current agent + engine health. */
  async status(): Promise<AgentStatus> {
    await this.ensureConnected();
    const result = await this.invoke(Method.GetStatus, {}, 'read');
    return this.decode('AgentStatus', () => decodeAgentStatus(result));
  }

  /** Records a user's response to a WARN decision. Returns the daemon's ack. */
  async acknowledgeWarning(eventId: string, accepted: boolean): Promise<boolean> {
    await this.ensureConnected();
    const result = await this.invoke(
      Method.AcknowledgeWarning,
      { eventID: eventId, accepted },
      'write',
    );
    return this.decode('boolean', () => z.boolean().parse(result));
  }

  /** Recent decisions for display. */
  async recentDecisions(limit: number): Promise<DecisionSummary[]> {
    await this.ensureConnected();
    const result = await this.invoke(Method.RecentDecisions, { limit }, 'read');
    return this.decode('DecisionSummary[]', () => decodeDecisionSummaries(result));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.negotiated === undefined) await this.connect();
  }

  /** One method call wrapped in retry + per-attempt timeout. Returns raw result. */
  private invoke(method: string, params: unknown, retryClass: RetryClass): Promise<unknown> {
    return withRetry(
      () =>
        withTimeout(
          (signal) => this.transport.request(method, params, signal),
          this.timeoutMs,
          method,
        ),
      {
        maxAttempts: this.retry.maxAttempts,
        baseDelayMs: this.retry.baseDelayMs,
        maxDelayMs: this.retry.maxDelayMs,
        isRetryable: retryClass === 'read' ? undefined : isWriteRetryable,
        onRetry: ({ attempt, delayMs, error }) =>
          this.logger.warn('retrying', {
            method,
            attempt,
            delayMs,
            code: error instanceof ConnectorError ? error.code : 'unknown',
          }),
      },
    );
  }

  /** Runs a decoder, normalizing any thrown error into a `ValidationError`. */
  private decode<T>(what: string, run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ValidationError(`failed to decode ${what} from agent reply`, { cause: error });
    }
  }
}

/** Write ops retry only on clearly pre-send failures, to avoid duplicate effects. */
function isWriteRetryable(error: unknown): boolean {
  return error instanceof NotConnectedError;
}

/** Whether an error reflects unavailability (eligible for a safeScan fallback). */
function isAvailabilityError(error: unknown): boolean {
  if (error instanceof TimeoutError || error instanceof NotConnectedError) return true;
  if (error instanceof ConnectorError) {
    return (
      error.code === ConnectorErrorCode.Transport ||
      error.code === ConnectorErrorCode.RetryExhausted ||
      error.code === ConnectorErrorCode.Unavailable
    );
  }
  return false;
}

/** A human-readable, payload-free reason for a fail-closed fallback decision. */
function unavailableReason(error: ConnectorError, fallbackAction: Action): string {
  const cause =
    error.code === ConnectorErrorCode.Unavailable
      ? 'policy engine unavailable'
      : `connector unavailable (${error.code})`;
  return `${cause}; fail-closed "${fallbackAction}" applied`;
}
