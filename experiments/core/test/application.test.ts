import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Result, Schema, Scope } from "effect";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplicationHost } from "../src/application.ts";
import { createApplicationStorage, historicalRangeQuery } from "../src/application-storage.ts";
import { compileDefinition } from "../src/definition.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { applicationFunctions, applicationQuery, applicationMutation } from "./application-corpus.ts";
import type { RegisteredFunction } from "../../../packages/flarex/src/server.ts";
import * as tables from "../src/schema.ts";
import { v } from "../../../packages/flarex/src/values.ts";
import { makeFunctionReference, mutationGeneric } from "../../../packages/flarex/src/server.ts";
import { CoreError } from "../src/errors.ts";
import { nextCreationTime } from "../src/application-values.ts";

const barrier = () => {
  let release = () => {}; let ready = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { ready = resolve; });
  return { gate, started, release, ready };
};

const readString = Schema.decodeUnknownSync(Schema.String);
const point = Schema.decodeUnknownSync(Schema.Struct({ _id: Schema.String, _creationTime: Schema.Number, name: Schema.String, priority: Schema.Number }));
const points = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ _id: Schema.String, _creationTime: Schema.Number, name: Schema.String, priority: Schema.Number })));
const missingId = () => `7:${randomUUID()}`;
const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(effect)), {
  onSuccess: () => { throw new Error("Expected a failure"); }, onFailure: error => error,
});

