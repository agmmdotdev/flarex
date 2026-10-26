import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductHost } from "../src/medusa-product.ts";
import { createRoot } from "../src/root.ts";
import { CoreError } from "../src/errors.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(effect)), {
  onSuccess: () => { throw new Error("Expected failure"); }, onFailure: error => error,
});
const object = Schema.decodeUnknownSync(Schema.JsonObject);
type ProductHost = Effect.Success<ReturnType<typeof createProductHost>>;
const barrier = () => {
  let ready = () => {}; let release = () => {};
  const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, started, gate };
};
const seedProduct = (database: Fixture, host: ProductHost, id: string) => Effect.runPromise(Effect.gen(function* () {
  const command = yield* database.storage.open("shop-a", randomUUID(), "product-fixture", host.prepared.definition, randomUUID());
  const root = yield* createRoot(host.prepared.definition, database.storage, command);
  yield* root.insert(yield* host.prepared.seed(id, "original", "2026-10-27T00:00:00.000Z"));
  const candidate = yield* root.freeze(); yield* database.storage.settle(command, candidate.changes, candidate.dependencies, null, candidate.events);
}));

describe.each(["pglite", "postgres"] as const)("native experimental Product (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withProduct = async (test: (database: Fixture, host: Effect.Success<ReturnType<typeof createProductHost>>, id: string) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString); const scope = await Effect.runPromise(Scope.make());
    try {
      const host = await Effect.runPromise(createProductHost(database.storage, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      const { definition } = host.prepared;
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version, fields: definition.fields }));
      const id = `prod_${randomUUID()}`;
      // Administrative seed for this update-only slice, through the same core
      // writer. It is not a substitute implementation of native createProducts.
      await seedProduct(database, host, id);
      await test(database, host, id);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };

  it("executes actual Product.updateProducts with complete values, one outcome and native event", async () => withProduct(async (database, host, id) => {
    const before = database.storage.metrics.operations;
    const request = randomUUID(); const result = object(await Effect.runPromise(host.update(request, id, { title: "updated" })));
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
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x".repeat(1_048_577) }))).toMatchObject({ reason: "invalid" });
    expect(database.storage.metrics.operations).toBe(operations);
    expect(await failureOf(host.update(randomUUID(), "prod_missing", { title: "missing" }))).toMatchObject({ _tag: "NativeFailure", cause: { type: "not_found" } });
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x", deleted_at: "y" }))).toMatchObject({ reason: "unsupported" });
    expect(await failureOf(host.update(randomUUID(), _id, { title: "x", options: [] }))).toMatchObject({ reason: "unsupported" });
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, _id)))).toHaveLength(1);
  }));

  it("rejects revocation at acceptance with no changed row or native event", async () => withProduct(async (database, host, id) => {
    const settle = database.storage.settle;
    database.storage.settle = (...args) => Effect.tryPromise({ try: () => database.admin(db => db.update(tables.authorities).set({ enabled: false })), catch: cause => new CoreError({ reason: "storage", cause }) }).pipe(Effect.andThen(settle(...args)));
    expect(await failureOf(host.update(randomUUID(), id, { title: "must-rollback" }))).toMatchObject({ reason: "denied" });
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(1);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
  }));

  it("resolves a lost accepting response without repeating the native update/event", async () => withProduct(async (database, host, id) => {
    database.loseNextCommitResponse(); const request = randomUUID();
    expect(object(await Effect.runPromise(host.update(request, id, { title: "once" }))).title).toBe("once");
    expect(object(await Effect.runPromise(host.update(request, id, { title: "once" }))).title).toBe("once");
    expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id)))).toHaveLength(2);
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
  }));

  it("refuses malformed recovered Product results after a confirmed real commit", async () => withProduct(async (database, host, id) => {
    const resolve = database.storage.resolve;
    database.storage.resolve = (...args) => resolve(...args).pipe(Effect.as({ id, title: 42 }));
    database.loseNextCommitResponse();
    expect(await failureOf(host.update(randomUUID(), id, { title: "committed" }))).toMatchObject({ reason: "storage" });
    expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: "committed" });
    expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(1);
  }));

  it.each(["same", "independent"] as const)("checks write predecessors with %s concurrent Product writers", async mode => withProduct(async (database, host, id) => {
    const other = mode === "same" ? id : `prod_${randomUUID()}`; if (mode === "independent") await seedProduct(database, host, other);
    const pause = barrier(); const request = randomUUID(); const settle = database.storage.settle;
    database.storage.settle = (...args) => args[0].request !== request ? settle(...args) : Effect.sync(pause.ready)
      .pipe(Effect.andThen(Effect.promise(() => pause.gate)), Effect.andThen(settle(...args)));
    const pending = Effect.runPromiseExit(host.update(request, id, { title: "first" }));
    try { await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      await Effect.runPromise(host.update(randomUUID(), other, { title: "second" })); pause.release(); const result = await pending;
      if (mode === "same") expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "conflict" } });
      else expect(Exit.isSuccess(result)).toBe(true);
      expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: mode === "same" ? "second" : "first" });
      expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(mode === "same" ? 1 : 2);
    } finally { pause.release(); await Promise.allSettled([pending]); }
  }));

  it("signals and drains cancellation after a completed read without publishing native effects", async () => withProduct(async (database, host, id) => {
    const pause = barrier(); const observe = database.storage.observeRows; let held = false;
    database.storage.observeRows = (...args) => observe(...args).pipe(Effect.tap(() => {
      if (held) return Effect.void; held = true; pause.ready(); return Effect.promise(() => pause.gate);
    }));
    const controller = new AbortController(); let settled = false;
    const pending = Effect.runPromiseExit(host.update(randomUUID(), id, { title: "cancelled" }), { signal: controller.signal }).then(exit => { settled = true; return exit; });
    try { await pause.started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      controller.abort(); await new Promise<void>(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
      pause.release(); const result = await pending; expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
      expect(await Effect.runPromise(database.storage.read("shop-a", host.prepared.definition, id))).toMatchObject({ title: "original" });
      expect(await database.admin(db => db.select().from(tables.eventIntents).where(eq(tables.eventIntents.event, "product.product.updated")))).toHaveLength(0);
    } finally { pause.release(); await Promise.allSettled([pending]); }
  }));

  it("retains detached nested metadata across repeated native reads and serialization", async () => withProduct(async (database, host, id) => {
    const command = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "nested-writer", host.prepared.definition, randomUUID()));
    const root = await Effect.runPromise(createRoot(host.prepared.definition, database.storage, command));
    const original = await Effect.runPromise(root.get(id)); if (original === null) throw new Error("Missing Product");
    const metadata = { nested: { value: 1 } }; await Effect.runPromise(root.replace({ ...original, metadata })); metadata.nested.value = 99;
    const pending = await Effect.runPromise(root.get(id)); const decoded = Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Struct({ nested: Schema.Struct({ value: Schema.Number }) }) }))(pending);
    expect(Reflect.set(decoded.metadata.nested, "value", 50)).toBe(true);
    expect(await Effect.runPromise(root.get(id))).toMatchObject({ metadata: { nested: { value: 1 } } });
    const candidate = await Effect.runPromise(root.freeze()); await Effect.runPromise(database.storage.settle(command, candidate.changes, candidate.dependencies, null, candidate.events));
    expect(object(await Effect.runPromise(host.update(randomUUID(), id, { title: "with-metadata" })))).toMatchObject({ metadata: { nested: { value: 1 } } });
  }));
});
