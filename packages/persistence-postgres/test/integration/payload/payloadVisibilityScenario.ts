import { Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { expect } from "vitest";
import type { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { defineCmsCommand, type CmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import type { CmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import type { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";

const decodeCount = Schema.decodeUnknownSync(Schema.Struct({ totalDocs: Schema.Number }));
const decodeDocument = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String }));

export interface PayloadVisibilityTarget<Failure> {
  readonly collection: "items" | "news";
  readonly commands: ReturnType<typeof inspectPayloadRuntimeForTest>["commands"];
  readonly host: CmsHost;
  readonly openHost: (extra: readonly CmsCommand[]) => Effect.Effect<CmsHost, Failure>;
  readonly inventory: Effect.Effect<unknown, Failure>;
}

/** The single-lease PGlite lane proves pending visibility, not independent connections. */
export const payloadPendingVisibilityScenario = Effect.fn("Payload.pendingVisibility")(function* <Failure>(tested: PayloadVisibilityTarget<Failure>) {
  const { host, commands, collection } = tested;
  const seed = decodeDocument(yield* host.run(host.newRequestKey(), commands.create, {
    collection, data: { title: "observed-initial" },
  }));
  let pendingBodies = 0;
  let failingBodies = 0;
  const observe = defineCmsCommand({ name: "observeNativePendingVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    pendingBodies++;
    const before = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id }));
    expect(before.title).toBe("observed-initial");
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "visible-own" } },
    })).totalDocs).toBe(0);
    const own = decodeDocument(yield* ctx.nested(commands.create, {
      collection, data: { title: "visible-own" },
    }));
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "visible-own" } },
    })).totalDocs).toBe(1);
    expect(decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: own.id }))).toEqual(own);
    yield* ctx.nested(commands.update, { collection, id: seed.id, data: { title: "observed-pending" } });
    expect(decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id })).title)
      .toBe("observed-pending");
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "observed-initial" } },
    })).totalDocs).toBe(0);
    return own;
  }) });
  const failLate = defineCmsCommand({ name: "rollbackNativePendingVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    failingBodies++;
    yield* ctx.nested(commands.create, {
      collection, data: { title: "rolled-back-own" },
    });
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "rolled-back-own" } },
    })).totalDocs).toBe(1);
    return yield* Effect.fail(cmsError("invalidInput"));
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([observe, failLate]), value => value.close);
  const key = pending.newRequestKey();
  const created = yield* pending.run(key, observe, null);
  const committed = yield* tested.inventory;
  expect(yield* pending.run(key, observe, null)).toEqual(created);
  expect(yield* tested.inventory).toEqual(committed);
  expect(decodeDocument(yield* host.read(commands.findByID, { collection, id: seed.id })).title)
    .toBe("observed-pending");
  expect(yield* pending.run(pending.newRequestKey(), failLate, null).pipe(Effect.result))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(yield* tested.inventory).toEqual(committed);
  expect(decodeCount(yield* host.read(commands.count, {
    collection, where: { title: { equals: "rolled-back-own" } },
  })).totalDocs).toBe(0);
  expect({ pendingBodies, failingBodies }).toEqual({ pendingBodies: 1, failingBodies: 1 });
});

interface VisibilityTrace {
  readonly initialTitle: string;
  readonly repeatedTitle: string;
  readonly missingBefore: number;
  readonly missingAfter: number;
  readonly missingPageAfter: number;
  readonly freshTitle: string;
  readonly freshCount: number;
  readonly ownTitle: string;
  readonly ownCount: number;
}

