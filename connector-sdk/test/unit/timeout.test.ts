import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/resilience/timeout.js';
import { TimeoutError } from '../../src/resilience/errors.js';

describe('withTimeout', () => {
  it('resolves when the op completes before the deadline', async () => {
    await expect(withTimeout(async () => 'fast', 1000, 'op')).resolves.toBe('fast');
  });

  it('rejects with TimeoutError when the deadline elapses', async () => {
    vi.useFakeTimers();
    try {
      const promise = withTimeout(() => new Promise<never>(() => {}), 50, 'submitScan');
      const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the op signal on timeout', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const promise = withTimeout(
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
        25,
        'op',
      );
      const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a reply that arrives after the timeout fired', async () => {
    vi.useFakeTimers();
    try {
      let resolveLate: (v: string) => void = () => {};
      const op = () => new Promise<string>((resolve) => { resolveLate = resolve; });
      const promise = withTimeout(op, 30, 'op');
      const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
      // Late resolution must not change the already-rejected outcome.
      resolveLate('too late');
      await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disables the deadline when timeoutMs <= 0', async () => {
    await expect(withTimeout(async () => 'no-deadline', 0, 'op')).resolves.toBe('no-deadline');
  });
});
