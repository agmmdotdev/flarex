import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductBinding, createProductHost } from "../src/medusa-product.ts";
import { createRoot } from "../src/root.ts";
import { CoreError } from "../src/errors.ts";
import { createPersistence, type Database, type Persistence } from "../src/persistence.ts";
import { PhysicalFailure, postgresSession } from "../src/session.ts";
import { createFrameworkReads } from "../src/framework-read.ts";
import { frameworkCandidate } from "../src/group-storage.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(effect)), {
  onSuccess: () => { throw new Error("Expected failure"); }, onFailure: error => error,
});
const object = Schema.decodeUnknownSync(Schema.JsonObject);
const isProductResult = Schema.is(Schema.Struct({ id: Schema.String, title: Schema.String, created_at: Schema.String, updated_at: Schema.String }));
const isObservation = Schema.is(Schema.Array(Schema.Struct({ body: Schema.NullOr(Schema.JsonObject) })));
const isUniqueObservation = Schema.is(Schema.Array(Schema.Struct({ field: Schema.String, key: Schema.String, owner: Schema.NullOr(Schema.String) })));
type ProductHost = Effect.Success<ReturnType<typeof createProductHost>>;
const barrier = () => {
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, started, gate };
};
const seedProduct = (database: Fixture, host: ProductHost, id: string) => Effect.runPromise(Effect.gen(function* () {
  const command = yield* database.persistence.openCommand("framework", "shop-a", randomUUID(), "product-fixture", host.prepared.definition, randomUUID());
  const root = yield* createRoot(host.prepared.definition, database.storage, command);
  yield* root.insert(yield* host.prepared.seed(id, "original", "2026-10-27T00:00:00.000Z"));
  const candidate = yield* root.freeze(); yield* database.commands.accept(command, [frameworkCandidate(host.prepared.definition, candidate)], null);
}));

