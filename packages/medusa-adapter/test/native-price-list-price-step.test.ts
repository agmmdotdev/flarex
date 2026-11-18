import { describe, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result } from "effect";
import { createPriceListPricesStep } from "@medusajs/core-flows/price-list/create-price-list-prices-step";
import { createWorkflow, WorkflowResponse, type StepFunction, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { execution } from "@medusajs/workflows-sdk/testing/native-runtime";

type NativeInput = typeof createPriceListPricesStep extends StepFunction<infer Input, infer _Output> ? Input : never;
const workflow = createWorkflow("native-price-list-price-map-boundary", (input: WorkflowData<NativeInput>) =>
  new WorkflowResponse(createPriceListPricesStep(input)));
const prepared = Result.getOrThrow(workflow.prepare());

function context() {
  const native = execution();
  const addPriceListPrices = vi.fn(), removePrices = vi.fn();
  native.container.values.set("pricing", { addPriceListPrices, removePrices });
  const captures: unknown[] = [];
  let callbackFailure: unknown;
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.void,
    capture: value => Effect.sync(() => { const captured: unknown = structuredClone(value); captures.push(captured); return captured; }),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => { callbackFailure = cause; return cause; } }),
    context: { container: native.container, eventGroupId: "native-price-map-boundary" },
  };
  return { port, captures, addPriceListPrices, removePrices, failure: () => callbackFailure };
}

describe("native PriceList Price empty-map dependency", () => {
  it("passes the actual undefined map through empty work without reading it", async () => {
    const native = context();
    const input: NativeInput = { data: [], variant_price_map: undefined };
    expect(await Effect.runPromise(executeWorkflow(prepared, input, native.port))).toEqual([]);
    expect(native.captures[0]).toEqual(input);
    expect(native.addPriceListPrices).not.toHaveBeenCalled();
    expect(native.removePrices).not.toHaveBeenCalled();
    expect(native.failure()).toBeUndefined();
  });

  it("retains the native TypeError for nonempty work with a missing map", async () => {
    const native = context();
    const input: NativeInput = { data: [{ id: "plist-map-boundary", prices: [
      { variant_id: "variant-map-boundary", amount: 40, currency_code: "usd" },
    ] }], variant_price_map: undefined };
    const result = await Effect.runPromiseExit(executeWorkflow(prepared, input, native.port));
    expect(native.failure()).toBeInstanceOf(TypeError);
    expect(Exit.isFailure(result)).toBe(true);
    if (!Exit.isFailure(result)) throw new Error("Expected the native missing-map failure");
    expect(result.cause.reasons).toHaveLength(1);
    const reason = result.cause.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected one typed native callback failure");
    expect(reason.error).toBe(native.failure());
    expect(native.captures[0]).toEqual(input);
    expect(native.addPriceListPrices).not.toHaveBeenCalled();
    expect(native.removePrices).not.toHaveBeenCalled();
  });
});
