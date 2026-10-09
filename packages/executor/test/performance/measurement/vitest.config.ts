import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["packages/executor/test/performance/measurement/**/*.test.ts",
    "packages/executor/test/performance/support/measurement.test.ts",
    "packages/persistence-postgres/test/performance/mixedMutationPerformanceTrace.test.ts",
    "packages/persistence-postgres/test/commit/pointCommitPublicationObservation.test.ts",
    "packages/persistence-postgres/test/frameworks/atomicCommerce/operationContextBridges.test.ts",
    "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.test.ts",
    "packages/medusa-adapter/test/commerce-promise-owner.test.ts"],
  fileParallelism: false, maxWorkers: 1, hookTimeout: 240_000, testTimeout: 240_000,
  server: { deps: { external: [/\/third_party\/medusa\/upstream\/.*\/dist\//,
    /\/work\/native-business-baseline\/dependencies\/node_modules\//] } },
} });
