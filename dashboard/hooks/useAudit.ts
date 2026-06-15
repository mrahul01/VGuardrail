"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { Page, AuditFilters } from "@/lib/api";
import type { AuditEvent } from "@/types";

export function useAudit(query: { page: number; perPage: number; search?: string }, filters?: AuditFilters) {
  const repos = useRepositories();
  return useAsyncRepo<Page<AuditEvent>>(
    () => repos.audit.list(query, filters),
    [repos, query.page, query.perPage, query.search, filters?.from, filters?.to, filters?.type]
  );
}

