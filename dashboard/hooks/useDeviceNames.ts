"use client";

// Resolves device_id → hostname for event/violation tables, so rows show the
// device's human name (linked to its detail page) instead of a bare id.

import { useEffect, useState } from "react";
import { useRepositories } from "@/hooks/useRepositories";

export function useDeviceNames(): Record<string, string> {
  const repos = useRepositories();
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    repos.devices
      .list({ page: 1, perPage: 100 })
      .then((page) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const d of page.items) {
          if (d.hostname) map[d.device_id] = d.hostname;
        }
        setNames(map);
      })
      .catch(() => {
        // Leave the map empty — tables fall back to raw device ids.
      });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  return names;
}
