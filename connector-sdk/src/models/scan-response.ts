// ScanResponse — the SDK-level envelope returned from `client.scan()`.
//
// The daemon returns a bare `Decision` over XPC; the SDK wraps it so connectors
// get a stable response object carrying transport metadata (round-trip latency,
// the client-correlated request id, the schema version, and whether the result
// came from a fail-closed fallback rather than the engine).

import { SCHEMA_VERSION } from './schema.js';
import type { Action, Classification, RiskLevel } from './enums.js';
import type { Decision } from './decision.js';

/** Stable response object surfaced to connectors. */
export interface ScanResponse {
  /** The engine's verdict (or a synthetic fallback when `fromFallback`). */
  decision: Decision;
  /** Client-generated id correlating this request across logs and retries. */
  requestId: string;
  /** SDK-measured round-trip latency in milliseconds. */
  elapsedMs: number;
  /** Model schema version the decision was validated against. */
  schemaVersion: string;
  /** True when produced by `safeScan`'s fail-closed fallback, not the engine. */
  fromFallback: boolean;
}

/** Wraps an engine decision into a ScanResponse. */
export function makeScanResponse(
  decision: Decision,
  meta: { requestId: string; elapsedMs: number; fromFallback?: boolean },
): ScanResponse {
  return {
    decision,
    requestId: meta.requestId,
    elapsedMs: meta.elapsedMs,
    schemaVersion: SCHEMA_VERSION,
    fromFallback: meta.fromFallback ?? false,
  };
}

/**
 * Builds a synthetic decision used as a fail-closed (or configurable) fallback
 * when the engine is unreachable. Carries no findings and a clear reason so the
 * audit trail distinguishes it from a real engine verdict.
 */
export function syntheticDecision(args: {
  requestId: string;
  action: Action;
  reason: string;
  riskLevel?: RiskLevel;
  classification?: Classification;
}): Decision {
  return {
    requestId: args.requestId,
    action: args.action,
    riskLevel: args.riskLevel ?? 'high',
    classification: args.classification ?? 'internal',
    findings: [],
    suppressions: [],
    reason: args.reason,
    policyVersion: 0,
    elapsedMicros: 0,
    incomplete: true,
  };
}
