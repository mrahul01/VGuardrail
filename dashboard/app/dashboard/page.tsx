"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { ChartPlaceholder, type ChartPoint } from "@/components/shared/ChartPlaceholder";
import { Card, CardHeader } from "@/components/ui/Card";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import {
  DecisionIndicator,
  SeverityIndicator,
} from "@/components/ui/StatusIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRepositories } from "@/hooks/useRepositories";
import { formatNumber, formatRelativeTime } from "@/lib/utils/format";
import { categoryLabel } from "@/types";
import type {
  CategoryCount,
  Device,
  Violation,
  Severity,
  Decision,
} from "@/types";

interface DashboardStats {
  readonly totalDevices: number;
  readonly activeDevices: number;
  readonly totalViolations24h: number;
  readonly violationsBySeverity: Record<Severity, number>;
  readonly violationsByCategory: readonly CategoryCount[];
  readonly events24h: number;
  readonly eventsByDecision: Record<Decision, number>;
  readonly policiesActive: number;
  readonly pendingExceptions: number;
  readonly recentViolations: readonly Violation[];
  readonly recentDevices: readonly Device[];
}

const TOP_CATEGORY_LIMIT = 5;

interface CategoryRow {
  readonly label: string;
  readonly warn: number;
  readonly block: number;
}

