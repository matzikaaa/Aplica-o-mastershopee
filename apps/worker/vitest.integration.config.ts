import { defineConfig } from "vitest/config";

// Real Postgres + Redis required (see apps/worker/.env). Kept separate from
// the default `pnpm test` so CI/dev environments without that infra
// available aren't broken by it — run explicitly with `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 20000,
    // Alert-check tests share the isActive AlertRule table across the whole
    // DB (that's how the real job works — it's not workspace-scoped), so
    // running suites in parallel risks cross-test interference.
    fileParallelism: false,
  },
});
