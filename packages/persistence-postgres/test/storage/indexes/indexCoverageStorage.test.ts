import { resolve } from "node:path";
import { lockScopeClockForShareInTransactionEffect } from "../../../src/scope/scopeClock";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "flarex-protocol/index-definition";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../../../src";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { InstallationLifecycleError } from "../../../src/installation/installationLifecycle";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  readFencedIndexBuildStateEffect,
} from "../../../src/storage/indexes/indexBuildStates";
import {
  AppRowTableFrontierCorruptionError,
  readAppTableWriteFrontierInTransactionEffect,
  readAppTableWriteFrontiersInTransactionEffect,
  type AppRowTransaction,
} from "../../../src/storage/documents/appRows";
import {
  makeDrizzleCopyFixture,
  writeJournalThrough,
  injectMigrationFailure,
  restoreMigrationFile,
  type DrizzleCopyFixture,
} from "../../support/migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";
import {
  insertLegacySessionTestScope,
  SESSION_TEST_SCOPE_UUID,
  SESSION_TEST_EPOCH_UUID,
} from "../../execution/sessionAuthorityTestSupport";

async function requireInjectedMigrationFailure(persistence: Pick<FlarexPersistence, "migrate">, missingTable: string) {
  const failure: unknown = await persistence.migrate().then(() => null, cause => cause);
  if (failure instanceof InstallationLifecycleError) expect(failure.reason).toBe("resourceFailure");
  const sqlFailure = failure instanceof InstallationLifecycleError ? failure.cause : failure;
  expect(sqlFailure).toBeInstanceOf(Error);
  expect(sqlFailure).toMatchObject({ message: expect.stringContaining(missingTable) });
}

