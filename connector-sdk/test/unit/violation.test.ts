import { describe, expect, it } from 'vitest';
import { violationsFrom } from '../../src/models/violation.js';
import type { Decision, Finding } from '../../src/models/decision.js';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    detectorId: 'd',
    category: 'secret',
    kind: 'aws',
    spanStart: 0,
    spanEnd: 1,
    confidence: 1,
    severity: 'low',
    redactedPreview: '…',
    meta: {},
    ...over,
  };
}

function decision(over: Partial<Decision> = {}): Decision {
  return {
    requestId: 'r',
    action: 'block',
    riskLevel: 'high',
    classification: 'restricted',
    findings: [],
    suppressions: [],
    reason: '',
    policyVersion: 1,
    elapsedMicros: 0,
    incomplete: false,
    ...over,
  };
}

describe('violationsFrom', () => {
  it('returns [] for an allow decision', () => {
    expect(violationsFrom(decision({ action: 'allow', matchedRuleId: 'rule.x' }))).toEqual([]);
  });

  it('returns [] when no rule matched', () => {
    expect(violationsFrom(decision({ action: 'warn' }))).toEqual([]);
  });

  it('derives one violation carrying the triggering findings', () => {
    const v = violationsFrom(
      decision({
        action: 'block',
        matchedRuleId: 'rule.secret',
        findings: [finding({ category: 'secret', severity: 'high' }), finding({ category: 'pii', severity: 'medium' })],
      }),
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.ruleId).toBe('rule.secret');
    expect(v[0]!.categories).toEqual(['secret', 'pii']);
    expect(v[0]!.findings).toHaveLength(2);
  });

  it('severity is the max finding severity', () => {
    const v = violationsFrom(
      decision({
        matchedRuleId: 'rule.x',
        findings: [finding({ severity: 'low' }), finding({ severity: 'critical' }), finding({ severity: 'medium' })],
      }),
    );
    expect(v[0]!.severity).toBe('critical');
  });

  it('falls back to the decision severity when there are no findings', () => {
    const v = violationsFrom(decision({ matchedRuleId: 'rule.x', severity: 'high', findings: [] }));
    expect(v[0]!.severity).toBe('high');
  });
});
