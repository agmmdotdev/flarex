import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionConfig } from "payload";
import { Document, type Definition } from "../src/definition.ts";
import { CoreError, NativeFailure, NativeOperationFailure } from "../src/errors.ts";
import { createPayloadHost } from "../src/payload-host.ts";
import { createRoot, type Root } from "../src/root.ts";
import { createPersistence, type Database, type Persistence } from "../src/persistence.ts";
import { PhysicalFailure, postgresSession } from "../src/session.ts";
import { fixture, newsCollection, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

type Host = Effect.Success<ReturnType<typeof createPayloadHost>>;
const failureOf = async <A, E>(work: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(work)), {
  onSuccess: () => { throw new Error("Expected refusal"); }, onFailure: error => error,
});
const preference = (id: string, user: string, key: string | null, value: Schema.Json = null) => ({ id,
  user: { relationTo: "users", value: user }, key, value, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" });
const writePreferences = (database: Fixture, definition: Definition, use: (root: Root) => Effect.Effect<unknown, CoreError>) => Effect.runPromise(Effect.gen(function* () {
  const command = yield* database.storage.open("shop-a", randomUUID(), "administrative-preference-fixture", definition, randomUUID());
  const root = yield* createRoot(definition, database.storage, command);
  return yield* Effect.gen(function* () {
    yield* use(root); const frozen = yield* root.freeze();
    yield* database.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events, frozen.predicates);
  }).pipe(Effect.ensuring(root.close));
}));

describe.each(["pglite", "postgres"] as const)("native Payload CRUD (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withHost = async (use: (database: Fixture, host: Host, queries: string[], scope: Scope.Scope) => Promise<void>,
    collection: CollectionConfig = newsCollection(), transport: (database: Fixture) => Persistence = database => database.persistence) => {
    const queries: string[] = []; const database = await fixture(postgres?.connectionString, { logQuery: query => { queries.push(query); } });
    const scope = await Effect.runPromise(Scope.make());
    try {
      const host = await Effect.runPromise(createPayloadHost(collection, transport(database), "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      const definition = host.preferenceDefinition;
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, fields: definition.fields, equalities: definition.equalities, version: definition.version }));
      await use(database, host, queries, scope);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };

  it.each([0, 1, 2])("executes persisted native CRUD with %s matching preferences and complete hook results", async matches => {
    const trace: string[] = []; let assertIdle = () => {};
    const collection = newsCollection(); collection.hooks = { beforeDelete: [() => { assertIdle(); trace.push("beforeDelete"); }],
      afterRead: [({ doc }) => { trace.push("afterRead"); return doc; }],
      afterDelete: [({ doc }) => { assertIdle(); trace.push("afterDelete"); return doc; }],
      afterOperation: [({ operation, result }) => { trace.push(`afterOperation:${operation}`); return result; }] };
    await withHost(async (database, host, queries) => {
      assertIdle = () => { if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount); };
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: `crud-${matches}` }));
      const updated = await Effect.runPromise(host.update(randomUUID(), created.id, { score: 7 }));
      expect(updated).toEqual({ ...created, score: 7, updatedAt: expect.any(String) });
      expect(await Effect.runPromise(host.read(created.id))).toEqual(updated);
      const key = `collection-news-items-${created.id}`;
      await writePreferences(database, host.preferenceDefinition, root => Effect.gen(function* () {
        for (let index = 0; index < matches; index++) yield* root.insert(preference(`match-${index}`, `user-${index}`, key, index === 0 ? "x".repeat(180000) : { small: true }));
        yield* root.insert(preference("other", "user-0", "collection-other-id")); yield* root.insert(preference("null", "user-0", null));
      }));
      trace.length = 0; queries.length = 0;
      const request = randomUUID(); const deleted = await Effect.runPromise(host.delete(request, created.id));
      expect(deleted).toEqual(updated); expect(trace).toEqual(["beforeDelete", "afterRead", "afterDelete", "afterOperation:deleteByID"]);
      const acquisition = queries.filter(query => query.includes('"equality_candidates"'));
      expect(acquisition).toHaveLength(1); expect(acquisition[0]).not.toContain('"history"'); expect(acquisition[0]).not.toContain('"documents"');
      const remaining = await database.admin(db => db.select().from(tables.documents));
      expect(remaining.map(row => row.id).toSorted()).toEqual(["null", "other"]);
      const command = (await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.request, request))))[0];
      expect(command).toMatchObject({ status: "committed", result: updated, profile: "framework" }); expect(command?.definitions).toHaveLength(2);
      const tombstones = await database.admin(db => db.select().from(tables.history).where(eq(tables.history.commitSeq, command?.commitSeq ?? -1)));
      expect(tombstones).toHaveLength(matches + 1); expect(tombstones.every(row => row.body === null)).toBe(true);
      expect(await Effect.runPromise(host.delete(request, created.id))).toEqual(updated); expect(trace).toHaveLength(4);
      expect(await failureOf(host.read(created.id))).toMatchObject({ _tag: "NativeFailure", cause: { status: 404 } });
    }, collection);
  });

  it("keeps update/delete replay authorization aligned with native collection access", async () => {
    let updateAllowed = true; let deleteAllowed = true; let readAllowed = true; let updates = 0; let deletes = 0;
    const collection = newsCollection(); collection.access = { ...collection.access, read: () => readAllowed,
      update: () => updateAllowed, delete: () => deleteAllowed };
    collection.hooks = { afterChange: [({ operation, doc }) => { if (operation === "update") updates++; return doc; }], afterDelete: [({ doc }) => { deletes++; return doc; }] };
    await withHost(async (_database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: "access" })); const updateRequest = randomUUID();
      readAllowed = false;
      const updated = await Effect.runPromise(host.update(updateRequest, created.id, { score: 1 }));
      expect(await Effect.runPromise(host.update(updateRequest, created.id, { score: 1 }))).toEqual(updated); expect(updates).toBe(1);
      updateAllowed = false; expect(await failureOf(host.update(updateRequest, created.id, { score: 1 }))).toMatchObject({ _tag: "NativeFailure", cause: { status: 403 } });
      const deleteRequest = randomUUID(); expect(await Effect.runPromise(host.delete(deleteRequest, created.id))).toEqual(updated);
      expect(await Effect.runPromise(host.delete(deleteRequest, created.id))).toEqual(updated); expect(deletes).toBe(1);
      deleteAllowed = false; expect(await failureOf(host.delete(deleteRequest, created.id))).toMatchObject({ _tag: "NativeFailure", cause: { status: 403 } });
    }, collection);
  });

  it("rolls back document and cleanup together after a late native delete hook failure", async () => {
    const collection = newsCollection(); collection.hooks = { afterDelete: [() => { throw new Error("late-native-delete"); }] };
    await withHost(async (database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: "rollback" }));
      await writePreferences(database, host.preferenceDefinition, root => root.insert(preference("matched", "one", `collection-news-items-${created.id}`)));
      const before = await database.admin(db => db.select().from(tables.history));
      expect(await failureOf(host.delete(randomUUID(), created.id))).toMatchObject({ _tag: "NativeFailure", cause: { message: "late-native-delete" } });
      expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
      expect(await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.id, "matched")))).toHaveLength(1);
      expect(await database.admin(db => db.select().from(tables.history))).toEqual(before);
    }, collection);
  });

  it.each(["insert", "update", "delete", "independent"] as const)("checks a concurrent preference %s before publishing native deletion", async change => {
    let race = async () => {};
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ doc }) => { await race(); return doc; }] };
    await withHost(async (database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: `race-${change}` })); const key = `collection-news-items-${created.id}`;
      await writePreferences(database, host.preferenceDefinition, root => root.insert(preference("first", "one", key)));
      race = () => writePreferences(database, host.preferenceDefinition, root => change === "insert" || change === "independent"
        ? root.insert(preference("second", "two", change === "insert" ? key : "independent"))
        : change === "update" ? root.replace(preference("first", "one", "changed")) : root.delete("first"));
      if (change === "independent") {
        expect(await Effect.runPromise(host.delete(randomUUID(), created.id))).toEqual(created);
        expect(await database.admin(db => db.select().from(tables.documents))).toEqual([expect.objectContaining({ id: "second" })]);
      } else {
        expect(await failureOf(host.delete(randomUUID(), created.id))).toMatchObject({ reason: "conflict" });
        expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
      }
    }, collection);
  });

  it("poisons a caught invalid cleanup and revokes escaped native DAL calls", async () => {
    let invalid = true; let late: (() => Promise<void>) | undefined;
    const collection = newsCollection(); collection.hooks = { beforeDelete: [async ({ req }) => {
      if (invalid) try { await req.payload.db.deleteMany({ collection: "payload-preferences", where: { key: { in: ["wrong-key"] } }, req }); } catch { /* sticky refusal must survive native catch */ }
      late = () => req.payload.db.deleteMany({ collection: "payload-preferences", where: { key: { in: ["wrong-key"] } }, req });
    }] };
    await withHost(async (database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: "caught" }));
      const failed = await failureOf(host.delete(randomUUID(), created.id));
      expect(failed).toBeInstanceOf(NativeFailure);
      if (!(failed instanceof NativeFailure) || !(failed.cause instanceof NativeOperationFailure)) throw new Error("Missing native DAL failure", { cause: failed });
      const native = Cause.findErrorOption(failed.cause.cause);
      expect(native).toMatchObject({ value: { reason: "closed" } });
      if (native._tag !== "Some" || !(native.value instanceof CoreError) || !Cause.isCause(native.value.cause)) throw new Error("Missing sticky refusal", { cause: failed });
      expect(Cause.findErrorOption(native.value.cause)).toMatchObject({ value: { reason: "unsupported" } });
      expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
      invalid = false; await Effect.runPromise(host.delete(randomUUID(), created.id));
      if (late === undefined) throw new Error("Missing escaped DAL call");
      await expect(Promise.resolve().then(late)).rejects.toMatchObject({ reason: "closed" });
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([]);
    }, collection);
  });

  it("requires only the definitions consumed by each operation", async () => withHost(async (database, host) => {
    await database.admin(db => db.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, host.preferenceDefinition.table)));
    const created = await Effect.runPromise(host.create(randomUUID(), { headline: "selected" }));
    const updated = await Effect.runPromise(host.update(randomUUID(), created.id, { score: 2 })); expect(await Effect.runPromise(host.read(created.id))).toEqual(updated);
    expect(await failureOf(host.delete(randomUUID(), created.id))).toMatchObject({ reason: "denied" });
    expect(await Effect.runPromise(host.read(created.id))).toEqual(updated);
  }));

  it.each(["update", "delete", "unresolved-delete"] as const)("handles actual accepted %s response loss without native replay", async operation => {
    let lose = false; let calls = 0;
    const collection = newsCollection(); collection.hooks = { afterChange: [({ operation: actual, doc }) => { if (operation === "update" && actual === "update") { calls++; lose = true; } return doc; }],
      afterDelete: [({ doc }) => { if (operation !== "update") { calls++; lose = true; } return doc; }] };
    await withHost(async (database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: `loss-${operation}` })); const request = randomUUID();
      const run = () => operation === "update" ? host.update(request, created.id, { score: 8 }) : host.delete(request, created.id);
      if (operation === "unresolved-delete") {
        expect(await failureOf(run())).toMatchObject({ reason: "uncertain" }); expect(calls).toBe(1);
        expect(await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.request, request))))
          .toEqual([expect.objectContaining({ status: "committed" })]);
      }
      const result = await Effect.runPromise(run()); expect(await Effect.runPromise(run())).toEqual(result); expect(calls).toBe(1);
      expect(await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.request, request))))
        .toEqual([expect.objectContaining({ status: "committed", result })]);
    }, collection, database => {
      const physical = database.servingPool === undefined ? { run: <A>(work: (db: Database) => Promise<A>) => database.serving.transaction(work) } : postgresSession(database.servingPool);
      const persistence = createPersistence({ run: async work => {
        const result = await physical.run(work);
        if (lose && Schema.is(Document)(result)) {
          expect((await database.admin(db => db.select().from(tables.commands))).filter(command => command.status === "committed" && command.result !== null).some(command =>
            Schema.is(Document)(command.result) && command.result.id === result.id)).toBe(true);
          lose = false; throw new PhysicalFailure({ phase: "commit", cause: "Lost accepted native CRUD response" });
        }
        return result;
      } });
      return operation === "unresolved-delete" ? { ...persistence, resolve: () => Effect.fail(new CoreError({ reason: "storage", cause: "Recovery unavailable" })) } : persistence;
    });
  });

  it("cancels and drains native deletion without holding a physical transaction", async () => {
    let ready = () => {}; let release = () => {}; let signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ req, doc }) => { signal = req.signal; ready(); await gate; return doc; }] };
    await withHost(async (database, host) => {
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: "cancel-delete" })); const controller = new AbortController(); let settled = false;
      const pending = Effect.runPromiseExit(host.delete(randomUUID(), created.id), { signal: controller.signal }).then(result => { settled = true; return result; });
      try {
        await started; if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount);
        controller.abort(); await delay(10); expect(signal?.aborted).toBe(true); expect(settled).toBe(false);
        release(); const result = await pending; expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
        expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
      } finally { release(); await pending; }
    }, collection);
  });

  it("retains native drain failure and the actual command abort cleanup defect", async () => {
    let ready = () => {}; let release = () => {};
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = newsCollection(); collection.hooks = { afterChange: [async () => { ready(); await gate; throw new Error("native-drain-witness"); }] };
    await withHost(async (_database, host) => {
      const controller = new AbortController(); const pending = Effect.runPromiseExit(host.create(randomUUID(), { headline: "cancel" }), { signal: controller.signal });
      try {
        await started; controller.abort(); release(); const result = await pending;
        expect(Exit.isFailure(result)).toBe(true);
        if (Exit.isFailure(result)) {
          expect(Cause.hasInterrupts(result.cause)).toBe(true);
          expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toContainEqual(expect.objectContaining({ _tag: "NativeFailure", cause: expect.objectContaining({ message: "native-drain-witness" }) }));
          expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContainEqual(expect.objectContaining({ message: "abort-cleanup-witness" }));
        }
      } finally { release(); await pending; }
    }, collection, database => ({ ...database.persistence, abort: () => Effect.die(new Error("abort-cleanup-witness")) }));
  });

  it("decodes saved delete results before replay without another native hook", async () => withHost(async (database, host) => {
    const created = await Effect.runPromise(host.create(randomUUID(), { headline: "saved" })); const request = randomUUID();
    await Effect.runPromise(host.delete(request, created.id));
    await database.admin(db => db.update(tables.commands).set({ result: { bad: true } }).where(and(eq(tables.commands.scope, "shop-a"), eq(tables.commands.request, request))));
    expect(await failureOf(host.delete(request, created.id))).toMatchObject({ reason: "storage" });
  }));
});
