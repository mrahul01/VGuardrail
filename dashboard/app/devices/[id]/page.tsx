"use client";

// Device detail: quick facts, running processes/apps, installed browser
// extensions, and the device's audit-event timeline (prompts → decisions).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { Table, type ColumnDef } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useRepositories } from "@/hooks/useRepositories";
import { formatDateTime, formatRelativeTime } from "@/lib/utils/format";
import { categoryLabel } from "@/types";
import type {
  BrowserExtension,
  DeviceEvent,
  DeviceInventory,
  DeviceProcess,
} from "@/types";
import type { DeviceDetail, Page } from "@/lib/api";

/** "2h 14m" style duration for the processes' "active for" column. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "<1m";
}

const decisionBadge: Record<string, "success" | "warning" | "error" | "default"> = {
  allow: "success",
  warn: "warning",
  block: "error",
};

const statusBadge: Record<string, "success" | "default" | "error"> = {
  active: "success",
  inactive: "default",
  deactivated: "error",
};

export default function DeviceDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const deviceId = decodeURIComponent(params?.id ?? "");
  const repos = useRepositories();

  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [deviceLoading, setDeviceLoading] = useState<boolean>(true);
  const [inventory, setInventory] = useState<DeviceInventory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDeviceLoading(true);
    repos.devices
      .get(deviceId)
      .then((d) => {
        if (!cancelled) {
          setDevice(d);
          setDeviceLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setDeviceLoading(false);
      });
    repos.devices
      .inventory(deviceId)
      .then((inv) => {
        if (!cancelled) setInventory(inv);
      })
      .catch(() => {
        if (!cancelled) setInventory({ device_id: deviceId, collected_at_ms: 0, processes: [], extensions: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [repos, deviceId]);

  return (
    <DashboardLayout>
      <PageHeader
        title={device?.hostname || deviceId}
        description={`Device ${deviceId}`}
        actions={
          <Link
            href="/devices"
            className="text-sm text-vg-primary-600 hover:underline"
          >
            ← All devices
          </Link>
        }
      />

      <div className="space-y-4">
        <Card padding="md">
          {deviceLoading ? (
            <div className="space-y-3">
              <Skeleton height={20} width="40%" />
              <Skeleton height={64} />
            </div>
          ) : device ? (
            <DeviceFacts device={device} />
          ) : (
            <EmptyState
              title="Device not found"
              description="This device is not registered in the current organization."
              variant="no-data"
            />
          )}
        </Card>

        <Card padding="md">
          <Tabs
            defaultActiveId="processes"
            items={[
              {
                id: "processes",
                label: `Processes${
                  inventory
                    ? ` (${inventory.processes.filter((p) => p.ai_category).length} AI / ${inventory.processes.length})`
                    : ""
                }`,
                content: <ProcessesTab inventory={inventory} />,
              },
              {
                id: "extensions",
                label: `Extensions${inventory ? ` (${inventory.extensions.length})` : ""}`,
                content: <ExtensionsTab inventory={inventory} />,
              },
              {
                id: "events",
                label: "Events",
                content: <EventsTab deviceId={deviceId} />,
              },
            ]}
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

// ── Quick facts ────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value ?? "—"}</dd>
    </div>
  );
}

function DeviceFacts({ device }: { device: DeviceDetail }): JSX.Element {
  return (
    <div>
      <CardHeader
        title="Quick facts"
        action={
          <Badge variant={statusBadge[device.status] ?? "default"} size="sm" dot>
            {device.status}
          </Badge>
        }
      />
      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
        <Fact label="Hostname" value={device.hostname_full || device.hostname} />
        <Fact label="User" value={device.last_user || "—"} />
        <Fact label="Platform" value={device.platform} />
        <Fact label="Model" value={device.model || "—"} />
        <Fact label="OS" value={device.os_version || "—"} />
        <Fact
          label="IP address"
          value={
            <span className="font-mono text-xs">{device.ip_address || "—"}</span>
          }
        />
        <Fact label="Agent" value={`v${device.agent_version}`} />
        <Fact label="Enrolled by" value={device.enrolled_by || "—"} />
        <Fact
          label="Registered"
          value={
            device.registered_at_ms ? formatDateTime(device.registered_at_ms) : "—"
          }
        />
        <Fact
          label="Last seen"
          value={
            device.last_seen_ms ? (
              <span title={formatDateTime(device.last_seen_ms)}>
                {formatRelativeTime(device.last_seen_ms)}
              </span>
            ) : (
              "—"
            )
          }
        />
        <Fact
          label="Chain"
          value={<Badge size="sm">{device.chain_status ?? "unknown"}</Badge>}
        />
        <Fact label="Violations 24h" value={String(device.violation_count_24h ?? 0)} />
      </dl>
    </div>
  );
}

// ── Processes ──────────────────────────────────────────────────────────────

function InventoryFreshness({ inventory }: { inventory: DeviceInventory }): JSX.Element | null {
  if (!inventory.collected_at_ms) return null;
  return (
    <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
      Snapshot collected {formatRelativeTime(inventory.collected_at_ms)} (
      {formatDateTime(inventory.collected_at_ms)})
    </p>
  );
}

/** Display order + labels for the AI inventory groups. */
const AI_GROUPS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "ai_ide", label: "AI IDEs" },
  { key: "ai_cli", label: "AI CLIs" },
  { key: "ai_desktop", label: "Desktop AI apps" },
  { key: "browser", label: "Browsers (AI web access)" },
];

