import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const promoted = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const escaped = promoted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default defineConfig({
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("../flarex-backend/test/support/cloudflareWorkersStub.ts", import.meta.url)) } },
  test: { globals: true, include: ["benchmarks/core-performance/mixed-native-read/scenario.postgres.test.ts"],
    server: { deps: { external: [new RegExp(`^${escaped}/medusa-[^/]+/dist/`)] } },
    fileParallelism: false, maxWorkers: 1, hookTimeout: 240_000, testTimeout: 600_000,
    env: { FLAREX_TEST_DRIVER: "postgres", MEDUSA_MODULE_TEST_PERSISTENCE: "mikroorm" } },
});
