import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role, UserSession } from "@/types/auth";

let session: UserSession;

// Cookie store: returns the current session JSON for any cookie name.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: JSON.stringify(session) })),
  })),
}));

// The BFF reads the ID token via getStoredSession to forward to the backend.
// In unit tests we stand in a fixed token so no real JWT verification runs.
vi.mock("@/lib/auth/session-store", () => ({
  getStoredSession: vi.fn(async () => ({
    accessToken: "access",
    idToken: "id-token",
    session,
  })),
}));

// Inline test double for the backend registry (replaces the deleted in-app
// mock repositories). It is ONLY a test seam — the application itself has no
// mock data path. It returns deterministic data so the BFF pipeline (RBAC,
// org-scoping, role-based serialization, pagination, validation) is exercised
// in isolation from the network.
function fakeList(query: { page: number; perPage: number }) {
  return {
    items: Array.from({ length: query.perPage }, (_, i) => ({
      device_id: `dev-${i}`,
      event_id: `evt-${i}`,
      exception_id: `exc-${i}`,
      id: `id-${i}`,
      hostname: `host-${i}`,
      matched_rule_id: "rule-1",
      severity: "high",
      decision: "block",
      status: "active",
      category: "secret",
      reason: "AWS access key detected in prompt.",
      email: `u${i}@corp.example.com`,
      role: "viewer",
    })),
    page: query.page,
    perPage: query.perPage,
    total: 50,
    nextToken: `${query.page + 1}:${query.perPage}`,
  };
}

function detail(extra: Record<string, unknown>) {
  return {
    device_id: "dev-0001",
    event_id: "evt-000001",
    exception_id: "exc-00001",
    hostname: "host-1",
    hostname_full: "host-1.corp.example.com",
    matched_rule_id: "rule-1",
    matched_rule: "Block secrets",
    severity: "high",
    decision: "block",
    status: "active",
    ...extra,
  };
}

vi.mock("@/lib/api/registry", () => ({
  createRepositoryRegistry: () => ({
    dashboard: { getStats: async () => ({ totalDevices: 1, activeDevices: 1, totalViolations24h: 0, violationsBySeverity: {}, violationsByCategory: [], events24h: 0, eventsByDecision: {}, policiesActive: 1, pendingExceptions: 0, recentViolations: [], recentDevices: [] }) },
    devices: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      get: async (id: string) => (id === "missing" ? null : detail({ device_id: id })),
      deactivate: async () => undefined,
      inventory: async (id: string) => ({
        device_id: id,
        collected_at_ms: 1_700_000_000_000,
        processes: [{ pid: 1, name: "launchd", user: "root", started_at_ms: 1_700_000_000_000, is_app: false }],
        extensions: [{ browser: "chrome", extension_id: "abc", name: "VGuardrail", version: "1.0.0" }],
      }),
      events: async (id: string, q: { page: number; perPage: number }) => ({
        items: [
          {
            event_id: "evt-dev-1",
            device_id: id,
            timestamp_ms: 1_700_000_000_000,
            decision: "block",
            risk_level: "high",
            event_type: "prompt_scan",
            category: "secret",
            reason: "AWS access key detected in prompt.",
          },
        ],
        page: q.page,
        perPage: q.perPage,
        total: 1,
        nextToken: null,
      }),
    },
    policies: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      get: async (id: string) => (id === "nope" ? null : detail({ version: 1, status: "published" })),
      listVersions: async () => [],
    },
    violations: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      get: async (id: string) => (id === "missing" ? null : detail({ event_id: id })),
    },
    exceptions: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      get: async (id: string) => (id === "missing" ? null : detail({ exception_id: id })),
      approve: async () => detail({ status: "approved" }),
      reject: async () => detail({ status: "rejected" }),
    },
    audit: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      get: async (id: string) => (id === "missing" ? null : detail({ event_id: id, ip_address: "1.2.3.4", user_agent: "ua", payload: "{}", chain_position: 1 })),
    },
    users: {
      list: async (q: { page: number; perPage: number }) => fakeList(q),
      invite: async (email: string, role: Role) => ({ id: "u-new", email, role, status: "invited", last_login_ms: null }),
      disable: async () => undefined,
    },
    org: {
      get: async () => ({ org_id: "org-default", org_name: "Acme Corp", default_policy_id: "p", enrollment_mode: "invite", data_retention_days: 90, email_alerts: true, slack_webhook_url: null }),
      update: async (patch: Record<string, unknown>) => ({ org_id: "org-default", org_name: "Acme Corp", default_policy_id: "p", enrollment_mode: "invite", data_retention_days: 90, email_alerts: true, slack_webhook_url: null, ...patch }),
    },
  }),
}));

