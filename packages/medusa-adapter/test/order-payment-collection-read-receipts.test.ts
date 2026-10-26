import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareOrderPaymentCollectionLinkRead } from "../src/links/order-payment-collection-service";
import { captureCommerceInput } from "../src/value/input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let runtime: Effect.Success<ReturnType<typeof prepareOrderPaymentCollectionLinkRead>>;
const table = "order_payment_collection", stamp = "2026-10-23T00:00:00.000Z";
const row = (suffix: string, order = "order-a") => ({ id: "ordpay-" + suffix, order_id: order,
  payment_collection_id: "paycol-" + suffix, created_at: stamp, updated_at: stamp, deleted_at: null });
const input = { filters: { order_id: "order-a" }, config: { select: ["order_id", "payment_collection_id"],
  relations: [], order: { order_id: "ASC" as const }, skip: 0 as const, take: 4 as const } };
function packet(values: readonly JsonObject[]) {
  const plan = Result.getOrThrow(runtime.prepared.prepared.readPlan(Result.getOrThrow(captureCommerceInput(buildQuery(input.filters, input.config))), defaultCommerceResources.queryRows));
  const call: Call = { commandName: "orderPaymentCollectionCount", mode: "read", input,
    result: [values.map(value => ({ order_id: value.order_id ?? null, payment_collection_id: value.payment_collection_id ?? null })), values.length],
    events: [], fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { observedRows: values.map(value => ({ table, row: value })),
    relationalReads: [0, 1].map(() => ({ table, query: plan.query, total: values.length, returned: values.length })),
    mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
  return { call, activity };
}
const validate = (value: ReturnType<typeof packet>) => runtime.logicalEventPolicy().validateLogicalCall(value.call, value.activity);
const refused = async (value: ReturnType<typeof packet>) => expect(await Effect.runPromise(Effect.result(validate(value))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("Order Payment Collection complete read receipts", () => {
  beforeAll(async () => { runtime = await Effect.runPromise(prepareOrderPaymentCollectionLinkRead()); });
  it("authenticates actual empty and complete selections, including equal-order ties", async () => {
    await Effect.runPromise(validate(packet([])));
    const value = packet([row("b"), row("a")]);
    await Effect.runPromise(validate(value));
    await Effect.runPromise(validate({ ...value, call: { ...value.call,
      result: [[{ order_id: "order-a", payment_collection_id: "paycol-a" }, { order_id: "order-a", payment_collection_id: "paycol-b" }], 2] } }));
  });
  it("rejects fabricated absence, foreign endpoints, changed counts and projection fields", async () => {
    const value = packet([row("a")]);
    for (const result of [
      [[], 0], [[{ order_id: "other", payment_collection_id: "paycol-a" }], 1],
      [[{ order_id: "order-a", payment_collection_id: "paycol-other" }], 1],
      [[{ order_id: "order-a", payment_collection_id: "paycol-a" }], 2],
      [[{ order_id: "order-a", payment_collection_id: "paycol-a", id: "extra" }], 1],
      [[{ order_id: "order-a" }], 1],
    ] satisfies Call["result"][]) await refused({ ...value, call: { ...value.call, result } });
  });
  it("requires matching genuine query/count evidence even for absence", async () => {
    const value = packet([]);
    await refused({ ...value, activity: { ...value.activity, relationalReads: [] } });
    await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.map(read => ({ ...read, query: {} })) } });
    await refused({ ...value, call: { ...value.call, commandName: "foreignRead" } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ table: "foreign", row: row("a") }] } });
  });
  it("rejects an oversized or partial cohort rather than authenticating four of five Links", async () => {
    const value = packet(Array.from({ length: 5 }, (_, index) => row(String(index))));
    await refused(value);
    const result = value.call.result;
    if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Missing test tuple");
    await refused({ ...value, call: { ...value.call, result: [result[0].slice(0, 4), 5] },
      activity: { ...value.activity, relationalReads: value.activity.relationalReads.map(read => ({ ...read, returned: 4 })) } });
  });
});
