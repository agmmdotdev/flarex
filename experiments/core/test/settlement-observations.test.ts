import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPersistence, type Persistence } from "../src/persistence.ts";
import { createStorage } from "../src/storage.ts";
import { createRoot } from "../src/root.ts";
import { createGroupStorage, frameworkCandidate, type GroupCandidate } from "../src/group-storage.ts";
import { postgresSession } from "../src/session.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const barrier = () => {
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, started, gate };
};
const waitFor = async (condition: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 180; attempt++) { if (await condition()) return; await delay(10); }
  throw new Error("Missing real serving lock wait");
};
const locks = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ n: Schema.Number })) }));
const waiting = (database: Fixture) => waitFor(async () => locks(await database.admin(db => db.execute(sql`
  select count(*)::integer as n from pg_stat_activity where application_name = ${database.role} and wait_event_type = 'Lock'`))).rows[0]?.n === 1);
const reason = <A, E>(exit: Exit.Exit<A, E>) => Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
const empty = (database: Fixture): GroupCandidate => ({ definition: database.definition, changes: [], dependencies: [], uniques: [], events: [] });
const preparedInsert = async (database: Fixture, persistence: Persistence, id: string) => {
  const command = await Effect.runPromise(persistence.openCommand("framework", "shop-a", randomUUID(), "insert", database.definition, randomUUID()));
  const root = await Effect.runPromise(createRoot(database.definition, createStorage(persistence), command));
  try {
    await Effect.runPromise(root.insert({ id, headline: id, score: 0, createdAt: "original", updatedAt: "original" }));
    return { command, candidate: frameworkCandidate(database.definition, await Effect.runPromise(root.freeze())) };
  } finally { await Effect.runPromise(root.close); }
};

