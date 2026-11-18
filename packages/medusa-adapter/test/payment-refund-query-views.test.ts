import { describe, expect, expectTypeOf, it } from "vitest";
import type { Schema } from "effect";
import type { StepOutput } from "@medusajs/workflows-sdk";
import { useQueryGraphStep, queryWorkflowGraph, type QueryGraphInput, type WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";

const cases = [
  { input: { entity: "orders", fields: ["id", "status", "summary", "total", "payment_collections.id"],
      filters: { id: "order-refund" }, options: { throwIfKeyNotFound: true } },
    row: { id: "order-refund", status: "pending", summary: { pending_difference: 0 }, total: 15,
      payment_collections: [{ id: "paycol-refund" }] }, malformed: { id: "order-refund", status: "other", summary: null, total: 15, payment_collections: [] } },
  { input: { entity: "order_change", fields: ["id", "status", "change_type", "actions.id", "actions.order_id", "actions.action", "actions.details",
      "actions.reference", "actions.reference_id", "actions.internal_note"], filters: { order_id: "order-refund", status: ["pending"] } },
    row: { id: "ordch-refund", status: "pending", change_type: "credit_line", actions: [{ id: "ordchact-refund", order_id: "order-refund",
      action: "CREDIT_LINE_ADD", details: {}, reference: null, reference_id: null, internal_note: null }] },
    malformed: { id: "ordch-refund", status: "pending", change_type: "credit_line", actions: [{ id: "ordchact-refund" }] } },
  { input: { entity: "payments", fields: ["id", "currency_code", "refunds.id", "refunds.amount", "refunds.raw_amount", "captures.id", "captures.amount",
      "captures.raw_amount", "payment_collection.order.id", "payment_collection.order.currency_code"], filters: { id: ["pay-refund"] }, options: { throwIfKeyNotFound: true } },
    row: { id: "pay-refund", currency_code: "usd", refunds: [], captures: [{ id: "capt-refund", amount: 9007199254740994,
      raw_amount: { value: "9007199254740993.125", precision: 20 } }],
      payment_collection: { order: { id: "order-refund", currency_code: "usd" } } },
    malformed: { id: "pay-refund", currency_code: "usd", refunds: [], captures: [{ id: "capt-refund", amount: "15",
      raw_amount: { value: "15", precision: 20 } }], payment_collection: null } },
] as const;
type Row = typeof Schema.JsonObject.Type;
const resource = (rows: readonly Row[], calls: unknown[][] = []): WorkflowGraphResource => ({ maxPageSize: 4,
  graph: async (...args) => { calls.push(args); return { data: rows, metadata: { count: rows.length, skip: 0, take: 4 } }; } });

describe("checked native refund graph projections", () => {
  it.each(cases)("retains the exact $input.entity view, complete query and native key option", async ({ input, row }) => {
    const calls: unknown[][] = [], result = await queryWorkflowGraph(input, resource([row], calls));
    expect(result).toEqual({ data: [row], metadata: { count: 1, skip: 0, take: 4 } });
    const options = "options" in input ? input.options : undefined;
    expect(calls).toEqual([[{ entity: input.entity, fields: input.fields, filters: input.filters, pagination: { take: 4 } },
      ...(options === undefined ? [] : [{ throwIfKeyNotFound: true }])]]);
  });
  it.each(cases)("keeps isList:false singleton typing and runtime shape for the exact $input.entity selector", async ({ input, row }) => {
    const singleton = { ...input, options: { throwIfKeyNotFound: true as const, isList: false as const } };
    const author = () => useQueryGraphStep(singleton);
    expectTypeOf<ReturnType<typeof author>>().toEqualTypeOf<StepOutput<{ readonly data: Row | undefined;
      readonly metadata: { readonly count: number; readonly skip: number; readonly take: number } }>>();
    const dynamic = { ...input, options: { throwIfKeyNotFound: true as const, isList: Boolean(row.id) } };
    const authorDynamic = () => useQueryGraphStep(dynamic);
    expectTypeOf<ReturnType<typeof authorDynamic>>().toEqualTypeOf<StepOutput<{ readonly data: Row | readonly Row[] | undefined;
      readonly metadata: { readonly count: number; readonly skip: number; readonly take: number } }>>();
    expect(await queryWorkflowGraph(singleton, resource([row]))).toEqual({ data: row, metadata: { count: 1, skip: 0, take: 4 } });
    expect(await queryWorkflowGraph(singleton, resource([]))).toMatchObject({ data: undefined });
  });
  it.each(cases)("refuses malformed or overbroad selected $input.entity results", async ({ input, malformed, row }) => {
    await expect(queryWorkflowGraph(input, resource([malformed]))).rejects.toMatchObject({ reason: "invalidDefinition" });
    await expect(queryWorkflowGraph(input, resource([{ ...row, foreign: "outside-selected-fields" }]))).rejects.toMatchObject({ reason: "invalidDefinition" });
  });
  it("retains nullable native associations and empty pending changes", async () => {
    const input = cases[2].input, payment = cases[2].row;
    for (const payment_collection of [null, { order: null }]) expect(await queryWorkflowGraph(input,
      resource([{ ...payment, payment_collection }]))).toMatchObject({ data: [{ payment_collection }] });
    expect(await queryWorkflowGraph(cases[1].input, resource([]))).toMatchObject({ data: [] });
  });
  it("keeps unrelated graph projections partial and rejects unknown options before dispatch", async () => {
    const calls: unknown[][] = [], query = resource([{ id: "product-one", arbitrary_selected_json: { retained: true } }], calls);
    expect(await queryWorkflowGraph({ entity: "products", fields: ["id", "arbitrary_selected_json"] }, query))
      .toMatchObject({ data: [{ arbitrary_selected_json: { retained: true } }] });
    calls.length = 0;
    for (const options of [{ throwIfKeyNotFound: false }, { throwIfRelationNotFound: true }]) {
      // SAFETY: malformed foreign options enter the actual strict query seam.
      await expect(queryWorkflowGraph({ ...cases[0].input, options } as QueryGraphInput, query)).rejects.toMatchObject({ reason: "unsupportedProfile" });
    }
    expect(calls).toEqual([]);
  });
});
