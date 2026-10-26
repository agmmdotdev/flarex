import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit, Result, Scope } from "effect";
import { ValidationError } from "payload";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPayloadHost } from "../src/payload.ts";
import { createRoot } from "../src/root.ts";
import { fixture, newsCollection, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";
import { postgresSession, PhysicalFailure } from "../src/session.ts";

const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(effect)), {
  onSuccess: () => { throw new Error("Expected a failure"); }, onFailure: error => error,
});

const readCounts = async (database: Fixture) => database.admin(async db => [{
  documents: (await db.select({ count: count() }).from(tables.documents))[0]?.count,
  history: (await db.select({ count: count() }).from(tables.history))[0]?.count,
  events: (await db.select({ count: count() }).from(tables.eventIntents))[0]?.count,
  committed: (await db.select({ count: count() }).from(tables.commands).where(eq(tables.commands.status, "committed")))[0]?.count,
}]);

describe.each(["pglite", "postgres"] as const)("complete experimental Payload create (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withHost = async (test: (context: Fixture, host: Effect.Success<ReturnType<typeof createPayloadHost>>) => Promise<void>, collection = newsCollection()) => {
    const database = await fixture(postgres?.connectionString);
    const scope = await Effect.runPromise(Scope.make());
    try {
      const host = await Effect.runPromise(createPayloadHost(collection, database.storage, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
      await test(database, host);
    } finally {
      try { await Effect.runPromise(Scope.close(scope, Exit.void)); }
      finally { await database.close(); }
    }
  };

  it("runs the native lifecycle/default, returns the complete document and commits once", async () => withHost(async (database, host) => {
    const request = randomUUID();
    const created = await Effect.runPromise(host.create(request, { headline: "first" }));
    expect(created).toEqual({ id: expect.any(String), headline: "first", score: 0,
      createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
    expect(await Effect.runPromise(host.create(request, { headline: "first" }))).toEqual(created);
    expect((await readCounts(database))[0]).toEqual({ documents: 1, history: 1, events: 1, committed: 1 });
  }));

  it("refuses malformed native input and rolls back a hook failure", async () => {
    const collection = newsCollection();
    collection.hooks = { afterChange: [() => { throw new Error("native hook witness"); }] };
    await withHost(async (database, host) => {
      expect(await failureOf(host.create(randomUUID(), { headline: "negative-zero", score: -0 }))).toMatchObject({ reason: "invalid" });
      const malformed = await failureOf(host.create(randomUUID(), { headline: "" }));
      expect(malformed._tag).toBe("NativeFailure");
      expect(malformed.cause).toBeInstanceOf(ValidationError);
      const failed = await failureOf(host.create(randomUUID(), { headline: "failure" }));
      expect(failed._tag).toBe("NativeFailure");
      expect(failed.cause).toMatchObject({ message: "native hook witness" });
      expect((await readCounts(database))[0]).toEqual({ documents: 0, history: 0, events: 0, committed: 0 });
    }, collection);
  });

  it("refuses duplicate unique claims including concurrent commands atomically", async () => withHost(async (database, host) => {
    const results = await Promise.all([0, 1].map(() => Effect.runPromise(Effect.exit(host.create(randomUUID(), { headline: "collision" })))));
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    expect(results.filter(Exit.isFailure)).toHaveLength(1);
      const duplicate = await failureOf(host.create(randomUUID(), { headline: "collision" }));
      expect(duplicate._tag).toBe("NativeFailure");
      expect(duplicate.cause).toBeInstanceOf(ValidationError);
    expect((await readCounts(database))[0]).toEqual({ documents: 1, history: 1, events: 1, committed: 1 });
  }));

  it("resolves a lost accepting response without repeating native hooks", async () => {
    let hooks = 0;
    const collection = newsCollection(); collection.hooks = { afterChange: [({ doc }) => { hooks++; return doc; }] };
    await withHost(async (database, host) => {
      database.loseNextCommitResponse();
      const created = await Effect.runPromise(host.create(randomUUID(), { headline: "uncertain" }));
      expect(await Effect.runPromise(host.read(created.id))).toEqual(created);
      expect(hooks).toBe(1);
      expect((await readCounts(database))[0]).toEqual({ documents: 1, history: 1, events: 1, committed: 1 });
    }, collection);
  });

  it("checks revocation after native work and before accepting data", async () => {
    let revoke: (() => Promise<void>) | undefined;
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ doc }) => { await revoke?.(); return doc; }] };
    await withHost(async (database, host) => {
      revoke = async () => { await database.admin(db => db.update(tables.authorities).set({ enabled: false, fence: sql`${tables.authorities.fence}+1` }).where(eq(tables.authorities.scope, "shop-a"))); };
      expect(await failureOf(host.create(randomUUID(), { headline: "revoked" }))).toMatchObject({ _tag: "CoreError", reason: "denied" });
      expect((await readCounts(database))[0]).toEqual({ documents: 0, history: 0, events: 0, committed: 0 });
    }, collection);
  });

  it("prevents serving-role table/definition/gate bypass and foreign-scope entry", async () => withHost(async (database, host) => {
    await expect(database.serving.update(tables.definitions).set({ version: "forged" })).rejects.toBeDefined();
    await expect(database.serving.update(tables.authorities).set({ enabled: true })).rejects.toBeDefined();
    await expect(database.serving.execute(sql`drop schema fx_core cascade`)).rejects.toBeDefined();
    const denied = await Effect.runPromise(Effect.exit(database.storage.open("foreign-shop", randomUUID(), "input", host.definition, randomUUID())));
    expect(Exit.isFailure(denied)).toBe(true);
  }));

  it("refuses an expired command and cancellation before settlement", async () => {
    let expire: (() => Promise<void>) | undefined;
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ doc }) => { await expire?.(); return doc; }] };
    await withHost(async (database, host) => {
      expire = async () => { await database.admin(db => db.update(tables.commands).set({ expires: new Date(0) })); };
      expect(await failureOf(host.create(randomUUID(), { headline: "expired" }))).toMatchObject({ _tag: "CoreError", reason: "expired" });
      expect((await readCounts(database))[0]?.documents).toBe(0);
    }, collection);
    const controller = new AbortController();
    const cancelled = newsCollection(); cancelled.hooks = { afterChange: [({ doc }) => { controller.abort(); return doc; }] };
    await withHost(async (database, host) => {
      const exit = await Effect.runPromiseExit(host.create(randomUUID(), { headline: "cancelled" }), { signal: controller.signal });
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect((await readCounts(database))[0]?.documents).toBe(0);
    }, cancelled);
  });

  it("uses a constant number of local key lookups per batch insert", async () => {
    const database = await fixture(postgres?.connectionString);
    try {
      for (const size of [1, 16, 64]) {
        const command = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "batch", database.definition, randomUUID()));
        const root = await Effect.runPromise(createRoot(database.definition, database.storage, command));
        for (let index = 0; index < size; index++) await Effect.runPromise(root.insert({
          id: randomUUID(), headline: `batch-${size}-${index}`, score: 0,
          createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z",
        }));
        expect(root.diagnostics().keyOperations).toBe(2 * size);
        const candidate = await Effect.runPromise(root.freeze());
        await Effect.runPromise(database.storage.settle(command, candidate.changes, candidate.dependencies, { size }, candidate.events, candidate.predicates));
      }
      expect((await readCounts(database))[0]?.documents).toBe(81);
    } finally { await database.close(); }
  });

  it("preserves callable defaults and checks current native access on replay", async () => {
    let allowed = true; let hooks = 0;
    const collection = newsCollection();
    const score = collection.fields.find(field => "name" in field && field.name === "score");
    if (score?.type !== "number") throw new Error("Missing score field");
    score.defaultValue = () => 7;
    collection.access = { ...collection.access, create: () => allowed };
    collection.hooks = { afterChange: [({ doc }) => { hooks++; return doc; }] };
    await withHost(async (database, host) => {
      const request = randomUUID();
      const created = await Effect.runPromise(host.create(request, { headline: "callable" }));
      expect(created.score).toBe(7);
      allowed = false;
      expect(await failureOf(host.create(request, { headline: "callable" }))).toMatchObject({ _tag: "NativeFailure", cause: { status: 403 } });
      expect(hooks).toBe(1);
      expect((await readCounts(database))[0]?.documents).toBe(1);
    }, collection);
  });

  it("cancels and drains a pending native hook without holding a database transaction", async () => {
    let ready = () => {}; let release = () => {};
    const started = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let lateFailure: unknown;
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ doc, req }) => {
      ready(); await gate;
      try { await req.payload.db.create({ collection: "news-items", data: { headline: "late", score: 0 }, req }); }
      catch (cause) { lateFailure = cause; }
      return doc;
    }] };
    await withHost(async (database, host) => {
      const controller = new AbortController();
      const pending = Effect.runPromiseExit(host.create(randomUUID(), { headline: "pending-cancel" }), { signal: controller.signal });
      await started;
      if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
      controller.abort();
      let completed = false; void pending.then(() => { completed = true; });
      await delay(0); expect(completed).toBe(false);
      release();
      const exit = await pending;
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(lateFailure).toMatchObject({ _tag: "CoreError", reason: "closed" });
      expect((await readCounts(database))[0]?.documents).toBe(0);
    }, collection);
  });

  it.skipIf(driver !== "postgres")("discards the checked-out connection after failed BEGIN", async () => {
    const database = await fixture(postgres?.connectionString);
    try {
      const pool = database.servingPool;
      if (pool === undefined) throw new Error("Missing PostgreSQL serving pool");
      let ran = false;
      const session = postgresSession(pool, undefined, async pid => {
        await database.admin(db => db.execute(sql`select pg_terminate_backend(${pid})`));
      });
      await expect(session.run(async () => { ran = true; })).rejects.toBeInstanceOf(PhysicalFailure);
      expect(ran).toBe(false);
      expect(pool.waitingCount).toBe(0); expect(pool.totalCount).toBe(pool.idleCount);
      // The same bounded pool remains usable after discarding the bad checkout.
      const command = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "healthy", database.definition, randomUUID()));
      await Effect.runPromise(database.storage.abort(command));
    } finally { await database.close(); }
  });

  it.skipIf(driver !== "postgres")("holds the selected grant through accepting work blocked on commit order", async () => {
    const database = await fixture(postgres?.connectionString);
    let release = () => {}; let ready = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { ready = resolve; });
    const command = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "grant-race", database.definition, randomUUID()));
    const root = await Effect.runPromise(createRoot(database.definition, database.storage, command));
    const document = await Effect.runPromise(root.insert({ id: randomUUID(), headline: "grant-race", score: 0, createdAt: "t", updatedAt: "t" }));
    const candidate = await Effect.runPromise(root.freeze());
    const blocker = database.admin(db => db.transaction(async tx => {
      await tx.select().from(tables.clocks).where(eq(tables.clocks.scope, "shop-a")).for("update"); ready(); await gate;
    }));
    let settling: Promise<unknown> | undefined;
    let deleting: Promise<unknown> | undefined;
    const waitFor = async (condition: () => Promise<boolean>) => {
      for (let attempts = 0; attempts < 150; attempts++) { if (await condition()) return; await delay(5); }
      throw new Error("Expected owned PostgreSQL lock waiter");
    };
    try {
      await started;
      settling = Effect.runPromise(database.storage.settle(command, candidate.changes, candidate.dependencies, document, candidate.events, candidate.predicates));
      await waitFor(async () => (await database.admin(db => db.select({ waiting: sql<boolean>`exists(select 1 from pg_stat_activity where application_name=${database.role} and wait_event_type='Lock')` }).from(tables.installation)))[0]?.waiting === true);
      let deleted = false;
      deleting = database.admin(async db => { await db.delete(tables.grants).where(eq(tables.grants.scope, "shop-a")); deleted = true; });
      await waitFor(async () => deleted || (await database.admin(db => db.select({ waiting: sql<boolean>`exists(select 1 from pg_stat_activity where application_name=${`${database.identity}_owner`} and query like 'delete from%' and wait_event_type='Lock')` }).from(tables.installation)))[0]?.waiting === true);
      expect(deleted).toBe(false);
      release(); await settling; await deleting;
      expect(await failureOf(database.storage.read("shop-a", database.definition, document.id))).toMatchObject({ reason: "denied" });
      expect((await readCounts(database))[0]?.documents).toBe(1);
    } finally { release(); await Promise.allSettled([blocker, settling, deleting]); await database.close(); }
  });
});
