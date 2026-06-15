"use client";

import { useState, useCallback } from "react";
import { useRepositories } from "@/hooks/useRepositories";
import { useAsyncRepo } from "@/hooks/useAsyncRepo";
import type { DeviceFilters, Page, PageQuery } from "@/lib/api";
import type { Device } from "@/types";

export function useDevices(query: PageQuery, filters?: DeviceFilters) {
  const repos = useRepositories();
  const state = useAsyncRepo<Page<Device>>(
    () => repos.devices.list(query, filters),
    [repos, query.page, query.perPage, query.search, filters?.status, filters?.chainStatus]
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const deactivate = useCallback(async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      await repos.devices.deactivate(deviceId);
    } finally {
      setBusyId(null);
    }
  }, [repos]);
  return { ...state, busyId, deactivate };
}

