// Decision contract — a structural mirror of the connector-sdk's domain
// `Decision` (the host forwards exactly that JSON). Kept local so the browser
// bundle never imports the Node SDK. Source of truth:
// connector-sdk/src/models/decision.ts.

export type Action = 'allow' | 'warn' | 'block';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Category = 'secret' | 'pii' | 'source_code' | 'classification';

/** A single detection — carries only a redacted preview, never a raw secret. */
export interface Finding {
  detectorId: string;
  category: Category;
  kind: string;
  severity: Severity;
  redactedPreview: string;
}

export interface Decision {
  requestId: string;
  action: Action;
  riskLevel: RiskLevel;
  /** Aggregate risk score in [0, 100]; drives the Send-Anyway gate when present. */
  riskScore?: number;
  /** Strongest single-finding confidence as a percentage in [0, 100]. */
  confidence?: number;
  matchedRuleId?: string;
  severity?: Severity;
  findings: Finding[];
  reason: string;
}

/**
 * Risk-score bands for the WARN "Send anyway" affordance (0–100 risk score):
 *
 *   score >  55   → hard block, the "Send anyway" button is hidden.
 *   20 < score ≤ 55 → "Send anyway" shown with a MEDIUM warning.
 *   score ≤ 20    → "Send anyway" shown with a LOW warning.
 *
 * Gating is on the risk score only — confidence is how *sure* a detector is,
 * not how *risky* the content is, and real detections are nearly always high
 * confidence, so using it would block even low-risk prompts.
 */
export const SEND_ANYWAY_THRESHOLD = 55;
export const WARN_MEDIUM_FLOOR = 20;

/** How a WARN decision is enforced locally, derived from its risk level. */
export type WarnTier = 'block' | 'prompt' | 'notice';

/**
 * Maps a WARN decision's risk level to its local enforcement tier.
 * High/critical warns are escalated to a hard block with no proceed
 * affordance — the server-side warn plus a client-side gate is defense in
 * depth, and the no-override UX is a product requirement. Missing/unknown
 * levels take the safe middle: the interactive prompt.
 */
export function warnTier(riskLevel: string | undefined): WarnTier {
  switch (riskLevel) {
    case 'critical':
    case 'high':
      return 'block';
    case 'low':
      return 'notice';
    default:
      return 'prompt';
  }
}

/** A synthetic, fail-closed BLOCK used whenever a real decision can't be obtained. */
export function failClosedBlock(reason: string): Decision {
  return {
    requestId: `local-${Date.now()}`,
    action: 'block',
    riskLevel: 'high',
    findings: [],
    reason,
  };
}