describe.each(["pglite", "postgres"] as const)("native experimental Product (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withProduct = async (test: (database: Fixture, host: Effect.Success<ReturnType<typeof createProductHost>>, id: string) => Promise<void>,
    transport: (database: Fixture) => Persistence = database => database.persistence) => {
    const database = await fixture(postgres?.connectionString); const scope = await Effect.runPromise(Scope.make());
    try {
      const host = await Effect.runPromise(createProductHost(transport(database), "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      const { definition } = host.prepared;
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version, fields: definition.fields, equalities: definition.equalities }));
      const id = `prod_${randomUUID()}`;
      // Administrative seed for this update-only slice, through the same core
      // writer. It is not a substitute implementation of native createProducts.
      await seedProduct(database, host, id);
      await test(database, host, id);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };

  it("executes actual Product.updateProducts with complete values, one outcome and native event", async () => withProduct(async (database, host, id) => {
    const before = database.storage.metrics.operations;
    const request = randomUUID(); const result = object(await Effect.runPromise(host.update(request, id, { title: "updated", handle: undefined, status: undefined })));
    expect(result).toMatchObject({ id, title: "updated", handle: id.replaceAll("_", "-"), is_giftcard: false, discountable: true, status: "draft",
      metadata: null, deleted_at: null, options: [], tags: [], collection: null, type: null });
    for (const relation of ["variants", "images", "categories"]) expect(Object.hasOwn(result, relation)).toBe(false);
    expect(database.storage.metrics.operations - before).toBe(4); // open, first row, unique key, accept; repeated native reads are local.
    const persisted = await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id));
    expect(persisted).toMatchObject({ title: "updated", createdAt: "2026-10-27T00:00:00.000Z" });
    const events = await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")));
    expect(events).toEqual([expect.objectContaining({ document: id, body: { name: "product.product.updated", metadata: { source: "product", object: "product", action: "updated" }, data: { id } } })]);
    expect(await database.admin(db => db.select({ n: count() }).from(tables.history).where(eq(tables.history.id, id)))).toEqual([{ n: 2 }]);
    expect(await Effect.runPromise(host.update(request, id, { title: "updated" }))).toEqual(result);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
  }));

  it("preserves native missing Product failure and refuses managed or relation changes", async () => withProduct(async (database, host, _id) => {
    const operations = database.storage.metrics.operations; let reads = 0;
    expect(await failureOf(host.update(randomUUID(), _id, { get title() { reads++; return "getter"; } }))).toMatchObject({ reason: "invalid" });
    expect(reads).toBe(0);
    expect(await failureOf(host.update(randomUUID(), _id, Object.setPrototypeOf({ title: "prototype" }, { inherited: true })))).toMatchObject({ reason: "invalid" });
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x".repeat(1_048_577) }))).toMatchObject({ reason: "limit" });
    expect(await failureOf(host.update(randomUUID(), _id, { status: "unknown" }))).toMatchObject({ reason: "unsupported" });
    expect(await failureOf(host.update(randomUUID(), _id, { handle: "bad\u0000handle" }))).toMatchObject({ reason: "unsupported" });
    expect(await failureOf(host.update(randomUUID(), "bad\ud800id", { title: "x" }))).toMatchObject({ reason: "invalid" });
    expect(database.storage.metrics.operations).toBe(operations);
    expect(await failureOf(host.update(randomUUID(), "prod_missing", { title: "missing" }))).toMatchObject({ _tag: "NativeFailure", cause: { type: "not_found" } });
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x", deleted_at: "y" }))).toMatchObject({ reason: "unsupported" });
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x", options: [] }))).toMatchObject({ reason: "unsupported" });
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, _id)))).toHaveLength(1);
  }));

  it("rejects revocation at acceptance with no changed row or native event", async () => withProduct(async (database, host, id) => {
    expect(await failureOf(host.update(randomUUID(), id, { title: "must-rollback" }))).toMatchObject({ reason: "denied" });
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(1);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
  }, database => ({ ...database.persistence, operation: work => database.persistence.operation(work).pipe(Effect.tap(result => {
    if (!isUniqueObservation(result) || result.length === 0) return Effect.void;
    // Revoke after the last physical observation has closed. Opening an admin
    // transaction from inside PGlite's single active transaction deadlocks the
    // fixture; native result/event processing and acceptance still follow.
    return Effect.tryPromise({ try: () => database.admin(db => db.update(tables.authorities).set({ enabled: false })),
      catch: cause => new CoreError({ reason: "storage", cause }) });
  })) })));

  const responseLoss = (database: Fixture, malformed: boolean): Persistence => {
    const physical = database.servingPool === undefined ? { run: <A>(work: (db: Database) => Promise<A>) => database.serving.transaction(work) } : postgresSession(database.servingPool);
    let lose = true;
    const persistence = createPersistence({ run: async work => {
      const result = await physical.run(work);
      if (lose && isProductResult(result)) {
        expect((await database.admin(db => db.select().from(tables.commands))).some(command => command.status === "committed" &&
          isProductResult(command.result) && command.result.id === result.id)).toBe(true);
        lose = false; throw new PhysicalFailure({ phase: "commit", cause: "Lost actual Product acceptance response" });
      }
      return result;
    } });
    return malformed ? { ...persistence, resolve: (...args) => persistence.resolve(...args).pipe(Effect.as({ bad: true })) } : persistence;
  };
  it("resolves a lost accepting response without repeating the native update/event", async () => withProduct(async (database, host, id) => {
    const request = randomUUID();
    expect(object(await Effect.runPromise(host.update(request, id, { title: "once" }))).title).toBe("once");
    expect(object(await Effect.runPromise(host.update(request, id, { title: "once" }))).title).toBe("once");
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(2);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
  }, database => responseLoss(database, false)));

  it("refuses malformed recovered Product results after a confirmed real commit", async () => withProduct(async (database, host, id) => {
    expect(await failureOf(host.update(randomUUID(), id, { title: "committed" }))).toMatchObject({ reason: "storage" });
    expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: "committed" });
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
  }, database => responseLoss(database, true)));

  const pauseAfterRead = (database: Fixture, pause: ReturnType<typeof barrier>): Persistence => {
    let held = false;
    return { ...database.persistence, operation: work => database.persistence.operation(work).pipe(Effect.tap(result => {
      if (held || !isObservation(result) || result.length !== 1 || result[0]?.body?.title !== "original") return Effect.void;
      held = true; pause.ready(); return Effect.promise(() => pause.gate);
    })) };
  };
  it.each(["same", "independent"] as const)("checks write predecessors with %s concurrent Product writers", async mode => {
    const pause = barrier();
    return withProduct(async (database, host, id) => {
    const other = mode === "same" ? id : `prod_${randomUUID()}`; if (mode === "independent") await seedProduct(database, host, other);
    const request = randomUUID();
    const pending = Effect.runPromiseExit(host.update(request, id, { title: "first" }));
    try { await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      await Effect.runPromise(host.update(randomUUID(), other, { title: "second" })); pause.release(); const result = await pending;
      if (mode === "same") expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "conflict" } });
      else expect(Exit.isSuccess(result)).toBe(true);
      expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: mode === "same" ? "second" : "first" });
      expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(mode === "same" ? 1 : 2);
    } finally { pause.release(); await Promise.allSettled([pending]); }
    }, database => pauseAfterRead(database, pause));
  });

  it("signals and drains cancellation after a completed read without publishing native effects", async () => {
    const pause = barrier();
    return withProduct(async (database, host, id) => {
    const controller = new AbortController(); let settled = false;
    const pending = Effect.runPromiseExit(host.update(randomUUID(), id, { title: "cancelled" }), { signal: controller.signal }).then(exit => { settled = true; return exit; });
    try { await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      controller.abort(); await new Promise<void>(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
      pause.release(); const result = await pending; expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
      expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: "original" });
      expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
    } finally { pause.release(); await Promise.allSettled([pending]); }
    }, database => pauseAfterRead(database, pause));
  });

  it("runs native persisted retrieve/list without mutation reservation or publication", async () => withProduct(async (database, host, id) => {
    await Effect.runPromise(host.update(randomUUID(), id, { title: "published", handle: "new-handle", status: "published" }));
    const commands = await database.admin(db => db.select().from(tables.commands));
    const clock = await database.admin(db => db.select().from(tables.clocks));
    const before = database.persistence.metrics.operations;
    const retrieved = await Effect.runPromise(host.retrieve(id));
    expect(retrieved).toMatchObject({ id, title: "published", handle: "new-handle", status: "published" });
    expect(retrieved).toMatchObject({ collection: null, type: null });
    for (const key of ["options", "tags", "images", "variants", "categories"]) expect(Object.hasOwn(retrieved, key)).toBe(false);
    expect(await Effect.runPromise(host.listByHandle("new-handle"))).toEqual([retrieved]);
    expect(await Effect.runPromise(host.listByHandle(id.replaceAll("_", "-")))).toEqual([]);
    expect(database.persistence.metrics.operations - before).toBe(3);
    expect(await database.admin(db => db.select().from(tables.commands))).toEqual(commands);
    expect(await database.admin(db => db.select().from(tables.clocks))).toEqual(clock);
    expect(await failureOf(host.retrieve("prod_missing"))).toMatchObject({ _tag: "NativeFailure", cause: { type: "not_found" } });
    const operations = database.persistence.metrics.operations;
    expect(await failureOf(host.listByHandle("x".repeat(262144)))).toMatchObject({ reason: "limit" });
    expect(await failureOf(host.retrieve("bad\u0000id"))).toMatchObject({ reason: "invalid" });
    expect(database.persistence.metrics.operations).toBe(operations);
    await database.admin(db => db.update(tables.authorities).set({ enabled: false }));
    expect(await failureOf(host.retrieve(id))).toMatchObject({ reason: "denied" });
    expect(await failureOf(host.listByHandle("new-handle"))).toMatchObject({ reason: "denied" });
  }));

  it("preserves native duplicate-handle classification and rolls back a pre-existing claim", async () => withProduct(async (database, host, id) => {
    const other = `prod_${randomUUID()}`; await seedProduct(database, host, other);
    const before = await Effect.runPromise(host.retrieve(id)); const target = other.replaceAll("_", "-");
    expect(await failureOf(host.update(randomUUID(), id, { title: "must-rollback", handle: target })))
      .toMatchObject({ _tag: "NativeFailure", cause: { type: "invalid_data", message: "Product with this handle already exists.", cause: { reason: "unique" } } });
    expect(await Effect.runPromise(host.retrieve(id))).toEqual(before);
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(2);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
  }));

  it("projects a concurrent accepting handle claim without changing the losing row or events", async () => {
    const pause = barrier(); let held = false;
    await withProduct(async (database, host, id) => {
      const other = `prod_${randomUUID()}`; await seedProduct(database, host, other);
      const before = await Effect.runPromise(host.retrieve(id));
      const pending = Effect.runPromiseExit(host.update(randomUUID(), id, { title: "loser", handle: "claimed-handle" }));
      try {
        await pause.started;
        if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount);
        await Effect.runPromise(host.update(randomUUID(), other, { title: "winner", handle: "claimed-handle" }));
        pause.release(); const result = await pending;
        expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { _tag: "NativeFailure", cause: { type: "invalid_data", cause: { reason: "unique" } } } });
        expect(await Effect.runPromise(host.retrieve(id))).toEqual(before);
        expect(await Effect.runPromise(host.retrieve(other))).toMatchObject({ title: "winner", handle: "claimed-handle" });
        expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(3);
        expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toEqual([expect.objectContaining({ document: other })]);
      } finally { pause.release(); await pending; }
    }, database => ({ ...database.persistence, operation: work => database.persistence.operation(work).pipe(Effect.tap(result => {
      if (held || !isUniqueObservation(result) || !result.some(claim => claim.key === JSON.stringify("claimed-handle") && claim.owner === null)) return Effect.void;
      held = true; pause.ready(); return Effect.promise(() => pause.gate);
    })) }));
  });

  it.each(["retrieve", "list"] as const)("owns and drains a direct binding %s when its own Scope closes", async operation => withProduct(async (database, host, id) => {
    const scope = await Effect.runPromise(Scope.make()); const pause = barrier();
    const binding = await Effect.runPromise(createProductBinding().pipe(Effect.provideService(Scope.Scope, scope)));
    const reads = createFrameworkReads(database.persistence); let closed = false;
    const pending = Effect.runPromiseExit(reads.withRead("shop-a", host.prepared.definition, reader => {
      const wait = Effect.sync(pause.ready).pipe(Effect.andThen(Effect.promise(() => pause.gate)));
      const borrowed = { ...reader, get: (point: string) => reader.get(point).pipe(Effect.tap(() => wait)),
        equalRows: (selection: Parameters<typeof reader.equalRows>[0]) => reader.equalRows(selection).pipe(Effect.tap(() => wait)) };
      if (operation === "retrieve") return binding.retrieve(borrowed, id).pipe(Effect.asVoid);
      return binding.list(borrowed, id.replaceAll("_", "-")).pipe(Effect.asVoid);
    }));
    let closing: Promise<void> | undefined;
    try {
      await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.idleCount).toBe(database.servingPool.totalCount);
      closing = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => { closed = true; });
      await new Promise<void>(resolve => setTimeout(resolve, 20)); expect(closed).toBe(false);
      pause.release(); const result = await pending; await closing;
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
      expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(1);
    } finally { pause.release(); await Promise.allSettled([pending, closing, Effect.runPromise(Scope.close(scope, Exit.void))]); }
  }));

  it("runs the complete native update/retrieve/list graph over pending indexed state and replays once", async () => withProduct(async (database, host, id) => {
    const request = randomUUID(); const data = { title: "graph-product", handle: "graph-handle", status: "published" };
    const result = await Effect.runPromise(host.graph(request, id, data));
    expect(result.updated).toMatchObject({ id, ...data, options: [], tags: [] });
    expect(result.retrieved).toMatchObject({ id, ...data }); expect(result.listed).toEqual([result.retrieved]);
    expect(await Effect.runPromise(host.retrieve(id))).toEqual(result.retrieved);
    expect(await Effect.runPromise(host.graph(request, id, data))).toEqual(result);
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(2);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
    expect(await failureOf(host.update(request, id, data))).toMatchObject({ reason: "identity" });
    await database.admin(db => db.update(tables.commands).set({ result: { ...result, retrieved: { ...result.retrieved, title: "inconsistent" } } }).where(eq(tables.commands.request, request)));
    expect(await failureOf(host.graph(request, id, data))).toMatchObject({ reason: "storage" });
  }));

  it.skipIf(driver !== "postgres")("keeps a handle acquisition at its observed sequence across a concurrent commit", async () => {
    let race = async () => {}; let armed = false;
    await withProduct(async (database, host, id) => {
      const previous = id.replaceAll("_", "-");
      race = async () => { await Effect.runPromise(Effect.scoped(createProductHost(database.persistence, "shop-a").pipe(Effect.flatMap(writer =>
        writer.update(randomUUID(), id, { title: "concurrent", handle: "concurrent-handle", status: "published" }))))); };
      armed = true;
      expect(await Effect.runPromise(host.listByHandle(previous))).toEqual([expect.objectContaining({ id, title: "original", handle: previous })]);
      expect(await Effect.runPromise(host.listByHandle(previous))).toEqual([]);
      expect(await Effect.runPromise(host.listByHandle("concurrent-handle"))).toEqual([expect.objectContaining({ id, title: "concurrent" })]);
      expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(2);
    }, database => ({ ...database.persistence, readAuthority: async (transaction, scope, definitions) => {
      const authority = await database.persistence.readAuthority(transaction, scope, definitions);
      if (armed) { armed = false; await race(); }
      return authority;
    } }));
  });

  it("revokes a read capability and latches a caught second acquisition without reserving a command", async () => withProduct(async (database, host, id) => {
    const reads = createFrameworkReads(database.persistence); let escaped: ReturnType<typeof reads.withRead> | undefined;
    const result = await Effect.runPromiseExit(reads.withRead("shop-a", host.prepared.definition, reader => Effect.gen(function* () {
      escaped = reader.get(id); yield* reader.get(id);
      yield* reader.get(id).pipe(Effect.catchTag("CoreError", error => Effect.sync(() => { expect(error.reason).toBe("unsupported"); })));
      return null;
    })));
    expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "unsupported" } });
    if (escaped === undefined) throw new Error("Missing escaped read");
    expect(await failureOf(escaped)).toMatchObject({ reason: "closed" });
    expect(await database.admin(db => db.select().from(tables.commands))).toHaveLength(1);
  }));

  it("retains detached nested metadata across repeated native reads and serialization", async () => withProduct(async (database, host, id) => {
    const command = await Effect.runPromise(database.persistence.openCommand("framework", "shop-a", randomUUID(), "nested-writer", host.prepared.definition, randomUUID()));
    const root = await Effect.runPromise(createRoot(host.prepared.definition, database.storage, command));
    const original = await Effect.runPromise(root.get(id)); if (original === null) throw new Error("Missing Product");
    const metadata = { nested: { value: 1 } }; await Effect.runPromise(root.replace({ ...original, metadata })); metadata.nested.value = 99;
    const pending = await Effect.runPromise(root.get(id)); const decoded = Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Struct({ nested: Schema.Struct({ value: Schema.Number }) }) }))(pending);
    expect(Reflect.set(decoded.metadata.nested, "value", 50)).toBe(true);
    expect(await Effect.runPromise(root.get(id))).toMatchObject({ metadata: { nested: { value: 1 } } });
    const candidate = await Effect.runPromise(root.freeze()); await Effect.runPromise(database.commands.accept(command, [frameworkCandidate(host.prepared.definition, candidate)], null));
    expect(object(await Effect.runPromise(host.update(randomUUID(), id, { title: "with-metadata" })))).toMatchObject({ metadata: { nested: { value: 1 } } });
  }));
});
