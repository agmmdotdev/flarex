import type { SQLInputValue } from "node:sqlite";

import {
  MAX_REFERENCE_QUERIES,
  captureQueryDescriptor,
  captureQueryOperationTarget,
} from "@flarex/query-sync/internal/kernel";
import {
  makeEmptyQuerySyncScopeFacts,
  planBeginQueryEvaluation,
} from "@flarex/query-sync/internal/transition-plan";
import { Encoding } from "effect";
import { describe, expect, it } from "vitest";

import {
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";
import {
  ensureDeploymentQuerySyncStorageReady,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  createGeneration2Catalog,
  insertGeneration2ScopeRow,
  makeBinding,
  makeSqliteHarness,
  prepareGeneration2QueryRowInsert,
  success,
} from "./deploymentSyncStorageContractGeneration3TestSupport";

function indexedCanonicalValue(index: number, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  new DataView(bytes.buffer).setUint32(0, index, false);
  return Encoding.encodeBase64Url(bytes);
}

function storageWithMutationObserver(
  storage: DeploymentQuerySyncStorage,
  onMutation: () => void,
): DeploymentQuerySyncStorage {
  const exec: DeploymentQuerySyncSqlStorage["exec"] = <
    Row extends Record<string, SqlStorageValue>,
  >(
    query: string,
    ...bindings: SQLInputValue[]
  ): SqlStorageCursor<Row> => {
    if (/^(?:alter|create|delete|drop|insert|replace|update)\b/i.test(
      query.trimStart(),
    )) {
      onMutation();
    }
    return storage.sql.exec<Row>(query, ...bindings);
  };
  return {
    transactionSync: storage.transactionSync,
    sql: { exec },
  };
}

describe("generation-2 maximum-population migration", () => {
  it("streams all 4,096 provisional-only rows into generation 3", () => {
    const harness = makeSqliteHarness({
      streamGeneration2MigrationRows: true,
    });
    try {
      const binding = makeBinding();
      createGeneration2Catalog(harness.database, true);
      let scope = makeEmptyQuerySyncScopeFacts(binding.bootstrapCursor);

      harness.storage.transactionSync(() => {
        const insertQuery = prepareGeneration2QueryRowInsert(harness.database);
        for (let index = 0; index < MAX_REFERENCE_QUERIES; index += 1) {
          const descriptor = success(captureQueryDescriptor({
            queryKey: indexedCanonicalValue(index, 0x4b),
            queryIdentity: indexedCanonicalValue(index, 0x69),
          }));
          const target = success(captureQueryOperationTarget({
            namespaceId: binding.namespaceId,
            syncModelId: binding.syncModelId,
            sourceEpoch: binding.sourceEpoch,
            descriptor,
          }));
          const plan = success(planBeginQueryEvaluation({
            scope,
            query: null,
            request: {
              target,
              expectedActiveGeneration: null,
              requestedDirtyThroughSequence: null,
            },
          }));
          if (plan._tag !== "write" || plan.receipt._tag !== "created") {
            throw new Error(
              `Expected a created write plan for maximum fixture row ${index}.`,
            );
          }
          insertQuery(encodeDeploymentQuerySyncQueryRow({
            descriptor: plan.change.descriptor,
            active: null,
            provisional: plan.change.provisional,
          }));
          scope = plan.nextScope;
        }
        insertGeneration2ScopeRow(
          harness.database,
          encodeDeploymentQuerySyncScopeRow({
            scopeUuid: binding.scopeUuid,
            epochUuid: binding.epochUuid,
            storageGeneration: binding.storageGeneration,
            storageGenerationFence: binding.storageGenerationFence,
            syncModelId: binding.syncModelId,
            facts: scope,
          }),
        );
      });

      expect(scope.metrics.queryCount).toBe(MAX_REFERENCE_QUERIES);
      const expectedScopeRow = encodeDeploymentQuerySyncScopeRow({
        scopeUuid: binding.scopeUuid,
        epochUuid: binding.epochUuid,
        storageGeneration: binding.storageGeneration,
        storageGenerationFence: binding.storageGenerationFence,
        syncModelId: binding.syncModelId,
        facts: scope,
      });

      const ready = success(ensureDeploymentQuerySyncStorageReady(
        harness.storage,
        binding,
      ));

      expect(ready).toEqual({
        localContractGeneration: 3,
        durableInitializedHistory: true,
      });
      expect(harness.migrationStreamEvidence).toEqual({
        queryScansOpened: 1,
        queryRowsRead: MAX_REFERENCE_QUERIES,
        dependencyScansOpened: 1,
        dependencyRowsRead: 0,
        queryCopyWrites: 1,
        forbiddenAggregateReadAttempts: 0,
      });
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_queries`).get()?.value)
        .toBe(MAX_REFERENCE_QUERIES);
      expect(harness.database.prepare(`SELECT count(
          DISTINCT query_identity
        ) AS value
        FROM deployment_sync_queries`).get()?.value)
        .toBe(MAX_REFERENCE_QUERIES);
      for (const index of [0, MAX_REFERENCE_QUERIES - 1]) {
        expect(harness.database.prepare(`SELECT
          query_key,
          query_identity,
          provisional_generation,
          provisional_disposition
          FROM deployment_sync_queries
          WHERE query_key = ?`).get(indexedCanonicalValue(index, 0x4b)))
          .toEqual({
            query_key: indexedCanonicalValue(index, 0x4b),
            query_identity: indexedCanonicalValue(index, 0x69),
            provisional_generation: "1",
            provisional_disposition: "ready",
          });
      }
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_queries
        WHERE active_generation IS NOT NULL
          OR active_evaluation_snapshot_sequence IS NOT NULL
          OR active_fresh_through_sequence IS NOT NULL
          OR active_dirty_through_sequence IS NOT NULL
          OR active_result_digest IS NOT NULL
          OR active_authority_witness IS NOT NULL
          OR provisional_generation IS NOT '1'
          OR provisional_expected_active_generation IS NOT NULL
          OR provisional_registration_sequence IS NOT '21'
          OR provisional_requested_dirty_through_sequence IS NOT NULL
          OR provisional_disposition IS NOT 'ready'
          OR completion_generation IS NOT NULL
          OR completion_expected_active_generation IS NOT NULL
          OR completion_registration_sequence IS NOT NULL
          OR completion_requested_dirty_through_sequence IS NOT NULL
          OR completion_evaluation_snapshot_sequence IS NOT NULL
          OR completion_evaluation_authority_witness IS NOT NULL
          OR completion_refreshed_through_sequence IS NOT NULL
          OR completion_relevant_through_sequence IS NOT NULL
          OR completion_refresh_authority_witness IS NOT NULL
          OR completion_result_digest IS NOT NULL
          OR completion_publication_disposition IS NOT NULL
          OR preceding_completion_generation IS NOT NULL`).get()?.value)
        .toBe(0);
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_query_dependencies`).get()?.value).toBe(0);
      expect(harness.database.prepare(`SELECT count(*) AS value
        FROM deployment_sync_pending_publications`).get()?.value).toBe(0);
      expect(harness.database.prepare(`SELECT *
        FROM deployment_sync_scope_state`).get()).toEqual(expectedScopeRow);

      let reentryMutations = 0;
      expect(success(ensureDeploymentQuerySyncStorageReady(
        storageWithMutationObserver(
          harness.storage,
          () => {
            reentryMutations += 1;
          },
        ),
        binding,
      ))).toEqual(ready);
      expect(reentryMutations).toBe(0);
    } finally {
      harness.database.close();
    }
  }, 30_000);
});
