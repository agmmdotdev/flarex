import { is, sql } from "drizzle-orm";
import { integer, PgDialect, PgTable, pgTable, text } from "drizzle-orm/pg-core";
import * as NodePgDriver from "drizzle-orm/node-postgres";
import * as NodePgSessions from "drizzle-orm/node-postgres/session";
import { Client, Pool } from "pg";
import { expect, it, vi } from "vitest";
import { executeNativePhysicalCommand, makePhysicalSessionAccess, type NativePhysicalCommand } from "../../src/database/physicalSession/drizzle";
import { flarexSchema } from "../../src/database/schema";
import { postgresUrl } from "../support/postgresHelpers";

vi.mock("drizzle-orm/node-postgres", { spy: true });
vi.mock("drizzle-orm/node-postgres/session", { spy: true });

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

it("constructs only requested full-schema views within each fresh checkout session", () => {
  const database = vi.mocked(NodePgDriver.NodePgDatabase);
  const transaction = vi.mocked(NodePgSessions.NodePgTransaction);
  const session = vi.mocked(NodePgSessions.NodePgSession);
  database.mockClear(); transaction.mockClear(); session.mockClear();
  try {
    const access = makePhysicalSessionAccess(flarexSchema);
    const client = new Client();
    const first = access(client);
    expect(session).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    const tx = first.transaction;
    expect(session).toHaveBeenCalledTimes(1);
    expect(first.transaction).toBe(tx);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(database).not.toHaveBeenCalled();
    const db = first.database;
    expect(first.database).toBe(db);
    expect(database).toHaveBeenCalledTimes(1);
    expect(db).not.toBe(tx);
    expect(db._.session).toBe(tx._.session);
    const expectedTables = Object.entries(flarexSchema).filter(([, value]) => is(value, PgTable)).map(([key]) => key).sort();
    expect(Object.keys(db.query).sort()).toEqual(expectedTables);
    expect(Object.keys(tx.query).sort()).toEqual(expectedTables);
    expect(tx.query.fxAppRowCurrent.findMany().toSQL()).toEqual(db.query.fxAppRowCurrent.findMany().toSQL());
    const repeated = access(client);
    const different = access(new Client());
    expect(session).toHaveBeenCalledTimes(1);
    expect(repeated.transaction).not.toBe(tx);
    expect(repeated.transaction._.session).not.toBe(tx._.session);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(database).toHaveBeenCalledTimes(1);
    expect(different.database).not.toBe(db);
    expect(different.database._.session).not.toBe(db._.session);
    expect(session).toHaveBeenCalledTimes(3);
    expect(database).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(2);
  } finally {
    session.mockClear(); transaction.mockClear(); database.mockClear();
  }
});

it("binds fixed native commands to fresh sessions without constructing full-schema query views", async () => {
  const database = vi.mocked(NodePgDriver.NodePgDatabase);
  const transaction = vi.mocked(NodePgSessions.NodePgTransaction);
  const session = vi.mocked(NodePgSessions.NodePgSession);
  database.mockClear(); transaction.mockClear(); session.mockClear();
  try {
    const access = makePhysicalSessionAccess(flarexSchema);
    const client = new Client();
    const transport = vi.fn(async (_config: unknown, bindings: unknown[]) => ({ rows: [[bindings[0], "2026-10-11 12:34:56+00"]] }));
    Object.assign(client, { query: transport });
    const command: NativePhysicalCommand<unknown[][]> = {
      statement: new PgDialect().sqlToQuery(sql`select ${sql.placeholder("value")}::integer, now()`),
      orderedFields: undefined, statementName: "fixed_session_command", mapResult: rows => rows,
    };
    const first = access(client);
    const next = access(client);
    expect(session).not.toHaveBeenCalled();
    const firstSession = first.session;
    expect(first.session).toBe(firstSession);
    expect(next.session).not.toBe(firstSession);
    expect(await executeNativePhysicalCommand(firstSession, command, { value: 41 })).toEqual([[41, "2026-10-11 12:34:56+00"]]);
    expect(await executeNativePhysicalCommand(next.session, command, { value: 42 })).toEqual([[42, "2026-10-11 12:34:56+00"]]);
    expect(transport).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "fixed_session_command", rowMode: "array",
      text: command.statement.sql, types: expect.objectContaining({ getTypeParser: expect.any(Function) }) }), [41]);
    expect(transport).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: "fixed_session_command", rowMode: "array" }), [42]);
    expect(database).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(session).toHaveBeenCalledTimes(2);
  } finally { session.mockClear(); transaction.mockClear(); database.mockClear(); }
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
