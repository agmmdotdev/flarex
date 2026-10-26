import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionConfig } from "payload";
import { createMixedHost, MixedResult } from "../src/mixed.ts";
import { compileDefinition } from "../src/definition.ts";
import { createRoot } from "../src/root.ts";
import { createProductHost } from "../src/medusa-product.ts";
import { createPersistence, type Database, type Persistence } from "../src/persistence.ts";
import { PhysicalFailure, postgresSession } from "../src/session.ts";
import { applicationFunctions } from "./application-corpus.ts";
import { fixture, newsCollection, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

type Host = Effect.Success<ReturnType<typeof createMixedHost>>;
const failureOf = async <A, E>(work: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(work)), {
  onSuccess: () => { throw new Error("Expected failure"); }, onFailure: error => error,
});
const input = (id: string) => ({ application: { name: "seed", args: { name: "mixed-task", priority: 2 } },
  product: { id, title: "mixed-product" }, payload: { create: { headline: "mixed-news" }, update: { score: 7 } } });

describe.each(["pglite", "postgres"] as const)("native Application/Product/Payload mixed graph (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withMixed = async (test: (database: Fixture, host: Host, id: string, scope: Scope.Scope) => Promise<void>,
    collection: CollectionConfig = newsCollection(), persistence: (database: Fixture) => Persistence = database => database.persistence) => {
    const database = await fixture(postgres?.connectionString); const scope = await Effect.runPromise(Scope.make());
    try {
      const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
        fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }],
        indexes: [{ name: "by_priority", field: "priority" }] })));
      const host = await Effect.runPromise(createMixedHost(persistence(database), "shop-a", definition, applicationFunctions, collection)
        .pipe(Effect.provideService(Scope.Scope, scope)));
      await database.admin(db => db.insert(tables.definitions).values(host.definitions.filter(selected => selected.table !== database.definition.table)
        .map(selected => ({ table: selected.table, tableId: selected.tableId, fields: selected.fields, indexes: selected.indexes, version: selected.version }))));
      const id = `prod_${randomUUID()}`;
      await Effect.runPromise(Effect.gen(function* () {
        const command = yield* database.storage.open("shop-a", randomUUID(), "fixture", host.productDefinition.definition, randomUUID());
        const root = yield* createRoot(host.productDefinition.definition, database.storage, command);
        yield* root.insert(yield* host.productDefinition.seed(id, "original", "2026-10-27T00:00:00.000Z"));
        const frozen = yield* root.freeze(); yield* database.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events);
      }));
      await test(database, host, id, scope);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };
  const onlySeed = async (database: Fixture, id: string) => {
    expect(await database.admin(db => db.select().from(tables.documents))).toEqual([expect.objectContaining({ table: "product", id, body: expect.objectContaining({ title: "original" }) })]);
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(1);
    expect(await database.admin(db => db.select().from(tables.eventIntents))).toHaveLength(1);
    expect(await database.admin(db => db.select().from(tables.clocks))).toEqual([{ scope: "shop-a", seq: 1 }]);
    expect((await database.admin(db => db.select().from(tables.commands))).map(command => command.status).toSorted()).toEqual(["aborted", "committed"]);
  };

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
      const before = await Effect.runPromise(host.productDefinition.seed(id, "mixed-product", "2026-10-27T00:00:00.000Z"));
      const native = await Effect.runPromise(host.productDefinition.toNative(before));
      expect(result.product).toEqual({ ...native, updated_at: expect.any(String), options: [], tags: [], collection: null, type: null });
      const history = await database.admin(db => db.select().from(tables.history));
      expect(history.filter(row => row.commitSeq === 2).map(row => row.table).toSorted()).toEqual(["news-items", "product", "tasks"]);
      const commands = await database.admin(db => db.select().from(tables.commands)); expect(commands).toHaveLength(2);
      const mixed = commands.find(command => command.profile === "mixed"); expect(mixed).toMatchObject({ status: "committed", commitSeq: 2, result });
      const events = await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.command, mixed?.id ?? "missing")));
      expect(events).toHaveLength(4); expect(events.map(event => event.ordinal).toSorted()).toEqual([0, 1, 2, 3]);
      expect(events.filter(event => event.event === "product.product.updated")).toEqual([expect.objectContaining({ document: id })]);
      expect(changes).toBe(2); expect(reads).toBe(3);
      expect(await Effect.runPromise(host.execute(request, data))).toEqual(result); expect(changes).toBe(2); expect(reads).toBe(3);
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

  it("retains native Product absence and aborts the earlier authored mutation", async () => withMixed(async (database, host, id) => {
    expect(await failureOf(host.execute(randomUUID(), input("prod_missing")))).toMatchObject({ _tag: "NativeFailure", cause: { type: "not_found" } });
    await onlySeed(database, id);
  }));

  it("refuses unsafe or oversized mixed inputs before admission without invoking getters or native code", async () => withMixed(async (database, host, id) => {
    const before = database.persistence.metrics.operations; let getters = 0;
    const data = input(id);
    for (const unsafe of [{ ...data, product: { id, get title() { getters++; return "unsafe"; } } },
      Object.setPrototypeOf(input(id), { inherited: true }), { ...data, application: { name: "seed", args: { name: undefined, priority: 2 } } }]) {
      expect(await failureOf(host.execute(randomUUID(), unsafe))).toMatchObject({ reason: "invalid" });
    }
    expect(await failureOf(host.execute(randomUUID(), { ...data, product: { id, title: "x".repeat(262145) } }))).toMatchObject({ reason: "limit" });
    expect(getters).toBe(0); expect(database.persistence.metrics.operations).toBe(before);
    expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(1);
  }));

  it("checks current native create/update/read access before exposing a saved mixed result", async () => {
    let denied: "create" | "update" | "read" | null = null; let changes = 0;
    const collection = newsCollection(); collection.access = { create: () => denied !== "create", update: () => denied !== "update", read: () => denied !== "read", delete: () => true };
    collection.hooks = { afterChange: [({ doc }) => { changes++; return doc; }] };
    await withMixed(async (database, host, id) => {
      const request = randomUUID(); const data = input(id); await Effect.runPromise(host.execute(request, data));
      for (const operation of ["create", "update", "read"] as const) {
        denied = operation;
        expect(await failureOf(host.execute(request, data))).toMatchObject({ _tag: "NativeFailure", cause: { status: 403 } });
      }
      expect(changes).toBe(2); expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(4);
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
      { ...result, payload: { ...result.payload, read: { ...result.payload.read, score: 99 } } }];
    for (const corrupted of corruptions) {
      await database.admin(db => db.update(tables.commands).set({ result: corrupted }).where(eq(tables.commands.request, request)));
      expect(await failureOf(host.execute(request, data))).toMatchObject({ reason: "storage" });
    }
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(4);
  }));

  it("refuses fresh revocation after native hooks complete", async () => {
    let revoke = async () => {};
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ operation, doc }) => { if (operation === "update") await revoke(); return doc; }] };
    await withMixed(async (database, host, id) => {
      revoke = async () => { await database.admin(db => db.update(tables.authorities).set({ enabled: false, fence: sql`${tables.authorities.fence}+1` })); };
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "denied" }); await onlySeed(database, id);
    }, collection);
  });

  it("rejects a concurrent Product writer without publishing Application or Payload changes", async () => {
    let race = async () => {};
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ operation, doc }) => { if (operation === "update") await race(); return doc; }] };
    await withMixed(async (database, host, id, scope) => {
      const product = await Effect.runPromise(createProductHost(database.storage, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      race = async () => { await Effect.runPromise(product.update(randomUUID(), id, { title: "concurrent-winner" })); };
      expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "conflict" });
      expect(await database.admin(db => db.select().from(tables.documents))).toEqual([expect.objectContaining({ table: "product", body: expect.objectContaining({ title: "concurrent-winner" }) })]);
      expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(2);
      expect((await database.admin(db => db.select().from(tables.eventIntents))).filter(event => event.event === "product.product.updated")).toHaveLength(1);
    }, collection);
  });

  it.each(["before-accept", "after-accept"] as const)("handles physical response loss at %s without repeating native hooks", async phase => {
    let changes = 0; let lose = false;
    const collection = newsCollection(); collection.hooks = { afterChange: [({ operation, doc }) => { changes++; if (operation === "update") lose = true; return doc; }] };
    await withMixed(async (database, host, id) => {
      if (phase === "before-accept") {
        expect(await failureOf(host.execute(randomUUID(), input(id)))).toMatchObject({ reason: "storage", phase: "commit" });
        expect(changes).toBe(2); await onlySeed(database, id); return;
      }
      const result = await Effect.runPromise(host.execute(randomUUID(), input(id))); expect(changes).toBe(2);
      expect(result.payload.read.score).toBe(7); expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(3);
      expect((await database.admin(db => db.select().from(tables.commands))).filter(command => command.profile === "mixed")).toEqual([expect.objectContaining({ status: "committed", result })]);
    }, collection, database => {
      const physical = database.servingPool === undefined ? { run: <A>(work: (db: Database) => Promise<A>) => database.serving.transaction(work) } : postgresSession(database.servingPool);
      return createPersistence({ run: async work => {
        const result = await physical.run(work);
        if (lose && (phase === "before-accept" || Schema.is(MixedResult)(result))) {
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
