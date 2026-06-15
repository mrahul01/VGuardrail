import type { AuditEvent } from "@/types";
import type { AuditEventDetail, AuditRepository } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { mapPage, backendGetOrNull, type RawPage } from "@/lib/api/backend/_map";

export const createBackendAuditRepository = (token?: string): AuditRepository => ({
  list: async (query, filters) =>
    mapPage<AuditEvent>(
      await backendFetch<RawPage<AuditEvent>>(
        `/admin/audit?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
          ...(filters?.type ? { type: filters.type } : {}),
          ...(filters?.from ? { from: filters.from } : {}),
          ...(filters?.to ? { to: filters.to } : {}),
        }).toString()}`,
        { token },
      ),
    ),
  get: (eventId) => backendGetOrNull<AuditEventDetail>(`/admin/audit/${eventId}`, token),
});
