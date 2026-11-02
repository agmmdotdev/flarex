import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { MedusaError } from "@medusajs/framework/utils/portable";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, type AtomicCommerceContext } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { requireAtomicCommerceScopeExclusion } from "../../persistence-postgres/src/frameworks/atomicCommerce/execution";
import { defineCommerceCommand, type CommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { readDocumentObject } from "../../persistence-postgres/src/core/registry";
import type { CoreWriteBatch } from "../../persistence-postgres/src/core/contracts";
import type { CoreNativeRootOperation } from "../../persistence-postgres/src/core/api";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../persistence-postgres/src/execution/diagnostics/operation";
import * as BoundedRequests from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import * as NativeInitialization from "../../persistence-postgres/src/frameworks/commerceTransaction/nativeInitialization";
import { readCoreNativeFixtureInventory } from "../../persistence-postgres/test/core/nativeFixtureInventory";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { prepareCreateReservationWorkflow } from "../src/workflows/inventory/adjust-and-reserve";
import type { AtomicWorkflowExecution } from "../src/workflow/host";
import { prepareCoreInventoryItemDeletion } from "./support/core-inventory-item-delete-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const claims = new Map<string, Deferred.Deferred<void>>();
let connected: Awaited<ReturnType<typeof prepareCoreInventoryItemDeletion>>;
let stock: Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>;
const snapshot = () => connected.fixture.snapshot();

function gate() {
  const entered = Deferred.makeUnsafe<void>(), released = Deferred.makeUnsafe<void>();
  return {
    reached: Deferred.await(entered).pipe(Effect.timeout(30_000)),
    enter: () => Effect.runPromise(Deferred.succeed(entered, undefined)),
    wait: () => Effect.runPromise(Deferred.await(released)),
    release: () => Effect.runPromise(Deferred.succeed(released, undefined)),
  };
}

/** Observe the real successful claim write. This is deliberately not an
 * assertion that beginNativeRoot has reached its exclusive-permit queue. */
const observeClaims = Effect.fn("NativeScopeExclusion.observeClaims")(function* (batch: CoreWriteBatch) {
  if (claims.size === 0) return;
  for (const document of batch.documents) {
    if (document.deleted) continue;
    const row = yield* Effect.fromResult(readDocumentObject(document));
    if (row.kind !== "nativeRoot" || row.state !== "claimed" || typeof row.key !== "string") continue;
    const reached = claims.get(row.key);
    if (reached === undefined) continue;
    claims.delete(row.key);
    yield* Deferred.succeed(reached, undefined);
  }
});

function claimWritten(key: string) {
  const reached = Deferred.makeUnsafe<void>();
  claims.set(key, reached);
  return Deferred.await(reached).pipe(Effect.timeout(30_000));
}

function failureCause<A>(exit: Exit.Exit<A, CommerceTransactionError>) {
  if (Exit.isSuccess(exit)) throw new Error("Expected native scope-exclusion refusal");
  return exit.cause;
}

function expectRefusal<A>(exit: Exit.Exit<A, CommerceTransactionError>, reason: CommerceTransactionError["reason"]) {
  const cause = failureCause(exit);
  expect(cause.reasons.filter(Cause.isDieReason), Cause.pretty(cause)).toEqual([]);
  expect(cause.reasons.filter(Cause.isInterruptReason), Cause.pretty(cause)).toEqual([]);
  const failures = cause.reasons.filter(Cause.isFailReason).map(entry => entry.error);
  expect(failures, Cause.pretty(cause)).toEqual(expect.arrayContaining([expect.objectContaining({ reason })]));
  return failures;
}

function reservationOptions(execution: AtomicWorkflowExecution = connected.execution) {
  return { execution, inventory: { module: stock.workflow, nativeStorage: connected.creation.inventory.inventory.source },
    revision: "f".repeat(64), subscribers: [{ id: "native-inventory-item-deletion", revision: "a".repeat(64) }] };
}

async function prepareReservation(execution: AtomicWorkflowExecution = connected.execution) {
  const host = await Effect.runPromise(prepareCreateReservationWorkflow(reservationOptions(execution)));
  cleanup.push(() => Effect.runPromise(host.close));
  return host;
}

function withoutSelection(): AtomicWorkflowExecution {
  return { identityAndAccessPolicy: connected.execution.identityAndAccessPolicy, prepare: composition => {
    const { executionIsolation: _selected, ...ordinary } = composition;
    return connected.execution.prepare(ordinary);
  } };
}

const firstPair = (graph: Awaited<ReturnType<typeof connected.seed>>) => {
  const pair = graph.pairs[0];
  if (pair === undefined) throw new Error("Missing genuine Inventory item/location pair");
  return pair;
};

/** Narrow the diagnostic result's existing interface. Authenticity comes from
 * retaining the exact successful Core acquisition value, not this shape check. */
function isCoreNativeRootOperation(value: unknown): value is CoreNativeRootOperation {
  return typeof value === "object" && value !== null
    && "unixTime" in value && typeof value.unixTime === "number" && Number.isFinite(value.unixTime)
    && "native" in value && typeof value.native === "function"
    && "applicationInsert" in value && typeof value.applicationInsert === "function"
    && "applicationRead" in value && typeof value.applicationRead === "function"
    && "finalize" in value && typeof value.finalize === "function"
    && "abort" in value && typeof value.abort === "function"
    && "requireScopeExclusion" in value && Effect.isEffect(value.requireScopeExclusion);
}

describe(`${driver} genuine native Inventory scope exclusion`, () => {
  beforeAll(async () => {
    connected = await prepareCoreInventoryItemDeletion(driver, close => cleanup.push(close), {
      wrapPersistence: persistence => ({ ...persistence, write: (lease, batch) => persistence.write(lease, batch).pipe(
        Effect.andThen(observeClaims(batch)),
      ) }),
    });
    stock = await Effect.runPromise(makeLocalInventoryCommands("stock"));
  }, 240_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Unable to close native scope-exclusion fixtures");
  }, 120_000);

  it("excludes actual competing reservation callbacks and returns native stock refusal without replay", async () => {
    const graph = await connected.seed("scope-reservations"), pair = firstPair(graph), held = gate();
    const other = await prepareReservation(), original = InventoryModuleService.prototype.createReservationItems;
    let active = 0, maximumActive = 0, callbacks = 0;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      active++; maximumActive = Math.max(maximumActive, active); const ordinal = ++callbacks;
      try {
        const result = await Reflect.apply(original, this, args);
        if (ordinal === 1) { await held.enter(); await held.wait(); }
        return result;
      } finally { active--; }
    });
    const first = Effect.runPromiseExit(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 60 }] }));
    let second: typeof first | undefined;
    try {
      await Effect.runPromise(held.reached);
      const key = other.newRequestKey(), persistedClaim = claimWritten(key);
      second = Effect.runPromiseExit(other.run(key, { reservations: [{ ...pair, quantity: 60 }] }));
      await Effect.runPromise(persistedClaim);
      await held.release();
      const outcomes = await Promise.all([first, second]);
      expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
      const rejected = outcomes.find(Exit.isFailure);
      if (rejected === undefined) throw new Error("Competing reservations both bypassed native availability");
      const failures = expectRefusal(rejected, "adapterFailure");
      const unavailable = failures.find(error => error.cause instanceof MedusaError && error.cause.type === "not_allowed");
      expect(unavailable?.cause).toMatchObject({ type: "not_allowed",
        message: `Not enough stock available for item ${pair.inventory_item_id} at location ${pair.location_id}` });
      expect(failures.some(error => error.reason === "writeConflict")).toBe(false);
      expect(callbacks).toBe(2); expect(maximumActive).toBe(1); expect(active).toBe(0);
      const levels = await Effect.runPromise(connected.probe("inventory_level", [pair.inventory_item_id]));
      expect(levels.find(row => row.location_id === pair.location_id)).toMatchObject({ reserved_quantity: (60).toPrecision(20) });
      const reservations = await Effect.runPromise(connected.probe("reservation_item", [pair.inventory_item_id]));
      expect(reservations.filter(row => row.quantity === (60).toPrecision(20))).toHaveLength(1);
    } finally { await held.release(); await Promise.all([first, ...(second === undefined ? [] : [second])]); native.mockRestore(); }
  }, 180_000);

  it.each(["reservation", "adjustment"] as const)("lets genuine selected %s settle while an ordinary Item deletion callback remains held", async kind => {
    const graph = await connected.seed("scope-ordinary-" + kind), pair = firstPair(graph), host = await connected.prepare(), held = gate();
    const original = InventoryModuleService.prototype.softDeleteInventoryItems;
    let released = false;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await held.enter(); await held.wait(); return result;
    });
    const pending = Effect.runPromiseExit(host.run(host.newRequestKey(), graph.items));
    try {
      await Effect.runPromise(held.reached);
      if (kind === "reservation") await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
        reservations: [{ ...pair, quantity: 3 }] }).pipe(Effect.timeout(30_000)));
      else await Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...pair, adjustment: 1 }]).pipe(Effect.timeout(30_000)));
      expect(released).toBe(false);
      const committed = await snapshot(); released = true; await held.release();
      expectRefusal(await pending, "writeConflict");
      expect(await snapshot()).toEqual(committed);
      expect((await Effect.runPromise(connected.probe("inventory_item", graph.items))).every(row => row.deleted_at === null)).toBe(true);
      expect(native).toHaveBeenCalledTimes(1);
    } finally { released = true; await held.release(); await pending; native.mockRestore(); }
  }, 180_000);

  it("refuses a dropped selected profile before the actual native reservation method", async () => {
    const graph = await connected.seed("scope-drop"), host = await prepareReservation(withoutSelection());
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const before = await snapshot();
      expectRefusal(await Effect.runPromiseExit(host.run(host.newRequestKey(), { reservations: [{ ...firstPair(graph), quantity: 1 }] })), "unsupportedProfile");
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("binds selected isolation to the genuine reservation request identity", async () => {
    const graph = await connected.seed("scope-identity"), selected = await prepareReservation(), ordinary = await prepareReservation(withoutSelection());
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const key = selected.newRequestKey(), input = { reservations: [{ ...firstPair(graph), quantity: 1 }] };
      const result = await Effect.runPromise(selected.run(key, input)), committed = await snapshot();
      expectRefusal(await Effect.runPromiseExit(ordinary.run(key, input)), "requestConflict");
      expect(await Effect.runPromise(selected.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); }
  });

  it("authenticates live root, nested and borrowed contexts and refuses copied, proxied, foreign and revoked handles", async () => {
    const participant = defineAtomicCommerceParticipant("inventory");
    const roots: AtomicCommerceContext[] = [], contexts: CommerceCommandContext[] = [];
    const leaf = defineCommerceCommand("nativeScopeLeaf", "read", ctx => Effect.gen(function* () {
      contexts.push(ctx); yield* requireAtomicCommerceScopeExclusion(ctx); return null;
    }));
    const nested = defineCommerceCommand("nativeScopeNested", "read", ctx => Effect.gen(function* () {
      contexts.push(ctx); yield* requireAtomicCommerceScopeExclusion(ctx);
      return yield* ctx.borrow(child => Effect.gen(function* () {
        contexts.push(child); yield* requireAtomicCommerceScopeExclusion(child);
        expectRefusal(yield* Effect.exit(requireAtomicCommerceScopeExclusion({ ...child })), "invalidAuthority");
        expectRefusal(yield* Effect.exit(requireAtomicCommerceScopeExclusion(new Proxy(child, {}))), "invalidAuthority");
        return yield* child.nested(leaf, null);
      }));
    }));
    const command = defineAtomicCommerceCommand("nativeScopeContext", ctx => Effect.gen(function* () {
      roots.push(ctx); yield* requireAtomicCommerceScopeExclusion(ctx);
      expect(Object.isFrozen(ctx)).toBe(true);
      expectRefusal(yield* Effect.exit(requireAtomicCommerceScopeExclusion({ ...ctx })), "invalidAuthority");
      expectRefusal(yield* Effect.exit(requireAtomicCommerceScopeExclusion(new Proxy(ctx, {}))), "invalidAuthority");
      return yield* ctx.call(participant, nested, null);
    }));
    const composition = { identityAndAccessPolicy: { profile: "native-scope-context" }, commands: [command],
      participants: [{ participant, nativeStorage: connected.creation.inventory.inventory.source, commands: [nested, leaf] }] };
    const selected = await Effect.runPromise(connected.execution.prepare({ ...composition, executionIsolation: "scopeExclusive" }));
    const ordinary = await Effect.runPromise(connected.execution.prepare(composition));
    cleanup.push(() => Effect.runPromise(selected.close), () => Effect.runPromise(ordinary.close));
    expect(await Effect.runPromise(selected.run(selected.newRequestKey(), command, null))).toBeNull();
    expect(roots).toHaveLength(1); expect(contexts).toHaveLength(3);
    for (const context of [...roots, ...contexts])
      expectRefusal(await Effect.runPromiseExit(requireAtomicCommerceScopeExclusion(context)), "invalidAuthority");
    expectRefusal(await Effect.runPromiseExit(ordinary.run(ordinary.newRequestKey(), command, null)), "unsupportedProfile");
    const root = roots[0], foreign = roots[1], context = contexts[0];
    if (root === undefined || foreign === undefined || context === undefined) throw new Error("Missing genuine scope contexts");
    expectRefusal(await Effect.runPromiseExit(requireAtomicCommerceScopeExclusion({ ...root, checkpoint: foreign.checkpoint })), "invalidAuthority");
    expectRefusal(await Effect.runPromiseExit(requireAtomicCommerceScopeExclusion({ ...context, manager: { ...context.manager } })), "invalidAuthority");
  });

  it("cancels a claimed competing reservation before its native callback and leaves later work admissible", async () => {
    const graph = await connected.seed("scope-wait-cancel"), pair = firstPair(graph), held = gate(), controller = new AbortController();
    const original = InventoryModuleService.prototype.createReservationItems;
    let callbacks = 0;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const ordinal = ++callbacks, result = await Reflect.apply(original, this, args);
      if (ordinal === 1) { await held.enter(); await held.wait(); }
      return result;
    });
    const first = Effect.runPromiseExit(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 1 }] }));
    let cancelled: typeof first | undefined;
    try {
      await Effect.runPromise(held.reached);
      const key = connected.reservations.newRequestKey(), persistedClaim = claimWritten(key);
      cancelled = Effect.runPromiseExit(connected.reservations.run(key, { reservations: [{ ...pair, quantity: 2 }] }), { signal: controller.signal });
      await Effect.runPromise(persistedClaim); controller.abort();
      expect(failureCause(await cancelled).reasons.some(Cause.isInterruptReason)).toBe(true);
      expect(callbacks).toBe(1);
      await held.release(); expect(Exit.isSuccess(await first)).toBe(true);
      expect((await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 3 }] })))[0])
        .toMatchObject({ quantity: 3 });
      expect(callbacks).toBe(2);
    } finally { controller.abort(); await held.release(); await Promise.all([first, ...(cancelled === undefined ? [] : [cancelled])]); native.mockRestore(); }
  }, 180_000);

  it("uses the original native deadline before a claimed waiting reservation can enter its callback", async () => {
    const graph = await connected.seed("scope-wait-deadline"), pair = firstPair(graph), held = gate();
    const original = InventoryModuleService.prototype.createReservationItems;
    const lifetimeCreated = Deferred.makeUnsafe<number>(), originalLifetime = BoundedRequests.makeBoundedRequestLifetime;
    let observeWaitingLifetime = false;
    const lifetimeOwner = vi.spyOn(BoundedRequests, "makeBoundedRequestLifetime").mockImplementation(function <Failure, Owner extends object, Identity extends object>(
      failure: (reason: BoundedRequests.RequestFailureReason, cause?: unknown) => Failure,
      limits: BoundedRequests.RequestLimits, owner: Owner, identity: Identity, id: string,
      mode: "read" | "write", readIdPolicy?: BoundedRequests.ReadIdPolicy,
    ) {
      return originalLifetime(failure, limits, owner, identity, id, mode, readIdPolicy).pipe(Effect.tap(lifetime =>
        observeWaitingLifetime ? Deferred.succeed(lifetimeCreated, lifetime.deadlineUnixMilliseconds) : Effect.void));
    });
    let callbacks = 0;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const ordinal = ++callbacks, result = await Reflect.apply(original, this, args);
      if (ordinal === 1) { await held.enter(); await held.wait(); }
      return result;
    });
    const first = Effect.runPromiseExit(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 1 }] }));
    try {
      await Effect.runPromise(held.reached);
      const key = connected.reservations.newRequestKey(), persistedClaim = claimWritten(key);
      observeWaitingLifetime = true;
      const expired = await Effect.runPromise(Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(connected.reservations.run(key, { reservations: [{ ...pair, quantity: 2 }] }));
        yield* persistedClaim;
        // The actual owner creates the lifetime after the claim ACK. Observe
        // that original deadline rather than mistaking persisted claim for it.
        const deadline = yield* Deferred.await(lifetimeCreated);
        expect(deadline - (yield* Clock.currentTimeMillis)).toBe(10_000);
        yield* TestClock.adjust("10 seconds");
        return yield* Fiber.await(waiting);
      }).pipe(Effect.provide(TestClock.layer())));
      expectRefusal(expired, "deadlineExceeded"); expect(callbacks).toBe(1);
      await held.release(); expect(Exit.isSuccess(await first)).toBe(true);
      expect((await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 3 }] })))[0])
        .toMatchObject({ quantity: 3 });
      expect(callbacks).toBe(2);
    } finally { await held.release(); await first; lifetimeOwner.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it("joins a cancelled native Promise within its cleanup grace before admitting the next selected callback", async () => {
    const graph = await connected.seed("scope-callback-cancel"), pair = firstPair(graph), held = gate(), controller = new AbortController();
    const original = InventoryModuleService.prototype.createReservationItems;
    let callbacks = 0, active = 0, maximumActive = 0;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const ordinal = ++callbacks; active++; maximumActive = Math.max(maximumActive, active);
      try {
        const result = await Reflect.apply(original, this, args);
        if (ordinal === 1) { await held.enter(); await held.wait(); }
        return result;
      } finally { active--; }
    });
    const before = await snapshot();
    const cancelled = Effect.runPromiseExit(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 1 }] }), { signal: controller.signal });
    let next: typeof cancelled | undefined;
    try {
      await Effect.runPromise(held.reached); controller.abort();
      const key = connected.reservations.newRequestKey(), persistedClaim = claimWritten(key);
      next = Effect.runPromiseExit(connected.reservations.run(key, { reservations: [{ ...pair, quantity: 2 }] }));
      await Effect.runPromise(persistedClaim);
      await held.release();
      expect(failureCause(await cancelled).reasons.some(Cause.isInterruptReason)).toBe(true);
      const completed = await next;
      expect(Exit.isSuccess(completed)).toBe(true);
      expect(callbacks).toBe(2); expect(maximumActive).toBe(1); expect(active).toBe(0);
      const after = await snapshot();
      expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      const reservations = await Effect.runPromise(connected.probe("reservation_item", [pair.inventory_item_id]));
      expect(reservations.filter(row => row.quantity === (1).toPrecision(20))).toEqual([]);
      expect(reservations.filter(row => row.quantity === (2).toPrecision(20))).toHaveLength(1);
    } finally { controller.abort(); await held.release(); await Promise.all([cancelled, ...(next === undefined ? [] : [next])]); native.mockRestore(); }
  }, 180_000);

  it("recovers the genuine selected reservation after lost acknowledgement without repeating native callbacks or retaining exclusion", async () => {
    const graph = await connected.seed("scope-lost-ack"), pair = firstPair(graph);
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const fault = connected.fixture.loseNextNativeRootAcknowledgement(), key = connected.reservations.newRequestKey();
      const input = { reservations: [{ ...pair, quantity: 1 }] };
      const result = await Effect.runPromise(connected.reservations.run(key, input));
      expect(fault.armed).toBe(false); expect(fault.failures).toBe(1); expect(fault.evidence).toBeDefined();
      expect(native).toHaveBeenCalledTimes(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(connected.reservations.run(key, input))).toEqual(result);
      expect(native).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(committed);
      expect((await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 2 }] })))[0])
        .toMatchObject({ quantity: 2 });
      expect(native).toHaveBeenCalledTimes(2);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("reclaims exclusion when cancellation loses successful native acquisition before host transfer", async () => {
    const graph = await connected.seed("scope-acquisition-handoff-cancel"), pair = firstPair(graph);
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), controller = new AbortController();
    let firstAcquisition = true, acquired: CoreNativeRootOperation | undefined;
    const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => {
      if (name !== "BoundedRequest.withinDeadline" || !firstAcquisition) return work;
      firstAcquisition = false;
      // The real Core begin has succeeded and its deadline timer has finished.
      // Hold only its delivery to the host's acquireUseRelease registration.
      return work.pipe(Effect.tap(value => Effect.gen(function* () {
        if (!isCoreNativeRootOperation(value))
          return yield* Effect.die(new Error("Acquisition diagnostics did not return the actual native root operation"));
        // Retain the exact issued successful value only for cleanup; it is
        // never fabricated, copied or used to admit a callback.
        acquired = value;
        yield* Deferred.succeed(reached, undefined);
        yield* Deferred.await(release);
      })));
    } };
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems"), key = connected.reservations.newRequestKey();
    const cancelled = Effect.runPromiseExit(connected.reservations.run(key, { reservations: [{ ...pair, quantity: 1 }] }).pipe(
      Effect.provideService(ExecutionDiagnostics, diagnostics),
    ), { signal: controller.signal });
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      expect(acquired).toBeDefined(); expect(native).not.toHaveBeenCalled();
      controller.abort();
      const interrupted = failureCause(await cancelled);
      expect(interrupted.reasons.some(Cause.isInterruptReason), Cause.pretty(interrupted)).toBe(true);
      expect(interrupted.reasons.filter(Cause.isDieReason), Cause.pretty(interrupted)).toEqual([]);
      expect(native).not.toHaveBeenCalled();
      await connected.fixture.run(connected.fixture.useGeneration(generation => generation.database.assertOpen));
      const inventory = await connected.fixture.inventory();
      expect(inventory.outcomes.find(outcome => outcome.value.key === key)?.value).toMatchObject({ kind: "nativeRoot", state: "failed" });
      const next = await Effect.runPromiseExit(connected.reservations.run(connected.reservations.newRequestKey(), {
        reservations: [{ ...pair, quantity: 2 }],
      }));
      expect(Exit.isSuccess(next), Exit.isFailure(next) ? Cause.pretty(next.cause) : undefined).toBe(true);
      if (Exit.isSuccess(next)) expect(next.value[0]).toMatchObject({ quantity: 2 });
      expect(native).toHaveBeenCalledTimes(1);
    } finally {
      controller.abort(); await Effect.runPromise(Deferred.succeed(release, undefined));
      await cancelled;
      if (acquired !== undefined) await Effect.runPromise(acquired.abort());
      native.mockRestore();
    }
  }, 180_000);

  it("expires at the original deadline during actual post-grant initialization readiness and releases exclusion", async () => {
    const graph = await connected.seed("scope-post-grant-readiness-deadline"), pair = firstPair(graph), selected = await prepareReservation();
    const readinessHeld = Deferred.makeUnsafe<void>(), releaseReadiness = Deferred.makeUnsafe<void>();
    const deadlineCancellationStarted = Deferred.makeUnsafe<void>(), lifetimeCreated = Deferred.makeUnsafe<number>();
    const originalInitialization = NativeInitialization.makeNativeCommerceInitialization, originalLifetime = BoundedRequests.makeBoundedRequestLifetime;
    let postGrant = false, firstAcquisition = true, heldActualReadiness = false, completedPostGrantLookups = 0;
    const lifetimeOwner = vi.spyOn(BoundedRequests, "makeBoundedRequestLifetime").mockImplementation(function <Failure, Owner extends object, Identity extends object>(
      failure: (reason: BoundedRequests.RequestFailureReason, cause?: unknown) => Failure,
      limits: BoundedRequests.RequestLimits, owner: Owner, identity: Identity, id: string,
      mode: "read" | "write", readIdPolicy?: BoundedRequests.ReadIdPolicy,
    ) {
      return originalLifetime(failure, limits, owner, identity, id, mode, readIdPolicy).pipe(Effect.tap(lifetime =>
        Deferred.succeed(lifetimeCreated, lifetime.deadlineUnixMilliseconds)));
    });
    const initializationOwner = vi.spyOn(NativeInitialization, "makeNativeCommerceInitialization").mockImplementation((...args) =>
      originalInitialization(...args).pipe(Effect.map(initialization => Object.freeze({ ...initialization,
        requireReady: initialization.requireReady.pipe(Effect.tap(() => Effect.gen(function* () {
          if (!postGrant || heldActualReadiness) return;
          completedPostGrantLookups++; heldActualReadiness = true;
          // All actual initialization lookup and validation has succeeded.
          // Hold only its interruptible delivery to the real post-grant loop.
          yield* Deferred.succeed(readinessHeld, undefined);
          yield* Deferred.await(releaseReadiness).pipe(Effect.onInterrupt(() =>
            Deferred.succeed(deadlineCancellationStarted, undefined)));
        }))),
      }))),
    );
    const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => {
      if (name !== "BoundedRequest.withinDeadline" || !firstAcquisition) return work;
      firstAcquisition = false;
      return work.pipe(Effect.tap(value => Effect.sync(() => {
        if (!isCoreNativeRootOperation(value)) throw new Error("Post-grant readiness did not follow actual native acquisition");
        postGrant = true;
      })));
    } };
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems"), key = selected.newRequestKey();
    try {
      await Effect.runPromise(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(selected.run(key, { reservations: [{ ...pair, quantity: 1 }] }).pipe(
          Effect.provideService(ExecutionDiagnostics, diagnostics),
        ));
        return yield* Effect.gen(function* () {
          yield* Deferred.await(readinessHeld);
          const deadline = yield* Deferred.await(lifetimeCreated);
          expect(postGrant).toBe(true); expect(heldActualReadiness).toBe(true); expect(completedPostGrantLookups).toBe(1);
          expect(deadline - (yield* Clock.currentTimeMillis)).toBe(10_000);
          expect(native).not.toHaveBeenCalled();
          yield* TestClock.adjust("10 seconds");
          // Observe cancellation initiation at expiry, independently of later
          // owned SQL cleanup. No test release or second timeout supplies it.
          expect(yield* Deferred.isDone(deadlineCancellationStarted)).toBe(true);
          expectRefusal(yield* Fiber.await(pending), "deadlineExceeded");
          expect(native).not.toHaveBeenCalled();
          yield* connected.fixture.useGeneration(generation => generation.database.assertOpen);
          const inventory = yield* connected.fixture.useGeneration(generation =>
            readCoreNativeFixtureInventory(generation.database, connected.fixture.physical.persistence));
          expect(inventory.outcomes.find(outcome => outcome.value.key === key)?.value).toMatchObject({ kind: "nativeRoot", state: "failed" });
          expect(yield* Deferred.isDone(releaseReadiness)).toBe(false);
        }).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? Deferred.succeed(releaseReadiness, undefined).pipe(
          Effect.andThen(Fiber.await(pending)), Effect.asVoid,
        ) : Effect.void));
      }).pipe(Effect.provide(TestClock.layer())));
      const next = await Effect.runPromise(selected.run(selected.newRequestKey(), { reservations: [{ ...pair, quantity: 2 }] }));
      expect(next[0]).toMatchObject({ quantity: 2 }); expect(native).toHaveBeenCalledTimes(1);
      expect(await Effect.runPromise(Deferred.isDone(releaseReadiness))).toBe(false);
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseReadiness, undefined));
      initializationOwner.mockRestore(); lifetimeOwner.mockRestore(); native.mockRestore();
    }
  }, 180_000);
});
