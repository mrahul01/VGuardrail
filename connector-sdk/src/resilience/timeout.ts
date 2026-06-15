// Per-call deadline wrapper. Races an operation against a timer; on expiry it
// aborts the operation (so the transport can drop the in-flight correlation id
// and ignore a late reply) and rejects with `TimeoutError`.

import { TimeoutError } from './errors.js';

/**
 * Runs `op` with a deadline. `op` receives an `AbortSignal` that fires when the
 * deadline elapses; well-behaved transports use it to cancel the pending
 * request so a late reply never resolves anything.
 *
 * A non-positive `timeoutMs` disables the deadline.
 */
export async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return op(new AbortController().signal);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject with TimeoutError BEFORE aborting: `controller.abort()` may
      // synchronously reject the op with its own error, and `Promise.race`
      // adopts whichever settles first — the deadline must win.
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
      controller.abort();
    }, timeoutMs);
    // Do not keep the event loop alive solely for this timer.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref();
    }
  });

  try {
    return await Promise.race([op(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
