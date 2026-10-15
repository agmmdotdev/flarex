import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

// Opt in only for database runs; pure contracts never pay for migrations.
export default mergeConfig(base, defineConfig({
  test: { globalSetup: ["./test/support/pgliteMigrationBaseline.ts"] },
}));
