import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { QueryContext } from "@medusajs/utils/modules-sdk/query-context";
import { queryWorkflowGraph } from "@medusajs/core-flows/common/use-query-graph";
import { workflowQueryBoundary } from "./support/workflow-query-boundary-fixture";

describe("native workflow QueryContext boundary", () => {
  it("keeps native context tags and values for native Query normalization", async () => {
    const tested = await workflowQueryBoundary();
    const pricing = { currency_code: "usd", quantity: 2, customer_id: null, region: { id: "region" } };
    const input = { entity: "variants", fields: ["id"], context: { calculated_price: QueryContext(pricing) } };
    try {
      await queryWorkflowGraph(input, tested.query);
      expect(tested.calls[0]?.args[0]).toEqual({ ...input, pagination: { skip: 0, take: 256 } });
      await tested.query.graph({ entity: "shipping_options", fields: ["id"], context: QueryContext({ currency_code: "usd" }) });
      expect(tested.calls[1]?.args[0]).toMatchObject({ context: { __type: "QueryContext", currency_code: "usd" } });
    } finally { await Effect.runPromise(tested.owner.close); }
  });
  it("refuses unadmitted contexts and getters without rewriting a native context", async () => {
    const tested = await workflowQueryBoundary(); let getters = 0;
    try {
      for (const [entity, context] of [
        ["cart", { calculated_price: QueryContext({ currency_code: "usd" }) }],
        ["variants", { calculated_price: { currency_code: "usd" } }],
        ["variants", { prices: QueryContext({}) }],
        ["variants", { calculated_price: { __type: "OtherContext" } }],
        ["variants", Object.defineProperty({}, "calculated_price", { enumerable: true, get() { getters++; return QueryContext({}); } })],
      ] as const) await expect(tested.query.graph({ entity, fields: ["id"], context })).rejects.toHaveProperty("_tag", "CommerceTransactionError");
      expect(getters).toBe(0); expect(tested.calls).toEqual([]);
    } finally { await Effect.runPromise(tested.owner.close); }
  });
});
