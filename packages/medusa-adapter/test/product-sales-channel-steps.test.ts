import { expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createWorkflow, WorkflowResponse, StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow } from "@medusajs/workflows-sdk/native";
import { createProductsStep } from "@medusajs/core-flows/product/create-products-step";
import { createSalesChannelsStep } from "@medusajs/core-flows/sales-channel/create-sales-channels-step";
import { associateProductsWithSalesChannelsStep } from "@medusajs/core-flows/sales-channel/associate-products-with-channels-step";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/core-flows/sales-channel/link-products";

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
const membership = Result.getOrThrow(linkProductsToSalesChannelWorkflow.prepare());
const detachment = membership.nodes.find(node => node.name === "detach-products-from-sales-channels-step");
if (detachment === undefined || detachment.kind !== "step") throw new Error("Missing native detachment step");
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

it("preserves native detachment mapping, duplicate order, void output and submitted compensation definitions", async () => {
  const definitions = [
    { product: { product_id: "p2" }, sales_channel: { sales_channel_id: "s" } },
    { product: { product_id: "p1" }, sales_channel: { sales_channel_id: "s" } },
    { product: { product_id: "p2" }, sales_channel: { sales_channel_id: "s" } },
  ];
  const dismiss = vi.fn(async (_links: unknown) => [{ id: "only-actually-dismissed" }]);
  const create = vi.fn(async (_links: unknown) => []);
  const ctx = context({ link: { dismiss, create } });
  const result = await detachment.invoke({ links: [
    { product_id: "p2", sales_channel_id: "s" }, { product_id: "p1", sales_channel_id: "s" },
    { product_id: "p2", sales_channel_id: "s" },
  ] }, ctx.value);
  expect(detachment.compensation).toBe("transactionCovered");
  expect(result).toBeInstanceOf(StepResponse);
  if (!(result instanceof StepResponse)) throw new Error("Missing StepResponse");
  expect(result.output).toBeUndefined();
  expect(result.compensateInput).toEqual(definitions);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith(definitions);
  expect(dismiss.mock.calls[0]?.[0]).toBe(result.compensateInput);
  await detachment.compensate?.(result.compensateInput, ctx.value);
  expect(create).toHaveBeenCalledExactlyOnceWith(definitions);
  expect(create.mock.calls[0]?.[0]).toBe(result.compensateInput);
  expect(ctx.resolve.mock.calls).toEqual([["link"], ["link"]]);
});

it("skips native detachment resource resolution for omitted/empty forward and inverse inputs", async () => {
  const ctx = context({});
  for (const input of [{}, { links: undefined }, { links: [] }]) {
    const result = await detachment.invoke(input, ctx.value);
    expect(result).toBeInstanceOf(StepResponse);
    if (!(result instanceof StepResponse)) throw new Error("Missing StepResponse");
    expect(result.output).toBeUndefined();
    expect(result.compensateInput).toEqual([]);
  }
  await detachment.compensate?.(undefined, ctx.value);
  await detachment.compensate?.([], ctx.value);
  expect(ctx.resolve).not.toHaveBeenCalled();
});

it("propagates native detachment forward and inverse Link failures unchanged", async () => {
  const failure = new Error("injected native Link failure");
  const dismiss = vi.fn(async () => { throw failure; });
  const create = vi.fn(async () => { throw failure; });
  const ctx = context({ link: { dismiss, create } });
  await expect(detachment.invoke({ links: [{ product_id: "p", sales_channel_id: "s" }] }, ctx.value)).rejects.toBe(failure);
  await expect(detachment.compensate?.([{ product: { product_id: "p" }, sales_channel: { sales_channel_id: "s" } }], ctx.value)).rejects.toBe(failure);
  expect(ctx.resolve.mock.calls).toEqual([["link"], ["link"]]);
});

it("executes the native membership root's actual transforms and ordered steps without deduplicating either array", async () => {
  expect(membership.nodes.map(node => node.name)).toEqual([
    "associate-products-with-channels", "detach-products-from-sales-channels-step",
  ]);
  expect(membership.parallel).toBeUndefined();
  const calls: { readonly method: string; readonly links: unknown }[] = [];
  const ctx = context({ link: {
    create: async (links: unknown) => { calls.push({ method: "create", links }); return []; },
    dismiss: async (links: unknown) => { calls.push({ method: "dismiss", links }); return []; },
  } });
  const result = await Effect.runPromise(executeWorkflow(membership, {
    id: "s", add: ["p2", "p1", "p2"], remove: ["p1", "p2", "p1"],
  }, { checkpoint: Effect.void, context: ctx.value,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
  }));
  expect(result).toBeUndefined();
  expect(calls).toEqual([
    { method: "create", links: [
      { product: { product_id: "p2" }, sales_channel: { sales_channel_id: "s" } },
      { product: { product_id: "p1" }, sales_channel: { sales_channel_id: "s" } },
      { product: { product_id: "p2" }, sales_channel: { sales_channel_id: "s" } },
    ] },
    { method: "dismiss", links: [
      { product: { product_id: "p1" }, sales_channel: { sales_channel_id: "s" } },
      { product: { product_id: "p2" }, sales_channel: { sales_channel_id: "s" } },
      { product: { product_id: "p1" }, sales_channel: { sales_channel_id: "s" } },
    ] },
  ]);
  expect(ctx.resolve.mock.calls).toEqual([["link"], ["link"]]);
});

it.each([{ id: "s" }, { id: "s", add: [] }, { id: "s", remove: [] }, { id: "s", add: [], remove: [] }])(
  "keeps omitted and empty root membership inputs resource-free: %j", async input => {
    const ctx = context({});
    const result = await Effect.runPromise(executeWorkflow(membership, input, {
      checkpoint: Effect.void, context: ctx.value,
      capture: value => Effect.sync(() => structuredClone(value)),
      invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    }));
    expect(result).toBeUndefined();
    expect(ctx.resolve).not.toHaveBeenCalled();
  },
);
