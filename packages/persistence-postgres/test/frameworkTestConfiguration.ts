import { availableParallelism, freemem } from "node:os";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "../vitest.config";
import { frameworkTestWorkers } from "./frameworkTestWorkers";

export function frameworkTestConfiguration(driver: "pglite" | "postgres") {
  const maxWorkers = frameworkTestWorkers({ native: driver === "postgres",
    freeMemoryBytes: freemem(), availableProcessors: availableParallelism(),
    requestedWorkers: process.env.FLAREX_TEST_WORKERS });
  console.log(`Framework ${driver} tests: ${maxWorkers} isolated worker(s)`);
  return mergeConfig(base, defineConfig({ test: {
    maxWorkers, fileParallelism: maxWorkers > 1,
  } }));
}
