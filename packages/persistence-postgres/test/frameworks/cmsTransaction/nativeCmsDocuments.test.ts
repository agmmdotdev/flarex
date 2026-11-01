import { Effect, Option, Result } from "effect";
import { expect, it } from "vitest";
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { CoreTransactionError, type CoreNativeOperations } from "../../../src/core/api";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { makeNativeCmsDocuments } from "../../../src/frameworks/cmsTransaction/nativeDocuments";

function coreOperations(getMany: CoreNativeOperations["getMany"], normalizeId?: CoreNativeOperations["normalizeId"]): CoreNativeOperations {
  const unexpected = () => Effect.die(new Error("Unexpected Core operation in CMS batch-input test"));
  return { getMany, get: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected,
    nativeActivityCursor: () => { throw new Error("Unexpected Core activity in CMS batch-input test"); },
    nativeActivitySince: unexpected, checkpointReferences: unexpected, planSetNullReferences: unexpected,
    normalizeId: normalizeId ?? unexpected, incomingReferences: unexpected, pendingDelete: unexpected, assertPendingDelete: unexpected,
    writeRows: unexpected, deleteRows: unexpected, lifecycle: unexpected, prepareDeleteClosure: unexpected,
    replaceReferenceSet: unexpected, referenceReplacementChanges: unexpected, protectedReferencePage: unexpected,
    assertProtectedReferenceGeneration: unexpected,
    isEmpty: unexpected, find: unexpected, findPage: unexpected };
}
const request = () => Effect.acquireRelease(makeCmsRequestLifetime({ hostId: Symbol() }, { requestId: Symbol() }, "native-batch-test", "read"), lifetime => lifetime.close);
const ids = Array.from({ length: 32 }, (_, index) => {
  const bytes = new Uint8Array(16); bytes[15] = index;
  return Result.getOrThrow(encodeDocumentId(100, bytes));
});

it.each(["duplicate", "oversized-duplicate", "getter", "sparse"] as const)("refuses %s CMS loader input before delegating any Core read", mode => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0, getters = 0;
  const lifetime = yield* request();
  const documents = makeNativeCmsDocuments(coreOperations(() => { calls++; return Effect.succeed([]); }), lifetime);
  const firstId = ids[0];
  if (firstId === undefined) return yield* Effect.die(new Error("Missing test identity"));
  const batch: string[] = mode === "oversized-duplicate" ? Array.from({ length: 33 }, () => firstId)
    : mode === "duplicate" ? [firstId, firstId] : [firstId];
  if (mode === "getter") Object.defineProperty(batch, "0", { enumerable: true, get: () => { getters++; return firstId; } });
  if (mode === "sparse") delete batch[0];
  expect(yield* Effect.flip(documents.getMany(lifetime.context, undefined, "posts", batch)))
    .toMatchObject({ reason: mode === "oversized-duplicate" ? "limitExceeded" : "invalidInput" });
  expect(calls).toBe(0);
  expect(getters).toBe(0);
}))));

it("refuses a runtime-invalid nonstring batch before delegating Core ID validation", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0;
  const lifetime = yield* request();
  const documents = makeNativeCmsDocuments(coreOperations(() => { calls++; return Effect.succeed([]); }), lifetime);
  // @ts-expect-error The runtime boundary must also refuse a nonstring ID element.
  expect(yield* Effect.flip(documents.getMany(lifetime.context, undefined, "posts", [42]))).toMatchObject({ reason: "invalidInput" });
  expect(calls).toBe(0);
}))));

it("forwards one owned 32-ID batch and preserves positional target absence", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0;
  const lifetime = yield* request();
  const expected: readonly (DocumentObject | null)[] = ids.map((id, index) => index % 3 === 0 ? null : { _id: id, title: `target-${index}` });
  const documents = makeNativeCmsDocuments(coreOperations((table, captured) => Effect.sync(() => {
    calls++;
    expect(table).toBe("posts");
    expect(captured).toEqual(ids);
    expect(captured).not.toBe(ids);
    expect(Object.isFrozen(captured)).toBe(true);
    return expected;
  })), lifetime);
  expect(yield* documents.getMany(lifetime.context, undefined, "posts", ids)).toEqual(expected);
  expect(calls).toBe(1);
}))));

it("authenticates all 32 target IDs without observing bodies or absence", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const normalized: string[] = [];
  const lifetime = yield* request();
  const documents = makeNativeCmsDocuments(coreOperations(() => Effect.die(new Error("ID validation performed a body read")), (table, id) => Effect.sync(() => {
    expect(table).toBe("posts");
    if (typeof id !== "string") throw new Error("Uncaptured target identity");
    normalized.push(id);
    return Option.some(id);
  })), lifetime);
  yield* documents.validateIds(lifetime.context, undefined, "posts", ids);
  expect(normalized).toEqual(ids);
}))));

it.each(["duplicate", "oversized", "getter", "sparse", "malformed-last", "old-id"] as const)("refuses %s validation batch before importing Core metadata", mode => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0, getters = 0;
  const lifetime = yield* request();
  const documents = makeNativeCmsDocuments(coreOperations(() => Effect.die(new Error("Unexpected target read")), () => { calls++; return Effect.succeed(Option.none()); }), lifetime);
  const first = ids[0];
  if (first === undefined) return yield* Effect.die(new Error("Missing test ID"));
  const batch = mode === "duplicate" ? [first, first] : mode === "oversized" ? [...ids, first]
    : mode === "malformed-last" ? [first, "bad-id"] : mode === "old-id" ? ["100:00000000000000000000000000000000"] : [first];
  if (mode === "getter") Object.defineProperty(batch, "0", { enumerable: true, get: () => { getters++; return first; } });
  if (mode === "sparse") delete batch[0];
  expect(yield* Effect.flip(documents.validateIds(lifetime.context, undefined, "posts", batch)))
    .toMatchObject({ reason: mode === "oversized" ? "limitExceeded" : "invalidInput" });
  expect(calls).toBe(0);
  expect(getters).toBe(0);
}))));

it("refuses wrong-table and rewritten IDs without a body lookup", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const first = ids[0], second = ids[1];
  if (first === undefined || second === undefined) return yield* Effect.die(new Error("Missing test IDs"));
  for (const normalized of [Option.none<string>(), Option.some(second)]) {
    const lifetime = yield* request();
    const documents = makeNativeCmsDocuments(coreOperations(() => Effect.die(new Error("Wrong-table validation read a body")), () => Effect.succeed(normalized)), lifetime);
    expect(yield* Effect.flip(documents.validateIds(lifetime.context, undefined, "posts", [first]))).toMatchObject({ reason: "invalidInput" });
  }
}))));

it("authenticates table authority for an empty validation batch", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const lifetime = yield* request();
  let calls = 0;
  const documents = makeNativeCmsDocuments(coreOperations(() => Effect.die(new Error("Empty validation read a body")), (table, id) => {
    calls++;
    expect(table).toBe("unowned");
    expect(id).toBeUndefined();
    return Effect.fail(new CoreTransactionError({ reason: "missingTable" }));
  }), lifetime);
  expect(yield* Effect.flip(documents.validateIds(lifetime.context, undefined, "unowned", []))).toMatchObject({ reason: "bindingChanged" });
  expect(calls).toBe(1);
}))));