async function proveCoverageStorage(
  persistence: Pick<FlarexPersistence, "query" | "migrate"> & {
    readonly drizzle: FlarexMetadataDatabase;
  },
  fixture: DrizzleCopyFixture,
  provePlan: boolean,
) {
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    95,
  );
  await persistence.migrate();
  await insertLegacySessionTestScope(persistence);
  const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
  const indexDefinitionId = CatalogIndexDefinitionIdSchema.make(96);
  await persistence.query(
    `insert into fx_system_index_build_state
    (scope_id,index_definition_id,storage_generation,storage_generation_fence,epoch,start_commit_seq,lifecycle,cursor_codec_version,attempt_fence)
    values ($1,96,'flarexdb_v1',1,$2,0,'enabled',1,1)`,
    [scopeId, `epoch_${SESSION_TEST_EPOCH_UUID}`],
  );
  const before = (
    await persistence.query("select * from fx_system_index_build_state")
  ).rows;
  await writeJournalThrough(
    fixture.currentJournal,
    fixture.temporaryJournal,
    96,
  );
  await injectMigrationFailure(
    fixture.migrationPath,
    "fx_coverage_deliberate_missing_table",
  );
  await requireInjectedMigrationFailure(persistence, "fx_coverage_deliberate_missing_table");
  expect(
    (await persistence.query("select * from fx_system_index_build_state")).rows,
  ).toEqual(before);
  await restoreMigrationFile(
    fixture.migrationPath,
    fixture.currentMigrationsFolder,
  );
  await persistence.migrate();
  await persistence.migrate();
  expect(
    (await persistence.query("select * from fx_system_index_build_state")).rows,
  ).toEqual(
    before.map((row) => ({
      ...row,
      covered_through_commit_seq: null,
      first_readable_commit_seq: null,
    })),
  );
  // Preserve the historical migration witness, then prove certificate migration rollback.
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 102);
  await persistence.migrate();
  const beforeMaintenance = (await persistence.query("select * from fx_system_index_build_state")).rows;
  const maintenanceMigration = resolve(fixture.migrationsFolder, "0103_index_maintenance.sql");
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, Number.MAX_SAFE_INTEGER);
  await injectMigrationFailure(maintenanceMigration, "fx_maintenance_deliberate_missing_table");
  await requireInjectedMigrationFailure(persistence, "fx_maintenance_deliberate_missing_table");
  expect((await persistence.query("select * from fx_system_index_build_state")).rows).toEqual(beforeMaintenance);
  await restoreMigrationFile(maintenanceMigration, fixture.currentMigrationsFolder);
  await persistence.migrate();
  const read = async () => {
    const result = await Effect.runPromise(
      readFencedIndexBuildStateEffect(persistence.drizzle, {
        scopeId,
        indexDefinitionId,
      }),
    );
    if (result.status !== "current")
      throw new Error("Expected current build identity.");
    return result.buildState;
  };
  const covered = async (table: number, snapshot: bigint) => {
    const state = await read();
    return persistence.drizzle.transaction((tx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const clock = yield* lockScopeClockForShareInTransactionEffect(tx, scopeId);
          return yield* isIndexBuildSnapshotCoveredInTransactionEffect(
          tx,
          state,
          { indexDefinitionId, tableId: CatalogTableIdSchema.make(table), physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1Schema.make("0".repeat(64)) },
          CommitSeqSchema.make(snapshot),
          yield* readIndexCoverageContextInTransactionEffect(tx, clock),
        ); }),
      ),
    );
  };
  expect((await read()).maintenance).toBeNull();
  expect(await covered(1, 0n)).toBe(false);
  // Historical fixture DML creates retained tombstone identities; no publication claim is made here.
  await persistence.query(
    `insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone)
    select $1,1,decode(lpad(to_hex(n),32,'0'),'hex'),n,null,$2,'coverage',1,1,true from generate_series(1,1000) n`,
    [SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID],
  );
  await persistence.query(`insert into fx_app_row_current (scope_uuid,table_id,row_id,commit_seq)
    select scope_uuid,table_id,row_id,commit_seq from fx_app_row_rev`);
  await persistence.query(
    `with authority as materialized (
       select scope_id from fx_system_scope_execution_authority where scope_id = $1 for update
     ), sequence as (
       update fx_system_scope_clock c set last_commit_seq = 1000
       from authority a where c.scope_id = a.scope_id returning c.scope_id
     )
     update fx_system_scope_execution_authority a set oldest_available_commit_seq = 999
     from sequence c where a.scope_id = c.scope_id`,
    [scopeId],
  );
  await persistence.query(
    "update fx_system_index_build_state set covered_through_commit_seq=999,first_readable_commit_seq=100",
  );
  expect(await covered(1, 99n)).toBe(false);
  expect(await covered(1, 500n)).toBe(true);
  expect(await covered(1, 1000n)).toBe(false);
  expect(await covered(2, 1000n)).toBe(true);
  expect(
    await persistence.drizzle.transaction((tx) =>
      Effect.runPromise(
        readAppTableWriteFrontierInTransactionEffect(
          tx,
          scopeId,
          CatalogTableIdSchema.make(1),
        ),
      ),
    ),
  ).toBe(1000n);
  const batch = await persistence.drizzle.transaction(tx => Effect.runPromise(
    readAppTableWriteFrontiersInTransactionEffect(tx, scopeId,
      [CatalogTableIdSchema.make(1), CatalogTableIdSchema.make(2), CatalogTableIdSchema.make(1)])));
  expect(batch.size).toBe(2);
  expect(batch.get(CatalogTableIdSchema.make(1))).toEqual(Result.succeed(1000n));
  expect(batch.get(CatalogTableIdSchema.make(2))).toEqual(Result.succeed(null));
  await persistence.query(
    "update fx_system_index_build_state set covered_through_commit_seq=1000",
  );
  expect(await covered(1, 1000n)).toBe(true);
  await persistence.query(
    "update fx_system_index_build_state set covered_through_commit_seq=1001",
  );
  await expect(read()).rejects.toThrow(/ahead of scope clock/);
  await persistence.query(
    "update fx_system_index_build_state set covered_through_commit_seq=1000",
  );
  const beforeRefusals = (await persistence.query("select * from fx_system_index_build_state")).rows;
  await expect(persistence.query("update fx_system_index_build_state set maintenance_activation_sequence=1"))
    .rejects.toMatchObject({ code: "23503", message: expect.stringContaining('"fx_index_build_maintenance_opening_fk"') });
  expect((await persistence.query("select * from fx_system_index_build_state")).rows).toEqual(beforeRefusals);
  for (const change of [
    "covered_through_commit_seq=-1",
    "first_readable_commit_seq=1001",
    "covered_through_commit_seq=null",
  ]) {
    await expect(
      persistence.query(`update fx_system_index_build_state set ${change}`),
    ).rejects.toThrow(/check constraint/);
    expect((await persistence.query("select * from fx_system_index_build_state")).rows).toEqual(beforeRefusals);
  }
  if (provePlan) {
    await persistence.query("analyze fx_app_row_current");
    const plan = await persistence.query(
      `explain (analyze, buffers, format json) select commit_seq from fx_app_row_current
      where scope_uuid=$1 and table_id=1 order by commit_seq desc limit 1`,
      [SESSION_TEST_SCOPE_UUID],
    );
    expect(JSON.stringify(plan.rows)).toContain(
      "fx_app_row_current_table_frontier_idx",
    );
    const batchPlan = await persistence.query(
      `explain (analyze, buffers, format json)
       with requested(ordinal, table_id) as (values (0,1),(1,2))
       select requested.ordinal, latest.commit_seq from requested
       left join lateral (
         select current_row.commit_seq from fx_app_row_current as current_row
         where current_row.scope_uuid=$1 and current_row.table_id=requested.table_id
         order by current_row.commit_seq desc limit 1
       ) as latest on true order by requested.ordinal`,
      [SESSION_TEST_SCOPE_UUID],
    );
    expect(JSON.stringify(batchPlan.rows)).toContain("fx_app_row_current_table_frontier_idx");
  }
}