/** Characterize the existing direct native profile, without selecting its replacement. */
export const payloadVisibilityScenario = Effect.fn("Payload.directVisibility")(function* <Failure>(tested: PayloadVisibilityTarget<Failure>) {
  const { host, commands, collection } = tested;
  const seed = decodeDocument(yield* host.run(host.newRequestKey(), commands.create, {
    collection, data: { title: "observed-initial" },
  }));
  const entered = yield* Deferred.make<void, CmsTransactionError>();
  const pendingIds = yield* Deferred.make<{ readonly missing: string; readonly fresh: string }, CmsTransactionError>();
  const observedMissing = yield* Deferred.make<void, CmsTransactionError>();
  const publish = yield* Deferred.make<void>();
  const published = yield* Deferred.make<void, CmsTransactionError>();
  let heldBodies = 0;
  let competingBodies = 0;
  let trace: VisibilityTrace | undefined;

  const held = defineCmsCommand({ name: "observeNativeVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    heldBodies++;
    const initial = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id }));
    yield* Deferred.succeed(entered, undefined);
    const ids = yield* Deferred.await(pendingIds);
    const missingBefore = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { id: { equals: ids.missing } },
    })).totalDocs;
    yield* Deferred.succeed(observedMissing, undefined);
    yield* Deferred.await(published);
    const repeated = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id }));
    const missingAfter = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { id: { equals: ids.missing } },
    })).totalDocs;
    const missingPageAfter = decodeCount(yield* ctx.nested(commands.find, {
      collection, where: { id: { equals: ids.missing } },
    })).totalDocs;
    const fresh = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: ids.fresh }));
    const freshCount = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "newly-observed" } },
    })).totalDocs;
    const own = decodeDocument(yield* ctx.nested(commands.create, {
      collection, data: { title: "pending-own" },
    }));
    const ownRead = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: own.id }));
    const ownCount = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { id: { equals: own.id } },
    })).totalDocs;
    trace = { initialTitle: initial.title, repeatedTitle: repeated.title, missingBefore, missingAfter, missingPageAfter,
      freshTitle: fresh.title, freshCount, ownTitle: ownRead.title, ownCount };
    return ownRead;
  }) });
  const competing = defineCmsCommand({ name: "publishNativeVisibilityCompetitor", mode: "write", run: Effect.fn(function* (ctx) {
    competingBodies++;
    yield* ctx.nested(commands.update, { collection, id: seed.id, data: { title: "observed-updated" } });
    const missing = decodeDocument(yield* ctx.nested(commands.create, {
      collection, data: { title: "previously-absent" },
    }));
    const fresh = decodeDocument(yield* ctx.nested(commands.create, {
      collection, data: { title: "newly-observed" },
    }));
    yield* Deferred.succeed(pendingIds, { missing: missing.id, fresh: fresh.id });
    yield* Deferred.await(publish);
    return fresh;
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held, competing]), value => value.close);
  yield* Effect.gen(function* () {
    const heldFiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Effect.gen(function* () {
        yield* Deferred.failCause(entered, exit.cause);
        yield* Deferred.failCause(observedMissing, exit.cause);
      }) : Effect.void), Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    const competingFiber = yield* pending.run(pending.newRequestKey(), competing, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Effect.gen(function* () {
        yield* Deferred.failCause(pendingIds, exit.cause);
        yield* Deferred.failCause(published, exit.cause);
      }) : Effect.void), Effect.forkScoped);
    yield* Deferred.await(observedMissing).pipe(Effect.timeout(5_000));
    yield* Deferred.succeed(publish, undefined);
    yield* Fiber.join(competingFiber);
    yield* Deferred.succeed(published, undefined);
    const heldResult = yield* Fiber.join(heldFiber);
    const live = decodeDocument(yield* host.read(commands.findByID, { collection, id: seed.id }));
    const durableOwn = decodeCount(yield* host.read(commands.count, {
      collection, where: { title: { equals: "pending-own" } },
    })).totalDocs;
    expect(trace).toEqual({
      initialTitle: "observed-initial", repeatedTitle: "observed-initial",
      missingBefore: 0, missingAfter: 0, missingPageAfter: 0,
      freshTitle: "newly-observed", freshCount: 1, ownTitle: "pending-own", ownCount: 1,
    });
    expect(heldResult).toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
    expect({ heldBodies, competingBodies }).toEqual({ heldBodies: 1, competingBodies: 1 });
    expect(live.title).toBe("observed-updated");
    expect(durableOwn).toBe(0);
  }).pipe(Effect.ensuring(Effect.gen(function* () {
    yield* Deferred.succeed(publish, undefined);
    yield* Deferred.succeed(published, undefined);
  })), Effect.timeout(20_000));
});

