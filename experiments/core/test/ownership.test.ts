import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, type Schema } from "effect";
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
