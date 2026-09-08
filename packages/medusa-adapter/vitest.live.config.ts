import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import common from "./vitest.config";

export default mergeConfig({ ...common, test: { ...common.test, include: [] } }, {
  resolve: { alias: [{ find: "cloudflare:workers", replacement: fileURLToPath(new URL("../persistence-postgres/test/cloudflareWorkersStub.ts", import.meta.url)) }] },
  test: { env: { MEDUSA_CURRENCY_LANE: "flarex", MEDUSA_COMPARISON_DRIVER: process.env.FLAREX_TEST_DRIVER ?? "pglite" },
    include: ["../medusa-currency/integration-tests/**/*.spec.ts", "test/currency-announcement.test.ts"], hookTimeout: 120000 },
});
