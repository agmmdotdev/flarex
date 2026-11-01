import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { expect } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "../../../../flarex/src/server";
import { v } from "../../../../flarex/src/values";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadConformanceRuntime, inspectPayloadRuntimeForTest, type PayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { payloadPostsCollectionDefinition } from "../../../../payload-adapter/src/testing/profiles";
import { createCorePayloadFixture, type CorePayloadSuccessor } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { CorePersistenceError } from "../../../src/core/contracts";
import type { CoreError } from "../../../src/core/api";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { finishPayloadSuccessor, nativePreference, readNativePayload, expectNativeFailedWrite, awaitNativeTestGate } from "./payloadNativeRelationFixture";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { CmsHostInput } from "../../../src/frameworks/cmsTransaction/host";
import type { makeDataBindingHost } from "../../../src/installation/frameworkSchema/binding/host";
import type { relationReadinessFixture } from "../../application/relations/applicationRelationReadinessFixture";
import type { PayloadContentProfiles } from "../../../src/frameworks/payloadPreferences/binding";

/** Retained only by the unmigrated many/joins consumer closure. */
export interface LegacyPayloadRelationScenarioInput {
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  fixture: Awaited<ReturnType<typeof relationReadinessFixture>>;
  bindings: Effect.Success<ReturnType<typeof makeDataBindingHost>>;
  payloadProfiles: PayloadContentProfiles;
  hostInput: Omit<CmsHostInput<unknown>, "commands">;
  seed: (id: string, preferences: readonly string[]) => Promise<void>;
  inventory: () => Promise<unknown>;
  reopen?: () => Promise<void>;
}

function documentId(value: Json): string {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Expected Payload document");
  return value.id;
}