describe.each(["pglite", "postgres"] as const)("combined settlement observations (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withDatabase = async (work: (database: Fixture) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString);
    try { await work(database); } finally { await database.close(); }
  };

  it.each(["framework", "mixed"] as const)("retains the %s point-dependency profile", async profile => withDatabase(async database => {
    const command = await Effect.runPromise(profile === "mixed"
      ? database.commands.openMixed("shop-a", randomUUID(), "point", [database.definition], randomUUID())
      : database.commands.openFramework("shop-a", randomUUID(), "point", [database.definition], randomUUID()));
    const writer = await preparedInsert(database, database.persistence, "raced");
    await Effect.runPromise(database.commands.accept(writer.command, [writer.candidate], null));
    const candidate = { ...empty(database), dependencies: [{ kind: "point" as const, id: "raced", revision: null, tombstone: false }] };
    const outcome = await Effect.runPromiseExit(database.commands.accept(command, [candidate], null));
    if (profile === "mixed") expect(reason(outcome)).toMatchObject({ value: { reason: "conflict" } });
    else expect(Exit.isSuccess(outcome)).toBe(true);
  }));

  it("checks never-used identity history even when the current row is absent", async () => withDatabase(async database => {
    const writer = await preparedInsert(database, database.persistence, "reused");
    await Effect.runPromise(database.commands.accept(writer.command, [writer.candidate], null));
    const command = await Effect.runPromise(database.commands.openFramework("shop-a", randomUUID(), "delete", [database.definition], randomUUID()));
    const root = await Effect.runPromise(createRoot(database.definition, database.storage, command));
    await Effect.runPromise(root.delete("reused"));
    await Effect.runPromise(database.commands.accept(command, [frameworkCandidate(database.definition, await Effect.runPromise(root.freeze()))], null));
    const collision = await preparedInsert(database, database.persistence, "reused");
    expect(reason(await Effect.runPromiseExit(database.commands.accept(collision.command, [collision.candidate], null))))
      .toMatchObject({ value: { reason: "conflict" } });
    expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
  }));

  it.each(["predecessor", "equality", "point", "range"] as const)("preserves the first failure at %s", async first => withDatabase(async database => {
    const command = await Effect.runPromise(database.commands.openMixed("shop-a", randomUUID(), "order", [database.definition], randomUUID()));
    const writer = await preparedInsert(database, database.persistence, "raced");
    await Effect.runPromise(database.commands.accept(writer.command, [writer.candidate], null));
    const candidate: GroupCandidate = { ...empty(database),
      changes: first === "predecessor" ? [{ id: "missing", before: 1, body: null }] : [],
      dependencies: [
        ...(first === "predecessor" || first === "equality" ? [{ kind: "equality" as const, selection: { index: "unsupported", field: "headline", keys: ["raced"] } }] : []),
        ...(first === "range" ? [] : [{ kind: "point" as const, id: "raced", revision: null, tombstone: false }]),
        { kind: "range", range: { index: "unsupported", field: "score", lower: null, upper: null } },
      ] };
    expect(reason(await Effect.runPromiseExit(database.commands.accept(command, [candidate], null))))
      .toMatchObject({ value: { reason: first === "equality" || first === "range" ? "invalid" : "conflict" } });
    expect((await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.id, command.id))))[0]?.status).toBe("active");
  }));

  it.skipIf(driver !== "postgres").each(["authority", "definition", "command", "clock"] as const)("checks expiry after the accepting %s lock wait", async lock => withDatabase(async database => {
    const prepared = await preparedInsert(database, database.persistence, "expiry");
    await database.admin(db => db.update(tables.commands).set({ expires: sql`clock_timestamp() + interval '700 milliseconds'` }).where(eq(tables.commands.id, prepared.command.id)));
    const pause = barrier();
    const blocker = database.admin(db => db.transaction(async tx => {
      if (lock === "authority") await tx.select().from(tables.authorities).where(eq(tables.authorities.scope, "shop-a")).for("update");
      else if (lock === "definition") await tx.select().from(tables.definitions).where(eq(tables.definitions.table, database.definition.table)).for("update");
      else if (lock === "command") await tx.select().from(tables.commands).where(eq(tables.commands.id, prepared.command.id)).for("update");
      else await tx.select().from(tables.clocks).where(eq(tables.clocks.scope, "shop-a")).for("update");
      pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await pause.started; pending = Effect.runPromiseExit(database.commands.accept(prepared.command, [prepared.candidate], null));
      await waiting(database);
      expect((await database.admin(db => db.select({ live: sql<boolean>`${tables.commands.expires} > clock_timestamp() + interval '100 milliseconds'` }).from(tables.commands).where(eq(tables.commands.id, prepared.command.id))))[0]?.live).toBe(true);
      await waitFor(async () => (await database.admin(db => db.select({ expired: sql<boolean>`clock_timestamp() >= ${tables.commands.expires}` }).from(tables.commands).where(eq(tables.commands.id, prepared.command.id))))[0]?.expired === true);
      pause.release(); expect(reason(await pending)).toMatchObject({ value: { reason: "expired" } });
      expect(await database.admin(db => db.select().from(tables.history))).toEqual([]);
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); }
  }));

  it.skipIf(driver !== "postgres")("sees real committed predecessors after waiting for the scope clock", async () => withDatabase(async database => {
    if (database.servingPool === undefined) throw new Error("Missing real PostgreSQL pool");
    const physical = postgresSession(database.servingPool); const pause = barrier(); let armed = false;
    const writerPersistence = createPersistence({ run: work => physical.run(async db => {
      const result = await work(db); if (armed) { armed = false; pause.ready(); await pause.gate; } return result;
    }) });
    const writer = await preparedInsert(database, writerPersistence, "raced");
    const contender = await preparedInsert(database, database.persistence, "raced");
    armed = true; const committed = Effect.runPromise(createGroupStorage(writerPersistence).accept(writer.command, [writer.candidate], null));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await Promise.race([pause.started, committed]);
      pending = Effect.runPromiseExit(database.commands.accept(contender.command, [contender.candidate], null)); await waiting(database);
      pause.release(); await committed;
      expect(reason(await pending)).toMatchObject({ value: { reason: "conflict" } });
      expect((await database.admin(db => db.select().from(tables.history))).length).toBe(1);
      expect((await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.id, contender.command.id))))[0]?.status).toBe("active");
    } finally { pause.release(); await Promise.allSettled([committed, pending]); }
  }));
});
