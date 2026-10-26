import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit, Result } from "effect";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDefinition, type Definition, type Field } from "../src/definition.ts";
import { CoreError, NativeFailure } from "../src/errors.ts";
import { createRoot } from "../src/root.ts";
import { createGroupRoot, type BorrowedFrameworkRoot } from "../src/group-root.ts";
import { runCallback } from "../src/callback.ts";
import { createGroupStorage } from "../src/group-storage.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const failureOf = async <A, E>(work: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(work)), {
  onSuccess: () => { throw new Error("Expected failure"); }, onFailure: error => error,
});
const seed = (database: Fixture, definition: Definition, id: string, headline: string) => Effect.runPromise(Effect.gen(function* () {
  const command = yield* database.storage.open("shop-a", randomUUID(), "fixture", definition, randomUUID());
  const root = yield* createRoot(definition, database.storage, command);
  yield* root.insert({ id, headline, score: 0, createdAt: "original", updatedAt: "original" });
  const final = yield* root.freeze(); yield* database.storage.settle(command, final.changes, final.dependencies, null, final.events);
}));

describe.each(["pglite", "postgres"] as const)("selected-table accepting owner (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withGroup = async (test: (database: Fixture, app: Definition, notes: Definition) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString);
    try {
      const app = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 41,
        fields: [{ name: "name", kind: "text", unique: false }, { name: "priority", kind: "number", unique: false }], indexes: [{ name: "by_priority", field: "priority" }] })));
      const notes = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "notes", fields: database.definition.fields })));
      await database.admin(db => db.insert(tables.definitions).values([app, notes].map(definition => ({ table: definition.table, tableId: definition.tableId,
        version: definition.version, fields: definition.fields, indexes: definition.indexes }))));
      await test(database, app, notes);
    } finally { await database.close(); }
  };

  it("publishes multiple physical tables, indexes, events and one outcome at one scope sequence", async () => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "atomic", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      const id = await Effect.runPromise(group.withApplication(app, application => application.insert({ name: "task", priority: 1 })));
      expect(id.startsWith("41:")).toBe(true);
      await Effect.runPromise(group.withFramework(database.definition, framework => Effect.gen(function* () {
        yield* framework.insert({ id: "news", headline: "news", score: 0, createdAt: "t", updatedAt: "t" });
        yield* framework.event({ event: "native.updated", document: "news", body: { id: "news" } });
      })));
      expect(await Effect.runPromise(group.withApplication(app, application => application.get(id)))).toMatchObject({ name: "task" });
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
      const candidates = await Effect.runPromise(group.freeze());
      expect(await Effect.runPromise(storage.accept(command, candidates, { id, news: "news" }))).toEqual({ id, news: "news" });
      const history = await database.admin(db => db.select().from(tables.history)); expect(history).toHaveLength(2);
      expect(history.every(row => row.commitSeq === 1)).toBe(true);
      expect(await database.admin(db => db.select().from(tables.clocks))).toEqual([{ scope: "shop-a", seq: 1 }]);
      const events = await database.admin(db => db.select().from(tables.eventIntents)); expect(events).toHaveLength(3);
      expect(new Set(events.map(event => event.ordinal)).size).toBe(3); expect(events.every(event => event.command === command.id)).toBe(true);
      expect(await database.admin(db => db.select().from(tables.commands))).toEqual([expect.objectContaining({ id: command.id, status: "committed", commitSeq: 1 })]);
      expect(await database.admin(db => db.select().from(tables.indexVersions))).toEqual([expect.objectContaining({ id, fromSeq: 1 })]);
      const replay = await Effect.runPromise(storage.openMixed("shop-a", command.request, "atomic", [...definitions].toReversed(), randomUUID()));
      expect(replay.status).toBe("committed"); expect(replay.result).toEqual({ id, news: "news" });
    } finally { await Effect.runPromise(group.close); }
  }));

  it("keeps direct framework groups distinct and refuses every child settlement/abort capability", async () => withGroup(async (database, _app, notes) => {
    const storage = createGroupStorage(database.persistence); const definitions = [database.definition, notes];
    const command = await Effect.runPromise(storage.openFramework("shop-a", randomUUID(), "framework", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withFramework(database.definition, news => news.insert({ id: "same", headline: "one", score: 0, createdAt: "t", updatedAt: "t" })));
      await Effect.runPromise(group.withFramework(notes, note => note.insert({ id: "same", headline: "two", score: 0, createdAt: "t", updatedAt: "t" })));
      const candidates = await Effect.runPromise(group.freeze()); const child = await Effect.runPromise(database.persistence.participant(command, notes));
      expect(await failureOf(database.persistence.abort(child))).toMatchObject({ reason: "denied" });
      expect(await failureOf(database.persistence.participant(child, database.definition))).toMatchObject({ reason: "denied" });
      expect(await failureOf(database.storage.settle(child, [], [], null, []))).toMatchObject({ reason: "unsupported" });
      expect(await failureOf(storage.accept(child, candidates, null))).toMatchObject({ reason: "denied" });
      expect(await failureOf(storage.accept({ ...command }, candidates, null))).toMatchObject({ reason: "denied" });
      await Effect.runPromise(storage.accept(command, candidates, null));
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(2);
    } finally { await Effect.runPromise(group.close); }
  }));

  it("rolls back earlier tables when a final concurrent unique constraint fails", async () => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "unique", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withApplication(app, application => application.insert({ name: "must-not-publish", priority: 1 })));
      await Effect.runPromise(group.withFramework(database.definition, news => news.insert({ id: "loser", headline: "raced", score: 0, createdAt: "t", updatedAt: "t" })));
      const candidates = await Effect.runPromise(group.freeze());
      await seed(database, database.definition, "winner", "raced");
      expect(await failureOf(storage.accept(command, candidates, null))).toMatchObject({ reason: "unique" });
      expect(await database.admin(db => db.select().from(tables.history))).toEqual([expect.objectContaining({ id: "winner", table: "news-items" })]);
      expect(await database.admin(db => db.select().from(tables.eventIntents))).toHaveLength(1);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it.each(["same", "independent"] as const)("validates read-only native participant observations: %s writer", async mode => withGroup(async (database, app) => {
    await seed(database, database.definition, "read", "old"); await seed(database, database.definition, "other", "other");
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "dependency", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withApplication(app, application => application.insert({ name: "task", priority: 1 })));
      const target = mode === "same" ? "read" : "other";
      const other = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "other", database.definition, randomUUID()));
      const root = await Effect.runPromise(createRoot(database.definition, database.storage, other));
      const body = await Effect.runPromise(root.get(target)); if (body === null) throw new Error("Missing fixture row");
      await Effect.runPromise(root.replace({ ...body, score: 2 })); const changed = await Effect.runPromise(root.freeze());
      await Effect.runPromise(database.storage.settle(other, changed.changes, changed.dependencies, null, changed.events));
      // First acquisition is after the other commit; mixed framework reads must
      // still return the original command snapshot, not a newer direct read.
      expect(await Effect.runPromise(group.withFramework(database.definition, news => news.get("read")))).toMatchObject({ headline: "old", score: 0 });
      const candidates = await Effect.runPromise(group.freeze());
      if (mode === "same") expect(await failureOf(storage.accept(command, candidates, null))).toMatchObject({ reason: "conflict" });
      else await Effect.runPromise(storage.accept(command, candidates, null));
      expect(await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, "tasks")))).toHaveLength(mode === "same" ? 0 : 1);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it.each(["selected", "unrelated", "expiry", "fence"] as const)("rechecks multi-table authority at acceptance: %s", async mode => withGroup(async (database, app, notes) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "gates", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withApplication(app, application => application.insert({ name: "task", priority: 1 })));
      const candidates = await Effect.runPromise(group.freeze());
      await database.admin(async db => {
        if (mode === "selected" || mode === "unrelated") await db.update(tables.definitions).set({ version: "changed" }).where(eq(tables.definitions.table, mode === "selected" ? "news-items" : notes.table));
        else if (mode === "expiry") await db.update(tables.commands).set({ expires: new Date(0) }).where(eq(tables.commands.id, command.id));
        else await db.update(tables.authorities).set({ fence: 2 });
      });
      if (mode === "unrelated") await Effect.runPromise(storage.accept(command, candidates, null));
      else expect(await failureOf(storage.accept(command, candidates, null))).toMatchObject({ reason: mode === "expiry" ? "expired" : "denied" });
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(mode === "unrelated" ? 1 : 0);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it("shares retained bytes and latches a caught participant failure before any table can publish", async () => withGroup(async (database, _app, notes) => {
    const storage = createGroupStorage(database.persistence); const definitions = [database.definition, notes];
    const command = await Effect.runPromise(storage.openFramework("shop-a", randomUUID(), "budget", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withFramework(database.definition, news => news.insert({ id: "a", headline: "a".repeat(90000), score: 0, createdAt: "t", updatedAt: "t" })));
      expect(await failureOf(group.withFramework(notes, note => note.insert({ id: "b", headline: "b".repeat(90000), score: 0, createdAt: "t", updatedAt: "t" })))).toMatchObject({ reason: "limit" });
      expect(await failureOf(group.freeze())).toMatchObject({ reason: "limit" });
      expect(group.diagnostics().bytes).toBeLessThanOrEqual(262144);
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it("retains a caught defect as a sticky group Cause", async () => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "cause", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withApplication(app, appRoot => appRoot.insert({ name: "task", priority: 1 })));
      const defect = new Error("participant-defect"); await Effect.runPromiseExit(group.withFramework(database.definition, () => Effect.die(defect)));
      const exit = await Effect.runPromiseExit(group.freeze());
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it("latches a caught Application validation failure without an optional caller wrapper", async () => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "caught-validation", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withApplication(app, root => Effect.gen(function* () {
        const caught = yield* Effect.result(root.insert({ name: "missing-priority" }));
        expect(caught).toMatchObject({ _tag: "Failure", failure: { _tag: "DocumentValidationFailure" } });
      })));
      expect(await failureOf(group.freeze())).toMatchObject({ _tag: "DocumentValidationFailure" });
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it("keeps framework-only value kinds outside the mixed Application profile", async () => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence);
    const fields: Field[] = [{ name: "value", kind: "json", unique: false }, { name: "value", kind: "boolean", unique: false },
      { name: "value", kind: "text", nullable: true, unique: false }];
    for (const field of fields) {
      const unsupported = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: app.table, tableId: 41, fields: [field] })));
      await database.admin(db => db.update(tables.definitions).set({ version: unsupported.version, fields: unsupported.fields, indexes: [] }).where(eq(tables.definitions.table, app.table)));
      const definitions = [unsupported, database.definition];
      const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "unsupported-app", definitions, randomUUID()));
      expect(await failureOf(createGroupRoot(database.persistence, command, definitions))).toMatchObject({ reason: "unsupported" });
      await Effect.runPromise(storage.abort(command));
    }
    expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
  }));

  it("revokes escaped poison handles without letting them change later callback state", async () => withGroup(async (database, _app, notes) => {
    const storage = createGroupStorage(database.persistence); const definitions = [database.definition, notes];
    const command = await Effect.runPromise(storage.openFramework("shop-a", randomUUID(), "escaped", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    let escaped: BorrowedFrameworkRoot | undefined;
    try {
      await Effect.runPromise(group.withFramework(database.definition, root => Effect.sync(() => { escaped = root; })));
      if (escaped === undefined) throw new Error("Missing borrowed handle");
      await Effect.runPromise(escaped.poison(new CoreError({ reason: "invalid" })));
      await Effect.runPromise(escaped.poisonCause(Cause.die(new Error("revoked-poison"))));
      expect(await failureOf(escaped.get("valid"))).toMatchObject({ reason: "closed" });
      await Effect.runPromise(group.withFramework(notes, root => root.insert({ id: "valid", headline: "valid", score: 0, createdAt: "t", updatedAt: "t" })));
      const candidates = await Effect.runPromise(group.freeze());
      await Effect.runPromise(escaped.poison(new CoreError({ reason: "invalid" })));
      await Effect.runPromise(storage.accept(command, candidates, null));
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(1);
      expect(await failureOf(escaped.get("valid"))).toMatchObject({ reason: "closed" });
    } finally { await Effect.runPromise(group.close); }
  }));

  it("bounds retained unique evidence through repeated edits of the same pending row", async () => withGroup(async (database, _app, notes) => {
    const storage = createGroupStorage(database.persistence); const definitions = [database.definition, notes];
    const command = await Effect.runPromise(storage.openFramework("shop-a", randomUUID(), "repeated", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    try {
      await Effect.runPromise(group.withFramework(database.definition, root => Effect.gen(function* () {
        const row = yield* root.insert({ id: "pending", headline: "initial", score: 0, createdAt: "t", updatedAt: "t" });
        let stopped = false;
        for (let index = 0; index < 32; index++) {
          const result = yield* Effect.result(root.replace({ ...row, headline: `${index}-${"x".repeat(24000)}` }));
          if (Result.isFailure(result)) { expect(result.failure.reason).toBe("limit"); stopped = true; break; }
        }
        expect(stopped).toBe(true);
      })));
      expect(group.diagnostics().bytes).toBeLessThanOrEqual(262144);
      expect(group.diagnostics().dependencyBytes).toBeGreaterThan(100000);
      expect(group.diagnostics().dependencies).toBeLessThan(32);
      expect(await failureOf(group.freeze())).toMatchObject({ reason: "limit" });
      await Effect.runPromise(storage.abort(command));
    } finally { await Effect.runPromise(group.close); }
  }));

  it.each(["normal", "native-failure"] as const)("signals, drains and retains close outcomes for a paused callback: %s", async mode => withGroup(async (database, app) => {
    const storage = createGroupStorage(database.persistence); const definitions = [app, database.definition];
    const command = await Effect.runPromise(storage.openMixed("shop-a", randomUUID(), "drain", definitions, randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, definitions));
    let ready = () => {}; let release = () => {}; let signal: AbortSignal | undefined; let late: unknown;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = Effect.runPromiseExit(group.withFramework(database.definition, root => Effect.gen(function* () {
      yield* root.insert({ id: "pending", headline: "pending", score: 0, createdAt: "t", updatedAt: "t" });
      return yield* runCallback(async cancellation => {
        signal = cancellation; ready(); await gate;
        try { await Effect.runPromise(root.get("pending")); } catch (cause) { late = cause; }
        if (mode === "native-failure") throw new Error("drain-native-failure");
        return null;
      }, cause => new NativeFailure({ cause }));
    })));
    let closing: Promise<Exit.Exit<void, unknown>> | undefined;
    try {
      await started; let completed = false;
      closing = Effect.runPromiseExit(group.close).then(exit => { completed = true; return exit; });
      await delay(20); expect(completed).toBe(false); expect(signal?.aborted).toBe(true);
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      release(); const [closed, result] = await Promise.all([closing, pending]);
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
      expect(late).toBeDefined();
      if (mode === "native-failure") expect(Exit.isFailure(closed) && Cause.findErrorOption(closed.cause)).toMatchObject({ value: { _tag: "NativeFailure", cause: { message: "drain-native-failure" } } });
      else expect(Exit.isSuccess(closed)).toBe(true);
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
    } finally { release(); await Promise.allSettled([pending, closing]); await Effect.runPromise(storage.abort(command)); await Effect.runPromise(group.close); }
  }));
});
