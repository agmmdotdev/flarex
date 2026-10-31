import { Deferred, Effect, Exit, Fiber, Result, type Cause, type Scope } from "effect";
import { expect } from "vitest";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import type { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { decodeIndexedDocument, decodeIndexedPage, type IndexedPayloadFixture } from "./payloadIndexedFixture";

export const payloadIndexedVisibilityCases = ["empty-range-aba", "point-nonkey-first-range", "point-key-aba-first-range",
  "pending-mask-key-aba", "pending-mask-moveout"] as const;
export type PayloadIndexedVisibilityCase = typeof payloadIndexedVisibilityCases[number];

/** Executing old-profile characterization; this selects no replacement runtime policy. */
export const payloadIndexedVisibilityScenario: (tested: IndexedPayloadFixture, mode: PayloadIndexedVisibilityCase) =>
  Effect.Effect<void, CmsTransactionError | Cause.TimeoutError, Scope.Scope> = Effect.fn("Payload.indexedVisibility")(function* (
  tested: IndexedPayloadFixture, mode: PayloadIndexedVisibilityCase,
) {
  const { host, runtime } = tested;
  const commands = inspectPayloadRuntimeForTest(runtime).commands;
  const entered = yield* Deferred.make<void, CmsTransactionError>();
  const release = yield* Deferred.make<void>();
  const range = { collection: "items", where: { amount: { greater_than_equal: 10, less_than: 20 } }, limit: 8 };
  const ownTitle = `range-held-${mode}`;
  const originalTitle = `range-original-${mode}`;
  const pendingMask = mode === "pending-mask-key-aba" || mode === "pending-mask-moveout";
  const seed = mode === "empty-range-aba" ? undefined : decodeIndexedDocument(yield* host.run(host.newRequestKey(), commands.create,
    { collection: "items", data: { title: originalTitle, category: "selected", amount: 15 } }));
  let bodies = 0;
  let deleteBodies = 0;
  let ownId: string | undefined;
  let checkpoint: unknown;
  let afterQuerySuccess = false;
  let pendingMoveObserved = false;
  let observedTitles: readonly string[] | undefined;
  const held = defineCmsCommand({ name: "characterizeOrdinaryRangeVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    bodies++;
    if (seed !== undefined) expect(decodeIndexedDocument(yield* ctx.nested(commands.findByID,
      { collection: "items", id: seed.id })).title).toBe(originalTitle);
    if (pendingMask) {
      if (seed === undefined) throw new Error("Missing pending-move seed");
      yield* ctx.nested(commands.update, { collection: "items", id: seed.id, data: { amount: 25 } });
      expect(decodeIndexedDocument(yield* ctx.nested(commands.findByID, { collection: "items", id: seed.id })).amount).toBe(25);
      pendingMoveObserved = true;
    }
    const own = yield* ctx.nested(commands.create,
      { collection: "items", data: { title: ownTitle, category: "disjoint", amount: 9000 } });
    ownId = decodeIndexedDocument(own).id;
    if (mode === "empty-range-aba") {
      const initialCount = decodeIndexedPage(yield* ctx.nested(commands.find, range)).totalDocs;
      expect(initialCount).toBe(0);
    }
    yield* Deferred.succeed(entered, undefined);
    yield* Deferred.await(release);
    const result = yield* ctx.nested(commands.find, range).pipe(Effect.result);
    checkpoint = result;
    Result.match(result, { onFailure: () => undefined, onSuccess: value => {
      const page = decodeIndexedPage(value);
      observedTitles = page.docs.map(document => document.title);
      afterQuerySuccess = true;
    } });
    return own;
  }) });
  const remove = defineCmsCommand({ name: "releaseOrdinaryRangeMembership", mode: "write", run: Effect.fn(function* (ctx, input) {
    deleteBodies++;
    if (typeof input !== "string") throw new Error("Missing characterized range row identity");
    // This is the existing trusted core deletion surface. Payload preference
    // cleanup remains outside this scalar content profile.
    yield* ctx.documents.delete(ctx.context, ctx.transactionId, input, "items");
    return null;
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held, remove]), value => value.close);
  yield* Effect.scoped(Effect.gen(function* () {
    const heldFiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(entered, exit.cause) : Effect.void),
      Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    if (mode === "empty-range-aba") {
      const temporary = decodeIndexedDocument(yield* host.run(host.newRequestKey(), commands.create,
        { collection: "items", data: { title: "range-temporary-owner", category: "selected", amount: 15 } }));
      yield* pending.run(pending.newRequestKey(), remove, temporary.id);
      expect(yield* host.read(commands.count, { collection: "items", where: range.where })).toEqual({ totalDocs: 0 });
    } else {
      if (seed === undefined) throw new Error("Missing characterized point seed");
      if (mode === "point-nonkey-first-range") yield* host.run(host.newRequestKey(), commands.update,
        { collection: "items", id: seed.id, data: { title: "range-nonkey-update" } });
      else {
        yield* host.run(host.newRequestKey(), commands.update, { collection: "items", id: seed.id, data: { amount: pendingMask ? 35 : 25 } });
        if (mode !== "pending-mask-moveout") yield* host.run(host.newRequestKey(), commands.update,
          { collection: "items", id: seed.id, data: { amount: 15 } });
      }
    }
    expect(yield* Deferred.isDone(release)).toBe(false);
    yield* Deferred.succeed(release, undefined);
    const result = yield* Fiber.join(heldFiber);
    expect(bodies).toBe(1);
    expect(pendingMoveObserved).toBe(pendingMask);
    if (mode === "point-key-aba-first-range" || mode === "pending-mask-key-aba") {
      expect(checkpoint).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(afterQuerySuccess).toBe(false);
      expect(observedTitles).toBeUndefined();
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
    } else {
      expect(checkpoint).toMatchObject({ _tag: "Success" });
      expect(afterQuerySuccess).toBe(true);
      expect(observedTitles).toEqual(mode === "point-nonkey-first-range" ? [originalTitle] : []);
      expect(result).toMatchObject(mode === "empty-range-aba" ? { _tag: "Success" }
        : { _tag: "Failure", failure: { reason: "writeConflict" } });
    }
    expect(deleteBodies).toBe(mode === "empty-range-aba" ? 1 : 0);
    expect(ownId).toBeDefined();
    expect(yield* host.read(commands.count, { collection: "items", where: { title: { equals: ownTitle } } }))
      .toEqual({ totalDocs: mode === "empty-range-aba" ? 1 : 0 });
    if (seed !== undefined) expect(decodeIndexedDocument(yield* host.read(commands.findByID,
      { collection: "items", id: seed.id })).amount).toBe(mode === "pending-mask-moveout" ? 35 : 15);
  }).pipe(Effect.timeout(20_000), Effect.ensuring(Deferred.succeed(release, undefined))));
});
