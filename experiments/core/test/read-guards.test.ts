import { randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createReadGuards } from "../src/read-guards.ts";
import { postgresSession } from "../src/session.ts";
import type { Database } from "../src/persistence.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

describe.each(["pglite", "postgres"] as const)("compiled read guards (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withDatabase = async (work: (database: Fixture) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString);
    try { await work(database); } finally { await database.close(); }
  };

  it("reuses SQL lowering while binding a new scope and freshly checking its grant", async () => withDatabase(async database => {
    await database.admin(async db => {
      await db.insert(tables.authorities).values({ scope: "shop-b", fence: 9 });
      await db.insert(tables.clocks).values({ scope: "shop-b" });
      await db.insert(tables.grants).values({ scope: "shop-b", principal: database.role });
    });
    const guards = createReadGuards(); const compilation = vi.spyOn(PgDialect.prototype, "sqlToQuery");
    try {
      await Effect.runPromise(database.persistence.operation(async db => {
        const first = await guards.authority(db, "shop-a", [database.definition]);
        const compiled = compilation.mock.calls.length;
        expect(compiled).toBeGreaterThan(0);
        const second = await guards.authority(db, "shop-b", [database.definition]);
        expect(second[0]?.observed_authority.fence).toBe(9);
        expect(first[0]?.observed_authority.fence).toBe(1);
        expect(await guards.authority(db, "ungranted", [database.definition])).toEqual([]);
        expect(compilation.mock.calls.length).toBe(compiled);
      }));
    } finally { compilation.mockRestore(); }
  }));

  it("binds each command identity and deadline without retaining a previous row or clock verdict", async () => withDatabase(async database => {
    const first = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "first", database.definition, randomUUID()));
    const second = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "second", database.definition, randomUUID()));
    const guards = createReadGuards();
    await Effect.runPromise(database.persistence.operation(async db => {
      expect((await guards.command(db, "shop-a", [database.definition], first.id))[0]?.observed_command?.id).toBe(first.id);
      expect((await guards.command(db, "shop-a", [database.definition], second.id))[0]?.observed_command?.id).toBe(second.id);
      expect((await guards.command(db, "shop-a", [database.definition], randomUUID()))[0]?.observed_command).toBeNull();
      expect((await guards.snapshot(db, "shop-a", [database.definition], new Date(0)))[0]?.expired).toBe(true);
      expect((await guards.snapshot(db, "shop-a", [database.definition], new Date(Date.now() + 60_000)))[0]?.expired).toBe(false);
    }));
  }));

  it.each(["grant", "definition"] as const)("refuses %s retirement after warming the persistence guard", async owner => withDatabase(async database => {
    const observe = () => database.persistence.operation(db => database.persistence.readAuthority(db, "shop-a", [database.definition]));
    expect((await Effect.runPromise(observe())).fence).toBe(1);
    await database.admin(db => owner === "grant"
      ? db.delete(tables.grants).where(eq(tables.grants.scope, "shop-a"))
      : db.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, database.definition.table)));
    const result = await Effect.runPromise(Effect.result(observe()));
    expect(Result.match(result, { onSuccess: () => "unexpected success", onFailure: error => error.reason })).toBe("denied");
  }));

  it("keeps selected versions distinct and recompiles safely after bounded plan eviction", async () => withDatabase(async database => {
    const guards = createReadGuards(); const compilation = vi.spyOn(PgDialect.prototype, "sqlToQuery");
    try {
      await Effect.runPromise(database.persistence.operation(async db => {
        expect((await guards.authority(db, "shop-a", [database.definition]))[0]?.observed_selection.count).toBe(1);
        for (let index = 0; index < 33; index++) {
          const retired = { ...database.definition, version: `uninstalled-${index}` };
          expect((await guards.authority(db, "shop-a", [retired]))[0]?.observed_selection.count).toBe(0);
        }
        const before = compilation.mock.calls.length;
        expect((await guards.authority(db, "shop-a", [database.definition]))[0]?.observed_selection.count).toBe(1);
        expect(compilation.mock.calls.length).toBe(before + 1);
      }));
    } finally { compilation.mockRestore(); }
  }));

  it.skipIf(driver !== "postgres")("reuses a checked-out client facade and retires its plans on physical failure", async () => withDatabase(async database => {
    if (database.servingPool === undefined) throw new Error("Missing ordinary PostgreSQL pool");
    const session = postgresSession(database.servingPool); const guards = createReadGuards();
    let first: Database | undefined;
    await session.run(async db => { first = db; await guards.authority(db, "shop-a", [database.definition]); });
    const compilation = vi.spyOn(PgDialect.prototype, "sqlToQuery");
    try {
      await session.run(async db => {
        expect(db).toBe(first);
        const before = compilation.mock.calls.length;
        expect((await guards.authority(db, "shop-a", [database.definition]))[0]?.observed_selection.count).toBe(1);
        expect(compilation.mock.calls.length).toBe(before);
      });
      const initiating = new Error("owned physical failure");
      await expect(session.run(async db => { expect(db).toBe(first); throw initiating; })).rejects.toBe(initiating);
      await session.run(async db => {
        expect(db).not.toBe(first);
        const before = compilation.mock.calls.length;
        expect((await guards.authority(db, "shop-a", [database.definition]))[0]?.observed_selection.count).toBe(1);
        expect(compilation.mock.calls.length).toBeGreaterThan(before);
        await db.execute(sql`select 1`);
      });
    } finally { compilation.mockRestore(); }
  }));
});
