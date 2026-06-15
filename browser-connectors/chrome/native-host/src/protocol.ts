// Message contracts between the extension's service worker and this host.
// Requests are `{ id, type, payload }`; replies echo the `id`. Decision and
// AgentStatus are the connector-sdk's own types (no re-modelling).

import type { AgentStatus, Decision } from '@vguardrail/connector-sdk';

/** Origin metadata the content script captures (no identity — the host adds that). */
export interface ScanContextInput {
  provider?: string;
  model?: string;
  app?: string;
  url?: string;
  title?: string;
}

export type HostRequest =
  | { id: string; type: 'scan'; payload: { text: string; context: ScanContextInput } }
  | { id: string; type: 'ack'; payload: { eventId: string; accepted: boolean } }
  | { id: string; type: 'status' };

export type HostResponse =
  | { id: string; ok: true; type: 'scan'; decision: Decision }
  | { id: string; ok: true; type: 'ack'; accepted: boolean }
  | { id: string; ok: true; type: 'status'; status: AgentStatus }
  | { id: string; ok: false; error: { code: string; message: string } };

/** Narrows an arbitrary decoded value to a well-formed request, or returns null. */
export function parseRequest(value: unknown): HostRequest | { id: string | null; invalid: true } {
  if (typeof value !== 'object' || value === null) return { id: null, invalid: true };
  const obj = value as Record<string, unknown>;
  const id = typeof obj.id === 'string' && obj.id.length > 0 ? obj.id : null;
  if (id === null) return { id: null, invalid: true };

  switch (obj.type) {
    case 'scan': {
      const p = obj.payload as Record<string, unknown> | undefined;
      if (!p || typeof p.text !== 'string') return { id, invalid: true };
      const context = (typeof p.context === 'object' && p.context !== null ? p.context : {}) as ScanContextInput;
      return { id, type: 'scan', payload: { text: p.text, context } };
    }
    case 'ack': {
      const p = obj.payload as Record<string, unknown> | undefined;
      if (!p || typeof p.eventId !== 'string' || typeof p.accepted !== 'boolean') {
        return { id, invalid: true };
      }
      return { id, type: 'ack', payload: { eventId: p.eventId, accepted: p.accepted } };
    }
    case 'status':
      return { id, type: 'status' };
    default:
      return { id, invalid: true };
  }
}
