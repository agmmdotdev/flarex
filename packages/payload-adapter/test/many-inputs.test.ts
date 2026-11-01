import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { payloadManyIds } from "../src/many";
import { makePayloadInputs } from "../src/inputs";
import { makePayloadCollectionRuntime } from "../src/collectionRuntime";
import { payloadManyConfiguration } from "../src/testing/profiles";
import { cmsError, cmsLimits } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCmsCommandContext } from "../../persistence-postgres/src/frameworks/cmsTransaction/context";

const ids = Array.from({ length: 32 }, (_, index) => {
  const bytes = new Uint8Array(16); bytes[15] = index;
  return Result.getOrThrow(encodeDocumentId(100, bytes));
});

it("captures all admitted canonical many IDs in source order", () => {
  const reverse = [...ids].reverse();
  const captured = Result.getOrThrow(payloadManyIds(reverse));
  expect(captured).toEqual(reverse);
  expect(captured).not.toBe(reverse);
  expect(Object.isFrozen(captured)).toBe(true);
  reverse.length = 0;
  expect(captured).toHaveLength(32);
  expect(Result.getOrThrow(payloadManyIds([]))).toEqual([]);
});

it.each(["duplicate", "oversized", "null", "array-like", "sparse", "getter", "populated", "numeric", "old-id", "malformed"] as const)("refuses %s many input through the canonical capture owner", mode => {
  const first = ids[0];
  if (first === undefined) throw new Error("Missing test ID");
  let getters = 0;
  const batch = [first];
  if (mode === "sparse") delete batch[0];
  if (mode === "getter") Object.defineProperty(batch, "0", { enumerable: true, get: () => { getters++; return first; } });
  const input = mode === "duplicate" ? [first, first] : mode === "oversized" ? [...ids, first] : mode === "null" ? null
    : mode === "array-like" ? { "0": first, length: 1 }
    : mode === "populated" ? [{ id: first }] : mode === "numeric" ? [1] : mode === "old-id" ? ["100:00000000000000000000000000000000"]
    : mode === "malformed" ? ["bad-id"] : batch;
  expect(payloadManyIds(input)).toMatchObject({ _tag: "Failure", failure: {
    reason: mode === "sparse" || mode === "getter" ? "invalidInput" : "relationInvalid",
  } });
  expect(getters).toBe(0);
});

it("authenticates supplied many IDs without requesting target bodies and preserves omission and clear", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const collection = payloadManyConfiguration.tables[0];
  if (collection === undefined) return yield* Effect.die(new Error("Missing fixed many collection"));
  const inputs = makePayloadInputs("payload.content-many", [makePayloadCollectionRuntime(collection)]);
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(cmsError, cmsLimits, {}, {}, "many-inputs", "write"), selected => selected.close);
  const calls: string[][] = [];
  const unexpected = () => Effect.die(new Error("Many admission requested document or relation state"));
  const context = makeCmsCommandContext(lifetime, "many-inputs", lifetime.context, {
    documents: { validateIds: (_context, _id, table, batch) => Effect.sync(() => { expect(table).toBe("posts"); calls.push([...batch]); }),
      get: unexpected, getMany: unexpected, find: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected },
    relations: { incoming: unexpected }, preferences: { deleteForPendingDocument: unexpected },
  }, false, unexpected);
  const first = ids[0];
  if (first === undefined) return yield* Effect.die(new Error("Missing target ID"));
  expect((yield* inputs.create(context, { collection: "posts", data: { title: "source", relatedPosts: [first] } })).data.relatedPosts).toEqual([first]);
  expect((yield* inputs.update(context, { collection: "posts", id: first, data: { score: 1 } })).data).toEqual({ score: 1 });
  expect((yield* inputs.update(context, { collection: "posts", id: first, data: { relatedPosts: [] } })).data.relatedPosts).toEqual([]);
  expect(calls).toEqual([[first]]);
}))));
