import { mergeConfig } from "vitest/config";
import performance from "./vitest.config.ts";

/** Verification of the same measurement assembly, with no timing claims. */
export default mergeConfig({ ...performance, test: { ...performance.test, include: [] } }, {
  test: { include: ["packages/executor/test/performance/flows.test.ts"],
    env: { FLAREX_TEST_DRIVER: process.env.FLAREX_TEST_DRIVER ?? "pglite" } },
});
