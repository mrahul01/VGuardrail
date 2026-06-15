"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/Card";
import { Table, type ColumnDef } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useRepositories } from "@/hooks/useRepositories";
import { useSession } from "@/hooks/useSession";
import { canPerformAction } from "@/lib/auth/rbac";
import { formatRelativeTime, formatDateTime } from "@/lib/utils/format";
import type { Device, DeviceStatus, ChainStatus } from "@/types";
import type { Page } from "@/lib/api";

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "deactivated", label: "Deactivated" },
];

const CHAIN_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All chain states" },
  { value: "verified", label: "Verified" },
  { value: "incomplete", label: "Incomplete" },
  { value: "broken", label: "Broken" },
  { value: "unknown", label: "Unknown" },
];

const statusBadgeVariant: Record<
  DeviceStatus,
  "success" | "default" | "error"
> = {
  active: "success",
  inactive: "default",
  deactivated: "error",
};

const chainBadgeVariant: Record<ChainStatus, "success" | "warning" | "error" | "default"> = {
  verified: "success",
  incomplete: "warning",
  broken: "error",
  unknown: "default",
};

export default function DevicesPage(): JSX.Element {
  const repos = useRepositories();
  const { role } = useSession();
  const canDeactivate = canPerformAction(role, "deactivate:device");

  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(10);
  // Seed the search box from ?search= so the global Topbar search can deep-link
  // into this page (read lazily — no useSearchParams Suspense requirement).
  const [search, setSearch] = useState<string>(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("search") ?? ""
  );
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [chainFilter, setChainFilter] = useState<string>("");

  const [data, setData] = useState<Page<Device> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.devices
      .list(
        { page, perPage, search },
        {
          ...(statusFilter ? { status: statusFilter as DeviceStatus } : {}),
          ...(chainFilter ? { chainStatus: chainFilter as ChainStatus } : {}),
        }
      )
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repos, page, perPage, search, statusFilter, chainFilter]);

  const columns: ColumnDef<Device>[] = useMemo(
    () => [
      {
        key: "device",
        header: "Device",
        accessor: (d) => (
          <Link href={`/devices/${encodeURIComponent(d.device_id)}`} className="block group">
            <p className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-vg-primary-600 group-hover:underline">
              {d.hostname || d.device_id}
            </p>
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {d.device_id}
            </p>
          </Link>
        ),
        sortable: true,
      },
      {
        key: "user",
        header: "User",
        accessor: (d) => (
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {d.last_user ?? "—"}
          </span>
        ),
      },
      {
        key: "platform",
        header: "Platform",
        accessor: (d) => d.platform,
      },
      {
        key: "hardware",
        header: "Hardware / OS",
        accessor: (d) =>
          d.model || d.os_version ? (
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {d.model ?? "—"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {d.os_version ?? ""}
              </p>
            </div>
          ) : (
            <span className="text-sm text-gray-500 dark:text-gray-400">—</span>
          ),
      },
      {
        key: "ip",
        header: "IP",
        accessor: (d) => (
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
            {d.ip_address ?? "—"}
          </span>
        ),
      },
      {
        key: "agent",
        header: "Agent",
        accessor: (d) => (
          <span className="text-sm text-gray-700 dark:text-gray-300">
            v{d.agent_version}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        accessor: (d) => (
          <Badge
            variant={statusBadgeVariant[d.status]}
            size="sm"
            dot
          >
            {d.status}
          </Badge>
        ),
      },
      {
        key: "chain",
        header: "Chain",
        accessor: (d) => (
          <Badge variant={chainBadgeVariant[d.chain_status]} size="sm">
            {d.chain_status}
          </Badge>
        ),
      },
      {
        key: "events",
        header: "Events 24h",
        accessor: (d) => (
          <span className="text-sm">{d.event_count_24h}</span>
        ),
        className: "text-right",
      },
      {
        key: "violations",
        header: "Violations 24h",
        accessor: (d) => (
          <span className="text-sm">{d.violation_count_24h}</span>
        ),
        className: "text-right",
      },
      {
        key: "last_seen",
        header: "Last Seen",
        accessor: (d) => (
          <span title={formatDateTime(d.last_seen_ms)}>
            {formatRelativeTime(d.last_seen_ms)}
          </span>
        ),
        sortable: true,
      },
      {
        key: "actions",
        header: "",
        className: "text-right",
        accessor: (d) => (
          <div className="flex items-center justify-end gap-2">
            <Link href={`/devices/${encodeURIComponent(d.device_id)}`}>
              <Button variant="outline" size="sm">
                View
              </Button>
            </Link>
            {canDeactivate && d.status !== "deactivated" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void repos.devices.deactivate(d.device_id);
                }}
              >
                Deactivate
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos, canDeactivate]
  );

  return (
    <DashboardLayout>
      <PageHeader
        title="Devices"
        description="All enrolled devices, their connectors, and integrity status."
      />

      <Card padding="md" className="mb-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1 min-w-0">
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search by hostname, device ID, or platform"
            />
          </div>
          <div className="w-full md:w-48">
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
              aria-label="Filter by device status"
            />
          </div>
          <div className="w-full md:w-48">
            <Select
              value={chainFilter}
              onChange={(e) => {
                setChainFilter(e.target.value);
                setPage(1);
              }}
              options={CHAIN_OPTIONS}
              aria-label="Filter by chain status"
            />
          </div>
        </div>
      </Card>

      <Card padding="none">
        {loading || !data ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No devices match your filters"
            description="Try adjusting the search or status filters."
            variant="no-results"
          />
        ) : (
          <Table
            columns={columns}
            data={data.items}
            keyExtractor={(d) => d.device_id}
            hoverable
          />
        )}
        {data && data.items.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <Pagination
              page={data.page}
              perPage={data.perPage}
              total={data.total}
              onPageChange={setPage}
              onPerPageChange={(n) => {
                setPerPage(n);
                setPage(1);
              }}
            />
          </div>
        )}
      </Card>
    </DashboardLayout>
  );
}
