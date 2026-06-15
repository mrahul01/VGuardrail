import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ConnectorClient } from '../../src/client/connector-client.js';
import { MockTransport } from '../../src/transport/mock-transport.js';
import { Method } from '../../src/protocol/methods.js';
import {
  EngineUnavailableError,
  RemoteError,
  TransportError,
  VersionMismatchError,
} from '../../src/resilience/errors.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

const fastRetry = { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 2 };

const request = {
  text: 'secret',
  context: { user: { userId: 'u', role: 'user' as const, groups: [] as string[] } },
};

describe('resilience', () => {
  it('retries a flaky read op and then resolves', async () => {
    const transport = new MockTransport().failTimesThenReturn(
      Method.GetStatus,
      2,
      new TransportError('connection reset'),
      fixture('status.json'),
    );
    const client = new ConnectorClient({ transport, retry: fastRetry });
    const status = await client.status();
    expect(status.activePolicyVersion).toBe(7);
    const statusCalls = transport.calls.filter((c) => c.method === Method.GetStatus);
    expect(statusCalls).toHaveLength(3); // 2 failures + 1 success
  });

  it('times out a hung call with a TimeoutError (not retried)', async () => {
    const transport = new MockTransport().hang(Method.GetStatus);
    const client = new ConnectorClient({ transport, timeoutMs: 30, retry: fastRetry });
    await expect(client.status()).rejects.toMatchObject({ code: 'TIMEOUT' });
    // a TimeoutError is non-retryable, so exactly one attempt was made
    expect(transport.calls.filter((c) => c.method === Method.GetStatus)).toHaveLength(1);
  });

  it('fails closed on a version mismatch during connect()', async () => {
    const transport = new MockTransport().on(Method.Hello, () => ({
      proto: 99,
      schema: 'vguardrail.event/v1',
      agent: 'future-agent',
    }));
    const client = new ConnectorClient({ transport });
    await expect(client.connect()).rejects.toBeInstanceOf(VersionMismatchError);
  });

  it('safeScan returns a fail-closed block when the engine is unavailable', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new TransportError('bridge gone');
    });
    const client = new ConnectorClient({ transport, retry: fastRetry });

    const res = await client.safeScan(request);

    expect(res.fromFallback).toBe(true);
    expect(res.decision.action).toBe('block');
    expect(res.decision.incomplete).toBe(true);
    expect(res.decision.reason).toContain('TRANSPORT');
  });

  it('safeScan fails closed with a diagnosable reason when the policy engine is down', async () => {
    // Engine-down surfaces as EngineUnavailableError (wire code UNAVAILABLE),
    // distinct from a REMOTE policy error: it must feed the fail-closed fallback
    // and the reason must name the policy engine, not an opaque "connector error".
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new EngineUnavailableError();
    });
    const client = new ConnectorClient({ transport, retry: fastRetry });

    const res = await client.safeScan(request);

    expect(res.fromFallback).toBe(true);
    expect(res.decision.action).toBe('block');
    expect(res.decision.incomplete).toBe(true);
    expect(res.decision.reason).toContain('policy engine unavailable');
  });

  it('safeScan honors a configurable fallback action', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new TransportError('bridge gone');
    });
    const client = new ConnectorClient({ transport, retry: fastRetry });
    const res = await client.safeScan(request, { fallbackAction: 'warn' });
    expect(res.decision.action).toBe('warn');
    expect(res.fromFallback).toBe(true);
  });

  it('safeScan rethrows a definitive remote error (not an availability failure)', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new RemoteError('policy rejected the request');
    });
    const client = new ConnectorClient({ transport, retry: fastRetry });
    await expect(client.safeScan(request)).rejects.toBeInstanceOf(RemoteError);
  });

  it('write ops do not retry a TransportError (avoid duplicate audit events)', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new TransportError('mid-send failure');
    });
    const client = new ConnectorClient({ transport, retry: fastRetry });
    await expect(client.scan(request)).rejects.toBeInstanceOf(TransportError);
    expect(transport.calls.filter((c) => c.method === Method.SubmitScan)).toHaveLength(1);
  });
});