interface DisjointVisibilityTrace {
  readonly initialTitle: string;
  readonly repeatedTitle: string;
  readonly freshTitle: string;
  readonly freshCount: number;
  readonly ownTitle: string;
  readonly ownCount: number;
}

/** Unlike the conflict vector, no observed key or range is changed by the competitor. */
export const payloadDisjointVisibilityScenario = Effect.fn("Payload.disjointDirectVisibility")(function* <Failure>(tested: PayloadVisibilityTarget<Failure>) {
  const { host, commands, collection } = tested;
  const seed = decodeDocument(yield* host.run(host.newRequestKey(), commands.create, {
    collection, data: { title: "disjoint-observed" },
  }));
  const entered = yield* Deferred.make<void, CmsTransactionError>();
  const published = yield* Deferred.make<string, CmsTransactionError>();
  let heldBodies = 0;
  let competingBodies = 0;
  let trace: DisjointVisibilityTrace | undefined;
  const held = defineCmsCommand({ name: "observeDisjointNativeVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    heldBodies++;
    const initial = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id }));
    // Only this own row and A are observed before the competing publication.
    const own = decodeDocument(yield* ctx.nested(commands.create, {
      collection, data: { title: "disjoint-pending-own" },
    }));
    yield* Deferred.succeed(entered, undefined);
    const freshId = yield* Deferred.await(published);
    const repeated = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: seed.id }));
    const fresh = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: freshId }));
    const freshCount = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: "disjoint-newly-observed" } },
    })).totalDocs;
    const ownRead = decodeDocument(yield* ctx.nested(commands.findByID, { collection, id: own.id }));
    const ownCount = decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { id: { equals: own.id } },
    })).totalDocs;
    trace = { initialTitle: initial.title, repeatedTitle: repeated.title, freshTitle: fresh.title,
      freshCount, ownTitle: ownRead.title, ownCount };
    return ownRead;
  }) });
  const competing = defineCmsCommand({ name: "publishDisjointNativeVisibility", mode: "write", run: Effect.fn(function* (ctx) {
    competingBodies++;
    return yield* ctx.nested(commands.create, { collection, data: { title: "disjoint-newly-observed" } });
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held, competing]), value => value.close);
  yield* Effect.gen(function* () {
    const heldFiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(entered, exit.cause) : Effect.void),
      Effect.result, Effect.forkScoped);
    yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    const competingValue = yield* pending.run(pending.newRequestKey(), competing, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(published, exit.cause) : Effect.void));
    const fresh = decodeDocument(competingValue);
    yield* Deferred.succeed(published, fresh.id);
    const heldResult = yield* Fiber.join(heldFiber);
    const durableOwn = decodeCount(yield* host.read(commands.count, {
      collection, where: { title: { equals: "disjoint-pending-own" } },
    })).totalDocs;
    const durableFresh = decodeCount(yield* host.read(commands.count, {
      collection, where: { title: { equals: "disjoint-newly-observed" } },
    })).totalDocs;
    const live = decodeDocument(yield* host.read(commands.findByID, { collection, id: seed.id }));
    expect(trace).toEqual({ initialTitle: "disjoint-observed", repeatedTitle: "disjoint-observed",
      freshTitle: "disjoint-newly-observed", freshCount: 1, ownTitle: "disjoint-pending-own", ownCount: 1 });
    const accepted = decodeDocument(yield* Effect.fromResult(heldResult));
    expect(accepted.title).toBe("disjoint-pending-own");
    expect({ heldBodies, competingBodies }).toEqual({ heldBodies: 1, competingBodies: 1 });
    expect(live.title).toBe("disjoint-observed");
    expect(durableOwn).toBe(1);
    expect(durableFresh).toBe(1);
  }).pipe(Effect.ensuring(Deferred.interrupt(published)), Effect.timeout(20_000));
});

