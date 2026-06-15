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
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import {
  DecisionIndicator,
  SeverityIndicator,
} from "@/components/ui/StatusIndicator";
import { useRepositories } from "@/hooks/useRepositories";
import { useDeviceNames } from "@/hooks/useDeviceNames";
import { formatRelativeTime, formatDateTime } from "@/lib/utils/format";
import { CATEGORIES, categoryLabel } from "@/types";
import type {
  Violation,
  Severity,
  Decision,
  Source,
} from "@/types";
import type { Page, ViolationDetail } from "@/lib/api";

const SEVERITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All severities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const DECISION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All decisions" },
  { value: "allow", label: "Allowed" },
  { value: "warn", label: "Warned" },
  { value: "block", label: "Blocked" },
];

const SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All sources" },
  { value: "browser", label: "Browser" },
  { value: "ide", label: "IDE" },
  { value: "cli", label: "CLI" },
  { value: "api", label: "API" },
];

const CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All categories" },
  ...CATEGORIES,
];

const isoToday = (): string => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export default function ViolationsPage(): JSX.Element {
  const repos = useRepositories();

  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(15);
  // Seed the search box from ?search= so the global Topbar search can deep-link
  // into this page (read lazily — no useSearchParams Suspense requirement).
  const [search, setSearch] = useState<string>(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("search") ?? ""
  );
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [decisionFilter, setDecisionFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: isoDaysAgo(30),
    to: isoToday(),
  });

  const [data, setData] = useState<Page<Violation> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const deviceNames = useDeviceNames();

  // Detail modal: the clicked row renders immediately; the full detail
  // (findings) is fetched lazily and merged in when it arrives.
  const [selected, setSelected] = useState<Violation | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ViolationDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.violations
      .list(
        { page, perPage, search },
        {
          ...(severityFilter ? { severity: severityFilter as Severity } : {}),
          ...(decisionFilter ? { decision: decisionFilter as Decision } : {}),
          ...(sourceFilter ? { source: sourceFilter as Source } : {}),
          ...(categoryFilter ? { category: categoryFilter } : {}),
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
  }, [
    repos,
    page,
    perPage,
    search,
    severityFilter,
    decisionFilter,
    sourceFilter,
    categoryFilter,
    dateRange,
  ]);

  // Lazily load the full detail (incl. findings) for the selected violation.
  useEffect(() => {
    if (!selected) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    repos.violations
      .get(selected.event_id)
      .then((detail) => {
        if (!cancelled) setSelectedDetail(detail);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repos, selected]);

  const columns: ColumnDef<Violation>[] = useMemo(
    () => [
      {
        key: "event_id",
        header: "Event ID",
        accessor: (v) => (
          <span className="font-mono text-xs">{v.event_id}</span>
        ),
      },
      {
        key: "classification",
        header: "Classification",
        accessor: (v) => (
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {v.classification}
          </span>
        ),
        sortable: true,
      },
      {
        key: "category",
        header: "Category",
        accessor: (v) =>
          v.category ? (
            <Badge variant="default" size="sm">
              {categoryLabel(v.category)}
            </Badge>
          ) : (
            <span className="text-sm text-gray-400 dark:text-gray-500">—</span>
          ),
        sortable: true,
      },
      {
        key: "reason",
        header: "Reason",
        accessor: (v) => (
          <span
            className="block max-w-[16rem] truncate text-sm text-gray-600 dark:text-gray-400"
            title={v.reason ?? undefined}
          >
            {v.reason ?? "—"}
          </span>
        ),
      },
      {
        key: "user",
        header: "User / Device",
        accessor: (v) => (
          <div>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              {v.user_id}
            </p>
            <Link
              href={`/devices/${encodeURIComponent(v.device_id)}`}
              className="text-xs text-vg-primary-600 hover:underline"
              title={v.device_id}
            >
              {deviceNames[v.device_id] ?? v.device_id}
            </Link>
          </div>
        ),
      },
      {
        key: "source",
        header: "Source",
        accessor: (v) => (
          <span className="text-sm uppercase tracking-wide text-gray-600 dark:text-gray-400">
            {v.source ?? "—"}
          </span>
        ),
      },
      {
        key: "model",
        header: "Model",
        accessor: (v) => (
          <span className="text-sm">{v.model ?? "—"}</span>
        ),
      },
      {
        key: "severity",
        header: "Severity",
        accessor: (v) => (
          <SeverityIndicator severity={v.risk_level as Severity} size="sm" />
        ),
      },
      {
        key: "decision",
        header: "Decision",
        accessor: (v) => <DecisionIndicator decision={v.decision} size="sm" />,
      },
      {
        key: "policy",
        header: "Policy",
        accessor: (v) => (
          <span className="text-sm">v{v.policy_version}</span>
        ),
      },
      {
        key: "when",
        header: "When",
        accessor: (v) => (
          <span title={formatDateTime(v.timestamp_ms)}>
            {formatRelativeTime(v.timestamp_ms)}
          </span>
        ),
        sortable: true,
      },
      {
        key: "details",
        header: "",
        className: "text-right",
        accessor: (v) => (
          <button
            type="button"
            onClick={() => setSelected(v)}
            className="text-sm font-medium text-vg-primary-600 hover:underline"
          >
            Details
          </button>
        ),
      },
    ],
    [deviceNames]
  );

  return (
    <DashboardLayout>
      <PageHeader
        title="Violations"
        description="All policy violations across the org, with severity, decision, and category filters."
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
              placeholder="Search by event ID, classification, user, or device"
            />
          </div>
          <Select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            options={SEVERITY_OPTIONS}
            aria-label="Filter by severity"
          />
          <Select
            value={decisionFilter}
            onChange={(e) => {
              setDecisionFilter(e.target.value);
              setPage(1);
            }}
            options={DECISION_OPTIONS}
            aria-label="Filter by decision"
          />
          <Select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            options={SOURCE_OPTIONS}
            aria-label="Filter by source"
          />
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            options={CATEGORY_OPTIONS}
            aria-label="Filter by category"
          />
          <DateRangePicker
            value={dateRange}
            onChange={(r) => {
              setDateRange(r);
              setPage(1);
            }}
            fromLabel="From"
            toLabel="To"
            className="md:col-span-2 lg:col-span-2"
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
            title="No violations match"
            description="Try adjusting filters or expanding the date range."
            variant="no-results"
          />
        ) : (
          <>
            <Table
              columns={columns}
              data={data.items}
              keyExtractor={(v) => v.event_id}
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

      <Modal
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title="Violation Details"
        description={selected?.event_id}
        size="lg"
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <DecisionIndicator decision={selected.decision} size="sm" />
              <SeverityIndicator
                severity={selected.risk_level as Severity}
                size="sm"
              />
              {selected.category && (
                <Badge variant="default" size="sm">
                  {categoryLabel(selected.category)}
                </Badge>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                Reason
              </h3>
              <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                {selected.reason ?? "No reason recorded for this event."}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">User</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {selected.user_id}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">Device</dt>
                <dd className="text-xs text-gray-900 dark:text-gray-100">
                  <Link
                    href={`/devices/${encodeURIComponent(selected.device_id)}`}
                    className="text-vg-primary-600 hover:underline"
                  >
                    {deviceNames[selected.device_id] ?? selected.device_id}
                  </Link>
                  <span className="ml-1 font-mono text-gray-500 dark:text-gray-400">
                    ({selected.device_id})
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  Classification
                </dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {selected.classification}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">When</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {formatDateTime(selected.timestamp_ms)}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                Findings
              </h3>
              {!selectedDetail ? (
                <Skeleton height={24} />
              ) : !selectedDetail.findings || selectedDetail.findings.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No findings recorded for this event.
                </p>
              ) : (
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {selectedDetail.findings.map((f, idx) => (
                    <li
                      key={`${f.detector_id}-${idx}`}
                      className="py-2 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                          {f.detector_id}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {categoryLabel(f.category)} · {f.kind} ·{" "}
                          <span className="font-mono">{f.redacted_preview}</span>
                        </p>
                      </div>
                      <SeverityIndicator severity={f.severity} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
}
