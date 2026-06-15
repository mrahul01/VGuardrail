"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { ExceptionFilters, Page } from "@/lib/api";
import type { Exception } from "@/types";

export function useExceptions(query: { page: number; perPage: number; search?: string }, filters?: ExceptionFilters) {
  const repos = useRepositories();
  return useAsyncRepo<Page<Exception>>(
    () => repos.exceptions.list(query, filters),
    [repos, query.page, query.perPage, query.search, filters?.status, filters?.requestedBy]
  );
}

