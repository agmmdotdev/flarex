import { expect, it } from "vitest";
import { Result } from "effect";
import { createWorkflow, nativeCartCreationProfile, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import type { CreateCartWorkflowInput } from "@medusajs/core-flows/cart/create-carts";

it("prepares the complete genuine native Cart creation root and child closure", async () => {
  const { createCartWorkflow } = await import("@medusajs/core-flows/cart/create-carts");
  const prepared = Result.getOrThrow(createCartWorkflow.prepare());
  expect(prepared.name).toBe("create-cart");
  expect(prepared.nodeCount).toBe(72);
  expect(prepared.nodes).toHaveLength(16);
  expect(prepared.identity.constructionProfile).toEqual({ profile: "nativeCartCreation", maximumNodes: 73 });
  expect(prepared.nodes.some(node => node.kind === "workflow" && node.workflow.name === "update-tax-lines")).toBe(true);
  expect(prepared.nodes.some(node => node.kind === "workflow" && node.workflow.name === "update-cart-promotions")).toBe(true);
  const wrapper = createWorkflow({ name: "native-cart-creation-wrapper-proof", constructionProfile: nativeCartCreationProfile },
    (input: WorkflowData<CreateCartWorkflowInput>) => new WorkflowResponse(createCartWorkflow.runAsStep({ input })));
  expect(Result.getOrThrow(wrapper.prepare()).nodeCount).toBe(73);
  expect(() => createWorkflow("ordinary-cart-wrapper-refused", (input: WorkflowData<CreateCartWorkflowInput>) =>
    new WorkflowResponse(createCartWorkflow.runAsStep({ input })))).toThrow("Too many workflow nodes");
});