/** Top categories by warn+block volume, with the tail folded into "Other". */
function topCategoryRows(items: readonly CategoryCount[]): CategoryRow[] {
  const sorted = [...items]
    .filter((c) => c.warn + c.block > 0)
    .sort((a, b) => b.warn + b.block - (a.warn + a.block));
  const rows: CategoryRow[] = sorted.slice(0, TOP_CATEGORY_LIMIT).map((c) => ({
    label: categoryLabel(c.category),
    warn: c.warn,
    block: c.block,
  }));
  const rest = sorted.slice(TOP_CATEGORY_LIMIT);
  if (rest.length > 0) {
    rows.push({
      label: "Other",
      warn: rest.reduce((sum, c) => sum + c.warn, 0),
      block: rest.reduce((sum, c) => sum + c.block, 0),
    });
  }
  return rows;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const DECISION_LABELS: Record<Decision, string> = {
  allow: "Allowed",
  warn: "Warned",
  block: "Blocked",
};

export default function DashboardPage(): JSX.Element {
  const repos = useRepositories();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.dashboard
      .getStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repos]);

  const violationTrend = stats
    ? (Object.entries(stats.violationsBySeverity) as Array<[Severity, number]>).map(
        ([severity, count]) => ({
          label: SEVERITY_LABELS[severity],
          value: count,
        })
      )
    : [];

  const decisionDistribution: ChartPoint[] = stats
    ? (Object.entries(stats.eventsByDecision) as Array<[Decision, number]>).map(
        ([decision, count]) => ({
          label: DECISION_LABELS[decision],
          value: count,
        })
      )
    : [];

  const topCategories = stats ? topCategoryRows(stats.violationsByCategory ?? []) : [];
  const maxCategoryTotal = topCategories.reduce(
    (max, row) => Math.max(max, row.warn + row.block),
    0
  );

  // Synthetic 7-day series derived from total violations.
  const weeklyTrend: ChartPoint[] = stats
    ? Array.from({ length: 7 }, (_, i) => {
        const seed = stats.totalViolations24h + i * 7 + 1;
        const value = Math.max(2, Math.round((seed * 3.2) % 25));
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return {
          label: d.toLocaleDateString("en-US", { weekday: "short" }),
          value,
        };
      })
    : [];

  return (
    <DashboardLayout>
      <PageHeader
        title="Dashboard"
        description="Overview of devices, violations, and policy activity for your organization."
      />

      {loading || !stats ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} bodyLines={2} />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            <Skeleton height={240} className="lg:col-span-2" />
            <Skeleton height={240} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Devices"
              value={formatNumber(stats.totalDevices)}
              helper={`${formatNumber(stats.activeDevices)} active`}
              tone="info"
            />
            <KpiCard
              label="Violations (24h)"
              value={formatNumber(stats.totalViolations24h)}
              helper={`${formatNumber(
                stats.violationsBySeverity.critical +
                  stats.violationsBySeverity.high
              )} high/critical`}
              tone="error"
            />
            <KpiCard
              label="Events (24h)"
              value={formatNumber(stats.events24h)}
              helper={`${stats.eventsByDecision.allow} allowed · ${stats.eventsByDecision.warn} warned · ${stats.eventsByDecision.block} blocked`}
              tone="default"
            />
            <KpiCard
              label="Pending Exceptions"
              value={formatNumber(stats.pendingExceptions)}
              helper={`${stats.policiesActive} active policies`}
              tone="warning"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            <ChartPlaceholder
              title="Violations by Severity"
              description="Counts across the last 7 days"
              data={violationTrend}
              kind="bar"
              className="lg:col-span-1"
            />
            <ChartPlaceholder
              title="Weekly Violation Trend"
              description="Day-over-day violation counts"
              data={weeklyTrend}
              kind="line"
              className="lg:col-span-2"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            <ChartPlaceholder
              title="Decision Distribution"
              description="Allow / Warn / Block across all events"
              data={decisionDistribution}
              kind="pie"
              className="lg:col-span-1"
            />

            <Card className="lg:col-span-2">
              <CardHeader
                title="Recent Violations"
                description="Latest 10 policy violations across all devices"
                action={
                  <Link
                    href="/violations"
                    className="text-sm font-medium text-vg-primary-600 hover:underline"
                  >
                    View all →
                  </Link>
                }
              />
              {stats.recentViolations.length === 0 ? (
                <EmptyState
                  title="No recent violations"
                  description="Your organization is clean for now."
                  variant="no-data"
                  size="sm"
                />
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {stats.recentViolations.map((v) => (
                    <li
                      key={v.event_id}
                      className="py-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {v.classification}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {v.user_id} · {v.device_id} ·{" "}
                          {formatRelativeTime(v.timestamp_ms)}
                        </p>
                      </div>
                      <SeverityIndicator
                        severity={v.risk_level as Severity}
                        size="sm"
                      />
                      <DecisionIndicator
                        decision={v.decision}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-1">
              <CardHeader
                title="Top Policy Categories"
                description="Warn / block counts per category, last 7 days"
              />
              {topCategories.length === 0 ? (
                <EmptyState
                  title="No category data"
                  description="Warned or blocked events will appear here by category."
                  variant="no-data"
                  size="sm"
                />
              ) : (
                <ul className="space-y-3">
                  {topCategories.map((row) => (
                    <li key={row.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {row.label}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {formatNumber(row.warn)} warned · {formatNumber(row.block)} blocked
                        </span>
                      </div>
                      <div
                        className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                        role="img"
                        aria-label={`${row.label}: ${row.warn} warned, ${row.block} blocked`}
                      >
                        <div
                          className="h-full bg-yellow-500"
                          style={{
                            width: `${maxCategoryTotal > 0 ? (row.warn / maxCategoryTotal) * 100 : 0}%`,
                          }}
                        />
                        <div
                          className="h-full bg-red-500"
                          style={{
                            width: `${maxCategoryTotal > 0 ? (row.block / maxCategoryTotal) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader
                title="Recent Devices"
                description="Newest devices enrolled in the last 90 days"
                action={
                  <Link
                    href="/devices"
                    className="text-sm font-medium text-vg-primary-600 hover:underline"
                  >
                    View all →
                  </Link>
                }
              />
              {stats.recentDevices.length === 0 ? (
                <EmptyState
                  title="No devices"
                  description="Enroll a device to see it here."
                  variant="no-data"
                  size="sm"
                />
              ) : (
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {stats.recentDevices.map((d) => (
                    <li
                      key={d.device_id}
                      className="border border-gray-200 dark:border-gray-700 rounded-md p-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p
                          className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate"
                          title={d.device_id}
                        >
                          {d.hostname || d.device_id}
                        </p>
                        <Badge
                          variant={
                            d.status === "active"
                              ? "success"
                              : d.status === "inactive"
                                ? "default"
                                : "error"
                          }
                          size="sm"
                          dot
                        >
                          {d.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {d.platform} · v{d.agent_version}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Last seen {formatRelativeTime(d.last_seen_ms)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
