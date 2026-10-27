import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prepareLogicalOrderCheckout } from "./support/logical-order-checkout-fixture";
import * as creationReceipt from "../src/modules/order/creation-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let local: Awaited<ReturnType<typeof prepareLogicalOrderCheckout>>;
const packets: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
const original = creationReceipt.validateCheckoutOrderCreation;
beforeAll(async () => {
  vi.spyOn(creationReceipt, "validateCheckoutOrderCreation").mockImplementation(prepared => {
    const validate = original(prepared);
    return Effect.fn("CheckoutAddress.observeNativeReceipt")(function* (call, activity) {
      yield* validate(call, activity); packets.push(structuredClone({ call, activity }));
    });
  });
  local = await prepareLogicalOrderCheckout(driver, release => cleanup.push(release), [
    { table: "order_address", row: { id: "ordaddr-checkout-native-inverse", first_name: "Checkout", country_code: "us" } },
    { table: "order", row: { id: "order-checkout-native-address-inverse", display_id: 401, currency_code: "usd",
      shipping_address_id: "ordaddr-checkout-native-inverse", status: "pending" } },
    { table: "order_address", row: { id: "ordaddr-checkout-shared-inverse", city: "Shared" } },
    ...[402, 403].map(display_id => ({ table: "order", row: { id: "order-checkout-shared-" + display_id, display_id,
      currency_code: "usd", billing_address_id: "ordaddr-checkout-shared-inverse", status: "pending" } })),
  ]);
}, 240_000);
afterAll(async () => { vi.restoreAllMocks(); for (const release of cleanup.reverse()) await release(); }, 120_000);

it("deletes an Order and its owning Address through the genuine native inverse with FK enforcement", async () => {
  const inverse = await local.remove();
  const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ["order-checkout-native-address-inverse"]));
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  expect(exit.value).toBeNull();
  expect(await local.read(["order-checkout-native-address-inverse", "ordaddr-checkout-native-inverse"])).toEqual([]);
}, 180_000);

it("creates independent native billing/shipping copies, retains their IDs and deletes them through the genuine inverse", async () => {
  const forward = await local.retainedCreation(), inverse = await local.retainedCreation(true);
  const address = { first_name: "Copied", address_1: "1 Main Street", country_code: "us", metadata: { nested: { retain: true } },
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z", deleted_at: null };
  const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), retained: Schema.Array(Schema.String) }))(
    await Effect.runPromise(forward.run(forward.newRequestKey(), [{ currency_code: "usd", customer_id: "cus-existing",
      shipping_address: address, billing_address: address,
      items: [{ title: "Address inverse", quantity: 1, unit_price: "12.5", requires_shipping: false }] }])));
  const order = result.output[0];
  expect(order).toMatchObject({ customer_id: "cus-existing", shipping_address: address, billing_address: address });
  const copyIds = Schema.decodeUnknownSync(Schema.Array(Schema.String))([order?.shipping_address_id, order?.billing_address_id]);
  expect(new Set(copyIds).size).toBe(2);
  expect(await local.read(copyIds)).toHaveLength(2);
  const before = await local.snapshot(), key = inverse.newRequestKey();
  expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
  expect(await local.read([...copyIds, ...result.retained])).toEqual([]);
  const after = await local.snapshot();
  expect(after.rowChanges.length - before.rowChanges.length).toBe(6);
  expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
  expect(await local.snapshot()).toEqual(after);
}, 180_000);

it("retains NO ACTION enforcement when another Order references an Address selected for deletion", async () => {
  const inverse = await local.remove(), before = await local.snapshot();
  const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ["order-checkout-shared-402"]));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.findErrorOption(exit.cause))
    .toMatchObject({ _tag: "Some", value: { reason: "invalidInput" } });
  // The genuine native cleanup and its complete receipt succeeded. Refusal
  // occurs at trusted settlement, which maps FK documentInvalid to invalidInput.
  const accepted = packets.find(packet => packet.call.commandName === "orderDeleteForCheckout" &&
    Array.isArray(packet.call.input) && packet.call.input.includes("order-checkout-shared-402"));
  expect(accepted?.activity.mutations.map(row => row.table)).toEqual(["order_address", "order"]);
  expect(await local.snapshot()).toEqual(before);
  expect(await local.read(["ordaddr-checkout-shared-inverse", "order-checkout-shared-402", "order-checkout-shared-403"])).toHaveLength(3);
}, 180_000);

it("refuses forged native Address copies, slot identities, missing reads and changed cleanup order", async () => {
  const creation = packets.find(packet => packet.call.commandName === "orderCreateForCheckout");
  const deletion = packets.find(packet => packet.call.commandName === "orderDeleteForCheckout" &&
    packet.activity.mutations.filter(row => row.table === "order_address").length === 2);
  if (creation === undefined || deletion === undefined) throw new Error("Missing populated native Address receipts");
  const validate = original(local.order.prepared);
  for (const packet of [creation, deletion]) await Effect.runPromise(validate(packet.call, packet.activity));
  const { call, activity } = creation;
  const mutants = [
    { call, activity: { ...activity, relationalReads: activity.relationalReads.slice(1) } },
    { call: { ...call, events: call.events.slice(1) }, activity },
    { call, activity: { ...activity, mutations: activity.mutations.map(row => row.table === "order_address" && row.after !== null
      ? { ...row, after: { ...row.after, city: "forged" } } : row) } },
    { call, activity: { ...activity, mutations: activity.mutations.map(row => row.table === "order_address" && row.after !== null
      ? { ...row, after: { ...row.after, updated_at: "2026-03-01T00:00:00.000Z" } } : row) } },
    { call, activity: { ...activity, mutations: activity.mutations.map(row => row.table === "order" && row.after !== null
      ? { ...row, after: { ...row.after, billing_address_id: row.after.shipping_address_id ?? null } } : row) } },
    { call: deletion.call, activity: { ...deletion.activity, mutations: [...deletion.activity.mutations].reverse().map((row, ordinal) => ({ ...row, ordinal })) } },
    { call: deletion.call, activity: { ...deletion.activity, relationalReads: deletion.activity.relationalReads.filter(row => row.table !== "order_address") } },
  ];
  for (const packet of mutants) expect(await Effect.runPromise(Effect.result(validate(packet.call, packet.activity))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
});
