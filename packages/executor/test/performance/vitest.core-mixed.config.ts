import { defineConfig } from "vitest/config";
import performanceConfiguration from "./vitest.config.ts";

/** Reuse the portable host boundary while selecting correctness checks only. */
export default defineConfig({ ...performanceConfiguration,
  test: { ...performanceConfiguration.test,
    include: ["packages/executor/test/performance/coreMixedProduct.test.ts"],
    env: { FLAREX_TEST_DRIVER: process.env.FLAREX_TEST_DRIVER ?? "pglite", MEDUSA_MODULE_TEST_PERSISTENCE: "mikroorm" },
  },
});
