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
import { useRepositories } from "@/hooks/useRepositories";
import { useSession } from "@/hooks/useSession";
import {
  canCreateUser,
  canPerformAction,
  getRoleLevel,
} from "@/lib/auth/rbac";
import { formatRelativeTime } from "@/lib/utils/format";
import type { Role, UserSession } from "@/types";
import type { OrgSettings, Page, UserSummary } from "@/lib/api";

const ENROLLMENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "open", label: "Open — anyone with the link can enroll" },
  { value: "invite", label: "Invite only — admins must send invitations" },
  { value: "closed", label: "Closed — no new enrollments" },
];

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  auditor: "Auditor",
  viewer: "Viewer",
};

const ROLE_VARIANT: Record<Role, "default" | "info" | "warning" | "error"> = {
  super_admin: "error",
  org_admin: "warning",
  auditor: "info",
  viewer: "default",
};

export default function SettingsPage(): JSX.Element {
  const repos = useRepositories();
  const { session, role } = useSession();
  const canManageSettings = canPerformAction(role, "manage:settings");
  const canManageEnrollment = canPerformAction(role, "manage:enrollment");
  const canCreateSuperAdmin = canPerformAction(role, "create:super_admin");

  return (
    <DashboardLayout>
      <PageHeader
        title="Settings"
        description="Organization, user management, and RBAC visibility."
      />

      <Tabs
        defaultActiveId="org"
        items={[
          {
            id: "org",
            label: "Organization",
            content: (
              <OrgSettingsTab
                canManageSettings={canManageSettings}
                canManageEnrollment={canManageEnrollment}
              />
            ),
          },
          {
            id: "users",
            label: "User Management",
            content: (
              <UsersTab
                currentUser={session}
                canCreateSuperAdmin={canCreateSuperAdmin}
              />
            ),
          },
          {
            id: "rbac",
            label: "RBAC",
            content: <RbacTab currentRole={role} />,
          },
        ]}
      />
    </DashboardLayout>
  );
}

interface OrgSettingsTabProps {
  readonly canManageSettings: boolean;
  readonly canManageEnrollment: boolean;
}

