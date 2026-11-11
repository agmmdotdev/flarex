import { Effect, Result, Schema } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { MathBN } from "@medusajs/framework/utils/portable";
import { removeUndefined } from "@medusajs/utils/common/remove-undefined";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { getLineItemActionsStep, type GetLineItemActionsStepInput } from "../src/cart/steps/get-line-item-actions";

const flow = createWorkflow("native-cart-item-actions-presentation", (input: WorkflowData<GetLineItemActionsStepInput>) =>
  new WorkflowResponse(getLineItemActionsStep(input)));
const prepared = Result.getOrThrow(flow.prepare());
const decodeMergedQuantity = Schema.decodeUnknownSync(Schema.Struct({ itemsToUpdate: Schema.Array(Schema.Struct({ quantity: Schema.String })) }));

async function actions(input: GetLineItemActionsStepInput, existing: readonly object[]) {
  const listLineItems = vi.fn(async () => existing);
  const container = createContainer().register({ cart: asValue({ listLineItems }) });
  const port: WorkflowExecutionPort<never> = { checkpoint: Effect.void,
    // A structured clone preserves the numeric object's inert c/e/s members,
    // so only the native step's deliberate presentation can yield a string.
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.promise(() => Promise.resolve(work())),
    context: { container, eventGroupId: "cart-item-actions-presentation" },
  };
  try { return { result: await Effect.runPromise(executeWorkflow(prepared, input, port)), listLineItems }; }
  finally { await container.dispose(); }
}

describe("native Cart item-action presentation", () => {
  it("keeps the native exact arithmetic JSON quantity when merging an existing item", async () => {
    const quantity = "9007199254740993";
    const { result, listLineItems } = await actions({ id: "cart", items: [{ cart_id: "cart", title: "Native item", variant_id: "variant",
      quantity: 1, unit_price: 12.5, metadata: null }] }, [{ id: "line", variant_id: "variant", quantity, unit_price: 12.5, metadata: null }]);
    expect(result).toEqual({ itemsToCreate: [], itemsToUpdate: [{ id: "line", quantity: "9007199254740994", variant_id: "variant",
      unit_price: 12.5, compare_at_unit_price: undefined }] });
    expect(decodeMergedQuantity(result).itemsToUpdate[0]?.quantity).toBe(MathBN.sum(quantity, 1).toJSON());
    expect(listLineItems).toHaveBeenCalledWith({ cart_id: "cart", variant_id: ["variant"] }, { select: [
      "id", "metadata", "variant_id", "quantity", "unit_price", "compare_at_unit_price",
    ] });
  });

  it("retains the native create branch when metadata differs and the empty early return", async () => {
    const item = { cart_id: "cart", title: "Native item", variant_id: "variant", quantity: 1, unit_price: 12.5, metadata: { engraving: "B" } };
    const created = await actions({ id: "cart", items: [item] }, [{ id: "line", variant_id: "variant", quantity: 1, metadata: { engraving: "A" } }]);
    expect(created.result).toEqual({ itemsToCreate: [item], itemsToUpdate: [] });
    const empty = await actions({ id: "cart", items: [] }, []);
    expect(empty.result).toEqual({ itemsToCreate: [], itemsToUpdate: [] });
    expect(empty.listLineItems).not.toHaveBeenCalled();
  });

  it("types native undefined omission without changing null, zero or false", () => {
    const input: { required: string; maybe: string | undefined; absent: undefined; nullable: null; count: number; enabled: boolean } = {
      required: "native", maybe: undefined, absent: undefined, nullable: null, count: 0, enabled: false,
    };
    const result = removeUndefined(input);
    expectTypeOf(result).toExtend<{ required: string; maybe?: string; absent?: never; nullable: null; count: number; enabled: boolean }>();
    expect(result).toEqual({ required: "native", nullable: null, count: 0, enabled: false });
  });
});
