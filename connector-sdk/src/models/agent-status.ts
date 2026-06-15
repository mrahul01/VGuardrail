// AgentStatus + DecisionSummary. Mirrors agent/Sources/VGCore/AgentStatus.swift.
//
// NOTE: unlike the other models, these two Swift structs declare NO CodingKeys,
// so their wire keys are the raw Swift property names (camelCase, with
// `requestID`/`matchedRuleID` capitalized). The wire schemas below match that
// exactly; the domain types normalize to `requestId`/`matchedRuleId`.

import { z } from 'zod';
import {
  ActionSchema,
  RiskLevelSchema,
  type Action,
  type RiskLevel,
} from './enums.js';
import { compact } from './schema.js';

// ── Domain types ─────────────────────────────────────────────────────────────

/** A snapshot of agent + engine health for the menu bar UI. */
export interface AgentStatus {
  engineServing: boolean;
  activePolicyVersion: number;
  queuedEvents: number;
  lastUploadOutcome?: string;
  engineConnected: boolean;
  agentVersion: string;
}

/** A compact recent-decision row. */
export interface DecisionSummary {
  requestId: string;
  timestampMs: number;
  action: Action;
  riskLevel: RiskLevel;
  matchedRuleId?: string;
  provider?: string;
  app?: string;
}

// ── Wire schemas (camelCase — raw Swift property names) ───────────────────────

const u32 = z.number().int().min(0).max(0xffff_ffff);

export const AgentStatusWireSchema = z
  .object({
    engineServing: z.boolean(),
    activePolicyVersion: u32,
    queuedEvents: z.number().int().min(0),
    lastUploadOutcome: z.string().nullish(),
    engineConnected: z.boolean(),
    agentVersion: z.string(),
  })
  .strict();

export const DecisionSummaryWireSchema = z
  .object({
    requestID: z.string(),
    timestampMs: z.number().int(),
    action: ActionSchema,
    riskLevel: RiskLevelSchema,
    matchedRuleID: z.string().nullish(),
    provider: z.string().nullish(),
    app: z.string().nullish(),
  })
  .strict();

// ── Codecs ───────────────────────────────────────────────────────────────────

/** Validates and decodes a wire AgentStatus into the domain type. */
export function decodeAgentStatus(raw: unknown): AgentStatus {
  const w = AgentStatusWireSchema.parse(raw);
  const status: AgentStatus = {
    engineServing: w.engineServing,
    activePolicyVersion: w.activePolicyVersion,
    queuedEvents: w.queuedEvents,
    engineConnected: w.engineConnected,
    agentVersion: w.agentVersion,
  };
  if (w.lastUploadOutcome != null) status.lastUploadOutcome = w.lastUploadOutcome;
  return status;
}

/** Encodes a domain AgentStatus to the wire object. */
export function encodeAgentStatus(status: AgentStatus): unknown {
  return compact({
    engineServing: status.engineServing,
    activePolicyVersion: status.activePolicyVersion,
    queuedEvents: status.queuedEvents,
    lastUploadOutcome: status.lastUploadOutcome,
    engineConnected: status.engineConnected,
    agentVersion: status.agentVersion,
  });
}

/** Validates and decodes a wire DecisionSummary into the domain type. */
export function decodeDecisionSummary(raw: unknown): DecisionSummary {
  const w = DecisionSummaryWireSchema.parse(raw);
  const summary: DecisionSummary = {
    requestId: w.requestID,
    timestampMs: w.timestampMs,
    action: w.action,
    riskLevel: w.riskLevel,
  };
  if (w.matchedRuleID != null) summary.matchedRuleId = w.matchedRuleID;
  if (w.provider != null) summary.provider = w.provider;
  if (w.app != null) summary.app = w.app;
  return summary;
}

/** Decodes a JSON array of wire DecisionSummary rows. */
export function decodeDecisionSummaries(raw: unknown): DecisionSummary[] {
  return z.array(z.unknown()).parse(raw).map(decodeDecisionSummary);
}

/** Encodes a domain DecisionSummary to the wire object. */
export function encodeDecisionSummary(summary: DecisionSummary): unknown {
  return compact({
    requestID: summary.requestId,
    timestampMs: summary.timestampMs,
    action: summary.action,
    riskLevel: summary.riskLevel,
    matchedRuleID: summary.matchedRuleId,
    provider: summary.provider,
    app: summary.app,
  });
}
