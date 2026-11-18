import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const promotedPackages = fileURLToPath(new URL("../", import.meta.url)).replaceAll("\\", "/").replace(/\/$/, "");
const escapedPromotedPackages = promotedPackages.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const promotedBuiltCommonJs = new RegExp(`^${escapedPromotedPackages}/medusa-[^/]+/dist/`);

// Separate from the full promoted-upstream coverage reporter. Both runners use
// Vitest globals, while native require resolution stays inside the pinned tree.
export default defineConfig({
  test: { globals: true, include: ["benchmarks/core-performance/native-retrieval/scenario.ts"],
    // Native pg-god's tslib publishes legacy helpers on globalThis. Inlining
    // generated CommonJS under Vitest's arrow evaluator changes top-level this
    // and can select those globals instead of the module's own modern helpers.
    // Keep actual promoted built CJS in its Node module receiver and own tree.
    server: { deps: { external: [promotedBuiltCommonJs] } },
    maxWorkers: 1, fileParallelism: false,
    env: { FLAREX_TEST_DRIVER: "postgres", MEDUSA_MODULE_TEST_PERSISTENCE: "mikroorm" },
    hookTimeout: 240_000, testTimeout: 600_000 },
});