function setRole(role: Role): void {
  session = {
    id: "u-test",
    email: "test@corp.example.com",
    role,
    orgId: "org-default",
    orgName: "Acme Corp",
    groups: [role],
  };
}

function req(path: string, init: ConstructorParameters<typeof NextRequest>[1] = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, init);
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

describe("BFF API infrastructure", () => {
  beforeEach(() => setRole("org_admin"));

  it("parses valid pagination and rejects invalid values", async () => {
    const { parsePagination } = await import("@/lib/api/pagination");
    expect(parsePagination(req("/api/policies?page=2&per_page=5"))).toMatchObject({
      page: 2,
      perPage: 5,
    });
    expect(() => parsePagination(req("/api/policies?page=0"))).toThrow("page must be between");
    expect(() => parsePagination(req("/api/policies?per_page=500"))).toThrow("per_page must be between");
  });

  it("enforces RBAC for read-only roles", async () => {
    const { authorizeRoute } = await import("@/lib/auth/rbac-middleware");
    const { extractRequestContext } = await import("@/lib/api/request-context");
    setRole("viewer");
    const context = await extractRequestContext(req("/api/settings"));
    expect(() => authorizeRoute(context, "PATCH", "/api/settings")).toThrow("manage:settings");
  });
});

describe("BFF routes", () => {
  beforeEach(() => setRole("org_admin"));

  it("strips matched_rule_id for viewers", async () => {
    setRole("viewer");
    const { GET } = await import("@/app/api/violations/route");
    const response = await GET(req("/api/violations?per_page=3"), { params: {} });
    expect(response.status).toBe(200);
    const body = (await json(response)) as { items: Array<{ matched_rule_id: string | null }> };
    expect(body.items).toHaveLength(3);
    expect(body.items.every((item) => item.matched_rule_id === null)).toBe(true);
  });

  it("validates the violation category filter", async () => {
    const { GET } = await import("@/app/api/violations/route");
    const invalid = await GET(req("/api/violations?category=bogus"), { params: {} });
    expect(invalid.status).toBe(400);

    const valid = await GET(req("/api/violations?category=company_confidential&per_page=2"), { params: {} });
    expect(valid.status).toBe(200);
    const body = (await json(valid)) as { items: Array<{ category: string | null; reason: string | null }> };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.category).toBe("secret");
    expect(body.items[0]?.reason).toBe("AWS access key detected in prompt.");
  });

  it("rejects role hierarchy violations", async () => {
    setRole("org_admin");
    const { POST } = await import("@/app/api/users/route");
    const response = await POST(
      req("/api/users", {
        method: "POST",
        body: JSON.stringify({ email: "new@corp.example.com", role: "super_admin", org_id: "evil" }),
      }),
      { params: {} }
    );
    expect(response.status).toBe(403);
    await expect(json(response)).resolves.toMatchObject({ error: { code: "forbidden" } });
  });

  it("validates audit date ranges", async () => {
    setRole("auditor");
    const { GET } = await import("@/app/api/audit/route");
    const response = await GET(
      req("/api/audit?from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z"),
      { params: {} }
    );
    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({ error: { code: "bad_request" } });
  });

  it("paginates policies", async () => {
    const { GET } = await import("@/app/api/policies/route");
    const response = await GET(req("/api/policies?page=1&per_page=2"), { params: {} });
    expect(response.status).toBe(200);
    const body = (await json(response)) as { items: unknown[]; per_page: number; next_token: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.per_page).toBe(2);
    expect(body.next_token).toBe("2:2");
  });

  it("paginates exceptions", async () => {
    const { GET } = await import("@/app/api/exceptions/route");
    const response = await GET(req("/api/exceptions?page=1&per_page=4"), { params: {} });
    expect(response.status).toBe(200);
    const body = (await json(response)) as { items: unknown[]; per_page: number };
    expect(body.items).toHaveLength(4);
    expect(body.per_page).toBe(4);
  });

  it("returns device detail", async () => {
    const { GET } = await import("@/app/api/devices/[id]/route");
    const response = await GET(req("/api/devices/dev-0001"), { params: { id: "dev-0001" } });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      device_id: "dev-0001",
      hostname_full: expect.any(String),
    });
  });

  it("returns viewer-safe violation detail", async () => {
    setRole("viewer");
    const { GET } = await import("@/app/api/violations/[id]/route");
    const response = await GET(req("/api/violations/evt-000001"), { params: { id: "evt-000001" } });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      event_id: "evt-000001",
      matched_rule_id: null,
      matched_rule: null,
    });
  });

  it("paginates devices and validates filters", async () => {
    const { GET } = await import("@/app/api/devices/route");
    const response = await GET(req("/api/devices?page=1&per_page=2&status=active"), { params: {} });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ per_page: 2 });

    const invalid = await GET(req("/api/devices?status=missing"), { params: {} });
    expect(invalid.status).toBe(400);
  });

  it("handles device deactivate authorization", async () => {
    setRole("viewer");
    const { DELETE } = await import("@/app/api/devices/[id]/route");
    const denied = await DELETE(req("/api/devices/dev-0001", { method: "DELETE" }), { params: { id: "dev-0001" } });
    expect(denied.status).toBe(403);

    setRole("org_admin");
    const allowed = await DELETE(req("/api/devices/dev-0001", { method: "DELETE" }), { params: { id: "dev-0001" } });
    expect(allowed.status).toBe(200);
  });

  it("returns policy detail and not found envelopes", async () => {
    const { GET } = await import("@/app/api/policies/[id]/route");
    const found = await GET(req("/api/policies/pol-1"), { params: { id: "pol-1" } });
    expect(found.status).toBe(200);
    const missing = await GET(req("/api/policies/nope"), { params: { id: "nope" } });
    expect(missing.status).toBe(404);
  });

  it("returns exception detail and approves exceptions", async () => {
    const detailRoute = await import("@/app/api/exceptions/[id]/route");
    const found = await detailRoute.GET(req("/api/exceptions/exc-00001"), { params: { id: "exc-00001" } });
    expect(found.status).toBe(200);
    const approved = await detailRoute.POST(
      req("/api/exceptions/exc-00001", { method: "POST", body: JSON.stringify({ action: "approve" }) }),
      { params: { id: "exc-00001" } }
    );
    expect(approved.status).toBe(200);
    const rejectedBad = await detailRoute.POST(
      req("/api/exceptions/exc-00001", { method: "POST", body: JSON.stringify({ action: "reject" }) }),
      { params: { id: "exc-00001" } }
    );
    expect(rejectedBad.status).toBe(400);
  });

  it("returns audit detail and dashboard stats", async () => {
    setRole("auditor");
    const audit = await import("@/app/api/audit/[id]/route");
    const auditResponse = await audit.GET(req("/api/audit/aud-000001"), { params: { id: "aud-000001" } });
    expect(auditResponse.status).toBe(200);

    const dashboard = await import("@/app/api/dashboard/route");
    const dashResponse = await dashboard.GET(req("/api/dashboard"), { params: {} });
    expect(dashResponse.status).toBe(200);
  });

  it("handles users and settings routes", async () => {
    const users = await import("@/app/api/users/route");
    const listed = await users.GET(req("/api/users?page=1&per_page=2"), { params: {} });
    expect(listed.status).toBe(200);
    const invited = await users.POST(
      req("/api/users", { method: "POST", body: JSON.stringify({ email: "viewer@corp.example.com", role: "viewer", org_id: "ignored" }) }),
      { params: {} }
    );
    expect(invited.status).toBe(201);

    const settings = await import("@/app/api/settings/route");
    const getSettings = await settings.GET(req("/api/settings"), { params: {} });
    expect(getSettings.status).toBe(200);
    const patchSettings = await settings.PATCH(
      req("/api/settings", { method: "PATCH", body: JSON.stringify({ org_id: "evil", org_name: "Updated" }) }),
      { params: {} }
    );
    expect(patchSettings.status).toBe(200);
    await expect(json(patchSettings)).resolves.toMatchObject({ org_id: "org-default", org_name: "Updated" });
  });

  it("handles user disable route", async () => {
    const { DELETE } = await import("@/app/api/users/[id]/route");
    const response = await DELETE(req("/api/users/u-001", { method: "DELETE" }), { params: { id: "u-001" } });
    expect(response.status).toBe(204);
  });
});
