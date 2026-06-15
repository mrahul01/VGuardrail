// Domain enumerations — wire values mirror the Swift agent's VGCore/Enums.swift
// 1:1 (snake_case / PascalCase raw strings), so JSON envelopes stay stable
// across the Rust engine, the Swift agent, this SDK, and the dashboard.
//
// Source of truth: agent/Sources/VGCore/Enums.swift

import { z } from 'zod';

/** Enforcement action returned by the engine. */
export const ActionSchema = z.enum(['allow', 'warn', 'block']);
export type Action = z.infer<typeof ActionSchema>;

/** Aggregate risk level of an evaluated prompt. */
export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** Severity of a rule or finding. */
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/** Data classification of prompt content. */
export const ClassificationSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);
export type Classification = z.infer<typeof ClassificationSchema>;

/**
 * Detector category — the 24 policy categories plus the legacy
 * `classification` derivation category. Wire values are snake_case.
 */
export const CategorySchema = z.enum([
  'secret',
  'pii',
  'source_code',
  'classification',
  'company_confidential',
  'financial',
  'intellectual_property',
  'usage_policy',
  'prompt_injection',
  'sensitive_document',
  'customer_data',
  'compliance',
  'keyword',
  'file_policy',
  'image_policy',
  'ai_classification',
  'destructive_command',
  'legal',
  'medical',
  'hr',
  'security',
  'research_development',
  'communication',
  'procurement',
  'government',
]);
export type Category = z.infer<typeof CategorySchema>;

/** Origin surface of a prompt. */
export const SourceSchema = z.enum(['browser', 'ide', 'cli', 'api']);
export type Source = z.infer<typeof SourceSchema>;

/** RBAC role of the acting user. */
export const RoleSchema = z.enum([
  'super_admin',
  'security_admin',
  'auditor',
  'manager',
  'user',
]);
export type Role = z.infer<typeof RoleSchema>;

/**
 * Audit event types (EVENT_MODEL.md). Raw values are the canonical PascalCase
 * names persisted in envelopes and uploaded to the backend.
 */
export const EventTypeSchema = z.enum([
  'PromptSubmitted',
  'PolicyEvaluated',
  'PromptAllowed',
  'PromptWarned',
  'WarningAccepted',
  'WarningRejected',
  'PromptBlocked',
  'PolicyViolation',
  'UploadSuccess',
  'UploadFailure',
  'AgentStarted',
  'PolicyUpdated',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** The primary event type that corresponds to a decision's action. */
export function primaryEventType(action: Action): EventType {
  switch (action) {
    case 'allow':
      return 'PromptAllowed';
    case 'warn':
      return 'PromptWarned';
    case 'block':
      return 'PromptBlocked';
  }
}
