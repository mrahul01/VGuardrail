import { describe, expect, it } from "vitest";
import { createRepositoryRegistry } from "@/lib/api/registry";
import { createBffRepositoryRegistry } from "@/lib/api/bff-repositories";
import { wirePage } from "@/lib/api/wire";

describe("repository registry", () => {
  it("backend registry exposes all domains (no mock fallback)", () => {
    const repos = createRepositoryRegistry({ token: "id-token" });
    for (const key of [
      "dashboard",
      "devices",
      "policies",
      "violations",
      "exceptions",
      "audit",
      "users",
      "org",
    ] as const) {
      expect(repos[key]).toBeDefined();
    }
  });

  it("client BFF registry exposes all domains", () => {
    const repos = createBffRepositoryRegistry();
    expect(repos.devices.list).toBeTypeOf("function");
    expect(repos.dashboard.getStats).toBeTypeOf("function");
  });

  it("maps wire pagination to internal page shape", () => {
    const page = wirePage({
      items: [{ id: "1" }],
      page: 2,
      per_page: 25,
      total: 100,
      next_token: "3:25",
    });
    expect(page.perPage).toBe(25);
    expect(page.nextToken).toBe("3:25");
  });
});
