import { Cause, Effect, Exit, Option, Result } from "effect";
import { expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreNativeOperations } from "../../../src/core/api";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { makeNativeCmsRelations } from "../../../src/frameworks/cmsTransaction/nativeRelations";
import { cmsError, cmsLimits } from "../../../src/frameworks/cmsTransaction/model";

const target = Result.getOrThrow(encodeDocumentId(100, new Uint8Array(16)));
const sourceBytes = new Uint8Array(16); sourceBytes[15] = 1;
const source = Result.getOrThrow(encodeDocumentId(100, sourceBytes));
const targets = new Map([["relatedPost", "posts"], ["relatedPosts", "posts"]]);
const request = (mode: "read" | "write" = "read") => Effect.acquireRelease(
  // A larger owning call ledger isolates the independent 64-window join bound.
  makeBoundedRequestLifetime(cmsError, { ...cmsLimits, calls: 128 }, {}, {}, "native-join-test", mode), lifetime => lifetime.close);
function operations(overrides: Pick<CoreNativeOperations, "get" | "normalizeId" | "incomingReferences">): CoreNativeOperations {
  const unexpected = () => Effect.die(new Error("Unexpected Core operation in join admission test"));
  return { ...overrides, getMany: unexpected, insert: unexpected, patch: unexpected, replace: unexpected, delete: unexpected,
    pendingDelete: unexpected, assertPendingDelete: unexpected, writeRows: unexpected, deleteRows: unexpected,
    isEmpty: unexpected, find: unexpected, findPage: unexpected };
}
const validOperations = (incomingReferences: CoreNativeOperations["incomingReferences"]): CoreNativeOperations => operations({
  normalizeId: (_table, id) => Effect.succeed(typeof id === "string" ? Option.some(id) : Option.none()),
  get: id => Effect.succeed(Option.some({ _id: id })), incomingReferences,
});

it("authenticates the join target before returning an owned first window", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const calls: string[] = [];
  const lifetime = yield* request();
  const mutableTargets = new Map(targets);
  const relation = makeNativeCmsRelations(operations({
    normalizeId: (table, id) => Effect.sync(() => { calls.push(`normalize:${table}`); return typeof id === "string" ? Option.some(id) : Option.none(); }),
    get: id => Effect.sync(() => { calls.push("target"); return Option.some({ _id: id }); }),
    incomingReferences: (name, id, options) => Effect.sync(() => {
      calls.push("incoming"); expect(name).toBe("relatedPosts"); expect(id).toBe(target); expect(options.limit).toBe(8);
      return { ids: [source], hasMore: true, inspectedMemberships: 2 };
    }),
  }), lifetime, mutableTargets, true);
  mutableTargets.clear();
  const page = yield* relation.incoming(lifetime.context, undefined, "relatedPosts", target, 8);
  expect(page).toEqual({ docs: [source], hasNextPage: true });
  expect(Object.isFrozen(page.docs)).toBe(true);
  expect(calls).toEqual(["normalize:posts", "target", "incoming"]);
}))));

it.each(["write", "borrowed", "foreign", "undeclared"] as const)("refuses %s join authority before any Core access", mode => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0;
  const unexpected = () => { calls++; return Effect.die(new Error("Refused join reached Core")); };
  const lifetime = yield* request(mode === "write" ? "write" : "read");
  const other = yield* request();
  const relation = makeNativeCmsRelations(operations({ normalizeId: unexpected, get: unexpected, incomingReferences: unexpected }), lifetime,
    mode === "undeclared" ? new Map() : targets, mode !== "borrowed");
  expect(yield* Effect.flip(relation.incoming(mode === "foreign" ? other.context : lifetime.context,
    mode === "write" ? "native-join-test" : undefined, "relatedPosts", target, 8))).toMatchObject({ reason: "invalidAuthority" });
  expect(calls).toBe(0);
}))));

it("retains a caught nested join refusal in the owning request", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let calls = 0;
  const lifetime = yield* request();
  const relation = makeNativeCmsRelations(validOperations(() => { calls++; return Effect.succeed({ ids: [], hasMore: false, inspectedMemberships: 0 }); }), lifetime, targets, true);
  yield* lifetime.nested(lifetime.context, "native-join-test", child => relation.incoming(child, "native-join-test", "relatedPosts", target, 8).pipe(Effect.result, Effect.asVoid));
  expect(calls).toBe(0);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) return yield* Effect.die(new Error("Caught nested refusal cleared rollback-only state"));
  expect(sealed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toEqual(expect.arrayContaining(["rollbackOnly", "invalidAuthority"]));
}))));

it.each(["missing", "wrong-table", "malformed"] as const)("refuses a %s join target before scanning incoming members", mode => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let scans = 0;
  const lifetime = yield* request();
  const relation = makeNativeCmsRelations(operations({
    normalizeId: (_table, id) => Effect.succeed(mode === "wrong-table" ? Option.none() : typeof id === "string" ? Option.some(id) : Option.none()),
    get: () => Effect.succeed(Option.none()),
    incomingReferences: () => { scans++; return Effect.succeed({ ids: [], hasMore: false, inspectedMemberships: 0 }); },
  }), lifetime, targets, true);
  expect(yield* Effect.flip(relation.incoming(lifetime.context, undefined, "relatedPosts", mode === "malformed" ? "bad-id" : target, 8)))
    .toMatchObject({ reason: mode === "missing" ? "documentMissing" : "invalidInput" });
  expect(scans).toBe(0);
}))));

it("bounds cumulative incoming windows independently of the owning call ledger", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let scans = 0;
  const lifetime = yield* request();
  const relation = makeNativeCmsRelations(validOperations(() => { scans++; return Effect.succeed({ ids: [], hasMore: false, inspectedMemberships: 0 }); }), lifetime, targets, true);
  for (let index = 0; index < 64; index++) yield* relation.incoming(lifetime.context, undefined, "relatedPost", target, 1);
  expect(yield* Effect.flip(relation.incoming(lifetime.context, undefined, "relatedPosts", target, 1))).toMatchObject({ reason: "limitExceeded" });
  expect(scans).toBe(64);
}))));

it("charges Core-certified inspected work even when no source IDs are returned", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  let scans = 0;
  const lifetime = yield* request();
  const relation = makeNativeCmsRelations(validOperations(() => { scans++; return Effect.succeed({ ids: [], hasMore: false, inspectedMemberships: 545 }); }), lifetime, targets, true);
  yield* relation.incoming(lifetime.context, undefined, "relatedPosts", target, 16);
  expect(yield* Effect.flip(relation.incoming(lifetime.context, undefined, "relatedPosts", target, 16))).toMatchObject({ reason: "limitExceeded" });
  expect(scans).toBe(2);
}))));
