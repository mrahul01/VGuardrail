import type { Violation } from "@/types";
import type { ViolationDetail, ViolationRepository } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { mapPage, backendGetOrNull, type RawPage } from "@/lib/api/backend/_map";

export const createBackendViolationRepository = (token?: string): ViolationRepository => ({
  list: async (query, filters) =>
    mapPage<Violation>(
      await backendFetch<RawPage<Violation>>(
        `/admin/violations?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
          ...(filters?.severity ? { severity: filters.severity } : {}),
          ...(filters?.decision ? { decision: filters.decision } : {}),
          ...(filters?.source ? { source: filters.source } : {}),
          ...(filters?.category ? { category: filters.category } : {}),
          ...(filters?.from ? { from: filters.from } : {}),
          ...(filters?.to ? { to: filters.to } : {}),
        }).toString()}`,
        { token },
      ),
    ),
  // A violation is a blocking audit event; detail is served by /admin/audit/{id}.
  get: (eventId) => backendGetOrNull<ViolationDetail>(`/admin/audit/${eventId}`, token),
});
