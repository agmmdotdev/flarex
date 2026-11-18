import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { createHook, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { pricingContextResult } from "../../medusa-core-flows/src/cart/utils/schemas";

it("executes native Cart pricing-context hook usage through the closed validator profile", async () => {
  const flow = createWorkflow("native-cart-pricing-hook-witness", (input: object) => {
    const hook = createHook("setPricingContext", { input }, { resultValidator: pricingContextResult });
    return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
  });
  const port: WorkflowExecutionPort<unknown> = { checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context: { eventGroupId: "native-cart-pricing-hook", container: { resolve() { throw new Error("No resource admitted"); } } } };
  expect(await Effect.runPromise(executeWorkflow(Result.getOrThrow(flow.prepare()), {}, port))).toBeUndefined();
  const prepared = Result.getOrThrow(flow.prepare({ setPricingContext: () => new StepResponse({ customer: { id: "customer-price-context" } }) }));
  expect(await Effect.runPromise(executeWorkflow(prepared, {}, port))).toEqual({ customer: { id: "customer-price-context" } });
  expect(Reflect.ownKeys(pricingContextResult)).toEqual(["profile"]);
});