function ProcessesTab({ inventory }: { inventory: DeviceInventory | null }): JSX.Element {
  const [now] = useState<number>(() => Date.now());
  const [showAll, setShowAll] = useState<boolean>(false);
  const columns: ColumnDef<DeviceProcess>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        accessor: (p) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
            {p.is_app ? (
              <Badge variant="info" size="sm">
                App
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: "status",
        header: "Status",
        accessor: (p) =>
          (p.status ?? "running") === "running" ? (
            <Badge variant="success" size="sm" dot>
              running
            </Badge>
          ) : (
            <Badge variant="default" size="sm">
              installed
            </Badge>
          ),
      },
      {
        key: "pid",
        header: "PID",
        accessor: (p) =>
          p.pid > 0 ? <span className="font-mono text-xs">{p.pid}</span> : "—",
      },
      {
        key: "user",
        header: "User",
        accessor: (p) => p.user ?? "—",
      },
      {
        key: "started",
        header: "Started",
        accessor: (p) =>
          p.started_at_ms ? formatDateTime(p.started_at_ms) : "—",
      },
      {
        key: "active",
        header: "Active for",
        accessor: (p) =>
          p.started_at_ms ? formatDuration(now - p.started_at_ms) : "—",
      },
      {
        key: "command",
        header: "Command",
        accessor: (p) =>
          p.command ? (
            <span
              className="font-mono text-xs text-gray-600 dark:text-gray-400 block max-w-md truncate"
              title={p.command}
            >
              {p.command}
            </span>
          ) : (
            "—"
          ),
      },
    ],
    [now]
  );

  if (!inventory) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={24} />
        ))}
      </div>
    );
  }
  if (inventory.processes.length === 0) {
    return (
      <EmptyState
        title="No process inventory yet"
        description="The device agent has not reported a process snapshot. It uploads one at registration and on every heartbeat."
        variant="no-data"
        size="sm"
      />
    );
  }

  const aiItems = inventory.processes.filter((p) => p.ai_category);
  // Old snapshots carry no AI tags — fall back to the full table.
  const aiView = !showAll && aiItems.length > 0;
  const keyExtractor = (p: DeviceProcess): string => `${p.pid}-${p.name}-${p.status ?? "running"}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <InventoryFreshness inventory={inventory} />
        {aiItems.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {aiView
              ? `Show all processes (${inventory.processes.length})`
              : `Show AI only (${aiItems.length})`}
          </Button>
        ) : null}
      </div>
      {aiView ? (
        <div className="space-y-6">
          {AI_GROUPS.map((group) => {
            const items = aiItems.filter((p) => p.ai_category === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                  {group.label} ({items.length})
                </h4>
                <Table columns={columns} data={items} keyExtractor={keyExtractor} hoverable />
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          {aiItems.length === 0 ? (
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              This snapshot predates AI tagging — showing all processes.
            </p>
          ) : null}
          <Table
            columns={columns}
            data={inventory.processes}
            keyExtractor={keyExtractor}
            hoverable
          />
        </div>
      )}
    </div>
  );
}

// ── Extensions ─────────────────────────────────────────────────────────────

function ExtensionsTab({ inventory }: { inventory: DeviceInventory | null }): JSX.Element {
  const columns: ColumnDef<BrowserExtension>[] = useMemo(
    () => [
      {
        key: "browser",
        header: "Browser",
        accessor: (e) => <span className="capitalize">{e.browser}</span>,
      },
      {
        key: "name",
        header: "Extension",
        accessor: (e) => (
          <span className="font-medium text-gray-900 dark:text-gray-100">{e.name}</span>
        ),
      },
      {
        key: "version",
        header: "Version",
        accessor: (e) => e.version ?? "—",
      },
      {
        key: "id",
        header: "ID",
        accessor: (e) => (
          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
            {e.extension_id ?? "—"}
          </span>
        ),
      },
    ],
    []
  );

  if (!inventory) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={24} />
        ))}
      </div>
    );
  }
  if (inventory.extensions.length === 0) {
    return (
      <EmptyState
        title="No browser extensions reported"
        description="Either the device has no extensions installed or the agent has not reported an inventory snapshot yet."
        variant="no-data"
        size="sm"
      />
    );
  }
  return (
    <div>
      <InventoryFreshness inventory={inventory} />
      <Table
        columns={columns}
        data={inventory.extensions}
        keyExtractor={(e) => `${e.browser}-${e.extension_id ?? e.name}`}
        hoverable
      />
    </div>
  );
}

// ── Events ─────────────────────────────────────────────────────────────────

function EventsTab({ deviceId }: { deviceId: string }): JSX.Element {
  const repos = useRepositories();
  const [page, setPage] = useState<number>(1);
  const [perPage, setPerPage] = useState<number>(10);
  const [data, setData] = useState<Page<DeviceEvent> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repos.devices
      .events(deviceId, { page, perPage })
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
  }, [repos, deviceId, page, perPage]);

  const columns: ColumnDef<DeviceEvent>[] = useMemo(
    () => [
      {
        key: "time",
        header: "Time",
        accessor: (e) => (
          <span title={formatDateTime(e.timestamp_ms)}>
            {formatRelativeTime(e.timestamp_ms)}
          </span>
        ),
      },
      {
        key: "type",
        header: "Type",
        accessor: (e) => (
          <span className="text-sm text-gray-700 dark:text-gray-300">{e.event_type}</span>
        ),
      },
      {
        key: "decision",
        header: "Decision",
        accessor: (e) => (
          <Badge variant={decisionBadge[e.decision] ?? "default"} size="sm" dot>
            {e.decision}
          </Badge>
        ),
      },
      {
        key: "category",
        header: "Category",
        accessor: (e) => categoryLabel(e.category),
      },
      {
        key: "reason",
        header: "Reason",
        accessor: (e) => (
          <span className="text-sm text-gray-700 dark:text-gray-300">
            {e.reason ?? "—"}
          </span>
        ),
      },
    ],
    []
  );

  if (loading || !data) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={24} />
        ))}
      </div>
    );
  }
  if (data.items.length === 0) {
    return (
      <EmptyState
        title="No events for this device"
        description="Prompt scans from this device will appear here with their decision, category, and reason."
        variant="no-data"
        size="sm"
      />
    );
  }
  return (
    <div>
      <Table
        columns={columns}
        data={data.items}
        keyExtractor={(e) => e.event_id}
        hoverable
      />
      <div className="pt-3 border-t border-gray-200 dark:border-gray-700 mt-3">
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
    </div>
  );
}
