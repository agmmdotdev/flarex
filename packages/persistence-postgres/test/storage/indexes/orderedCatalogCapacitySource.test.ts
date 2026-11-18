import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { MAX_PHYSICAL_INDEX_DEFINITIONS } from "../../../src/storage/indexes/catalogCapacity";
import { MAX_RECONCILED_DEFINITIONS } from "../../../src/storage/indexes/indexBuildReconciliation";
import { MAX_REQUIRED_INDEX_BUILDS } from "../../../src/storage/indexes/indexBuildStates";
import { INDEX_CATALOG_CAPACITY_MIGRATION_SQL } from "../../../src/storage/indexes/indexMaintenanceInstallation";

it("keeps reconciliation and readiness on one finite ordered-catalog bound", () => {
  expect(MAX_PHYSICAL_INDEX_DEFINITIONS).toBe(1024);
  expect(MAX_RECONCILED_DEFINITIONS).toBe(MAX_PHYSICAL_INDEX_DEFINITIONS);
  expect(MAX_REQUIRED_INDEX_BUILDS).toBe(MAX_PHYSICAL_INDEX_DEFINITIONS);
});

it("retains the exact fenced forward migration from the native publisher owners", async () => {
  await expect("-- Align complete ordered-index catalogs at the approved 1024-definition bound.\n" +
    INDEX_CATALOG_CAPACITY_MIGRATION_SQL + "\n").toMatchFileSnapshot(fileURLToPath(new URL(
      "../../../drizzle/0153_ordered_index_catalog_capacity.sql", import.meta.url)));
});
