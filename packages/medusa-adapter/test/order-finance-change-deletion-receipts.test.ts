import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureOrderMetadata } from "../src/modules/order/schema";
import { prepareOrderFinanceRepository } from "../src/modules/order/finance-repository";
import { sameOrderFinanceFamilyTranscript } from "../src/modules/order/finance-receipt-state";
import { validateOrderFinanceChangeDeletion } from "../src/modules/order/finance-change-deletion-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const time = "2026-10-24T00:00:00.000Z";
const action: JsonObject = { id: "ordchact-leaf", order_id: "order-finance", order_change_id: "ordch-finance",
  return_id: null, claim_id: null, exchange_id: null, ordering: 17, version: 2, reference: "refund", reference_id: "ref-one",
  action: "CREDIT_LINE_ADD", details: {}, amount: "3.1250000000000000000", raw_amount: { value: "3.1250000000000000000", precision: 20 },
  internal_note: null, applied: false, created_at: time, updated_at: time, deleted_at: null };
const change: JsonObject = { id: "ordch-finance", order_id: "order-finance", return_id: null, claim_id: null, exchange_id: null,
  version: 2, change_type: "credit_line", description: null, status: "pending", internal_note: null, created_by: null,
  requested_by: null, requested_at: null, confirmed_by: null, confirmed_at: null, declined_by: null, declined_reason: null,
  metadata: null, declined_at: null, canceled_by: null, canceled_at: null, carry_over_promotions: null,
  created_at: time, updated_at: time, deleted_at: null };

let validate: LogicalCallReceiptValidation;
function packet(parent = false) {
  const table = parent ? "order_change" : "order_change_action", row = parent ? change : action;
  const call: Call = { commandName: parent ? "orderPaymentFinanceChangesDelete" : "orderPaymentFinanceActionsDelete",
    mode: "write", input: [row.id!], result: null, fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0,
    events: [{ name: parent ? "order.order-change.deleted" : "order.order-change-action.deleted",
      metadata: { source: "order", object: table, action: "deleted" }, data: { id: row.id! } }] };
  const activity: Activity = { observedRows: [{ table, row }], relationalReads: [], lifecycle: [], setNull: [], referenceReplacements: [],
    mutations: [{ ordinal: 0, table, operation: "delete", before: row, after: null }] };
  return { call, activity };
}
const refused = async (value: ReturnType<typeof packet>) => expect(await Effect.runPromise(Effect.result(validate(value.call, value.activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("native Order finance creation compensator receipts", () => {
  beforeAll(async () => {
    const metadata = await Effect.runPromise(captureOrderMetadata());
    validate = validateOrderFinanceChangeDeletion(Result.getOrThrow(prepareOrderFinanceRepository(metadata.frame)));
  });
  it("authenticates complete leaf Action and parent Change deletions without an invented DAL read", async () => {
    for (const value of [packet(), packet(true)]) await Effect.runPromise(validate(value.call, value.activity));
  });
  it("retains native absent-identity deletion as a genuine empty result", async () => {
    const value = packet();
    await Effect.runPromise(validate({ ...value.call, input: ["missing-action"], events: [] },
      { ...value.activity, observedRows: [], mutations: [] }));
  });
  it("refuses unrelated identities, changed complete observations and incomplete native rows", async () => {
    const value = packet(), mutation = value.activity.mutations[0]!;
    await refused({ ...value, call: { ...value.call, input: ["other-action"] } });
    await refused({ ...value, activity: { ...value.activity, observedRows: [{ table: "order_change_action", row: { ...action, applied: true } }] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [{ ...mutation, before: { id: action.id! } }] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [mutation, { ...mutation, ordinal: 1 }] } });
  });
  it("refuses fabricated reads, foreign mutations, non-null results and event changes", async () => {
    const value = packet(), mutation = value.activity.mutations[0]!;
    await refused({ ...value, activity: { ...value.activity,
      relationalReads: [{ table: "order_change_action", query: {}, total: 1, returned: 1 }] } });
    await refused({ ...value, activity: { ...value.activity, mutations: [{ ...mutation, table: "order_transaction" }] } });
    await refused({ ...value, call: { ...value.call, result: [] } });
    await refused({ ...value, call: { ...value.call, events: [] } });
    await refused({ ...value, call: { ...value.call, events: [{ name: "order.order-change-action.deleted",
      metadata: { source: "order", object: "order_change_action", action: "deleted" }, data: { id: "other-action" } }] } });
  });
});

describe("native independent finance family transcripts", () => {
  const a = { table: "order", query: { id: "one" }, total: 1, returned: 1 };
  const b = { table: "order", query: { id: "two" }, total: 1, returned: 1 };
  const c = { table: "order_item", query: { order_id: "one" }, total: 1, returned: 1 };
  it("admits cross-family interleaving while retaining repeated reads", () => {
    expect(sameOrderFinanceFamilyTranscript([a, c, a, b], [c, a, a, b], "table")).toBe(true);
    expect(sameOrderFinanceFamilyTranscript([], [], "table")).toBe(true);
  });
  it("refuses omissions, extras, same-family reversals and changed query/count evidence", () => {
    for (const actual of [[a, c, b], [a, c, a, b, c], [a, c, b, a], [a, c, a, { ...b, total: 2 }],
      [a, c, a, { ...b, query: { id: "other" } }], [a, c, a, { ...b, table: "foreign" }]])
      expect(sameOrderFinanceFamilyTranscript(actual, [a, c, a, b], "table")).toBe(false);
  });
  it("preserves event identity order, duplication and complete family membership", () => {
    const one = { object: "order_item", action: "created", id: "one" };
    const two = { object: "order_item", action: "created", id: "two" };
    const pointer = { object: "order", action: "updated", id: "order" };
    expect(sameOrderFinanceFamilyTranscript([one, pointer, two], [pointer, one, two], "object")).toBe(true);
    for (const events of [[two, pointer, one], [one, two], [one, pointer, two, two],
      [one, pointer, { ...two, action: "deleted" }]])
      expect(sameOrderFinanceFamilyTranscript(events, [pointer, one, two], "object")).toBe(false);
  });
});
