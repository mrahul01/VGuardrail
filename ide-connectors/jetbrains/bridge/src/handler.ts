// Request handling for the one-shot JetBrains bridge. Fail-closed throughout:
// anything that is not a well-formed request, or any scan failure the SDK does
// not already absorb, yields a synthetic BLOCK decision so the plugin never
// lets a prompt through on error.
//
// Input (one JSON line on stdin), camelCase domain shape from the plugin:
//   {"text":"…","context":{"source":"ide","app":"jetbrains",
//     "file":{"path":"/a/b.kt","fileExtension":"kt"},"repo":{"name":"proj"}}}
// or an acknowledge request for a WARN decision:
//   {"acknowledge":{"eventId":"…","accepted":true}}
//
// Output (one JSON line on stdout): the camelCase Decision plus
// `fromFallback` provenance, or {"acknowledged":bool} for acks.

import { randomUUID } from 'node:crypto';
import {
  syntheticDecision,
  type Action,
  type Decision,
  type FileContext,
  type ScanContext,
  type ScanRequest,
  type ScanResponse,
  type Source,
} from '@vguardrail/connector-sdk';
import type { ConnectorIdentity } from './identity.js';

/** The connector-sdk surface the bridge needs (satisfied by ConnectorClient). */
export interface ScanClient {
  safeScan(request: ScanRequest, opts?: { fallbackAction?: Action }): Promise<ScanResponse>;
  acknowledgeWarning(eventId: string, accepted: boolean): Promise<boolean>;
}

/** The decision line printed to stdout. */
export type BridgeDecision = Decision & { fromFallback: boolean };

const SOURCES: ReadonlySet<string> = new Set(['browser', 'ide', 'cli', 'api']);

function failClosed(reason: string): string {
  const decision: BridgeDecision = {
    ...syntheticDecision({ requestId: randomUUID(), action: 'block', reason }),
    fromFallback: true,
  };
  return JSON.stringify(decision);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Defensive normalization of the plugin's request into a domain ScanRequest. */
function normalizeScan(raw: Record<string, unknown>, identity: ConnectorIdentity): ScanRequest | undefined {
  const text = raw.text;
  if (typeof text !== 'string' || text.length === 0) return undefined;

  const rawContext = asRecord(raw.context) ?? {};
  const context: ScanContext = {
    source: 'ide',
    app: 'jetbrains',
    user: { userId: identity.userId, role: identity.role, groups: identity.groups },
  };

  const source = asNonEmptyString(rawContext.source);
  if (source !== undefined && SOURCES.has(source)) context.source = source as Source;
  const app = asNonEmptyString(rawContext.app);
  if (app !== undefined) context.app = app;
  const provider = asNonEmptyString(rawContext.provider);
  if (provider !== undefined) context.provider = provider;
  const model = asNonEmptyString(rawContext.model);
  if (model !== undefined) context.model = model;

  const repo = asRecord(rawContext.repo);
  const repoName = repo !== undefined ? asNonEmptyString(repo.name) : undefined;
  if (repoName !== undefined) context.repo = { name: repoName };

  const file = asRecord(rawContext.file);
  const filePath = file !== undefined ? asNonEmptyString(file.path) : undefined;
  if (file !== undefined && filePath !== undefined) {
    const fileContext: FileContext = { path: filePath };
    // Accept both the domain key and the wire key for the extension.
    const extension = asNonEmptyString(file.fileExtension) ?? asNonEmptyString(file.extension);
    if (extension !== undefined) fileContext.fileExtension = extension;
    context.file = fileContext;
  }

  return { text, context };
}

interface AckRequest {
  eventId: string;
  accepted: boolean;
}

function normalizeAck(raw: Record<string, unknown>): AckRequest | undefined {
  const ack = asRecord(raw.acknowledge);
  if (ack === undefined) return undefined;
  const eventId = asNonEmptyString(ack.eventId);
  if (eventId === undefined || typeof ack.accepted !== 'boolean') return undefined;
  return { eventId, accepted: ack.accepted };
}

/**
 * Handles one request line and returns the reply line (without newline).
 * Never throws: every failure path returns a fail-closed BLOCK decision
 * (scans) or `{"acknowledged":false}` (acks).
 */
export async function handleLine(
  line: string,
  client: ScanClient,
  identity: ConnectorIdentity,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return failClosed('malformed bridge request: not valid JSON; fail-closed block');
  }
  const raw = asRecord(parsed);
  if (raw === undefined) {
    return failClosed('malformed bridge request: expected a JSON object; fail-closed block');
  }

  if (raw.acknowledge !== undefined) {
    const ack = normalizeAck(raw);
    if (ack === undefined) return JSON.stringify({ acknowledged: false });
    try {
      const acknowledged = await client.acknowledgeWarning(ack.eventId, ack.accepted);
      return JSON.stringify({ acknowledged });
    } catch {
      // Ack is audit bookkeeping; a failure must not affect enforcement.
      return JSON.stringify({ acknowledged: false });
    }
  }

  const scan = normalizeScan(raw, identity);
  if (scan === undefined) {
    return failClosed('malformed bridge request: missing prompt text; fail-closed block');
  }

  try {
    // safeScan already fails closed on availability errors; the catch covers
    // the remaining (validation/version/remote) cases so the plugin is never
    // silently allowed through on any error.
    const res = await client.safeScan(scan, { fallbackAction: 'block' });
    const decision: BridgeDecision = { ...res.decision, fromFallback: res.fromFallback };
    return JSON.stringify(decision);
  } catch {
    return failClosed('connector error; fail-closed block');
  }
}
