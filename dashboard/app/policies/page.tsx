"use client";

import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsPanel } from "@/components/ui/Tabs";
import { Table, type ColumnDef } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  DecisionIndicator,
  StatusIndicator,
} from "@/components/ui/StatusIndicator";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useRepositories } from "@/hooks/useRepositories";
import { useSession } from "@/hooks/useSession";
import { canPerformAction } from "@/lib/auth/rbac";
import { formatDate, formatDateTime, truncate } from "@/lib/utils/format";
import type { PolicyStatus, PolicySummary } from "@/types";
import type { Page, PolicyDetail } from "@/lib/api";

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "superseded", label: "Superseded" },
  { value: "rollback", label: "Rollback" },
];

const statusBadgeVariant: Record<
  PolicyStatus,
  "success" | "warning" | "default" | "info"
> = {
  active: "success",
  draft: "warning",
  superseded: "default",
  rollback: "info",
};

const STATUS_TONE: Record<PolicyStatus, "success" | "warning" | "neutral" | "info"> = {
  active: "success",
  draft: "warning",
  superseded: "neutral",
  rollback: "info",
};

// Shown on the intentionally-disabled authoring buttons.
const AUTHORING_TOOLTIP =
  "Policy authoring ships via the signed policy-bundle pipeline — UI editing coming soon.";

