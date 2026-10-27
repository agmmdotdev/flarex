import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDefinition, type Definition } from "../src/definition.ts";
import { createPersistence, type Persistence } from "../src/persistence.ts";
import { postgresSession, type Session } from "../src/session.ts";
import { createStorage } from "../src/storage.ts";
import { createGroupStorage, frameworkCandidate } from "../src/group-storage.ts";
import { createRoot } from "../src/root.ts";
import { createApplicationStorage } from "../src/application-storage.ts";
import { createApplicationMutationRoot, type ApplicationMutationRoot } from "../src/application-root.ts";
import type { CoreError, DocumentValidationFailure } from "../src/errors.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

/** Pause around the actual physical owner; no admission/query/acceptance logic
 * is reproduced by the harness. The gate itself cannot reject. */
function pausedPersistence(database: Fixture) {
  const physical: Session = database.servingPool === undefined ? { run: work => database.serving.transaction(work) } : postgresSession(database.servingPool);
  let armed: "before" | "after" | null = null; let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const persistence = createPersistence({ run: async work => {
    const position = armed; armed = null;
    if (position === "before") { ready(); await gate; }
    const result = await physical.run(work);
    if (position === "after") { ready(); await gate; }
    return result;
  } });
  return { persistence, started, release, holdNextBefore: () => { armed = "before"; }, holdNextAfter: () => { armed = "after"; } };
}

const barrier = () => {
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, started, gate };
};
const waitFor = async (condition: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 180; attempt++) { if (await condition()) return; await delay(10); }
  throw new Error("Missing owned observation/lock witness");
};
const decodeLockCount = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ n: Schema.Number })) }));
const waitForServingLock = (database: Fixture) => waitFor(async () => {
  const result = await database.admin(db => db.execute(sql`select count(*)::integer as n from pg_stat_activity where application_name = ${database.role} and wait_event_type = 'Lock'`));
  return decodeLockCount(result).rows[0]?.n === 1;
});

const applicationWrite = Effect.fn("TestOwnership.applicationWrite")(function* <A extends Schema.Json>(persistence: Persistence, definition: Definition,
  work: (root: ApplicationMutationRoot) => Effect.Effect<A, CoreError | DocumentValidationFailure>) {
  const storage = createApplicationStorage(persistence);
  const command = yield* storage.openMutation("shop-a", randomUUID(), "fixture", definition, randomUUID());
  const snapshot = yield* storage.commandSnapshot(command); const root = yield* createApplicationMutationRoot(definition, storage, snapshot);
  return yield* Effect.gen(function* () {
    const result = yield* work(root); const frozen = yield* root.freeze();
    yield* storage.accept(command, frozen.changes, frozen.dependencies, result); return result;
  }).pipe(Effect.ensuring(root.close.pipe(Effect.andThen(storage.closeSnapshot(snapshot)), Effect.andThen(storage.abort(command)), Effect.orDie)));
});

