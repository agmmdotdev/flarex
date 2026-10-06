import { defineConfig } from "vitest/config";

/** Pure measurement selection/lifetime checks. An exact include avoids archived
 * validation snapshots and other suites matching Vitest's CLI substring filter. */
export default defineConfig({ test: {
  include: ["scripts/run-core-performance.test.js", "packages/executor/test/performance/support/scenarioLifetime.test.ts",
    "packages/executor/test/performance/support/nativeBusinessReference.test.ts",
    "packages/executor/test/performance/support/prepareScenario.test.ts",
    "packages/executor/test/performance/support/benchmarkCpuProfiler.test.ts"],
  fsModuleCache: true, fileParallelism: false, maxWorkers: 1,
} });
