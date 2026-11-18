import { Result } from "effect";
import { expect, it } from "vitest";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "../src/index";

// Pinned native CompensateFn permits an ignored unknown result. Cart's real
// inverse returns updateCarts' DTO array; it cannot be erased into void.
it("retains a native compensator's ordinary returned DTO array", async () => {
  const step = createStep({ name: "native-compensator-array", compensation: "transactionCovered" },
    () => new StepResponse("retained"), async input => [{ id: input }]);
  const workflow = createWorkflow("native-compensator-array-root", () => new WorkflowResponse(step({})));
  const node = Result.getOrThrow(workflow.prepare()).nodes.find(node => node.name === "native-compensator-array");
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native compensator");
  expect(await node.compensate("retained", { eventGroupId: "native-compensator-array",
    container: { resolve() { throw new Error("No resource selected"); } } })).toEqual([{ id: "retained" }]);
});
