import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreNativeOperations } from "../../../src/core/api";
import { makeCmsRequestLifetime } from "../../../src/frameworks/cmsTransaction/lifetime";
import { makeNativeCmsDocuments } from "../../../src/frameworks/cmsTransaction/nativeDocuments";

function coreOperations(getMany: CoreNativeOperations["getMany"]): CoreNativeOperations {
  const unexpected = () => Effect.die(new Error("Unexpected Core operation in CMS batch-input test"));
  return { getMany, get: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected,
    normalizeId: unexpected, incomingReferences: unexpected, pendingDelete: unexpected, assertPendingDelete: unexpected,
    writeRows: unexpected, deleteRows: unexpected, isEmpty: unexpected, find: unexpected, findPage: unexpected };
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
