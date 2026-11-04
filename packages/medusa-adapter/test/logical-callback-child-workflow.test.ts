import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { collectionCartRows, prepareCorePaymentCollections } from "./support/core-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
describe("callback child workflows borrow the existing atomic owner", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentCollections>>;
  beforeAll(async () => {
    local = await prepareCorePaymentCollections(driver, close => cleanup.push(close), undefined, [...collectionCartRows,
      { table: "cart", row: { id: "cart-callback-late", currency_code: "usd" } },
      { table: "cart", row: { id: "cart-callback-caught", currency_code: "usd" } },
      { table: "cart", row: { id: "cart-callback-detached", currency_code: "usd" } },
    ]);
  }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); await local.closeWorkflowHosts(); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);
  it("executes the genuine Cart collection child and replays its sole root outcome", async () => {
    const host = await local.prepareCreationProbe("callback"), key = host.newRequestKey(), input = { cart_id: "cart-unlinked" };
    const create = vi.spyOn(PaymentModuleService.prototype, "createPaymentCollections");
    const before = await local.snapshot(), result = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    const timestamp = expectCheckoutSettlement(before, after, key);
    const { id } = Schema.decodeUnknownSync(Schema.JsonObject)(result);
    expect(after.rows.length - before.rows.length).toBe(2);
    const revisions = after.revisions.filter(row => row.timestamp === timestamp);
    expect(revisions).toHaveLength(2);
    expect(revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({ id }) }),
      expect.objectContaining({ previous: null, deleted: false, value: expect.objectContaining({
        cart_id: input.cart_id, payment_collection_id: id,
      }) }),
    ]));
    for (const revision of revisions)
      expect(after.indexes).toContainEqual(expect.objectContaining({ table: revision.table, id: revision.id, name: "by_id", timestamp }));
    expect(after.events.filter(event => event.timestamp === timestamp).map(event => event.envelope.contract).toSorted()).toEqual([
      "LinkCartPaymentCollection.attached", "payment.payment-collection.created",
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    const inventory = await local.fixture.inventory();
    await Effect.runPromise(host.close);
    const reopened = await local.prepareCreationProbe("callback");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(result);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await local.fixture.inventory()).toEqual(inventory);
  }, 240_000);
  it.each([
    ["callback-late", "cart-callback-late", "Late failure after callback-invoked native collection"],
    ["callback-caught", "cart-callback-caught", "unsupportedProfile"],
    ["callback-detached", "cart-callback-detached", "unsupportedProfile"],
  ] as const)("rolls back all native writes and events for %s", async (mode, cart_id, expected) => {
    const host = await local.prepareCreationProbe(mode), before = await local.fixture.inventory(), key = host.newRequestKey();
    const exit = await Effect.runPromiseExit(host.run(key, { cart_id }));
    if (Exit.isSuccess(exit)) throw new Error("Callback root settled after a child failure");
    if (mode === "callback-late") expect(Cause.pretty(exit.cause)).toContain(expected);
    else expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual(expect.arrayContaining([expect.objectContaining({ reason: expected })]));
    await expectCheckoutRollback(local.fixture, before, key);
  }, 240_000);
});
