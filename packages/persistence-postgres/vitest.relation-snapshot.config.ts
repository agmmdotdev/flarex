import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

/** Explicit reassessment campaigns retain their original environment and budgets. */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test/performance/relations/**/*.test.ts"],
    exclude: configDefaults.exclude,
  },
});
