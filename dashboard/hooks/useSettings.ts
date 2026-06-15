"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { OrgSettings } from "@/lib/api";

export function useSettings() {
  const repos = useRepositories();
  const state = useAsyncRepo<OrgSettings>(() => repos.org.get(), [repos]);
  return {
    ...state,
    save: (patch: Partial<OrgSettings>) => repos.org.update(patch),
  };
}

