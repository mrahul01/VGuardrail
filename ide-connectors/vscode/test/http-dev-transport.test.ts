// HttpDevTransport — backend /scan mapping, hello negotiation echo, and
// fail-closed error shaping (TransportError so safeScan substitutes a BLOCK).

import { describe, expect, it } from 'vitest';
import { ConnectorClient, TransportError } from '@vguardrail/connector-sdk';
import { HttpDevTransport } from '../src/http-dev-transport';

const BACKEND_DECISION = {
  request_id: 'scan-123',
  action: 'block',
  risk_level: 'critical',
  matched_rule_id: 'dev-local-policy-v1',
  severity: 'high',
  reason: 'Blocked by policy — 1 finding(s), category secret, risk 89 (restricted)',
  findings: [
    {
      detector_id: 'secret.aws_access_key',
      category: 'secret',
      kind: 'aws_access_key',
      severity: 'critical',
      redacted_preview: 'AKIA…MPLE',
    },
  ],
};

function stubFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown },
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { status = 200, body = {} } = handler(String(input), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function client(fetchFn: typeof fetch): ConnectorClient {
  return new ConnectorClient({
    transport: new HttpDevTransport({ baseUrl: 'http://localhost:8080', fetchFn }),
  });
}

describe('HttpDevTransport', () => {
  it('maps a backend block decision into a valid SDK Decision', async () => {
    const seen: { url?: string; body?: Record<string, unknown> } = {};
    const c = client(
      stubFetch((url, init) => {
        if (url.endsWith('/scan')) {
          seen.url = url;
          seen.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return { body: { request_id: 'scan-123', decision: BACKEND_DECISION } };
        }
        return { body: {} };
      }),
    );
    const res = await c.scan({
      text: 'AKIA...',
      context: {
        source: 'ide',
        app: 'vscode',
        user: { userId: 'u1', role: 'user', groups: [] },
      },
    });
    expect(seen.url).toBe('http://localhost:8080/scan');
    expect((seen.body?.context as Record<string, unknown>).app).toBe('vscode');
    expect(res.decision.action).toBe('block');
    expect(res.decision.riskLevel).toBe('critical');
    expect(res.decision.classification).toBe('restricted');
    expect(res.decision.findings[0]?.category).toBe('secret');
    expect(res.decision.findings[0]?.redactedPreview).toBe('AKIA…MPLE');
  });

  it('safeScan fails closed to BLOCK when the backend is unreachable', async () => {
    const c = client((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    const res = await c.safeScan(
      { text: 'x', context: { source: 'ide', app: 'vscode', user: { userId: 'u', role: 'user', groups: [] } } },
      { fallbackAction: 'block' },
    );
    expect(res.fromFallback).toBe(true);
    expect(res.decision.action).toBe('block');
  });

  it('reports backend health through getStatus', async () => {
    const c = client(
      stubFetch((url) =>
        url.endsWith('/health') ? { body: { status: 'healthy', version: '0.1.0' } } : { body: {} },
      ),
    );
    const status = await c.status();
    expect(status.engineServing).toBe(true);
    expect(status.agentVersion).toContain('0.1.0');
  });

  it('rejects unknown methods with TransportError', async () => {
    const transport = new HttpDevTransport({ fetchFn: stubFetch(() => ({ body: {} })) });
    await expect(
      transport.request('bogus', {}, new AbortController().signal),
    ).rejects.toBeInstanceOf(TransportError);
  });
});
