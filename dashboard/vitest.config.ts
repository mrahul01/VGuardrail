import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/e2e/**"],
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      include: [
        "lib/api/pagination.ts",
        "lib/api/response.ts",
        "lib/api/errors.ts",
        "lib/api/request-context.ts",
        "lib/auth/rbac-middleware.ts",
        "app/api/**/*.ts",
      ],
      exclude: ["app/api/org/route.ts", "app/api/dashboard/stats/route.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
