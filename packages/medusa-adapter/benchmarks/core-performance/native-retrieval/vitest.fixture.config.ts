import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Correctness-only construction checks; never imports the measurement scenario. */
export default defineConfig({
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  test: {
    include: ["benchmarks/core-performance/native-retrieval/core-fixture.test.ts",
      "benchmarks/core-performance/native-retrieval/server.test.ts"],
    maxWorkers: 1, fileParallelism: false, hookTimeout: 180_000, testTimeout: 180_000,
  },
});
