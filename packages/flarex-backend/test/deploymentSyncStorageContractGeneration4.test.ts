import { describe, expect, it } from "vitest";

import {
  ensureDeploymentQuerySyncStorageReady,
} from "../src/deploymentSync/StorageContract";
import {
  applicationSchema,
  createGeneration2Catalog,
  makeBinding,
  makeSqliteHarness,
  migrateSqliteHarnessToGeneration3,
  seedProvisionalOnlyGeneration2,
  success,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

function retainedGeneration3Rows(database: ReturnType<
  typeof makeSqliteHarness
>["database"]) {
  return Object.freeze({
    scope: database.prepare(
      "SELECT * FROM deployment_sync_scope_state ORDER BY singleton",
    ).all(),
    queries: database.prepare(
      "SELECT * FROM deployment_sync_queries ORDER BY query_key COLLATE BINARY",
    ).all(),
    dependencies: database.prepare(`SELECT *
      FROM deployment_sync_query_dependencies
      ORDER BY query_key COLLATE BINARY, role, generation,
        dependency_key COLLATE BINARY`).all(),
    pending: database.prepare(`SELECT *
      FROM deployment_sync_pending_publications
      ORDER BY query_key COLLATE BINARY`).all(),
  });
}

describe("deployment query-sync generation-3 to generation-4 migration", () => {
  it("migrates an uninitialized exact generation-3 catalog without creating lifecycle state", () => {
    const harness = makeSqliteHarness();
    try {
      createGeneration2Catalog(harness.database, false);
      migrateSqliteHarnessToGeneration3(harness);

      const ready = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        makeBinding(),
      ));

      expect(ready).toEqual({
        localContractGeneration: 4,
        durableInitializedHistory: false,
      });
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_publication_state`).get()?.value).toBe(0);
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_in_flight_publication`).get()?.value).toBe(0);
    } finally {
      harness.database.close();
    }
  });

  it("preserves representative initialized generation-3 rows exactly", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedProvisionalOnlyGeneration2(harness.database, binding);
      migrateSqliteHarnessToGeneration3(harness);
      const beforeRows = retainedGeneration3Rows(harness.database);
      const beforeSchema = applicationSchema(harness.database);

      const ready = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));

      expect(ready).toEqual({
        localContractGeneration: 4,
        durableInitializedHistory: true,
      });
      expect(retainedGeneration3Rows(harness.database)).toEqual(beforeRows);
      expect(applicationSchema(harness.database)).not.toEqual(beforeSchema);
      expect(harness.database.prepare(
        "SELECT * FROM deployment_sync_publication_state",
      ).get()).toMatchObject({
        singleton: 1,
        attempt_ordinal: null,
        latest_delivered_query_key: null,
        preceding_query_key: null,
      });
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_in_flight_publication`).get()?.value).toBe(0);
    } finally {
      harness.database.close();
    }
  });
});
