// Client configuration with production defaults.

import type { Transport } from '../transport/transport.js';
import type { Logger } from '../util/logger.js';

export interface RetryConfig {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff delay (ms). Default 50. */
  baseDelayMs?: number;
  /** Max single backoff delay (ms). Default 1000. */
  maxDelayMs?: number;
}

export interface ClientOptions {
  /**
   * Transport to the daemon. Defaults to a new `XpcBridgeTransport`. Tests and
   * connectors that manage their own process may inject one (e.g. MockTransport).
   */
  transport?: Transport;
  /**
   * Per-call deadline (ms). Default 2000. The engine SLO is <50ms; the rest is
   * IPC + helper overhead and slack for a cold connection.
   */
  timeoutMs?: number;
  /** Connection retry tuning. */
  retry?: RetryConfig;
  /** Logger for lifecycle + error codes. Never receives payloads. Default no-op. */
  logger?: Logger;
}

/** Resolved retry config. */
export interface ResolvedRetry {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_TIMEOUT_MS = 2000;

export const DEFAULT_RETRY: ResolvedRetry = {
  maxAttempts: 3,
  baseDelayMs: 50,
  maxDelayMs: 1000,
};

export function resolveRetry(config: RetryConfig | undefined): ResolvedRetry {
  return {
    maxAttempts: config?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
    baseDelayMs: config?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
    maxDelayMs: config?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
  };
}
