"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { Page, PolicyDetail, PolicyFilters, PageQuery } from "@/lib/api";
import type { PolicySummary } from "@/types";

export function usePolicies(query: PageQuery, filters?: PolicyFilters) {
  const repos = useRepositories();
  const list = useAsyncRepo<Page<PolicySummary>>(
    () => repos.policies.list(query, filters),
    [repos, query.page, query.perPage, query.search, filters?.status]
  );
  const get = async (policyId: string): Promise<PolicyDetail | null> =>
    repos.policies.get(policyId);
  return { ...list, get };
}
