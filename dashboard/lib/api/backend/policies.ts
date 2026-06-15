import type { Decision, PolicyStatus, PolicySummary } from "@/types";
import type { PolicyDetail, PolicyRepository, PolicyRule } from "@/lib/api/types";
import { backendFetch } from "@/lib/api/client";
import { backendGetOrNull, mapPage, type RawPage } from "@/lib/api/backend/_map";

// ---------------------------------------------------------------------------
// Wire shapes (Rust backend, snake_case)
// ---------------------------------------------------------------------------

/** Policy summary as emitted by `GET /admin/policies`. */
interface RawPolicySummary {
  readonly version: number;
  /** Stored status: `published` | `archived` | `draft`. */
  readonly status: string;
  readonly published_at_ms: number | null;
  readonly policy_id?: string;
  readonly name?: string;
  readonly default_action?: string;
  readonly rule_count?: number;
  readonly created_at_ms?: number | null;
  readonly org_id?: string;
}

/** Policy detail as emitted by `GET /admin/policies/:version`. */
interface RawPolicyDetail extends RawPolicySummary {
  readonly bundle_json?: string;
  readonly previous_version?: number | null;
}

// ---------------------------------------------------------------------------
// Status / shape translation
//
// The backend stores lifecycle statuses (`published`/`archived`); the
// dashboard's PolicyStatus vocabulary is `active`/`superseded`/`draft`/
// `rollback`. Translate in both directions so filters and badges line up.
// ---------------------------------------------------------------------------

const STATUS_FROM_BACKEND: Record<string, PolicyStatus> = {
  published: "active",
  active: "active",
  archived: "superseded",
  superseded: "superseded",
  rollback: "rollback",
  draft: "draft",
};

const STATUS_TO_BACKEND: Record<string, string> = {
  active: "published",
  superseded: "archived",
  rollback: "rollback",
  draft: "draft",
};

const DECISIONS: ReadonlySet<string> = new Set(["allow", "warn", "block"]);

function toDecision(value: string | undefined): Decision {
  return value && DECISIONS.has(value) ? (value as Decision) : "warn";
}

function toIso(ms: number | null | undefined): string | null {
  return typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;
}

function mapSummary(raw: RawPolicySummary): PolicySummary {
  // The version is the unique, routable identifier (`/admin/policies/:version`);
  // stored policy_id values can repeat across versions, so don't key on them.
  const createdAt =
    toIso(raw.created_at_ms) ?? toIso(raw.published_at_ms) ?? new Date(0).toISOString();
  return {
    policy_id: String(raw.version),
    version: raw.version,
    name: raw.name || `Policy v${raw.version}`,
    status: STATUS_FROM_BACKEND[raw.status] ?? "draft",
    default_action: toDecision(raw.default_action),
    org_id: raw.org_id ?? "",
    created_at: createdAt,
    published_at: raw.status === "draft" ? null : toIso(raw.published_at_ms),
    rule_count: raw.rule_count ?? 0,
  };
}

/** Best-effort extraction of display rules from a signed policy bundle. */
function rulesFromBundle(bundleJson: string | undefined): PolicyRule[] {
  if (!bundleJson) return [];
  let bundle: unknown;
  try {
    bundle = JSON.parse(bundleJson);
  } catch {
    return [];
  }
  const rules = (bundle as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) return [];
  return rules.map((r, i): PolicyRule => {
    const rule = r as Record<string, unknown>;
    const ruleId =
      (typeof rule["rule_id"] === "string" && rule["rule_id"]) ||
      (typeof rule["id"] === "string" && rule["id"]) ||
      `rule-${i + 1}`;
    const conditions =
      typeof rule["conditions"] === "string"
        ? rule["conditions"]
        : JSON.stringify(rule["when"] ?? rule["conditions"] ?? rule["match"] ?? {});
    return {
      rule_id: ruleId,
      description:
        (typeof rule["description"] === "string" && rule["description"]) ||
        (typeof rule["name"] === "string" && rule["name"]) ||
        ruleId,
      action: toDecision(typeof rule["action"] === "string" ? rule["action"] : undefined),
      conditions,
      enabled: rule["enabled"] !== false,
    };
  });
}

function mapDetail(raw: RawPolicyDetail): PolicyDetail {
  const bundle = ((): Record<string, unknown> => {
    try {
      return raw.bundle_json ? JSON.parse(raw.bundle_json) : {};
    } catch {
      return {};
    }
  })();
  const rules = rulesFromBundle(raw.bundle_json);
  const summary = mapSummary({
    ...raw,
    name: raw.name ?? (typeof bundle["name"] === "string" ? bundle["name"] : undefined),
    default_action:
      raw.default_action ??
      (typeof bundle["default_action"] === "string"
        ? (bundle["default_action"] as string)
        : undefined),
    rule_count: raw.rule_count || rules.length,
  });
  return {
    ...summary,
    rules,
    notes: typeof bundle["notes"] === "string" ? (bundle["notes"] as string) : "",
    created_by:
      typeof bundle["created_by"] === "string" ? (bundle["created_by"] as string) : "system",
    supersedes_version: raw.previous_version || null,
    superseded_by_version: null,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const createBackendPolicyRepository = (token?: string): PolicyRepository => ({
  list: async (query, filters) => {
    const page = mapPage<RawPolicySummary>(
      await backendFetch<RawPage<RawPolicySummary>>(
        `/admin/policies?${new URLSearchParams({
          page: String(query.page),
          per_page: String(query.perPage),
          ...(query.search ? { search: query.search } : {}),
          ...(query.sortBy ? { sort_by: query.sortBy } : {}),
          ...(query.sortDir ? { sort_dir: query.sortDir } : {}),
          ...(filters?.status
            ? { status: STATUS_TO_BACKEND[filters.status] ?? filters.status }
            : {}),
        }).toString()}`,
        { token },
      ),
    );
    return { ...page, items: page.items.map(mapSummary) };
  },
  get: async (policyId) => {
    const raw = await backendGetOrNull<RawPolicyDetail>(
      `/admin/policies/${encodeURIComponent(policyId)}`,
      token,
    );
    return raw ? mapDetail(raw) : null;
  },
  listVersions: async (policyName) => {
    const raw = await backendFetch<RawPage<RawPolicySummary> | readonly RawPolicySummary[]>(
      `/admin/policies/${encodeURIComponent(policyName)}/versions`,
      { token },
    );
    const items = Array.isArray(raw)
      ? raw
      : mapPage<RawPolicySummary>(raw as RawPage<RawPolicySummary>).items;
    return items.map(mapSummary);
  },
});
