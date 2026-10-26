import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionConfig } from "payload";
import { createMixedHost, MixedResult } from "../src/mixed.ts";
import { compileDefinition } from "../src/definition.ts";
import { createRoot } from "../src/root.ts";
import { createGroupRoot } from "../src/group-root.ts";
import { frameworkCandidate } from "../src/group-storage.ts";
import { createProductHost } from "../src/medusa-product.ts";
import { createPersistence, type Database, type Persistence } from "../src/persistence.ts";
import { NativeFailure, NativeOperationFailure, type CoreError } from "../src/errors.ts";
import type { Root } from "../src/root.ts";
import { PhysicalFailure, postgresSession } from "../src/session.ts";
import { applicationFunctions } from "./application-corpus.ts";
import { fixture, newsCollection, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

type Host = Effect.Success<ReturnType<typeof createMixedHost>>;
const failureOf = async <A, E>(work: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(work)), {
  onSuccess: () => { throw new Error("Expected failure"); }, onFailure: error => error,
});
const adapterCause = (failure: unknown) => {
  if (!(failure instanceof NativeFailure) || !(failure.cause instanceof NativeOperationFailure))
    throw new Error("Expected native failure retaining the adapter Cause", { cause: failure });
  expect(failure.cause.cause.reasons).toHaveLength(1);
  return failure.cause.cause;
};
const deletionId = (id: string) => `old-${id}`;
const oldDocument = (id: string) => ({ id: deletionId(id), headline: "old-news", score: 3,
  createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" });
const preference = (id: string, index = 0, key = `collection-news-items-${deletionId(id)}`) => ({ id: `preference-${id}-${index}`,
  user: { relationTo: "users", value: `fixture-user-${index}` }, key, value: { fixture: true },
  createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" });
const input = (id: string) => ({ application: { name: "seed", args: { name: "mixed-task", priority: 2 } },
  product: { id, data: { title: "mixed-product", handle: "mixed-handle", status: "published" } },
  payload: { create: { headline: "mixed-news" }, update: { score: 7 }, deleteId: deletionId(id) } });

describe.each(["pglite", "postgres"] as const)("native Application/Product/Payload mixed graph (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withMixed = async (test: (database: Fixture, host: Host, id: string, scope: Scope.Scope) => Promise<void>,
    collection: CollectionConfig = newsCollection(), persistence: (database: Fixture) => Persistence = database => database.persistence, preferences = 1) => {
    const database = await fixture(postgres?.connectionString); const scope = await Effect.runPromise(Scope.make());
    try {
      const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
        fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }],
        indexes: [{ name: "by_priority", field: "priority" }] })));
      const host = await Effect.runPromise(createMixedHost(persistence(database), "shop-a", definition, applicationFunctions, collection)
        .pipe(Effect.provideService(Scope.Scope, scope)));
      await database.admin(db => db.insert(tables.definitions).values(host.definitions.filter(selected => selected.table !== database.definition.table)
        .map(selected => ({ table: selected.table, tableId: selected.tableId, fields: selected.fields, indexes: selected.indexes, equalities: selected.equalities, version: selected.version }))));
      const id = `prod_${randomUUID()}`;
      // Administrative native-shape data, through the same actual accepting
      // owner. This does not replace or claim native create/user APIs.
      await Effect.runPromise(Effect.gen(function* () {
        const selected = host.definitions.filter(item => item.tableId === null);
        const command = yield* database.commands.openFramework("shop-a", randomUUID(), "fixture", selected, randomUUID());
        const group = yield* createGroupRoot(database.persistence, command, selected);
        yield* Effect.gen(function* () {
          yield* group.withFramework(host.productDefinition.definition, root => Effect.gen(function* () {
            yield* root.insert(yield* host.productDefinition.seed(id, "original", "2026-10-27T00:00:00.000Z"));
          }));
          for (const selectedDefinition of selected) {
            if (selectedDefinition.table === "news-items") yield* group.withFramework(selectedDefinition, root => root.insert(oldDocument(id)));
            else if (selectedDefinition.table === "payload-preferences") yield* group.withFramework(selectedDefinition, root => Effect.gen(function* () {
              for (let index = 0; index < preferences; index++) yield* root.insert(preference(id, index));
            }));
          }
          yield* database.commands.accept(command, yield* group.freeze(), null);
        }).pipe(Effect.onExit(() => group.close));
      }));
      await test(database, host, id, scope);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };
  const onlySeed = async (database: Fixture, id: string) => {
    const documents = await database.admin(db => db.select().from(tables.documents));
    expect(documents).toHaveLength(3); expect(documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "product", id, body: expect.objectContaining({ title: "original", handle: id.replaceAll("_", "-"), status: "draft" }) }),
      expect.objectContaining({ table: "news-items", id: deletionId(id), body: oldDocument(id) }),
      expect.objectContaining({ table: "payload-preferences", id: preference(id).id, body: preference(id) }),
    ]));
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(3);
    expect(await database.admin(db => db.select().from(tables.eventIntents))).toHaveLength(3);
    expect(await database.admin(db => db.select().from(tables.clocks))).toEqual([{ scope: "shop-a", seq: 1 }]);
    expect((await database.admin(db => db.select().from(tables.commands))).map(command => command.status).toSorted()).toEqual(["aborted", "committed"]);
  };
  const writePreferences = (database: Fixture, host: Host, use: (root: Root) => Effect.Effect<unknown, CoreError>) => Effect.runPromise(Effect.gen(function* () {
    const definition = host.definitions.find(item => item.table === "payload-preferences"); if (definition === undefined) throw new Error("Missing selected preference definition");
    const command = yield* database.persistence.openCommand("framework", "shop-a", randomUUID(), "preference-writer", definition, randomUUID());
    const root = yield* createRoot(definition, database.storage, command);
    yield* Effect.gen(function* () {
      yield* use(root); yield* database.commands.accept(command, [frameworkCandidate(definition, yield* root.freeze())], null);
    }).pipe(Effect.onExit(() => root.close));
  }));

  it("runs native services/hooks and pending CRUD reads with one selected command and publication", async () => {
    let changes = 0; let reads = 0; let assertIdle = () => {};
    const collection = newsCollection(); collection.hooks = { afterChange: [({ doc }) => { assertIdle(); changes++; return doc; }],
      afterRead: [({ doc }) => { reads++; return doc; }] };
    await withMixed(async (database, host, id) => {
      assertIdle = () => { if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount); };
      const request = randomUUID(); const data = input(id); const result = await Effect.runPromise(host.execute(request, data));
      expect(result.application).toEqual(expect.stringMatching(/^7:/));
      expect(result.payload.created).toEqual({ id: expect.any(String), headline: "mixed-news", score: 0, createdAt: expect.any(String), updatedAt: expect.any(String) });
      expect(result.payload.updated).toEqual({ ...result.payload.created, score: 7, updatedAt: expect.any(String) });
      expect(result.payload.read).toEqual(result.payload.updated);
      expect(result.payload.deleted).toEqual(oldDocument(id));
      const before = await Effect.runPromise(host.productDefinition.seed(id, "mixed-product", "2026-10-27T00:00:00.000Z"));
      const native = { ...await Effect.runPromise(host.productDefinition.toNative(before)), handle: "mixed-handle", status: "published" };
      const product = Schema.decodeUnknownSync(Schema.Struct({ updated: Schema.JsonObject, retrieved: Schema.JsonObject, listed: Schema.Array(Schema.JsonObject) }))(result.product);
      expect(product.updated).toEqual({ ...native, updated_at: expect.any(String), options: [], tags: [], collection: null, type: null });
      expect(product.retrieved).toEqual({ ...native, updated_at: expect.any(String), collection: null, type: null });
      expect(product.listed).toEqual([product.retrieved]);
      const history = await database.admin(db => db.select().from(tables.history));
      expect(history.filter(row => row.commitSeq === 2).map(row => row.table).toSorted()).toEqual(["news-items", "news-items", "payload-preferences", "product", "tasks"]);
      expect(history.filter(row => row.commitSeq === 2 && row.body === null).map(row => row.id).toSorted()).toEqual([deletionId(id), preference(id).id].toSorted());
      const commands = await database.admin(db => db.select().from(tables.commands)); expect(commands).toHaveLength(2);
      const mixed = commands.find(command => command.profile === "mixed"); expect(mixed).toMatchObject({ status: "committed", commitSeq: 2, result });
      const events = await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.command, mixed?.id ?? "missing")));
      expect(events).toHaveLength(6); expect(events.map(event => event.ordinal).toSorted()).toEqual([0, 1, 2, 3, 4, 5]);
      expect(events.filter(event => event.event === "product.product.updated")).toEqual([expect.objectContaining({ document: id })]);
      expect(changes).toBe(2); expect(reads).toBe(4);
      expect(await Effect.runPromise(host.execute(request, data))).toEqual(result); expect(changes).toBe(2); expect(reads).toBe(4);
      expect(await failureOf(host.execute(request, { ...data, payload: { ...data.payload, deleteId: "another-id" } }))).toMatchObject({ reason: "identity" });
      expect(await failureOf(host.execute(request, { ...data, payload: { ...data.payload, update: { score: 9 } } }))).toMatchObject({ reason: "identity" });
      expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(2);
    }, collection);
  });

  it("rolls back every participant after a late native Payload hook failure", async () => {
    const collection = newsCollection(); collection.hooks = { afterChange: [({ operation }) => { if (operation === "update") throw new Error("mixed-late-hook"); }] };
    await withMixed(async (database, host, id) => {
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ _tag: "NativeFailure", cause: { message: "mixed-late-hook" } });
      await onlySeed(database, id);
    }, collection);
  });

  it.each([0, 2])("executes native mixed cleanup with %s matching user preferences", async count => withMixed(async (database, host, id) => {
    const result = await Effect.runPromise(host.execute(randomUUID(), input(id))); expect(result.payload.deleted).toEqual(oldDocument(id));
    expect(host.definitions).toHaveLength(4);
    const documents = await database.admin(db => db.select().from(tables.documents)); expect(documents).toHaveLength(3);
    expect(documents.filter(row => row.table === "payload-preferences" || row.id === deletionId(id))).toEqual([]);
    const history = await database.admin(db => db.select().from(tables.history));
    expect(history.filter(row => row.commitSeq === 2 && row.body === null).map(row => row.id).toSorted())
      .toEqual([deletionId(id), ...Array.from({ length: count }, (_, index) => preference(id, index).id)].toSorted());
    expect((await database.admin(db => db.select().from(tables.commands))).filter(command => command.profile === "mixed"))
      .toEqual([expect.objectContaining({ status: "committed", commitSeq: 2, result, definitions: expect.any(Array) })]);
  }, newsCollection(), database => database.persistence, count));

  it("rolls back earlier native changes, deleted document and preferences after a late delete hook failure", async () => {
    const collection = newsCollection(); collection.hooks = { afterDelete: [() => { throw new Error("mixed-cleanup-late-failure"); }] };
    await withMixed(async (database, host, id) => {
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ _tag: "NativeFailure", cause: { message: "mixed-cleanup-late-failure" } });
      await onlySeed(database, id);
    }, collection);
  });

  it("rolls back earlier participants when the native deleted document is missing", async () => withMixed(async (database, host, id) => {
    const data = input(id); data.payload.deleteId = "missing-document";
    expect(await failureOf(host.execute(randomUUID(), data))).toMatchObject({ _tag: "NativeFailure", cause: { status: 404 } });
    await onlySeed(database, id);
  }));

  it("latches a caught malformed final cleanup, revokes its escaped DAL and permits a fresh command", async () => {
    let misuse = true; let escaped: (() => Promise<unknown>) | undefined;
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ req, doc }) => {
      escaped = () => req.payload.db.deleteMany({ collection: "payload-preferences", req, where: { key: { in: ["foreign-key"] } } });
      if (misuse) { try { await escaped(); } catch { /* Witness: a caught adapter refusal must still abort every participant. */ } }
      return doc;
    }] };
    await withMixed(async (database, host, id) => {
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "unsupported" }); await onlySeed(database, id);
      const call = escaped; if (call === undefined) throw new Error("Missing escaped cleanup");
      const before = database.persistence.metrics.operations;
      await expect(Promise.resolve().then(call)).rejects.toMatchObject({ reason: "closed" });
      expect(database.persistence.metrics.operations).toBe(before);
      misuse = false; expect((await Effect.runPromise(host.execute(randomUUID(), input(id)))).payload.deleted).toEqual(oldDocument(id));
    }, collection);
  });

  it("signals and drains cancellation after actual native preference cleanup before any mixed publication", async () => {
    let ready = () => {}; let release = () => {}; let signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ req, doc }) => { signal = req.signal; ready(); await gate; return doc; }] };
    await withMixed(async (database, host, id) => {
      const controller = new AbortController(); let settled = false;
      const pending = Effect.runPromiseExit(host.execute(randomUUID(), input(id)), { signal: controller.signal }).then(result => { settled = true; return result; });
      try {
        await started; if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount);
        controller.abort(); await delay(10); expect(signal?.aborted).toBe(true); expect(settled).toBe(false);
        release(); const result = await pending; expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true); await onlySeed(database, id);
      } finally { release(); await pending; }
    }, collection);
  });

  it.each(["insert", "empty-insert", "update", "delete", "independent"] as const)("checks a concurrent preference %s before publishing any mixed participant", async operation => {
    let race = async () => {}; let deletions = 0;
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ doc }) => { deletions++; await race(); return doc; }] };
    await withMixed(async (database, host, id) => {
      race = () => writePreferences(database, host, root => Effect.gen(function* () {
        if (operation === "insert" || operation === "empty-insert" || operation === "independent") yield* root.insert(preference(id, 9,
          operation === "independent" ? "unrelated-key" : preference(id).key));
        else if (operation === "delete") yield* root.delete(preference(id).id);
        else {
          const before = yield* root.get(preference(id).id); if (before === null) throw new Error("Missing original preference");
          yield* root.replace({ ...before, key: "moved-away" });
        }
      }));
      const result = await Effect.runPromiseExit(host.execute(randomUUID(), input(id))); expect(deletions).toBe(1);
      const documents = await database.admin(db => db.select().from(tables.documents));
      if (operation === "independent") {
        expect(Exit.isSuccess(result)).toBe(true); expect(documents).toHaveLength(4);
        expect(documents.filter(row => row.id === deletionId(id) || row.id === preference(id).id)).toEqual([]);
        expect(documents.find(row => row.id === preference(id, 9).id)?.body).toEqual(preference(id, 9, "unrelated-key"));
      } else {
        expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "conflict" } });
        expect(documents.filter(row => row.table === "tasks")).toEqual([]);
        expect(documents.filter(row => row.table === "news-items").map(row => row.body)).toEqual([oldDocument(id)]);
        expect(documents.find(row => row.id === id)?.body).toMatchObject({ title: "original", handle: id.replaceAll("_", "-"), status: "draft" });
        expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toEqual([]);
      }
      expect((await database.admin(db => db.select().from(tables.commands))).filter(command => command.profile === "mixed"))
        .toEqual([expect.objectContaining({ status: operation === "independent" ? "committed" : "aborted" })]);
    }, collection, database => database.persistence, operation === "empty-insert" ? 0 : 1);
  });

  it("requires the selected preference definition before invoking any mixed native hook", async () => {
    let changes = 0;
    const collection = newsCollection(); collection.hooks = { afterChange: [({ doc }) => { changes++; return doc; }] };
    await withMixed(async (database, host, id) => {
      await database.admin(db => db.update(tables.definitions).set({ version: "retired" }).where(eq(tables.definitions.table, "payload-preferences")));
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "denied" }); expect(changes).toBe(0);
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(3);
      expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(3);
      expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(1);
    }, collection);
  });

  it("retains native Product absence and aborts the earlier authored mutation", async () => withMixed(async (database, host, id) => {
    expect(await failureOf(host.execute(randomUUID(), input("prod_missing")))).toMatchObject({ _tag: "NativeFailure", cause: { type: "not_found" } });
    await onlySeed(database, id);
  }));

  it("retains native Product duplicate-handle classification and aborts the earlier authored mutation", async () => withMixed(async (database, host, id) => {
    const definition = host.productDefinition.definition; const other = `prod_${randomUUID()}`;
    await Effect.runPromise(Effect.gen(function* () {
      const command = yield* database.persistence.openCommand("framework", "shop-a", randomUUID(), "occupied-handle", definition, randomUUID());
      const root = yield* createRoot(definition, database.storage, command);
      yield* root.insert({ ...yield* host.productDefinition.seed(other, "occupied", "2026-10-27T00:00:00.000Z"), handle: "mixed-handle" });
      yield* database.commands.accept(command, [frameworkCandidate(definition, yield* root.freeze())], null);
    }));
    expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ _tag: "NativeFailure", cause: { type: "invalid_data", cause: { reason: "unique" } } });
    const documents = await database.admin(db => db.select().from(tables.documents));
    expect(documents).toHaveLength(4); expect(documents.filter(row => row.table === "product")).toHaveLength(2);
    expect(documents.find(row => row.id === id)?.body).toMatchObject({ title: "original", handle: id.replaceAll("_", "-") });
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(4);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
  }));

  it("refuses unsafe or oversized mixed inputs before admission without invoking getters or native code", async () => withMixed(async (database, host, id) => {
    const before = database.persistence.metrics.operations; let getters = 0;
    const data = input(id);
    for (const unsafe of [{ ...data, product: { id, data: { get title() { getters++; return "unsafe"; } } } },
      Object.setPrototypeOf(input(id), { inherited: true }), { ...data, application: { name: "seed", args: { name: undefined, priority: 2 } } }]) {
      expect(await failureOf(host.execute(randomUUID(), unsafe))).toMatchObject({ reason: "invalid" });
    }
    expect(await failureOf(host.execute(randomUUID(), { ...data, product: { id, data: { title: "x".repeat(262145) } } }))).toMatchObject({ reason: "limit" });
    expect(getters).toBe(0); expect(database.persistence.metrics.operations).toBe(before);
    expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(1);
  }));

  it("checks current native create/update/read/delete access before exposing a saved mixed result", async () => {
    let denied: "create" | "update" | "read" | "delete" | null = null; let changes = 0;
    const collection = newsCollection(); collection.access = { create: () => denied !== "create", update: () => denied !== "update", read: () => denied !== "read", delete: () => denied !== "delete" };
    collection.hooks = { afterChange: [({ doc }) => { changes++; return doc; }] };
    await withMixed(async (database, host, id) => {
      const request = randomUUID(); const data = input(id); await Effect.runPromise(host.execute(request, data));
      for (const operation of ["create", "update", "read", "delete"] as const) {
        denied = operation;
        expect(await failureOf(host.execute(request, data))).toMatchObject({ _tag: "NativeFailure", cause: { status: 403 } });
      }
      expect(changes).toBe(2); expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(8);
      expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(2);
    }, collection);
  });

  it("refuses a caught unsupported nested Local API operation without publishing earlier participants", async () => {
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ doc, req, operation }) => {
      if (operation === "create") { try { await req.payload.findByID({ collection: collection.slug, id: doc.id, req }); } catch { /* Witness: caught native rejection must still poison the root. */ } }
      return doc;
    }] };
    await withMixed(async (database, host, id) => {
      expect(await Effect.runPromiseExit(host.execute(randomUUID(), input(id)))).toMatchObject({ _tag: "Failure" }); await onlySeed(database, id);
    }, collection);
  });

  it("latches a caught malformed adapter predicate inside a live native hook", async () => {
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ doc, req, operation }) => {
      if (operation === "update") {
        try { await req.payload.db.findOne({ collection: collection.slug, req, where: { score: { equals: 7 } } }); }
        catch { /* Witness: native code deliberately catches the adapter refusal. */ }
      }
      return doc;
    }] };
    await withMixed(async (database, host, id) => {
      expect(await Effect.runPromiseExit(host.execute(randomUUID(), input(id)))).toMatchObject({ _tag: "Failure" }); await onlySeed(database, id);
    }, collection);
  });

  it("decodes every saved participant result with its original native or metadata contract", async () => withMixed(async (database, host, id) => {
    const request = randomUUID(); const data = input(id); const result = await Effect.runPromise(host.execute(request, data));
    const corruptions = [{ ...result, application: 42 }, { ...result, product: { id, title: 42 } },
      { ...result, payload: { ...result.payload, created: { ...result.payload.created, headline: null } } },
      { ...result, payload: { ...result.payload, read: { ...result.payload.read, score: 99 } } },
      { ...result, payload: { ...result.payload, deleted: { ...result.payload.deleted, id: "different-id" } } }];
    for (const corrupted of corruptions) {
      await database.admin(db => db.update(tables.commands).set({ result: corrupted }).where(eq(tables.commands.request, request)));
      expect(await failureOf(host.execute(request, data))).toMatchObject({ reason: "storage" });
    }
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(8);
  }));

  it("refuses fresh revocation after native hooks complete", async () => {
    let revoke = async () => {};
    const collection = newsCollection(); collection.hooks = { afterDelete: [async ({ doc }) => { await revoke(); return doc; }] };
    await withMixed(async (database, host, id) => {
      revoke = async () => { await database.admin(db => db.update(tables.authorities).set({ enabled: false, fence: sql`${tables.authorities.fence}+1` })); };
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "denied" }); await onlySeed(database, id);
    }, collection);
  });

  it("retains an earlier native delete-read revocation refusal with its original adapter Cause", async () => {
    let revoke = async () => {};
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ operation, doc }) => { if (operation === "update") await revoke(); return doc; }] };
    await withMixed(async (database, host, id) => {
      revoke = async () => { await database.admin(db => db.update(tables.authorities).set({ enabled: false, fence: sql`${tables.authorities.fence}+1` })); };
      expect(Cause.findErrorOption(adapterCause(await failureOf(host.execute(randomUUID(), input(id)))))).toMatchObject({ value: { reason: "denied" } });
      await onlySeed(database, id);
    }, collection);
  });

  it("rejects a concurrent Product writer without publishing Application or Payload changes", async () => {
    let race = async () => {};
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ operation, doc }) => { if (operation === "update") await race(); return doc; }] };
    await withMixed(async (database, host, id, scope) => {
      const product = await Effect.runPromise(createProductHost(database.persistence, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      race = async () => { await Effect.runPromise(product.update(randomUUID(), id, { title: "concurrent-winner" })); };
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "conflict" });
      const documents = await database.admin(db => db.select().from(tables.documents)); expect(documents).toHaveLength(3);
      expect(documents).toEqual(expect.arrayContaining([expect.objectContaining({ table: "product", body: expect.objectContaining({ title: "concurrent-winner" }) }),
        expect.objectContaining({ table: "news-items", body: oldDocument(id) }), expect.objectContaining({ table: "payload-preferences", body: preference(id) })]));
      expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(4);
      expect((await database.admin(db => db.select().from(tables.eventIntents))).filter(event => event.event === "product.product.updated")).toHaveLength(1);
    }, collection);
  });

  it.each(["during-delete", "after-accept"] as const)("handles physical response loss at %s without repeating native hooks", async phase => {
    let changes = 0; let deletions = 0; let lose = false;
    const collection = newsCollection(); collection.hooks = { afterChange: [({ operation, doc }) => { changes++; if (operation === "update") lose = true; return doc; }],
      afterDelete: [({ doc }) => { deletions++; return doc; }] };
    await withMixed(async (database, host, id) => {
      if (phase === "during-delete") {
        expect(Cause.findErrorOption(adapterCause(await failureOf(host.execute(randomUUID(), input(id)))))).toMatchObject({ value: { reason: "storage", phase: "commit" } });
        expect(changes).toBe(2); expect(deletions).toBe(0); await onlySeed(database, id); return;
      }
      const result = await Effect.runPromise(host.execute(randomUUID(), input(id))); expect(changes).toBe(2); expect(deletions).toBe(1);
      expect(result.payload.read.score).toBe(7); expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(3);
      expect((await database.admin(db => db.select().from(tables.commands))).filter(command => command.profile === "mixed")).toEqual([expect.objectContaining({ status: "committed", result })]);
    }, collection, database => {
      const physical = database.servingPool === undefined ? { run: <A>(work: (db: Database) => Promise<A>) => database.serving.transaction(work) } : postgresSession(database.servingPool);
      return createPersistence({ run: async work => {
        const result = await physical.run(work);
        if (lose && (phase === "during-delete" || Schema.is(MixedResult)(result))) {
          const committed = (await database.admin(db => db.select().from(tables.commands))).filter(command => command.profile === "mixed" && command.status === "committed");
          expect(committed).toHaveLength(phase === "after-accept" ? 1 : 0);
          lose = false; throw new PhysicalFailure({ phase: "commit", cause: "Response loss after real physical transaction" });
        }
        return result;
      } });
    });
  });

  it("signals and drains cancellation in a native hook after Product work, then publishes nothing", async () => {
    let ready = () => {}; let release = () => {}; let signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ operation, req, doc }) => {
      if (operation === "update") { signal = req.signal; ready(); await gate; } return doc;
    }] };
    await withMixed(async (database, host, id) => {
      const controller = new AbortController(); let settled = false;
      const pending = Effect.runPromiseExit(host.execute(randomUUID(), input(id)), { signal: controller.signal }).then(result => { settled = true; return result; });
      try {
        await started; if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount);
        controller.abort(); await delay(10); expect(signal?.aborted).toBe(true); expect(settled).toBe(false);
        release(); const result = await pending; expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true); await onlySeed(database, id);
      } finally { release(); await pending; }
    }, collection);
  });
});
