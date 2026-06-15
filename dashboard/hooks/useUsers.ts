"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { Page, UserSummary } from "@/lib/api";

export function useUsers(query: { page: number; perPage: number; search?: string }) {
  const repos = useRepositories();
  return useAsyncRepo<Page<UserSummary>>(
    () => repos.users.list(query),
    [repos, query.page, query.perPage, query.search]
  );
}

