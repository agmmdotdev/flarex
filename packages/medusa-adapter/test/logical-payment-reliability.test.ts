import { Cause, Deferred, Effect, Exit, Fiber, Schema, Tracer } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const cleanup: Array<() => Promise<void>> = [];

describe("native Payment workflow reliability", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => { local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await local.closeWorkflowHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("publishes only one collection and Link from competing native Cart creations", async () => {
    const firstReady = await Effect.runPromise(Deferred.make<void>()), secondReady = await Effect.runPromise(Deferred.make<void>()),
      secondAttempt = await Effect.runPromise(Deferred.make<void>()), release = await Effect.runPromise(Deferred.make<void>());
    const first = await local.prepareCreationProbe("race", () => Effect.runPromise(
      Deferred.succeed(firstReady, undefined).pipe(Effect.andThen(Deferred.await(release)))));
    const second = await local.prepareCreationProbe("race", () => Effect.runPromise(
      Deferred.succeed(secondReady, undefined).pipe(Effect.andThen(Deferred.await(release)))));
    const tracer = Tracer.make({ span(options) {
      if (options.name === "AtomicCommerce.attempt") Effect.runSync(Deferred.succeed(secondAttempt, undefined));
      return new Tracer.NativeSpan(options);
    } });
    const input = { cart_id: "cart-unlinked" }, firstKey = first.newRequestKey(), secondKey = second.newRequestKey();
    const before = await local.snapshot();
    const results = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const a = yield* first.run(firstKey, input).pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(firstReady).pipe(Effect.timeout("15 seconds"));
      const b = yield* second.run(secondKey, input).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.exit, Effect.forkScoped);
      yield* Deferred.await(secondAttempt).pipe(Effect.timeout("15 seconds"));
      // PGlite serializes transactions on one backend. PostgreSQL must reach
      // both native completed branches before either can publish.
      if (driver === "postgres") yield* Deferred.await(secondReady).pipe(Effect.timeout("15 seconds"));
      expect(yield* Deferred.isDone(release)).toBe(false);
      yield* Deferred.succeed(release, undefined);
      return [yield* Fiber.join(a), yield* Fiber.join(b)];
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("40 seconds"))));
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    const failed = results.find(Exit.isFailure);
    if (failed === undefined) throw new Error("Expected one competing native Cart creation to fail");
    expect(failed.cause.reasons.length).toBeGreaterThan(0);
    for (const reason of failed.cause.reasons) {
      if (driver === "pglite" && Cause.isDieReason(reason)) {
        expect(reason.defect).toEqual(new Error("Cart cart-unlinked already has a payment collection"));
      } else {
        expect(reason).toMatchObject({ _tag: "Fail", error: { reason: driver === "postgres" ? "writeConflict" : "rollbackOnly" } });
      }
    }
    if (driver === "pglite") {
      expect(failed.cause.reasons.some(Cause.isDieReason)).toBe(true);
      expect(failed.cause.reasons.some(Cause.isFailReason)).toBe(true);
    }
    const after = await local.snapshot();
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(after.events.length - before.events.length).toBe(2);
    const winner = results[0] !== undefined && Exit.isSuccess(results[0]) ? { host: first, key: firstKey, result: results[0] }
      : { host: second, key: secondKey, result: results[1] };
    if (winner.result === undefined || Exit.isFailure(winner.result)) throw new Error("Missing successful native Cart creation");
    expect(await Effect.runPromise(winner.host.run(winner.key, input))).toEqual(winner.result.value);
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);

  it("keeps identical Cart and request identities scoped to their own shop", async () => {
    const foreign = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close), {
      resource: local.fixture.resource,
      fixtureIdentity: { deploymentId: "payment-reliability-foreign", projectId: "payment-reliability-foreign", uuidOffset: 17_000_000 },
    });
    try {
      const createA = await local.prepareCartCreation(), createB = await foreign.prepareCartCreation(), key = createA.newRequestKey();
      const input = { cart_id: "cart-collections" }, a = object(await Effect.runPromise(createA.run(key, input))),
        b = object(await Effect.runPromise(createB.run(key, input)));
      expect(a.id).not.toBe(b.id);
      expect(a).toMatchObject({ amount: 15 }); expect(b).toMatchObject({ amount: 15 });
      expect(await local.readCollection(text(a.id))).toHaveLength(1);
      expect(await foreign.readCollection(text(b.id))).toHaveLength(1);
      expect(await local.readCollection(text(b.id))).toEqual([]);
      expect(await foreign.readCollection(text(a.id))).toEqual([]);
      const cancelA = await local.prepareCancellation(), cancelB = await foreign.prepareCancellation(), before = await local.snapshot();
      expect(await Effect.runPromise(Effect.result(cancelA.run(cancelA.newRequestKey(), { payment_collection_id: text(b.id) })))).toMatchObject({ _tag: "Failure" });
      expect(await local.snapshot()).toEqual(before);
      expect(await Effect.runPromise(Effect.result(cancelB.run(cancelB.newRequestKey(), { payment_collection_id: text(a.id) })))).toMatchObject({ _tag: "Failure" });
      expect(await local.snapshot()).toEqual(before);
      expect(await Effect.runPromise(createA.run(key, input))).toEqual(a);
      expect(await Effect.runPromise(createB.run(key, input))).toEqual(b);
      expect(await local.snapshot()).toEqual(before);
    } finally { await foreign.closeWorkflowHosts(); }
  }, 240_000);

  it("replays a capture after losing the settled response and reopening its host", async () => {
    const create = await local.prepareOrderCreation(), sessions = await local.prepareSession(), authorize = await local.prepareAuthorize();
    const [collection] = objects(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", amount: 15 })));
    const session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), {
      payment_collection_id: text(collection?.id), provider_id: "pp_system_default",
    })));
    const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: text(session.id) })));
    const capture = await local.prepareCapture(), key = capture.newRequestKey(), input = { payment_id: text(payment.id), amount: 3.125 };
    const lost = new Error("Client response lost after the server settled capture"), provider = vi.spyOn(SystemPaymentProvider.prototype, "capturePayment");
    try {
      // Fault the caller's delivery boundary after the genuine run settles;
      // this does not simulate an ambiguous database COMMIT acknowledgement.
      await expect((async () => { await Effect.runPromise(capture.run(key, input)); throw lost; })()).rejects.toBe(lost);
      const after = await local.snapshot();
      expect(provider).toHaveBeenCalledTimes(1);
      await Effect.runPromise(capture.close);
      const reopened = await local.prepareCapture(), replay = await Effect.runPromise(reopened.run(key, input));
      expect(replay).toMatchObject({ id: payment.id, captures: [{ amount: 3.125 }] });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await local.snapshot()).toEqual(after);
      expect(await Effect.runPromise(Effect.result(reopened.run(key, { ...input, amount: 4 })))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await local.snapshot()).toEqual(after);
    } finally { provider.mockRestore(); }
  }, 240_000);

  it("excludes a fully captured Payment while canceling the remaining authorized Payment", async () => {
    const create = await local.prepareOrderCreation(), sessions = await local.prepareSizedSession(), authorize = await local.prepareAuthorize(),
      capture = await local.prepareCapture(), cancel = await local.prepareCancellation();
    const [collection] = objects(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", amount: 15 })));
    const id = text(collection?.id), ids: string[] = [];
    for (const amount of ["3.125", "11.875"]) {
      const session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), { payment_collection_id: id,
        provider_id: "pp_system_default", currency_code: "usd", amount, data: {} })));
      const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: text(session.id) })));
      ids.push(text(payment.id));
    }
    await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: ids[0]!, amount: 3.125 }));
    const [before] = objects(await local.readCollection(id)), payments = objects(before?.payments);
    const captured = payments.find(row => row.id === ids[0]);
    expect(captured).toMatchObject({ captured_at: expect.any(String), canceled_at: null });
    expect(before).toMatchObject({ status: "authorized", captured_amount: 3.125 });
    const provider = vi.spyOn(SystemPaymentProvider.prototype, "cancelPayment");
    try {
      expect(await Effect.runPromise(cancel.run(cancel.newRequestKey(), { payment_collection_id: id }))).toMatchObject({ status: "partially_captured" });
      const [after] = objects(await local.readCollection(id)), remaining = objects(after?.payments);
      expect(remaining.find(row => row.id === ids[0])).toEqual(captured);
      expect(remaining.find(row => row.id === ids[1])).toMatchObject({ captured_at: null, canceled_at: expect.any(String) });
      expect(after).toMatchObject({ captured_amount: 3.125, status: "partially_captured" });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { provider.mockRestore(); }
  }, 240_000);
});
