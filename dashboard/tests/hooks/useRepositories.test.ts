import { describe, expect, it } from "vitest";
import { createRepositoryRegistry } from "@/lib/api/registry";

describe("useRepositories wiring", () => {
  it("backend registry exposes all domains", () => {
    const repos = createRepositoryRegistry({ token: "test-token" });
    expect(repos.dashboard).toBeDefined();
    expect(repos.devices).toBeDefined();
    expect(repos.policies).toBeDefined();
    expect(repos.violations).toBeDefined();
    expect(repos.exceptions).toBeDefined();
    expect(repos.audit).toBeDefined();
    expect(repos.users).toBeDefined();
    expect(repos.org).toBeDefined();
  });
});