describe.each(["pglite", "postgres"] as const)("owned query and accepting inputs (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withDatabase = async (test: (database: Fixture, app: Definition) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString);
    try {
      const app = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 51,
        fields: [{ name: "name", kind: "text", unique: false }, { name: "priority", kind: "number", unique: false }], indexes: [{ name: "by_priority", field: "priority" }] })));
      await database.admin(db => db.insert(tables.definitions).values({ table: app.table, tableId: app.tableId, fields: app.fields, indexes: app.indexes, version: app.version }));
      await test(database, app);
    } finally { await database.close(); }
  };

  it("retains every command binding and closed-before-expired failure order in the combined guard", async () => withDatabase(async database => {
    const command = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "guard", database.definition, randomUUID()));
    const [original] = await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.id, command.id)));
    if (original === undefined) throw new Error("Missing owned guard command");
    const cases: readonly { values: Partial<typeof tables.commands.$inferInsert>; reason: string }[] = [
      { values: { token: "foreign" }, reason: "denied" }, { values: { request: "foreign" }, reason: "denied" },
      { values: { snapshot: original.snapshot + 1 }, reason: "denied" }, { values: { profile: "mixed" }, reason: "denied" },
      { values: { definitions: [{ table: database.definition.table, version: "retired" }] }, reason: "denied" },
      { values: { fence: original.fence + 1 }, reason: "denied" },
      { values: { expires: new Date(original.expires.getTime() + 1000) }, reason: "denied" },
      { values: { expires: new Date(0) }, reason: "expired" },
      { values: { status: "committed", expires: new Date(0) }, reason: "closed" },
    ];
    for (const test of cases) {
      await Effect.runPromise(database.storage.observeRows(command, [], 1));
      await database.admin(db => db.update(tables.commands).set(test.values).where(eq(tables.commands.id, command.id)));
      const result = await Effect.runPromiseExit(database.storage.observeRows(command, [], 1));
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: test.reason } });
      await database.admin(db => db.update(tables.commands).set(original).where(eq(tables.commands.id, command.id)));
    }
    const forged = await Effect.runPromiseExit(database.storage.observeRows({ ...command }, [], 1));
    expect(Exit.isFailure(forged) && Cause.findErrorOption(forged.cause)).toMatchObject({ value: { reason: "denied" } });
    expect(await Effect.runPromise(database.storage.observeRows(command, [], 1))).toEqual([]);
    await Effect.runPromise(database.commands.abort(command));
  }));

  it.skipIf(driver !== "postgres").each(["authority", "definition", "command"] as const)("checks observation expiry after waiting for the %s lock", async owner => withDatabase(async database => {
    const command = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "guard-expiry", database.definition, randomUUID()));
    await Effect.runPromise(database.storage.observeRows(command, [], 1));
    await database.admin(db => db.update(tables.commands).set({ expires: sql`clock_timestamp() + interval '500 milliseconds'` }).where(eq(tables.commands.id, command.id)));
    const pause = barrier();
    const blocker = database.admin(db => db.transaction(async tx => {
      if (owner === "authority") await tx.select().from(tables.authorities).where(eq(tables.authorities.scope, "shop-a")).for("update");
      else if (owner === "definition") await tx.select().from(tables.definitions).where(eq(tables.definitions.table, database.definition.table)).for("update");
      else await tx.select().from(tables.commands).where(eq(tables.commands.id, command.id)).for("update");
      pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await pause.started; pending = Effect.runPromiseExit(database.storage.observeRows(command, [], 1)); await waitForServingLock(database);
      const [lease] = await database.admin(db => db.select({ live: sql<boolean>`${tables.commands.expires} > clock_timestamp() + interval '100 milliseconds'` }).from(tables.commands).where(eq(tables.commands.id, command.id)));
      expect(lease?.live).toBe(true);
      await waitFor(async () => (await database.admin(db => db.select({ expired: sql<boolean>`clock_timestamp() >= ${tables.commands.expires}` }).from(tables.commands).where(eq(tables.commands.id, command.id))))[0]?.expired === true);
      pause.release(); const result = await pending;
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "expired" } });
      expect(await database.admin(db => db.select().from(tables.history))).toEqual([]);
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); await Effect.runPromise(database.commands.abort(command)); }
  }));

  it.skipIf(driver !== "postgres").each(["update", "delete"] as const)("reads a fresh predecessor after a blocked guard and concurrent %s", async change => withDatabase(async (database, app) => {
    const id = await Effect.runPromise(applicationWrite(database.persistence, app, root => root.insert({ name: "original", priority: 1 })));
    const command = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "fresh-predecessor", app, randomUUID()));
    await Effect.runPromise(database.storage.observeRows(command, [id], 262144));
    const pause = barrier(); const blocker = database.admin(db => db.transaction(async tx => {
      await tx.select().from(tables.commands).where(eq(tables.commands.id, command.id)).for("update"); pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await pause.started; pending = Effect.runPromiseExit(database.storage.observeRows(command, [id], 262144)); await waitForServingLock(database);
      await Effect.runPromise(applicationWrite(database.persistence, app, root => change === "update" ? root.patch(id, { priority: 9 }).pipe(Effect.as(null)) : root.delete(id).pipe(Effect.as(null))));
      pause.release(); const result = await pending;
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "conflict" } });
      expect(await Effect.runPromise(database.storage.read("shop-a", app, id))).toEqual(change === "delete" ? null : expect.objectContaining({ priority: 9 }));
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); await Effect.runPromise(database.commands.abort(command)); }
  }));

  it.skipIf(driver !== "postgres")("refuses a selected definition retired while the combined guard waits", async () => withDatabase(async database => {
    const command = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "retirement", database.definition, randomUUID()));
    await Effect.runPromise(database.storage.observeRows(command, [], 1));
    const pause = barrier(); const blocker = database.admin(db => db.transaction(async tx => {
      await tx.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, database.definition.table)); pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await pause.started; pending = Effect.runPromiseExit(database.storage.observeRows(command, [], 1)); await waitForServingLock(database);
      pause.release(); const result = await pending;
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "denied" } });
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); await Effect.runPromise(database.commands.abort(command)); }
  }));

  it.skipIf(driver !== "postgres").each(["authority", "definition"] as const)("checks snapshot expiry after waiting for the %s lock", async owner => withDatabase(async (database, app) => {
    const storage = createApplicationStorage(database.persistence); const snapshot = await Effect.runPromise(storage.openQuery("shop-a", app));
    await Effect.runPromise(storage.point(snapshot, "missing", 1));
    const now = async () => (await database.admin(db => db.select({ time: sql<number>`extract(epoch from clock_timestamp())::double precision * 1000` }).from(tables.installation)))[0]?.time;
    // Age the actual 30-second lease without holding a transaction. No fake clock
    // or configurable weaker lease is introduced for this witness.
    await delay(28_500);
    const pause = barrier(); const blocker = database.admin(db => db.transaction(async tx => {
      if (owner === "authority") await tx.select().from(tables.authorities).where(eq(tables.authorities.scope, "shop-a")).for("update");
      else await tx.select().from(tables.definitions).where(eq(tables.definitions.table, app.table)).for("update");
      pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await Promise.race([pause.started, blocker]); pending = Effect.runPromiseExit(storage.point(snapshot, "missing", 1)); await waitForServingLock(database);
      // Timestamp-to-Date decoding can round the private expires by <1ms.
      // A 100ms margin proves the lease is live rather than merely near expiry.
      expect(await now()).toBeLessThan(snapshot.creationTime + 29_900);
      await waitFor(async () => (await now() ?? 0) >= snapshot.creationTime + 30_001);
      pause.release(); const result = await pending;
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "expired" } });
      expect(await database.admin(db => db.select().from(tables.commands))).toEqual([]);
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); await Effect.runPromise(storage.closeSnapshot(snapshot)); }
  }));

  it.skipIf(driver !== "postgres")("refuses a snapshot definition retired while its guard waits", async () => withDatabase(async (database, app) => {
    const storage = createApplicationStorage(database.persistence); const snapshot = await Effect.runPromise(storage.openQuery("shop-a", app));
    await Effect.runPromise(storage.point(snapshot, "missing", 1));
    const pause = barrier(); const blocker = database.admin(db => db.transaction(async tx => {
      await tx.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, app.table)); pause.ready(); await pause.gate;
    }));
    let pending: ReturnType<typeof Effect.runPromiseExit> | undefined;
    try {
      await Promise.race([pause.started, blocker]); pending = Effect.runPromiseExit(storage.point(snapshot, "missing", 1)); await waitForServingLock(database);
      pause.release(); const result = await pending;
      expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "denied" } });
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); await Effect.runPromise(storage.closeSnapshot(snapshot)); }
  }));

  it("checks and publishes the same captured framework candidate while caller arrays change during checkout", async () => withDatabase(async database => {
    const first = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "fixture", database.definition, randomUUID()));
    const seed = await Effect.runPromise(createRoot(database.definition, database.storage, first));
    await Effect.runPromise(seed.insert({ id: "row", headline: "original", score: 0, createdAt: "t", updatedAt: "t" }));
    const seeded = await Effect.runPromise(seed.freeze()); await Effect.runPromise(database.commands.accept(first, [frameworkCandidate(database.definition, seeded)], null));
    const pause = pausedPersistence(database); const storage = createStorage(pause.persistence);
    const commands = createGroupStorage(pause.persistence);
    const command = await Effect.runPromise(commands.openFramework("shop-a", randomUUID(), "candidate", [database.definition], randomUUID()));
    const root = await Effect.runPromise(createRoot(database.definition, storage, command));
    const before = await Effect.runPromise(root.get("row")); if (before === null) throw new Error("Missing row");
    await Effect.runPromise(root.replace({ ...before, score: 2 })); const frozen = await Effect.runPromise(root.freeze());
    const changes = [...frozen.changes]; const dependencies = [...frozen.dependencies]; const result = { value: "captured" };
    const candidates = [frameworkCandidate(database.definition, { ...frozen, changes, dependencies })];
    pause.holdNextBefore(); const pending = Effect.runPromiseExit(commands.accept(command, candidates, result));
    try {
      await pause.started; changes.length = 0; dependencies.length = 0; result.value = "mutated";
      const other = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "other", database.definition, randomUUID()));
      const writer = await Effect.runPromise(createRoot(database.definition, database.storage, other));
      await Effect.runPromise(writer.replace({ ...before, score: 9 })); const written = await Effect.runPromise(writer.freeze());
      await Effect.runPromise(database.commands.accept(other, [frameworkCandidate(database.definition, written)], null));
      pause.release(); const exit = await pending;
      expect(Exit.isFailure(exit) && Cause.findErrorOption(exit.cause)).toMatchObject({ value: { reason: "conflict" } });
      expect(await Effect.runPromise(database.storage.read("shop-a", database.definition, "row"))).toMatchObject({ score: 9 });
    } finally { pause.release(); await pending; await Effect.runPromise(commands.abort(command)); }
  }));

  it("checks captured Application changes and dependencies despite caller mutation while acceptance waits", async () => withDatabase(async (database, app) => {
    const id = await Effect.runPromise(applicationWrite(database.persistence, app, root => root.insert({ name: "original", priority: 0 })));
    const pause = pausedPersistence(database); const storage = createApplicationStorage(pause.persistence);
    const command = await Effect.runPromise(storage.openMutation("shop-a", randomUUID(), "candidate", app, randomUUID()));
    const snapshot = await Effect.runPromise(storage.commandSnapshot(command)); const root = await Effect.runPromise(createApplicationMutationRoot(app, storage, snapshot));
    await Effect.runPromise(root.patch(id, { priority: 2 })); const frozen = await Effect.runPromise(root.freeze());
    const changes = [...frozen.changes]; const dependencies = [...frozen.dependencies];
    pause.holdNextBefore(); const pending = Effect.runPromiseExit(storage.accept(command, changes, dependencies, null));
    try {
      await pause.started; changes.length = 0; dependencies.length = 0;
      await Effect.runPromise(applicationWrite(database.persistence, app, writer => writer.patch(id, { priority: 9 }).pipe(Effect.as(null))));
      pause.release(); const exit = await pending;
      expect(Exit.isFailure(exit) && Cause.findErrorOption(exit.cause)).toMatchObject({ value: { reason: "conflict" } });
      expect(await Effect.runPromise(database.storage.read("shop-a", app, id))).toMatchObject({ priority: 9 });
    } finally { pause.release(); await pending; await Effect.runPromise(root.close.pipe(Effect.andThen(storage.closeSnapshot(snapshot)), Effect.andThen(storage.abort(command)))); }
  }));

  it("owns one range for committed reads, pending overlay and phantom dependency while a caller mutates it", async () => withDatabase(async (database, app) => {
    await Effect.runPromise(applicationWrite(database.persistence, app, root => root.insert({ name: "committed", priority: 1 })));
    const pause = pausedPersistence(database); const storage = createApplicationStorage(pause.persistence);
    const command = await Effect.runPromise(storage.openMutation("shop-a", randomUUID(), "range", app, randomUUID()));
    const snapshot = await Effect.runPromise(storage.commandSnapshot(command)); const root = await Effect.runPromise(createApplicationMutationRoot(app, storage, snapshot));
    await Effect.runPromise(root.insert({ name: "pending", priority: 3 }));
    const range = { index: "by_priority", field: "priority", lower: { value: 0, inclusive: true }, upper: { value: 5, inclusive: false } };
    pause.holdNextAfter(); const pending = Effect.runPromise(root.range(range));
    try {
      await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      range.upper.value = 0; pause.release(); const rows = await pending;
      expect(rows.map(row => row.name)).toEqual(["committed", "pending"]);
      const frozen = await Effect.runPromise(root.freeze());
      expect(frozen.dependencies).toContainEqual({ kind: "range", range: { ...range, upper: { value: 5, inclusive: false } } });
      await Effect.runPromise(applicationWrite(database.persistence, app, writer => writer.insert({ name: "phantom", priority: 4 })));
      const accepted = await Effect.runPromiseExit(storage.accept(command, frozen.changes, frozen.dependencies, null));
      expect(Exit.isFailure(accepted) && Cause.findErrorOption(accepted.cause)).toMatchObject({ value: { reason: "conflict" } });
    } finally { pause.release(); await pending; await Effect.runPromise(root.close.pipe(Effect.andThen(storage.closeSnapshot(snapshot)), Effect.andThen(storage.abort(command)))); }
  }));
});
