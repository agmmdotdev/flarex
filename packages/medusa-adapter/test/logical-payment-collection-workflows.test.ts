import { Effect, Result, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), text = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];

describe("genuine native Payment collection workflows", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => { local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await local.closeWorkflowHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates a stored Cart collection from genuine totals, replays and refuses duplicate association", async () => {
    const host = await local.prepareCartCreation(), input = { cart_id: "cart-collections" }, request = host.newRequestKey();
    const creation = await Effect.runPromise(Effect.result(host.run(request, input)));
    expect(creation, "native Cart collection creation").toMatchObject({ _tag: "Success" });
    const created = object(Result.getOrThrow(creation));
    expect(created).toMatchObject({ amount: 15, currency_code: "usd", payment_sessions: [], payments: [] });
    expect(await Effect.runPromise(host.run(request, input))).toEqual(created);
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
    const sessions = await local.prepareSession();
    const session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), {
      payment_collection_id: text(created.id), provider_id: "pp_system_default",
    })));
    expect(session).toMatchObject({ amount: 15, currency_code: "usd" });
    await local.setPrice("18.125");
    const refresh = await local.prepareCartRefresh(), refreshKey = refresh.newRequestKey();
    const refreshed = await Effect.runPromise(Effect.result(refresh.run(refreshKey, input)));
    expect(Result.getOrThrow(refreshed), "native Cart collection refresh").toBeNull();
    expect(await local.readCollection(text(created.id))).toMatchObject([{ amount: 20.625, currency_code: "usd", payment_sessions: [] }]);
    const after = await local.snapshot();
    expect(await Effect.runPromise(refresh.run(refreshKey, input))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
    const replacement = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), {
      payment_collection_id: text(created.id), provider_id: "pp_system_default",
    })));
    expect(await Effect.runPromise(refresh.run(refresh.newRequestKey(), input))).toBeNull();
    expect(await local.readCollection(text(created.id))).toMatchObject([{ payment_sessions: [{ id: replacement.id }] }]);
    await local.setCurrency("eur");
    expect(await Effect.runPromise(refresh.run(refresh.newRequestKey(), input))).toBeNull();
    expect(await local.readCollection(text(created.id))).toMatchObject([{ amount: 20.625, currency_code: "eur", payment_sessions: [] }]);
    expect(local.errors).toEqual([]);
  }, 240_000);

  it("refuses completed/missing Carts and refreshes an unlinked Cart without creating a collection", async () => {
    const create = await local.prepareCartCreation(), refresh = await local.prepareCartRefresh();
    for (const cart_id of ["cart-completed", "cart-missing"]) {
      const before = await local.snapshot();
      expect(await Effect.runPromise(Effect.result(create.run(create.newRequestKey(), { cart_id })))).toMatchObject({ _tag: "Failure" });
      expect(await local.snapshot()).toEqual(before);
    }
    const before = await local.snapshot();
    expect(await Effect.runPromise(refresh.run(refresh.newRequestKey(), { cart_id: "cart-unlinked" }))).toBeNull();
    const after = await local.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events);
  }, 240_000);

  it("creates and links an Order collection, then cancels it with the declared singleton result", async () => {
    const create = await local.prepareOrderCreation(), input = { order_id: "order-finance", amount: 15 }, request = create.newRequestKey();
    const result = await Effect.runPromise(create.run(request, input));
    const [collection] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result);
    expect(collection).toMatchObject({ amount: 15, currency_code: "usd" });
    expect(await Effect.runPromise(create.run(request, input))).toEqual(result);
    const id = text(collection?.id), cancel = await local.prepareCancellation(), key = cancel.newRequestKey();
    const canceled = await Effect.runPromise(cancel.run(key, { payment_collection_id: id }));
    expect(canceled).toMatchObject({ id, status: "canceled" });
    expect(await local.readCollection(id)).toMatchObject([{ id, status: "canceled" }]);
    const after = await local.snapshot();
    expect(await Effect.runPromise(cancel.run(key, { payment_collection_id: id }))).toEqual(canceled);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(Effect.result(cancel.run(cancel.newRequestKey(), { payment_collection_id: id })))).toMatchObject({ _tag: "Failure" });
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);

  it("rolls back Cart collection, Link and publications after a late native parent failure", async () => {
    const host = await local.prepareCreationProbe("late"), before = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { cart_id: "cart-unlinked" })))).toMatchObject({ _tag: "Failure" });
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("executes the retained native collection creation inverse", async () => {
    const forward = await local.prepareCreationProbe("forward"), inverse = await local.prepareCreationProbe("inverse");
    const result = object(await Effect.runPromise(forward.run(forward.newRequestKey(), [{ amount: "3.125", currency_code: "usd" }])));
    const [created] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result.output);
    expect(created).toMatchObject({ amount: 3.125, currency_code: "usd" });
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.retained!))).toBeNull();
    expect(await local.readCollection(text(created?.id))).toEqual([]);
    const cancel = await local.prepareCancellation(), before = await local.snapshot();
    for (const id of [text(created?.id), "paycol-missing"]) {
      expect(await Effect.runPromise(Effect.result(cancel.run(cancel.newRequestKey(), { payment_collection_id: id })))).toMatchObject({ _tag: "Failure" });
      expect(await local.snapshot()).toEqual(before);
    }
  }, 240_000);

  it("retains and restores native amount and currency preimages through the genuine update inverse", async () => {
    const create = await local.prepareCreationProbe("forward");
    const creation = object(await Effect.runPromise(create.run(create.newRequestKey(), [{ amount: "9007199254740993", currency_code: "usd" }])));
    const [created] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(creation.output), id = text(created?.id);
    const [before] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await local.readCollection(id));
    const forward = await local.prepareUpdateProbe("forward"), inverse = await local.prepareUpdateProbe("inverse");
    const result = object(await Effect.runPromise(forward.run(forward.newRequestKey(), {
      selector: { id }, update: { amount: { value: "9.875", precision: 20 }, currency_code: "eur" },
    })));
    expect(result.retained).toMatchObject([{ id, amount: 9007199254740992, raw_amount: before?.raw_amount, currency_code: "usd" }]);
    expect(await local.readCollection(id)).toMatchObject([{ amount: 9.875, currency_code: "eur" }]);
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.retained!))).toBeNull();
    expect(await local.readCollection(id)).toMatchObject([{ id, amount: 9007199254740992, raw_amount: before?.raw_amount, currency_code: "usd" }]);
  }, 240_000);

  it("executes the native Link inverse and preserves repeated dismissal as a no-op", async () => {
    const create = await local.prepareCartCreation(), created = object(await Effect.runPromise(create.run(create.newRequestKey(), { cart_id: "cart-unlinked" })));
    const input = [{ cart: { cart_id: "cart-unlinked" }, payment: { payment_collection_id: text(created.id) } }], inverse = await local.prepareLinkInverse();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), input))).toBeNull();
    const after = await local.snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), input))).toBeNull();
    const repeated = await local.snapshot();
    expect(repeated.rows).toEqual(after.rows); expect(repeated.events).toEqual(after.events);
    expect(await local.readCollection(text(created.id))).toHaveLength(1);
  }, 240_000);

  it("enforces the retained Cart adjustment constraint in the shared storage owner", async () => {
    const before = await local.snapshot();
    await expect(local.insertAdjustment("-0.000000000000000001")).rejects.toBeDefined();
    expect(await local.snapshot()).toEqual(before);
    await local.insertAdjustment("0.125");
    const refresh = await local.prepareCartRefresh();
    expect(await Effect.runPromise(refresh.run(refresh.newRequestKey(), { cart_id: "cart-collections" }))).toBeNull();
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
      const before = await local.snapshot();
      if (amount === 15) {
        expect(await Effect.runPromise(Effect.result(cancel.run(cancel.newRequestKey(), { payment_collection_id: id })))).toMatchObject({ _tag: "Failure" });
        expect(await local.snapshot()).toEqual(before);
      } else {
        expect(await Effect.runPromise(cancel.run(cancel.newRequestKey(), { payment_collection_id: id }))).toMatchObject({ id,
          status: amount === 0 ? "canceled" : "partially_captured" });
        expect(await local.readCollection(id)).toMatchObject([{ id, status: amount === 0 ? "canceled" : "partially_captured",
          payments: [{ id: payment.id, canceled_at: expect.any(String), captured_at: null }] }]);
      }
    }
  }, 240_000);

  it("rolls back collection status when native cancellation catches a provider failure", async () => {
    const create = await local.prepareOrderCreation(), sessions = await local.prepareSession(), authorize = await local.prepareAuthorize(), cancel = await local.prepareCancellation();
    const [collection] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(create.run(create.newRequestKey(), { order_id: "order-finance", amount: 1 })));
    const id = text(collection?.id), session = object(await Effect.runPromise(sessions.run(sessions.newRequestKey(), { payment_collection_id: id, provider_id: "pp_system_default" })));
    await Effect.runPromise(authorize.run(authorize.newRequestKey(), { id: text(session.id) }));
    const before = await local.snapshot(), cancelProvider = vi.spyOn(SystemPaymentProvider.prototype, "cancelPayment").mockRejectedValueOnce(new Error("Native cancellation failure witness"));
    try {
      expect(await Effect.runPromise(Effect.result(cancel.run(cancel.newRequestKey(), { payment_collection_id: id })))).toMatchObject({ _tag: "Failure" });
      expect(cancelProvider).toHaveBeenCalledTimes(1);
      expect(await local.snapshot()).toEqual(before);
      expect(local.errors.join(" ")).toContain("Native cancellation failure witness");
    } finally { cancelProvider.mockRestore(); }
  }, 240_000);
});
