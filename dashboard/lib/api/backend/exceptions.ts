import type { Exception } from "@/types";
import type { ExceptionDetail, ExceptionRepository } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { mapPage, backendGetOrNull, type RawPage } from "@/lib/api/backend/_map";

export const createBackendExceptionRepository = (token?: string): ExceptionRepository => ({
  list: async (query, filters) =>
    mapPage<Exception>(
      await backendFetch<RawPage<Exception>>(
        `/admin/exceptions?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.requestedBy ? { requested_by: filters.requestedBy } : {}),
        }).toString()}`,
        { token },
      ),
    ),
  get: (exceptionId) =>
    backendGetOrNull<ExceptionDetail>(`/admin/exceptions/${exceptionId}`, token),
  create: (ruleId, reason) =>
    backendFetch<Exception>(`/admin/exceptions`, {
      method: "POST",
      body: JSON.stringify({ rule_id: ruleId, reason }),
      token,
    }),
  approve: (exceptionId, approver) =>
    backendFetch<ExceptionDetail>(`/admin/exceptions/${exceptionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approver }),
      token,
    }),
  reject: (exceptionId, approver, reason) =>
    backendFetch<ExceptionDetail>(`/admin/exceptions/${exceptionId}/reject`, {
      method: "POST",
      body: JSON.stringify({ approver, reason }),
      token,
    }),
});
