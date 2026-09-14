import { expect, it, vi } from "vitest";
import { Result } from "effect";
import { createWorkflow, WorkflowResponse, StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { createProductVariantsStep } from "@medusajs/core-flows/product/create-product-variants-step";
import { createPriceSetsStep } from "@medusajs/core-flows/pricing/create-price-sets-step";
import { createVariantPricingLinkStep } from "@medusajs/core-flows/product/create-variant-pricing-link-step";

const prepared = Result.getOrThrow(createWorkflow("characterize-pricing-steps", () => {
  createProductVariantsStep([]); createPriceSetsStep([]);
  return new WorkflowResponse(createVariantPricingLinkStep({ links: [] }));
}).prepare());
const step = (name: string) => {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Pricing step");
  expect(node.compensation).toBe("transactionCovered"); return node;
};
const context = (services: Readonly<Record<string, unknown>>) => {
  const resolve = vi.fn((name: string) => {
    if (!(name in services)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  // SAFETY: characterization implements the native generic container boundary;
  // each resolution and delegated argument is asserted against the actual step.
  const value: StepExecutionContext = { eventGroupId: "native-pricing", container: { resolve: <T>(name: string) => resolve(name) as T } };
  return { value, resolve };
};
it.each([
  { name: "create-product-variants", module: "product", create: "createProductVariants", remove: "deleteProductVariants" },
  { name: "create-price-sets", module: "pricing", create: "createPriceSets", remove: "deletePriceSets" },
])("preserves $name output order, IDs and empty compensation", async ({ name, module, create, remove }) => {
  const rows = [{ id: "second" }, { id: "first" }];
  const insert = vi.fn(async (input: unknown[]) => input.length ? rows : []), erase = vi.fn(async () => undefined);
  const ctx = context({ [module]: { [create]: insert, [remove]: erase } }), node = step(name);
  const result = await node.invoke(rows, ctx.value);
  if (!(result instanceof StepResponse)) throw new Error("Missing native response");
  expect(result.output).toBe(rows); expect(result.compensateInput).toEqual(["second", "first"]);
  expect(insert).toHaveBeenCalledExactlyOnceWith(rows);
  await node.compensate?.(result.compensateInput, ctx.value);
  expect(erase).toHaveBeenCalledExactlyOnceWith(["second", "first"]);
  const empty = await node.invoke([], ctx.value);
  if (!(empty instanceof StepResponse)) throw new Error("Missing empty response");
  expect(empty.output).toEqual([]); expect(empty.compensateInput).toEqual([]);
  ctx.resolve.mockClear(); erase.mockClear();
  await node.compensate?.([], ctx.value); await node.compensate?.(undefined, ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled();
});
it("preserves native Variant-Pricing Link undefined output and original compensation input", async () => {
  const data = { links: [{ variant_id: "variant", price_set_id: "set" }] };
  const expected = [{ product: { variant_id: "variant" }, pricing: { price_set_id: "set" } }];
  const create = vi.fn(async () => [{ id: "generated" }]), dismiss = vi.fn(async () => undefined);
  const ctx = context({ link: { create, dismiss } }), node = step("create-variant-pricing-link");
  const result = await node.invoke(data, ctx.value);
  if (!(result instanceof StepResponse)) throw new Error("Missing Link response");
  expect(result.output).toBeUndefined(); expect(result.compensateInput).toBe(data);
  expect(create).toHaveBeenCalledExactlyOnceWith(expected);
  await node.compensate?.(result.compensateInput, ctx.value);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(expected);
  create.mockClear(); dismiss.mockClear(); ctx.resolve.mockClear();
  const empty = { links: [] }, response = await node.invoke(empty, ctx.value);
  if (!(response instanceof StepResponse)) throw new Error("Missing empty Link response");
  expect(response.output).toBeUndefined(); expect(response.compensateInput).toBe(empty);
  expect(create).toHaveBeenCalledExactlyOnceWith([]); expect(ctx.resolve).toHaveBeenCalledExactlyOnceWith("link");
  ctx.resolve.mockClear(); await node.compensate?.(empty, ctx.value); await node.compensate?.(undefined, ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
});
