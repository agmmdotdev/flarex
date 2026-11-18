import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makePromotionCheckoutReadCommands } from "../src/modules/promotion/checkout-read-service";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let promotion: Effect.Success<ReturnType<typeof makePromotionCheckoutReadCommands>>;
beforeAll(async () => { promotion = await Effect.runPromise(makePromotionCheckoutReadCommands()); });
const stamp = "2026-10-27T00:00:00.000Z";
const root = { id: "promo-checkout", code: "CHECKOUT", is_automatic: false, is_tax_inclusive: false, limit: null, used: 0,
  type: "standard", status: "active", metadata: null, campaign_id: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const method = { id: "proappmet-checkout", value: "9007199254740993.0000", raw_value: { value: "9007199254740993.0000", precision: 20 },
  currency_code: "usd", max_quantity: null, apply_to_quantity: null, buy_rules_min_quantity: null,
  type: "fixed", target_type: "items", allocation: null, promotion_id: root.id, created_at: stamp, updated_at: stamp, deleted_at: null };
function packet(populated = false) {
  const call: Call = { commandName: "promotionCountForCheckout", mode: "read", input: { filters: { id: root.id }, config: { select: ["id", "code"] } },
    result: [[{ id: root.id, code: root.code, application_method: populated ? { ...method, value: 9007199254740992 } : null }], 1], events: [],
    fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0 };
  const plan = Result.getOrThrow(promotion.prepared.query({ where: { id: root.id }, options: { fields: ["id", "code"], populate: ["application_method"] } }));
  const activity: Activity = { observedRows: [{ table: "promotion", row: root }, ...(populated ? [{ table: "promotion_application_method", row: method }] : [])],
    relationalReads: [
      { table: "promotion", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 },
      { table: "promotion_application_method", query: commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "promotion_id", values: [root.id] }, { kind: "isNull", column: "deleted_at" }] }), total: populated ? 1 : 0, returned: populated ? 1 : 0 },
    ], mutations: [], lifecycle: [], setNull: [], referenceReplacements: [] };
  return { call, activity };
}
const validate = (value: ReturnType<typeof packet>) => promotion.logicalEventPolicy().validateLogicalCall(value.call, value.activity);
const refused = async (value: ReturnType<typeof packet>) => expect(await Effect.runPromise(Effect.result(validate(value)))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

it("authenticates the real default inverse singleton and its exact numeric companion", async () => {
  await Effect.runPromise(validate(packet()));
  await Effect.runPromise(validate(packet(true)));
});

it("refuses missing reads, forged counts/bodies and unrelated observed rows", async () => {
  const value = packet();
  await refused({ ...value, activity: { ...value.activity, relationalReads: value.activity.relationalReads.slice(0, 1) } });
  await refused({ ...value, call: { ...value.call, result: [[], 1] } });
  await refused({ ...value, call: { ...value.call, result: [[{ id: root.id, code: root.code, application_method: null }], 2] } });
  await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows, { table: "promotion", row: { ...root, id: "foreign" } }] } });
  await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows, { table: "promotion_application_method", row: { ...method, promotion_id: "foreign" } }] } });
});

it("refuses duplicate native singleton targets and rounded raw evidence", async () => {
  const value = packet(true);
  await refused({ ...value, activity: { ...value.activity, observedRows: [...value.activity.observedRows,
    { table: "promotion_application_method", row: { ...method, id: "proappmet-duplicate" } }], relationalReads: value.activity.relationalReads.map(read =>
      read.table === "promotion_application_method" ? { ...read, total: 2, returned: 2 } : read) } });
  await refused({ ...value, call: { ...value.call, result: [[{ id: root.id, code: root.code,
    application_method: { ...method, value: 9007199254740992, raw_value: { value: "9007199254740992", precision: 20 } } }], 1] } });
});
