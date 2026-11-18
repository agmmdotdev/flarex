import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentEvents } from "@medusajs/framework/utils/portable";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCorePaymentCollections } from "./support/core-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const cleanup: Array<() => Promise<void>> = [];

describe("native Payment workflow reliability", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentCollections>>;
  beforeAll(async () => { local = await prepareCorePaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await local.closeWorkflowHosts(); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("publishes only one collection and Link from competing native Cart creations", async () => {
    const firstReady = await Effect.runPromise(Deferred.make<void>()), secondReady = await Effect.runPromise(Deferred.make<void>()),
      release = await Effect.runPromise(Deferred.make<void>());
    const wait = (ready: typeof firstReady) => () => Effect.runPromise(
      Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release))));
    const first = await local.prepareCreationProbe("race", wait(firstReady));
    const second = await local.prepareCreationProbe("race", wait(secondReady));
    const input = { cart_id: "cart-unlinked" }, firstKey = first.newRequestKey(), secondKey = second.newRequestKey();
    const before = await local.snapshot(), beforeInventory = await local.fixture.inventory();
    const [firstResult, secondResult] = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const a = yield* first.run(firstKey, input).pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(firstReady).pipe(Effect.timeout("15 seconds"));
      const b = yield* second.run(secondKey, input).pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(secondReady).pipe(Effect.timeout("15 seconds"));
      yield* Deferred.succeed(release, undefined);
      return [yield* Fiber.join(a), yield* Fiber.join(b)] as const;
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("45 seconds"))));
    expect([firstResult, secondResult].filter(Exit.isSuccess)).toHaveLength(1);
    const { winner, loser } = Exit.isSuccess(firstResult)
      ? { winner: { host: first, key: firstKey, result: firstResult }, loser: { key: secondKey, result: secondResult } }
      : { winner: { host: second, key: secondKey, result: secondResult }, loser: { key: firstKey, result: firstResult } };
    if (Exit.isSuccess(loser.result) || Exit.isFailure(winner.result)) throw new Error("Expected exactly one successful Cart creation");
    expect(loser.result.cause.reasons, Cause.pretty(loser.result.cause)).toMatchObject([{ _tag: "Fail", error: { reason: "writeConflict" } }]);
    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, winner.key);
    const { id } = object(winner.result.value);
    expect(after.rows.length - before.rows.length).toBe(2);
    const revisions = after.revisions.filter(row => row.timestamp === timestamp);
    expect(revisions).toHaveLength(2);
    expect(revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({ id }) }),
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({ cart_id: input.cart_id, payment_collection_id: id }) }),
    ]));
    for (const revision of revisions)
      expect(after.indexes).toContainEqual(expect.objectContaining({ table: revision.table, id: revision.id, name: "by_id", timestamp }));
    expect(after.events.filter(event => event.timestamp === timestamp).map(event => event.envelope.contract).toSorted()).toEqual([
      "LinkCartPaymentCollection.attached", "payment.payment-collection.created",
    ]);
    const inventory = await local.fixture.inventory();
    expect(inventory.outcomes.filter(outcome => outcome.value.key === loser.key)).toMatchObject([
      { value: { key: loser.key, kind: "nativeRoot", state: "failed" } },
    ]);
    expect(inventory.outcomes.filter(outcome => outcome.value.key !== loser.key)).toEqual([
      ...beforeInventory.outcomes, ...after.outcomes.filter(outcome => outcome.value.key === winner.key),
    ]);
    expect(await Effect.runPromise(winner.host.run(winner.key, input))).toEqual(winner.result.value);
    expect(await local.fixture.inventory()).toEqual(inventory);
  }, 240_000);

  it("keeps identical Cart and request identities scoped to their own shop", async () => {
    const foreign = await prepareCorePaymentCollections(driver, close => cleanup.push(close), local.fixture.physical);
    try {
      const createA = await local.prepareCartCreation(), createB = await foreign.prepareCartCreation(), key = createA.newRequestKey();
      expect(foreign.fixture.physical.namespace).toBe(local.fixture.physical.namespace);
      expect(foreign.fixture.physical.instanceName).not.toBe(local.fixture.physical.instanceName);
      const beforeA = await local.snapshot(), beforeB = await foreign.snapshot();
      const input = { cart_id: "cart-collections" }, a = object(await Effect.runPromise(createA.run(key, input))),
        b = object(await Effect.runPromise(createB.run(key, input)));
      expect(a.id).not.toBe(b.id);
      expect(a).toMatchObject({ amount: 15 }); expect(b).toMatchObject({ amount: 15 });
      expect(await local.readCollection(text(a.id))).toHaveLength(1);
      expect(await foreign.readCollection(text(b.id))).toHaveLength(1);
      expect(await local.readCollection(text(b.id))).toEqual([]);
      expect(await foreign.readCollection(text(a.id))).toEqual([]);
      expectCheckoutSettlement(beforeA, await local.snapshot(), key);
      expectCheckoutSettlement(beforeB, await foreign.snapshot(), key);
      const cancelA = await local.prepareCancellation(), cancelB = await foreign.prepareCancellation();
      const cancelKey = cancelA.newRequestKey(), inventoryA = await local.fixture.inventory(), inventoryB = await foreign.fixture.inventory();
      expect(await Effect.runPromise(Effect.result(cancelA.run(cancelKey, { payment_collection_id: text(b.id) })))).toMatchObject({ _tag: "Failure" });
      await expectCheckoutRollback(local.fixture, inventoryA, cancelKey);
      expect(await foreign.fixture.inventory()).toEqual(inventoryB);
      const failedA = await local.fixture.inventory();
      expect(await Effect.runPromise(Effect.result(cancelB.run(cancelKey, { payment_collection_id: text(a.id) })))).toMatchObject({ _tag: "Failure" });
      await expectCheckoutRollback(foreign.fixture, inventoryB, cancelKey);
      expect(await local.fixture.inventory()).toEqual(failedA);
      const failedB = await foreign.fixture.inventory();
      expect(await Effect.runPromise(createA.run(key, input))).toEqual(a);
      expect(await Effect.runPromise(createB.run(key, input))).toEqual(b);
      expect(await local.fixture.inventory()).toEqual(failedA);
      expect(await foreign.fixture.inventory()).toEqual(failedB);
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
      const before = await local.snapshot(), fault = local.fixture.loseNextNativeRootAcknowledgement();
      // Drop the delivery after the server has already recovered its lost commit acknowledgement.
      await expect((async () => { await Effect.runPromise(capture.run(key, input)); throw lost; })()).rejects.toBe(lost);
      const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
      expect(fault).toMatchObject({ armed: false, failures: 1, evidence: { timestamp } });
      const inventory = await local.fixture.inventory();
      expect(fault.evidence?.inventory).toEqual(inventory);
      expect(provider).toHaveBeenCalledTimes(1);
      await Effect.runPromise(capture.close);
      const reopened = await local.prepareCapture(), replay = await Effect.runPromise(reopened.run(key, input));
      expect(replay).toMatchObject({ id: payment.id, captures: [{ amount: 3.125 }] });
      const [captured] = objects(object(replay).captures);
      const rows = after.revisions.filter(row => row.timestamp === timestamp);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: expect.objectContaining({ id: payment.id }) }),
        expect.objectContaining({ value: expect.objectContaining({ id: captured?.id, payment_id: payment.id }) }),
        expect.objectContaining({ value: expect.objectContaining({ order_id: "order-finance", reference_id: captured?.id }) }),
      ]));
      expect(after.events.filter(event => event.envelope.contract === PaymentEvents.CAPTURED && event.timestamp === timestamp))
        .toMatchObject([{ envelope: { message: { data: { id: payment.id } } } }]);
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await local.fixture.inventory()).toEqual(inventory);
      expect(await Effect.runPromise(Effect.result(reopened.run(key, { ...input, amount: 4 })))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await local.fixture.inventory()).toEqual(inventory);
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
      const prior = await local.snapshot(), key = cancel.newRequestKey();
      expect(await Effect.runPromise(cancel.run(key, { payment_collection_id: id }))).toMatchObject({ status: "partially_captured" });
      const settled = await local.snapshot(), timestamp = expectCheckoutSettlement(prior, settled, key);
      const revised = settled.revisions.filter(row => row.timestamp === timestamp);
      expect(revised.some(row => row.value?.id === ids[0])).toBe(false);
      expect(revised).toEqual(expect.arrayContaining([
        expect.objectContaining({ value: expect.objectContaining({ id, status: "partially_captured" }) }),
        expect.objectContaining({ value: expect.objectContaining({ id: ids[1], canceled_at: expect.any(String) }) }),
      ]));
      const [after] = objects(await local.readCollection(id)), remaining = objects(after?.payments);
      expect(remaining.find(row => row.id === ids[0])).toEqual(captured);
      expect(remaining.find(row => row.id === ids[1])).toMatchObject({ captured_at: null, canceled_at: expect.any(String) });
      expect(after).toMatchObject({ captured_amount: 3.125, status: "partially_captured" });
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { provider.mockRestore(); }
  }, 240_000);
});