/** Observe a unique key that changes absent -> occupied -> absent while D is pending. */
export const payloadUniqueAbaVisibilityScenario = Effect.fn("Payload.uniqueKeyAbaVisibility")(function* <Failure>(tested: PayloadVisibilityTarget<Failure>) {
  const { host, commands, collection } = tested;
  const keyTitle = "aba-pending-key";
  const renamedTitle = "aba-renamed-key";
  const entered = yield* Deferred.make<string, CmsTransactionError>();
  const release = yield* Deferred.make<void, CmsTransactionError>();
  let heldBodies = 0;
  let insertBodies = 0;
  let renameBodies = 0;
  const held = defineCmsCommand({ name: "holdNativeUniqueKeyAba", mode: "write", run: Effect.fn(function* (ctx) {
    heldBodies++;
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: keyTitle } },
    })).totalDocs).toBe(0);
    const own = decodeDocument(yield* ctx.nested(commands.create, { collection, data: { title: keyTitle } }));
    expect(decodeCount(yield* ctx.nested(commands.count, {
      collection, where: { title: { equals: keyTitle } },
    })).totalDocs).toBe(1);
    yield* Deferred.succeed(entered, own.id);
    yield* Deferred.await(release);
    return own;
  }) });
  const insert = defineCmsCommand({ name: "occupyNativeUniqueKeyAba", mode: "write", run: Effect.fn(function* (ctx, args) {
    insertBodies++;
    return yield* ctx.nested(commands.create, args);
  }) });
  const rename = defineCmsCommand({ name: "releaseNativeUniqueKeyAba", mode: "write", run: Effect.fn(function* (ctx, args) {
    renameBodies++;
    return yield* ctx.nested(commands.update, args);
  }) });
  const pending = yield* Effect.acquireRelease(tested.openHost([held, insert, rename]), value => value.close);
  yield* Effect.gen(function* () {
    const heldFiber = yield* pending.run(pending.newRequestKey(), held, null).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(entered, exit.cause) : Effect.void),
      Effect.result, Effect.forkScoped);
    const ownId = yield* Deferred.await(entered).pipe(Effect.timeout(5_000));
    const occupied = decodeDocument(yield* pending.run(pending.newRequestKey(), insert,
      { collection, data: { title: keyTitle } }).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(release, exit.cause) : Effect.void)));
    const renamed = decodeDocument(yield* pending.run(pending.newRequestKey(), rename,
      { collection, id: occupied.id, data: { title: renamedTitle } }).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.failCause(release, exit.cause) : Effect.void)));
    expect(renamed).toMatchObject({ id: occupied.id, title: renamedTitle });
    // These standalone requests establish the committed ABA state without
    // adding observations to the held root's working set.
    const committedEmpty = decodeCount(yield* host.read(commands.count, {
      collection, where: { title: { equals: keyTitle } },
    })).totalDocs;
    expect(committedEmpty).toBe(0);
    yield* Deferred.succeed(release, undefined);
    const heldResult = yield* Fiber.join(heldFiber);
    const durableOwn = decodeCount(yield* host.read(commands.count, {
      collection, where: { id: { equals: ownId } },
    })).totalDocs;
    const durableKey = decodeCount(yield* host.read(commands.count, {
      collection, where: { title: { equals: keyTitle } },
    })).totalDocs;
    const durableRenamed = decodeDocument(yield* host.read(commands.findByID, { collection, id: occupied.id }));
    const accepted = decodeDocument(yield* Effect.fromResult(heldResult));
    expect(accepted).toEqual({ id: ownId, title: keyTitle });
    expect(durableOwn).toBe(1);
    expect(durableKey).toBe(1);
    expect({ heldBodies, insertBodies, renameBodies }).toEqual({ heldBodies: 1, insertBodies: 1, renameBodies: 1 });
    expect(durableRenamed.title).toBe(renamedTitle);
  }).pipe(Effect.ensuring(Deferred.interrupt(release)), Effect.timeout(20_000));
});
