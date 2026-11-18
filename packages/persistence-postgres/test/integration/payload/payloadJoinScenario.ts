import { Effect, Exit, Fiber, Result } from "effect";
import { expect, vi } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { defineSchema, defineTable } from "../../../../flarex/src/server";
import { v } from "../../../../flarex/src/values";
import { inspectPayloadRuntimeForTest, makePayloadConformanceRuntime, type PayloadConformanceRuntime } from "../../../../payload-adapter/src/testing";
import { createCorePayloadFixture } from "../../../../payload-adapter/test/support/core-payload-fixture";
import { defineCmsCommand, type CmsCommandContext } from "../../../src/frameworks/cmsTransaction/commands";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import type { CoreError } from "../../../src/core/api";
import type { CoreWriteBatch } from "../../../src/core/contracts";
import { coreNativeFixtureData } from "../../core/nativeFixtureInventory";
import { barrier, overlappingSnapshotRace } from "./payloadRelationScenario";
import { awaitNativeTestGate, expectNativeFailedWrite, nativeTokenInvalidated, readNativePayload } from "./payloadNativeRelationFixture";
import { preparePayloadConformanceSource } from "./payloadNativeManyFixture";
import type { PayloadJoinInput } from "../../../../payload-adapter/src/joins";

const object = (value: Json): JsonObject => {
  if (!isJsonObject(value)) throw new Error("Expected native Payload document");
  return value;
};
const id = (value: Json): string => {
  const valueId = object(value).id;
  if (typeof valueId !== "string") throw new Error("Expected native Payload ID");
  return valueId;
};

