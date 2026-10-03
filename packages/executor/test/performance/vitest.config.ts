import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const promoted = fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const escaped = promoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig({
  plugins: [{ name: "core-performance-host-boundary", enforce: "pre", load(id) {
    const normalized = id.replaceAll("\\", "/");
    if (normalized.includes("/flarex-backend/") || /\/(?:miniflare|workerd)(?:\/|@)/.test(normalized) ||
      normalized === "cloudflare:workers") throw new Error(`Core performance imported a host module: ${normalized}`);
  }, resolveId(source) {
    if (source === "cloudflare:workers" || /^(?:miniflare|workerd)(?:\/|$)/.test(source))
      throw new Error(`Core performance imported a host module: ${source}`);
  } }],
  test: { include: ["packages/executor/test/performance/corePerformance.postgres.test.ts"],
    fsModuleCache: true,
    server: { deps: { external: [new RegExp(`^${escaped}/medusa-[^/]+/dist/`)] } },
    fileParallelism: false, maxWorkers: 1, hookTimeout: 240_000, testTimeout: 240_000,
    env: { FLAREX_TEST_DRIVER: "postgres", MEDUSA_MODULE_TEST_PERSISTENCE: "mikroorm" } },
});
