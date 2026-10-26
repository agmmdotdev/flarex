import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { commerceRelationReadQuery } from "../src/query/relations";
import { captureCommerceInput } from "../src/value/input";
import { captureCartMetadata } from "../src/modules/cart/schema";
import { prepareCartPaymentRead } from "../src/modules/cart/payment-read";
import { prepareCartCompletionRepository } from "../src/modules/cart/completion-repository";
import { cartCompletionPolicy } from "../src/modules/cart/completion-receipt";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const stamp = "2026-10-27T00:00:00.000Z";
const before = { id: "cart-completion-receipt", region_id: null, customer_id: null, sales_channel_id: null,
  email: null, currency_code: "usd", locale: null, metadata: { retained: true }, completed_at: null,
  shipping_address_id: null, billing_address_id: null, created_at: stamp, updated_at: stamp, deleted_at: null };
const after = { ...before, completed_at: stamp };
let policy: ReturnType<typeof cartCompletionPolicy>, call: Call, activity: Activity;
beforeAll(async () => {
  const read = Result.getOrThrow(prepareCartPaymentRead((await Effect.runPromise(captureCartMetadata())).frame));
  const prepared = Result.getOrThrow(prepareCartCompletionRepository(read));
  const plan = Result.getOrThrow(captureCommerceInput(buildQuery({ $or: [{ id: before.id }] }, {})).pipe(Result.flatMap(prepared.query)));
  policy = cartCompletionPolicy(prepared);
  call = { commandName: "cartCompleteForCheckout", mode: "write", input: [{ id: before.id, completed_at: stamp }],
    result: await Effect.runPromise(prepared.present([after], "cart")),
    events: [{ name: "cart.cart.updated", metadata: { source: "cart", object: "cart", action: "updated" }, data: { id: [before.id] } }],
    fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 };
  activity = { observedRows: [{ table: "cart", row: after }],
    relationalReads: [{ table: "cart", query: commerceRelationReadQuery(defaultCommerceResources, plan.query.predicate), total: 1, returned: 1 }],
    mutations: [{ ordinal: 0, table: "cart", operation: "patch", before, after }], lifecycle: [], setNull: [], referenceReplacements: [] };
});
const refused = async (evidence: Activity, value = call) =>
  expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(value, evidence))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

describe("Cart completion current-row and historical mutation evidence", () => {
  it("uses the authenticated mutation preimage while observing the completed current row", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call, activity));
  });

  it("refuses missing, historical, sparse, altered, duplicate and foreign current observations", async () => {
    for (const observedRows of [[], [{ table: "cart", row: before }], [{ table: "cart", row: { id: before.id } }],
      [{ table: "cart", row: { ...after, email: "altered@example.test" } }],
      [...activity.observedRows, ...activity.observedRows], [{ table: "cart_address", row: after }]])
      await refused({ ...activity, observedRows });
  });

  it("refuses incomplete preimages, protected-field changes and corrupt read, result or event evidence", async () => {
    await refused({ ...activity, mutations: [{ ordinal: 0, table: "cart", operation: "patch", before: { id: before.id }, after }] });
    const altered = { ...after, email: "altered@example.test" };
    await refused({ ...activity, observedRows: [{ table: "cart", row: altered }],
      mutations: [{ ordinal: 0, table: "cart", operation: "patch", before, after: altered }] }, { ...call, result: [altered] });
    await refused({ ...activity, relationalReads: [] });
    await refused(activity, { ...call, result: [before] });
    await refused(activity, { ...call, events: [] });
  });
});
