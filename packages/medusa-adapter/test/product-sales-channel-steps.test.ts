import { expect, it, vi } from "vitest";
import { Result } from "effect";
import { createWorkflow, WorkflowResponse, StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { createSalesChannelsStep } from "@medusajs/core-flows/sales-channel/create-sales-channels-step";
import { associateProductsWithSalesChannelsStep } from "@medusajs/core-flows/sales-channel/associate-products-with-channels-step";

// Authored characterization: inspect the actual promoted callbacks, including
// native compensators that the atomic runner deliberately does not execute.
const prepared = Result.getOrThrow(createWorkflow("characterize-creation-steps", () => {
  createProductsStep([]);
  createSalesChannelsStep({ data: [] });
  return new WorkflowResponse(associateProductsWithSalesChannelsStep({ links: [] }));
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
  // Test-only implementation of the native generic container boundary. Each
  // callback's actual resource selection and calls are asserted below.
  const value: StepExecutionContext = { eventGroupId: "native-step", container: { resolve: <T>(name: string) => resolve(name) as T } };
  return { value, resolve };
};

it("preserves native association mapping, output and compensation definitions without deduplicating", async () => {
  const definitions = [{ product: { product_id: "p" }, sales_channel: { sales_channel_id: "s" } }];
  const created = [{ id: "native-id", product_id: "p", sales_channel_id: "s" }];
  const create = vi.fn(async () => created), dismiss = vi.fn(async () => []);
  const ctx = context({ link: { create, dismiss } });
  const node = step("associate-products-with-channels");
  const result = await node.invoke({ links: [
    { product_id: "p", sales_channel_id: "s" }, { product_id: "p", sales_channel_id: "s" },
  ] }, ctx.value);
  expect(result).toBeInstanceOf(StepResponse);
  if (!(result instanceof StepResponse)) throw new Error("Missing StepResponse");
  expect(result.output).toBe(created);
  expect(result.compensateInput).toEqual([...definitions, ...definitions]);
  expect(create).toHaveBeenCalledExactlyOnceWith([...definitions, ...definitions]);
  await node.compensate?.(result.compensateInput, ctx.value);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith([...definitions, ...definitions]);
  expect(ctx.resolve.mock.calls).toEqual([["link"], ["link"]]);
});

it("keeps omitted/empty association short-circuits and the native truthy empty compensation array", async () => {
  const dismiss = vi.fn(async () => []);
  const ctx = context({ link: { dismiss } });
  const node = step("associate-products-with-channels");
  for (const input of [{}, { links: [] }]) {
    const result = await node.invoke(input, ctx.value);
    expect(result).toBeInstanceOf(StepResponse);
    if (!(result instanceof StepResponse)) throw new Error("Missing StepResponse");
    expect(result.output).toEqual([]); expect(result.compensateInput).toEqual([]);
  }
  await node.compensate?.(undefined, ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled();
  await node.compensate?.([], ctx.value);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith([]);
});

it("preserves creation outputs/IDs and the different Product and Sales Channel empty compensators", async () => {
  const products = [{ id: "p", title: "Product" }], channels = [{ id: "s", name: "Channel" }];
  const createProducts = vi.fn(async () => products), deleteProducts = vi.fn(async () => undefined);
  const createSalesChannels = vi.fn(async () => channels), deleteSalesChannels = vi.fn(async () => undefined);
  const ctx = context({ product: { createProducts, deleteProducts }, sales_channel: { createSalesChannels, deleteSalesChannels } });
  const product = step("create-products"), sales = step("create-sales-channels");
  const createdProducts = await product.invoke(products, ctx.value), createdChannels = await sales.invoke({ data: channels }, ctx.value);
  for (const result of [createdProducts, createdChannels]) expect(result).toBeInstanceOf(StepResponse);
  if (!(createdProducts instanceof StepResponse) || !(createdChannels instanceof StepResponse)) throw new Error("Missing StepResponse");
  expect(createdProducts.output).toBe(products); expect(createdProducts.compensateInput).toEqual(["p"]);
  expect(createdChannels.output).toBe(channels); expect(createdChannels.compensateInput).toEqual(["s"]);
  expect(createProducts).toHaveBeenCalledExactlyOnceWith(products);
  expect(createSalesChannels).toHaveBeenCalledExactlyOnceWith(channels);
  await product.compensate?.([], ctx.value); await product.compensate?.(undefined, ctx.value);
  await sales.compensate?.(undefined, ctx.value);
  expect(deleteProducts).not.toHaveBeenCalled(); expect(deleteSalesChannels).not.toHaveBeenCalled();
  await sales.compensate?.([], ctx.value);
  expect(deleteSalesChannels).toHaveBeenCalledExactlyOnceWith([]);
  await product.compensate?.(["p"], ctx.value); await sales.compensate?.(["s"], ctx.value);
  expect(deleteProducts).toHaveBeenCalledExactlyOnceWith(["p"]);
  expect(deleteSalesChannels).toHaveBeenLastCalledWith(["s"]);
});
