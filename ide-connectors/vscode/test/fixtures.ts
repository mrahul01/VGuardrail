// Wire-format (snake_case) Decision fixtures for MockTransport responders,
// matching the daemon's reply shape validated by the SDK's zod schemas.

export const allowDecision = {
  request_id: 'req-allow-1',
  action: 'allow',
  risk_level: 'low',
  classification: 'internal',
  findings: [],
  suppressions: [],
  reason: 'no findings',
  policy_version: 7,
  elapsed_micros: 180,
  incomplete: false,
};

export const awsKeyFinding = {
  detector_id: 'secret.aws_access_key',
  category: 'secret',
  kind: 'aws_access_key',
  span_start: 12,
  span_end: 32,
  confidence: 0.99,
  severity: 'critical',
  redacted_preview: 'AKIA…REDACTED',
  meta: {},
};

export const piiFinding = {
  detector_id: 'pii.email',
  category: 'pii',
  kind: 'email_address',
  span_start: 40,
  span_end: 61,
  confidence: 0.92,
  severity: 'medium',
  redacted_preview: 'j***@example.com',
  meta: {},
};

export const warnDecision = {
  request_id: 'req-warn-1',
  action: 'warn',
  risk_level: 'medium',
  classification: 'confidential',
  matched_rule_id: 'rule.pii.email',
  severity: 'medium',
  findings: [piiFinding],
  suppressions: [],
  reason: 'email address detected in prompt',
  policy_version: 7,
  elapsed_micros: 240,
  incomplete: false,
};

export const blockDecision = {
  request_id: 'req-block-1',
  action: 'block',
  risk_level: 'critical',
  classification: 'restricted',
  matched_rule_id: 'rule.secret.aws',
  severity: 'critical',
  findings: [awsKeyFinding, piiFinding],
  suppressions: [],
  reason: 'AWS access key detected',
  policy_version: 7,
  elapsed_micros: 310,
  incomplete: false,
};
