"use client";

import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";

export function useDashboard() {
  const repos = useRepositories();
  return useAsyncRepo((signal) => {
    void signal;
    return repos.dashboard.getStats();
  }, [repos]);
}

