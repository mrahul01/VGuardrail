import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  encodeScanRequest,
  decodeScanRequest,
  type ScanRequest,
} from '../../src/models/scan-request.js';
import {
  decodeDecision,
  encodeDecision,
  type Decision,
} from '../../src/models/decision.js';
import {
  decodeAgentStatus,
  encodeAgentStatus,
  decodeDecisionSummaries,
} from '../../src/models/agent-status.js';
import {
  makeAuditEvent,
  encodeAuditEvent,
  decodeAuditEvent,
  auditEventCanonicalJSON,
} from '../../src/models/audit-event.js';
import { canonicalJSON, SCHEMA_VERSION } from '../../src/models/schema.js';
import { primaryEventType } from '../../src/models/enums.js';

const sampleRequest: ScanRequest = {
  text: 'paste with AKIA secret',
  context: {
    source: 'ide',
    provider: 'anthropic',
    app: 'cursor',
    repo: { name: 'acme/api', classification: 'confidential' },
    file: { path: 'src/main.rs', fileExtension: 'rs' },
    user: { userId: 'u-1', role: 'security_admin', groups: ['sec'] },
  },
};

describe('ScanRequest codec', () => {
  it('emits snake_case wire keys (user_id, extension) and renames back on decode', () => {
    const wire = encodeScanRequest(sampleRequest) as Record<string, any>;
    expect(wire.context.user).toEqual({ user_id: 'u-1', role: 'security_admin', groups: ['sec'] });
    expect(wire.context.file).toEqual({ path: 'src/main.rs', extension: 'rs' });
    expect(decodeScanRequest(wire)).toEqual(sampleRequest);
  });

  it('omits absent optionals rather than emitting null', () => {
    const minimal: ScanRequest = { text: 'hi', context: { user: { userId: 'u', role: 'user', groups: [] } } };
    const wire = encodeScanRequest(minimal) as Record<string, any>;
    expect('provider' in wire.context).toBe(false);
    expect('repo' in wire.context).toBe(false);
    expect(decodeScanRequest(wire)).toEqual(minimal);
  });

  it('rejects an unknown enum value', () => {
    const bad = { text: 'x', context: { user: { user_id: 'u', role: 'root', groups: [] } } };
    expect(() => decodeScanRequest(bad)).toThrow(z.ZodError);
  });

  it('rejects unknown wire keys (strict)', () => {
    const bad = { text: 'x', context: { user: { user_id: 'u', role: 'user', groups: [] }, bogus: 1 } };
    expect(() => decodeScanRequest(bad)).toThrow(z.ZodError);
  });
});

describe('Decision codec', () => {
  const decision: Decision = {
    requestId: 'r1',
    action: 'block',
    riskLevel: 'critical',
    classification: 'restricted',
    matchedRuleId: 'rule.x',
    severity: 'high',
    findings: [
      {
        detectorId: 'secret.aws_access_key',
        category: 'secret',
        kind: 'aws',
        spanStart: 1,
        spanEnd: 21,
        confidence: 0.9,
        severity: 'high',
        redactedPreview: 'AKIA…',
        meta: { line: '2' },
      },
    ],
    suppressions: [{ ruleId: 'rule.y', exceptionId: 'ex.1' }],
    reason: 'blocked',
    policyVersion: 4,
    elapsedMicros: 999,
    incomplete: false,
  };

  it('round-trips with snake_case field names', () => {
    const wire = encodeDecision(decision) as Record<string, any>;
    expect(wire.request_id).toBe('r1');
    expect(wire.risk_level).toBe('critical');
    expect(wire.matched_rule_id).toBe('rule.x');
    expect(wire.findings[0].span_start).toBe(1);
    expect(wire.findings[0].redacted_preview).toBe('AKIA…');
    expect(decodeDecision(wire)).toEqual(decision);
  });

  it('applies wire defaults for omitted optional collections', () => {
    const minimal = {
      request_id: 'r2',
      action: 'allow',
      risk_level: 'low',
      classification: 'public',
    };
    const decoded = decodeDecision(minimal);
    expect(decoded.findings).toEqual([]);
    expect(decoded.suppressions).toEqual([]);
    expect(decoded.reason).toBe('');
    expect(decoded.policyVersion).toBe(0);
    expect(decoded.matchedRuleId).toBeUndefined();
  });

  it('treats null matched_rule_id/severity as absent', () => {
    const decoded = decodeDecision({
      request_id: 'r3',
      action: 'warn',
      risk_level: 'medium',
      classification: 'internal',
      matched_rule_id: null,
      severity: null,
    });
    expect(decoded.matchedRuleId).toBeUndefined();
    expect(decoded.severity).toBeUndefined();
  });
});

describe('AgentStatus / DecisionSummary codec', () => {
  it('uses camelCase wire keys (no CodingKeys on the Swift structs)', () => {
    const status = {
      engineServing: true,
      activePolicyVersion: 9,
      queuedEvents: 0,
      engineConnected: false,
      agentVersion: '2.0.0',
    };
    const decoded = decodeAgentStatus(status);
    expect(decoded.engineServing).toBe(true);
    expect(decoded.lastUploadOutcome).toBeUndefined();
    expect(encodeAgentStatus(decoded)).toEqual(status);
  });

  it('maps requestID/matchedRuleID wire keys to camelCase domain', () => {
    const rows = decodeDecisionSummaries([
      { requestID: 'a', timestampMs: 1, action: 'block', riskLevel: 'high', matchedRuleID: 'r' },
    ]);
    expect(rows[0]).toMatchObject({ requestId: 'a', matchedRuleId: 'r' });
  });
});

describe('AuditEvent', () => {
  const decision = decodeDecision({
    request_id: 'r1',
    action: 'block',
    risk_level: 'critical',
    classification: 'restricted',
    matched_rule_id: 'rule.x',
    findings: [],
    suppressions: [],
    incomplete: false,
  });

  it('make() projects context + decision into a v1 envelope', () => {
    const event = makeAuditEvent({
      type: primaryEventType('block'),
      eventId: 'e1',
      timestampMs: 123,
      context: sampleRequest.context,
      deviceId: 'd1',
      decision,
    });
    expect(event.type).toBe('PromptBlocked');
    expect(event.schema).toBe(SCHEMA_VERSION);
    expect(event.userId).toBe('u-1');
    expect(event.matchedRuleId).toBe('rule.x');
    // round-trips through the wire schema
    expect(decodeAuditEvent(encodeAuditEvent(event))).toEqual(event);
  });

  it('canonicalJSON is recursively key-sorted and leaves slashes unescaped', () => {
    const json = canonicalJSON({ b: 1, a: { d: 'x/y', c: 2 } });
    expect(json).toBe('{"a":{"c":2,"d":"x/y"},"b":1}');
  });

  it('rejects an envelope with a wrong schema literal', () => {
    const event = makeAuditEvent({
      type: 'PolicyViolation',
      eventId: 'e2',
      timestampMs: 1,
      context: sampleRequest.context,
      deviceId: 'd',
      decision,
    });
    const wire = encodeAuditEvent(event);
    wire.schema = 'vguardrail.event/v2';
    expect(() => decodeAuditEvent(wire)).toThrow(z.ZodError);
  });

  it('auditEventCanonicalJSON yields sorted top-level keys', () => {
    const event = makeAuditEvent({
      type: 'PromptBlocked',
      eventId: 'e3',
      timestampMs: 1,
      context: sampleRequest.context,
      deviceId: 'd',
      decision,
    });
    const json = auditEventCanonicalJSON(event);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([...keys].sort());
  });
});
