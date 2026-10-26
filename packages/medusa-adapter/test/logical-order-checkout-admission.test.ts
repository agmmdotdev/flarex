import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareLogicalOrderCheckout } from "./support/logical-order-checkout-fixture";
import type { CheckoutOrderCreates } from "../src/modules/order/creation-input";
import * as creationReceipt from "../src/modules/order/creation-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const input: typeof CheckoutOrderCreates.Type = [{ currency_code: "usd", items: [{ title: "Digital checkout item", quantity: 2, unit_price: "3.125", requires_shipping: false }] }];
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), id = Schema.decodeUnknownSync(Schema.String);

describe("native Order checkout participant admission", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalOrderCheckout>>;
  const packets: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const original = creationReceipt.validateCheckoutOrderCreation;
  beforeAll(async () => {
    vi.spyOn(creationReceipt, "validateCheckoutOrderCreation").mockImplementation(prepared => {
      const validate = original(prepared);
      return Effect.fn("OrderCheckout.observeActualReceipt")(function* (call, activity) {
        packets.push(structuredClone({ call, activity }));
        yield* validate(call, activity);
      });
    });
    local = await prepareLogicalOrderCheckout(driver, close => cleanup.push(close));
  }, 240_000);
  afterEach(async () => { await local.closeHosts(); }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const close of cleanup.reverse()) await close(); }, 120_000);
  it("authenticates native creation, committed module events and reopened-host replay", async () => {
    const host = await local.create("create"), key = host.newRequestKey(), before = await local.snapshot();
    const created = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    expect(created).toMatchObject([{ display_id: 401, items: [{ quantity: 2, unit_price: 3.125 }], summary: { current_order_total: 6.25 } }]);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.rows.length - before.rows.length).toBe(4);
    expect(after.events.length - before.events.length).toBe(4);
    await Effect.runPromise(host.close);
    const reopened = await local.create("create");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(created);
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);
  it("uses the same Order owner for creation and native capture accounting", async () => {
    const host = await local.create("account"), created = await Effect.runPromise(host.run(host.newRequestKey(), input));
    expect(created).toMatchObject([{ total: 6.25, summary: { paid_total: 2.5, transaction_total: 2.5, pending_difference: 3.75 } }]);
  }, 240_000);
  it("preserves default request-call refusal and atomic rollback for the larger accounting composition", async () => {
    const host = await local.create("account-default"), before = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
  it("refuses changes to actual native creation fields, reads, defaults, output and events", async () => {
    const packet = packets.find(packet => packet.call.commandName === "orderCreateForCheckout");
    if (packet === undefined) throw new Error("Missing actual native creation receipt");
    const validate = original(local.order.prepared), { call, activity } = packet;
    await Effect.runPromise(validate(call, activity));
    const mutants: typeof packets = [
      { call: { ...call, result: [] }, activity },
      { call: { ...call, events: call.events.slice(1) }, activity },
      { call, activity: { ...activity, relationalReads: activity.relationalReads.slice(1) } },
      { call, activity: { ...activity, mutations: activity.mutations.map(row => row.table === "order" && row.after !== null
        ? { ...row, after: { ...row.after, currency_code: "eur" } } : row) } },
      { call, activity: { ...activity, mutations: activity.mutations.map(row => row.table === "order_item" && row.after !== null
        ? { ...row, after: { ...row.after, fulfilled_quantity: "1", raw_fulfilled_quantity: { value: "1", precision: 20 } } } : row) } },
      { call, activity: { ...activity, mutations: activity.mutations.slice(1) } },
    ];
    for (const mutant of mutants) expect(await Effect.runPromise(Effect.result(validate(mutant.call, mutant.activity))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
  it("authenticates the complete native public deletion and its module events", async () => {
    const create = await local.create("create"), created = rows(await Effect.runPromise(create.run(create.newRequestKey(), input)));
    const orderId = id(created[0]?.id), remove = await local.remove(), before = await local.snapshot();
    expect(await Effect.runPromise(remove.run(remove.newRequestKey(), [orderId]))).toBeNull();
    expect(await local.read([orderId])).toEqual([]);
    const after = await local.snapshot();
    expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
    expect(after.events.length - before.events.length).toBe(2);
  }, 240_000);
  it("publishes no Order, child rows or events after a late failure", async () => {
    const host = await local.create("late"), before = await local.snapshot(), exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late failure after admitted native Order creation");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
  it.each(["shipping", "item"])("refuses deletion with a hidden historical %s wrapper and preserves its standalone row", async kind => {
    const remove = await local.remove(), before = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(remove.run(remove.newRequestKey(), ["order-checkout-hidden-" + kind]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
});
