import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CartModuleService } from "@medusajs/cart/services";
import { collectionCartRows, prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];

describe("explicit atomic owner for native stored workflow declarations", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => {
    local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close), undefined, [...collectionCartRows,
      { table: "cart", row: { id: "cart-stored-late", currency_code: "usd" } },
    ]);
  }, 240_000);
  afterEach(async () => { vi.restoreAllMocks(); await local.closeWorkflowHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("publishes one native collection outcome and replays it after reopening the host", async () => {
    const calls = vi.spyOn(CartModuleService.prototype, "listAndCountCarts");
    const host = await local.prepareCreationProbe("stored"), key = host.newRequestKey(), input = { cart_id: "cart-unlinked" };
    const before = await local.snapshot(), result = await Effect.runPromise(host.run(key, input));
    const after = await local.snapshot(), invoked = calls.mock.calls.length;
    expect(invoked).toBeGreaterThan(0);
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(after.events.length - before.events.length).toBe(2);
    await Effect.runPromise(host.close);
    const reopened = await local.prepareCreationProbe("stored");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(result);
    expect(calls).toHaveBeenCalledTimes(invoked);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(Effect.result(reopened.run(key, { cart_id: "cart-stored-late" })))).toMatchObject({
      _tag: "Failure", failure: { reason: "requestConflict" },
    });
    expect(calls).toHaveBeenCalledTimes(invoked);
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);

  it("rolls back native collection, Link and events after a late parent failure", async () => {
    const host = await local.prepareCreationProbe("stored-late"), before = await local.snapshot();
    const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), { cart_id: "cart-stored-late" }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Late parent failure after native Cart collection Link");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
});