function OrgSettingsTab({
  canManageSettings,
  canManageEnrollment,
}: OrgSettingsTabProps): JSX.Element {
  const repos = useRepositories();
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [draft, setDraft] = useState<OrgSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    repos.org
      .get()
      .then((s) => {
        if (!cancelled) {
          setSettings(s);
          setDraft(s);
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

  const handleSave = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await repos.org.update(draft);
      setSettings(next);
      setDraft(next);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings || !draft) {
    return (
      <div className="mt-4 space-y-3">
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  return (
    <Card padding="md" className="mt-4">
      <CardHeader
        title="Organization"
        description="Identity, enrollment mode, retention, and notification settings."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="org-name"
            className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
          >
            Organization name
          </label>
          <Input
            id="org-name"
            value={draft.org_name}
            disabled={!canManageSettings}
            onChange={(e) =>
              setDraft({ ...draft, org_name: e.target.value })
            }
          />
        </div>
        <div>
          <label
            htmlFor="org-id"
            className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
          >
            Organization ID
          </label>
          <Input
            id="org-id"
            value={draft.org_id}
            disabled
            readOnly
          />
        </div>
        <div>
          <label
            htmlFor="enrollment"
            className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
          >
            Enrollment mode
          </label>
          <Select
            id="enrollment"
            value={draft.enrollment_mode}
            disabled={!canManageEnrollment}
            onChange={(e) =>
              setDraft({
                ...draft,
                enrollment_mode: e.target.value as OrgSettings["enrollment_mode"],
              })
            }
            options={ENROLLMENT_OPTIONS}
          />
        </div>
        <div>
          <label
            htmlFor="retention"
            className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
          >
            Data retention (days)
          </label>
          <Input
            id="retention"
            type="number"
            min={7}
            max={3650}
            value={draft.data_retention_days}
            disabled={!canManageSettings}
            onChange={(e) =>
              setDraft({
                ...draft,
                data_retention_days: Number(e.target.value),
              })
            }
          />
        </div>
        <div>
          <label
            htmlFor="slack-webhook"
            className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
          >
            Slack webhook URL
          </label>
          <Input
            id="slack-webhook"
            type="url"
            placeholder="https://hooks.slack.com/services/…"
            value={draft.slack_webhook_url ?? ""}
            disabled={!canManageSettings}
            onChange={(e) =>
              setDraft({
                ...draft,
                slack_webhook_url: e.target.value || null,
              })
            }
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
            Email alerts
          </label>
          <label
            htmlFor="email-alerts"
            className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
          >
            <input
              id="email-alerts"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300"
              disabled={!canManageSettings}
              checked={draft.email_alerts}
              onChange={(e) =>
                setDraft({ ...draft, email_alerts: e.target.checked })
              }
            />
            Send email alerts to org admins
          </label>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canManageSettings}
          onClick={() => setDraft(settings)}
        >
          Reset
        </Button>
        <Button
          variant="default"
          size="sm"
          loading={saving}
          disabled={!canManageSettings}
          onClick={() => void handleSave()}
        >
          Save changes
        </Button>
      </div>
    </Card>
  );
}

interface UsersTabProps {
  readonly currentUser: UserSession;
  readonly canCreateSuperAdmin: boolean;
}

function UsersTab({
  currentUser,
  canCreateSuperAdmin,
}: UsersTabProps): JSX.Element {
  const repos = useRepositories();
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(10);
  const [search, setSearch] = useState<string>("");
  const [data, setData] = useState<Page<UserSummary> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");
  const [inviting, setInviting] = useState<boolean>(false);

  const refresh = (): void => {
    setLoading(true);
    repos.users
      .list({ page, perPage, search })
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(refresh, [repos, page, perPage, search]);

  const canInviteToRole = useMemo(() => {
    return (target: Role): boolean =>
      canCreateUser(currentUser.role, target) ||
      (canCreateSuperAdmin && target === "super_admin");
  }, [currentUser.role, canCreateSuperAdmin]);

  const roleOptions: ReadonlyArray<{ value: string; label: string }> = (
    ["viewer", "auditor", "org_admin", "super_admin"] as const
  )
    .filter((r) => canInviteToRole(r))
    .map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  const columns: ColumnDef<UserSummary>[] = useMemo(
    () => [
      {
        key: "email",
        header: "Email",
        accessor: (u) => (
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {u.email}
          </span>
        ),
        sortable: true,
      },
      {
        key: "role",
        header: "Role",
        accessor: (u) => (
          <Badge variant={ROLE_VARIANT[u.role]} size="sm">
            {ROLE_LABELS[u.role]}
          </Badge>
        ),
      },
      {
        key: "status",
        header: "Status",
        accessor: (u) => (
          <Badge
            variant={
              u.status === "active"
                ? "success"
                : u.status === "invited"
                  ? "warning"
                  : "default"
            }
            size="sm"
            dot
          >
            {u.status}
          </Badge>
        ),
      },
      {
        key: "last_login",
        header: "Last login",
        accessor: (u) => formatRelativeTime(u.last_login_ms),
      },
      {
        key: "actions",
        header: "",
        className: "text-right",
        accessor: (u) =>
          u.status === "active" && getRoleLevel(currentUser.role) > getRoleLevel(u.role) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void repos.users.disable(u.id).then(refresh);
              }}
            >
              Disable
            </Button>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repos, currentUser.role]
  );

  const handleInvite = async (): Promise<void> => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      await repos.users.invite(inviteEmail, inviteRole);
      setInviteEmail("");
      refresh();
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      <Card padding="md">
        <CardHeader
          title="Invite user"
          description="Send an invitation to a new team member."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <label
              htmlFor="invite-email"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
            >
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              placeholder="user@corp.example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="invite-role"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1"
            >
              Role
            </label>
            <Select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
              options={roleOptions}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="default"
            size="sm"
            loading={inviting}
            disabled={!inviteEmail || roleOptions.length === 0}
            onClick={() => void handleInvite()}
          >
            Send invitation
          </Button>
        </div>
        {roleOptions.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Your role does not allow inviting users.
          </p>
        ) : null}
      </Card>

      <Card padding="md">
        <div className="mb-3">
          <SearchInput
            value={search}
            onValueChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search by email or role"
          />
        </div>
        {loading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No users match"
            description="Try a different search."
            variant="no-results"
            size="sm"
          />
        ) : (
          <>
            <Table
              columns={columns}
              data={data.items}
              keyExtractor={(u) => u.id}
              hoverable
            />
            <div className="mt-3">
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
  );
}

interface RbacTabProps {
  readonly currentRole: Role;
}

interface RbacMatrixRow {
  readonly role: Role;
  readonly level: number;
  readonly can: readonly string[];
}

const RBAC_MATRIX: readonly RbacMatrixRow[] = [
  {
    role: "super_admin",
    level: 100,
    can: [
      "Full read/write across org",
      "Create / publish policies",
      "Approve / reject exceptions",
      "Manage settings, users, enrollment",
      "View audit log + export",
    ],
  },
  {
    role: "org_admin",
    level: 80,
    can: [
      "Read everything, edit policies",
      "Approve / reject exceptions",
      "Manage settings, users, enrollment",
      "View audit log + export",
    ],
  },
  {
    role: "auditor",
    level: 50,
    can: [
      "Read policies, violations, audit, exceptions",
      "View audit log + export",
      "Read-only settings",
    ],
  },
  {
    role: "viewer",
    level: 20,
    can: ["Read dashboard, devices, violations"],
  },
];

function RbacTab({ currentRole }: RbacTabProps): JSX.Element {
  return (
    <Card padding="md" className="mt-4">
      <CardHeader
        title="Role hierarchy"
        description={`Your current role is ${ROLE_LABELS[currentRole]} (level ${getRoleLevel(currentRole)}).`}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {RBAC_MATRIX.map((row) => (
          <Card
            key={row.role}
            padding="md"
            variant={row.role === currentRole ? "elevated" : "default"}
            className={
              row.role === currentRole
                ? "ring-2 ring-vg-primary-500"
                : undefined
            }
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge variant={ROLE_VARIANT[row.role]} size="sm">
                  {ROLE_LABELS[row.role]}
                </Badge>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Level {row.level}
                </span>
              </div>
              {row.role === currentRole ? (
                <Badge variant="success" size="sm" dot>
                  You
                </Badge>
              ) : null}
            </div>
            <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
              {row.can.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </Card>
  );
}

void TabsList;
void TabsTrigger;
void TabsPanel;
