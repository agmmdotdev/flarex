import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { QueryContext } from "@medusajs/utils/modules-sdk/query-context";
import { normalizeWorkflowGraphContext } from "../src/workflow/query";
import { queryWorkflowGraph, type WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";

describe("native workflow Variant calculation context", () => {
  it("lowers the native tag while preserving native Cart pricing values", () => {
    const pricing = { currency_code: "usd", quantity: 2, customer_id: null, region: { id: "reg-native" },
      customer: { groups: [{ id: "group-native" }] }, shipping_address: { country_code: "us" } };
    expect(Result.getOrThrow(normalizeWorkflowGraphContext("variants", { calculated_price: QueryContext(pricing) })))
      .toEqual({ calculated_price: pricing });
    expect(Result.getOrThrow(normalizeWorkflowGraphContext("variant", {}))).toEqual({});
  });
  it.each([
    ["cart", { calculated_price: QueryContext({ currency_code: "usd" }) }],
    ["variants", { calculated_price: { currency_code: "usd" } }],
    ["variants", { prices: QueryContext({ currency_code: "usd" }) }],
    ["variants", { calculated_price: { __type: "OtherContext" } }],
  ])("refuses an unadmitted native context: %s", (entity, context) => {
    expect(Result.isFailure(normalizeWorkflowGraphContext(entity, context))).toBe(true);
  });
  it("captures the context without invoking accessors", () => {
    let reads = 0;
    const context = Object.defineProperty({}, "calculated_price", { enumerable: true, get() { reads++; return QueryContext({}); } });
    expect(Result.isFailure(normalizeWorkflowGraphContext("variants", context))).toBe(true);
    expect(reads).toBe(0);
  });
  it("forwards native intermediate omission to the bound Query owner before data admission", async () => {
    const context = { calculated_price: QueryContext({ currency_code: "usd", quantity: 2, customer_id: undefined,
      shipping_address: { country_code: "us", city: undefined } }) };
    const admitted: unknown[] = [];
    const query: WorkflowGraphResource = { maxPageSize: 4, graph: async input => {
      admitted.push(Result.getOrThrow(normalizeWorkflowGraphContext(input.entity, input.context)));
      return { data: [], metadata: { count: 0, skip: 0, take: 4 } };
    } };
    expect(await queryWorkflowGraph({ entity: "variants", fields: ["id"], context }, query))
      .toEqual({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
    expect(admitted).toEqual([{ calculated_price: { currency_code: "usd", quantity: 2, shipping_address: { country_code: "us" } } }]);
    await expect(queryWorkflowGraph({ entity: "variants", fields: ["id"], context: { calculated_price: () => ({}) } }, query)).rejects.toBeDefined();
    expect(admitted).toHaveLength(1);
  });
});
