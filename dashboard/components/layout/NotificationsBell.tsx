"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Dropdown, type DropdownItem } from "@/components/ui/Dropdown";
import { useDeviceNames } from "@/hooks/useDeviceNames";
import { categoryLabel, type Violation } from "@/types";

const POLL_INTERVAL_MS = 60_000;
const MAX_ITEMS = 5;

/**
 * The slice of GET /api/dashboard/stats this component consumes. The BFF
 * currently emits the camelCase `DashboardRepository.getStats()` shape;
 * the snake_case `DashboardStats` wire names are accepted too so the bell
 * keeps working if the route is ever aligned with `types/index.ts`.
 */
interface StatsSlice {
  readonly total_violations_24h?: number;
  readonly totalViolations24h?: number;
  readonly recent_violations?: readonly Violation[];
  readonly recentViolations?: readonly Violation[];
}

/**
 * Topbar notifications bell. Polls the dashboard stats every 60s and shows
 * the 24h violation count as a badge; clicking opens a dropdown of the most
 * recent violations.
 */
export function NotificationsBell(): JSX.Element {
  const router = useRouter();
  const deviceNames = useDeviceNames();
  const [count, setCount] = useState<number>(0);
  const [recent, setRecent] = useState<readonly Violation[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = (): void => {
      fetch("/api/dashboard/stats", { credentials: "same-origin" })
        .then((res) =>
          res.ok ? (res.json() as Promise<StatsSlice>) : null
        )
        .then((stats) => {
          if (cancelled || !stats) return;
          setCount(stats.total_violations_24h ?? stats.totalViolations24h ?? 0);
          setRecent(stats.recent_violations ?? stats.recentViolations ?? []);
        })
        .catch(() => {
          // Keep the previous values — the bell degrades silently.
        });
    };

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const items: readonly DropdownItem[] = useMemo(() => {
    if (recent.length === 0) {
      return [
        {
          label: "No violations in the last 24h",
          onClick: () => undefined,
          disabled: true,
        },
      ];
    }
    const violationItems: DropdownItem[] = recent
      .slice(0, MAX_ITEMS)
      .map((v) => ({
        label: `${v.decision.toUpperCase()} · ${categoryLabel(v.category)} · ${
          deviceNames[v.device_id] ?? v.device_id
        }`,
        onClick: () => router.push("/violations"),
      }));
    return [
      ...violationItems,
      { label: "", onClick: () => undefined, divider: true },
      {
        label: "View all violations",
        onClick: () => router.push("/violations"),
      },
    ];
  }, [recent, deviceNames, router]);

  return (
    <Dropdown
      align="right"
      items={items}
      trigger={
        <button
          type="button"
          className="relative p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          aria-label={
            count > 0
              ? `Notifications: ${count} violations in the last 24 hours`
              : "Notifications"
          }
        >
          <Bell className="h-6 w-6" aria-hidden="true" />
          {count > 0 && (
            <span
              className="absolute top-0.5 right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
              aria-hidden="true"
            >
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      }
    />
  );
}
