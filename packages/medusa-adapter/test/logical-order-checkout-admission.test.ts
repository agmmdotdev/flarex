import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prepareCoreOrderCheckout } from "./support/core-order-checkout-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import type { CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";
import type { CheckoutOrderCreates } from "../src/modules/order/creation-input";
import * as creationReceipt from "../src/modules/order/creation-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const input: typeof CheckoutOrderCreates.Type = [{ currency_code: "usd", items: [{ title: "Digital checkout item", quantity: 2, unit_price: "3.125", requires_shipping: false }] }];
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), id = Schema.decodeUnknownSync(Schema.String);
type CheckoutFixture = Awaited<ReturnType<typeof prepareCoreOrderCheckout>>;

function checkoutWrite(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string) {
  const outcome = after.outcomes.find(record => record.value.key === key);
  if (outcome === undefined) throw new Error("Missing committed checkout Order outcome");
  expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
  expect(after.outcomes.length - before.outcomes.length).toBe(1);
  const revisions = after.revisions.filter(row => row.timestamp === outcome.timestamp);
  expect(after.revisions.length - before.revisions.length).toBe(revisions.length);
  const events = after.events.filter(event => event.timestamp === outcome.timestamp);
  expect(after.events.length - before.events.length).toBe(events.length);
  return { revisions, events };
}

