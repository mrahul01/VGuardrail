"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { Page, ViolationFilters } from "@/lib/api";
import type { Violation } from "@/types";

export function useViolations(query: { page: number; perPage: number; search?: string }, filters?: ViolationFilters) {
  const repos = useRepositories();
  return useAsyncRepo<Page<Violation>>(
    () => repos.violations.list(query, filters),
    [repos, query.page, query.perPage, query.search, filters?.severity, filters?.decision, filters?.source, filters?.from, filters?.to]
  );
}

