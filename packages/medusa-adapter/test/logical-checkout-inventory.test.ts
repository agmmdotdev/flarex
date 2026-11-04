import { Cause, Deferred, Effect, Exit, Option, Schema, Tracer } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CartModuleService } from "@medusajs/cart/services";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { PaymentModuleService } from "@medusajs/payment/services";
import { MathBN } from "@medusajs/framework/utils/portable";
import { prepareCoreCheckout } from "./support/core-checkout-fixture";
import { checkoutInventoryData } from "./support/checkout-inventory-data";
import { prepareCheckoutInventoryInverse } from "./support/checkout-inventory-inverse";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const text = Schema.decodeUnknownSync(Schema.String);

function expectNativeStockRefusal(cause: Cause.Cause<unknown>) {
  // Native checkout retains the stock error and its owning rollback-only seal.
  expect(cause.reasons, Cause.pretty(cause)).toHaveLength(2);
  const [first, second] = cause.reasons;
  if (first === undefined || second === undefined || !Cause.isFailReason(first) || !Cause.isFailReason(second))
    throw new Error("Stock refusal contains a defect or interruption", { cause });
  expect([first.error, second.error]).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: "rollbackOnly" }),
    expect.objectContaining({ reason: "adapterFailure", cause: expect.objectContaining({
      type: "not_allowed", message: expect.stringContaining("Not enough stock available"),
    }) }),
  ]));
}

