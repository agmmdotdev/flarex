import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CartModuleService } from "@medusajs/cart/services";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { finishOrderFixture } from "./support/core-order-fixture";
import { collectionCartRows, prepareCorePaymentCollections } from "./support/core-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];

describe("explicit atomic owner for native stored workflow declarations", () => {
  let local: Awaited<ReturnType<typeof prepareCorePaymentCollections>>;
  beforeAll(async () => {
    local = await prepareCorePaymentCollections(driver, close => cleanup.push(close), undefined, [...collectionCartRows,
      { table: "cart", row: { id: "cart-stored-late", currency_code: "usd" } },
    ]);
  }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); await local.closeWorkflowHosts(); }, 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("publishes one native collection outcome and replays it after reopening the host", async () => {
    const calls = vi.spyOn(CartModuleService.prototype, "listAndCountCarts");
    const host = await local.prepareCreationProbe("stored"), key = host.newRequestKey(), input = { cart_id: "cart-unlinked" };
    const before = await local.snapshot(), result = await Effect.runPromise(host.run(key, input));
    const after = await local.snapshot(), invoked = calls.mock.calls.length;
    const timestamp = expectCheckoutSettlement(before, after, key);
    const { id } = Schema.decodeUnknownSync(Schema.JsonObject)(result);
    expect(invoked).toBeGreaterThan(0);
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
    const inventory = await local.fixture.inventory();
    await Effect.runPromise(host.close);
    const reopened = await local.prepareCreationProbe("stored");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(result);
    expect(calls).toHaveBeenCalledTimes(invoked);
    expect(await local.fixture.inventory()).toEqual(inventory);
    expect(await Effect.runPromise(Effect.result(reopened.run(key, { cart_id: "cart-stored-late" })))).toMatchObject({
      _tag: "Failure", failure: { reason: "requestConflict" },
    });
    expect(calls).toHaveBeenCalledTimes(invoked);
    expect(await local.fixture.inventory()).toEqual(inventory);
  }, 240_000);

  it("rolls back native collection, Link and events after a late parent failure", async () => {
    const host = await local.prepareCreationProbe("stored-late"), before = await local.fixture.inventory(), key = host.newRequestKey();
    const result = await Effect.runPromiseExit(host.run(key, { cart_id: "cart-stored-late" }));
    if (Exit.isSuccess(result)) throw new Error("Stored parent succeeded after its late failure");
    expect(Cause.pretty(result.cause)).toContain("Late parent failure after native Cart collection Link");
    await expectCheckoutRollback(local.fixture, before, key);
  }, 240_000);
});
