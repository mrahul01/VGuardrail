// Client → BFF repository registry.
//
// Dashboard PAGES run in the browser and must NOT talk to the Rust backend
// directly (no internal DNS, no ID token in the browser). Instead they call
// the same-origin BFF routes under `/api/*`, which are cookie-authenticated by
// middleware and proxied to the backend (with the ID token) by `with-rbac.ts`.
//
// This module implements the `RepositoryRegistry` contract by fetching those
// `/api/*` routes, so `useRepositories()` can hand pages a real, live registry
// with no mock data.

import { mapPage, type RawPage } from "@/lib/api/backend/_map";
import type {
  AuditEvent,
  Device,
  Exception,
  PolicySummary,
  Violation,
} from "@/types";
import type { Role } from "@/types/auth";
import type {
  AuditEventDetail,
  DeviceDetail,
  ExceptionDetail,
  OrgSettings,
  PolicyDetail,
  RepositoryRegistry,
  UserSummary,
  ViolationDetail,
} from "@/lib/api/types";

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = body?.error?.code ?? "request_failed";
    const message = body?.error?.message ?? res.statusText;
    throw new Error(`BFF ${path} → ${res.status} ${code}: ${message}`);
  }
  return body as T;
}

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return sp.toString();
}

export function createBffRepositoryRegistry(): RepositoryRegistry {
  return {
    dashboard: {
      getStats: () => bff("/api/dashboard/stats"),
    },
    devices: {
      list: async (query, filters) =>
        mapPage<Device>(
          await bff<RawPage<Device>>(
            `/api/devices?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
              sort_by: query.sortBy,
              sort_dir: query.sortDir,
              status: filters?.status,
              chain_status: filters?.chainStatus,
            })}`,
          ),
        ),
      get: (id) => bff<DeviceDetail | null>(`/api/devices/${id}`),
      deactivate: async (id) => {
        await bff(`/api/devices/${id}`, { method: "DELETE" });
      },
      inventory: (id) =>
        bff<import("@/types").DeviceInventory>(
          `/api/devices/${encodeURIComponent(id)}/inventory`,
        ),
      events: async (id, query) =>
        mapPage<import("@/types").DeviceEvent>(
          await bff<RawPage<import("@/types").DeviceEvent>>(
            `/api/devices/${encodeURIComponent(id)}/events?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
            })}`,
          ),
        ),
    },
    policies: {
      list: async (query, filters) =>
        mapPage<PolicySummary>(
          await bff<RawPage<PolicySummary>>(
            `/api/policies?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
              sort_by: query.sortBy,
              sort_dir: query.sortDir,
              status: filters?.status,
            })}`,
          ),
        ),
      get: (id) => bff<PolicyDetail | null>(`/api/policies/${id}`),
      listVersions: async (policyName) => {
        try {
          const raw = await bff<RawPage<PolicySummary>>(
            `/api/policies/${encodeURIComponent(policyName)}/versions`,
          );
          return mapPage<PolicySummary>(raw).items;
        } catch {
          return [];
        }
      },
    },
    violations: {
      list: async (query, filters) =>
        mapPage<Violation>(
          await bff<RawPage<Violation>>(
            `/api/violations?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
              severity: filters?.severity,
              decision: filters?.decision,
              source: filters?.source,
              category: filters?.category,
              from: filters?.from,
              to: filters?.to,
            })}`,
          ),
        ),
      get: (id) => bff<ViolationDetail | null>(`/api/violations/${id}`),
    },
    exceptions: {
      list: async (query, filters) =>
        mapPage<Exception>(
          await bff<RawPage<Exception>>(
            `/api/exceptions?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
              status: filters?.status,
              requested_by: filters?.requestedBy,
            })}`,
          ),
        ),
      get: (id) => bff<ExceptionDetail | null>(`/api/exceptions/${id}`),
      create: (ruleId, reason) =>
        bff<Exception>(`/api/exceptions`, {
          method: "POST",
          body: JSON.stringify({ rule_id: ruleId, reason }),
        }),
      approve: (id, approver) =>
        bff<ExceptionDetail>(`/api/exceptions/${id}`, {
          method: "POST",
          body: JSON.stringify({ action: "approve", approver }),
        }),
      reject: (id, approver, reason) =>
        bff<ExceptionDetail>(`/api/exceptions/${id}`, {
          method: "POST",
          body: JSON.stringify({ action: "reject", approver, reason }),
        }),
    },
    audit: {
      list: async (query, filters) =>
        mapPage<AuditEvent>(
          await bff<RawPage<AuditEvent>>(
            `/api/audit?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
              type: filters?.type,
              from: filters?.from,
              to: filters?.to,
            })}`,
          ),
        ),
      get: (id) => bff<AuditEventDetail | null>(`/api/audit/${id}`),
    },
    users: {
      list: async (query) =>
        mapPage<UserSummary>(
          await bff<RawPage<UserSummary>>(
            `/api/users?${qs({
              page: String(query.page),
              per_page: String(query.perPage),
              search: query.search,
            })}`,
          ),
        ),
      invite: (email, role: Role) =>
        bff<UserSummary>(`/api/users`, {
          method: "POST",
          body: JSON.stringify({ email, role }),
        }),
      disable: async (id) => {
        await bff(`/api/users/${id}`, { method: "DELETE" });
      },
    },
    org: {
      get: () => bff<OrgSettings>("/api/settings"),
      update: (patch) =>
        bff<OrgSettings>("/api/settings", {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
    },
  };
}
