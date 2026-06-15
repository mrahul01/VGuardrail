import type {
  OrgSettings,
  OrgSettingsRepository,
  DashboardRepository,
} from "@/lib/api/types";
import type {
  AuditEvent,
  CategoryCount,
  Decision,
  Device,
  Severity,
  Violation,
} from "@/types";
import { backendFetch } from "@/lib/api/client";
import type { RawPage } from "@/lib/api/backend/_map";

export const createBackendSettingsRepository = (token?: string): OrgSettingsRepository => ({
  // Backend /admin/settings already matches the OrgSettings shape (snake_case).
  get: () => backendFetch<OrgSettings>("/admin/settings", { token }),
  update: (patch) =>
    backendFetch<OrgSettings>("/admin/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
      token,
    }),
});

/** Raw counters from GET /admin/stats. */
interface RawStats {
  readonly total_devices?: number;
  readonly active_devices?: number;
  readonly violations_24h?: number;
  readonly events_24h?: number;
  readonly policies_active?: number;
  readonly pending_exceptions?: number;
  readonly violations_by_category?: ReadonlyArray<{
    readonly category?: string;
    readonly warn?: number;
    readonly block?: number;
  }>;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;
const RECENT_LIMIT = 5;
// Bounded page size for the list endpoints we aggregate over. Large enough to
// give accurate local/dev counts without unbounded fetches in production.
const AGGREGATE_PAGE_SIZE = 200;

function listPath(base: string): string {
  return `${base}?${new URLSearchParams({
    page: "1",
    per_page: String(AGGREGATE_PAGE_SIZE),
  }).toString()}`;
}

/** Warn/block counts per category over the last 7 days, busiest first. */
function aggregateByCategory(
  events: ReadonlyArray<{
    readonly timestamp_ms: number;
    readonly decision: string;
    readonly category?: string | null;
  }>,
): CategoryCount[] {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const counts = new Map<string, { warn: number; block: number }>();
  for (const e of events) {
    if (e.timestamp_ms < cutoff || !e.category) continue;
    if (e.decision !== "warn" && e.decision !== "block") continue;
    const entry = counts.get(e.category) ?? { warn: 0, block: 0 };
    if (e.decision === "warn") entry.warn += 1;
    else entry.block += 1;
    counts.set(e.category, entry);
  }
  return [...counts.entries()]
    .map(([category, { warn, block }]) => ({ category, warn, block }))
    .sort((a, b) => b.warn + b.block - (a.warn + a.block));
}

export const createBackendDashboardRepository = (token?: string): DashboardRepository => ({
  // The backend's GET /admin/stats only emits scalar counters — and in local
  // dev (VG_DEV_CLAIMS) it short-circuits to all-zeros to avoid depending on
  // DynamoDB GSIs. As its own NOTE anticipated, we compose the full dashboard
  // view (24h counts, severity/decision breakdowns, recent lists) BFF-side
  // from the list endpoints, which are org-scoped and populated by the
  // connectors. Scalar counters are used only as a floor for policy/exception
  // counts we don't otherwise enumerate here.
  getStats: async () => {
    const cutoff = Date.now() - ONE_DAY_MS;

    const [scalar, devicesPage, violationsPage, auditPage, policiesPage, exceptionsPage] =
      await Promise.all([
        backendFetch<RawStats>("/admin/stats", { token }).catch(() => ({} as RawStats)),
        backendFetch<RawPage<Device>>(listPath("/admin/devices"), { token }).catch(
          () => ({ items: [] }) as RawPage<Device>,
        ),
        backendFetch<RawPage<Violation>>(listPath("/admin/violations"), { token }).catch(
          () => ({ items: [] }) as RawPage<Violation>,
        ),
        backendFetch<RawPage<AuditEvent>>(listPath("/admin/audit"), { token }).catch(
          () => ({ items: [] }) as RawPage<AuditEvent>,
        ),
        backendFetch<RawPage<{ status?: string }>>(listPath("/admin/policies"), { token }).catch(
          () => ({ items: [] }) as RawPage<{ status?: string }>,
        ),
        backendFetch<RawPage<{ status?: string }>>(listPath("/admin/exceptions"), { token }).catch(
          () => ({ items: [] }) as RawPage<{ status?: string }>,
        ),
      ]);

    const devices = devicesPage.items ?? [];
    const violations = violationsPage.items ?? [];
    const auditEvents = auditPage.items ?? [];
    const policies = policiesPage.items ?? [];
    const exceptions = exceptionsPage.items ?? [];

    const violations24h = violations.filter((v) => v.timestamp_ms >= cutoff);
    const events24h = auditEvents.filter((e) => e.timestamp_ms >= cutoff);

    const violationsBySeverity: Record<Severity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    for (const v of violations24h) {
      const sev = v.risk_level as Severity;
      if (sev in violationsBySeverity) violationsBySeverity[sev] += 1;
    }

    const eventsByDecision: Record<Decision, number> = {
      allow: 0,
      warn: 0,
      block: 0,
    };
    for (const e of events24h) {
      if (e.decision in eventsByDecision) eventsByDecision[e.decision] += 1;
    }

    // Warn/block counts per policy category over the last 7 days. Prefer the
    // backend's aggregated stats; when those are empty (e.g. dev-mode zeros),
    // compose the breakdown BFF-side from the list endpoints, like the other
    // breakdowns above. Violations (block) and audit events (warn + block)
    // overlap, so aggregate from audit events when available and fall back to
    // the violations list otherwise.
    const scalarByCategory: CategoryCount[] = (scalar.violations_by_category ?? [])
      .filter((c) => c.category)
      .map((c) => ({ category: c.category ?? "", warn: c.warn ?? 0, block: c.block ?? 0 }));
    const violationsByCategory =
      scalarByCategory.length > 0
        ? scalarByCategory
        : aggregateByCategory(auditEvents.length > 0 ? auditEvents : violations);

    const recentViolations = [...violations]
      .sort((a, b) => b.timestamp_ms - a.timestamp_ms)
      .slice(0, RECENT_LIMIT);
    const recentDevices = [...devices]
      .sort((a, b) => (b.last_seen_ms ?? 0) - (a.last_seen_ms ?? 0))
      .slice(0, RECENT_LIMIT);

    return {
      totalDevices: devicesPage.total ?? devices.length,
      activeDevices: devices.filter((d) => d.status === "active").length,
      totalViolations24h: violations24h.length,
      violationsBySeverity,
      violationsByCategory,
      events24h: events24h.length,
      eventsByDecision,
      policiesActive:
        policies.filter((p) => p.status === "published" || p.status === "active").length ||
        (scalar.policies_active ?? 0),
      pendingExceptions:
        exceptions.filter((e) => e.status === "pending").length ||
        (scalar.pending_exceptions ?? 0),
      recentViolations,
      recentDevices,
    };
  },
});