/** Preserve the real populated scalar -> optional-one transition and its IDs. */
export async function payloadRelationScenario(driver: "pglite" | "postgres") {
  const scalarCompiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition()]));
  const relationCompiled = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
  const application = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ name: v.string() }).index("by_name", ["name"]) })));
  const applicationNext = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ name: v.string(), note: v.optional(v.string()) }).index("by_name", ["name"]) })));
  let conformance: PayloadConformanceRuntime | undefined;
  let afterFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
  let beforeFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
  let failPhysicalChunk = false;
  let physicalChunks = 0;
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled: scalarCompiled, application, preferences: true,
    futureSources: [{ compiled: relationCompiled, application }, { compiled: relationCompiled, application: applicationNext }],
    makeRuntime: compiled => makePayloadConformanceRuntime(compiled.configuration.profile).pipe(Effect.tap(value => Effect.sync(() => { conformance = value; })), Effect.map(value => value.runtime)),
    nativeHooks: { afterFinalize: () => afterFinalize?.() ?? Effect.void, beforeFinalize: () => beforeFinalize?.() ?? Effect.void },
    afterIndexBackfill: indexes => Effect.suspend(() => {
      if (indexes.length === 0) return Effect.void;
      physicalChunks++;
      if (!failPhysicalChunk) return Effect.void;
      failPhysicalChunk = false;
      return Effect.fail(new CorePersistenceError({ reason: "unavailable", cause: "after durable native reverse-index chunk, before checkpoint" }));
    }),
  });
  const { run } = fixture;
  try {
    const oldHost = fixture.writer;
    const oldRuntime = conformance;
    if (oldRuntime === undefined) throw new Error("Missing scalar Local API runtime");
    const createOld = (title: string) => run(oldHost.create(oldHost.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01" } }));
    const targetDocument = await createOld("relation-target");
    const sourceDocument = await createOld("relation-source");
    const target = documentId(targetDocument), source = documentId(sourceDocument);
    const denyOrdinary = () => run(Effect.acquireUseRelease(fixture.database.begin(), tx => Effect.gen(function* () {
      expect(yield* Effect.flip(tx.patch(source, { score: 999 }))).toMatchObject({ reason: "authorityRevoked" });
    }), tx => tx.abort()));
    await denyOrdinary();
    // A writer finalized before the new index existed cannot omit that generation.
    const entered = barrier<void>(), release = barrier<void>();
    afterFinalize = () => { afterFinalize = undefined; return Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise))); };
    const staleCalls = oldRuntime.observations.executions();
    const staleWriter = await run(oldHost.update(oldHost.newRequestKey(), { collection: "posts", id: source, data: { score: 6 } }).pipe(Effect.forkScoped));
    let successor: CorePayloadSuccessor | undefined;
    try {
      await run(awaitNativeTestGate(staleWriter, Effect.promise(() => entered.promise)));
      successor = await fixture.prepareSuccessor(relationCompiled);
    } finally { release.resolve(); }
    expect(await run(Fiber.join(staleWriter).pipe(Effect.result))).toMatchObject({ failure: { reason: "writeConflict" } });
    expect(oldRuntime.observations.executions()).toBe(staleCalls + 1);
    if (successor === undefined) throw new Error("Missing actual native successor");
    expect(await run(Effect.result(fixture.database.activateSchema(successor.proposal, successor.bundle === undefined
      ? { programs: [], native: successor.definition } : { programs: [], bundle: successor.bundle })))).toMatchObject(expect.objectContaining({ failure: expect.anything() }));
    await denyOrdinary();
    expect(await run(oldHost.update(oldHost.newRequestKey(), { collection: "posts", id: source, data: { score: 7 } }))).toMatchObject({ id: source, title: "relation-source", score: 7 });
    const duringBuild = documentId(await createOld("relation-during-build"));
    failPhysicalChunk = true;
    let interrupted = false;
    for (let step = 0; step < 512 && !interrupted; step++) {
      const result = await run(Effect.result(fixture.database.advanceSchema(successor.proposal, { pageSize: 1, maxPages: 1 })));
      if (Result.isFailure(result)) { expect(result.failure).toMatchObject({ reason: "unavailable" }); interrupted = true; }
    }
    expect(interrupted).toBe(true);
    expect(physicalChunks).toBeGreaterThan(0);
    await fixture.reopen();
    expect(await run(fixture.reader.findByID({ collection: "posts", id: source }))).toMatchObject({ id: source, title: "relation-source", score: 7 });
    expect(await run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { score: 8 } }))).toMatchObject({ score: 8 });
    const stillScalar = fixture.writer;
    const scalarRuntime = conformance;
    if (scalarRuntime === undefined) throw new Error("Missing resumed scalar runtime");
    await finishPayloadSuccessor(fixture, successor);
    const callbacks = scalarRuntime.observations.executions();
    expect(await run(Effect.result(stillScalar.findByID({ collection: "posts", id: source })))).toMatchObject({ failure: { reason: "bindingChanged" } });
    expect(scalarRuntime.observations.executions()).toBe(callbacks);
    await fixture.rebind(successor);
    await denyOrdinary();
    expect(await run(fixture.reader.findByID({ collection: "posts", id: source }))).toMatchObject({ id: source, title: "relation-source", score: 8, relatedPost: null });
    expect(await run(fixture.reader.findByID({ collection: "posts", id: target }))).toMatchObject({ ...targetDocument, id: target, relatedPost: null });
    const reverse = fixture.definition.references[0];
    if (reverse === undefined) throw new Error("Missing installed authenticated reference");
    const inventory = await fixture.inventory();
    const reverseIds = inventory.indexes.filter(index => index.table === "posts" && index.name === reverse.indexName).map(index => index.id);
    for (const id of [source, target, duringBuild]) expect(reverseIds).toContain(encodeBytesToLowercaseHex(Result.getOrThrow(decodeDocumentId(id)).internalId));
    const update = (id: string, data: JsonObject) => run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id, data }));
    const remove = (id: string) => run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id }));
    const read = (id: string) => run(fixture.reader.findByID({ collection: "posts", id }));
    const create = (title: string, relatedPost?: string) => run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01", ...(relatedPost === undefined ? {} : { relatedPost }) } }));
    for (const relatedPost of [{ id: target }, 42, [target]]) {
      const executions = conformance?.observations.executions();
      const rejectedKey = fixture.writer.newRequestKey();
      await expectNativeFailedWrite(fixture, rejectedKey, fixture.writer.update(rejectedKey,
        { collection: "posts", id: source, data: { relatedPost } }), "relationInvalid");
      expect(conformance?.observations.executions()).toBe(executions);
    }
    await update(source, { relatedPost: target });
    expect(await read(source)).toMatchObject({ relatedPost: target, score: 8 });
    expect(await run(Effect.flip(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: target })))).toMatchObject({ reason: "relationDeleteRestricted" });
    await update(source, { relatedPost: source });
    await update(target, { relatedPost: source });
    await update(target, { relatedPost: null });
    await update(source, { relatedPost: target });
    const relationCommands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    const nested = defineCmsCommand({ name: "relation-nested", mode: "write", run: Effect.fn(function* (ctx, args) {
      if (!isJsonObject(args)) return yield* cmsError("invalidInput");
      if (args.kind === "create") {
        const child = yield* ctx.nested(relationCommands.create, { collection: "posts", data: { title: "relation-nested-target", publishedAt: "2026-01-01" } });
        return yield* ctx.nested(relationCommands.update, { collection: "posts", id: source, data: { relatedPost: documentId(child) } });
      }
      yield* ctx.nested(relationCommands.update, { collection: "posts", id: source, data: { relatedPost: null } });
      return yield* ctx.nested(relationCommands.delete, { collection: "posts", id: args.id ?? null });
    }) });
    const host = await run(fixture.openHost([nested]));
    const linked = await run(host.run(host.newRequestKey(), nested, { kind: "create" }));
    if (!isJsonObject(linked) || typeof linked.relatedPost !== "string") throw new Error("Missing same-root pending relation target");
    await fixture.seedPreferences([nativePreference("relation-preference", `collection-posts-${linked.relatedPost}`)]);
    const beforeNestedDelete = await fixture.inventory();
    await run(host.run(host.newRequestKey(), nested, { kind: "delete", id: linked.relatedPost }));
    const afterNestedDelete = await fixture.inventory();
    expect(afterNestedDelete.outcomes).toHaveLength(beforeNestedDelete.outcomes.length + 1);
    expect(afterNestedDelete.revisions).toHaveLength(beforeNestedDelete.revisions.length + 3);
    expect(await read(source)).toMatchObject({ relatedPost: null });
    // Both late-integrity race orders run actual Local API callbacks exactly once.
    for (const first of ["insert", "delete"] as const) {
      const raceTarget = documentId(await create(`race-${first}`));
      const raceEntered = barrier<void>(), raceRelease = barrier<void>();
      beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => raceEntered.resolve()).pipe(Effect.andThen(Effect.promise(() => raceRelease.promise))); };
      const callsBefore = conformance?.observations.executions() ?? 0;
      const firstWork = first === "insert" ? fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPost: raceTarget } })
        : fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: raceTarget });
      const secondWork = first === "insert" ? fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: raceTarget })
        : fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPost: raceTarget } });
      const results = await run(overlappingSnapshotRace(firstWork, secondWork, raceEntered.promise, () => raceRelease.resolve()));
      expect(results[0]).toMatchObject({ value: { failure: { reason: first === "insert" ? "relationTargetMissing" : "relationDeleteRestricted" } } });
      expect(results[1]).toMatchObject({ value: expect.objectContaining({ success: expect.anything() }) });
      expect(conformance?.observations.executions()).toBe(callsBefore + 2);
      const failedCalls = conformance?.observations.executions();
      expect(await run(Effect.result(firstWork))).toMatchObject({ failure: { reason: "requestConflict" } });
      expect(conformance?.observations.executions()).toBe(failedCalls);
      if (first === "delete") { await update(source, { relatedPost: null }); await remove(raceTarget); }
    }
    // Unobserved target-body updates do not invent a semantic body dependency.
    const unrelatedEntered = barrier<void>(), unrelatedRelease = barrier<void>();
    beforeFinalize = () => { beforeFinalize = undefined; return Effect.sync(() => unrelatedEntered.resolve()).pipe(Effect.andThen(Effect.promise(() => unrelatedRelease.promise))); };
    const unrelated = await run(overlappingSnapshotRace(
      fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPost: target } }),
      fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: target, data: { score: 17 } }), unrelatedEntered.promise, () => unrelatedRelease.resolve()));
    expect(unrelated.map(result => Result.isSuccess(result.value))).toEqual([true, true]);
    // A later compatible audit source evolution remains valid under score writes.
    const auditSuccessor = await fixture.prepareSuccessor(relationCompiled, applicationNext);
    for (let step = 0; step < 512; step++) {
      const status = await run(fixture.database.schemaStatus(auditSuccessor.proposal));
      if (status.state === "validated" && status.indexesReady) break;
      await run(fixture.database.advanceSchema(auditSuccessor.proposal, { pageSize: 2, maxPages: 1 }));
    }
    const scoreKey = fixture.writer.newRequestKey();
    const scoreResult = await run(fixture.writer.update(scoreKey, { collection: "posts", id: source, data: { score: 23 } }));
    await fixture.activateSuccessor(auditSuccessor);
    await fixture.rebind(auditSuccessor);
    expect(await read(source)).toMatchObject({ id: source, score: 23, relatedPost: target });
    // Body count is stable when replaying a real native outcome after cold reopen.
    await fixture.reopen();
    expect(await run(fixture.writer.update(scoreKey, { collection: "posts", id: source, data: { score: 23 } }))).toEqual(scoreResult);
    expect(await read(source)).toMatchObject({ id: source, score: 23, relatedPost: target });
    const interruptedId = documentId(await create("delete-unresolved", target));
    await fixture.seedPreferences([nativePreference("relation-interrupted", `collection-posts-${interruptedId}`)]);
    const beforeInterrupt = await fixture.inventory();
    const currentRuntime = conformance;
    if (currentRuntime === undefined) throw new Error("Missing native cancellation runtime");
    const pending = currentRuntime.observations.pendingReads();
    const completed = currentRuntime.observations.completedDeletes();
    const callbackCount = currentRuntime.observations.executions();
    const interruptedKey = fixture.writer.newRequestKey();
    await run(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* fixture.writer.delete(interruptedKey, { collection: "posts", id: interruptedId }).pipe(Effect.forkScoped);
      const arrival = Effect.gen(function* () {
        while (currentRuntime.observations.pendingReads() === pending) yield* Effect.sleep(10);
      });
      yield* awaitNativeTestGate(fiber, arrival);
      const interrupting = yield* Fiber.interrupt(fiber).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(currentRuntime.observations.heldDeletes()).toBe(1);
      expect(currentRuntime.observations.completedDeletes()).toBe(completed);
      expect(fiber.pollUnsafe()).toBeUndefined();
      expect(interrupting.pollUnsafe()).toBeUndefined();
      currentRuntime.observations.releasePendingDeletes();
      const exit = yield* Fiber.await(fiber);
      yield* Fiber.join(interrupting);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(currentRuntime.observations.heldDeletes()).toBe(0);
      expect(currentRuntime.observations.completedDeletes()).toBe(completed + 1);
      expect(currentRuntime.observations.executions()).toBe(callbackCount + 1);
    }).pipe(Effect.ensuring(Effect.sync(currentRuntime.observations.releasePendingDeletes)), Effect.timeout("5 seconds"))));
    const afterInterrupt = await fixture.inventory();
    expect(coreNativeFixtureData(afterInterrupt)).toEqual(coreNativeFixtureData(beforeInterrupt));
    expect(afterInterrupt.outcomes).toHaveLength(beforeInterrupt.outcomes.length + 1);
    expect(afterInterrupt.outcomes.find(outcome => outcome.value.key === interruptedKey)?.value.state).toBe("failed");
    await update(interruptedId, { title: "interrupted-restored", relatedPost: null });
    await remove(interruptedId);
    await update(source, { relatedPost: null });
    await remove(source);
    expect((await run(readNativePayload(fixture, operations => operations.incomingReferences("relatedPost", target, { limit: 16 })))).value).toEqual({ ids: [], hasMore: false });
    await remove(target);
  } finally { conformance?.observations.releasePendingDeletes(); await fixture.close(); }
}

