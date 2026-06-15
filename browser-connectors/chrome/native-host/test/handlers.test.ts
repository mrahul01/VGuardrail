import { describe, expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { ConnectorClient, EngineUnavailableError, MockTransport, Method } from '@vguardrail/connector-sdk';
import { handleRequest, type ScanClient } from '../src/handlers.js';
import { runHost } from '../src/host.js';
import { encodeMessage, MessageDecoder } from '../src/framing.js';
import type { ConnectorIdentity } from '../src/identity.js';
import type { HostResponse } from '../src/protocol.js';

const identity: ConnectorIdentity = { userId: 'u-1', role: 'user', groups: [] };

const blockDecisionWire = {
  request_id: 'eng-req-1',
  action: 'block',
  risk_level: 'critical',
  classification: 'restricted',
  matched_rule_id: 'rule.secret.aws',
  reason: 'blocked by rule.secret.aws',
};

const allowDecisionWire = {
  request_id: 'eng-req-2',
  action: 'allow',
  risk_level: 'low',
  classification: 'public',
};

function clientWith(mock: MockTransport): ConnectorClient {
  return new ConnectorClient({ transport: mock });
}

describe('handlers', () => {
  it('scan builds a browser ScanRequest and returns the engine decision', async () => {
    const mock = new MockTransport().respondWith(Method.SubmitScan, blockDecisionWire);
    const client = clientWith(mock);

    const res = await handleRequest(client as unknown as ScanClient, identity, {
      id: '1',
      type: 'scan',
      payload: { text: 'AKIA...secret', context: { provider: 'openai', model: 'gpt-4o', url: 'https://chatgpt.com' } },
    });

    expect(res).toMatchObject({ id: '1', ok: true, type: 'scan' });
    if (res.ok && res.type === 'scan') {
      expect(res.decision.action).toBe('block');
      expect(res.decision.matchedRuleId).toBe('rule.secret.aws');
    }
    // The request the SDK sent carries source:'browser' and the user identity.
    const submit = mock.calls.find((c) => c.method === Method.SubmitScan)!;
    expect((submit.params as any).context.source).toBe('browser');
    expect((submit.params as any).context.provider).toBe('openai');
    expect((submit.params as any).context.user.user_id).toBe('u-1');
  });

  it('scan returns an allow decision unchanged', async () => {
    const mock = new MockTransport().respondWith(Method.SubmitScan, allowDecisionWire);
    const res = await handleRequest(clientWith(mock) as unknown as ScanClient, identity, {
      id: '2',
      type: 'scan',
      payload: { text: 'hello', context: { provider: 'anthropic' } },
    });
    expect(res.ok && res.type === 'scan' && res.decision.action).toBe('allow');
  });

  it('scan fails closed (BLOCK) when the transport is unavailable', async () => {
    const mock = new MockTransport().on(Method.SubmitScan, () => {
      throw new Error('bridge gone');
    });
    const res = await handleRequest(clientWith(mock) as unknown as ScanClient, identity, {
      id: '3',
      type: 'scan',
      payload: { text: 'hello', context: {} },
    });
    expect(res.ok && res.type === 'scan' && res.decision.action).toBe('block');
  });

  it('scan fails closed with a diagnosable reason when the policy engine is down', async () => {
    // Engine-down flows through safeScan's availability fallback, so the block
    // reaches the extension naming the policy engine — not the opaque outer-catch
    // "connector error; fail-closed block".
    const mock = new MockTransport().on(Method.SubmitScan, () => {
      throw new EngineUnavailableError();
    });
    const res = await handleRequest(clientWith(mock) as unknown as ScanClient, identity, {
      id: '3b',
      type: 'scan',
      payload: { text: 'hello', context: { provider: 'openai' } },
    });
    expect(res.ok && res.type === 'scan').toBe(true);
    if (res.ok && res.type === 'scan') {
      expect(res.decision.action).toBe('block');
      expect(res.decision.reason).toContain('policy engine unavailable');
      expect(res.decision.reason).not.toContain('connector error');
    }
  });

  it('ack forwards to acknowledgeWarning', async () => {
    const mock = new MockTransport().respondWith(Method.AcknowledgeWarning, true);
    const res = await handleRequest(clientWith(mock) as unknown as ScanClient, identity, {
      id: '4',
      type: 'ack',
      payload: { eventId: 'eng-req-1', accepted: true },
    });
    expect(res).toMatchObject({ id: '4', ok: true, type: 'ack', accepted: true });
    const ack = mock.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect((ack.params as any)).toEqual({ eventID: 'eng-req-1', accepted: true });
  });
});

// Collects framed output written by the host.
function collector(): { stream: Writable; decode: () => HostResponse[] } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return {
    stream,
    decode: () => new MessageDecoder().push(Buffer.concat(chunks)) as HostResponse[],
  };
}

describe('host loop (end-to-end over streams, MockTransport SDK)', () => {
  it('frames a scan request in and a decision out, then shuts down on EOF', async () => {
    const mock = new MockTransport().respondWith(Method.SubmitScan, blockDecisionWire);
    const client = clientWith(mock);
    const input = new PassThrough();
    const out = collector();

    const done = runHost({ client: client as unknown as ScanClient & { close(): Promise<void> }, identity, input, output: out.stream });

    input.write(encodeMessage({ id: 'h1', type: 'scan', payload: { text: 'x', context: { provider: 'openai' } } }));
    input.end(); // EOF → graceful shutdown
    await done;

    const replies = out.decode();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 'h1', ok: true, type: 'scan' });
    expect((replies[0] as any).decision.action).toBe('block');
  });

  it('replies BAD_REQUEST to a correlatable malformed message', async () => {
    const mock = new MockTransport();
    const client = clientWith(mock);
    const input = new PassThrough();
    const out = collector();
    const done = runHost({ client: client as unknown as ScanClient & { close(): Promise<void> }, identity, input, output: out.stream });

    input.write(encodeMessage({ id: 'bad1', type: 'nope' }));
    input.end();
    await done;

    const replies = out.decode();
    expect(replies[0]).toMatchObject({ id: 'bad1', ok: false });
    expect((replies[0] as any).error.code).toBe('BAD_REQUEST');
  });
});
