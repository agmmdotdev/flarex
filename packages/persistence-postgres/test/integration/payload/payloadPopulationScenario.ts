import { Effect, Exit, Fiber, Result } from "effect";
import { expect } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadConformanceRuntime, inspectPayloadHostForTest, inspectPayloadRuntimeForTest, type PayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { payloadPostsCollectionDefinition } from "../../../../payload-adapter/src/testing/profiles";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { CorePersistenceError } from "../../../src/core/contracts";
import type { CoreError } from "../../../src/core/api";
import { defineCmsCommand, getCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { coreNativeTestBudget } from "../../core/nativeTestBudget";
import { barrier, overlappingSnapshotRace } from "./payloadRelationScenario";
import { finishPayloadSuccessor, expectNativeFailedWrite, awaitNativeTestGate } from "./payloadNativeRelationFixture";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";

function object(value: Json): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected Payload object");
  return value;
}
function id(value: Json): string {
  const valueId = object(value).id;
  if (typeof valueId !== "string") throw new Error("Expected Payload ID");
  return valueId;
}

export async function payloadPopulationScenario(driver: "pglite" | "postgres") {
  const scalar = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition()]));
  const related = await Effect.runPromise(compilePayloadCollections([payloadPostsCollectionDefinition("payload.content-relations")]));
  let runtime: PayloadConformanceRuntime | undefined;
  let afterBatch: (() => Effect.Effect<void, CoreError>) | undefined;
  let beforeFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
  let batchCalls = 0;
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, { compiled: scalar, preferences: true,
    futureSources: [{ compiled: related }],
    makeRuntime: compiled => makePayloadConformanceRuntime(compiled.configuration.profile).pipe(Effect.tap(value => Effect.sync(() => { runtime = value; })), Effect.map(value => value.runtime)),
    nativeHooks: { afterGetMany: () => { batchCalls++; return afterBatch?.() ?? Effect.void; }, beforeFinalize: () => beforeFinalize?.() ?? Effect.void },
  });
  const { run } = fixture;
  try {
    const scalarHost = fixture.writer;
    const target = id(await run(scalarHost.create(scalarHost.newRequestKey(), { collection: "posts", data: { title: "population-target", publishedAt: "2026-01-01" } })));
    const source = id(await run(scalarHost.create(scalarHost.newRequestKey(), { collection: "posts", data: { title: "population-source", publishedAt: "2026-01-01" } })));
    const successor = await fixture.prepareSuccessor(related);
    await finishPayloadSuccessor(fixture, successor);
    await fixture.rebind(successor);
    await run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data: { relatedPost: target } }));
    const create = (title: string, relatedPost?: string) => run(fixture.writer.create(fixture.writer.newRequestKey(), { collection: "posts", data: { title, publishedAt: "2026-01-01", ...(relatedPost === undefined ? {} : { relatedPost }) } }));
    const update = (documentId: string, data: JsonObject) => run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: documentId, data }));
    const read = (documentId: string, depth: 0 | 1 = 1) => run(fixture.reader.findByID({ collection: "posts", id: documentId, depth }));
    const second = id(await create("population-second", target));
    const batchProbe = defineCmsCommand({ name: "population-batch-probe", mode: "read", run: Effect.fn(function* (ctx, args) {
      if (!Array.isArray(args)) return yield* cmsError("invalidInput");
      const ids: string[] = [];
      for (const value of args) { if (typeof value !== "string") return yield* cmsError("invalidInput"); ids.push(value); }
      return [...yield* ctx.documents.getMany(ctx.context, undefined, "posts", ids)];
    }) });
    const nested = defineCmsCommand({ name: "population-nested-probe", mode: "write", run: (ctx, args) => ctx.nested(inspectPayloadRuntimeForTest(fixture.runtime).commands.findByID, args) });
    const capacity = defineCmsCommand({ name: "population-capacity-probe", mode: "read", run: Effect.fn(function* (ctx, args) {
      if (!Array.isArray(args)) return yield* cmsError("invalidInput");
      const ids: string[] = [];
      for (const value of args) { if (typeof value !== "string") return yield* cmsError("invalidInput"); ids.push(value); }
      for (let offset = 0; offset < ids.length; offset += 32) {
        const documents = yield* ctx.documents.getMany(ctx.context, undefined, "posts", ids.slice(offset, offset + 32));
        if (documents.some(document => document === null)) return yield* cmsError("documentMissing");
      }
      return null;
    }) });
    const reserve = defineCmsCommand({ name: "population-reservation-probe", mode: "read", run: ctx => ctx.reserveOutput(1_048_576).pipe(Effect.as(null)) });
    let host = await run(fixture.openHost([batchProbe, nested, capacity, reserve]));
    const before = await fixture.inventory();
    batchCalls = 0;
    expect(await run(host.read(batchProbe, [second, target, source]))).toEqual([
      expect.objectContaining({ _id: second }), expect.objectContaining({ _id: target }), expect.objectContaining({ _id: source }),
    ]);
    expect(batchCalls).toBe(1);
    expect(object(await read(source)).relatedPost).toMatchObject({ id: target, title: "population-target", relatedPost: null });
    expect(object(await read(source, 0)).relatedPost).toBe(target);
    expect(object(await run(fixture.reader.findByID({ collection: "posts", id: source }))).relatedPost).toBe(target);
    expect(object(await read(target)).relatedPost).toBeNull();
    const populated = object(await read(source));
    if (!isJsonObject(populated.relatedPost)) throw new Error("Missing populated target");
    expect(Reflect.set(populated.relatedPost, "title", "Caller changed")).toBe(true);
    expect(object(await read(source)).relatedPost).toMatchObject({ title: "population-target" });
    const page = object(await run(fixture.reader.find({ collection: "posts", depth: 1, limit: 32 })));
    expect(page.totalDocs).toBe(3);
    expect(page.docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: source, relatedPost: expect.objectContaining({ id: target }) }),
      expect.objectContaining({ id: second, relatedPost: expect.objectContaining({ id: target }) }),
    ]));
    expect(await fixture.inventory()).toEqual(before);
    const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    for (const depth of [-1, 2, 1.5, null, "1"]) expect(await run(Effect.flip(host.read(commands.findByID, { collection: "posts", id: source, depth })))).toMatchObject({ reason: "unsupportedProfile" });
    expect(await run(Effect.flip(host.run(host.newRequestKey(), commands.findByID, { collection: "posts", id: source, depth: 1 })))).toMatchObject({ reason: "invalidAuthority" });
    const nestedKey = host.newRequestKey();
    await expectNativeFailedWrite(fixture, nestedKey, host.run(nestedKey, nested, { collection: "posts", id: source, depth: 1 }), "unsupportedProfile");
    expect(await run(Effect.flip(host.read(commands.find, { collection: "posts", depth: 1, where: { id: { in: [target] } } })))).toMatchObject({ reason: "invalidInput" });
    expect(await run(Effect.flip(host.read(commands.findByID, { collection: "posts", id: "malformed", depth: 1 })))).toMatchObject({ reason: "invalidInput" });
    afterBatch = () => Effect.fail(new CorePersistenceError({ reason: "unavailable", cause: "injected native loader read failure" }));
    expect(await run(Effect.flip(fixture.reader.findByID({ collection: "posts", id: source, depth: 1 })))).toMatchObject({ reason: "resourceFailure" });
    afterBatch = undefined;
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(before));
    for (const args of [{ id: source, depth: 1, select: { title: true } }, { id: source, depth: 1, populate: {} }, { id: source, depth: 1, overrideAccess: true }]) {
      expect(await run(Effect.flip(host.read(commands.findByID, { collection: "posts", ...args })))).toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(object(await run(fixture.reader.find({ collection: "posts", depth: 1, where: { id: { equals: source }, title: { equals: "does-not-match" } } }))).docs).toEqual([]);
    await update(target, { title: "population-updated", relatedPost: source });
    expect(object(await read(source)).relatedPost).toMatchObject({ id: target, title: "population-updated", relatedPost: source });
    await update(source, { relatedPost: source });
    expect(object(await read(source)).relatedPost).toMatchObject({ id: source, relatedPost: source });
    await update(source, { relatedPost: null });
    expect(object(await read(source)).relatedPost).toBeNull();
    await update(target, { relatedPost: null });
    await run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: source }));
    expect(await run(Effect.flip(fixture.reader.findByID({ collection: "posts", id: source, depth: 1 })))).toMatchObject({ reason: "documentMissing" });
    expect(await run(host.read(batchProbe, [source, target]))).toEqual([null, expect.objectContaining({ _id: target })]);
    expect(await run(Effect.flip(host.read(batchProbe, [target, target])))).toMatchObject({ reason: "invalidInput" });
    expect(await run(Effect.flip(host.read(batchProbe, Array.from({ length: 33 }, () => target))))).toMatchObject({ reason: "limitExceeded" });
    // Native first observations are retained when competing writes follow them.
    for (const first of ["reader", "writer"] as const) {
      const beforeRace = await read(second);
      const entered = barrier<void>(), release = barrier<void>();
      const hold = () => Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise)));
      if (first === "reader") afterBatch = () => { afterBatch = undefined; return hold(); };
      else beforeFinalize = () => { beforeFinalize = undefined; return hold(); };
      const reading = fixture.reader.findByID({ collection: "posts", id: second, depth: 1 });
      const writing = fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: target, data: { title: `population-race-${first}` } });
      const results = await run(overlappingSnapshotRace(first === "reader" ? reading : writing, first === "reader" ? writing : reading, entered.promise, () => release.resolve()));
      expect(results.map(result => Result.isSuccess(result.value))).toEqual([true, true]);
      expect(results[first === "reader" ? 0 : 1]).toMatchObject({ value: { success: beforeRace } });
      expect(object(await read(second)).relatedPost).toMatchObject({ title: `population-race-${first}` });
    }
    const snapshot = await fixture.inventory();
    const entered = barrier<void>();
    afterBatch = () => { afterBatch = undefined; return Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never)); };
    const fiber = await run(fixture.reader.findByID({ collection: "posts", id: second, depth: 1 }).pipe(Effect.forkScoped));
    try { await run(awaitNativeTestGate(fiber, Effect.promise(() => entered.promise))); await run(Fiber.interrupt(fiber)); expect(Exit.isFailure(await run(Fiber.await(fiber)))).toBe(true); }
    finally { afterBatch = undefined; await run(Fiber.interrupt(fiber)); }
    expect(await fixture.inventory()).toEqual(snapshot);
    expect(object(await read(second)).relatedPost).toMatchObject({ id: target });
    // Deliberate persisted corruption is observed by a cold owner, then restored.
    const identity = Result.getOrThrow(decodeDocumentId(target));
    const rowBefore = await fixture.physical.query(`SELECT ts::text AS ts, json_value, deleted FROM "${fixture.physical.namespace}"."documents"
      WHERE instance_name=$1 AND id=$2 ORDER BY ts DESC LIMIT 1`, [fixture.instanceName, identity.internalId]);
    expect(rowBefore).toHaveLength(1);
    const originalRow = rowBefore[0];
    if (originalRow === null || typeof originalRow !== "object") throw new Error("Missing exact target revision");
    const timestamp = Reflect.get(originalRow, "ts"), originalBytes: unknown = Reflect.get(originalRow, "json_value");
    if (typeof timestamp !== "string" || !(originalBytes instanceof Uint8Array)) throw new Error("Invalid physical target evidence");
    await fixture.physical.query(`UPDATE "${fixture.physical.namespace}"."documents" SET deleted=true,json_value=$1 WHERE instance_name=$2 AND id=$3 AND ts=$4`,
      [new Uint8Array(), fixture.instanceName, identity.internalId, timestamp]);
    try {
      await fixture.reopen();
      expect(await run(Effect.flip(fixture.reader.findByID({ collection: "posts", id: second, depth: 1 })))).toMatchObject({ reason: "storedCorruption" });
    } finally {
      await fixture.physical.query(`UPDATE "${fixture.physical.namespace}"."documents" SET deleted=false,json_value=$1 WHERE instance_name=$2 AND id=$3 AND ts=$4`,
        [originalBytes, fixture.instanceName, identity.internalId, timestamp]);
      await fixture.reopen();
    }
    expect(await fixture.inventory()).toEqual(snapshot);
    const scalarCalls = runtime?.observations.executions();
    expect(await run(Effect.flip(scalarHost.findByID({ collection: "posts", id: target, depth: 1 })))).toMatchObject({ reason: "closed" });
    expect(runtime?.observations.executions()).toBe(scalarCalls);
    host = await run(fixture.openHost([batchProbe, nested, capacity, reserve]));
    const hugeKey = fixture.writer.newRequestKey();
    const baseline = await expectNativeFailedWrite(fixture, hugeKey, fixture.writer.update(hugeKey,
      { collection: "posts", id: target, data: { title: "語".repeat(22_000) } }), "limitExceeded");
    expect(await run(Effect.flip(host.read(reserve, {})))).toMatchObject({ reason: "limitExceeded" });
    expect(await fixture.inventory()).toEqual(baseline);
    // Populate the real current engine in bounded writes; no forged row/index fixtures.
    const createCommand = getCmsCommand(inspectPayloadRuntimeForTest(fixture.runtime).commands.create);
    if (createCommand === undefined) throw new Error("Missing native create command");
    const ids: string[] = [];
    for (let start = 0; start < 257; start += 120) await run(Effect.acquireUseRelease(
      fixture.database.beginNative(fixture.binding, { commandName: createCommand.name, ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
        for (let index = start; index < Math.min(start + 120, 257); index++) ids.push(yield* operation.operations.insert("posts", {
          title: `capacity-${index}`, publishedAt: "2026-01-01T00:00:00.000Z", score: 0, enabled: false,
          createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        }));
        yield* fixture.database.commit(yield* operation.finalize());
      }), operation => operation.abort()));
    batchCalls = 0;
    expect(await run(host.read(capacity, ids.slice(0, 256)))).toBeNull();
    expect(batchCalls).toBe(8);
    batchCalls = 0;
    expect(await run(Effect.flip(host.read(capacity, ids)))).toMatchObject({ reason: "limitExceeded" });
    expect(batchCalls).toBe(8);
  } finally { await fixture.close(); }
}
