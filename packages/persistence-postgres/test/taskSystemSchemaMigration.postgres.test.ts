import { webcrypto } from "node:crypto";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresPersistence,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresSchema,
} from "./postgresHelpers";
import {
  assertTaskSystemSchemaContractV1,
  injectTaskSystemSchemaMigrationFailureV1,
  makeTaskSystemSchemaMigrationFixtureV1,
  restoreTaskSystemSchemaMigrationV1,
  type TaskSystemSchemaContractParentV1,
  writeTaskSystemSchemaJournalThroughV1,
} from "./taskSystemSchemaMigrationSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("DTE04-A3 Task System migration - PostgreSQL", () => {
  it("upgrades 0045 atomically and uses the bounded due index", async () => {
    const fixture = await makeTaskSystemSchemaMigrationFixtureV1("postgres");
    try {
      await writeTaskSystemSchemaJournalThroughV1(
        fixture.currentJournal,
        fixture.temporaryJournal,
        45,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const previous = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        let current: Awaited<ReturnType<typeof createPostgresPersistence>> |
          undefined;
        try {
          await previous.migrate();
          expect(await inventory(
            previous,
            databaseOptions.migrationsSchema,
          )).toMatchObject({ tables: 0, receipts: 46 });

          await writeTaskSystemSchemaJournalThroughV1(
            fixture.currentJournal,
            fixture.temporaryJournal,
            46,
          );
          await injectTaskSystemSchemaMigrationFailureV1(
            fixture.migrationPath,
          );
          current = await createPostgresPersistence({
            ...databaseOptions,
            migrationsFolder: fixture.migrationsFolder,
          });
          await expect(current.migrate()).rejects.toThrow();
          expect(await inventory(
            current,
            databaseOptions.migrationsSchema,
          )).toMatchObject({ tables: 0, receipts: 46 });

          await restoreTaskSystemSchemaMigrationV1(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(current.migrate()).resolves.toBeUndefined();
          await expect(current.migrate()).resolves.toBeUndefined();
          expect(await inventory(
            current,
            databaseOptions.migrationsSchema,
          )).toEqual({
            tables: 5,
            checks: 15,
            foreignKeys: 6,
            indexes: 2,
            primaryKeys: 5,
            receipts: 47,
            uniques: 5,
          });
          const parent = await seedRegisteredTaskDefinitionParent(current);
          await assertTaskSystemSchemaContractV1(current, parent);
          const planClient = await current.pool.connect();
          try {
            await planClient.query("set enable_seqscan = off");
            const plan = await planClient.query<{ "QUERY PLAN": string }>(`
              explain (costs off)
              select run_id
              from fx_system_durable_task_run_v1
              where scope_id = 'scope_00000000-0000-4000-8000-000000000001'
                and due_kind = 'start_attempt'
                and due_at_ms <= 9007199254740991
              order by due_at_ms, run_id
              limit 100
            `);
            expect(plan.rows.map(row => row["QUERY PLAN"]).join("\n"))
              .toContain("fx_task_run_v1_due_discovery_idx");
          } finally {
            planClient.release();
          }
        } finally {
          await current?.close();
          await previous.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 480_000);
});

async function seedRegisteredTaskDefinitionParent(
  persistence: PostgresFlarexPersistence,
): Promise<TaskSystemSchemaContractParentV1> {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const state = globalThis as typeof globalThis & {
    __flarexRegistrationFixtureOnlyV1?: boolean;
  };
  state.__flarexRegistrationFixtureOnlyV1 = true;
  const { authenticatedRegistrationFixtureForPersistence } =
    await import("./applicationRevisionRegistrationV1.test");
  const target =
    createPostgresLocatedApplicationRevisionRegistrationTargetV1(
      persistence,
      Object.freeze({
        kind: "shared_database" as const,
        databaseKey: "primary",
        schemaName: "public",
      }),
    );
  return runEffect(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* authenticatedRegistrationFixtureForPersistence(
      persistence,
      target,
    );
    const registration = yield* fixture.context.register(
      fixture.analysis,
      "dte04-a3:task-schema-parent",
    );
    return Object.freeze({
      scopeId: "scope_61000000-0000-0000-0000-000000000001",
      candidateSha256Hex: encodeBytesToLowercaseHex(
        fixture.preparation.candidateSha256,
      ),
      applicationRevisionId: registration.revisionId,
    });
  })));
}

async function inventory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  migrationsSchema: string,
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    tables: number;
    checks: number;
    foreign_keys: number;
    indexes: number;
    primary_keys: number;
    receipts: number;
    uniques: number;
  }>(`
    select
      (select count(*)::int
       from information_schema.tables
       where table_schema = current_schema()
         and table_name like 'fx_system_durable_task_%_v1') as tables,
      (select count(*)::int
       from pg_constraint
       where contype = 'c'
         and connamespace = current_schema()::regnamespace
         and conname like 'fx_task_%') as checks,
      (select count(*)::int
       from pg_constraint
       where contype = 'f'
         and connamespace = current_schema()::regnamespace
         and conname like 'fx_task_%') as foreign_keys,
      (select count(*)::int
       from pg_indexes
       where schemaname = current_schema()
         and indexname in (
           'fx_task_run_v1_due_discovery_idx',
           'fx_task_requested_effect_v1_kind_idx'
         )) as indexes,
      (select count(*)::int
       from pg_constraint
       where contype = 'p'
         and connamespace = current_schema()::regnamespace
         and conname like 'fx_task_%') as primary_keys,
      (select count(*)::int
       from pg_constraint
       where contype = 'u'
         and connamespace = current_schema()::regnamespace
         and conname like 'fx_task_%') as uniques,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  const row = result.rows[0];
  return {
    tables: row?.tables ?? -1,
    checks: row?.checks ?? -1,
    foreignKeys: row?.foreign_keys ?? -1,
    indexes: row?.indexes ?? -1,
    primaryKeys: row?.primary_keys ?? -1,
    receipts: row?.receipts ?? -1,
    uniques: row?.uniques ?? -1,
  };
}
