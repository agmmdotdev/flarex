import { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogTableIdSchema,
} from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readFencedIndexBuildStateEffect,
} from "../src/indexBuildStates";
import {
  AppRowTableFrontierCorruptionError,
  readAppTableWriteFrontierInTransactionEffect,
  type AppRowTransaction,
} from "../src/appRows";
import {
  makeDrizzleCopyFixture,
  writeJournalThrough,
  injectMigrationFailure,
  restoreMigrationFile,
  type DrizzleCopyFixture,
} from "./migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";
import {
  insertSessionTestScope,
  SESSION_TEST_SCOPE_UUID,
  SESSION_TEST_EPOCH_UUID,
} from "./sessionAuthorityTestSupport";

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
  await insertSessionTestScope(persistence);
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
  await expect(persistence.migrate()).rejects.toThrow(
    /fx_coverage_deliberate_missing_table/,
  );
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
        isIndexBuildSnapshotCoveredInTransactionEffect(
          tx,
          state,
          CatalogTableIdSchema.make(table),
          CommitSeqSchema.make(snapshot),
        ),
      ),
    );
  };
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
    "update fx_system_scope_clock set last_commit_seq=1000,oldest_available_commit_seq=999",
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
  for (const change of [
    "covered_through_commit_seq=-1",
    "first_readable_commit_seq=1001",
    "covered_through_commit_seq=null",
  ]) {
    await expect(
      persistence.query(`update fx_system_index_build_state set ${change}`),
    ).rejects.toThrow(/check constraint/);
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
  }
}

describe("physical index coverage storage", () => {
  it("preserves unknown historical coverage, rolls back migration and proves retained tombstone frontiers on PGlite", async () => {
    const fixture = await makeDrizzleCopyFixture(
      "flarex-index-coverage",
      "pglite",
      "0096_index-coverage.sql",
    );
    const db = new PGlite();
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
