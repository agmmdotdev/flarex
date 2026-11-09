import { defineConfig } from "vitest/config";
import native from "./vitest.native-stock-sales.config.ts";

export default defineConfig({ ...native, test: { ...native.test, globalSetup: [],
  include: ["test/store-request-reads.test.ts", "test/query-profile.test.ts"],
} });
