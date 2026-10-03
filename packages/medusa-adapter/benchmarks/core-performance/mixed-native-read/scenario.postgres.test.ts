import { fileURLToPath } from "node:url";
import { ProductStatus } from "@medusajs/framework/utils/portable";
import type { IProductModuleService } from "@medusajs/framework/types";
import { moduleIntegrationTestRunner } from "../native-retrieval/native-runner";
import { mikroOrmModuleTestPersistenceAdapter } from "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter";
import { runMixedNativeReadPerformanceScenario } from "./scenario";
import { beforeEach, describe, it } from "vitest";

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("matched native and finite Product retrieve", () => {
  let started = 0;
  let moduleSetupMs = 0;
  beforeEach(() => { started = performance.now(); });
  moduleIntegrationTestRunner<IProductModuleService>({ moduleName: "product",
    ...(process.env.NATIVE_RETRIEVAL_DATABASE === undefined ? {} : { dbName: process.env.NATIVE_RETRIEVAL_DATABASE }), schema: "mixed_native_read",
    resolve: fileURLToPath(new URL("../../../../../third_party/medusa/upstream/packages/modules/product", import.meta.url)),
    persistenceAdapter: mikroOrmModuleTestPersistenceAdapter,
    hooks: { afterModuleInit: async () => { moduleSetupMs = performance.now() - started; } },
    testSuite: ({ service }) => {
      it("retains complete default results, missing errors and charged setup", async () => {
        // Resolve the promoted public type/export boundary before loading the
        // exact native same-version control; both own a distinct source graph.
        if (ProductStatus.DRAFT !== "draft") throw new Error("Unexpected pinned Product status contract");
        await runMixedNativeReadPerformanceScenario(service, moduleSetupMs);
      }, 600_000);
    } });
});
