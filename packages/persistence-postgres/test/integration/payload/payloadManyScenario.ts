import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { expect } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "../../../../flarex/src/server";
import { v } from "../../../../flarex/src/values";
import { inspectPayloadRuntimeForTest, makePayloadConformanceRuntime, type PayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import type { CoreError } from "../../../src/core/api";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";
import { barrier, overlappingSnapshotRace } from "./payloadRelationScenario";
import { awaitNativeTestGate, expectNativeFailedWrite, nativePreference, readNativePayload } from "./payloadNativeRelationFixture";
import { preparePayloadConformanceSource, readPayloadPhysicalData } from "./payloadNativeManyFixture";

const object = (value: Json): JsonObject => {
  if (!isJsonObject(value)) throw new Error("Expected native Payload document");
  return value;
};
const id = (value: Json): string => {
  const result = object(value).id;
  if (typeof result !== "string") throw new Error("Expected native Payload ID");
  return result;
};

/** The genuine fresh many consumer, including its native lifecycle and recovery. */
export async function payloadManyScenario(driver: "pglite" | "postgres") {
  const compiled = await preparePayloadConformanceSource("payload.content-many");
  const application = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ name: v.string() }) })));
  let runtime: PayloadConformanceRuntime | undefined;
  let beforeFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
  let afterBatch: (() => Effect.Effect<void, CoreError>) | undefined;
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, {
    compiled, application, preferences: true,
    makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(
      Effect.tap(value => Effect.sync(() => { runtime = value; })), Effect.map(value => value.runtime)),
    nativeHooks: { beforeFinalize: () => beforeFinalize?.() ?? Effect.void, afterGetMany: () => afterBatch?.() ?? Effect.void },
  });
  const { run } = fixture;
  const create = (title: string, data: JsonObject = {}) => run(fixture.writer.create(fixture.writer.newRequestKey(),
    { collection: "posts", data: { title, publishedAt: "2026-01-01", ...data } }));
  const update = (source: string, data: JsonObject) => run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data }));
  const remove = (source: string) => run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: source }));
  const read = (source: string, depth: 0 | 1 = 0) => run(fixture.reader.findByID({ collection: "posts", id: source, depth }));
  try {
    const first = await create("many-target-a");
    expect(first).toMatchObject({ relatedPost: null, relatedPosts: [] });
    const a = id(first), b = id(await create("many-target-b"));
    const source = id(await create("many-source", { relatedPost: a, relatedPosts: [a, b] }));
    expect(await read(source)).toMatchObject({ relatedPost: a, relatedPosts: [a, b] });
    const privateTable = fixture.definition.privateTables?.[0];
    if (privateTable === undefined) throw new Error("Missing authenticated many membership table");
    const memberships = () => fixture.inventory().then(inventory => inventory.rows.filter(row => row.table === privateTable.name && row.value.sourceId === source));
    const originalMemberships = await memberships();
    expect(originalMemberships).toHaveLength(2);
    expect(originalMemberships.map(row => row.value.targetId).sort()).toEqual([a, b].sort());
    const beforeReorder = await fixture.inventory();
    await update(source, { score: 3 });
    await update(source, { relatedPosts: [b, a] });
    expect(await memberships()).toEqual(originalMemberships);
    const accessBefore = runtime?.observations.readAccessCalls() ?? 0;
    const reordered = object(await read(source, 1));
    expect(runtime?.observations.readAccessCalls()).toBeGreaterThan(accessBefore + 1);
    expect(reordered.relatedPosts).toEqual([expect.objectContaining({ id: b, relatedPosts: [] }), expect.objectContaining({ id: a })]);
    expect(reordered.relatedPost).toMatchObject({ id: a });
    if (!Array.isArray(reordered.relatedPosts) || !isJsonObject(reordered.relatedPosts[0])) throw new Error("Missing populated result");
    expect(Reflect.set(reordered.relatedPosts[0], "title", "caller mutation")).toBe(true);
    expect(object(await read(source, 1)).relatedPosts).toEqual([expect.objectContaining({ id: b, title: "many-target-b" }), expect.objectContaining({ id: a })]);
    expect((await fixture.inventory()).outcomes).toHaveLength(beforeReorder.outcomes.length + 2);
    const incoming = await run(readNativePayload(fixture, operations => operations.incomingReferences("relatedPosts", a, { limit: 16 })));
    expect(incoming.value).toMatchObject({ ids: [source], hasMore: false, inspectedMemberships: 1 });
    expect((await run(readNativePayload(fixture, operations => operations.incomingReferences("relatedPost", a, { limit: 16 })))).value.ids).toEqual([source]);

    const native = runtime;
    if (native === undefined) throw new Error("Missing genuine many runtime");
    const beforeInvalid = coreNativeFixtureData(await fixture.inventory());
    const executions = native.observations.executions();
    for (const invalid of [null, [a, a], [1], [{ id: a }], ["bad-id"], Array.from({ length: 33 }, () => a)]) {
      const key = fixture.writer.newRequestKey();
      await expectNativeFailedWrite(fixture, key, fixture.writer.update(key,
        { collection: "posts", id: source, data: { relatedPosts: invalid } }), "relationInvalid");
    }
    const wrong = Result.getOrThrow(encodeDocumentId(999_999, crypto.getRandomValues(new Uint8Array(16))));
    const wrongKey = fixture.writer.newRequestKey();
    await expectNativeFailedWrite(fixture, wrongKey, fixture.writer.update(wrongKey,
      { collection: "posts", id: source, data: { relatedPosts: [wrong] } }), "invalidInput");
    expect(native.observations.executions()).toBe(executions);
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(beforeInvalid);
    const table = Result.getOrThrow(decodeDocumentId(a)).tableNumber;
    const missing = Result.getOrThrow(encodeDocumentId(table, crypto.getRandomValues(new Uint8Array(16))));
    const missingKey = fixture.writer.newRequestKey();
    await expectNativeFailedWrite(fixture, missingKey, fixture.writer.update(missingKey,
      { collection: "posts", id: source, data: { relatedPosts: [missing] } }), "relationTargetMissing");
    const restrictedKey = fixture.writer.newRequestKey();
    await expectNativeFailedWrite(fixture, restrictedKey, fixture.writer.delete(restrictedKey,
      { collection: "posts", id: a }), "relationDeleteRestricted");

    const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    const nested = defineCmsCommand({ name: "many-native-pending", mode: "write", run: Effect.fn("ManyTest.pending")(function* (ctx, args) {
      if (!isJsonObject(args)) return yield* cmsError("invalidInput");
      const created = yield* ctx.nested(commands.create, { collection: "posts", data: { title: "many-nested-target", publishedAt: "2026-01-01" } });
      const target = id(created);
      yield* ctx.nested(commands.update, { collection: "posts", id: source, data: { relatedPosts: [target] } });
      expect(yield* ctx.nested(commands.findByID, { collection: "posts", id: source })).toMatchObject({ relatedPosts: [target] });
      if (args.fail === true) return yield* cmsError("invalidInput");
      yield* ctx.nested(commands.update, { collection: "posts", id: source, data: { relatedPosts: [] } });
      yield* ctx.nested(commands.delete, { collection: "posts", id: target });
      return target;
    }) });
    const actualRead = defineCmsCommand({ name: "many-native-actual-target-read", mode: "write", run: Effect.fn("ManyTest.actualRead")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.target !== "string") return yield* cmsError("invalidInput");
      yield* ctx.documents.get(ctx.context, ctx.transactionId, args.target, "posts");
      return yield* ctx.nested(commands.update, { collection: "posts", id: source, data: { relatedPosts: [args.target] } });
    }) });
    let replayBodies = 0;
    const replay = defineCmsCommand({ name: "many-native-lost-ack", mode: "write", run: Effect.fn("ManyTest.lostAck")(function* (ctx) {
      replayBodies++;
      const value = yield* ctx.nested(inspectPayloadRuntimeForTest(fixture.runtime).commands.update,
        { collection: "posts", id: source, data: { relatedPost: a, relatedPosts: [b, a] } });
      fixture.loseNextWriteAcknowledgement();
      return value;
    }) });
    let host = await run(fixture.openHost([nested, actualRead, replay]));
    const rollback = coreNativeFixtureData(await fixture.inventory());
    const failedKey = host.newRequestKey();
    await expectNativeFailedWrite(fixture, failedKey, host.run(failedKey, nested, { fail: true }), "invalidInput");
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(rollback);
    await run(host.run(host.newRequestKey(), nested, {}));
    expect(await read(source)).toMatchObject({ relatedPost: a, relatedPosts: [] });
    expect(await memberships()).toHaveLength(0);
    await update(source, { relatedPosts: [source, b] });
    expect(object(await read(source, 1)).relatedPosts).toEqual([
      expect.objectContaining({ id: source, relatedPosts: [source, b] }), expect.objectContaining({ id: b }),
    ]);
    await update(source, { relatedPost: null, relatedPosts: [] });

    // No auth-only body read: both race orders use late integrity, with no replay.
    for (const held of ["assignment", "delete"] as const) {
      const target = id(await create("many-race-" + held));
      const entered = barrier<void>(), release = barrier<void>();
      beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise))); };
      const calls = runtime?.observations.executions() ?? 0;
      const assignment = fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPosts: [target] } });
      const deletion = fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: target });
      const results = await run(overlappingSnapshotRace(held === "assignment" ? assignment : deletion,
        held === "assignment" ? deletion : assignment, entered.promise, () => release.resolve()));
      expect(results[0]).toMatchObject({ value: { failure: { reason: held === "assignment" ? "relationTargetMissing" : "relationDeleteRestricted" } } });
      expect(Result.isSuccess(results[1].value)).toBe(true);
      expect(runtime?.observations.executions()).toBe(calls + 2);
      if (held === "delete") { await update(source, { relatedPosts: [] }); await remove(target); }
    }
    const target = id(await create("many-unobserved-target"));
    const entered = barrier<void>(), release = barrier<void>();
    beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise))); };
    const unrelated = await run(overlappingSnapshotRace(
      fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPosts: [target] } }),
      fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: target, data: { score: 7 } }),
      entered.promise, () => release.resolve()));
    expect(unrelated.map(value => Result.isSuccess(value.value))).toEqual([true, true]);
    await update(source, { relatedPosts: [] });
    const readEntered = barrier<void>(), readRelease = barrier<void>();
    beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => readEntered.resolve()).pipe(Effect.andThen(Effect.promise(() => readRelease.promise))); };
    const observed = await run(overlappingSnapshotRace(host.run(host.newRequestKey(), actualRead, { target }),
      fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: target }), readEntered.promise, () => readRelease.resolve()));
    expect(observed[0]).toMatchObject({ value: { failure: { reason: "writeConflict" } } });
    expect(Result.isSuccess(observed[1].value)).toBe(true);

    await update(source, { relatedPost: a, relatedPosts: [b, a] });
    const second = id(await create("many-second-source", { relatedPosts: [a, b], relatedPost: b }));
    await fixture.seedPreferences([nativePreference("many-preference", "collection-posts-" + second), nativePreference("many-unrelated", "unrelated")]);
    const beforeDelete = await fixture.inventory();
    await remove(second);
    const afterDelete = await fixture.inventory();
    expect(afterDelete.outcomes).toHaveLength(beforeDelete.outcomes.length + 1);
    expect(afterDelete.rows.filter(row => row.table === privateTable.name && row.value.sourceId === second)).toEqual([]);
    expect(afterDelete.rows.some(row => row.value.id === "many-preference")).toBe(false);
    expect(afterDelete.rows.some(row => row.value.id === "many-unrelated")).toBe(true);

    const key = host.newRequestKey();
    const beforeLost = await readPayloadPhysicalData(fixture);
    expect(await run(Effect.result(host.run(key, replay, null)))).toMatchObject({ failure: { reason: "decisionUncertain" } });
    expect(replayBodies).toBe(1);
    const saved = await readPayloadPhysicalData(fixture);
    expect(saved.documents.length).toBeGreaterThan(beforeLost.documents.length);
    await fixture.reopen();
    host = await run(fixture.openHost([nested, actualRead, replay]));
    expect(await run(host.run(key, replay, null))).toMatchObject({ id: source, relatedPosts: [b, a] });
    expect(replayBodies).toBe(1);
    expect(await readPayloadPhysicalData(fixture)).toEqual(saved);
    expect(object(await read(source, 1)).relatedPosts).toEqual([expect.objectContaining({ id: b }), expect.objectContaining({ id: a })]);

    // Interrupt a real population batch and prove the owner drains before reuse.
    const batchEntered = barrier<void>();
    afterBatch = () => { afterBatch = undefined; return Effect.sync(() => batchEntered.resolve()).pipe(Effect.andThen(Effect.never)); };
    const beforeReadInterrupt = await fixture.inventory();
    const reading = await run(fixture.reader.findByID({ collection: "posts", id: source, depth: 1 }).pipe(Effect.forkScoped));
    try { await run(awaitNativeTestGate(reading, Effect.promise(() => batchEntered.promise))); await run(Fiber.interrupt(reading)); }
    finally { afterBatch = undefined; await run(Fiber.interrupt(reading)); }
    expect(Exit.isFailure(await run(Fiber.await(reading)))).toBe(true);
    expect(await fixture.inventory()).toEqual(beforeReadInterrupt);

    // A foreign native delete hook is held, signalled and really released/drained.
    const interruptedId = id(await create("delete-unresolved", { relatedPosts: [a, b] }));
    const current = runtime;
    if (current === undefined) throw new Error("Missing cold native runtime");
    const pending = current.observations.pendingReads(), completed = current.observations.completedDeletes();
    const beforeInterrupt = coreNativeFixtureData(await fixture.inventory());
    await run(Effect.scoped(Effect.gen(function* () {
      const deleting = yield* fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: interruptedId }).pipe(Effect.forkScoped);
      yield* awaitNativeTestGate(deleting, Effect.gen(function* () {
        while (current.observations.pendingReads() === pending) yield* Effect.sleep(10);
      }));
      const interrupting = yield* Fiber.interrupt(deleting).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(current.observations.heldDeletes()).toBe(1);
      expect(current.observations.completedDeletes()).toBe(completed);
      expect(deleting.pollUnsafe()).toBeUndefined();
      expect(interrupting.pollUnsafe()).toBeUndefined();
      current.observations.releasePendingDeletes();
      const exit = yield* Fiber.await(deleting);
      yield* Fiber.join(interrupting);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(current.observations.completedDeletes()).toBe(completed + 1);
    }).pipe(Effect.ensuring(Effect.sync(current.observations.releasePendingDeletes)), Effect.timeout("5 seconds"))));
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(beforeInterrupt);
  } finally { runtime?.observations.releasePendingDeletes(); await fixture.close(); }
}

