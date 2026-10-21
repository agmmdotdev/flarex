import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { removePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/remove-price-list-prices";
import { StepResponse } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { execution } from "@medusajs/workflows-sdk/testing/native-runtime";

const prepared = Result.getOrThrow(removePriceListPricesWorkflow.prepare());
function removalStep() {
  const step = prepared.nodes.find(node => node.kind === "step" && node.name === "remove-price-list-prices");
  if (!step || step.kind !== "step" || !step.compensate) throw new Error("Missing genuine native removal callback");
  return { ...step, compensate: step.compensate };
}

/** Callback handoff proof only. These method spies do not simulate persistence,
 * lifecycle traversal, native matching, events or database compensation. */
function native() {
  const runtime = execution();
  const listPrices = vi.fn(async (_selector: unknown, _config: unknown) => [{ id: "price-selected-b" }, { id: "price-selected-a" }]);
  const softDeletePrices = vi.fn(async (_ids: string[]) => ({ price_id: [] }));
  const restorePrices = vi.fn(async (_ids: string[]) => ({ price_id: [] }));
  runtime.container.values.set("pricing", { listPrices, softDeletePrices, restorePrices });
  const resolve = vi.spyOn(runtime.container, "resolve");
  const context = { container: runtime.container, eventGroupId: "native-price-list-price-remove" };
  const captures: unknown[] = [];
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.void,
    capture: value => Effect.sync(() => { const owned: unknown = structuredClone(value); captures.push(owned); return owned; }),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context,
  };
  return { context, port, captures, resolve, listPrices, softDeletePrices, restorePrices };
}

describe("genuine native PriceList Price removal callbacks", () => {
  it("returns both empty vectors before resolving Pricing, including the empty retained inverse", async () => {
    const actual = native(), step = removalStep();
    actual.context.container.values.delete("pricing");
    const response = await step.invoke([], actual.context);
    expect(response).toBeInstanceOf(StepResponse);
    if (!(response instanceof StepResponse)) throw new Error("Expected native StepResponse");
    expect(response.output).toEqual([]);
    expect(response.compensateInput).toEqual([]);
    await step.compensate([], actual.context);
    await step.compensate(undefined, actual.context);
    expect(actual.resolve).not.toHaveBeenCalled();
  });

  it("executes the real empty root without a Pricing registration", async () => {
    const actual = native();
    actual.context.container.values.delete("pricing");
    expect(await Effect.runPromise(executeWorkflow(prepared, { ids: [] }, actual.port))).toEqual([]);
    expect(actual.resolve).not.toHaveBeenCalled();
    expect(actual.captures).toContainEqual({ output: [], compensation: [] });
  });

  it("preserves missing Pricing failure for a nonempty selector", async () => {
    const actual = native();
    actual.context.container.values.delete("pricing");
    await expect(removalStep().invoke(["price-raw"], actual.context)).rejects.toThrow("Missing test service pricing");
    expect(actual.resolve).toHaveBeenCalledExactlyOnceWith("pricing");
    expect(actual.listPrices).not.toHaveBeenCalled();
    expect(actual.softDeletePrices).not.toHaveBeenCalled();
  });

  it("hands off unchanged raw selectors and retains the actual selected array for the original inverse", async () => {
    const actual = native(), step = removalStep(), raw = ["price-raw-z", "", "price-raw-z", "price-raw-a"];
    const response = await step.invoke(raw, actual.context);
    if (!(response instanceof StepResponse)) throw new Error("Expected native StepResponse");
    expect(actual.listPrices).toHaveBeenCalledExactlyOnceWith({ id: raw }, { relations: ["price_list"] });
    expect(actual.listPrices.mock.calls[0]?.[0]).toEqual({ id: raw });
    expect(raw).toEqual(["price-raw-z", "", "price-raw-z", "price-raw-a"]);
    expect(response.output).toEqual(["price-selected-b", "price-selected-a"]);
    expect(response.compensateInput).toBe(response.output);
    expect(actual.softDeletePrices.mock.calls[0]?.[0]).toBe(response.output);
    await step.compensate(response.compensateInput, actual.context);
    expect(actual.restorePrices.mock.calls[0]?.[0]).toBe(response.output);
    expect(actual.listPrices).toHaveBeenCalledTimes(1);
    expect(actual.resolve.mock.calls.map(call => call[0])).toEqual(["pricing", "pricing"]);
  });

  it("still calls softDeletePrices with an empty actual cohort for nonempty unmatched selectors", async () => {
    const actual = native(), step = removalStep();
    actual.listPrices.mockResolvedValueOnce([]);
    const response = await step.invoke(["price-missing"], actual.context);
    if (!(response instanceof StepResponse)) throw new Error("Expected native StepResponse");
    expect(actual.softDeletePrices).toHaveBeenCalledExactlyOnceWith([]);
    expect(response.output).toEqual([]);
    await step.compensate(response.compensateInput, actual.context);
    expect(actual.restorePrices).not.toHaveBeenCalled();
    expect(actual.resolve).toHaveBeenCalledTimes(1);
  });

  it("does not mask selection rejection or invoke later lifecycle work", async () => {
    const actual = native(), refusal = new Error("native list refused");
    actual.listPrices.mockRejectedValueOnce(refusal);
    await expect(removalStep().invoke(["price-raw"], actual.context)).rejects.toBe(refusal);
    expect(actual.softDeletePrices).not.toHaveBeenCalled();
    expect(actual.restorePrices).not.toHaveBeenCalled();
  });

  it("does not invent retained success when native soft deletion rejects", async () => {
    const actual = native(), refusal = new Error("native lifecycle refused");
    actual.softDeletePrices.mockRejectedValueOnce(refusal);
    await expect(removalStep().invoke(["price-raw"], actual.context)).rejects.toBe(refusal);
    expect(actual.listPrices).toHaveBeenCalledTimes(1);
    expect(actual.restorePrices).not.toHaveBeenCalled();
  });

  it("passes retained IDs to restore without relisting and preserves restoration failure", async () => {
    const actual = native(), ids = ["price-retained"], refusal = new Error("native current Rule conflict");
    actual.restorePrices.mockRejectedValueOnce(refusal);
    await expect(removalStep().compensate(ids, actual.context)).rejects.toBe(refusal);
    expect(actual.restorePrices.mock.calls[0]?.[0]).toBe(ids);
    expect(actual.listPrices).not.toHaveBeenCalled();
    expect(actual.softDeletePrices).not.toHaveBeenCalled();
  });

  it("returns the real workflow selected IDs and captures the shared output/compensation vector once", async () => {
    const actual = native();
    expect(await Effect.runPromise(executeWorkflow(prepared, { ids: ["price-raw"] }, actual.port)))
      .toEqual(["price-selected-b", "price-selected-a"]);
    expect(actual.captures).toEqual([["price-raw"], ["price-selected-b", "price-selected-a"]]);
    expect(removalStep().compensation).toBe("transactionCovered");
  });
});