export default function PoliciesPage(): JSX.Element {
  const repos = useRepositories();
  const { role } = useSession();
  const canEdit = canPerformAction(role, "update:policy");
  const canPublish = canPerformAction(role, "publish:policy");

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

  const [data, setData] = useState<Page<PolicySummary> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [selected, setSelected] = useState<PolicyDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.policies
      .list(
        { page, perPage, search },
        {
          ...(statusFilter ? { status: statusFilter as PolicyStatus } : {}),
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
  }, [repos, page, perPage, search, statusFilter]);

  const columns: ColumnDef<PolicySummary>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Policy",
        accessor: (p) => (
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {p.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              v{p.version} · {p.rule_count} rules
            </p>
          </div>
        ),
        sortable: true,
      },
      {
        key: "status",
        header: "Status",
        accessor: (p) => (
          <Badge variant={statusBadgeVariant[p.status]} size="sm" dot>
            {p.status}
          </Badge>
        ),
      },
      {
        key: "default_action",
        header: "Default Action",
        accessor: (p) => <DecisionIndicator decision={p.default_action} size="sm" />,
      },
      {
        key: "created",
        header: "Created",
        accessor: (p) => formatDate(new Date(p.created_at).getTime()),
      },
      {
        key: "published",
        header: "Published",
        accessor: (p) => (p.published_at ? formatDate(new Date(p.published_at).getTime()) : "—"),
      },
      {
        key: "actions",
        header: "",
        className: "text-right",
        accessor: (p) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetailLoading(true);
              repos.policies
                .get(p.policy_id)
                .then((d) => {
                  setSelected(d);
                  setDetailLoading(false);
                })
                .catch(() => setDetailLoading(false));
            }}
          >
            View
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos]
  );

  return (
    <DashboardLayout>
      <PageHeader
        title="Policies"
        description="Active, draft, and historical policy versions."
        actions={
          canEdit ? (
            <Tooltip content={AUTHORING_TOOLTIP} side="bottom">
              {/* Disabled buttons swallow hover/focus, so the wrapper takes them. */}
              <span tabIndex={0}>
                <Button variant="default" size="sm" disabled>
                  New Policy
                </Button>
              </span>
            </Tooltip>
          ) : null
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card padding="md">
            <div className="flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <SearchInput
                  value={search}
                  onValueChange={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder="Search by policy name or version"
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
                  aria-label="Filter by policy status"
                />
              </div>
            </div>
          </Card>

          <Card padding="none">
            {loading || !data ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} height={28} />
                ))}
              </div>
            ) : data.items.length === 0 ? (
              <EmptyState
                title="No policies match"
                description="Try a different search or status filter."
                variant="no-results"
              />
            ) : (
              <>
                <Table
                  columns={columns}
                  data={data.items}
                  keyExtractor={(p) => p.policy_id}
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
        </div>

        <div>
          <Card padding="md">
            {detailLoading ? (
              <div className="space-y-3">
                <Skeleton height={20} width="60%" />
                <Skeleton height={14} width="40%" />
                <Skeleton height={80} />
              </div>
            ) : selected ? (
              <PolicyDetailPanel
                policy={selected}
                canEdit={canEdit}
                canPublish={canPublish}
              />
            ) : (
              <EmptyState
                title="No policy selected"
                description="Select a policy on the left to view its rules and history."
                variant="default"
                size="sm"
              />
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

interface PolicyDetailPanelProps {
  readonly policy: PolicyDetail;
  readonly canEdit: boolean;
  readonly canPublish: boolean;
}

function PolicyDetailPanel({
  policy,
  canEdit,
  canPublish,
}: PolicyDetailPanelProps): JSX.Element {
  return (
    <div>
      <CardHeader
        title={policy.name}
        description={`v${policy.version} · ${policy.rule_count} rules`}
        action={
          <Badge variant={statusBadgeVariant[policy.status]} size="sm" dot>
            {policy.status}
          </Badge>
        }
      />

      <Tabs
        defaultActiveId="rules"
        items={[
          {
            id: "rules",
            label: "Rules",
            content: <PolicyRulesTab policy={policy} />,
          },
          {
            id: "history",
            label: "Version History",
            content: <PolicyHistoryTab policy={policy} />,
          },
          {
            id: "details",
            label: "Details",
            content: <PolicyDetailsTab policy={policy} />,
          },
        ]}
      />

      <div className="mt-4 flex justify-end gap-2">
        {canEdit ? (
          <Tooltip content={AUTHORING_TOOLTIP}>
            {/* Disabled buttons swallow hover/focus, so the wrapper takes them. */}
            <span tabIndex={0}>
              <Button variant="outline" size="sm" disabled>
                Edit
              </Button>
            </span>
          </Tooltip>
        ) : null}
        {canPublish && policy.status === "draft" ? (
          <Tooltip content={AUTHORING_TOOLTIP}>
            <span tabIndex={0}>
              <Button variant="default" size="sm" disabled>
                Publish
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function PolicyRulesTab({ policy }: { policy: PolicyDetail }): JSX.Element {
  if (policy.rules.length === 0) {
    return (
      <EmptyState
        title="No rules"
        description="This policy has no rules configured."
        variant="no-data"
        size="sm"
      />
    );
  }
  return (
    <ul className="space-y-3">
      {policy.rules.map((r) => (
        <li
          key={r.rule_id}
          className="border border-gray-200 dark:border-gray-700 rounded-md p-3"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {r.description}
            </span>
            <div className="flex items-center gap-2">
              <DecisionIndicator decision={r.action} size="sm" />
              <StatusIndicator
                tone={r.enabled ? "success" : "neutral"}
                label={r.enabled ? "Enabled" : "Disabled"}
                size="sm"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {r.conditions}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PolicyHistoryTab({ policy }: { policy: PolicyDetail }): JSX.Element {
  return (
    <ul className="space-y-2 text-sm">
      <li className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 pb-2">
        <span className="text-gray-700 dark:text-gray-300">Current version</span>
        <Badge variant="default" size="sm">
          v{policy.version}
        </Badge>
      </li>
      {policy.supersedes_version !== null && (
        <li className="flex items-center justify-between text-gray-600 dark:text-gray-400">
          <span>Supersedes</span>
          <span className="font-mono text-xs">v{policy.supersedes_version}</span>
        </li>
      )}
      {policy.superseded_by_version !== null && (
        <li className="flex items-center justify-between text-gray-600 dark:text-gray-400">
          <span>Superseded by</span>
          <span className="font-mono text-xs">
            v{policy.superseded_by_version}
          </span>
        </li>
      )}
      <li className="flex items-center justify-between text-gray-600 dark:text-gray-400">
        <span>Created</span>
        <span>{formatDateTime(new Date(policy.created_at).getTime())}</span>
      </li>
      {policy.published_at && (
        <li className="flex items-center justify-between text-gray-600 dark:text-gray-400">
          <span>Published</span>
          <span>{formatDateTime(new Date(policy.published_at).getTime())}</span>
        </li>
      )}
    </ul>
  );
}

function PolicyDetailsTab({ policy }: { policy: PolicyDetail }): JSX.Element {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-gray-500 dark:text-gray-400">Policy ID</dt>
        <dd className="font-mono text-xs">{truncate(policy.policy_id, 32)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-gray-500 dark:text-gray-400">Default action</dt>
        <dd>
          <DecisionIndicator decision={policy.default_action} size="sm" />
        </dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-gray-500 dark:text-gray-400">Created by</dt>
        <dd className="text-gray-700 dark:text-gray-300">{policy.created_by}</dd>
      </div>
      <div>
        <dt className="text-gray-500 dark:text-gray-400">Notes</dt>
        <dd className="text-gray-700 dark:text-gray-300 mt-1">
          {policy.notes || "—"}
        </dd>
      </div>
    </dl>
  );
}

// Tabs are imported but we re-export to ensure tree-shaking sees them.
void TabsList;
void TabsTrigger;
void TabsPanel;
