// Connection retry with exponential backoff + full jitter.
//
// Only retries errors classified retryable (transport / not-connected). A
// non-retryable error (remote decision, validation, version mismatch, a
// post-send timeout) is rethrown immediately — never masked behind retries.
// `random` and `sleep` are injectable so tests are deterministic.

import { RetryExhaustedError, isRetryable as defaultIsRetryable } from './errors.js';

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts: number;
  /** Base delay (ms) for the exponential schedule. */
  baseDelayMs: number;
  /** Upper bound (ms) on any single backoff delay. */
  maxDelayMs: number;
  /** Jitter source in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
  /** Sleeper. Defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Retryability classifier. Defaults to `error.retryable`. */
  isRetryable?: (error: unknown) => boolean;
  /** Observability hook fired before each retry sleep. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  });
}

/**
 * Full-jitter backoff: a uniformly random delay in `[0, cap)` where
 * `cap = min(baseDelayMs * 2^attempt, maxDelayMs)`. `attempt` is 0-based (the
 * index of the attempt that just failed).
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const cap = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.floor(random() * cap);
}

/**
 * Runs `op`, retrying retryable failures per the backoff schedule. `op`
 * receives the 0-based attempt index. Rethrows a non-retryable error as-is;
 * throws `RetryExhaustedError` (wrapping the last error) once attempts run out.
 */
export async function withRetry<T>(
  op: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.maxAttempts);
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? realSleep;
  const retryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op(i);
    } catch (error) {
      lastError = error;
      if (!retryable(error)) throw error;
      if (i === attempts - 1) break;
      const delayMs = backoffDelay(i, options.baseDelayMs, options.maxDelayMs, random);
      options.onRetry?.({ attempt: i + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new RetryExhaustedError(attempts, lastError);
}
