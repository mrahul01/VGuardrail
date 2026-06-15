import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ConnectorClient } from '../../src/client/connector-client.js';
import { MockTransport } from '../../src/transport/mock-transport.js';
import { Method } from '../../src/protocol/methods.js';
import { violationsFrom } from '../../src/models/violation.js';
import { RemoteError } from '../../src/resilience/errors.js';
import type { ScanRequest } from '../../src/models/scan-request.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

const request: ScanRequest = {
  text: 'here is an AKIA-shaped secret',
  context: {
    source: 'browser',
    provider: 'openai',
    app: 'chatgpt',
    user: { userId: 'u-1', role: 'user', groups: [] },
  },
};

describe('ConnectorClient over MockTransport', () => {
  it('connect() performs the hello handshake and exposes the negotiated version', async () => {
    const transport = new MockTransport();
    const client = new ConnectorClient({ transport });
    const agreed = await client.connect();
    expect(agreed.proto).toBe(1);
    expect(client.version?.agent).toBe('mock-agent/0.0.0');
    expect(transport.calls[0]!.method).toBe(Method.Hello);
  });

  it('scan() decodes a block decision and wraps it in a ScanResponse', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, fixture('decision.block.json'));
    const client = new ConnectorClient({ transport });

    const res = await client.scan(request);

    expect(res.fromFallback).toBe(false);
    expect(res.schemaVersion).toBe('vguardrail.event/v1');
    expect(typeof res.requestId).toBe('string');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(res.decision.action).toBe('block');
    expect(res.decision.matchedRuleId).toBe('rule.secret.aws');
    expect(res.decision.findings[0]!.detectorId).toBe('secret.aws_access_key');

    // sends the wire-encoded request (snake_case user_id) under submitScan
    const submit = transport.calls.find((c) => c.method === Method.SubmitScan)!;
    expect((submit.params as any).context.user.user_id).toBe('u-1');

    // derived violation view
    const violations = violationsFrom(res.decision);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.ruleId).toBe('rule.secret.aws');
  });

  it('scan() handles an allow decision with no violations', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, fixture('decision.allow.json'));
    const client = new ConnectorClient({ transport });
    const res = await client.scan(request);
    expect(res.decision.action).toBe('allow');
    expect(violationsFrom(res.decision)).toEqual([]);
  });

  it('status() decodes the camelCase AgentStatus envelope', async () => {
    const transport = new MockTransport().respondWith(Method.GetStatus, fixture('status.json'));
    const client = new ConnectorClient({ transport });
    const status = await client.status();
    expect(status).toEqual({
      engineServing: true,
      activePolicyVersion: 7,
      queuedEvents: 3,
      lastUploadOutcome: 'success',
      engineConnected: true,
      agentVersion: '1.2.0',
    });
  });

  it('recentDecisions() decodes an array of summaries and passes the limit', async () => {
    const transport = new MockTransport().respondWith(Method.RecentDecisions, fixture('recent.json'));
    const client = new ConnectorClient({ transport });
    const rows = await client.recentDecisions(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ requestId: 'req-block-1', matchedRuleId: 'rule.secret.aws' });
    expect(rows[1]!.matchedRuleId).toBeUndefined();
    const call = transport.calls.find((c) => c.method === Method.RecentDecisions)!;
    expect((call.params as any).limit).toBe(2);
  });

  it('acknowledgeWarning() sends eventID/accepted and returns the boolean ack', async () => {
    const transport = new MockTransport().respondWith(Method.AcknowledgeWarning, true);
    const client = new ConnectorClient({ transport });
    await expect(client.acknowledgeWarning('evt-1', true)).resolves.toBe(true);
    const call = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(call.params).toEqual({ eventID: 'evt-1', accepted: true });
  });

  it('surfaces a malformed reply as a ValidationError', async () => {
    const transport = new MockTransport().respondWith(Method.GetStatus, { engineServing: 'yes' });
    const client = new ConnectorClient({ transport });
    await expect(client.status()).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('maps a daemon ok:false reply to a non-retryable RemoteError', async () => {
    const transport = new MockTransport().on(Method.GetStatus, () => {
      throw new RemoteError('engine unavailable');
    });
    const client = new ConnectorClient({ transport });
    await expect(client.status()).rejects.toMatchObject({ code: 'REMOTE' });
  });
});