describe("physical index coverage storage", () => {
  it("preserves unknown historical coverage, rolls back migration and proves retained tombstone frontiers on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture(
      "flarex-index-coverage",
      "pglite",
      "0096_index-coverage.sql",
    );
    const db = newTestPGlite();
    try {
      const persistence = await createPGlitePersistence({
        db,
        migrationsFolder: fixture.migrationsFolder,
      });
      await proveCoverageStorage(persistence, fixture, false);
    } finally {
      await db.close();
      await fixture.cleanup();
    }
  }, 60_000);
  it.skipIf(postgresUrl === null)(
    "proves the same migration and indexed frontier plan on ordinary PostgreSQL",
    async () => {
      const fixture = await makeDrizzleCopyFixture(
        "flarex-index-coverage",
        "postgres",
        "0096_index-coverage.sql",
      );
      try {
        await withTemporaryPostgresSchema(async (options) => {
          const persistence = await createPostgresPersistence({
            ...options,
            migrationsFolder: fixture.migrationsFolder,
          });
          try {
            await proveCoverageStorage(persistence, fixture, true);
          } finally {
            await persistence.close();
          }
        });
      } finally {
        await fixture.cleanup();
      }
    },
    60_000,
  );
});

describe("table coverage runtime boundary", () => {
  it("bounds distinct table lookups and retains corruption by table order", async () => {
    const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
    let calls = 0;
    const tx = { execute: () => {
      calls += 1;
      const count = calls < 3 ? 64 : 2;
      return Promise.resolve({ rows: Array.from({ length: count }, (_, ordinal) => ({
        ordinal, commitSeqText: calls === 1 && ordinal === 1 ? "0" : String(calls),
      })) });
    } } as unknown as AppRowTransaction;
    const tableIds = Array.from({ length: 130 }, (_, index) => CatalogTableIdSchema.make(index + 1));
    const result = await Effect.runPromise(readAppTableWriteFrontiersInTransactionEffect(
      tx, scopeId, [...tableIds, tableIds[0]!],
    ));
    expect(calls).toBe(3);
    expect(result.size).toBe(130);
    expect(result.get(tableIds[0]!)).toEqual(Result.succeed(1n));
    const corrupt = result.get(tableIds[1]!);
    expect(corrupt).toMatchObject({ _tag: "Failure", failure: expect.any(AppRowTableFrontierCorruptionError) });
    expect(result.get(tableIds[2]!)).toEqual(Result.succeed(1n));
    expect(result.get(tableIds[129]!)).toEqual(Result.succeed(3n));
  });
  it.each([
    { ordinal: 1, commitSeqText: "4" },
    { ordinal: 0, commitSeqText: "malformed" },
    { ordinal: 0, commitSeqText: "0" },
    { ordinal: 0, commitSeqText: "-1" },
    { ordinal: 0, commitSeqText: "9223372036854775808" },
    { ordinal: 0, commitSeqText: undefined },
  ])("retains a bad envelope or frontier without discarding the next table: %j", async row => {
    const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
    const first = CatalogTableIdSchema.make(1);
    const second = CatalogTableIdSchema.make(2);
    // Malformed driver rows exercise the owned decoder without SQL accepting
    // or normalizing these values before they reach the boundary.
    const tx = { execute: () => Promise.resolve({ rows: [row, { ordinal: 1, commitSeqText: null }] }) } as unknown as AppRowTransaction;
    const result = await Effect.runPromise(readAppTableWriteFrontiersInTransactionEffect(tx, scopeId, [first, second]));
    expect(result.get(first)).toMatchObject({ _tag: "Failure", failure: expect.any(AppRowTableFrontierCorruptionError) });
    expect(result.get(second)).toEqual(Result.succeed(null));
  });
  it.each([{ rows: [] }, { rows: [{ ordinal: 0, commitSeqText: "3" }] }, { rows: [
    { ordinal: 0, commitSeqText: "3" }, { ordinal: 1, commitSeqText: "4" }, { ordinal: 2, commitSeqText: "5" },
  ] }])("retains row-count mismatch as individual table failures: %j", async ({ rows }) => {
    const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
    const tables = [CatalogTableIdSchema.make(1), CatalogTableIdSchema.make(2)];
    const tx = { execute: () => Promise.resolve({ rows }) } as unknown as AppRowTransaction;
    const result = await Effect.runPromise(readAppTableWriteFrontiersInTransactionEffect(tx, scopeId, tables));
    expect(result.size).toBe(2);
    for (const table of tables)
      expect(result.get(table)).toMatchObject({ _tag: "Failure", failure: expect.any(AppRowTableFrontierCorruptionError) });
  });
  it("distinguishes absent rows from malformed present frontiers", async () => {
    const scopeId = ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`);
    const tableId = CatalogTableIdSchema.make(1);
    for (const commitSeq of [null, undefined, 0n, -1n, "1", 1.5]) {
      // Deliberately malformed driver-result fixture: the production decoder must reject these values.
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([{ commitSeq }]),
              }),
            }),
          }),
        }),
      } as unknown as AppRowTransaction;
      const result = await Effect.runPromise(
        Effect.result(
          readAppTableWriteFrontierInTransactionEffect(tx, scopeId, tableId),
        ),
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: expect.any(AppRowTableFrontierCorruptionError),
      });
    }
  });
});
