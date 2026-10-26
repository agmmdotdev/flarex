import { Cause, Effect, Exit, Result, Scope } from "effect";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { compilePayloadDefinition } from "../src/payload-definition.ts";
import { compileDefinition, uniqueKeys, type Document } from "../src/definition.ts";
import { createPendingIndex } from "../src/pending-index.ts";
import { nextCreationTime } from "../src/application-values.ts";
import { CoreError, NativeOperationFailure } from "../src/errors.ts";
import { createPayloadBinding } from "../src/payload.ts";
import { createRoot } from "../src/root.ts";
import type { Storage } from "../src/storage.ts";
import type { Command } from "../src/persistence.ts";
import { newsCollection } from "./fixture.ts";

const command: Command = { id: "command", token: "private-token", request: "request", profile: "framework", snapshot: 0, status: "active", result: null };
const backend = (changes: Partial<Storage> = {}): Storage => ({
  metrics: { operations: 0 },
  observeUnique: (_command, keys) => Effect.succeed(keys.map(key => ({ ...key, owner: null }))),
  observeRows: () => Effect.succeed([]),
  observeEquality: () => Effect.fail(new CoreError({ reason: "unsupported" })),
  observeEqualityRows: () => Effect.fail(new CoreError({ reason: "unsupported" })),
  readEqualityRows: () => Effect.fail(new CoreError({ reason: "unsupported" })),
  read: () => Effect.succeed(null), ...changes,
});

