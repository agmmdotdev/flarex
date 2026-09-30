import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";

const currentImmutableTables = [
  "fx_system_application_publication", "fx_system_application_function",
  "fx_system_application_task_catalog", "fx_system_application_task_definition",
  "fx_system_application_revision_schema", "fx_system_application_readiness",
  "fx_system_application_readiness_relation", "fx_system_application_readiness_function",
  "fx_system_application_activation", "fx_system_application_write_ownership",
  "fx_system_data_binding_candidate", "fx_system_data_binding_physical_lane",
  "fx_system_data_binding_activation",
] as const;

describe("prepared metadata epoch PGlite migration", () => {
  it("invalidates only in the writer transaction and rolls back with it", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
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
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
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
});