/** Genuine reverse Local API joins use ordinary indexes and the same native root. */
export async function payloadJoinScenario(driver: "pglite" | "postgres") {
  const compiled = await preparePayloadConformanceSource("payload.content-joins");
  const application = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ name: v.string() }) })));
  const applicationNext = await Effect.runPromise(prepareApplicationSchemaSource(defineSchema({ audit: defineTable({ name: v.string(), note: v.optional(v.string()) }) })));
  const batches: CoreWriteBatch[] = [];
  let runtime: PayloadConformanceRuntime | undefined;
  let beforeFinalize: (() => Effect.Effect<void, CoreError>) | undefined;
  let afterBatch: (() => Effect.Effect<void, CoreError>) | undefined;
  const fixture = await createCorePayloadFixture({ kind: "fresh", driver }, {
    compiled, application, preferences: true, futureSources: [{ compiled, application: applicationNext }],
    makeRuntime: source => makePayloadConformanceRuntime(undefined, source).pipe(
      Effect.tap(value => Effect.sync(() => { runtime = value; })), Effect.map(value => value.runtime)),
    observeWrite: batch => batches.push(batch),
    nativeHooks: { beforeFinalize: () => beforeFinalize?.() ?? Effect.void, afterGetMany: () => afterBatch?.() ?? Effect.void },
  });
  const { run } = fixture;
  const create = (title: string, data: JsonObject = {}) => run(fixture.writer.create(fixture.writer.newRequestKey(),
    { collection: "posts", data: { title, publishedAt: "2026-01-01", ...data } }));
  const update = (source: string, data: JsonObject) => run(fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: source, data }));
  const remove = (source: string) => run(fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: source }));
  const read = (source: string, depth: 0 | 1 = 0, joins?: PayloadJoinInput) => run(fixture.reader.findByID(
    { collection: "posts", id: source, depth, ...(joins === undefined ? {} : { joins }) }));
  try {
    const target = id(await create("join-target")), other = id(await create("join-other"));
    expect(await read(target)).toMatchObject({ referencedBy: { docs: [], hasNextPage: false }, referencedByMany: { docs: [], hasNextPage: false } });
    const sources: string[] = [];
    for (let index = 0; index < 9; index++) {
      const created = await create("join-source-" + index, { relatedPost: target, relatedPosts: [target, other] });
      expect(object(created).referencedBy).toBeUndefined();
      sources.push(id(created));
    }
    const ordered = sources.toSorted((left, right) => compareBytesLexicographically(
      Result.getOrThrow(decodeDocumentId(left)).internalId, Result.getOrThrow(decodeDocumentId(right)).internalId));
    const beforeReads = await fixture.inventory();
    const page = object(await read(target));
    expect(page.referencedBy).toEqual({ docs: ordered.slice(0, 8), hasNextPage: true });
    expect(page.referencedByMany).toEqual(page.referencedBy);
    expect(object(await read(target, 0, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).toEqual({ docs: ordered, hasNextPage: false });
    expect(object(await read(target, 0, false)).referencedBy).toBeUndefined();
    const accessBefore = runtime?.observations.readAccessCalls() ?? 0;
    const populated = object(object(await read(target, 1)).referencedBy);
    expect(runtime?.observations.readAccessCalls()).toBeGreaterThan(accessBefore + 1);
    expect(populated.docs).toEqual(ordered.slice(0, 8).map(source => expect.objectContaining({ id: source, relatedPost: target, relatedPosts: [target, other] })));
    expect(populated.totalDocs).toBeUndefined();
    if (!Array.isArray(populated.docs) || !isJsonObject(populated.docs[0])) throw new Error("Missing populated reverse sources");
    for (const row of populated.docs) expect(object(row).referencedByMany).toBeUndefined();
    expect(Reflect.set(populated.docs[0], "score", 999)).toBe(true);
    expect(object(object(await read(target, 1)).referencedBy).docs).not.toEqual(populated.docs);
    expect(await fixture.inventory()).toEqual(beforeReads);

    const native = runtime;
    if (native === undefined) throw new Error("Missing genuine join runtime");
    const commands = inspectPayloadRuntimeForTest(fixture.runtime).commands;
    const rawHost = await run(fixture.openHost([]));
    const executions = native.observations.executions();
    for (const joins of [{ unknown: {} }, { referencedBy: { limit: null } }, { referencedBy: { limit: 0 } },
      { referencedBy: { limit: 17 } }, { referencedBy: { page: 2 } }, { referencedBy: { count: true } },
      { referencedBy: { sort: "id" } }, { referencedBy: { where: {} } }, null]) {
      expect(await run(Effect.flip(rawHost.read(commands.findByID, { collection: "posts", id: target, joins })))).toMatchObject({ reason: "unsupportedProfile" });
    }
    const invalidWrite = fixture.writer.newRequestKey();
    await expectNativeFailedWrite(fixture, invalidWrite, fixture.writer.update(invalidWrite,
      { collection: "posts", id: target, data: { referencedBy: [] } }), "unsupportedProfile");
    expect(native.observations.executions()).toBe(executions);
    expect(await run(rawHost.read(commands.findByID, { collection: "posts", id: target }))).toMatchObject({ id: target });
    await run(rawHost.close);
    expect(await run(Effect.flip(rawHost.read(commands.findByID, { collection: "posts", id: target })))).toMatchObject({ reason: "closed" });

    let escaped: CmsCommandContext | undefined;
    const probe = defineCmsCommand({ name: "join-native-probe", mode: "read", run: Effect.fn("JoinTest.probe")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.target !== "string") return yield* cmsError("invalidInput");
      if (args.capture === true) escaped = ctx;
      const found = yield* ctx.relations.incoming(args.forged === true ? { ...ctx.context } : ctx.context,
        ctx.transactionId, "relatedPosts", args.target, 8);
      return { docs: [...found.docs], hasNextPage: found.hasNextPage };
    }) });
    const nested = defineCmsCommand({ name: "join-native-nested", mode: "read", run: (ctx, args) => ctx.nested(probe, args) });
    const caught = defineCmsCommand({ name: "join-native-caught", mode: "write", run: Effect.fn("JoinTest.caught")(function* (ctx) {
      yield* ctx.relations.incoming(ctx.context, ctx.transactionId, "relatedPosts", target, 8).pipe(Effect.result);
      return yield* ctx.nested(commands.create, { collection: "posts", data: { title: "join-must-not-publish", publishedAt: "2026-01-01" } });
    }) });
    const windows = defineCmsCommand({ name: "join-native-window-bound", mode: "read", run: Effect.fn("JoinTest.windows")(function* (ctx, args) {
      if (!isJsonObject(args) || typeof args.windows !== "number") return yield* cmsError("invalidInput");
      for (let index = 0; index < args.windows; index++) yield* ctx.relations.incoming(ctx.context, ctx.transactionId, "relatedPosts", target, 16);
      return null;
    }) });
    let host = await run(fixture.openHost([probe, nested, caught, windows]));
    expect(await run(Effect.flip(host.read(probe, { target, forged: true })))).toMatchObject({ reason: "invalidAuthority" });
    const wrong = Result.getOrThrow(encodeDocumentId(999_999, crypto.getRandomValues(new Uint8Array(16))));
    expect(await run(Effect.flip(host.read(probe, { target: wrong })))).toMatchObject({ reason: "invalidInput" });
    expect(await run(Effect.flip(host.read(nested, { target })))).toMatchObject({ reason: "invalidAuthority" });
    const caughtKey = host.newRequestKey();
    await expectNativeFailedWrite(fixture, caughtKey, host.run(caughtKey, caught, null), "rollbackOnly");
    expect(await run(host.read(probe, { target, capture: true }))).toEqual({ docs: ordered.slice(0, 8), hasNextPage: true });
    const retained = escaped;
    if (retained === undefined) throw new Error("Missing captured genuine context");
    expect(await run(Effect.flip(retained.relations.incoming(retained.context, retained.transactionId, "relatedPosts", target, 8))))
      // Closing removes this successfully completed ROOT token from the
      // context registry, so a retained capability is no longer authentic.
      .toMatchObject({ reason: "invalidAuthority" });
    expect(coreNativeFixtureData(await fixture.inventory())).toEqual(coreNativeFixtureData(beforeReads));

    const source = ordered[0];
    if (source === undefined) throw new Error("Missing actual reverse source");
    const privateTable = fixture.definition.privateTables?.[0];
    if (privateTable === undefined) throw new Error("Missing installed membership table");
    const sourceMembers = (await fixture.inventory()).rows.filter(row => row.table === privateTable.name && row.value.sourceId === source);
    const observed = await run(readNativePayload(fixture, operations => operations.incomingReferences("relatedPosts", target, { limit: 16 })));
    const batchStart = batches.length;
    await update(source, { score: 5 });
    expect(nativeTokenInvalidated(observed.token, batches.slice(batchStart))).toBe(true);
    expect((await fixture.inventory()).rows.filter(row => row.table === privateTable.name && row.value.sourceId === source)).toEqual(sourceMembers);
    await update(source, { relatedPosts: [other, target] });
    expect(object(await read(target)).referencedByMany).toEqual(page.referencedByMany);
    await update(source, { relatedPost: null, relatedPosts: [] });
    expect(object(await read(target)).referencedBy).toEqual({ docs: ordered.filter(value => value !== source), hasNextPage: false });
    await update(source, { relatedPost: target, relatedPosts: [target] });
    await update(target, { relatedPost: target, relatedPosts: [target] });
    expect(object(object(await read(target, 1, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).docs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: target, relatedPost: target })]));
    await update(target, { relatedPost: null, relatedPosts: [] });

    // The request reserves one call at construction. Its 64-call budget admits
    // 63 real 17-member probes; the next refuses before the independent join
    // window/inspection ceilings. Pure owner tests isolate those secondary caps.
    const extra: string[] = [];
    for (let index = 0; index < 8; index++) extra.push(id(await create("join-window-extra-" + index, { relatedPost: target, relatedPosts: [target] })));
    expect(await run(host.read(windows, { windows: 63 }))).toBeNull();
    expect(await run(Effect.flip(host.read(windows, { windows: 64 })))).toMatchObject({ reason: "limitExceeded" });
    for (const value of extra) await remove(value);

    // Preserve real output accounting through the native loader, below index key limits.
    const outputExtra: string[] = [];
    for (let index = 0; index < 4; index++) outputExtra.push(id(await create("join-output-extra-" + index, { relatedPost: target })));
    const outputSources = [...sources, ...outputExtra];
    for (const [index, value] of outputSources.entries()) await update(value, {
      title: "join-output-" + index + "-" + "x".repeat(1900), relatedPosts: [target, other, ...outputSources],
    });
    const beforeOutput = await fixture.inventory();
    const adapterFind = vi.spyOn(native.payload.db, "find");
    try {
      expect(await run(Effect.flip(fixture.reader.find({ collection: "posts", depth: 1, limit: 15,
        joins: { referencedBy: { limit: 16 }, referencedByMany: { limit: 16 } } })))).toMatchObject({ reason: "limitExceeded" });
      expect(adapterFind.mock.settledResults.map(result => result.type)).toEqual(["fulfilled", "rejected"]);
    } finally { adapterFind.mockRestore(); }
    expect(await fixture.inventory()).toEqual(beforeOutput);
    for (const [index, value] of outputSources.entries()) await update(value, { title: "join-source-restored-" + index, relatedPosts: [target] });
    for (const value of outputExtra) await remove(value);

    // First observations remain coherent in both read/write interleavings.
    for (const mutation of ["retarget", "delete"] as const) for (const first of ["reader", "writer"] as const) {
      const raceTarget = id(await create("join-race-target-" + mutation + first));
      const raceSource = id(await create("join-race-source-" + mutation + first, { relatedPost: raceTarget, relatedPosts: [raceTarget] }));
      const entered = barrier<void>(), release = barrier<void>();
      const hold = () => Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.promise(() => release.promise)));
      if (first === "reader") afterBatch = () => { afterBatch = undefined; return hold(); };
      else beforeFinalize = () => { beforeFinalize = undefined; return hold(); };
      const reading = fixture.reader.findByID({ collection: "posts", id: raceTarget, depth: 1 });
      const writing = mutation === "delete" ? fixture.writer.delete(fixture.writer.newRequestKey(), { collection: "posts", id: raceSource })
        : fixture.writer.update(fixture.writer.newRequestKey(), { collection: "posts", id: raceSource, data: { relatedPost: null, relatedPosts: [] } });
      const results = await run(overlappingSnapshotRace(first === "reader" ? reading : writing, first === "reader" ? writing : reading,
        entered.promise, () => release.resolve()));
      expect(results.map(result => Result.isSuccess(result.value))).toEqual([true, true]);
      expect(results[first === "reader" ? 0 : 1]).toMatchObject({ value: { success: {
        referencedBy: { docs: [expect.objectContaining({ id: raceSource })], hasNextPage: false },
        referencedByMany: { docs: [expect.objectContaining({ id: raceSource })], hasNextPage: false },
      } } });
      expect(await read(raceTarget)).toMatchObject({ referencedBy: { docs: [], hasNextPage: false }, referencedByMany: { docs: [], hasNextPage: false } });
    }
    const readEntered = barrier<void>();
    afterBatch = () => { afterBatch = undefined; return Effect.sync(() => readEntered.resolve()).pipe(Effect.andThen(Effect.never)); };
    const beforeInterrupt = await fixture.inventory();
    const reading = await run(fixture.reader.findByID({ collection: "posts", id: target, depth: 1 }).pipe(Effect.forkScoped));
    try { await run(awaitNativeTestGate(reading, Effect.promise(() => readEntered.promise))); await run(Fiber.interrupt(reading)); }
    finally { afterBatch = undefined; await run(Fiber.interrupt(reading)); }
    expect(Exit.isFailure(await run(Fiber.await(reading)))).toBe(true);
    expect(await fixture.inventory()).toEqual(beforeInterrupt);

    // Returned-source body corruption is refused after a real cold reconstruction.
    const identity = Result.getOrThrow(decodeDocumentId(source));
    const physical = await fixture.physical.query('SELECT ts::text AS ts,json_value FROM "' + fixture.physical.namespace + '"."documents" WHERE instance_name=$1 AND id=$2 ORDER BY ts DESC LIMIT 1',
      [fixture.instanceName, identity.internalId]);
    const row = physical[0];
    if (row === null || typeof row !== "object") throw new Error("Missing source revision");
    const timestamp: unknown = Reflect.get(row, "ts"), bytes: unknown = Reflect.get(row, "json_value");
    if (typeof timestamp !== "string" || !(bytes instanceof Uint8Array)) throw new Error("Invalid source revision evidence");
    const beforeCorruption = await fixture.inventory();
    await fixture.physical.query('UPDATE "' + fixture.physical.namespace + '"."documents" SET json_value=$1 WHERE instance_name=$2 AND id=$3 AND ts=$4',
      [new Uint8Array([255]), fixture.instanceName, identity.internalId, timestamp]);
    try {
      await fixture.reopen();
      expect(await run(Effect.flip(fixture.reader.findByID({ collection: "posts", id: target, depth: 1 })))).toMatchObject({ reason: "storedCorruption" });
    } finally {
      await fixture.physical.query('UPDATE "' + fixture.physical.namespace + '"."documents" SET json_value=$1 WHERE instance_name=$2 AND id=$3 AND ts=$4',
        [bytes, fixture.instanceName, identity.internalId, timestamp]);
      await fixture.reopen();
    }
    expect(await fixture.inventory()).toEqual(beforeCorruption);

    const successor = await fixture.prepareSuccessor(compiled, applicationNext);
    for (let step = 0; step < 512; step++) {
      const status = await run(fixture.database.schemaStatus(successor.proposal));
      if (status.state === "validated" && status.indexesReady) break;
      await run(fixture.database.advanceSchema(successor.proposal, { pageSize: 2, maxPages: 1 }));
    }
    const oldReader = fixture.reader;
    const currentRuntime = runtime;
    await update(source, { score: 7 });
    await fixture.activateSuccessor(successor);
    const beforeGap = currentRuntime?.observations.executions();
    expect(await run(Effect.flip(oldReader.findByID({ collection: "posts", id: target, depth: 1 })))).toMatchObject({ reason: "bindingChanged" });
    expect(currentRuntime?.observations.executions()).toBe(beforeGap);
    await fixture.rebind(successor);
    expect(object(object(await read(target, 1, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).docs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: source, score: 7 })]));

    const lostKey = fixture.writer.newRequestKey();
    const args = { collection: "posts", id: source, data: { relatedPosts: [other, target] } };
    beforeFinalize = () => { beforeFinalize = undefined; fixture.loseNextWriteAcknowledgement(); return Effect.void; };
    expect(await run(Effect.result(fixture.writer.update(lostKey, args)))).toMatchObject({ failure: { reason: "decisionUncertain" } });
    await fixture.reopen();
    expect(runtime?.observations.executions()).toBe(0);
    expect(await run(fixture.writer.update(lostKey, args))).toMatchObject({ id: source, relatedPosts: [other, target] });
    expect(runtime?.observations.executions()).toBe(0);
    expect(object(object(await read(target, 1, { referencedBy: { limit: 16 }, referencedByMany: false })).referencedBy).docs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: source, score: 7 })]));
  } finally { afterBatch = undefined; runtime?.observations.releasePendingDeletes(); await fixture.close(); }
}
