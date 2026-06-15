// Shared API types for the dashboard.
// These are the contract shapes returned by the future BFF routes.
// The mock repository layer implements the same shapes so the UI is backend-agnostic.

import type {
  AuditEvent,
  Decision,
  Device,
  DeviceStatus,
  Exception,
  ExceptionStatus,
  PolicyStatus,
  PolicySummary,
  RiskLevel,
  Severity,
  Source,
  Violation,
} from "@/types";

export type { Decision, RiskLevel, Severity, DeviceStatus, Source };

// ---------------------------------------------------------------------------
// Filter / query types
// ---------------------------------------------------------------------------

export interface PageQuery {
  readonly page: number;
  readonly perPage: number;
  readonly search?: string;
  readonly sortBy?: string;
  readonly sortDir?: "asc" | "desc";
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly nextToken: string | null;
}

export interface DeviceFilters {
  readonly status?: DeviceStatus;
  readonly search?: string;
  readonly chainStatus?: string;
}

export interface ViolationFilters {
  readonly severity?: Severity;
  readonly decision?: Decision;
  readonly source?: Source;
  readonly category?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface PolicyFilters {
  readonly status?: PolicyStatus;
  readonly search?: string;
}

export interface ExceptionFilters {
  readonly status?: ExceptionStatus;
  readonly requestedBy?: string;
}

export interface AuditFilters {
  readonly from?: string;
  readonly to?: string;
  readonly type?: string;
  readonly search?: string;
}

// ---------------------------------------------------------------------------
// Resource DTOs (extended views over the base domain types)
// ---------------------------------------------------------------------------

export interface PolicyDetail extends PolicySummary {
  readonly rules: readonly PolicyRule[];
  readonly notes: string;
  readonly created_by: string;
  readonly superseded_by_version: number | null;
  readonly supersedes_version: number | null;
}

export interface PolicyRule {
  readonly rule_id: string;
  readonly description: string;
  readonly action: Decision;
  readonly conditions: string;
  readonly enabled: boolean;
}

export interface DeviceDetail extends Device {
  readonly hostname_full: string;
  readonly os_version: string;
  readonly ip_address: string;
  readonly last_user: string;
  readonly enrolled_by: string;
}

export interface ViolationDetail extends Violation {
  readonly matched_rule: string | null;
  readonly source_excerpt: string | null;
  readonly model_context: string | null;
  readonly policy_name: string;
  /** Redacted detector findings from the full audit event payload. */
  readonly findings?: readonly import("@/types").ViolationFinding[];
}

export interface ExceptionDetail extends Exception {
  readonly policy_name: string;
  readonly rule_description: string;
  readonly approved_by_email: string | null;
  readonly requested_by_email: string;
  readonly comment_history: readonly ExceptionComment[];
}

export interface ExceptionComment {
  readonly comment_id: string;
  readonly author: string;
  readonly body: string;
  readonly timestamp_ms: number;
}

export interface AuditEventDetail extends AuditEvent {
  readonly ip_address: string;
  readonly user_agent: string;
  readonly payload: string;
  readonly chain_position: number;
}

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly role: import("@/types").Role;
  readonly status: "active" | "invited" | "disabled";
  readonly last_login_ms: number | null;
}

export interface OrgSettings {
  readonly org_id: string;
  readonly org_name: string;
  readonly default_policy_id: string;
  readonly enrollment_mode: "open" | "invite" | "closed";
  readonly data_retention_days: number;
  readonly email_alerts: boolean;
  readonly slack_webhook_url: string | null;
}

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface DashboardRepository {
  getStats(): Promise<{
    totalDevices: number;
    activeDevices: number;
    totalViolations24h: number;
    violationsBySeverity: Record<Severity, number>;
    violationsByCategory: readonly import("@/types").CategoryCount[];
    events24h: number;
    eventsByDecision: Record<Decision, number>;
    policiesActive: number;
    pendingExceptions: number;
    recentViolations: readonly Violation[];
    recentDevices: readonly Device[];
  }>;
}

export interface DeviceRepository {
  list(
    query: PageQuery,
    filters?: DeviceFilters
  ): Promise<Page<Device>>;
  get(deviceId: string): Promise<DeviceDetail | null>;
  deactivate(deviceId: string): Promise<void>;
  /** Latest process/extension snapshot reported by the device agent. */
  inventory(deviceId: string): Promise<import("@/types").DeviceInventory>;
  /** The device's audit-event timeline (prompt scans mapped to this device). */
  events(
    deviceId: string,
    query: PageQuery
  ): Promise<Page<import("@/types").DeviceEvent>>;
}

export interface PolicyRepository {
  list(
    query: PageQuery,
    filters?: PolicyFilters
  ): Promise<Page<PolicySummary>>;
  get(policyId: string): Promise<PolicyDetail | null>;
  listVersions(policyName: string): Promise<readonly PolicySummary[]>;
}

export interface ViolationRepository {
  list(
    query: PageQuery,
    filters?: ViolationFilters
  ): Promise<Page<Violation>>;
  get(eventId: string): Promise<ViolationDetail | null>;
}

export interface ExceptionRepository {
  list(
    query: PageQuery,
    filters?: ExceptionFilters
  ): Promise<Page<Exception>>;
  get(exceptionId: string): Promise<ExceptionDetail | null>;
  create(ruleId: string, reason: string): Promise<Exception>;
  approve(exceptionId: string, approver: string): Promise<ExceptionDetail>;
  reject(exceptionId: string, approver: string, reason: string): Promise<ExceptionDetail>;
}

export interface AuditRepository {
  list(
    query: PageQuery,
    filters?: AuditFilters
  ): Promise<Page<AuditEvent>>;
  get(eventId: string): Promise<AuditEventDetail | null>;
}

export interface UserRepository {
  list(query: PageQuery): Promise<Page<UserSummary>>;
  invite(email: string, role: import("@/types").Role): Promise<UserSummary>;
  disable(userId: string): Promise<void>;
}

export interface OrgSettingsRepository {
  get(): Promise<OrgSettings>;
  update(patch: Partial<OrgSettings>): Promise<OrgSettings>;
}

export interface RepositoryRegistry {
  readonly dashboard: DashboardRepository;
  readonly devices: DeviceRepository;
  readonly policies: PolicyRepository;
  readonly violations: ViolationRepository;
  readonly exceptions: ExceptionRepository;
  readonly audit: AuditRepository;
  readonly users: UserRepository;
  readonly org: OrgSettingsRepository;
}
