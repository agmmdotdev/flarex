import { beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { getTableName, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds, fxSystemPhysicalDefinitionLifecycles } from "../../../src/database/schema";

import { createPGlitePersistence } from "../../../src/database/pglite";
import { prepareProtectedMetadata, PreparedMetadataEpochError, protectedReadinessMetadataTables } from "../../../src/execution/preparation/preparedMetadataEpoch";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import { withReadinessMetadataUpgradeMigrations } from "../../storage/catalog/readinessMetadataUpgradeFixture";

const currentImmutableTables = [
  "fx_system_application_publication", "fx_system_application_function",
  "fx_system_application_task_catalog", "fx_system_application_task_definition",
  "fx_system_application_revision_schema", "fx_system_application_readiness",
  "fx_system_application_readiness_relation", "fx_system_application_readiness_function",
  "fx_system_application_activation", "fx_system_application_write_ownership",
  "fx_system_data_binding_candidate", "fx_system_data_binding_physical_lane",
  "fx_system_data_binding_activation",
  ...protectedReadinessMetadataTables.map(getTableName),
] as const;

beforeAll(async () => { await migratedPGliteDataDir(); }, 120_000);

describe("prepared metadata epoch PGlite migration", () => {
  it("upgrades installed 139 through the original migrator and advances its durable readiness epoch", async () => {
    await withReadinessMetadataUpgradeMigrations(async (migrationsFolder, exposeCurrent) => {
      const db = newTestPGlite();
      try {
        const previous = await createPGlitePersistence({ db, migrationsFolder });
        await migrate(previous.drizzle, { migrationsFolder });
        const before = (await previous.query<{ generation: string; incarnation: string }>(
          "select generation::text, incarnation::text from fx_system_prepared_metadata_epoch")).rows[0];
        if (before === undefined) throw new Error("Missing installed predecessor epoch");
        expect((await previous.query<{ count: number }>(`select count(*)::integer as count from pg_trigger
          where tgname='fx_prepared_metadata_invalidate' and tgrelid in (
            select oid from pg_class where relnamespace=current_schema()::regnamespace and relname = any($1::text[]))`,
          [protectedReadinessMetadataTables.map(getTableName)])).rows).toEqual([{ count: 0 }]);
        await exposeCurrent();
        const current = await createPGlitePersistence({ db, migrationsFolder });
        await current.migrate();
        const after = (await current.query<{ generation: string; incarnation: string }>(
          "select generation::text, incarnation::text from fx_system_prepared_metadata_epoch")).rows[0];
        expect(after?.incarnation).toBe(before.incarnation);
        expect(BigInt(after?.generation ?? "-1")).toBe(BigInt(before.generation) + 1n);
        expect((await current.query<{ count: number }>(`select count(*)::integer as count from pg_trigger
          where tgname='fx_prepared_metadata_invalidate' and tgrelid in (
            select oid from pg_class where relnamespace=current_schema()::regnamespace and relname = any($1::text[]))`,
          [protectedReadinessMetadataTables.map(getTableName)])).rows).toEqual([{ count: 17 }]);
        await expect(Effect.runPromise(prepareProtectedMetadata(current.drizzle))).rejects.toMatchObject({ reason: "unprotectedRuntime" });
      } finally { await db.close(); }
    });
  }, 180_000);
  it("refuses to mint protected metadata from the genuine migrated PGlite owner", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db });
      const owner = (await persistence.query<{ superuser: boolean }>(
        "select rolsuper as superuser from pg_roles where rolname = session_user")).rows[0];
      expect(owner?.superuser).toBe(true);
      const outcome = await Effect.runPromiseExit(prepareProtectedMetadata(persistence.drizzle));
      if (!Exit.isFailure(outcome)) throw new Error("PGlite owner minted protected metadata");
      expect(outcome.cause.reasons).toHaveLength(1);
      const failure = outcome.cause.reasons[0];
      if (failure === undefined || !Cause.isFailReason(failure)) throw new Error("Expected typed PGlite owner refusal");
      expect(failure.error).toBeInstanceOf(PreparedMetadataEpochError);
      expect(failure.error.reason).toBe("unprotectedRuntime");
      // The PGlite prepared-query adapter ignores names; this is a real owner
      // refusal and ordinary full-proof lane, not positive named-plan evidence.
    } finally { await db.close(); }
  }, 180_000);

  it("invalidates only in the writer transaction and rolls back with it", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db });
      const read = async () => (await persistence.query<{ generation: string }>(
        "select generation::text from fx_system_prepared_metadata_epoch"))
        .rows[0]?.generation;
      const before = await read();
      expect(before).toBe("2");
      await persistence.query(
        "update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
      expect(await read()).toBe("3");
      await expect(persistence.drizzle.transaction(async tx => {
        await tx.execute(
          "update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
        throw new Error("rolled back metadata writer");
      })).rejects.toThrow("rolled back metadata writer");
      expect(await read()).toBe("3");
    } finally {
      await db.close();
    }
  });

  it("invalidates every current immutable table for zero-row DML and TRUNCATE, atomically", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db });
      const read = async () => BigInt((await persistence.query<{ generation: string }>(
        "select generation::text from fx_system_prepared_metadata_epoch")).rows[0]!.generation);
      for (const table of currentImmutableTables) {
        const column = (await persistence.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_schema = current_schema() and table_name = $1 order by ordinal_position limit 1",
          [table])).rows[0]?.column_name;
        if (column === undefined) throw new Error(`Missing immutable table ${table}`);
        for (const statement of [
          `insert into "${table}" select * from "${table}" where false`,
          `update "${table}" set "${column}" = "${column}" where false`,
          `delete from "${table}" where false`,
          `truncate "${table}" cascade`,
        ]) {
          const before = await read();
          await persistence.query(statement);
          const after = await read();
          // CASCADE invalidates every affected watched descendant as well.
          if (statement.startsWith("truncate")) expect(after, statement).toBeGreaterThan(before);
          else expect(after, statement).toBe(before + 1n);
          await expect(persistence.drizzle.transaction(async tx => {
            await tx.execute(statement);
            throw new Error("rollback immutable statement");
          })).rejects.toThrow("rollback immutable statement");
          expect(await read(), `${statement} rollback`).toBe(after);
        }
      }
    } finally {
      await db.close();
    }
  }, 180_000);

  it("keeps ordinary dynamic build and coverage progress outside the static epoch", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    try {
      const persistence = await createPGlitePersistence({ db });
      const read = async () => (await persistence.query<{ generation: string }>(
        "select generation::text from fx_system_prepared_metadata_epoch")).rows[0]?.generation;
      const before = await read();
      await persistence.drizzle.update(fxSystemIndexBuildStates)
        .set({ coveredThroughCommitSeq: sql`${fxSystemIndexBuildStates.coveredThroughCommitSeq}` }).where(sql`false`);
      expect(await read()).toBe(before);
      await persistence.drizzle.update(fxSystemUniqueConstraintBuilds)
        .set({ coveredThroughCommitSeq: sql`${fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq}` }).where(sql`false`);
      expect(await read()).toBe(before);
      await persistence.drizzle.update(fxSystemPhysicalDefinitionLifecycles)
        .set({ transitionFence: sql`${fxSystemPhysicalDefinitionLifecycles.transitionFence}` }).where(sql`false`);
      expect(await read()).toBe(before);
    } finally { await db.close(); }
  }, 180_000);
});