describe.each(["pglite", "postgres"] as const)("standalone experimental Application (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withApplication = async (test: (database: Fixture, host: Effect.Success<ReturnType<typeof createApplicationHost>>, storage: ReturnType<typeof createApplicationStorage>) => Promise<void>,
    extra: Readonly<Record<string, RegisteredFunction>> = {}, retryable: readonly string[] = []) => {
    const database = await fixture(postgres?.connectionString); const scope = await Effect.runPromise(Scope.make());
    try {
      const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
        fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }],
        indexes: [{ name: "by_priority", field: "priority" }] })));
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, tableId: definition.tableId,
        version: definition.version, fields: definition.fields, indexes: definition.indexes }));
      const storage = createApplicationStorage(database.persistence);
      const host = await Effect.runPromise(createApplicationHost(definition, storage, "shop-a", { ...applicationFunctions, ...extra }, retryable).pipe(Effect.provideService(Scope.Scope, scope)));
      await test(database, host, storage);
    } finally { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await database.close(); } }
  };

  it("runs registered query point/missing/index reads without a command or framework runtime", async () => withApplication(async (database, host) => {
    const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "first", priority: 1 }))).value);
    const commandsBefore = await database.admin(db => db.select({ n: count() }).from(tables.commands));
    const result = await Effect.runPromise(host.query("read", { id, missing: missingId(), lower: 0, upper: 5 }));
    expect(result.value).toEqual({ present: { _id: id, _creationTime: expect.any(Number), name: "first", priority: 1 }, missing: null,
      rows: [{ _id: id, _creationTime: expect.any(Number), name: "first", priority: 1 }] });
    expect(result.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "point", id, revision: 1, tombstone: false }),
      expect.objectContaining({ kind: "point", revision: null, tombstone: false }), expect.objectContaining({ kind: "range" }),
    ]));
    expect(result.syncKeys.map(key => key.kind).toSorted()).toEqual(["appRowPoint", "appRowPoint", "appTable"]);
    expect(await database.admin(db => db.select({ n: count() }).from(tables.commands))).toEqual(commandsBefore);
  }));

  it("binds prepared identity, execution and result validation to one admitted function snapshot", async () => {
    const args = { name: v.string() };
    const registered = applicationMutation({ args, returns: v.string(), handler: async (ctx, data) => {
      await ctx.db.insert("tasks", { name: data.name, priority: 1 }); return data.name;
    } });
    await withApplication(async (_database, host) => {
      const first = await Effect.runPromise(host.prepareMutation("capture", { name: "captured" }));
      expect(await failureOf(host.prepareMutation("capture", { name: "x".repeat(262145) }))).toMatchObject({ reason: "limit" });
      Object.assign(registered, { handler: async () => 42, returns: v.number() }); Object.assign(args, { name: v.number() });
      const second = await Effect.runPromise(host.prepareMutation("capture", { name: "captured" })); expect(second.digest).toBe(first.digest);
      expect((await Effect.runPromise(host.mutate("capture", randomUUID(), { name: "captured" }))).value).toBe("captured");
      expect(await failureOf(first.decode(42))).toMatchObject({ reason: "invalid" });
    }, { capture: registered });
  });

  it("merges inserted and updated pending rows and atomically publishes complete revisions and outcomes", async () => withApplication(async (database, host) => {
    const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "first", priority: 1 }))).value);
    const result = await Effect.runPromise(host.mutate("change", randomUUID(), { id, name: "second" }));
    const changed = Schema.decodeUnknownSync(Schema.Struct({ created: Schema.String }))(result.value);
    expect(result.value).toMatchObject({ original: { _id: id, priority: 1 }, inserted: { _id: changed.created, name: "second", priority: 2 },
      updated: { _id: id, priority: 9 }, rows: [{ _id: changed.created, priority: 2 }] });
    expect(point((await Effect.runPromise(host.query("point", { id }))).value).priority).toBe(9);
    expect(points((await Effect.runPromise(host.query("range", { lower: 0, upper: 10 }))).value).map(row => row.priority)).toEqual([2, 9]);
    expect((await database.admin(db => db.select().from(tables.history))).map(row => row.commitSeq).toSorted()).toEqual([1, 2, 2]);
    expect((await database.admin(db => db.select().from(tables.eventIntents))).map(row => row.event).toSorted()).toEqual(["created", "created", "updated"]);
    expect((await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.status, "committed"))))).toHaveLength(2);
  }));

  it("publishes a tombstone and releases current unique/index membership on delete", async () => withApplication(async (database, host) => {
    const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "reclaim", priority: 1 }))).value);
    await Effect.runPromise(host.mutate("remove", randomUUID(), { id }));
    const missing = await Effect.runPromise(host.query("point", { id }));
    expect(missing.value).toBe(null); expect(missing.dependencies).toEqual([{ kind: "point", id, revision: 2, tombstone: true }]);
    expect((await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, id))))).toEqual([
      expect.objectContaining({ commitSeq: 1, body: expect.any(Object) }), expect.objectContaining({ commitSeq: 2, body: null }),
    ]);
    expect((await database.admin(db => db.select().from(tables.indexVersions)))[0]).toMatchObject({ fromSeq: 1, untilSeq: 2 });
    const replacement = await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "reclaim", priority: 1 }));
    expect(readString(replacement.value)).not.toBe(id);
  }));

  it("keeps one exact snapshot through concurrent updates and cached reads", async () => {
    const pause = barrier();
    const stable = applicationQuery({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      const first = await ctx.db.get(args.id); pause.ready(); await pause.gate;
      const second = await ctx.db.get(args.id);
      const rows = await ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", 0).lt("priority", 5)).collect();
      return { first, second, rows };
    } });
    await withApplication(async (_database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "snapshot", priority: 1 }))).value);
      const pending = Effect.runPromise(host.query("stable", { id }));
      try {
        await pause.started; await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: 9 }));
        pause.release(); const result = await pending;
        expect(result.snapshot).toBe(1); expect(result.value).toMatchObject({ first: { priority: 1 }, second: { priority: 1 }, rows: [{ _id: id, priority: 1 }] });
        expect(point((await Effect.runPromise(host.query("point", { id }))).value).priority).toBe(9);
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { stable });
  });

  it("rejects a stale row observation without partial writes", async () => {
    const pause = barrier();
    const stale = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      await ctx.db.get(args.id); pause.ready(); await pause.gate; await ctx.db.patch(args.id, { priority: 2 }); return null;
    } });
    await withApplication(async (database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "stale", priority: 1 }))).value);
      const pending = failureOf(host.mutate("stale", randomUUID(), { id }));
      try { await pause.started; await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: 9 })); pause.release();
        expect(await pending).toMatchObject({ reason: "conflict" });
        expect(point((await Effect.runPromise(host.query("point", { id }))).value).priority).toBe(9);
        expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(2);
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { stale });
  });

  it("detects insertion of an actually observed missing identity", async () => {
    const writerPause = barrier(); const observerPause = barrier(); let stagedId = "";
    const writer = applicationMutation({ args: {}, handler: async ctx => {
      stagedId = await ctx.db.insert("tasks", { name: "newly-visible", priority: 1 }); writerPause.ready(); await writerPause.gate; return stagedId;
    } });
    const observe = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      if (await ctx.db.get(args.id) !== null) throw new Error("Missing-row precondition failed");
      observerPause.ready(); await observerPause.gate; return ctx.db.insert("tasks", { name: "observer", priority: 10 });
    } });
    await withApplication(async (database, host) => {
      const writing = Effect.runPromise(host.mutate("writer", randomUUID(), {})); let observing: Promise<unknown> | undefined;
      try { await writerPause.started; observing = failureOf(host.mutate("observe", randomUUID(), { id: stagedId })); await observerPause.started;
        writerPause.release(); await writing; observerPause.release(); expect(await observing).toMatchObject({ reason: "conflict" });
        expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(1);
      } finally { writerPause.release(); observerPause.release(); await Promise.allSettled([writing, observing]); }
    }, { writer, observe });
  });

  it.each(["insert", "enter", "leave", "delete", "independent"] as const)("checks indexed membership changes: %s", async action => {
    const pause = barrier();
    const observe = applicationMutation({ args: {}, handler: async ctx => {
      await ctx.db.query("tasks").withIndex("by_priority", range => range.gte("priority", 0).lt("priority", 5)).collect();
      pause.ready(); await pause.gate; return ctx.db.insert("tasks", { name: "observer", priority: 100 });
    } });
    await withApplication(async (database, host) => {
      const id = action === "insert" ? null : readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "writer", priority: action === "enter" || action === "independent" ? 10 : 1 }))).value);
      const pending = Effect.runPromiseExit(host.mutate("observe", randomUUID(), {}));
      try { await pause.started;
        if (action === "insert") await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "inserted", priority: 1 }));
        else if (action === "delete") await Effect.runPromise(host.mutate("remove", randomUUID(), { id }));
        else await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: action === "enter" ? 1 : 20 }));
        pause.release(); const result = await pending;
        if (action === "independent") expect(Exit.isSuccess(result)).toBe(true);
        else expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: "conflict" } });
        expect((await database.admin(db => db.select().from(tables.documents))).some(row => row.body.name === "observer")).toBe(action === "independent");
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { observe });
  });

  it("retries only an eligible whole attempt and preserves one durable request outcome", async () => {
    const pause = barrier(); let calls = 0; const seen: number[] = [];
    const retry = applicationMutation({ args: { id: v.id("tasks"), change: v.object({ delta: v.number() }) }, handler: async (ctx, args) => {
      const delta = args.change.delta; seen.push(delta); args.change.delta = 200;
      const before = await ctx.db.get(args.id); if (before === null) throw new Error("Missing retry seed");
      if (++calls === 1) { pause.ready(); await pause.gate; }
      await ctx.db.patch(args.id, { priority: before.priority + delta }); return ctx.db.get(args.id);
    } });
    await withApplication(async (database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "retry", priority: 1 }))).value); const request = randomUUID();
      const supplied = { id, change: { delta: 1 } }; const pending = Effect.runPromise(host.mutate("retry", request, supplied));
      try { await pause.started; supplied.change.delta = 99; await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: 10 })); pause.release();
        const result = await pending; expect(result.attempts).toBe(2); expect(point(result.value).priority).toBe(11); expect(calls).toBe(2);
        expect(await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.request, request)))).toHaveLength(1);
        expect(seen).toEqual([1, 1]); expect((await Effect.runPromise(host.mutate("retry", request, { id, change: { delta: 1 } }))).attempts).toBe(0); expect(calls).toBe(2);
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { retry }, ["retry"]);
  });

  it("stops retrying when a later attempt fails in user code", async () => {
    const pause = barrier(); let calls = 0;
    const terminal = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      await ctx.db.get(args.id); if (++calls > 1) throw new Error("terminal-after-conflict");
      pause.ready(); await pause.gate; await ctx.db.patch(args.id, { priority: 2 }); return null;
    } });
    await withApplication(async (_database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "terminal", priority: 1 }))).value);
      const pending = failureOf(host.mutate("terminal", randomUUID(), { id }));
      try { await pause.started; await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: 10 })); pause.release();
        expect(await pending).toMatchObject({ _tag: "ApplicationFailure", cause: { message: "terminal-after-conflict" } }); expect(calls).toBe(2);
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { terminal }, ["terminal"]);
  });

  it("preserves recoverable native document validation and poisons caught unauthorized work", async () => {
    const recovery = mutationGeneric({ args: { bad: v.object({ name: v.number(), priority: v.number() }) }, handler: async (ctx, args) => {
      const id = await ctx.db.insert("tasks", { name: "valid", priority: 1 }); let caught = false;
      try { await ctx.db.insert("tasks", args.bad); } catch (cause) { caught = cause instanceof Error && cause.name === "ApplicationRevisionSyscallDocumentValidationV1Error"; }
      return { caught, row: await ctx.db.get(id) };
    } });
    const poisoned = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      await ctx.db.insert("tasks", { name: "must-rollback", priority: 2 });
      try { await ctx.db.get(args.id); } catch { /* User catches it; the core retains the failed authority. */ }
      return "caught";
    } });
    await withApplication(async (database, host) => {
      expect((await Effect.runPromise(host.mutate("recovery", randomUUID(), { bad: { name: 123, priority: 1 } }))).value).toMatchObject({ caught: true, row: { name: "valid" } });
      expect(await failureOf(host.mutate("poisoned", randomUUID(), { id: `8:${randomUUID()}` }))).toMatchObject({ reason: "denied" });
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(1);
    }, { recovery, poisoned });
  });

  it.each(["revoke", "fence", "definition", "retention", "unrelated"] as const)("checks fresh authority and selected metadata at query completion: %s", async action => {
    const pause = barrier();
    const held = applicationQuery({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      const body = await ctx.db.get(args.id); pause.ready(); await pause.gate; return body;
    } });
    await withApplication(async (database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "held", priority: 1 }))).value);
      const pending = Effect.runPromiseExit(host.query("held", { id }));
      try { await pause.started;
        if (action === "revoke") await database.admin(db => db.delete(tables.grants).where(eq(tables.grants.scope, "shop-a")));
        if (action === "fence") await database.admin(db => db.update(tables.authorities).set({ fence: 2 }).where(eq(tables.authorities.scope, "shop-a")));
        if (action === "definition" || action === "unrelated") await database.admin(db => db.update(tables.definitions).set({ version: "changed" }).where(eq(tables.definitions.table, action === "definition" ? "tasks" : "news-items")));
        if (action === "retention") {
          await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "advance", priority: 2 }));
          await database.admin(db => db.update(tables.authorities).set({ retainedFrom: 2 }).where(eq(tables.authorities.scope, "shop-a")));
        }
        pause.release(); const result = await pending;
        if (action === "unrelated") expect(Exit.isSuccess(result)).toBe(true);
        else expect(Exit.isFailure(result) && Cause.findErrorOption(result.cause)).toMatchObject({ value: { reason: action === "retention" ? "expired" : "denied" } });
        if (action === "retention") expect(point((await Effect.runPromise(host.query("point", { id }))).value).name).toBe("held");
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { held });
  });

  it("resolves an injected accepted-response loss without repeating the function", async () => {
    let calls = 0;
    const once = applicationMutation({ args: { name: v.string(), priority: v.number() }, handler: async (ctx, args) => { calls++; return ctx.db.insert("tasks", args); } });
    await withApplication(async (database, host, storage) => {
      const accept = storage.accept; let lost = false;
      storage.accept = (...args) => accept(...args).pipe(Effect.flatMap(value => {
        if (lost) return Effect.succeed(value); lost = true; return Effect.fail(new CoreError({ reason: "storage", phase: "commit", cause: "Known committed response-loss injection" }));
      }));
      const request = randomUUID(); const result = await Effect.runPromise(host.mutate("once", request, { name: "once", priority: 1 }));
      expect(readString(result.value)).toMatch(/^7:/); expect(calls).toBe(1);
      expect((await Effect.runPromise(host.mutate("once", request, { priority: 1, name: "once" }))).value).toBe(result.value); expect(calls).toBe(1);
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(1);
    }, { once }, ["once"]);
  });

  it("never re-executes an unresolved accepting outcome", async () => {
    let calls = 0;
    const once = applicationMutation({ args: {}, handler: async ctx => { calls++; return ctx.db.insert("tasks", { name: "uncertain", priority: 1 }); } });
    await withApplication(async (database, host, storage) => {
      storage.accept = () => Effect.fail(new CoreError({ reason: "storage", phase: "commit", cause: "Unresolved transport injection" }));
      const request = randomUUID(); expect(await failureOf(host.mutate("once", request, {}))).toMatchObject({ reason: "uncertain" });
      expect(await failureOf(host.mutate("once", request, {}))).toMatchObject({ reason: "busy" }); expect(calls).toBe(1);
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(0);
    }, { once }, ["once"]);
  });

  it("refuses budget exhaustion rather than return a partial or false range result", async () => withApplication(async (_database, host) => {
    await Effect.runPromise(host.mutate("batch", randomUUID(), { count: 256, stem: "batch" }));
    await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "extra", priority: 0 }));
    expect(await failureOf(host.query("range", { lower: 0, upper: 300 }))).toMatchObject({ reason: "limit" });
    expect(points((await Effect.runPromise(host.query("range", { lower: 254, upper: 256 }))).value)).toHaveLength(2);
  }));

  it("preserves database-seeded nextUp creation identity and equal-key order before and after publication", async () => {
    const ordered = applicationMutation({ args: {}, handler: async ctx => {
      const ids = [];
      for (let index = 0; index < 16; index++) ids.push(await ctx.db.insert("tasks", { name: `ordered-${index}`, priority: 1 }));
      const rows = await ctx.db.query("tasks").withIndex("by_priority", range => range.eq("priority", 1)).collect();
      return { ids, rows };
    } });
    await withApplication(async (database, host) => {
      const before = await database.serving.execute(sql`select extract(epoch from clock_timestamp())::double precision * 1000 as time`);
      const lower = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ time: Schema.Number })) }))(before).rows[0]?.time;
      const result = Schema.decodeUnknownSync(Schema.Struct({ ids: Schema.Array(Schema.String), rows: Schema.Array(Schema.Json) }))((await Effect.runPromise(host.mutate("ordered", randomUUID(), {}))).value);
      const rows = points(result.rows); expect(rows.map(row => row._id)).toEqual(result.ids);
      expect(rows[0]?._creationTime).toBeGreaterThanOrEqual(lower ?? Infinity);
      for (let index = 1; index < rows.length; index++) expect(rows[index]?._creationTime).toBe(nextCreationTime(rows[index - 1]?._creationTime ?? 0));
      const committed = points((await Effect.runPromise(host.query("range", { lower: 0, upper: 2 }))).value);
      expect(committed).toEqual(rows);
      await Effect.runPromise(host.mutate("patch", randomUUID(), { id: result.ids[0], priority: 1 }));
      expect(points((await Effect.runPromise(host.query("range", { lower: 0, upper: 2 }))).value)).toEqual(rows);
    }, { ordered });
  });

  it("detaches guest-owned return values before accepting and replaying", async () => {
    const shared = { nested: { value: 10 } };
    const detached = applicationMutation({ args: {}, returns: v.object({ nested: v.object({ value: v.number() }) }), handler: async ctx => {
      await ctx.db.insert("tasks", { name: "detached", priority: 1 }); return shared;
    } });
    await withApplication(async (_database, host, storage) => {
      const accept = storage.accept;
      storage.accept = (...args) => Effect.sync(() => { shared.nested.value = 99; }).pipe(Effect.andThen(accept(...args)));
      const request = randomUUID(); expect((await Effect.runPromise(host.mutate("detached", request, {}))).value).toEqual({ nested: { value: 10 } });
      expect((await Effect.runPromise(host.mutate("detached", request, {}))).value).toEqual({ nested: { value: 10 } });
    }, { detached });
  });

  it("refuses negative zero before it can collide with a positive-zero request identity or durable value", async () => {
    let calls = 0;
    const zero = applicationMutation({ args: { nested: v.object({ value: v.number() }) }, handler: async (ctx, args) => {
      calls++; return ctx.db.insert("tasks", { name: "zero", priority: args.nested.value });
    } });
    const result = applicationMutation({ args: {}, handler: async ctx => {
      await ctx.db.insert("tasks", { name: "negative-result", priority: 1 }); return { value: -0 };
    } });
    const document = applicationMutation({ args: {}, handler: async ctx => {
      try { await ctx.db.insert("tasks", { name: "negative-document", priority: -0 }); } catch { return "recovered"; } return "unexpected";
    } });
    await withApplication(async (database, host) => {
      const request = randomUUID(); expect(await failureOf(host.mutate("zero", request, { nested: { value: -0 } }))).toMatchObject({ reason: "invalid" }); expect(calls).toBe(0);
      await Effect.runPromise(host.mutate("zero", request, { nested: { value: 0 } })); expect(calls).toBe(1);
      expect(await failureOf(host.mutate("result", randomUUID(), {}))).toMatchObject({ reason: "invalid" });
      expect((await Effect.runPromise(host.mutate("document", randomUUID(), {}))).value).toBe("recovered");
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(1);
    }, { zero, result, document });
  });

  it("bounds whole-attempt retry after three real accepting conflicts", async () => {
    const pauses = [barrier(), barrier(), barrier()]; let calls = 0;
    const exhausted = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      await ctx.db.get(args.id); const pause = pauses[calls++]; if (pause === undefined) throw new Error("Unbounded retry");
      pause.ready(); await pause.gate; await ctx.db.patch(args.id, { priority: -1 }); return null;
    } });
    await withApplication(async (database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "exhaust", priority: 0 }))).value); const request = randomUUID();
      const pending = failureOf(host.mutate("exhausted", request, { id }));
      try {
        for (const [index, pause] of pauses.entries()) { await pause.started; await Effect.runPromise(host.mutate("patch", randomUUID(), { id, priority: index + 1 })); pause.release(); }
        expect(await pending).toMatchObject({ reason: "conflict" }); expect(calls).toBe(3);
        expect(point((await Effect.runPromise(host.query("point", { id }))).value).priority).toBe(3);
        expect(await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.request, request)))).toEqual([expect.objectContaining({ status: "aborted" })]);
      } finally { for (const pause of pauses) pause.release(); await Promise.allSettled([pending]); }
    }, { exhausted }, ["exhausted"]);
  });

  it("cancels, drains a paused function, refuses late calls and publishes nothing", async () => {
    const pause = barrier(); let late: (() => Promise<unknown>) | undefined;
    const held = applicationMutation({ args: {}, handler: async ctx => {
      const id = await ctx.db.insert("tasks", { name: "cancelled", priority: 1 }); late = () => ctx.db.get(id);
      pause.ready(); await pause.gate; return null;
    } });
    await withApplication(async (database, host) => {
      const controller = new AbortController(); let settled = false;
      const pending = Effect.runPromiseExit(host.mutate("held", randomUUID(), {}), { signal: controller.signal }).then(exit => { settled = true; return exit; });
      try {
        await pause.started;
        if (database.servingPool !== undefined) expect(database.servingPool.totalCount).toBe(database.servingPool.idleCount);
        controller.abort();
        // Let interruption reach the supervised callback, which remains paused.
        await new Promise<void>(resolve => setTimeout(resolve, 20)); expect(settled).toBe(false);
        if (late === undefined) throw new Error("Missing callback capability");
        await expect(late()).rejects.toMatchObject({ _tag: "ApplicationOperationFailure" });
        pause.release(); const exit = await pending; expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
        expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(0);
        expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(0);
        expect(await database.admin(db => db.select().from(tables.commands))).toEqual([expect.objectContaining({ status: "aborted" })]);
        await expect(late()).rejects.toMatchObject({ _tag: "ApplicationOperationFailure" });
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { held });
  });

  it.each(["insert", "range"] as const)("drains dropped %s promises without losing an owned defect or leaking a rejection", async operation => {
    const pause = barrier(); let returned = false;
    const dropped = applicationMutation({ args: {}, handler: ctx => {
      if (operation === "insert") void ctx.db.insert("tasks", { name: "dropped", priority: 1 });
      else void ctx.db.query("tasks").withIndex("by_priority").collect();
      returned = true; return null;
    } });
    await withApplication(async (database, host, storage) => {
      const defect = new Error("owned-database-defect");
      const failing = Effect.promise(async () => { pause.ready(); await pause.gate; }).pipe(Effect.andThen(Effect.die(defect)));
      if (operation === "insert") storage.point = () => failing;
      else storage.range = () => failing;
      let settled = false; const pending = Effect.runPromiseExit(host.mutate("dropped", randomUUID(), {})).then(exit => { settled = true; return exit; });
      try { await pause.started; expect(returned).toBe(true); expect(settled).toBe(false); pause.release();
        const exit = await pending; expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContain(defect);
        expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(0);
      } finally { pause.release(); await Promise.allSettled([pending]); }
    }, { dropped });
  });

  it("refuses caught unsupported query operations and malformed arguments/returns without partial data", async () => {
    const unsupported = applicationMutation({ args: {}, handler: async ctx => {
      await ctx.db.insert("tasks", { name: "unsupported", priority: 1 });
      try { await ctx.db.query("tasks").withIndex("by_priority").take(1); } catch { /* Still poisoned. */ }
      return null;
    } });
    const badReturn = applicationMutation({ args: {}, returns: v.string(), handler: async ctx => {
      await ctx.db.insert("tasks", { name: "bad-return", priority: 1 }); return JSON.parse("123");
    } });
    const readOnly = applicationQuery({ args: {}, handler: async ctx => {
      expect(Object.keys(ctx.db).toSorted()).toEqual(["get", "query"]);
      try { await ctx.runQuery(makeFunctionReference<"query">("unavailable"), {}); } catch { /* Still poisoned. */ } return null;
    } });
    await withApplication(async (database, host) => {
      expect(await failureOf(host.mutate("seed", randomUUID(), { name: 123, priority: 1 }))).toMatchObject({ reason: "invalid" });
      expect(await failureOf(host.mutate("badReturn", randomUUID(), {}))).toMatchObject({ reason: "invalid" });
      expect(await failureOf(host.mutate("unsupported", randomUUID(), {}))).toMatchObject({ reason: "unsupported" });
      expect(await failureOf(host.query("readOnly", {}))).toMatchObject({ reason: "unsupported" });
      expect(await database.admin(db => db.select().from(tables.documents))).toHaveLength(0);
    }, { unsupported, badReturn, readOnly });
  });

  it("bounds transferred bytes independently of rows and protects the retention writer", async () => withApplication(async (database, host) => {
    for (let index = 0; index < 2; index++) await Effect.runPromise(host.mutate("batch", randomUUID(), { count: 70, stem: `${index}-${"x".repeat(2000)}` }));
    expect(await failureOf(host.query("range", { lower: 0, upper: 100 }))).toMatchObject({ reason: "limit" });
    expect(points((await Effect.runPromise(host.query("range", { lower: 0, upper: 1 }))).value)).toHaveLength(2);
    await expect(database.serving.update(tables.authorities).set({ retainedFrom: 10 })).rejects.toThrow();
  }));

  it("repairs replace/delete pending membership and reclaims a released unique key in one outcome", async () => {
    const edit = applicationMutation({ args: { id: v.id("tasks") }, handler: async (ctx, args) => {
      const before = await ctx.db.get(args.id); if (before === null) throw new Error("Missing edit seed");
      await ctx.db.replace(args.id, { name: "temporary", priority: 20 });
      const replaced = await ctx.db.get(args.id); await ctx.db.delete(args.id);
      const absent = await ctx.db.get(args.id); const id = await ctx.db.insert("tasks", { name: before.name, priority: 1 });
      const removed = await ctx.db.insert("tasks", { name: "ephemeral", priority: 3 }); await ctx.db.delete(removed);
      return { replaced, absent, id, removed, rows: await ctx.db.query("tasks").withIndex("by_priority").collect() };
    } });
    await withApplication(async (database, host) => {
      const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "reuse", priority: 1 }))).value);
      const before = point((await Effect.runPromise(host.query("point", { id }))).value);
      const result = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, removed: Schema.String, replaced: Schema.Json, absent: Schema.Json, rows: Schema.Array(Schema.Json) }))((await Effect.runPromise(host.mutate("edit", randomUUID(), { id }))).value);
      expect(result.replaced).toMatchObject({ name: "temporary", priority: 20, _creationTime: before._creationTime }); expect(result.absent).toBe(null);
      expect(points(result.rows).map(row => row._id)).toEqual([result.id]);
      expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.id, result.removed)))).toHaveLength(0);
      expect(await database.admin(db => db.select().from(tables.uniqueClaims))).toEqual([expect.objectContaining({ key: '"reuse"', owner: result.id })]);
    }, { edit });
  });

  it("refuses a caught pending-row limit without committing the earlier rows", async () => {
    const over = applicationMutation({ args: {}, handler: async ctx => {
      try { for (let index = 0; index < 257; index++) await ctx.db.insert("tasks", { name: `limit-${index}`, priority: index }); }
      catch { /* User catches exhaustion; the whole root remains failed. */ } return null;
    } });
    await withApplication(async (database, host) => {
      expect(await failureOf(host.mutate("over", randomUUID(), {}))).toMatchObject({ reason: "limit" });
      expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(0);
    }, { over });
  });

  it("refuses expiry at the accepting boundary without publication", async () => withApplication(async (database, host, storage) => {
    const accept = storage.accept;
    storage.accept = (...args) => Effect.tryPromise({ try: () => database.admin(db => db.update(tables.commands).set({ expires: new Date(0) })), catch: cause => new CoreError({ reason: "storage", cause }) }).pipe(Effect.andThen(accept(...args)));
    expect(await failureOf(host.mutate("seed", randomUUID(), { name: "expired", priority: 1 }))).toMatchObject({ reason: "expired" });
    expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(0);
  }));

  it.skipIf(driver !== "postgres")("rechecks database deadline after waiting for the scope clock", async () => withApplication(async (database, host, storage) => {
    const pause = barrier(); const accept = storage.accept;
    const blocker = database.admin(db => db.transaction(async tx => {
      await tx.select().from(tables.clocks).where(eq(tables.clocks.scope, "shop-a")).for("update"); pause.ready(); await pause.gate;
    }));
    let pending: Promise<unknown> | undefined;
    const waitFor = async (condition: () => Promise<boolean>) => {
      for (let attempt = 0; attempt < 150; attempt++) { if (await condition()) return; await new Promise<void>(resolve => setTimeout(resolve, 5)); }
      throw new Error("Missing owned deadline/lock witness");
    };
    try {
      await pause.started;
      storage.accept = (...args) => Effect.tryPromise({ try: () => database.admin(db => db.update(tables.commands).set({ expires: sql`clock_timestamp() + interval '150 milliseconds'` })), catch: cause => new CoreError({ reason: "storage", cause }) }).pipe(Effect.andThen(accept(...args)));
      pending = failureOf(host.mutate("seed", randomUUID(), { name: "lock-expiry", priority: 1 }));
      await waitFor(async () => {
        const raw = await database.admin(db => db.execute(sql`select count(*)::integer as n from pg_stat_activity where application_name = ${database.role} and wait_event_type = 'Lock'`));
        return Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ n: Schema.Number })) }))(raw).rows[0]?.n === 1;
      });
      await waitFor(async () => {
        const rows = await database.admin(db => db.select({ expired: sql<boolean>`clock_timestamp() >= ${tables.commands.expires}` }).from(tables.commands)); return rows[0]?.expired === true;
      });
      pause.release(); expect(await pending).toMatchObject({ reason: "expired" });
      expect(await database.admin(db => db.select().from(tables.history))).toHaveLength(0);
    } finally { pause.release(); await Promise.allSettled([blocker, pending]); }
  }));

  it("keeps a high-revision selection index ordered below its physical candidate limit", async () => withApplication(async (database, host) => {
    const id = readString((await Effect.runPromise(host.mutate("seed", randomUUID(), { name: "revisions", priority: 1 }))).value);
    const [original] = await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.id, id)));
    if (original === undefined) throw new Error("Missing revision seed");
    const creationTime = point((await Effect.runPromise(host.query("point", { id }))).value)._creationTime;
    // Administrative history fixture only; all reads use the actual candidate
    // query plan. Other witnesses exercise the accepting writer's intervals.
    await database.admin(async db => {
      await db.delete(tables.indexVersions).where(eq(tables.indexVersions.id, id));
      for (let start = 1; start <= 4096; start += 256) {
        const sequences = Array.from({ length: 256 }, (_, offset) => start + offset);
        await db.insert(tables.history).values(sequences.filter(seq => seq !== 1).map(commitSeq => ({ scope: "shop-a", table: "tasks", id, commitSeq, body: original.body })));
        await db.insert(tables.indexVersions).values(sequences.map(fromSeq => ({ scope: "shop-a", table: "tasks", index: "by_priority", id,
          key: 1, creationTime, fromSeq, untilSeq: fromSeq === 4096 ? null : fromSeq + 1 })));
      }
      await db.update(tables.clocks).set({ seq: 4096 }); await db.execute(sql`analyze fx_core.index_versions`); await db.execute(sql`analyze fx_core.history`);
    });
    const query = historicalRangeQuery(database.serving, "shop-a", "tasks", 4096, { index: "by_priority", field: "priority", lower: null, upper: null }, 12, 262144);
    const raw = await database.serving.execute(sql`explain (analyze, buffers, format json) ${query.getSQL()}`);
    const plans = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.Array(Schema.Record(Schema.String, Schema.Json)) })) }))(raw);
    const tree = (value: Schema.Json): Record<string, Schema.Json>[] => {
      if (Array.isArray(value)) return value.flatMap(tree);
      if (value === null || typeof value !== "object") return [];
      const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(value);
      return [record, ...Object.values(record).flatMap(tree)];
    };
    const nodes = tree(plans.rows[0]?.["QUERY PLAN"] ?? []);
    const limit = nodes.find(node => node["Node Type"] === "Limit"); expect(limit?.["Actual Rows"]).toBe(13);
    const children = tree(limit?.Plans ?? []);
    expect(children.some(node => node["Index Name"] === "index_selection")).toBe(true);
    expect(children.some(node => node["Node Type"] === "Sort" || node["Node Type"] === "Incremental Sort")).toBe(false);
    expect(children.filter(node => typeof node["Actual Rows"] === "number").every(node => Number(node["Actual Rows"]) <= 13)).toBe(true);
    expect(await failureOf(host.query("range", { lower: 0, upper: 2 }))).toMatchObject({ reason: "limit" });
  }));
});
