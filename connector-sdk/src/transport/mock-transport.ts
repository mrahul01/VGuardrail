// In-memory Transport for tests — zero native deps, no subprocess, no daemon.
// Drives the full ConnectorClient (retry, timeout, version negotiation, codecs)
// against programmable responders.

import { SCHEMA_VERSION } from '../models/schema.js';
import { Method } from '../protocol/methods.js';
import { PROTOCOL_VERSION } from '../protocol/envelope.js';
import { NotConnectedError, RemoteError } from '../resilience/errors.js';
import type { Transport } from './transport.js';

/** Context handed to a mock responder. */
export interface MockCallContext {
  params: unknown;
  /** 0-based number of prior calls to this method (for fail-then-succeed). */
  attempt: number;
  /** Aborts when the client's deadline elapses. */
  signal: AbortSignal;
}

/** A programmable reply: returns the `result` payload, or throws to simulate an error. */
export type MockResponder = (ctx: MockCallContext) => unknown | Promise<unknown>;

export class MockTransport implements Transport {
  connected = false;
  /** Every request seen, in order — for assertions. */
  readonly calls: Array<{ method: string; params: unknown }> = [];

  private readonly responders = new Map<string, MockResponder>();
  private readonly attempts = new Map<string, number>();

  constructor() {
    // Default hello so `client.connect()` negotiates successfully unless a test
    // overrides it (e.g. to force a VersionMismatchError).
    this.on(Method.Hello, () => ({
      proto: PROTOCOL_VERSION,
      schema: SCHEMA_VERSION,
      agent: 'mock-agent/0.0.0',
    }));
  }

  /** Registers a responder for `method`. Chainable. */
  on(method: string, responder: MockResponder): this {
    this.responders.set(method, responder);
    return this;
  }

  /** Convenience: always return `value` for `method`. */
  respondWith(method: string, value: unknown): this {
    return this.on(method, () => value);
  }

  /**
   * Convenience: throw `error` for the first `failCount` attempts, then return
   * `value`. Models a flaky connection for retry tests.
   */
  failTimesThenReturn(method: string, failCount: number, error: Error, value: unknown): this {
    return this.on(method, ({ attempt }) => {
      if (attempt < failCount) throw error;
      return value;
    });
  }

  /** Convenience: never resolve (until aborted) — models a hung daemon. */
  hang(method: string): this {
    return this.on(method, ({ signal }) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    );
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (!this.connected) throw new NotConnectedError();
    this.calls.push({ method, params });
    const attempt = this.attempts.get(method) ?? 0;
    this.attempts.set(method, attempt + 1);

    const responder = this.responders.get(method);
    if (responder === undefined) {
      throw new RemoteError(`no mock responder for "${method}"`);
    }
    return await responder({ params, attempt, signal });
  }
}
