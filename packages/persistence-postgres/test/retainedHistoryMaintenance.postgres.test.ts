import { Result } from "effect";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedRetainedHistoryFloorTarget,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  createRetainedHistoryMaintenancePort,
  runRetainedHistoryMaintenanceEffect,
} from "../src/retainedHistoryMaintenance";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { setFlarexActivationClock } from
  "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL O11-E retained-history maintenance", () => {
  it("completes all physical owners in foreign-key dependency order", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const locator = sharedLocator("o11e-maintenance-postgres");
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_history_maintenance_postgres",
      );
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: locator, randomUuid: uuidFactory() },
      ).ensure({
        deploymentId,
        projectId: "project_retained_history_maintenance_postgres",
      });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedConnectedHistory(persistence, scopeId);
      const cleanup = Result.getOrThrow(
        createRetainedHistoryMaintenancePort({
          authority: {
            scopeMetadata: persistence,
            provisioningReceipts: {
              getScopeAuthorityProvisioningReceipt: async () => {
                throw new Error("Shared scope must not read split receipts.");
              },
            },
            scopeClockTargets: {
              resolve: async physicalLocator =>
                createPostgresLocatedRetainedHistoryFloorTarget(
                  persistence,
                  physicalLocator,
                ),
            },
          },
          policy: {
            maximumPages: 16,
            maximumElapsedMilliseconds: 30_000,
          },
        }),
      );

      const receipt = await runEffect(runRetainedHistoryMaintenanceEffect(
        cleanup,
        deploymentId,
        null,
      ));
      expect(receipt).toMatchObject({
        status: "maintenanceComplete",
        stopReason: "exhausted",
        retainedFloor: 3n,
        pagesExecuted: 6,
        commitPagesExecuted: 2,
        indexPagesExecuted: 2,
        appRowPagesExecuted: 2,
        deletedCommitCount: 1,
        deletedChangeCount: 1,
        deletedIndexRevisionCount: 2,
        deletedAppRowRevisionCount: 1,
        continuation: null,
      });
      await expect(readConnectedHistory(persistence, scopeId)).resolves
        .toEqual({
          commits: ["3"],
          changes: [],
          indexes: ["3"],
          indexCurrent: ["3"],
          appRows: ["1", "3"],
          appCurrent: ["3"],
        });
    });
  }, 120_000);
});

async function seedConnectedHistory(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<void> {
  const rowId = "55".repeat(16);
  for (const commitSeq of [1, 2, 3]) {
    await persistence.query(
      `insert into fx_app_row_rev
         (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
          write_epoch_uuid, schema_version_id, creation_time,
          value_codec_version, is_tombstone,
          value_json, value_bytes, value_sha256)
       select scope_uuid, 1, decode($2, 'hex'), $3::bigint,
              case when $3::bigint = 1 then null else $3::bigint - 1 end,
              epoch_uuid, 'schema_v1', 42, 1, true, null, null, null
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, rowId, commitSeq],
    );
    await persistence.query(
      `insert into fx_app_index_entry_rev
         (scope_uuid, index_definition_id, table_id, key_codec_version,
          physical_spec_sha256, encoded_key, key_sha256, row_id,
          commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
       select scope_uuid, 1, 1, 1, decode(repeat('66', 32), 'hex'),
              decode('77', 'hex'), decode(repeat('88', 32), 'hex'),
              decode($2, 'hex'), $3::bigint,
              case when $3::bigint = 1 then null else $3::bigint - 1 end,
              epoch_uuid, false
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, rowId, commitSeq],
    );
  }
  await persistence.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     select scope_uuid, 1, decode($2, 'hex'), 3
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, 1, decode('77', 'hex'), decode($2, 'hex'), 3
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  for (const commit of [
    { commitSeq: 2, changeCount: 1 },
    { commitSeq: 3, changeCount: 0 },
  ]) {
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, $2, $3, clock_timestamp()
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, commit.commitSeq, commit.changeCount],
    );
  }
  await persistence.query(
    `insert into fx_system_commit_app_row_change
       (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
     select scope_uuid, epoch_uuid, 2, 0, 1, decode($2, 'hex')
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  await persistence.query(
    `update fx_system_scope_clock
     set last_commit_seq = 3, oldest_available_commit_seq = 3
     where scope_id = $1`,
    [scopeId],
  );
}

async function readConnectedHistory(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  readonly commits: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<string>;
  readonly indexes: ReadonlyArray<string>;
  readonly indexCurrent: ReadonlyArray<string>;
  readonly appRows: ReadonlyArray<string>;
  readonly appCurrent: ReadonlyArray<string>;
}>> {
  const [
    commits,
    changes,
    indexes,
    indexCurrent,
    appRows,
    appCurrent,
  ] = await Promise.all([
    readCommitSeqs(persistence, "fx_system_commit", scopeId),
    readCommitSeqs(persistence, "fx_system_commit_app_row_change", scopeId),
    readCommitSeqs(persistence, "fx_app_index_entry_rev", scopeId),
    readCommitSeqs(persistence, "fx_app_index_entry_current", scopeId),
    readCommitSeqs(persistence, "fx_app_row_rev", scopeId),
    readCommitSeqs(persistence, "fx_app_row_current", scopeId),
  ]);
  return Object.freeze({
    commits,
    changes,
    indexes,
    indexCurrent,
    appRows,
    appCurrent,
  });
}

async function readCommitSeqs(
  persistence: PostgresFlarexPersistence,
  tableName:
    | "fx_system_commit"
    | "fx_system_commit_app_row_change"
    | "fx_app_index_entry_rev"
    | "fx_app_index_entry_current"
    | "fx_app_row_rev"
    | "fx_app_row_current",
  scopeId: string,
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{ value: string }>(
    `select commit_seq::text as value from ${tableName}
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by commit_seq`,
    [scopeId],
  );
  return Object.freeze(result.rows.map(row => row.value));
}

function sharedLocator(
  databaseKey: string,
): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

function uuidFactory(): () => string {
  let counter = 1;
  return () => {
    const suffix = counter.toString().padStart(12, "0");
    counter += 1;
    return `9f000000-0000-4000-8000-${suffix}`;
  };
}
