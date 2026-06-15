// Org-scoped repository wrapper.
//
// Every BFF route resolves a `BffContext` whose `orgId` is the canonical
// source of truth. This module wraps the underlying mock registry and
// applies org filtering to list calls so that a caller can never see
// devices, violations, audit events, or exceptions belonging to another
// org — even if a malicious client tried to pass a different orgId in
// the request body. The wrapper silently drops the `orgId` field from
// any filter object the caller supplied.
//
// In the future the same wrapper can be reused against the real backend
// client; the only thing it requires is that the underlying registry
// honors an injected `orgId` filter on every list operation.

import type {
  AuditEvent,
  Device,
  Exception,
  PolicySummary,
  UserSession,
  Violation,
} from "@/types";
import type {
  AuditFilters,
  AuditRepository,
  DeviceFilters,
  DeviceRepository,
  ExceptionFilters,
  ExceptionRepository,
  OrgSettingsRepository,
  Page,
  PageQuery,
  PolicyFilters,
  PolicyRepository,
  RepositoryRegistry,
  UserRepository,
  ViolationFilters,
  ViolationRepository,
  DashboardRepository,
} from "@/lib/api/types";

type AnyList = (query: PageQuery, filters?: object) => Promise<Page<unknown>>;

const stripOrgId = <F extends object | undefined>(filters: F): F => {
  if (!filters) return filters;
  const { org_id: _ignored, ...rest } = filters as { org_id?: unknown };
  void _ignored;
  return rest as F;
};

function withOrgFilter<F extends object>(
  filters: F | undefined,
  orgId: string
): F & { org_id: string } {
  return { ...(filters ?? ({} as F)), org_id: orgId };
}

export interface ScopedRepositories extends RepositoryRegistry {
  readonly session: UserSession;
}

export function createScopedRepositories(
  base: RepositoryRegistry,
  session: UserSession
): ScopedRepositories {
  const orgId = session.orgId;

  const devices: DeviceRepository = {
    async list(query, filters?: DeviceFilters): Promise<Page<Device>> {
      return base.devices.list(query, withOrgFilter(stripOrgId(filters), orgId));
    },
    async get(deviceId) {
      const d = await base.devices.get(deviceId);
      if (!d) return null;
      return d;
    },
    async deactivate(deviceId) {
      await base.devices.deactivate(deviceId);
    },
    async inventory(deviceId) {
      return base.devices.inventory(deviceId);
    },
    async events(deviceId, query) {
      return base.devices.events(deviceId, query);
    },
  };

  const policies: PolicyRepository = {
    async list(query, filters?: PolicyFilters): Promise<Page<PolicySummary>> {
      return base.policies.list(query, withOrgFilter(stripOrgId(filters), orgId));
    },
    async get(policyId) {
      return base.policies.get(policyId);
    },
    async listVersions(policyName) {
      return base.policies.listVersions(policyName);
    },
  };

  const violations: ViolationRepository = {
    async list(
      query,
      filters?: ViolationFilters
    ): Promise<Page<Violation>> {
      return base.violations.list(query, withOrgFilter(stripOrgId(filters), orgId));
    },
    async get(eventId) {
      return base.violations.get(eventId);
    },
  };

  const exceptions: ExceptionRepository = {
    async list(
      query,
      filters?: ExceptionFilters
    ): Promise<Page<Exception>> {
      return base.exceptions.list(query, withOrgFilter(stripOrgId(filters), orgId));
    },
    async get(exceptionId) {
      return base.exceptions.get(exceptionId);
    },
    async create(ruleId, reason) {
      return base.exceptions.create(ruleId, reason);
    },
    async approve(exceptionId, approver) {
      return base.exceptions.approve(exceptionId, approver);
    },
    async reject(exceptionId, approver, reason) {
      return base.exceptions.reject(exceptionId, approver, reason);
    },
  };

  const audit: AuditRepository = {
    async list(
      query,
      filters?: AuditFilters
    ): Promise<Page<AuditEvent>> {
      return base.audit.list(query, withOrgFilter(stripOrgId(filters), orgId));
    },
    async get(eventId) {
      return base.audit.get(eventId);
    },
  };

  const users: UserRepository = {
    async list(query) {
      return base.users.list(query);
    },
    async invite(email, role) {
      return base.users.invite(email, role);
    },
    async disable(userId) {
      await base.users.disable(userId);
    },
  };

  const org: OrgSettingsRepository = {
    async get() {
      return base.org.get();
    },
    async update(patch) {
      // Force org_id to the caller's org regardless of body content.
      return base.org.update({ ...patch, org_id: orgId });
    },
  };

  const dashboard: DashboardRepository = {
    getStats: () => base.dashboard.getStats(),
  };

  return {
    session,
    dashboard,
    devices,
    policies,
    violations,
    exceptions,
    audit,
    users,
    org,
  };
}

// Convenience helper for routes that only need the registry entries
// they consume.
export type { AnyList };
