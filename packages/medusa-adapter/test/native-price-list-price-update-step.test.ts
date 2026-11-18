import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { updatePriceListPricesStep } from "@medusajs/core-flows/price-list/update-price-list-prices-step";
import type { PriceListPriceSnapshotPrice, PriceListPriceUpdateCompensation } from "@medusajs/types";
import { createWorkflow, WorkflowResponse, type StepFunction, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { execution } from "@medusajs/workflows-sdk/testing/native-runtime";

type Input = typeof updatePriceListPricesStep extends StepFunction<infer I, infer _O> ? I : never;
const workflow = createWorkflow("native-price-list-price-update-compensation", (input: WorkflowData<Input>) =>
  new WorkflowResponse(updatePriceListPricesStep(input)));
const prepared = Result.getOrThrow(workflow.prepare());
const old: PriceListPriceSnapshotPrice = {
  id: "price-old", title: null, currency_code: "usd", amount: 40,
  raw_amount: { value: "40", precision: 20 }, min_quantity: null, raw_min_quantity: null,
  max_quantity: null, raw_max_quantity: null, price_set_id: "pset-old", price_list_id: "plist-old",
  rules_count: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null,
  price_rules: [{ id: "rule-old", price_id: "price-old", attribute: "region_id", value: "region-old", operator: "eq", priority: 0,
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", deleted_at: null }],
};
function native() {
  const runtime = execution();
  const snapshotPriceListPricesForUpdate = vi.fn(async () => ({ prices: structuredClone([old, { ...old, id: "price-unselected", price_rules: [] }]) }));
  const updatePriceListPrices = vi.fn(async () => [{ id: old.id }, { id: "price-new" }, { id: old.id }]);
  const restorePriceListPrices = vi.fn(async (_data: PriceListPriceUpdateCompensation) => undefined);
  runtime.container.values.set("pricing", { snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices });
  const captures: unknown[] = [];
  const context = { container: runtime.container, eventGroupId: "native-price-list-price-update" };
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.void,
    capture: value => Effect.sync(() => { const owned: unknown = structuredClone(value); captures.push(owned); return owned; }),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context,
  };
  return { port, context, captures, snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices };
}
describe("genuine native PriceList Price corrected step", () => {
  it("retains an empty compensation object without reading the empty map", async () => {
    const actual = native();
    expect(await Effect.runPromise(executeWorkflow(prepared, { data: [], variant_price_map: undefined }, actual.port))).toEqual([]);
    expect(actual.snapshotPriceListPricesForUpdate).not.toHaveBeenCalled();
    expect(actual.updatePriceListPrices).not.toHaveBeenCalled();
    expect(actual.captures).toContainEqual({ output: [], compensation: { before: [], createdPriceIds: [] } });
  });
  it("keeps native forward mapping and partitions actual duplicate returned IDs against complete old graphs", async () => {
    const actual = native();
    const input: Input = { data: [{ id: "plist-old", prices: [{ id: old.id, variant_id: "variant-old", amount: 88, currency_code: "usd" }] }],
      variant_price_map: { "variant-old": "pset-old" } };
    const returned = await Effect.runPromise(executeWorkflow(prepared, input, actual.port));
    expect(returned).toEqual([{ id: old.id }, { id: "price-new" }, { id: old.id }]);
    const mapped = [{ price_list_id: "plist-old", prices: [{ id: old.id, amount: 88, currency_code: "usd", price_set_id: "pset-old" }] }];
    expect(actual.snapshotPriceListPricesForUpdate).toHaveBeenCalledExactlyOnceWith(mapped);
    expect(actual.updatePriceListPrices).toHaveBeenCalledExactlyOnceWith(mapped);
    const retained = { before: [old], createdPriceIds: ["price-new"] };
    expect(actual.captures).toContainEqual({ output: returned, compensation: retained });
    const step = prepared.nodes.find(node => node.kind === "step" && node.name === "update-price-list-prices");
    if (!step || step.kind !== "step" || !step.compensate) throw new Error("Missing genuine native compensation callback");
    await step.compensate(retained, actual.context);
    expect(actual.restorePriceListPrices).toHaveBeenCalledExactlyOnceWith(retained);
    expect(actual.updatePriceListPrices).toHaveBeenCalledTimes(1);
    expect(input.data[0]?.prices[0]?.variant_id).toBe("variant-old");
  });
  it("propagates the snapshot rejection before native update or inverse", async () => {
    const actual = native(), refusal = new Error("native snapshot refused");
    actual.snapshotPriceListPricesForUpdate.mockRejectedValueOnce(refusal);
    const result = await Effect.runPromiseExit(executeWorkflow(prepared, { data: [{ id: "plist-old", prices: [
      { id: old.id, variant_id: "variant-old", amount: 88 },
    ] }], variant_price_map: { "variant-old": "pset-old" } }, actual.port));
    expect(result._tag).toBe("Failure");
    expect(actual.updatePriceListPrices).not.toHaveBeenCalled();
    expect(actual.restorePriceListPrices).not.toHaveBeenCalled();
  });
});
