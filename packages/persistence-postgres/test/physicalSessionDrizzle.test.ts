import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { Client, Pool } from "pg";
import { expect, it } from "vitest";
import { makePhysicalSessionAccess } from "../src/physicalSession/drizzle";
import { postgresUrl } from "./postgresHelpers";

it("compiles static table metadata once while constructing fresh client-bound views", () => {
  let extractions = 0;
  const probe = pgTable("session_access_probe", {
    id: integer().primaryKey(), value: text().notNull(),
  }, () => { extractions++; return []; });
  const access = makePhysicalSessionAccess({ probe });
  expect(extractions).toBe(1);
  const firstClient = new Client();
  const secondClient = new Client();
  const first = access(firstClient);
  const repeated = access(firstClient);
  const second = access(secondClient);
  expect(first.database).not.toBe(repeated.database);
  expect(first.transaction).not.toBe(repeated.transaction);
  expect(first.database).not.toBe(second.database);
  expect(first.database.query.probe).not.toBe(second.database.query.probe);
  const expected = first.database.select().from(probe).toSQL();
  expect(second.transaction.select().from(probe).toSQL()).toEqual(expected);
  expect(repeated.database.query.probe.findMany().toSQL()).toEqual(
    second.database.query.probe.findMany().toSQL(),
  );
  expect(extractions).toBe(1);
});

it.skipIf(postgresUrl === null)("routes shared metadata through exact pooled and connected clients without sharing rows or settlement", async () => {
  const probe = pgTable("session_access_probe", {
    id: integer().primaryKey(), value: text().notNull(),
  });
  const access = makePhysicalSessionAccess({ probe });
  const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1 });
  const connected = new Client({ connectionString: postgresUrl ?? undefined });
  try {
    await connected.connect();
    const pooled = await pool.connect();
    try {
      const first = access(pooled);
      const second = access(connected);
      // Driver-local temporary DDL deliberately creates the same table name on
      // different physical connections; ordinary fixture DML stays typed.
      for (const view of [first, second]) await view.database.execute(sql`
        create temporary table session_access_probe (id integer primary key, value text not null)
      `);
      await first.database.insert(probe).values({ id: 1, value: "pooled" });
      await second.database.insert(probe).values({ id: 1, value: "connected" });
      expect(await first.database.query.probe.findMany()).toEqual([{ id: 1, value: "pooled" }]);
      expect(await second.database.query.probe.findMany()).toEqual([{ id: 1, value: "connected" }]);
      expect(await access(pooled).transaction.select().from(probe)).toEqual([{ id: 1, value: "pooled" }]);
      const original = new Error("rollback witness");
      await expect(first.database.transaction(async tx => {
        await tx.insert(probe).values({ id: 2, value: "rolled back" });
        throw original;
      })).rejects.toBe(original);
      expect(await first.database.select().from(probe)).toEqual([{ id: 1, value: "pooled" }]);
      await second.database.transaction(async tx => {
        await tx.setTransaction({ isolationLevel: "read committed" });
        await tx.insert(probe).values({ id: 2, value: "committed" });
      });
      expect(await second.database.select().from(probe).orderBy(probe.id)).toEqual([
        { id: 1, value: "connected" }, { id: 2, value: "committed" },
      ]);
      expect(pool.totalCount - pool.idleCount).toBe(1);
    } finally { pooled.release(); }
    expect(pool.totalCount - pool.idleCount).toBe(0);
  } finally {
    try { await connected.end(); }
    finally { await pool.end(); }
  }
});
