import type { UserSummary, UserRepository } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { mapPage, type RawPage } from "@/lib/api/backend/_map";

export const createBackendUserRepository = (token?: string): UserRepository => ({
  list: async (query) =>
    mapPage<UserSummary>(
      await backendFetch<RawPage<UserSummary>>(
        `/admin/users?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
        }).toString()}`,
        { token },
      ),
    ),
  invite: (email, role) =>
    backendFetch<UserSummary>(`/admin/users`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
      token,
    }),
  disable: (userId) =>
    backendFetch(`/admin/users/${userId}`, { method: "DELETE", token }).then(() => undefined),
});
