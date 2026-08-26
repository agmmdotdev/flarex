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
  compactRetainedCommitHistoryPageEffect,
  createRetainedCommitHistoryCompactionPort,
  type RetainedCommitHistoryCompactionQuery,
} from "../src/retainedCommitHistoryCompaction";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
  withPostgresSequentialScansDisabled,
} from "./postgresHelpers";
import { setFlarexActivationClock } from
  "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL O11-D retained commit-history compaction", () => {
  it("deletes the maximum child group and uses bounded owner indexes", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const locator = sharedLocator("o11d-commit-history-postgres");
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_commit_compaction_postgres",
      );
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: locator, randomUuid: uuidFactory() },
      ).ensure({
        deploymentId,
        projectId: "project_retained_commit_compaction_postgres",
      });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedMaximumCommitGroup(persistence, scopeId);
      await expect(incomingForeignKeys(
        persistence,
        "fx_system_commit",
      )).resolves.toEqual([
        "fx_system_commit_app_row_change_header_fk",
        "fx_system_commit_relation_adjacency_header_fk",
      ]);
      await expect(incomingForeignKeys(
        persistence,
        "fx_system_commit_app_row_change",
      )).resolves.toEqual([]);
      await expect(incomingForeignKeys(
        persistence,
        "fx_system_commit_relation_adjacency_change",
      )).resolves.toEqual([]);

      const queries = new Map<
        RetainedCommitHistoryCompactionQuery["name"],
        RetainedCommitHistoryCompactionQuery
      >();
      const port = createRetainedCommitHistoryCompactionPort({
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
        observeQuery: query => queries.set(query.name, query),
      });

      await expect(runEffect(compactRetainedCommitHistoryPageEffect(
        port,
        deploymentId,
      ))).resolves.toMatchObject({
        disposition: "deleted",
        retainedFloor: 2n,
        deletedCommitSeq: 1n,
        deletedChangeCount: 16_000,
        deletedRelationAdjacencyChangeCount: 8_192,
      });
      await expect(readCounts(persistence, scopeId)).resolves.toEqual({
        commits: 1,
        changes: 0,
        relationChanges: 0,
        revisions: 16_000,
        floorHeader: 1,
      });

      const plans = await explainPlans(persistence, queries);
      expect(plans.headerDirectory).toContain(
        "fx_system_commit_scope_uuid_commit_seq_pk",
      );
      expect(plans.changeDirectory).toContain(
        "fx_system_commit_app_row_change_scope_uuid_commit_seq_change_or",
      );
      expect(plans.relationChangeDirectory).toContain(
        "fx_system_commit_relation_adjacency_pk",
      );
      expect(plans.changeDeletion).toMatch(
        /fx_system_commit_app_row_change_(?:scope_uuid_commit_seq_change_or|row_unique)/,
      );
      expect(plans.relationChangeDeletion).toMatch(
        /fx_system_commit_relation_adjacency_(?:pk|endpoint_unique)/,
      );
      expect(plans.headerDeletion).toMatch(
        /fx_system_commit_(?:scope_uuid_commit_seq_pk|scope_epoch_seq_unique)/,
      );

      await expect(runEffect(compactRetainedCommitHistoryPageEffect(
        port,
        deploymentId,
      ))).resolves.toMatchObject({
        disposition: "exhausted",
        retainedFloor: 2n,
      });
    });
  }, 120_000);
});

