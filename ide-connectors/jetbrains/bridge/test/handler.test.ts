// Smoke tests: drive the real ConnectorClient over the SDK's MockTransport
// through the bridge's line handler, asserting the stdout contract the
// JetBrains plugin parses.

import { describe, expect, it } from 'vitest';
import { ConnectorClient, Method, MockTransport, TransportError } from '@vguardrail/connector-sdk';

import { handleLine } from '../src/handler.js';
import type { ConnectorIdentity } from '../src/identity.js';

const identity: ConnectorIdentity = { userId: 'u-test', role: 'user', groups: ['eng'] };

const allowDecision = {
  request_id: 'req-allow-1',
  action: 'allow',
  risk_level: 'low',
  classification: 'internal',
  findings: [],
  suppressions: [],
  reason: 'no findings',
  policy_version: 7,
  elapsed_micros: 180,
  incomplete: false,
};

const blockDecision = {
  request_id: 'req-block-1',
  action: 'block',
  risk_level: 'critical',
  classification: 'restricted',
  matched_rule_id: 'rule.secret.aws',
  severity: 'critical',
  findings: [
    {
      detector_id: 'secret.aws_access_key',
      category: 'secret',
      kind: 'aws_access_key',
      span_start: 0,
      span_end: 20,
      confidence: 0.99,
      severity: 'critical',
      redacted_preview: 'AKIA…REDACTED',
      meta: {},
    },
  ],
  suppressions: [],
  reason: 'AWS access key detected',
  policy_version: 7,
  elapsed_micros: 310,
  incomplete: false,
};

const scanLine = JSON.stringify({
  text: 'review this snippet',
  context: {
    source: 'ide',
    app: 'jetbrains',
    file: { path: '/work/proj/src/Main.kt', fileExtension: 'kt' },
    repo: { name: 'proj' },
  },
});

function clientOver(transport: MockTransport): ConnectorClient {
  return new ConnectorClient({ transport });
}

describe('jetbrains bridge handleLine', () => {
  it('returns an allow decision and sends ide/jetbrains context on the wire', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, allowDecision);

    const reply = JSON.parse(await handleLine(scanLine, clientOver(transport), identity)) as {
      action: string;
      fromFallback: boolean;
      requestId: string;
    };

    expect(reply.action).toBe('allow');
    expect(reply.fromFallback).toBe(false);
    expect(reply.requestId).toBe('req-allow-1');

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan)!;
    const params = submit.params as {
      text: string;
      context: {
        source: string;
        app: string;
        repo: { name: string };
        file: { path: string; extension: string };
        user: { user_id: string; role: string; groups: string[] };
      };
    };
    expect(params.text).toBe('review this snippet');
    expect(params.context.source).toBe('ide');
    expect(params.context.app).toBe('jetbrains');
    expect(params.context.repo).toEqual({ name: 'proj' });
    expect(params.context.file).toEqual({ path: '/work/proj/src/Main.kt', extension: 'kt' });
    expect(params.context.user).toEqual({ user_id: 'u-test', role: 'user', groups: ['eng'] });
  });

  it('passes through a block decision with findings', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, blockDecision);

    const reply = JSON.parse(await handleLine(scanLine, clientOver(transport), identity)) as {
      action: string;
      reason: string;
      findings: Array<{ category: string; redactedPreview: string }>;
    };

    expect(reply.action).toBe('block');
    expect(reply.reason).toBe('AWS access key detected');
    expect(reply.findings).toHaveLength(1);
    expect(reply.findings[0]!.category).toBe('secret');
    expect(reply.findings[0]!.redactedPreview).toBe('AKIA…REDACTED');
  });

  it('defaults source/app and fills identity when the plugin sends bare text', async () => {
    const transport = new MockTransport().respondWith(Method.SubmitScan, allowDecision);

    await handleLine(JSON.stringify({ text: 'hi' }), clientOver(transport), identity);

    const submit = transport.calls.find((c) => c.method === Method.SubmitScan)!;
    const params = submit.params as {
      context: { source: string; app: string; user: { user_id: string } };
    };
    expect(params.context.source).toBe('ide');
    expect(params.context.app).toBe('jetbrains');
    expect(params.context.user.user_id).toBe('u-test');
  });

  it('fails closed to BLOCK when the engine is unreachable', async () => {
    const transport = new MockTransport().on(Method.SubmitScan, () => {
      throw new TransportError('xpc bridge died');
    });

    const reply = JSON.parse(await handleLine(scanLine, clientOver(transport), identity)) as {
      action: string;
      fromFallback: boolean;
      reason: string;
    };

    expect(reply.action).toBe('block');
    expect(reply.fromFallback).toBe(true);
    expect(reply.reason).toContain('fail-closed');
  });

  it('fails closed to BLOCK on malformed input', async () => {
    const transport = new MockTransport();
    const client = clientOver(transport);

    for (const line of ['not json at all', '[1,2,3]', JSON.stringify({ context: {} })]) {
      const reply = JSON.parse(await handleLine(line, client, identity)) as {
        action: string;
        fromFallback: boolean;
      };
      expect(reply.action).toBe('block');
      expect(reply.fromFallback).toBe(true);
    }
    expect(transport.calls.filter((c) => c.method === Method.SubmitScan)).toHaveLength(0);
  });

  it('handles warn acknowledgements', async () => {
    const transport = new MockTransport().respondWith(Method.AcknowledgeWarning, true);

    const reply = JSON.parse(
      await handleLine(
        JSON.stringify({ acknowledge: { eventId: 'req-warn-1', accepted: true } }),
        clientOver(transport),
        identity,
      ),
    ) as { acknowledged: boolean };

    expect(reply.acknowledged).toBe(true);
    const ack = transport.calls.find((c) => c.method === Method.AcknowledgeWarning)!;
    expect(ack.params).toEqual({ eventID: 'req-warn-1', accepted: true });
  });

  it('reports acknowledged=false when the ack fails, without throwing', async () => {
    const transport = new MockTransport().on(Method.AcknowledgeWarning, () => {
      throw new TransportError('ack pipe broke');
    });

    const reply = JSON.parse(
      await handleLine(
        JSON.stringify({ acknowledge: { eventId: 'req-warn-1', accepted: false } }),
        clientOver(transport),
        identity,
      ),
    ) as { acknowledged: boolean };

    expect(reply.acknowledged).toBe(false);
  });
});