describe("native Order checkout participant admission", () => {
  let local: CheckoutFixture;
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
    local = await prepareCoreOrderCheckout(driver, close => cleanup.push(close));
  }, 240_000);
  afterEach(async () => { await local.closeHosts(); }, 120_000);
  afterAll(() => { vi.restoreAllMocks(); return finishOrderFixture(cleanup.reverse()); }, 120_000);
  it("authenticates native creation, committed module events and reopened-host replay", async () => {
    const host = await local.create("create"), key = host.newRequestKey(), before = await local.snapshot();
    const created = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    expect(created).toMatchObject([{ display_id: 401, items: [{ quantity: 2, unit_price: 3.125 }], summary: { current_order_total: 6.25 } }]);
    const { revisions, events } = checkoutWrite(before, after, key);
    expect(after.rows.length - before.rows.length).toBe(4);
    expect(revisions.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort())
      .toEqual(["order", "order_item", "order_line_item", "order_summary"]);
    for (const revision of revisions) {
      expect(revision).toMatchObject({ previous: null, deleted: false });
      expect(after.rows).toContainEqual({ table: revision.table, timestamp: revision.timestamp, value: revision.value });
      expect(after.indexes).toContainEqual(expect.objectContaining({ table: revision.table, name: "by_id", id: revision.id,
        timestamp: revision.timestamp }));
    }
    expect(events.map(event => event.envelope.contract)).toEqual([
      "order.order.created", "order.order-summary.created", "order.order-line-item.created", "order.order-item.created",
    ]);
    const acceptedCalls = packets.length;
    await Effect.runPromise(host.close);
    const reopened = await local.create("create");
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(created);
    expect(await local.snapshot()).toEqual(after);
    expect(packets).toHaveLength(acceptedCalls);
  }, 240_000);
  it("uses the same Order owner for creation and native capture accounting", async () => {
    const host = await local.create("account"), key = host.newRequestKey(), before = await local.snapshot();
    const created = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    expect(created).toMatchObject([{ total: 6.25, summary: { paid_total: 2.5, transaction_total: 2.5, pending_difference: 3.75 } }]);
    const orderId = id(created[0]?.id), { revisions } = checkoutWrite(before, after, key);
    expect(revisions.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort())
      .toEqual(["order", "order_item", "order_line_item", "order_summary", "order_transaction"]);
    const tableName = (name: string) => local.definition.tables.find(table => table.localName === name)?.name;
    expect(revisions.find(row => row.table === tableName("order_transaction"))?.value)
      .toMatchObject({ order_id: orderId, reference: "capture", reference_id: "capture-checkout", version: 1 });
    expect(revisions.find(row => row.table === tableName("order_summary"))?.value)
      .toMatchObject({ order_id: orderId });
  }, 240_000);
  it("preserves default request-call refusal and atomic rollback for the larger accounting composition", async () => {
    const host = await local.create("account-default"), before = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
  it("refuses changes to actual native creation fields, reads, defaults, output and events", async () => {
    const offset = packets.length, create = await local.create("create");
    await Effect.runPromise(create.run(create.newRequestKey(), input));
    const packet = packets.slice(offset).find(packet => packet.call.commandName === "orderCreateForCheckout");
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
  }, 240_000);
  it("authenticates the complete native public deletion and its module events", async () => {
    const create = await local.create("create"), created = rows(await Effect.runPromise(create.run(create.newRequestKey(), input)));
    const orderId = id(created[0]?.id), remove = await local.remove(), before = await local.snapshot(), key = remove.newRequestKey();
    expect(await Effect.runPromise(remove.run(key, [orderId]))).toBeNull();
    expect(await local.read([orderId])).toEqual([]);
    const after = await local.snapshot();
    const { revisions, events } = checkoutWrite(before, after, key);
    expect(revisions.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort())
      .toEqual(["order", "order_item", "order_line_item", "order_summary"]);
    for (const revision of revisions) {
      expect(revision).toMatchObject({ deleted: true, value: null });
      expect(before.indexes).toContainEqual(expect.objectContaining({ table: revision.table, name: "by_id", id: revision.id,
        timestamp: revision.previous }));
      expect(after.indexes.some(row => row.table === revision.table && row.id === revision.id)).toBe(false);
    }
    expect(events.map(event => event.envelope.contract)).toEqual(["order.order.deleted", "order.order-line-item.deleted"]);
  }, 240_000);
  it("creates populated native checkout families and deletes both standalone child graphs without residue", async () => {
    const populated: typeof CheckoutOrderCreates.Type = [{ currency_code: "usd", email: "checkout@example.invalid",
      billing_address: { city: "Yangon", country_code: "mm" }, shipping_address: { city: "Yangon", country_code: "mm" },
      items: [{ title: "Shipped checkout item", quantity: 2, unit_price: "10", requires_shipping: true,
        tax_lines: [{ code: "VAT", rate: "10" }], adjustments: [{ code: "SAVE", amount: "2", promotion_id: "promo-checkout" }] }],
      shipping_methods: [{ name: "Standard", amount: "5", tax_lines: [{ code: "VAT", rate: "10" }],
        adjustments: [{ code: "SHIP", amount: "1", promotion_id: "promo-shipping" }] }],
      credit_lines: [{ amount: 1, raw_amount: { value: "1", precision: 20 }, reference: "credit", reference_id: "checkout-credit" }],
      promo_codes: ["SAVE", "SHIP"],
    }];
    const ordinary = await local.create("create"), before = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(ordinary.run(ordinary.newRequestKey(), populated))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(await local.snapshot()).toEqual(before);
    const late = await local.create("populated-late"), lateExit = await Effect.runPromiseExit(late.run(late.newRequestKey(), populated));
    expect(Exit.isFailure(lateExit)).toBe(true);
    if (Exit.isFailure(lateExit)) expect(Cause.pretty(lateExit.cause)).toContain("Late failure after admitted native Order creation");
    expect(await local.snapshot()).toEqual(before);
    const packetOffset = packets.length, host = await local.create("populated"), key = host.newRequestKey();
    const creation = await Effect.runPromiseExit(host.run(key, populated));
    if (Exit.isFailure(creation)) throw new Error(Cause.pretty(creation.cause) + "\n" + JSON.stringify(creation.cause));
    const created = rows(creation.value), after = await local.snapshot(), orderId = id(created[0]?.id);
    expect(created).toMatchObject([{ status: "pending", shipping_address: { city: "Yangon" }, billing_address: { city: "Yangon" },
      items: [{ quantity: 2, requires_shipping: true, tax_lines: [{ code: "VAT", rate: 10 }], adjustments: [{ amount: 2, code: "SAVE" }], detail: { quantity: 2 } }],
      shipping_methods: [{ amount: 5, tax_lines: [{ code: "VAT", rate: 10 }], adjustments: [{ amount: 1, code: "SHIP" }] }],
      credit_lines: [{ amount: 1, reference_id: "checkout-credit" }] }]);
    const writes = checkoutWrite(before, after, key), names = writes.revisions.map(row => local.definition.tables.find(table => table.name === row.table)?.localName);
    expect(names.sort()).toEqual(["order", "order_address", "order_address", "order_credit_line", "order_item", "order_line_item",
      "order_line_item_adjustment", "order_line_item_tax_line", "order_shipping", "order_shipping_method", "order_shipping_method_adjustment",
      "order_shipping_method_tax_line", "order_summary"].sort());
    const packet = packets.slice(packetOffset).find(value => value.call.commandName === "orderCreateForCheckout");
    if (packet === undefined) throw new Error("Missing actual populated native creation receipt");
    const validate = original(local.order.prepared);
    for (const table of ["order_line_item_tax_line", "order_line_item_adjustment", "order_shipping_method_tax_line", "order_shipping_method_adjustment", "order_credit_line"]) {
      const field = table.endsWith("tax_line") ? "rate" : "amount";
      const mutations = packet.activity.mutations.map(mutation => mutation.table === table && mutation.after !== null
        ? { ...mutation, after: { ...mutation.after, [field]: "999", ["raw_" + field]: { value: "999", precision: 20 } } } : mutation);
      expect(await Effect.runPromise(Effect.result(validate(packet.call, { ...packet.activity, mutations }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
    const remove = await local.remove("populated"), removeKey = remove.newRequestKey();
    const removal = await Effect.runPromiseExit(remove.run(removeKey, [orderId]));
    if (Exit.isFailure(removal)) throw new Error(Cause.pretty(removal.cause) + "\n" + JSON.stringify(removal.cause));
    expect(removal.value).toBeNull();
    const deleted = await local.snapshot(), inverse = checkoutWrite(after, deleted, removeKey);
    expect(inverse.revisions.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort()).toEqual(names);
    expect(inverse.revisions.every(row => row.deleted && row.value === null)).toBe(true);
    expect(deleted.rows).toEqual(before.rows);
    expect(inverse.events.map(event => event.envelope.contract)).toEqual(["order.order-address.deleted", "order.order-address.deleted",
      "order.order.deleted", "order.order-line-item.deleted", "order.order-shipping-method.deleted"]);
    const deletion = packets.slice(packetOffset).find(value => value.call.commandName === "orderDeleteForCheckout");
    if (deletion === undefined) throw new Error("Missing actual populated native deletion receipt");
    expect(await Effect.runPromise(Effect.result(validate(deletion.call, { ...deletion.activity,
      mutations: deletion.activity.mutations.filter(mutation => mutation.table !== "order_shipping_method_tax_line")
        .map((mutation, ordinal) => ({ ...mutation, ordinal })) }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
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
