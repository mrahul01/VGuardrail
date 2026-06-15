// Violation — an SDK-side projection, NOT a wire type.
//
// The engine does not emit a standalone "Violation" struct: it returns a
// `Decision` carrying `findings`, an optional `matchedRuleId`, and any
// `suppressions`. `violationsFrom` derives a normalized Violation view that
// connectors can render or forward, so every connector agrees on what "a
// violation" means without re-deriving it. Kept aligned with the engine: a
// violation exists only when a rule fired (non-allow action + matchedRuleId).

import type { Category, Severity } from './enums.js';
import type { Decision, Finding } from './decision.js';

/** A rule that fired on a scan, with the findings that triggered it. */
export interface Violation {
  /** The policy rule that matched. */
  ruleId: string;
  /** Highest severity among the contributing findings (falls back to decision severity). */
  severity?: Severity;
  /** Distinct detector categories that contributed. */
  categories: Category[];
  /** The findings that triggered the rule. */
  findings: Finding[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxSeverity(findings: Finding[]): Severity | undefined {
  let best: Severity | undefined;
  for (const f of findings) {
    if (best === undefined || SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[best]) {
      best = f.severity;
    }
  }
  return best;
}

/**
 * Derives the violations represented by a decision.
 *
 * Returns `[]` for an `allow` decision or one with no `matchedRuleId` (no rule
 * fired). Otherwise returns a single Violation for the matched rule, carrying
 * its findings and a severity (max finding severity, else the decision's own
 * severity). Suppressed rules are, by construction, absent from `matchedRuleId`.
 */
export function violationsFrom(decision: Decision): Violation[] {
  if (decision.action === 'allow' || decision.matchedRuleId === undefined) {
    return [];
  }
  const findings = decision.findings;
  const categories = [...new Set(findings.map((f) => f.category))];
  const severity = maxSeverity(findings) ?? decision.severity;
  const violation: Violation = {
    ruleId: decision.matchedRuleId,
    categories,
    findings,
  };
  if (severity !== undefined) violation.severity = severity;
  return [violation];
}