export function barrier<Value>() {
  let resolve: (value: Value) => void = () => { throw new Error("Uninitialized barrier"); };
  const promise = new Promise<Value>(release => { resolve = release; });
  return { promise, resolve };
}

export async function withDeadline<Value>(promise: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Native barrier deadline")), 5000); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Retained PostgreSQL lock witness for the unmigrated many/joins closure. */
export async function heldNativeRace(persistence: PostgresFlarexPersistence, first: Effect.Effect<unknown, unknown>, second: Effect.Effect<unknown, unknown>, entered: Promise<void>, release: () => void) {
  const firstObserved = Promise.allSettled([Effect.runPromise(first.pipe(Effect.result))]);
  let secondObserved: typeof firstObserved | undefined;
  let results: Array<Awaited<typeof firstObserved>[number]> = [];
  try {
    await withDeadline(Promise.race([entered, firstObserved.then(() => { throw new Error("Native change exited before its barrier"); })]));
    secondObserved = Promise.allSettled([Effect.runPromise(second.pipe(Effect.result))]);
    const deadline = performance.now() + 5000;
    let waiting = false;
    while (!waiting && performance.now() < deadline) {
      const rows = await persistence.pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where usename = current_user and datname = current_database() and application_name = current_setting('application_name') and pid <> pg_backend_pid() and cardinality(pg_blocking_pids(pid)) > 0) as waiting");
      waiting = rows.rows[0]?.waiting === true;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally { release(); results = [...await firstObserved, ...(secondObserved === undefined ? [] : await secondObserved)]; }
  return results;
}

/** The second operation settles before the first native finalization resumes. */
export const overlappingSnapshotRace = Effect.fn("PayloadTest.overlappingSnapshotRace")(
  (first: Effect.Effect<unknown, unknown>, second: Effect.Effect<unknown, unknown>, entered: Promise<void>, release: () => void) =>
    Effect.scoped(Effect.gen(function* () {
      const firstFiber = yield* first.pipe(Effect.result, Effect.forkScoped);
      yield* Effect.raceFirst(Effect.promise(() => entered), Fiber.join(firstFiber).pipe(Effect.andThen(Effect.fail(new Error("Snapshot race exited before its barrier")))));
      const secondFiber = yield* second.pipe(Effect.result, Effect.forkScoped);
      const secondResult = yield* Fiber.join(secondFiber);
      yield* Effect.sync(release);
      const firstResult = yield* Fiber.join(firstFiber);
      return [{ status: "fulfilled" as const, value: firstResult }, { status: "fulfilled" as const, value: secondResult }];
    }).pipe(Effect.ensuring(Effect.sync(release)), Effect.timeout("5 seconds"))),
);
