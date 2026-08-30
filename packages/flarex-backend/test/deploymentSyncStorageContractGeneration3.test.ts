import { Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ensureDeploymentQuerySyncStorageReady,
} from "../src/deploymentSync/StorageContract";
import {
  applicationSchema,
  createGeneration2Catalog,
  makeBinding,
  makeSqliteHarness,
  seedActiveGeneration2,
  seedActiveOnlyGeneration2,
  seedProvisionalOnlyGeneration2,
  success,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

describe("deployment query-sync generation-3 storage contract", () => {
  it("creates the exact five-table generation-3 catalog and reopens without writes", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      const first = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));
      const changes = harness.database.prepare(
        "SELECT total_changes() AS value",
      ).get()?.value;
      const second = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));

      expect(first).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: false,
      });
      expect(second).toEqual(first);
      expect(harness.database.prepare(
        "SELECT total_changes() AS value",
      ).get()?.value).toBe(changes);
      expect(harness.database.prepare("PRAGMA table_list").all()
        .filter(row => String(row.name).startsWith("deployment_sync_"))
        .map(row => ({
          name: row.name,
          strict: row.strict,
          wr: row.wr,
        })).toSorted((left, right) => String(left.name).localeCompare(
          String(right.name),
        ))).toEqual([
        { name: "deployment_sync_contract_state", strict: 1, wr: 1 },
        { name: "deployment_sync_pending_publications", strict: 1, wr: 1 },
        { name: "deployment_sync_queries", strict: 1, wr: 1 },
        { name: "deployment_sync_query_dependencies", strict: 1, wr: 1 },
        { name: "deployment_sync_scope_state", strict: 1, wr: 1 },
      ]);
    } finally {
      harness.database.close();
    }
  });

  it("preserves the exact Cloudflare provider-table allowlist", () => {
    const harness = makeSqliteHarness();
    try {
      harness.database.exec(`CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      )`);
      harness.database.exec(`CREATE TABLE __cf_kv (
        key TEXT PRIMARY KEY,
        value BLOB
      )`);

      const ready = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        makeBinding(),
      ));

      expect(ready.localContractGeneration).toBe(3);
      expect(harness.database.prepare(
        "SELECT count(*) AS value FROM _cf_KV",
      ).get()?.value).toBe(0);
      expect(harness.database.prepare(
        "SELECT count(*) AS value FROM __cf_kv",
      ).get()?.value).toBe(0);
    } finally {
      harness.database.close();
    }
  });

  it("migrates empty and populated provisional-only generation 2 in place", () => {
    const emptyHarness = makeSqliteHarness();
    const populatedHarness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      createGeneration2Catalog(emptyHarness.database, false);
      const emptyReady = success(ensureDeploymentQuerySyncStorageReady(
        emptyHarness.storage,
        binding,
      ));
      const queryBefore = seedProvisionalOnlyGeneration2(
        populatedHarness.database,
        binding,
      );
      const populatedReady = success(ensureDeploymentQuerySyncStorageReady(
        populatedHarness.storage,
        binding,
      ));
      const queryAfter = populatedHarness.database.prepare(`SELECT
        query_key,
        provisional_generation,
        completion_generation,
        preceding_completion_generation
      FROM deployment_sync_queries`).get();

      expect(emptyReady).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: false,
      });
      expect(populatedReady).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: true,
      });
      expect(queryAfter).toEqual({
        query_key: queryBefore.query_key,
        provisional_generation: queryBefore.provisional_generation,
        completion_generation: null,
        preceding_completion_generation: null,
      });
      expect(populatedHarness.database.prepare(
        "SELECT count(*) AS value FROM deployment_sync_pending_publications",
      ).get()?.value).toBe(0);
    } finally {
      emptyHarness.database.close();
      populatedHarness.database.close();
    }
  });

  it("refuses a valid active generation-2 fixture before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedActiveGeneration2(harness.database, binding);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
      expect(harness.database.prepare(`SELECT local_contract_generation
        FROM deployment_sync_contract_state`).get()?.local_contract_generation)
        .toBe(2);
    } finally {
      harness.database.close();
    }
  });

  it("classifies valid active-only generation 2 as incompatible before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedActiveOnlyGeneration2(harness.database, binding);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          operation: "initializeOrInspectNamespace",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

  it("refuses valid generation-2 dependency state before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      const query = seedActiveGeneration2(harness.database, binding);
      const dependencyKey = Encoding.encodeBase64Url(new Uint8Array([1]));
      harness.database.prepare(`INSERT INTO
        deployment_sync_query_dependencies (
          role,
          query_key,
          generation,
          dependency_key
        ) VALUES ('active', ?, '1', ?)`).run(
        query.query_key,
        dependencyKey,
      );
      harness.database.exec(`UPDATE deployment_sync_scope_state SET
        dependency_memberships = 1,
        counted_canonical_bytes = counted_canonical_bytes + 1`);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

  it("refuses generation-2 publication accounting before DDL", () => {
    const harness = makeSqliteHarness();
    try {
      const binding = makeBinding();
      seedProvisionalOnlyGeneration2(harness.database, binding);
      harness.database.exec(`UPDATE deployment_sync_scope_state SET
        pending_publication_count = 1,
        retained_publication_content_bytes = 1,
        counted_canonical_bytes = counted_canonical_bytes + 1`);
      const schemaBefore = applicationSchema(harness.database);

      const result = ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      );

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toMatchObject({
          _tag: "QuerySyncStoredStateIncompatibleError",
          reason: "unsupportedStoredContract",
          cause: {
            _tag: "DeploymentQuerySyncStorageContractIssue",
            reason: "generation2StateUnsupported",
          },
        });
      }
      expect(applicationSchema(harness.database)).toEqual(schemaBefore);
    } finally {
      harness.database.close();
    }
  });

});
