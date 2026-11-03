import { Cause, Effect, Exit, Schema } from "effect";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { prepareCoreOrderCheckout } from "./support/core-order-checkout-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";
import { CoreNativeForeignKeyError } from "../../persistence-postgres/src/core/api";
import * as creationReceipt from "../src/modules/order/creation-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let local: Awaited<ReturnType<typeof prepareCoreOrderCheckout>>;
const packets: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
const original = creationReceipt.validateCheckoutOrderCreation;
const copiedAddress = { first_name: "Copied", address_1: "1 Main Street", country_code: "us", metadata: { nested: { retain: true } },
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-02-01T00:00:00.000Z", deleted_at: null };

async function createOrderWithCopiedAddresses() {
  const forward = await local.retainedCreate();
  return Effect.runPromise(forward.run(forward.newRequestKey(), [{ currency_code: "usd", customer_id: "cus-existing",
    shipping_address: copiedAddress, billing_address: copiedAddress,
    items: [{ title: "Address inverse", quantity: 1, unit_price: "12.5", requires_shipping: false }] }]));
}

beforeAll(async () => {
  vi.spyOn(creationReceipt, "validateCheckoutOrderCreation").mockImplementation(prepared => {
    const validate = original(prepared);
    return Effect.fn("CheckoutAddress.observeNativeReceipt")(function* (call, activity) {
      yield* validate(call, activity); packets.push(structuredClone({ call, activity }));
    });
  });
  local = await prepareCoreOrderCheckout(driver, release => cleanup.push(release), [
    { table: "order_address", row: { id: "ordaddr-checkout-native-inverse", first_name: "Checkout", country_code: "us" } },
    { table: "order", row: { id: "order-checkout-native-address-inverse", display_id: 401, currency_code: "usd",
      shipping_address_id: "ordaddr-checkout-native-inverse", status: "pending" } },
    { table: "order_address", row: { id: "ordaddr-checkout-shared-inverse", city: "Shared" } },
    ...[402, 403].map(display_id => ({ table: "order", row: { id: "order-checkout-shared-" + display_id, display_id,
      currency_code: "usd", billing_address_id: "ordaddr-checkout-shared-inverse", status: "pending" } })),
  ]);
}, 240_000);
afterAll(() => { vi.restoreAllMocks(); return finishOrderFixture(cleanup.reverse()); }, 120_000);

it("deletes an Order and its owning Address through the genuine native inverse with FK enforcement", async () => {
  const inverse = await local.remove();
  const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ["order-checkout-native-address-inverse"]));
  if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause));
  expect(exit.value).toBeNull();
  expect(await local.read(["order-checkout-native-address-inverse", "ordaddr-checkout-native-inverse"])).toEqual([]);
}, 180_000);

it("creates independent native billing/shipping copies, retains their IDs and deletes them through the genuine inverse", async () => {
  const result = await createOrderWithCopiedAddresses(), inverse = await local.retainedDelete();
  const order = result.output[0];
  expect(order).toMatchObject({ customer_id: "cus-existing", shipping_address: copiedAddress, billing_address: copiedAddress });
  const copyIds = Schema.decodeUnknownSync(Schema.Array(Schema.String))([order?.shipping_address_id, order?.billing_address_id]);
  expect(new Set(copyIds).size).toBe(2);
  expect(await local.read(copyIds)).toMatchObject(copyIds.toSorted().map(id => ({ id, ...copiedAddress })));
  const before = await local.snapshot(), key = inverse.newRequestKey();
  expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
  expect(await local.read([...copyIds, ...result.retained])).toEqual([]);
  const after = await local.snapshot();
  const outcome = after.outcomes.find(record => record.value.key === key);
  if (outcome === undefined) throw new Error("Missing committed checkout Address inverse outcome");
  expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
  expect(after.outcomes.length - before.outcomes.length).toBe(1);
  const tombstones = after.revisions.filter(row => row.timestamp === outcome.timestamp && row.deleted);
  expect(after.revisions.length - before.revisions.length).toBe(6);
  expect(tombstones.map(row => local.definition.tables.find(table => table.name === row.table)?.localName).sort())
    .toEqual(["order", "order_address", "order_address", "order_item", "order_line_item", "order_summary"]);
  const addressTable = local.definition.tables.find(table => table.localName === "order_address")?.name;
  expect(tombstones.filter(row => row.table === addressTable).map(row => before.revisions.find(prior =>
    prior.table === row.table && prior.id === row.id && prior.timestamp === row.previous)?.value?.id).sort()).toEqual(copyIds.toSorted());
  expect(await Effect.runPromise(inverse.run(key, result.retained))).toBeNull();
  expect(await local.snapshot()).toEqual(after);
}, 180_000);

it("retains NO ACTION enforcement when another Order references an Address selected for deletion", async () => {
  const inverse = await local.remove(), before = await local.snapshot();
  const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ["order-checkout-shared-402"]));
  const failure = expectWorkflowTypedFailures(exit, "invalidInput").find(error => error.reason === "invalidInput");
  const orderTable = local.definition.tables.find(table => table.localName === "order")?.name;
  const addressTable = local.definition.tables.find(table => table.localName === "order_address")?.name;
  const billingKey = local.definition.foreignKeys?.find(key => key.sourceTable === orderTable && key.targetTable === addressTable
    && key.sourceFields.join() === "billing_address_id" && key.targetFields.join() === "id" && key.onDelete === "noAction");
  if (billingKey === undefined) throw new Error("Missing authenticated Core Order billing Address foreign key");
  expect(failure?.cause).toBeInstanceOf(CoreNativeForeignKeyError);
  expect(failure?.cause).toMatchObject({ reason: "deleteRestricted", descriptor: billingKey.descriptor,
    sourceTable: billingKey.sourceTable, targetTable: billingKey.targetTable,
    sourceFields: billingKey.sourceFields, targetFields: billingKey.targetFields });
  // The native cleanup receipt succeeded before Core refused the delete closure
  // and the commerce host projected its foreign-key failure to invalidInput.
  const accepted = packets.find(packet => packet.call.commandName === "orderDeleteForCheckout" &&
    Array.isArray(packet.call.input) && packet.call.input.includes("order-checkout-shared-402"));
  expect(accepted?.activity.mutations.map(row => row.table)).toEqual(["order_address", "order"]);
  expect(await local.snapshot()).toEqual(before);
  expect(await local.read(["ordaddr-checkout-shared-inverse", "order-checkout-shared-402", "order-checkout-shared-403"])).toHaveLength(3);
}, 180_000);

it("refuses forged native Address copies, slot identities, missing reads and changed cleanup order", async () => {
  const offset = packets.length, created = await createOrderWithCopiedAddresses(), inverse = await local.retainedDelete();
  expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), created.retained))).toBeNull();
  const captured = packets.slice(offset);
  const creation = captured.find(packet => packet.call.commandName === "orderCreateForCheckout");
  const deletion = captured.find(packet => packet.call.commandName === "orderDeleteForCheckout" &&
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
}, 180_000);
