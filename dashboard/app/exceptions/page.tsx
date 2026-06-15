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
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToastHelpers } from "@/components/ui/Toast";
import { useRepositories } from "@/hooks/useRepositories";
import { useSession } from "@/hooks/useSession";
import { canPerformAction } from "@/lib/auth/rbac";
import { formatDateTime, formatRelativeTime, truncate } from "@/lib/utils/format";
import type { Exception, ExceptionStatus } from "@/types";
import type { ExceptionDetail, Page } from "@/lib/api";

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

const statusBadgeVariant: Record<
  ExceptionStatus,
  "warning" | "success" | "error" | "default" | "info"
> = {
  pending: "warning",
  approved: "success",
  rejected: "error",
  expired: "default",
  revoked: "info",
};

export default function ExceptionsPage(): JSX.Element {
  const repos = useRepositories();
  const { session, role } = useSession();
  const canApprove = canPerformAction(role, "approve:exception");

  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(10);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [data, setData] = useState<Page<Exception> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [selected, setSelected] = useState<ExceptionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  const [reviewAction, setReviewAction] = useState<
    "approve" | "reject" | null
  >(null);
  const [reviewBusy, setReviewBusy] = useState<boolean>(false);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createRuleId, setCreateRuleId] = useState<string>("");
  const [createReason, setCreateReason] = useState<string>("");
  const [createBusy, setCreateBusy] = useState<boolean>(false);

  const toast = useToastHelpers();

  const refresh = (): void => {
    setLoading(true);
    repos.exceptions
      .list(
        { page, perPage, search },
        {
          ...(statusFilter ? { status: statusFilter as ExceptionStatus } : {}),
        }
      )
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(refresh, [repos, page, perPage, search, statusFilter]);

  const columns: ColumnDef<Exception>[] = useMemo(
    () => [
      {
        key: "exception_id",
        header: "Exception",
        accessor: (e) => (
          <span className="font-mono text-xs">{e.exception_id}</span>
        ),
      },
      {
        key: "policy",
        header: "Policy / Rule",
        accessor: (e) => (
          <div>
            <p className="text-sm text-gray-900 dark:text-gray-100">
              v{e.policy_version} · {truncate(e.rule_id, 24)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
              {e.reason}
            </p>
          </div>
        ),
      },
      {
        key: "requested_by",
        header: "Requested By",
        accessor: (e) => (
          <span className="text-sm">{e.requested_by}</span>
        ),
      },
      {
        key: "status",
        header: "Status",
        accessor: (e) => (
          <Badge variant={statusBadgeVariant[e.status]} size="sm" dot>
            {e.status}
          </Badge>
        ),
      },
      {
        key: "expires",
        header: "Expires",
        accessor: (e) =>
          e.expires_at_ms ? formatRelativeTime(e.expires_at_ms) : "—",
      },
      {
        key: "actions",
        header: "",
        className: "text-right",
        accessor: (e) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDetailLoading(true);
              repos.exceptions
                .get(e.exception_id)
                .then((d) => {
                  setSelected(d);
                  setDetailLoading(false);
                })
                .catch(() => setDetailLoading(false));
            }}
          >
            Review
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos]
  );

  const submitReview = async (): Promise<void> => {
    if (!selected || !reviewAction) return;
    setReviewBusy(true);
    try {
      const next =
        reviewAction === "approve"
          ? await repos.exceptions.approve(
              selected.exception_id,
              session.email
            )
          : await repos.exceptions.reject(
              selected.exception_id,
              session.email,
              "Insufficient context"
            );
      setSelected(next);
      setReviewAction(null);
      refresh();
    } finally {
      setReviewBusy(false);
    }
  };

  const submitCreate = async (): Promise<void> => {
    const ruleId = createRuleId.trim();
    const reason = createReason.trim();
    if (!ruleId || !reason) return;
    setCreateBusy(true);
    try {
      await repos.exceptions.create(ruleId, reason);
      setCreateOpen(false);
      setCreateRuleId("");
      setCreateReason("");
      refresh();
      toast.success(
        "Exception requested",
        `Request for rule ${ruleId} submitted for review.`
      );
    } catch {
      toast.error(
        "Could not create exception",
        "Check the rule ID and try again."
      );
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <DashboardLayout>
      <PageHeader
        title="Exceptions"
        description="Pending and historical policy exception requests."
        actions={
          canApprove ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              New Exception
            </Button>
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
                  placeholder="Search by exception ID, requester, or reason"
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
                  aria-label="Filter by status"
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
                title="No exceptions"
                description="Nothing here yet — your team is staying within policy."
                variant="no-data"
              />
            ) : (
              <>
                <Table
                  columns={columns}
                  data={data.items}
                  keyExtractor={(e) => e.exception_id}
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
              <ExceptionDetailPanel
                detail={selected}
                canApprove={canApprove}
                onApprove={() => setReviewAction("approve")}
                onReject={() => setReviewAction("reject")}
              />
            ) : (
              <EmptyState
                title="No exception selected"
                description="Pick an exception from the list to review its details."
                variant="default"
                size="sm"
              />
            )}
          </Card>
        </div>
      </div>

      <Modal
        isOpen={reviewAction !== null}
        onClose={() => !reviewBusy && setReviewAction(null)}
        title={reviewAction === "approve" ? "Approve exception" : "Reject exception"}
        size="sm"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {reviewAction === "approve"
            ? "This will grant a 7-day exception. The approver will be recorded."
            : "This will reject the request. The requester will be notified."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReviewAction(null)}
            disabled={reviewBusy}
          >
            Cancel
          </Button>
          <Button
            variant={reviewAction === "approve" ? "default" : "destructive"}
            size="sm"
            onClick={() => void submitReview()}
            loading={reviewBusy}
          >
            {reviewAction === "approve" ? "Approve" : "Reject"}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={createOpen}
        onClose={() => !createBusy && setCreateOpen(false)}
        title="Request exception"
        description="Ask for a specific policy rule to be relaxed for a limited time."
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
          className="space-y-4"
        >
          <Input
            label="Rule ID"
            value={createRuleId}
            onChange={(e) => setCreateRuleId(e.target.value)}
            placeholder="e.g. rule-secret-aws-key"
            disabled={createBusy}
            required
          />
          <div className="w-full">
            <label
              htmlFor="exception-reason"
              className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1.5"
            >
              Reason
            </label>
            <textarea
              id="exception-reason"
              rows={4}
              value={createReason}
              onChange={(e) => setCreateReason(e.target.value)}
              placeholder="Business justification for this exception"
              disabled={createBusy}
              required
              className="flex w-full rounded-lg border bg-white px-3 py-2 text-sm border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white dark:bg-gray-800 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-vg-primary-500 focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-800 transition-colors"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={createBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              loading={createBusy}
              disabled={
                createRuleId.trim().length === 0 ||
                createReason.trim().length === 0
              }
            >
              Submit Request
            </Button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
}

interface ExceptionDetailPanelProps {
  readonly detail: ExceptionDetail;
  readonly canApprove: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

function ExceptionDetailPanel({
  detail,
  canApprove,
  onApprove,
  onReject,
}: ExceptionDetailPanelProps): JSX.Element {
  return (
    <div>
      <CardHeader
        title={detail.exception_id}
        description={`Policy ${detail.policy_name} v${detail.policy_version}`}
        action={
          <Badge variant={statusBadgeVariant[detail.status]} size="sm" dot>
            {detail.status}
          </Badge>
        }
      />

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Rule</dt>
          <dd className="text-gray-700 dark:text-gray-300">
            {detail.rule_description}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Reason</dt>
          <dd className="text-gray-700 dark:text-gray-300">{detail.reason}</dd>
        </div>
        <div>
          <dt className="text-gray-500 dark:text-gray-400">Requested by</dt>
          <dd className="text-gray-700 dark:text-gray-300">
            {detail.requested_by_email}
          </dd>
        </div>
        {detail.approved_by_email && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {detail.status === "rejected" ? "Rejected by" : "Approved by"}
            </dt>
            <dd className="text-gray-700 dark:text-gray-300">
              {detail.approved_by_email}
            </dd>
          </div>
        )}
        {detail.expires_at_ms && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400">Expires</dt>
            <dd className="text-gray-700 dark:text-gray-300">
              {formatDateTime(detail.expires_at_ms)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-4">
        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
          Activity
        </h4>
        {detail.comment_history.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No comments yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.comment_history.map((c) => (
              <li
                key={c.comment_id}
                className="border-l-2 border-gray-200 dark:border-gray-700 pl-3"
              >
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {c.author} · {formatRelativeTime(c.timestamp_ms)}
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canApprove && detail.status === "pending" ? (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="destructive" size="sm" onClick={onReject}>
            Reject
          </Button>
          <Button variant="default" size="sm" onClick={onApprove}>
            Approve
          </Button>
        </div>
      ) : null}
    </div>
  );
}

void TabsList;
void TabsTrigger;
void TabsPanel;
