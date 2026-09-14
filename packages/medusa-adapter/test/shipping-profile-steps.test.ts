import { expect, it, vi } from "vitest";
import { Result } from "effect";
import { createWorkflow, WorkflowResponse, StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { createShippingProfilesStep } from "@medusajs/core-flows/fulfillment/create-shipping-profiles-step";
import { createRemoteLinkStep } from "@medusajs/core-flows/common/create-remote-links-step";

const prepared = Result.getOrThrow(createWorkflow("characterize-shipping-steps", () => {
  createShippingProfilesStep([]);
  return new WorkflowResponse(createRemoteLinkStep([]));
}).prepare());
const step = (name: string) => {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native step");
  expect(node.compensation).toBe("transactionCovered");
  return node;
};
const context = (services: Readonly<Record<string, unknown>>) => {
  const resolve = vi.fn((name: string) => {
    if (!(name in services)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  // SAFETY: characterization implements the native generic container boundary;
  // each concrete resource resolution and delegated argument is asserted below.
  const value: StepExecutionContext = { eventGroupId: "native-shipping", container: { resolve: <T>(name: string) => resolve(name) as T } };
  return { value, resolve };
};

it("retains native ShippingProfile empty creation and nonempty-only deletion compensation", async () => {
  const profiles = [{ id: "sp_native", name: "Native", type: "default" }];
  const createShippingProfiles = vi.fn(async (input: unknown[]) => input.length ? profiles : []);
  const deleteShippingProfiles = vi.fn(async () => undefined);
  const ctx = context({ fulfillment: { createShippingProfiles, deleteShippingProfiles } });
  const node = step("create-shipping-profiles");
  const result = await node.invoke(profiles, ctx.value);
  if (!(result instanceof StepResponse)) throw new Error("Missing native StepResponse");
  expect(result.output).toBe(profiles); expect(result.compensateInput).toEqual(["sp_native"]);
  expect(createShippingProfiles).toHaveBeenCalledExactlyOnceWith(profiles);
  await node.compensate?.(result.compensateInput, ctx.value);
  expect(deleteShippingProfiles).toHaveBeenCalledExactlyOnceWith(["sp_native"]);
  const empty = await node.invoke([], ctx.value);
  if (!(empty instanceof StepResponse)) throw new Error("Missing empty StepResponse");
  expect(empty.output).toEqual([]); expect(empty.compensateInput).toEqual([]);
  expect(createShippingProfiles).toHaveBeenLastCalledWith([]);
  ctx.resolve.mockClear(); deleteShippingProfiles.mockClear();
  await node.compensate?.([], ctx.value); await node.compensate?.(undefined, ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled(); expect(deleteShippingProfiles).not.toHaveBeenCalled();
});

it("retains remote-Link input results, early resolver access and truthy empty compensation", async () => {
  const definitions = [{ product: { product_id: "p" }, fulfillment: { shipping_profile_id: "sp" } }];
  const create = vi.fn(async () => [{ id: "generated-link-id" }]), dismiss = vi.fn(async () => []);
  const ctx = context({ link: { create, dismiss } });
  const node = step("create-remote-links");
  const result = await node.invoke(definitions, ctx.value);
  if (!(result instanceof StepResponse)) throw new Error("Missing native StepResponse");
  expect(result.output).toBe(definitions); expect(result.compensateInput).toBe(definitions);
  expect(create).toHaveBeenCalledExactlyOnceWith(definitions);
  await node.compensate?.(result.compensateInput, ctx.value);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(definitions);
  create.mockClear(); ctx.resolve.mockClear(); dismiss.mockClear();
  const empty = await node.invoke([], ctx.value);
  if (!(empty instanceof StepResponse)) throw new Error("Missing empty StepResponse");
  expect(empty.output).toEqual([]); expect(empty.compensateInput).toEqual([]);
  expect(ctx.resolve).toHaveBeenCalledExactlyOnceWith("link"); expect(create).not.toHaveBeenCalled();
  await node.compensate?.([], ctx.value);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith([]);
  ctx.resolve.mockClear(); await node.compensate?.(undefined, ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled();
});
