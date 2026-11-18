import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { prepareCartPaymentCollectionCreationWorkflow } from "../src/workflows/payment/collections";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { prepareCorePaymentCollections } from "./support/core-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("genuine native Payment collection workflows", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentCollections>>;
  beforeAll(async () => { local = await prepareCorePaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await local.closeWorkflowHosts(); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("creates and links an Order collection, then cancels it with the declared singleton result", async () => {
    const create = await local.prepareOrderCreation(), input = { order_id: "order-finance", amount: 15 }, request = create.newRequestKey();
    const before = await local.snapshot();
    const result = await Effect.runPromise(create.run(request, input));
    const [collection] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result);
    expect(collection).toMatchObject({ amount: 15, currency_code: "usd" });
    const id = text(collection?.id), created = await local.snapshot(), timestamp = expectCheckoutSettlement(before, created, request);
    const revisions = created.revisions.filter(row => row.timestamp === timestamp);
    expect(revisions).toHaveLength(2);
    expect(revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({ id }) }),
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({
        order_id: input.order_id, payment_collection_id: id, deleted_at: null,
      }) }),
    ]));
    for (const revision of revisions)
      expect(created.indexes).toContainEqual(expect.objectContaining({ table: revision.table, id: revision.id, name: "by_id", timestamp }));
    expect(created.events.filter(event => event.timestamp === timestamp).map(event => event.envelope.contract).toSorted()).toEqual([
      "LinkOrderPaymentCollection.attached", "payment.payment-collection.created",
    ]);
    expect(await Effect.runPromise(create.run(request, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(created);

    const beforeRefusal = await local.fixture.inventory(), prepare = vi.fn(local.options.execution.prepare);
    const cartLink = local.fixture.sources.find(source => source.source === local.cartModules.link.nativeStorage);
    const orderLink = local.fixture.sources.find(source => source.source === local.orderModules.link.nativeStorage);
    if (cartLink === undefined || orderLink === undefined) throw new Error("Missing issued collection Link definitions");
    const wrongSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("order_payment_collection_links", cartLink.definition));
    const wrongSource = Result.getOrThrow(defineAtomicCommerceNativeSource("link", orderLink.definition));
    for (const nativeStorage of [wrongSlot, wrongSource]) {
      expect(await Effect.runPromise(Effect.result(prepareCartPaymentCollectionCreationWorkflow({
        ...local.options,
        execution: { ...local.options.execution, prepare },
        modules: { ...local.cartModules, link: { ...local.cartModules.link, nativeStorage } },
      })))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(await local.fixture.inventory()).toEqual(beforeRefusal);

    const cancel = await local.prepareCancellation(), key = cancel.newRequestKey();
    const canceled = await Effect.runPromise(cancel.run(key, { payment_collection_id: id }));
    expect(canceled).toMatchObject({ id, status: "canceled" });
    expect(await local.readCollection(id)).toMatchObject([{ id, status: "canceled" }]);
    const after = await local.snapshot();
    const cancellation = expectCheckoutSettlement(created, after, key);
    expect(after.revisions.filter(row => row.timestamp === cancellation)).toMatchObject([
      { previous: timestamp, deleted: false, value: { id, status: "canceled" } },
    ]);
    expect(after.events.filter(event => event.timestamp === cancellation)).toMatchObject([
      { envelope: { contract: "payment.payment-collection.updated", message: { data: { id } } } },
    ]);
    const inventory = await local.fixture.inventory();
    expect(await Effect.runPromise(cancel.run(key, { payment_collection_id: id }))).toEqual(canceled);
    expect(await local.fixture.inventory()).toEqual(inventory);
    const duplicate = cancel.newRequestKey();
    const failure = await Effect.runPromiseExit(cancel.run(duplicate, { payment_collection_id: id }));
    if (Exit.isSuccess(failure)) throw new Error("Native cancellation accepted a previously canceled collection");
    expect(Cause.pretty(failure.cause)).toContain("Payment collection is already canceled");
    await expectCheckoutRollback(local.fixture, inventory, duplicate);
  }, 240_000);

  it("executes the retained native collection creation inverse", async () => {
    const forward = await local.prepareCreationProbe("forward"), inverse = await local.prepareCreationProbe("inverse");
    const before = await local.snapshot(), forwardKey = forward.newRequestKey();
    const result = object(await Effect.runPromise(forward.run(forwardKey, [{ amount: "3.125", currency_code: "usd" }])));
    const [created] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result.output);
    expect(created).toMatchObject({ amount: 3.125, currency_code: "usd" });
    const id = text(created?.id), afterForward = await local.snapshot();
    const createdAt = expectCheckoutSettlement(before, afterForward, forwardKey);
    const revision = afterForward.revisions.find(row => row.timestamp === createdAt && row.value?.id === id);
    if (revision === undefined) throw new Error("Missing native PaymentCollection creation revision");
    const key = inverse.newRequestKey();
    const retained = Schema.decodeUnknownSync(Schema.Json)(result.retained);
    expect(await Effect.runPromise(inverse.run(key, retained))).toBeNull();
    expect(await local.readCollection(id)).toEqual([]);
    const after = await local.snapshot(), timestamp = expectCheckoutSettlement(afterForward, after, key);
    expect(after.revisions.filter(row => row.timestamp === timestamp)).toEqual([
      { table: revision.table, id: revision.id, timestamp, previous: createdAt, deleted: true, value: null },
    ]);
    expect(after.indexes.some(index => index.table === revision.table && index.id === revision.id)).toBe(false);
    expect(after.events.filter(event => event.timestamp === timestamp)).toMatchObject([
      { envelope: { contract: "payment.payment-collection.deleted", message: { data: { id } } } },
    ]);
    const cancel = await local.prepareCancellation();
    for (const missing of [id, "paycol-missing"]) {
      const inventory = await local.fixture.inventory(), cancelKey = cancel.newRequestKey();
      expect(await Effect.runPromise(Effect.result(cancel.run(cancelKey, { payment_collection_id: missing })))).toMatchObject({ _tag: "Failure" });
      await expectCheckoutRollback(local.fixture, inventory, cancelKey);
    }
  }, 240_000);

  it("cancels authorized payments, retains partial captures, and refuses completed collections", async () => {
    const create = await local.prepareOrderCreation(), sessions = await local.prepareSession(), authorize = await local.prepareAuthorize(),
      capture = await local.prepareCapture(), cancel = await local.prepareCancellation();
    for (const amount of [0, 3.125, 15]) {
      const [collection] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", amount: 15 })));
      const id = text(collection?.id), session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), {
        payment_collection_id: id, provider_id: "pp_system_default",
      })));
      const payment = object(await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: text(session.id) })));
      if (amount > 0) expect(await Effect.runPromise(capture.run(capture.newRequestKey(), { payment_id: text(payment.id), amount }))).toMatchObject({ id: payment.id });
      const key = cancel.newRequestKey();
      if (amount === 15) {
        const inventory = await local.fixture.inventory();
        const result = await Effect.runPromiseExit(cancel.run(key, { payment_collection_id: id }));
        if (Exit.isSuccess(result)) throw new Error("Native cancellation accepted a completed collection");
        expect(Cause.pretty(result.cause)).toContain("Cannot cancel a completed payment collection");
        await expectCheckoutRollback(local.fixture, inventory, key);
      } else {
        const before = await local.snapshot(), status = amount === 0 ? "canceled" : "partially_captured";
        expect(await Effect.runPromise(cancel.run(key, { payment_collection_id: id }))).toMatchObject({ id, status });
        const after = await local.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
        expect(after.revisions.filter(row => row.timestamp === timestamp)).toEqual(expect.arrayContaining([
          expect.objectContaining({ value: expect.objectContaining({ id, status }) }),
          expect.objectContaining({ value: expect.objectContaining({ id: payment.id, canceled_at: expect.any(String), captured_at: null }) }),
        ]));
        expect(await local.readCollection(id)).toMatchObject([{ id, status,
          payments: [{ id: payment.id, canceled_at: expect.any(String), captured_at: null }] }]);
      }
    }
  }, 240_000);

  it("rolls back collection status when native cancellation catches a provider failure", async () => {
    const create = await local.prepareOrderCreation(), sessions = await local.prepareSession(), authorize = await local.prepareAuthorize(), cancel = await local.prepareCancellation();
    const [collection] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", amount: 1 })));
    const id = text(collection?.id), session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), { payment_collection_id: id, provider_id: "pp_system_default" })));
    await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: text(session.id) }));
    const before = await local.fixture.inventory(), key = cancel.newRequestKey();
    const update = vi.spyOn(PaymentModuleService.prototype, "updatePaymentCollections");
    const cancelProvider = vi.spyOn(SystemPaymentProvider.prototype, "cancelPayment").mockRejectedValueOnce(new Error("Native cancellation failure witness"));
    try {
      expect(await Effect.runPromise(Effect.result(cancel.run(key, { payment_collection_id: id })))).toMatchObject({ _tag: "Failure" });
      expect(cancelProvider).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledBefore(cancelProvider);
      await expect(update.mock.results[0]?.value).resolves.toMatchObject([{ id, status: "canceled" }]);
      await expectCheckoutRollback(local.fixture, before, key);
      expect(local.errors.join(" ")).toContain("Native cancellation failure witness");
    } finally { cancelProvider.mockRestore(); update.mockRestore(); }
  }, 240_000);
});
