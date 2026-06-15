import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, withRetry } from '../../src/resilience/retry.js';
import {
  NotConnectedError,
  RemoteError,
  RetryExhaustedError,
  TransportError,
  ValidationError,
} from '../../src/resilience/errors.js';

const noSleep = () => Promise.resolve();

describe('backoffDelay (full jitter)', () => {
  it('stays within [0, min(base*2^n, max))', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cap = Math.min(50 * 2 ** attempt, 1000);
      for (const r of [0, 0.5, 0.999]) {
        const d = backoffDelay(attempt, 50, 1000, () => r);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(Math.max(cap, 1));
      }
    }
  });

  it('caps the exponential growth at maxDelayMs', () => {
    expect(backoffDelay(20, 50, 1000, () => 0.999)).toBeLessThan(1000);
  });
});

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const op = vi.fn(async () => 'ok');
    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error then succeeds', async () => {
    let n = 0;
    const op = vi.fn(async () => {
      if (n++ < 2) throw new TransportError('flaky');
      return 'recovered';
    });
    const result = await withRetry(op, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, random: () => 0 });
    expect(result).toBe('recovered');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('honors the attempt cap and wraps the last error in RetryExhaustedError', async () => {
    const op = vi.fn(async () => {
      throw new TransportError('still down');
    });
    await expect(
      withRetry(op, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('rethrows a non-retryable error immediately without retrying', async () => {
    const op = vi.fn(async () => {
      throw new ValidationError('bad payload');
    });
    await expect(
      withRetry(op, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('respects a custom isRetryable predicate (write ops: NotConnected only)', async () => {
    const writeRetryable = (e: unknown) => e instanceof NotConnectedError;

    const transportOp = vi.fn(async () => {
      throw new TransportError('mid-send');
    });
    await expect(
      withRetry(transportOp, { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, isRetryable: writeRetryable }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(transportOp).toHaveBeenCalledTimes(1); // not retried

    let n = 0;
    const reconnectOp = vi.fn(async () => {
      if (n++ === 0) throw new NotConnectedError();
      return 'ok';
    });
    await expect(
      withRetry(reconnectOp, { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, isRetryable: writeRetryable }),
    ).resolves.toBe('ok');
    expect(reconnectOp).toHaveBeenCalledTimes(2);
  });

  it('fires onRetry before each backoff sleep', async () => {
    const onRetry = vi.fn();
    let n = 0;
    const op = async () => {
      if (n++ < 1) throw new TransportError('x');
      return 'ok';
    };
    await withRetry(op, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1 });
  });

  it('does not retry a non-retryable RemoteError', async () => {
    const op = vi.fn(async () => {
      throw new RemoteError('engine said no');
    });
    await expect(
      withRetry(op, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RemoteError);
    expect(op).toHaveBeenCalledTimes(1);
  });
});
