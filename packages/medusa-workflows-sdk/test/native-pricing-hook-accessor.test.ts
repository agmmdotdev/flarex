import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "@medusajs/deps/zod";
import { createWorkflow, StepResponse, WorkflowResponse } from "../src/durable/index.js";
import { createHook } from "../src/durable/utils/composer/create-hook.js";
import { execution } from "./native-runtime-fixture.js";

it("preserves the genuine native hook result accessor for raw and StepResponse outputs", async () => {
  for (const shape of ["unbound", "response", "raw", "raw-output", "undefined"] as const) {
    const env = execution(), name = "native-pricing-accessor-" + randomUUID();
    const workflow = createWorkflow(name, () => {
      const hook = createHook("pricing", {}, { resultValidator: z.record(z.string(), z.any()).optional() });
      return new WorkflowResponse(hook.getResult(), { hooks: [hook] });
    });
    if (shape !== "unbound") workflow.hooks.pricing(() => shape === "response" ? new StepResponse({ price: 7 }) :
      shape === "raw" ? { price: 7 } : shape === "undefined" ? new StepResponse(undefined) : { output: { price: 7 } });
    const result = await env.module.run(workflow, { transactionId: randomUUID(), input: {} });
    await env.drain();
    expect(result.result).toEqual(shape === "unbound" ? undefined : shape === "raw" || shape === "undefined"
      ? { __type: "Symbol(WorkflowWorkflowData)" } : { price: 7 });
  }
});
