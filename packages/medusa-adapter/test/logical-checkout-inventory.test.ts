import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { PaymentModuleService } from "@medusajs/payment/services";
import { MathBN } from "@medusajs/framework/utils/portable";
import { prepareLogicalCheckout } from "./support/logical-checkout-fixture";
import { checkoutInventoryData } from "./support/checkout-inventory-data";
import { prepareCheckoutInventoryInverse } from "./support/checkout-inventory-inverse";
import { expectCheckoutContention } from "./support/checkout-contention";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const text = Schema.decodeUnknownSync(Schema.String);

describe("native Product and Inventory checkout on " + driver, () => {
  const cleanup: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareLogicalCheckout>>;
  let lastPhase = "not started";
  beforeAll(async () => {
    const data = checkoutInventoryData();
    local = await prepareLogicalCheckout(driver, release => cleanup.push(release), {
      additionalCases: data.cases, additionalSeeds: data.seeds, onPhase: phase => { lastPhase = phase; },
    });
  }, 600_000);
  afterAll(async () => {
    if (lastPhase !== "checkout host prepared") console.info("Last Inventory checkout phase:", lastPhase);
    for (const release of cleanup.reverse()) await release();
  }, 120_000);
  const selected = (name: string) => {
    const ids = local.cases.get(name);
    if (ids === undefined) throw new Error("Missing Inventory checkout case " + name);
    return ids;
  };
  const run = (name: string) => local.host.run(local.host.newRequestKey(), { id: selected(name).cartId });
  const reservationRows = async (name: string) => {
    const rows = await local.rows();
    const wrappers = rows.filter(row => row.order_id !== undefined && row.item_id !== undefined);
    const link = rows.find(row => row.cart_id === selected(name).cartId && row.order_id !== undefined);
    const itemIds = wrappers.filter(row => row.order_id === link?.order_id).map(row => row.item_id);
    return rows.filter(row => typeof row.inventory_item_id === "string" && itemIds.includes(row.line_item_id));
  };

  it("reserves exact component demand at a channel location with stock, then replays and retries without reserving twice", async () => {
    const ids = selected("variant-available"), key = local.host.newRequestKey(), before = await local.snapshot();
    const result = await Effect.runPromise(local.host.run(key, { id: ids.cartId }));
    const reservations = await reservationRows("variant-available");
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ inventory_item_id: "iitem-variant-available", location_id: "sloc-variant-available-second" });
    expect(MathBN.eq(text(reservations[0]?.quantity), "2.5")).toBe(true);
    const rows = await local.rows();
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-available-0-second")?.reserved_quantity), "2.75")).toBe(true);
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-available-0")?.reserved_quantity), "0.25")).toBe(true);
    const line = rows.find(row => row.id === reservations[0]?.line_item_id);
    expect(line).toMatchObject({ variant_id: "variant-variant-available", product_id: "prod-variant-available" });
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.events.filter(row => row.envelope.contract === "order.placed").length - before.events.filter(row => row.envelope.contract === "order.placed").length).toBe(1);
    expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(run("variant-available"))).toEqual(result);
    expect(await reservationRows("variant-available")).toEqual(reservations);
  }, 180_000);

  it("runs genuine native insufficient-stock and channel validation and publishes no failed checkout", async () => {
    for (const [name, message] of [["variant-insufficient", "Not enough stock available"], ["variant-channel", "not associated with any stock location"]] as const) {
      const before = await local.snapshot(), exit = await Effect.runPromiseExit(run(name));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(message);
      expect(await local.snapshot()).toEqual(before);
    }
  }, 180_000);

  it("retains native backorder and unmanaged-Variant branches", async () => {
    await Effect.runPromise(run("variant-backorder"));
    const reservations = await reservationRows("variant-backorder");
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ allow_backorder: true });
    expect(MathBN.eq(text(reservations[0]?.quantity), "2")).toBe(true);
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const placed = await Effect.runPromise(run("variant-unmanaged"));
      expect(placed.id).toMatch(/^order_/);
      expect(await reservationRows("variant-unmanaged")).toEqual([]);
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
  }, 180_000);

  it("reserves a complete four-Line-Item cohort in one native batch", async () => {
    await Effect.runPromise(run("variant-four"));
    const reservations = await reservationRows("variant-four");
    expect(reservations).toHaveLength(4);
    expect(new Set(reservations.map(row => row.line_item_id)).size).toBe(4);
    expect(new Set(reservations.map(row => row.inventory_item_id))).toEqual(new Set([0, 1, 2, 3].map(index => "iitem-variant-four-" + index)));
  }, 180_000);

  it("rolls back native reservations, levels, Order, Links, Cart, Payment and events after authorization fails late", async () => {
    const ids = selected("variant-late"), before = await local.snapshot(), original = PaymentModuleService.prototype.authorizePaymentSession;
    let reserved = false, authorized = false;
    const reserve = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    const payment = vi.spyOn(PaymentModuleService.prototype, "authorizePaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await original.apply(this, args);
      if (args[0] === ids.sessionId) { reserved = reserve.mock.calls.length === 1; authorized = true; throw new Error("Late Inventory checkout authorization failure"); }
      return result;
    });
    try {
      const exit = await Effect.runPromiseExit(run("variant-late"));
      expect({ reserved, authorized }).toEqual({ reserved: true, authorized: true });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Inventory checkout authorization failure");
    } finally { reserve.mockRestore(); payment.mockRestore(); }
    expect(await local.snapshot()).toEqual(before);
    await Effect.runPromise(run("variant-late"));
    expect(await reservationRows("variant-late")).toHaveLength(1);
  }, 180_000);

  it("refuses a reservation cohort beyond four before calling the native mutation", async () => {
    const before = await local.snapshot(), native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const exit = await Effect.runPromiseExit(run("variant-overflow"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("does not oversell when two Line Items share one inventory level", async () => {
    const before = await local.snapshot(), exit = await Effect.runPromiseExit(run("variant-shared-stock"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Not enough stock available");
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);

  it("executes the retained native reservation inverse, rolls it back on late failure and replays physical deletion", async () => {
    const forward = await prepareCheckoutInventoryInverse(local, "forward", release => cleanup.push(release));
    const inverse = await prepareCheckoutInventoryInverse(local, "inverse", release => cleanup.push(release));
    const late = await prepareCheckoutInventoryInverse(local, "late", release => cleanup.push(release));
    const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.Struct({ id: Schema.String })),
      retained: Schema.JsonObject }))(await Effect.runPromise(forward.run(forward.newRequestKey(), { items: [{ id: "retained-checkout-line",
      inventory_item_id: "iitem-variant-inverse", required_quantity: 3, quantity: 1.25, allow_backorder: false,
      location_ids: ["sloc-variant-inverse"] }] })));
    expect(result.output).toHaveLength(1);
    const before = await local.snapshot(), failed = await Effect.runPromiseExit(late.run(late.newRequestKey(), result.retained));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Late failure after native reservation inverse");
    expect(await local.snapshot()).toEqual(before);
    const key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
    const rows = await local.rows(), after = await local.snapshot();
    expect(rows.some(row => row.id === result.output[0]?.id)).toBe(false);
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-inverse-0")?.reserved_quantity), "0")).toBe(true);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
  }, 180_000);

  it("serializes competing completion of one Cart without duplicate Orders or Reservations", async () => {
    const ids = selected("variant-concurrent"), before = await local.snapshot(), keys = [local.host.newRequestKey(), local.host.newRequestKey()];
    const outcomes = await Promise.all(keys.map(key => Effect.runPromiseExit(local.host.run(key, { id: ids.cartId }))));
    const successful = outcomes.filter(Exit.isSuccess), placed = successful[0]?.value;
    expect(successful.length).toBeGreaterThanOrEqual(1);
    if (placed === undefined) throw new Error("Neither competing inventory checkout placed an Order");
    for (const outcome of outcomes) {
      if (Exit.isSuccess(outcome)) expect(outcome.value).toEqual(placed);
      else { expect(driver).toBe("postgres"); expectCheckoutContention(outcome.cause); }
    }
    for (const key of keys) expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(placed);
    expect(await reservationRows("variant-concurrent")).toHaveLength(1);
    const after = await local.snapshot();
    expect(after.events.filter(row => row.envelope.contract === "order.placed").length - before.events.filter(row => row.envelope.contract === "order.placed").length).toBe(1);
  }, 180_000);

  it("allows only one of two Carts to claim the last stock and preserves both original request identities", async () => {
    const names = ["variant-competing-a", "variant-competing-b"], keys = names.map(() => local.host.newRequestKey());
    const outcomes = await Promise.all(names.map((name, index) => Effect.runPromiseExit(local.host.run(keys[index]!, { id: selected(name).cartId }))));
    expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
    for (const [index, outcome] of outcomes.entries()) {
      const name = names[index], key = keys[index];
      if (name === undefined || key === undefined) throw new Error("Missing competing stock request identity");
      if (Exit.isFailure(outcome) && !Cause.pretty(outcome.cause).includes("Not enough stock available")) {
        expect(driver).toBe("postgres"); expectCheckoutContention(outcome.cause);
      }
      const retry = await Effect.runPromiseExit(local.host.run(key, { id: selected(name).cartId }));
      if (Exit.isSuccess(outcome)) expect(retry).toEqual(outcome);
      else {
        expect(Exit.isFailure(retry)).toBe(true);
        if (Exit.isFailure(retry)) {
          // Native checkout retains the expected stock error; the sole outer
          // lifetime adds its rollback-only seal failure before refusing commit.
          expect(retry.cause.reasons, Cause.pretty(retry.cause)).toHaveLength(2);
          const [first, second] = retry.cause.reasons;
          if (first === undefined || second === undefined || !Cause.isFailReason(first) || !Cause.isFailReason(second))
            throw new Error("Stock refusal contains a defect or interruption", { cause: retry.cause });
          expect([first.error, second.error]).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: "rollbackOnly" }),
            expect.objectContaining({ reason: "adapterFailure", cause: expect.objectContaining({
              type: "not_allowed", message: expect.stringContaining("Not enough stock available"),
            }) }),
          ]));
        }
      }
    }
    const rows = await local.rows();
    expect(rows.filter(row => row.inventory_item_id === "iitem-variant-competing-a" && typeof row.line_item_id === "string")).toHaveLength(1);
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-competing-a-0")?.reserved_quantity), "2")).toBe(true);
  }, 180_000);
});