describe("native Product and Inventory checkout on " + driver, () => {
  const cleanup: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareCoreCheckout>>;
  let lastPhase = "not started";
  beforeAll(async () => {
    const data = checkoutInventoryData();
    local = await prepareCoreCheckout(driver, release => cleanup.push(release), {
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
  const run = (name: string, key = local.host.newRequestKey()) => local.host.run(key, { id: selected(name).cartId });
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
    const timestamp = expectCheckoutSettlement(before, after, key);
    const inventory = local.fixture.source("inventory");
    const reservationTable = local.fixture.sources.find(source => source.source === inventory)
      ?.definition.tables.find(table => table.localName === "reservation_item");
    const lineItemIndex = reservationTable?.indexes?.find(index => index.nativeId === "reservation-item.line-item-equality");
    const revision = after.revisions.find(row => row.table === reservationTable?.name && row.value?.id === reservations[0]?.id);
    if (reservationTable === undefined || lineItemIndex === undefined || revision === undefined)
      throw new Error("Missing genuine reservation index or its settled document revision");
    const reservationIndexEntries = (snapshot: typeof after) => snapshot.indexes.filter(entry =>
      entry.table === reservationTable.name && entry.name === lineItemIndex.indexName && entry.id === revision.id);
    expect(reservationIndexEntries(before)).toEqual([]);
    // This is the revision reached through the index at the snapshot, not a physical write timestamp.
    expect(reservationIndexEntries(after)).toMatchObject([{ timestamp }]);
    expect(after.events.filter(row => row.envelope.contract === "order.placed").length - before.events.filter(row => row.envelope.contract === "order.placed").length).toBe(1);
    expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(run("variant-available"))).toEqual(result);
    expect(await reservationRows("variant-available")).toEqual(reservations);
  }, 180_000);

  it("runs genuine native insufficient-stock and channel validation and publishes no failed checkout", async () => {
    for (const [name, message] of [["variant-insufficient", "Not enough stock available"], ["variant-channel", "not associated with any stock location"]] as const) {
      const before = await local.fixture.inventory(), key = local.host.newRequestKey();
      const exit = await Effect.runPromiseExit(run(name, key));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(message);
      await expectCheckoutRollback(local.fixture, before, key);
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
    const ids = selected("variant-late"), before = await local.fixture.inventory(), key = local.host.newRequestKey();
    const original = PaymentModuleService.prototype.authorizePaymentSession;
    let reserved = false, authorized = false;
    const reserve = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    const payment = vi.spyOn(PaymentModuleService.prototype, "authorizePaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await original.apply(this, args);
      if (args[0] === ids.sessionId) { reserved = reserve.mock.calls.length === 1; authorized = true; throw new Error("Late Inventory checkout authorization failure"); }
      return result;
    });
    try {
      const exit = await Effect.runPromiseExit(run("variant-late", key));
      expect({ reserved, authorized }).toEqual({ reserved: true, authorized: true });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Inventory checkout authorization failure");
    } finally { reserve.mockRestore(); payment.mockRestore(); }
    await expectCheckoutRollback(local.fixture, before, key);
    await Effect.runPromise(run("variant-late"));
    expect(await reservationRows("variant-late")).toHaveLength(1);
  }, 180_000);

  it("refuses a reservation cohort beyond four before calling the native mutation", async () => {
    const before = await local.fixture.inventory(), key = local.host.newRequestKey();
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems");
    try {
      const exit = await Effect.runPromiseExit(run("variant-overflow", key));
      if (Exit.isSuccess(exit)) throw new Error("Checkout accepted five reservations");
      const failures = exit.cause.reasons.map(reason => {
        if (!Cause.isFailReason(reason)) throw new Error("Reservation bound failed with a defect or interruption", { cause: exit.cause });
        return reason.error;
      });
      expect(failures.map(failure => failure.reason).toSorted(), Cause.pretty(exit.cause)).toEqual(["invalidInput", "rollbackOnly"]);
      const refusal = failures.find(failure => failure.reason === "invalidInput");
      if (!Schema.isSchemaError(refusal?.cause)) throw new Error("Expected checkout's reservation argument decoder to reject the cohort", { cause: exit.cause });
      expect(refusal.cause.message).toContain("a value with a length of at most 4");
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
    await expectCheckoutRollback(local.fixture, before, key);
  }, 180_000);

  it("does not oversell when two Line Items share one inventory level", async () => {
    const before = await local.fixture.inventory(), key = local.host.newRequestKey();
    const exit = await Effect.runPromiseExit(run("variant-shared-stock", key));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Not enough stock available");
    await expectCheckoutRollback(local.fixture, before, key);
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
    const beforeFailure = await local.fixture.inventory(), failedKey = late.newRequestKey();
    const failed = await Effect.runPromiseExit(late.run(failedKey, result.retained));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Late failure after native reservation inverse");
    await expectCheckoutRollback(local.fixture, beforeFailure, failedKey);
    const before = await local.snapshot(), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
    const rows = await local.rows(), after = await local.snapshot();
    expect(rows.some(row => row.id === result.output[0]?.id)).toBe(false);
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-inverse-0")?.reserved_quantity), "0")).toBe(true);
    expectCheckoutSettlement(before, after, key);
    expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
  }, 180_000);

  it("serializes competing completion of one Cart without duplicate Orders or Reservations", async () => {
    const name = "variant-concurrent", before = await local.snapshot();
    const firstKey = local.host.newRequestKey(), secondKey = local.host.newRequestKey();
    const entered = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const waiting = Deferred.makeUnsafe<Tracer.Span>();
    let acquireCount = 0, namespaceAcquire: Tracer.Span | undefined;
    const tracer = Tracer.make({ span: options => {
      const span = new Tracer.NativeSpan(options), parent = Option.getOrUndefined(options.parent);
      if (options.name === "CoreSettlementLock.acquire" && parent?._tag === "Span" && parent.name === "CoreNativeScopeExclusion.beforeDeadline") {
        // The scope owner takes the global shared grant before the namespace writer.
        if (++acquireCount === 2) namespaceAcquire = span;
      }
      const acquire = namespaceAcquire;
      if (options.name === "CoreSettlementLock.pump" && acquire !== undefined && parent === acquire) {
        const end = span.end.bind(span);
        span.end = (time, exit) => {
          end(time, exit);
          if (Exit.isSuccess(exit)) Deferred.doneUnsafe(waiting, Effect.succeed(acquire));
        };
      }
      return span;
    } });
    const cartRead = vi.spyOn(CartModuleService.prototype, "listAndCountCarts");
    const original = InventoryModuleService.prototype.createReservationItems;
    let reservationCalls = 0;
    const native = vi.spyOn(InventoryModuleService.prototype, "createReservationItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const first = ++reservationCalls === 1, result = await original.apply(this, args);
      if (first) {
        await Effect.runPromise(Deferred.succeed(entered, undefined));
        await Effect.runPromise(Deferred.await(release));
      }
      return result;
    });
    const first = Effect.runPromiseExit(run(name, firstKey));
    let second: typeof first | undefined;
    try {
      await Effect.runPromise(Deferred.await(entered).pipe(Effect.timeout(10_000)));
      const reads = cartRead.mock.calls.length;
      second = Effect.runPromiseExit(run(name, secondKey).pipe(Effect.provideService(Tracer.Tracer, tracer)));
      // Wait for the real namespace queue pump. With the first native callback
      // held, the second acquire must still be pending before its Cart read.
      const acquire = await Effect.runPromise(Deferred.await(waiting).pipe(Effect.timeout(10_000)));
      expect(acquire.status._tag).toBe("Started");
      expect(cartRead).toHaveBeenCalledTimes(reads);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const [winner, repeated] = await Promise.all([first, second]);
      if (Exit.isFailure(winner)) throw new Error("First competing inventory checkout failed", { cause: winner.cause });
      if (Exit.isFailure(repeated)) throw new Error("Second competing inventory checkout failed", { cause: repeated.cause });
      expect(repeated.value).toEqual(winner.value);
      expect(acquire.status._tag).toBe("Ended");
      expect(native).toHaveBeenCalledTimes(1);
      for (const key of [firstKey, secondKey]) expect(await Effect.runPromise(run(name, key))).toEqual(winner.value);
      expect(await reservationRows(name)).toHaveLength(1);
      const after = await local.snapshot();
      expect(after.events.filter(row => row.envelope.contract === "order.placed").length - before.events.filter(row => row.envelope.contract === "order.placed").length).toBe(1);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Promise.all([first, second]);
      native.mockRestore();
      cartRead.mockRestore();
    }
  }, 180_000);

  it("allows only one of two Carts to claim the last stock and preserves both original request identities", async () => {
    const names = ["variant-competing-a", "variant-competing-b"];
    const attempts = await Promise.all(names.map(async name => {
      const key = local.host.newRequestKey();
      return { name, key, outcome: await Effect.runPromiseExit(run(name, key)) };
    }));
    expect(attempts.filter(attempt => Exit.isSuccess(attempt.outcome))).toHaveLength(1);
    const beforeRetry = await local.fixture.inventory();
    for (const { name, key, outcome } of attempts) {
      if (Exit.isFailure(outcome)) {
        expectNativeStockRefusal(outcome.cause);
        expect(beforeRetry.outcomes.filter(record => record.value.key === key)).toMatchObject([
          { value: { key, kind: "nativeRoot", state: "failed" } },
        ]);
      }
      const retry = await Effect.runPromiseExit(run(name, key));
      if (Exit.isSuccess(outcome)) expect(retry).toEqual(outcome);
      else {
        if (Exit.isSuccess(retry)) throw new Error("Competing Cart acquired stock on retry");
        expectNativeStockRefusal(retry.cause);
        await expectCheckoutRollback(local.fixture, { ...beforeRetry,
          outcomes: beforeRetry.outcomes.filter(record => record.value.key !== key) }, key);
      }
    }
    const rows = await local.rows();
    expect(rows.filter(row => row.inventory_item_id === "iitem-variant-competing-a" && typeof row.line_item_id === "string")).toHaveLength(1);
    expect(MathBN.eq(text(rows.find(row => row.id === "ilev-variant-competing-a-0")?.reserved_quantity), "2")).toBe(true);
  }, 180_000);
});
