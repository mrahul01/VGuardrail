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
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { DecisionIndicator } from "@/components/ui/StatusIndicator";
import { useToastHelpers } from "@/components/ui/Toast";
import { useRepositories } from "@/hooks/useRepositories";
import { useDeviceNames } from "@/hooks/useDeviceNames";
import { useSession } from "@/hooks/useSession";
import { canPerformAction } from "@/lib/auth/rbac";
import { downloadCsv, toCsv } from "@/lib/utils/csv";
import {
  bytesToHexPreview,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/utils/format";
import type { AuditEvent, Decision } from "@/types";
import type { Page } from "@/lib/api";

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All event types" },
  { value: "user.login", label: "user.login" },
  { value: "user.logout", label: "user.logout" },
  { value: "device.enrolled", label: "device.enrolled" },
  { value: "device.deactivated", label: "device.deactivated" },
  { value: "policy.published", label: "policy.published" },
  { value: "policy.drafted", label: "policy.drafted" },
  { value: "exception.requested", label: "exception.requested" },
  { value: "exception.approved", label: "exception.approved" },
  { value: "exception.rejected", label: "exception.rejected" },
  { value: "settings.updated", label: "settings.updated" },
  { value: "user.invited", label: "user.invited" },
  { value: "user.disabled", label: "user.disabled" },
  { value: "alert.triggered", label: "alert.triggered" },
];

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

// CSV export: walk the list endpoint at the max page size, capped so a huge
// org can't lock the tab fetching an unbounded result set.
const EXPORT_PAGE_SIZE = 100;
const EXPORT_ROW_CAP = 1000;

const EXPORT_COLUMNS: readonly { key: string; header: string }[] = [
  { key: "event_id", header: "event_id" },
  { key: "type", header: "type" },
  { key: "timestamp", header: "timestamp" },
  { key: "user_id", header: "user_id" },
  { key: "device_id", header: "device_id" },
  { key: "decision", header: "decision" },
  { key: "risk_level", header: "risk_level" },
  { key: "category", header: "category" },
  { key: "reason", header: "reason" },
  { key: "event_hash", header: "event_hash" },
];

export default function AuditPage(): JSX.Element {
  const repos = useRepositories();
  const { role } = useSession();
  const canExport = canPerformAction(role, "export:audit");

  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(15);
  // Seed the search box from ?search= so the global Topbar search can deep-link
  // into this page (read lazily — no useSearchParams Suspense requirement).
  const [search, setSearch] = useState<string>(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("search") ?? ""
  );
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: isoDaysAgo(7),
    to: isoToday(),
  });

  const [data, setData] = useState<Page<AuditEvent> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const deviceNames = useDeviceNames();
  const toast = useToastHelpers();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.audit
      .list(
        { page, perPage, search },
        {
          type: typeFilter || undefined,
          from: dateRange.from,
          to: dateRange.to,
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
  }, [repos, page, perPage, search, typeFilter, dateRange]);

  const columns: ColumnDef<AuditEvent>[] = useMemo(
    () => [
      {
        key: "event_id",
        header: "Event",
        accessor: (e) => (
          <span className="font-mono text-xs">{e.event_id}</span>
        ),
      },
      {
        key: "type",
        header: "Type",
        accessor: (e) => (
          <Badge variant="default" size="sm">
            {e.type}
          </Badge>
        ),
        sortable: true,
      },
      {
        key: "user",
        header: "Actor / Device",
        accessor: (e) => (
          <div>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {e.user_id}
            </p>
            <Link
              href={`/devices/${encodeURIComponent(e.device_id)}`}
              className="text-xs text-vg-primary-600 hover:underline"
              title={e.device_id}
            >
              {deviceNames[e.device_id] ?? e.device_id}
            </Link>
          </div>
        ),
      },
      {
        key: "decision",
        header: "Decision",
        accessor: (e) => (
          <DecisionIndicator decision={e.decision as Decision} size="sm" />
        ),
      },
      {
        key: "risk",
        header: "Risk",
        accessor: (e) => (
          <span className="text-sm uppercase tracking-wide text-gray-600 dark:text-gray-400">
            {e.risk_level}
          </span>
        ),
      },
      {
        key: "hash",
        header: "Hash",
        accessor: (e) => (
          <span
            className="font-mono text-xs text-gray-500 dark:text-gray-400"
            title={e.event_hash}
          >
            {bytesToHexPreview(e.event_hash, 8)}
          </span>
        ),
      },
      {
        key: "when",
        header: "When",
        accessor: (e) => (
          <span title={formatDateTime(e.timestamp_ms)}>
            {formatRelativeTime(e.timestamp_ms)}
          </span>
        ),
        sortable: true,
      },
    ],
    [deviceNames]
  );

  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const filters = {
        type: typeFilter || undefined,
        from: dateRange.from,
        to: dateRange.to,
      };
      const rows: Record<string, unknown>[] = [];
      let exportPage = 1;
      let total = Number.POSITIVE_INFINITY;
      while (rows.length < total && rows.length < EXPORT_ROW_CAP) {
        const result = await repos.audit.list(
          { page: exportPage, perPage: EXPORT_PAGE_SIZE, search },
          filters
        );
        total = result.total;
        for (const e of result.items) {
          if (rows.length >= EXPORT_ROW_CAP) break;
          rows.push({
            event_id: e.event_id,
            type: e.type,
            timestamp: new Date(e.timestamp_ms).toISOString(),
            user_id: e.user_id,
            device_id: e.device_id,
            decision: e.decision,
            risk_level: e.risk_level,
            category: e.category ?? "",
            reason: e.reason ?? "",
            event_hash: e.event_hash,
          });
        }
        if (result.items.length === 0) break;
        exportPage += 1;
      }
      const truncated = rows.length >= EXPORT_ROW_CAP && total > rows.length;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      downloadCsv(`vguardrail-audit-${stamp}.csv`, toCsv(rows, EXPORT_COLUMNS));
      toast.success(
        "Audit export complete",
        truncated
          ? `Exported ${rows.length} rows (truncated at the ${EXPORT_ROW_CAP}-row cap).`
          : `Exported ${rows.length} rows.`
      );
    } catch {
      toast.error(
        "Audit export failed",
        "Could not fetch audit events. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <DashboardLayout>
      <PageHeader
        title="Audit Log"
        description="Immutable, hash-chained record of all security-relevant events."
        actions={
          canExport ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              loading={exporting}
            >
              {exporting ? "Exporting…" : "Export"}
            </Button>
          ) : null
        }
      />

      <Card padding="md" className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="md:col-span-2 lg:col-span-1">
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search by event ID, type, user, or device"
            />
          </div>
          <Select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            options={TYPE_OPTIONS}
            aria-label="Filter by event type"
          />
          <DateRangePicker
            value={dateRange}
            onChange={(r) => {
              setDateRange(r);
              setPage(1);
            }}
            fromLabel="From"
            toLabel="To"
            className="md:col-span-2 lg:col-span-1"
          />
        </div>
      </Card>

      <Card padding="none">
        {loading || !data ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No audit events"
            description="No events match the current filters. Try expanding the date range."
            variant="no-results"
          />
        ) : (
          <>
            <Table
              columns={columns}
              data={data.items}
              keyExtractor={(e) => e.event_id}
              hoverable
            />
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
          </>
        )}
      </Card>
    </DashboardLayout>
  );
}
