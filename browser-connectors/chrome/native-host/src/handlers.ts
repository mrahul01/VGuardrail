// Maps host requests onto the connector-sdk. The scan path is fail-closed: any
// failure (infra or otherwise) yields a BLOCK decision so the extension blocks
// the prompt rather than letting it through.

import { randomUUID } from 'node:crypto';
import {
  syntheticDecision,
  type Action,
  type AgentStatus,
  type Decision,
  type ScanRequest,
} from '@vguardrail/connector-sdk';
import type { ConnectorIdentity } from './identity.js';
import type { HostRequest, HostResponse } from './protocol.js';

/** The connector-sdk surface this host needs (satisfied by ConnectorClient). */
export interface ScanClient {
  safeScan(request: ScanRequest, opts?: { fallbackAction?: Action }): Promise<{ decision: Decision }>;
  acknowledgeWarning(eventId: string, accepted: boolean): Promise<boolean>;
  status(): Promise<AgentStatus>;
}

export async function handleRequest(
  client: ScanClient,
  identity: ConnectorIdentity,
  req: HostRequest,
): Promise<HostResponse> {
  switch (req.type) {
    case 'scan':
      return handleScan(client, identity, req);
    case 'ack':
      return handleAck(client, req);
    case 'status':
      return handleStatus(client, req);
  }
}

async function handleScan(
  client: ScanClient,
  identity: ConnectorIdentity,
  req: Extract<HostRequest, { type: 'scan' }>,
): Promise<HostResponse> {
  const request: ScanRequest = {
    text: req.payload.text,
    context: {
      source: 'browser',
      provider: req.payload.context.provider,
      model: req.payload.context.model,
      app: req.payload.context.app ?? 'chrome',
      user: { userId: identity.userId, role: identity.role, groups: identity.groups },
    },
  };

  try {
    // safeScan already fails closed on availability errors; the catch covers the
    // remaining (validation/version/remote) cases so the user is never silently
    // allowed through on any error.
    const res = await client.safeScan(request, { fallbackAction: 'block' });
    return { id: req.id, ok: true, type: 'scan', decision: res.decision };
  } catch {
    const decision = syntheticDecision({
      requestId: randomUUID(),
      action: 'block',
      reason: 'connector error; fail-closed block',
    });
    return { id: req.id, ok: true, type: 'scan', decision };
  }
}

async function handleAck(
  client: ScanClient,
  req: Extract<HostRequest, { type: 'ack' }>,
): Promise<HostResponse> {
  try {
    const accepted = await client.acknowledgeWarning(req.payload.eventId, req.payload.accepted);
    return { id: req.id, ok: true, type: 'ack', accepted };
  } catch {
    // Ack is audit bookkeeping; a failure must not affect enforcement.
    return { id: req.id, ok: false, error: { code: 'ACK_FAILED', message: 'acknowledge failed' } };
  }
}

async function handleStatus(
  client: ScanClient,
  req: Extract<HostRequest, { type: 'status' }>,
): Promise<HostResponse> {
  try {
    const status = await client.status();
    return { id: req.id, ok: true, type: 'status', status };
  } catch {
    return { id: req.id, ok: false, error: { code: 'STATUS_FAILED', message: 'status unavailable' } };
  }
}
