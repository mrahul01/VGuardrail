// Decision + Finding + Suppression. Mirrors agent/Sources/VGCore/Decision.swift.
//
// A Finding carries only a redacted preview — never a raw secret (the engine
// redacts; every layer must preserve that invariant). This SDK never logs
// `redactedPreview` or finding spans.

import { z } from 'zod';
import {
  ActionSchema,
  CategorySchema,
  ClassificationSchema,
  RiskLevelSchema,
  SeveritySchema,
  type Action,
  type Category,
  type Classification,
  type RiskLevel,
  type Severity,
} from './enums.js';
import { compact } from './schema.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** A single detection. */
export interface Finding {
  detectorId: string;
  category: Category;
  kind: string;
  spanStart: number;
  spanEnd: number;
  confidence: number;
  severity: Severity;
  redactedPreview: string;
  meta: Record<string, string>;
}

/** An exception that suppressed a would-have-fired rule. */
export interface Suppression {
  ruleId: string;
  exceptionId: string;
}

/** The engine's decision for a scan. */
export interface Decision {
  requestId: string;
  action: Action;
  riskLevel: RiskLevel;
  classification: Classification;
  /** Primary policy category driving the decision (highest-severity finding). */
  category?: Category;
  matchedRuleId?: string;
  severity?: Severity;
  findings: Finding[];
  suppressions: Suppression[];
  reason: string;
  policyVersion: number;
  elapsedMicros: number;
  incomplete: boolean;
}

// ── Wire schemas (snake_case) ────────────────────────────────────────────────

const u32 = z.number().int().min(0).max(0xffff_ffff);

export const FindingWireSchema = z
  .object({
    detector_id: z.string(),
    category: CategorySchema,
    kind: z.string(),
    span_start: z.number().int(),
    span_end: z.number().int(),
    confidence: z.number(),
    severity: SeveritySchema,
    redacted_preview: z.string(),
    meta: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export const SuppressionWireSchema = z
  .object({
    rule_id: z.string(),
    exception_id: z.string(),
  })
  .strict();

export const DecisionWireSchema = z
  .object({
    request_id: z.string(),
    action: ActionSchema,
    risk_level: RiskLevelSchema,
    classification: ClassificationSchema,
    category: CategorySchema.nullish(),
    matched_rule_id: z.string().nullish(),
    severity: SeveritySchema.nullish(),
    findings: z.array(FindingWireSchema).default([]),
    suppressions: z.array(SuppressionWireSchema).default([]),
    reason: z.string().default(''),
    policy_version: u32.default(0),
    elapsed_micros: u32.default(0),
    incomplete: z.boolean().default(false),
  })
  .strict();

// ── Codecs ───────────────────────────────────────────────────────────────────

/** Decodes a validated wire Finding into the domain type. */
export function decodeFinding(w: z.infer<typeof FindingWireSchema>): Finding {
  return {
    detectorId: w.detector_id,
    category: w.category,
    kind: w.kind,
    spanStart: w.span_start,
    spanEnd: w.span_end,
    confidence: w.confidence,
    severity: w.severity,
    redactedPreview: w.redacted_preview,
    meta: w.meta,
  };
}

/** Decodes a validated wire Suppression into the domain type. */
export function decodeSuppression(w: z.infer<typeof SuppressionWireSchema>): Suppression {
  return { ruleId: w.rule_id, exceptionId: w.exception_id };
}

/** Validates and decodes a wire Decision into the domain type. */
export function decodeDecision(raw: unknown): Decision {
  const w = DecisionWireSchema.parse(raw);
  const decision: Decision = {
    requestId: w.request_id,
    action: w.action,
    riskLevel: w.risk_level,
    classification: w.classification,
    findings: w.findings.map(decodeFinding),
    suppressions: w.suppressions.map(decodeSuppression),
    reason: w.reason,
    policyVersion: w.policy_version,
    elapsedMicros: w.elapsed_micros,
    incomplete: w.incomplete,
  };
  if (w.category != null) decision.category = w.category;
  if (w.matched_rule_id != null) decision.matchedRuleId = w.matched_rule_id;
  if (w.severity != null) decision.severity = w.severity;
  return decision;
}

/** Encodes a domain Finding to the snake_case wire object. */
export function encodeFinding(f: Finding): unknown {
  return {
    detector_id: f.detectorId,
    category: f.category,
    kind: f.kind,
    span_start: f.spanStart,
    span_end: f.spanEnd,
    confidence: f.confidence,
    severity: f.severity,
    redacted_preview: f.redactedPreview,
    meta: f.meta,
  };
}

/** Encodes a domain Suppression to the snake_case wire object. */
export function encodeSuppression(s: Suppression): unknown {
  return { rule_id: s.ruleId, exception_id: s.exceptionId };
}

/** Encodes a domain Decision to the snake_case wire object. */
export function encodeDecision(decision: Decision): unknown {
  return compact({
    request_id: decision.requestId,
    action: decision.action,
    risk_level: decision.riskLevel,
    classification: decision.classification,
    category: decision.category,
    matched_rule_id: decision.matchedRuleId,
    severity: decision.severity,
    findings: decision.findings.map(encodeFinding),
    suppressions: decision.suppressions.map(encodeSuppression),
    reason: decision.reason,
    policy_version: decision.policyVersion,
    elapsed_micros: decision.elapsedMicros,
    incomplete: decision.incomplete,
  });
}
