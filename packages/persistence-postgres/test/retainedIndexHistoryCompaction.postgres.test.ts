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
  compactRetainedIndexHistoryPageEffect,
  createRetainedIndexHistoryCompactionPort,
  type RetainedIndexHistoryCompactionQuery,
  type RetainedIndexHistoryCursor,
} from "../src/retainedIndexHistoryCompaction";
import type { SharedDatabaseScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { setFlarexActivationClock } from
  "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real PostgreSQL O11-D retained index-history compaction", () => {
  it("pages the maximum exact identity and uses bounded owner indexes", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const locator = sharedLocator("o11d-index-history-postgres");
      const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
        "deployment_retained_index_compaction_postgres",
      );
      const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
        persistence,
        { physicalLocator: locator, randomUuid: uuidFactory() },
      ).ensure({
        deploymentId,
        projectId: "project_retained_index_compaction_postgres",
      });
      const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
      await setFlarexActivationClock(persistence, scopeId);
      await seedPopulatedIndexHistory(persistence, scopeId);

      await expect(incomingForeignKeys(
        persistence,
        "fx_app_index_entry_rev",
      )).resolves.toEqual([
        "fx_app_index_entry_current_revision_fk",
      ]);
      const queries = new Map<
        RetainedIndexHistoryCompactionQuery["name"],
        RetainedIndexHistoryCompactionQuery
      >();
      const cleanup = createRetainedIndexHistoryCompactionPort({
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

      const first = await runEffect(compactRetainedIndexHistoryPageEffect(
        cleanup,
        deploymentId,
        { kind: "start" },
      ));
      expect(first).toMatchObject({
        disposition: "deleted",
        anchorCommitSeq: 300n,
        deletedRevisionCount: 128,
        continuation: { kind: "exact" },
      });
      if (first.disposition === "exhausted") {
        throw new Error("Expected the populated ordered-index identity.");
      }

      const plans = await explainPlans(persistence, queries);
      expect(plans.identityDirectory).toContain("fx_app_index_entry_rev_pk");
      expect(plans.anchor).toMatch(
        /fx_app_index_entry_rev_(?:range_idx|pk)/,
      );
      expect(plans.candidateDirectory).toMatch(
        /fx_app_index_entry_rev_(?:range_idx|pk)/,
      );
      expect(plans.revisionDeletion).toMatch(
        /fx_app_index_entry_rev_(?:commit_range_idx|range_idx|pk)/,
      );

      let cursor: RetainedIndexHistoryCursor = first.continuation;
      const second = await runEffect(compactRetainedIndexHistoryPageEffect(
        cleanup,
        deploymentId,
        cursor,
      ));
      expect(second).toMatchObject({
        disposition: "deleted",
        deletedRevisionCount: 128,
        continuation: { kind: "exact" },
      });
      if (second.disposition === "exhausted") {
        throw new Error("Expected the second hot-identity page.");
      }
      cursor = second.continuation;
      const third = await runEffect(compactRetainedIndexHistoryPageEffect(
        cleanup,
        deploymentId,
        cursor,
      ));
      expect(third).toMatchObject({
        disposition: "deleted",
        deletedRevisionCount: 43,
        continuation: { kind: "after" },
      });
      await expect(readPopulatedCounts(persistence, scopeId)).resolves.toEqual({
        hotRevisions: 1,
        hotAnchor: 1,
        hotCurrent: 1,
        unrelatedRevisions: 4_096,
        unrelatedCurrent: 4_096,
      });
    });
  }, 120_000);
});