/** More than 256 derived members must not consume the 256 business-ID allowance. */
export async function payloadManyCapacityScenario(driver: "pglite" | "postgres") {
  const compiled = await preparePayloadConformanceSource("payload.content-many");
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, {
    compiled, preferences: true, makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(Effect.map(value => value.runtime)),
  });
  const { run } = fixture;
  try {
    const targets: string[] = [];
    for (let index = 0; index < 32; index++) targets.push(id(await run(fixture.writer.create(fixture.writer.newRequestKey(),
      { collection: "posts", data: { title: "many-cap-node-" + index, publishedAt: "2026-01-01" } }))));
    const sources = [...targets];
    const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    const graph = defineCmsCommand({ name: "many-native-full-graph", mode: "write", run: Effect.fn("ManyTest.fullGraph")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.offset !== "number") return yield* cmsError("invalidInput");
      for (const source of sources.slice(args.offset, args.offset + 9)) yield* ctx.nested(commands.update, { collection: "posts", id: source, data: { relatedPosts: targets } });
      return null;
    }) });
    const host = await run(fixture.openHost([graph]));
    // Each admitted root stages 288 members under 32 business identities while
    // retaining the existing CMS call budget; the retained graph has 1024 members.
    for (let offset = 0; offset < 32; offset += 9) await run(host.run(host.newRequestKey(), graph, { offset }));
    const privateTable = fixture.definition.privateTables?.[0];
    if (privateTable === undefined) throw new Error("Missing private membership inventory");
    expect((await fixture.inventory()).rows.filter(row => row.table === privateTable.name)).toHaveLength(1024);
    for (const source of sources) expect(await run(fixture.reader.findByID({ collection: "posts", id: source }))).toMatchObject({ relatedPosts: targets });

    // The genuine loader's distinct-target budget is independent of member count.
    expect(await run(fixture.reader.find({ collection: "posts", depth: 1, limit: 32,
      where: { title: { equals: "many-cap-node-0" } } }))).toMatchObject({ docs: [expect.objectContaining({ relatedPosts: targets.map(target => expect.objectContaining({ id: target })) })] });
    // Valid indexed fields amplify repeated native output copies, while the
    // distinct target set stays32 and each stored document stays bounded.
    for (const [index, source] of sources.entries()) await run(fixture.writer.update(fixture.writer.newRequestKey(),
      { collection: "posts", id: source, data: { title: "many-output-" + index + "-" + "x".repeat(1900) } }));
    const beforeOutput = await fixture.inventory();
    expect(await run(Effect.flip(fixture.reader.find({ collection: "posts", depth: 1, limit: 32 })))).toMatchObject({ reason: "limitExceeded" });
    expect(await fixture.inventory()).toEqual(beforeOutput);
    for (const [index, source] of sources.entries()) await run(fixture.writer.update(fixture.writer.newRequestKey(),
      { collection: "posts", id: source, data: { title: "many-cap-restored-" + index } }));
    const before = await fixture.inventory();
    const extra = id(await run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title: "many-cap-extra", publishedAt: "2026-01-01" } })));
    const root = sources[0];
    if (root === undefined) throw new Error("Missing graph root");
    await run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: root, data: { relatedPost: extra } }));
    expect(await run(Effect.flip(fixture.reader.findByID({ collection: "posts", id: root, depth: 1 })))).toMatchObject({ reason: "limitExceeded" });
    expect((await fixture.inventory()).outcomes).toHaveLength(before.outcomes.length + 2);
  } finally { await fixture.close(); }
}
