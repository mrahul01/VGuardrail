// AuditEvent — the redacted, uploadable event envelope. Mirrors
// agent/Sources/VGCore/AuditEvent.swift (including the `make` builder and the
// canonical-JSON encoding used for storage and signing).
//
// Contains only metadata and redacted findings — never the raw prompt or a raw
// secret (privacy invariant). Connectors use this for the events they emit
// themselves (e.g. PromptSubmitted, WarningAccepted) so they are byte-compatible
// with what the agent persists and uploads.

import { z } from 'zod';
import {
  ActionSchema,
  ClassificationSchema,
  EventTypeSchema,
  RiskLevelSchema,
  SourceSchema,
  type Action,
  type Classification,
  type EventType,
  type RiskLevel,
  type Source,
} from './enums.js';
import {
  FindingWireSchema,
  SuppressionWireSchema,
  decodeFinding,
  decodeSuppression,
  encodeFinding,
  encodeSuppression,
  type Decision,
  type Finding,
  type Suppression,
} from './decision.js';
import type { ScanContext } from './scan-request.js';
import { SCHEMA_VERSION, canonicalJSON, compact } from './schema.js';

// ── Domain type ──────────────────────────────────────────────────────────────

/** A redacted, uploadable audit event. */
export interface AuditEvent {
  eventId: string;
  schema: string;
  type: EventType;
  timestampMs: number;
  userId: string;
  deviceId: string;
  source?: Source;
  provider?: string;
  model?: string;
  app?: string;
  decision: Action;
  riskLevel: RiskLevel;
  classification: Classification;
  policyVersion: number;
  matchedRuleId?: string;
  suppressions: Suppression[];
  incomplete: boolean;
  findings: Finding[];
}

// ── Wire schema (snake_case) ─────────────────────────────────────────────────

const u32 = z.number().int().min(0).max(0xffff_ffff);

export const AuditEventWireSchema = z
  .object({
    event_id: z.string(),
    schema: z.literal(SCHEMA_VERSION),
    type: EventTypeSchema,
    timestamp_ms: z.number().int(),
    user_id: z.string(),
    device_id: z.string(),
    source: SourceSchema.nullish(),
    provider: z.string().nullish(),
    model: z.string().nullish(),
    app: z.string().nullish(),
    decision: ActionSchema,
    risk_level: RiskLevelSchema,
    classification: ClassificationSchema,
    policy_version: u32,
    matched_rule_id: z.string().nullish(),
    suppressions: z.array(SuppressionWireSchema).default([]),
    incomplete: z.boolean(),
    findings: z.array(FindingWireSchema).default([]),
    // `severity` is not part of the audit envelope; reject unknown keys.
  })
  .strict();

// ── Codecs ───────────────────────────────────────────────────────────────────

/** Validates and decodes a wire AuditEvent into the domain type. */
export function decodeAuditEvent(raw: unknown): AuditEvent {
  const w = AuditEventWireSchema.parse(raw);
  const event: AuditEvent = {
    eventId: w.event_id,
    schema: w.schema,
    type: w.type,
    timestampMs: w.timestamp_ms,
    userId: w.user_id,
    deviceId: w.device_id,
    decision: w.decision,
    riskLevel: w.risk_level,
    classification: w.classification,
    policyVersion: w.policy_version,
    suppressions: w.suppressions.map(decodeSuppression),
    incomplete: w.incomplete,
    findings: w.findings.map(decodeFinding),
  };
  if (w.source != null) event.source = w.source;
  if (w.provider != null) event.provider = w.provider;
  if (w.model != null) event.model = w.model;
  if (w.app != null) event.app = w.app;
  if (w.matched_rule_id != null) event.matchedRuleId = w.matched_rule_id;
  return event;
}

/** Encodes a domain AuditEvent to the snake_case wire object. */
export function encodeAuditEvent(event: AuditEvent): Record<string, unknown> {
  return compact({
    event_id: event.eventId,
    schema: event.schema,
    type: event.type,
    timestamp_ms: event.timestampMs,
    user_id: event.userId,
    device_id: event.deviceId,
    source: event.source,
    provider: event.provider,
    model: event.model,
    app: event.app,
    decision: event.decision,
    risk_level: event.riskLevel,
    classification: event.classification,
    policy_version: event.policyVersion,
    matched_rule_id: event.matchedRuleId,
    suppressions: event.suppressions.map(encodeSuppression),
    incomplete: event.incomplete,
    findings: event.findings.map(encodeFinding),
  }) as Record<string, unknown>;
}

/**
 * Builds an event of `type` from a request context and an engine decision —
 * the TS analogue of `AuditEvent.make(...)` in the Swift agent.
 */
export function makeAuditEvent(args: {
  type: EventType;
  eventId: string;
  timestampMs: number;
  context: ScanContext;
  deviceId: string;
  decision: Decision;
}): AuditEvent {
  const { context, decision } = args;
  const event: AuditEvent = {
    eventId: args.eventId,
    schema: SCHEMA_VERSION,
    type: args.type,
    timestampMs: args.timestampMs,
    userId: context.user.userId,
    deviceId: args.deviceId,
    decision: decision.action,
    riskLevel: decision.riskLevel,
    classification: decision.classification,
    policyVersion: decision.policyVersion,
    suppressions: decision.suppressions,
    incomplete: decision.incomplete,
    findings: decision.findings,
  };
  if (context.source !== undefined) event.source = context.source;
  if (context.provider !== undefined) event.provider = context.provider;
  if (context.model !== undefined) event.model = context.model;
  if (context.app !== undefined) event.app = context.app;
  if (decision.matchedRuleId !== undefined) event.matchedRuleId = decision.matchedRuleId;
  return event;
}

/**
 * Deterministic JSON for an audit event (recursively sorted keys, slashes
 * unescaped) — byte-compatible with the Swift agent's `canonicalJSON()`, used
 * for local storage and signing.
 */
export function auditEventCanonicalJSON(event: AuditEvent): string {
  return canonicalJSON(encodeAuditEvent(event));
}