async function seedMaximumCommitGroup(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<void> {
  await persistence.query(
    `insert into fx_system_commit
       (scope_uuid, epoch_uuid, commit_seq, change_count,
        relation_adjacency_change_count, committed_at)
     select scope_uuid, epoch_uuid, values.commit_seq, values.change_count,
            values.relation_change_count, clock_timestamp()
     from fx_system_scope_clock,
          (values
            (1::bigint, 16000::integer, 8192::integer),
            (2::bigint, 0::integer, 0::integer))
            as values(commit_seq, change_count, relation_change_count)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_row_rev
       (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
        write_epoch_uuid, schema_version_id, creation_time,
        value_codec_version, is_tombstone,
        value_json, value_bytes, value_sha256)
     select scope_uuid, 1,
            decode(lpad(to_hex(generated_id::bigint + 1), 32, '0'), 'hex'),
            1, null, epoch_uuid, 'schema_v1', generated_id + 1,
            1, true, null, null, null
     from fx_system_scope_clock,
          generate_series(0, 15999) as generated_id
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_system_commit_app_row_change
       (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
     select scope_uuid, epoch_uuid, 1, generated_id, 1,
            decode(lpad(to_hex(generated_id::bigint + 1), 32, '0'), 'hex')
     from fx_system_scope_clock,
          generate_series(0, 15999) as generated_id
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_system_commit_relation_adjacency_change
       (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
        edge_definition_id, direction, endpoint_row_id)
     select scope_uuid, epoch_uuid, 1, generated_id, 1,
            case when generated_id % 2 = 0
              then 'outgoing' else 'incoming' end,
            decode(lpad(to_hex(generated_id::bigint + 20001), 32, '0'), 'hex')
     from fx_system_scope_clock,
          generate_series(0, 8191) as generated_id
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `update fx_system_scope_clock
     set last_commit_seq = 2, oldest_available_commit_seq = 2
     where scope_id = $1`,
    [scopeId],
  );
}

async function incomingForeignKeys(
  persistence: PostgresFlarexPersistence,
  tableName:
    | "fx_system_commit"
    | "fx_system_commit_app_row_change"
    | "fx_system_commit_relation_adjacency_change",
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{ conname: string }>(
    `select constraint_row.conname
     from pg_constraint as constraint_row
     where constraint_row.contype = 'f'
       and constraint_row.confrelid = $1::regclass
     order by constraint_row.conname`,
    [tableName],
  );
  return Object.freeze(result.rows.map(row => row.conname));
}

async function readCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  readonly commits: number;
  readonly changes: number;
  readonly relationChanges: number;
  readonly revisions: number;
  readonly floorHeader: number;
}>> {
  const result = await persistence.query<{
    commits: number;
    changes: number;
    relation_changes: number;
    revisions: number;
    floor_header: number;
  }>(
    `select
       (select count(*)::int from fx_system_commit
        where scope_uuid = clock.scope_uuid) as commits,
       (select count(*)::int from fx_system_commit_app_row_change
        where scope_uuid = clock.scope_uuid) as changes,
       (select count(*)::int
        from fx_system_commit_relation_adjacency_change
        where scope_uuid = clock.scope_uuid) as relation_changes,
       (select count(*)::int from fx_app_row_rev
        where scope_uuid = clock.scope_uuid) as revisions,
       (select count(*)::int from fx_system_commit
        where scope_uuid = clock.scope_uuid and commit_seq = 2) as floor_header
     from fx_system_scope_clock as clock where scope_id = $1`,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Scope history counts are missing.");
  return Object.freeze({
    commits: row.commits,
    changes: row.changes,
    relationChanges: row.relation_changes,
    revisions: row.revisions,
    floorHeader: row.floor_header,
  });
}

async function explainPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<
    RetainedCommitHistoryCompactionQuery["name"],
    RetainedCommitHistoryCompactionQuery
  >,
): Promise<Readonly<Record<
  RetainedCommitHistoryCompactionQuery["name"],
  string
>>> {
  return withPostgresSequentialScansDisabled(persistence, async client =>
    Object.freeze({
      headerDirectory: await explainObserved(
        client,
        requireQuery(queries, "headerDirectory"),
      ),
      changeDirectory: await explainObserved(
        client,
        requireQuery(queries, "changeDirectory"),
      ),
      relationChangeDirectory: await explainObserved(
        client,
        requireQuery(queries, "relationChangeDirectory"),
      ),
      changeDeletion: await explainObserved(
        client,
        requireQuery(queries, "changeDeletion"),
      ),
      relationChangeDeletion: await explainObserved(
        client,
        requireQuery(queries, "relationChangeDeletion"),
      ),
      headerDeletion: await explainObserved(
        client,
        requireQuery(queries, "headerDeletion"),
      ),
    })
  );
}

async function explainObserved(
  client: Readonly<{
    readonly query: (
      text: string,
      values?: ReadonlyArray<unknown>,
    ) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>;
  }>,
  query: RetainedCommitHistoryCompactionQuery,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    [...query.params],
  );
  return JSON.stringify(result.rows);
}

function requireQuery(
  queries: ReadonlyMap<
    RetainedCommitHistoryCompactionQuery["name"],
    RetainedCommitHistoryCompactionQuery
  >,
  name: RetainedCommitHistoryCompactionQuery["name"],
): RetainedCommitHistoryCompactionQuery {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing ${name} query receipt.`);
  return query;
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
    return `99000000-0000-4000-8000-${suffix}`;
  };
}
