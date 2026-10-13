import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";
import { cycleAttributionPlugin } from "./cycleTransform.ts";

const require = createRequire(import.meta.url);
export default defineConfig({ ...base,
  // The prototype observer and executing business must use the same pinned Effect.
  resolve: { alias: [{ find: /^effect$/, replacement: require.resolve("effect") }] },
  plugins: process.env.FLAREX_MEASUREMENT_ATTRIBUTION === "cycles" && process.env.FLAREX_MEASUREMENT_CYCLE_DETAIL === "generators"
    ? [cycleAttributionPlugin()] : [],
  test: { ...base.test, include: ["packages/executor/test/performance/measurement/attribution.integration.test.ts"],
    testTimeout: 600_000 },
});