describe("framework-neutral root and native boundary contracts", () => {
  it("rejects table identities outside the authoritative catalog range", () => {
    for (const tableId of [0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) expect(compileDefinition({ table: "tasks", tableId, fields: [] })).toMatchObject({ _tag: "Failure" });
    expect(compileDefinition({ table: "tasks", tableId: 2147483647, fields: [] })).toMatchObject({ _tag: "Success" });
  });

  it("maintains ordered pending updates/deletes and prunes selective ranges as state grows", () => {
    const index = createPendingIndex(); const expected = new Map<string, Document>();
    let state = 391; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    const range = { index: "priority", field: "priority", lower: { value: 90, inclusive: true }, upper: { value: 95, inclusive: false } };
    for (let step = 0; step < 5000; step++) {
      const id = String(random() % 256); const prior = expected.get(id);
      if (prior !== undefined) index.set(Number(prior.priority), Number(prior.systemCreationTime), id, null);
      if (random() % 5 === 0) expected.delete(id);
      else {
        const priority = random() % 128; const systemCreationTime = 1000 + random() % 1000;
        const body = { id, priority, systemCreationTime, createdAt: "t", updatedAt: "t" }; expected.set(id, body); index.set(priority, systemCreationTime, id, body);
      }
      if (step % 19 === 0) expect(index.select(range)).toEqual([...expected.values()].filter(row => Number(row.priority) >= 90 && Number(row.priority) < 95)
        .toSorted((left, right) => Number(left.priority) - Number(right.priority) || Number(left.systemCreationTime) - Number(right.systemCreationTime) || left.id.localeCompare(right.id)));
    }
    expect(index.diagnostics().height).toBeLessThanOrEqual(12);
    const before = index.diagnostics().comparisons; index.select(range);
    expect(index.diagnostics().comparisons - before).toBeLessThan(50);
    const ties = createPendingIndex();
    for (const [id, systemCreationTime] of [["z", 1], ["a", 2]] as const) ties.set(1, systemCreationTime, id, { id, systemCreationTime, priority: 1, createdAt: "t", updatedAt: "t" });
    expect(ties.select({ ...range, lower: null, upper: null }).map(row => row.id)).toEqual(["z", "a"]);
    expect(nextCreationTime(1700000000000)).toBe(1700000000000.0002);
  });
  it("detaches and freezes each compiled unique definition", async () => {
    const collection = newsCollection();
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(collection)));
    const first = definition.fields[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("Missing compiled field");
    expect(Reflect.set(first, "unique", false)).toBe(false);
    expect(uniqueKeys(definition, { id: "i", createdAt: "t", updatedAt: "t", headline: "one", score: 0 })).toHaveLength(1);
  });

  it("classifies unsupported native definitions as typed failures", async () => {
    const result = await Effect.runPromise(Effect.result(Effect.scoped(createPayloadBinding({ ...newsCollection(), auth: true }, backend(), "shop-a"))));
    expect(Result.isFailure(result) && result.failure).toMatchObject({ _tag: "CoreError", reason: "unsupported" });
    const multiple = newsCollection();
    multiple.fields.push({ name: "slug", type: "text", required: true, unique: true });
    expect(compilePayloadDefinition(multiple)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupported" } });
    const fieldAccess = newsCollection(); fieldAccess.fields = [{ name: "headline", type: "text", required: true, access: { read: () => true } }];
    expect(compilePayloadDefinition(fieldAccess)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupported" } });
    const transform = newsCollection(); transform.hooks = { beforeOperation: [({ args }) => args] };
    expect(compilePayloadDefinition(transform)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupported" } });
  });

  it("bounds CRUD identities and combined update input before native access or database work", async () => {
    let getters = 0; let accesses = 0; let reads = 0;
    const collection = newsCollection(); collection.access = { ...collection.access, read: () => { accesses++; return true; } };
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* createPayloadBinding(collection, backend({ read: () => Effect.sync(() => { reads++; return null; }) }), "shop-a");
      for (const operation of [host.read("x".repeat(262145)).pipe(Effect.asVoid), host.prepareDelete("x".repeat(262145)).pipe(Effect.asVoid),
        host.prepareUpdate("a".repeat(140000), { headline: "x".repeat(140000) }).pipe(Effect.asVoid)]) {
        expect(yield* Effect.result(operation)).toMatchObject({ _tag: "Failure", failure: { reason: "limit" } });
      }
      expect(yield* Effect.result(host.prepareDelete("\uD800"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalid" } });
      expect(yield* Effect.result(host.prepareUpdate("row", { get score() { getters++; return 1; } })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalid" } });
    })));
    expect([getters, accesses, reads]).toEqual([0, 0, 0]);
  });

  it.each(["create", "updated-result"] as const)("supervises prepared %s native access through host shutdown", async operation => {
    let ready = () => {}; let release = () => {}; let signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const access = async (req: { signal?: AbortSignal }) => { signal = req.signal; ready(); await gate; return true; };
    const collection = newsCollection(); collection.access = { ...collection.access,
      ...(operation === "create" ? { create: ({ req }) => access(req) } : { update: ({ req }) => access(req) }) };
    const scope = await Effect.runPromise(Scope.make());
    const host = await Effect.runPromise(createPayloadBinding(collection, backend(), "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
    const prepared = await Effect.runPromise(host.prepareCreate({ headline: "scoped" }));
    const work = operation === "create" ? prepared.authorize() : host.authorizeUpdatedResult("row", { score: 7 });
    const pending = Effect.runPromiseExit(work); let closed = false; let closing: Promise<void> | undefined;
    try {
      await started; closing = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => { closed = true; });
      await delay(10); expect(signal?.aborted).toBe(true); expect(closed).toBe(false);
      release(); const result = await pending; await closing;
      expect(Exit.isFailure(result) && Cause.hasInterrupts(result.cause)).toBe(true);
      expect(await Effect.runPromise(Effect.result(operation === "create" ? prepared.authorize() : host.authorizeUpdatedResult("row", {}))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    } finally { release(); await pending; await (closing ?? Effect.runPromise(Scope.close(scope, Exit.void))); }
  });

  it("revokes and drains a dropped native DAL continuation before it can stage a late replacement", async () => {
    let ready = () => {}; let release = () => {}; let lateReplacements = 0;
    const started = new Promise<void>(resolve => { ready = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
    const collection = newsCollection(); collection.hooks = { afterChange: [async ({ req, doc }) => {
      void req.payload.db.updateOne({ collection: collection.slug, id: "other", data: { score: 99 }, req });
      await started; return doc;
    }] };
    const scope = await Effect.runPromise(Scope.make());
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(collection)));
    const storage = backend({ observeRows: Effect.fn("TestPayload.pausedRows")(function* (_command, ids) {
      if (ids.includes("other")) { ready(); yield* Effect.promise(() => gate); }
      return ids.map(id => { const body = { id, headline: id, score: 0, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" };
        return { id, revision: 1, body, bytes: Buffer.byteLength(JSON.stringify(body)) }; });
    }) });
    const root = await Effect.runPromise(createRoot(definition, storage, command));
    const host = await Effect.runPromise(createPayloadBinding(collection, storage, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
    const borrowed = { ...root, replace: (value: unknown) => {
      if (typeof value === "object" && value !== null && "id" in value && value.id === "other") lateReplacements++;
      return root.replace(value);
    } };
    let settled = false;
    const pending = Effect.runPromiseExit(host.borrowUpdate(borrowed, command.id, "row", { score: 1 })).then(result => { settled = true; return result; });
    try {
      await started; await delay(10); expect(settled).toBe(false); release();
      const result = await pending; expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
        .toContainEqual(expect.objectContaining({ reason: "unsupported" }));
      expect(lateReplacements).toBe(0); expect(root.diagnostics().rows).toBe(1);
      expect(await Effect.runPromiseExit(root.freeze())).toMatchObject({ _tag: "Failure" });
    } finally { release(); await pending; await Effect.runPromise(root.close); await Effect.runPromise(Scope.close(scope, Exit.void)); }
  });

  it("preserves a combined storage failure and cleanup defect across Payload", async () => {
    const storage = backend({ observeUnique: () => Effect.failCause(Cause.combine(
      Cause.fail(new CoreError({ reason: "storage" })), Cause.die(new Error("cleanup-witness")),
    )) });
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const host = yield* createPayloadBinding(newsCollection(), storage, "shop-a");
      const root = yield* createRoot(host.definition, storage, command);
      const prepared = yield* host.prepareCreate({ headline: "cause" });
      return yield* Effect.result(prepared.run(root, command.id)).pipe(Effect.ensuring(root.close));
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("NativeFailure");
      expect(result.failure.cause).toBeInstanceOf(NativeOperationFailure);
      if (!(result.failure.cause instanceof NativeOperationFailure)) throw new Error("Missing full native cause");
      expect(Cause.pretty(result.failure.cause.cause)).toContain("cleanup-witness");
      expect(Cause.findErrorOption(result.failure.cause.cause)).toMatchObject({ value: { reason: "storage" } });
    }
  });

  it("refuses concurrent duplicate identities without losing a successful row", async () => {
    const definition = await Effect.runPromise(Effect.fromResult(compilePayloadDefinition(newsCollection())));
    let release = () => {};
    let ready = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { ready = resolve; });
    let calls = 0;
    const storage = backend({ observeUnique: (_command, keys) => Effect.promise(async () => {
      if (++calls === 1) ready();
      await gate;
      return keys.map(key => ({ ...key, owner: null }));
    }) });
    const root = await Effect.runPromise(createRoot(definition, storage, command));
    const pending = ["one", "two"].map(headline => Effect.runPromiseExit(root.insert({
      id: "same", headline, score: 0, createdAt: "t", updatedAt: "t",
    })));
    await started; release();
    const results = await Promise.all(pending);
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    expect(results.filter(Exit.isFailure)).toHaveLength(1);
    expect(root.diagnostics().rows).toBe(1);
    expect(Exit.isFailure(await Effect.runPromiseExit(root.freeze()))).toBe(true);
  });
});