async function seedPopulatedIndexHistory(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<void> {
  await persistence.query(
    `insert into fx_app_row_rev
       (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
        write_epoch_uuid, schema_version_id, creation_time,
        value_codec_version, is_tombstone,
        value_json, value_bytes, value_sha256)
     select scope_uuid, 1, decode(repeat('00', 15) || '01', 'hex'),
            series.value,
            case when series.value = 1 then null else series.value - 1 end,
            epoch_uuid, 'schema_v1', series.value,
            1, true, null, null, null
     from fx_system_scope_clock,
          generate_series(1, 300) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_rev
       (scope_uuid, index_definition_id, table_id, key_codec_version,
        physical_spec_sha256, encoded_key, key_sha256, row_id,
        commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
     select scope_uuid, 1, 1, 1, decode(repeat('11', 32), 'hex'),
            decode('00', 'hex'), decode(repeat('22', 32), 'hex'),
            decode(repeat('00', 15) || '01', 'hex'), series.value,
            case when series.value = 1 then null else series.value - 1 end,
            epoch_uuid, false
     from fx_system_scope_clock,
          generate_series(1, 300) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     select scope_uuid, 1, decode(repeat('00', 15) || '01', 'hex'), 300
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, 1, decode('00', 'hex'),
            decode(repeat('00', 15) || '01', 'hex'), 300
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId],
  );

  await persistence.query(
    `insert into fx_app_row_rev
       (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
        write_epoch_uuid, schema_version_id, creation_time,
        value_codec_version, is_tombstone,
        value_json, value_bytes, value_sha256)
     select scope_uuid, 1,
            decode(lpad(to_hex(series.value + 1), 32, '0'), 'hex'),
            301, null, epoch_uuid, 'schema_v1', series.value + 1,
            1, true, null, null, null
     from fx_system_scope_clock,
          generate_series(1, 4096) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_rev
       (scope_uuid, index_definition_id, table_id, key_codec_version,
        physical_spec_sha256, encoded_key, key_sha256, row_id,
        commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
     select scope_uuid, 1, 1, 1, decode(repeat('11', 32), 'hex'),
            decode('01' || lpad(to_hex(series.value), 4, '0'), 'hex'),
            decode(repeat('22', 32), 'hex'),
            decode(lpad(to_hex(series.value + 1), 32, '0'), 'hex'),
            301, null, epoch_uuid, false
     from fx_system_scope_clock,
          generate_series(1, 4096) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     select scope_uuid, 1,
            decode(lpad(to_hex(series.value + 1), 32, '0'), 'hex'), 301
     from fx_system_scope_clock,
          generate_series(1, 4096) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, 1,
            decode('01' || lpad(to_hex(series.value), 4, '0'), 'hex'),
            decode(lpad(to_hex(series.value + 1), 32, '0'), 'hex'), 301
     from fx_system_scope_clock,
          generate_series(1, 4096) as series(value)
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query(
    `update fx_system_scope_clock
     set last_commit_seq = 301, oldest_available_commit_seq = 300
     where scope_id = $1`,
    [scopeId],
  );
  await persistence.query("analyze fx_app_index_entry_rev");
}

async function incomingForeignKeys(
  persistence: PostgresFlarexPersistence,
  tableName: "fx_app_index_entry_rev",
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

async function readPopulatedCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  readonly hotRevisions: number;
  readonly hotAnchor: number;
  readonly hotCurrent: number;
  readonly unrelatedRevisions: number;
  readonly unrelatedCurrent: number;
}>> {
  const result = await persistence.query<{
    hot_revisions: number;
    hot_anchor: number;
    hot_current: number;
    unrelated_revisions: number;
    unrelated_current: number;
  }>(
    `select
       (select count(*)::int from fx_app_index_entry_rev
         where scope_uuid = clock.scope_uuid and encoded_key = decode('00', 'hex'))
         as hot_revisions,
       (select count(*)::int from fx_app_index_entry_rev
         where scope_uuid = clock.scope_uuid and encoded_key = decode('00', 'hex')
           and commit_seq = 300) as hot_anchor,
       (select count(*)::int from fx_app_index_entry_current
         where scope_uuid = clock.scope_uuid and encoded_key = decode('00', 'hex')
           and commit_seq = 300) as hot_current,
       (select count(*)::int from fx_app_index_entry_rev
         where scope_uuid = clock.scope_uuid and encoded_key <> decode('00', 'hex'))
         as unrelated_revisions,
       (select count(*)::int from fx_app_index_entry_current
         where scope_uuid = clock.scope_uuid and encoded_key <> decode('00', 'hex'))
         as unrelated_current
     from fx_system_scope_clock as clock where scope_id = $1`,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing populated history counts.");
  return Object.freeze({
    hotRevisions: row.hot_revisions,
    hotAnchor: row.hot_anchor,
    hotCurrent: row.hot_current,
    unrelatedRevisions: row.unrelated_revisions,
    unrelatedCurrent: row.unrelated_current,
  });
}

async function explainPlans(
  persistence: PostgresFlarexPersistence,
  queries: ReadonlyMap<
    RetainedIndexHistoryCompactionQuery["name"],
    RetainedIndexHistoryCompactionQuery
  >,
): Promise<Readonly<Record<
  RetainedIndexHistoryCompactionQuery["name"],
  string
>>> {
  return withPostgresSequentialScansDisabled(persistence, async client =>
    Object.freeze({
      identityDirectory: await explainObserved(
        client,
        requireQuery(queries, "identityDirectory"),
      ),
      anchor: await explainObserved(client, requireQuery(queries, "anchor")),
      candidateDirectory: await explainObserved(
        client,
        requireQuery(queries, "candidateDirectory"),
      ),
      revisionDeletion: await explainObserved(
        client,
        requireQuery(queries, "revisionDeletion"),
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
  query: RetainedIndexHistoryCompactionQuery,
): Promise<string> {
  const result = await client.query(
    `explain (format json) ${query.sql}`,
    [...query.params],
  );
  return JSON.stringify(result.rows);
}

function requireQuery(
  queries: ReadonlyMap<
    RetainedIndexHistoryCompactionQuery["name"],
    RetainedIndexHistoryCompactionQuery
  >,
  name: RetainedIndexHistoryCompactionQuery["name"],
): RetainedIndexHistoryCompactionQuery {
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
    return `9b000000-0000-4000-8000-${suffix}`;
  };
}
