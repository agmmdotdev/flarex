import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { createInventoryItemsWorkflow, createInventoryItemsWorkflowId,
  type CreateInventoryItemsWorkflowInput } from "@medusajs/core-flows/inventory/create-inventory-items";
import { InventoryItemCreationInput } from "../src/workflows/inventory/create-items";

const prepared = Result.getOrThrow(createInventoryItemsWorkflow.prepare());
const item = { id: "actual-first", sku: "first", requires_shipping: true }, level = { id: "level", inventory_item_id: "actual-first", location_id: "location" };
function nativePort() {
  const trace: string[] = [];
  const createInventoryItems = vi.fn(async (_input: unknown) => [item]);
  const createInventoryLevels = vi.fn(async (_input: unknown) => [level]);
  const deleteInventoryItems = vi.fn(async (_ids: string[]) => {});
  const deleteInventoryLevels = vi.fn(async (_ids: string[]) => {});
  const graph = vi.fn(async (_input: unknown) => ({ data: [{ id: "location" }], metadata: { count: 1, skip: 0, take: 8 } }));
  // Observe the actual service boundary outside replaceable mock results.
  // Per-case mockResolvedValueOnce scripts data without deleting observations.
  const services: Readonly<Record<string, unknown>> = { inventory: {
    createInventoryItems: (input: unknown) => { trace.push("create-items"); return createInventoryItems(input); },
    createInventoryLevels: (input: unknown) => { trace.push("create-levels"); return createInventoryLevels(input); },
    deleteInventoryItems: (ids: string[]) => { trace.push("delete-items"); return deleteInventoryItems(ids); },
    deleteInventoryLevels: (ids: string[]) => { trace.push("delete-levels"); return deleteInventoryLevels(ids); },
  }, query: { maxPageSize: 8, graph: (input: unknown) => { trace.push("query"); return graph(input); } } };
  const resolve = vi.fn((name: string) => { if (!Object.hasOwn(services, name)) throw new Error("Unexpected native provider " + name); trace.push("resolve-" + name); return services[name]; });
  const context: StepExecutionContext = { eventGroupId: "item-create", container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)), invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { trace, resolve, context, graph, createInventoryItems, createInventoryLevels, deleteInventoryItems, deleteInventoryLevels,
    run: (input: CreateInventoryItemsWorkflowInput) => executeWorkflow(prepared, input, port) };
}
const creation = prepared.nodes.find(node => node.kind === "step" && node.name === "create-inventory-items");
const child = prepared.nodes.find(node => node.kind === "workflow");
if (creation?.kind !== "step" || child?.kind !== "workflow") throw new Error("Missing genuine Item creation graph");
const levelCreation = child.workflow.nodes.find(node => node.kind === "step" && node.name === "create-inventory-levels");
if (levelCreation?.kind !== "step") throw new Error("Missing genuine nested Level creation callback");

describe("native standalone Inventory Item creation", () => {
  it("keeps the exact ordered root, unconditional Level child and expanded four-node closure", () => {
    expect(createInventoryItemsWorkflowId).toBe("create-inventory-items-workflow"); expect(prepared.parallel).toBeUndefined();
    expect(prepared.nodes.map(node => node.kind === "step" ? node.name : node.kind)).toEqual(["create-inventory-items", "workflow"]);
    expect(child.workflow.nodes.map(node => node.name)).toEqual(["validate-inventory-levels-step", "create-inventory-levels"]);
    expect(prepared.nodes.length + child.workflow.nodes.length).toBe(4);
    for (const step of [creation, levelCreation]) { expect(step.compensation).toBe("transactionCovered"); expect(step.compensate).toBeTypeOf("function"); }
  });

  it("uses returned ordinal identities with final ID precedence and returns only the original Item array", async () => {
    const env = nativePort(), second = { ...item, id: "actual-second", sku: "second" };
    env.createInventoryItems.mockResolvedValueOnce([second, item]);
    env.graph.mockResolvedValueOnce({ data: [{ id: "a" }, { id: "b" }], metadata: { count: 2, skip: 0, take: 8 } });
    const input = { items: [{ sku: "first", location_levels: [{ location_id: "a", stocked_quantity: -1.25, inventory_item_id: "foreign" }] },
      { sku: "second", location_levels: [{ location_id: "b", incoming_quantity: 2.5 }] }] }, original = structuredClone(input);
    // Scripted native callback characterization: the private owner separately
    // rejects reordered authentic Item DTOs before this ordinal association.
    expect(await Effect.runPromise(env.run(input))).toEqual([second, item]);
    expect(env.createInventoryItems).toHaveBeenCalledExactlyOnceWith([{ sku: "first" }, { sku: "second" }]);
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith([
      { location_id: "a", stocked_quantity: -1.25, inventory_item_id: "actual-second" },
      { location_id: "b", incoming_quantity: 2.5, inventory_item_id: "actual-first" },
    ]);
    expect(input).toEqual(original); expect(env.trace).toEqual(["resolve-inventory", "create-items", "resolve-query", "query", "resolve-inventory", "create-levels"]);
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "stock_location", fields: ["id"], filters: { id: ["a", "b"] }, pagination: { take: 8 } });
  });

  it.each([{}, { items: [] }])("preserves native missing/empty normalization and every empty provider call: %j", async input => {
    const env = nativePort(); env.createInventoryItems.mockResolvedValueOnce([]); env.createInventoryLevels.mockResolvedValueOnce([]);
    env.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 8 } });
    // Native executable helper admits missing items despite its upstream type.
    // @ts-expect-error The genuine missing-items fallback is characterized here.
    expect(await Effect.runPromise(env.run(input))).toEqual([]);
    expect(env.createInventoryItems).toHaveBeenCalledExactlyOnceWith([]); expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.graph.mock.calls[0]?.[0]).toEqual({ entity: "stock_location", fields: ["id"], filters: { id: [] }, pagination: { take: 8 } });
    expect(env.trace).toEqual(["resolve-inventory", "create-items", "resolve-query", "query", "resolve-inventory", "create-levels"]);
  });

  it("keeps absent and empty nested arrays and defaults in native Item data", async () => {
    const env = nativePort(), inputs = [{ sku: "first" }, { sku: "second", location_levels: [] }];
    env.createInventoryItems.mockResolvedValueOnce([item, { ...item, id: "second" }]);
    env.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 8 } });
    await Effect.runPromise(env.run({ items: inputs })); expect(env.createInventoryItems).toHaveBeenCalledExactlyOnceWith([{ sku: "first" }, { sku: "second" }]);
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith([]); expect(inputs).toEqual([{ sku: "first" }, { sku: "second", location_levels: [] }]);
  });

  it("keeps missing Location error order and deduplicates missing names through native arrayDifference", async () => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 8 } });
    await expect(Effect.runPromise(env.run({ items: [{ sku: "first", location_levels: [{ location_id: "b" }, { location_id: "a" }, { location_id: "b" }] }] })))
      .rejects.toMatchObject({ type: "not_found", message: "Stock locations with ids: b, a was not found" });
    expect(env.createInventoryItems).toHaveBeenCalledTimes(1); expect(env.createInventoryLevels).not.toHaveBeenCalled();
  });

  it.each([{ count: 2, skip: 0, take: 8 }, { count: 1, skip: 1, take: 8 }])("refuses an incomplete Query result: %j", async metadata => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [{ id: "location" }], metadata });
    await expect(Effect.runPromise(env.run({ items: [{ location_levels: [{ location_id: "location" }] }] }))).rejects.toBeDefined();
    expect(env.createInventoryLevels).not.toHaveBeenCalled();
  });

  it("retains generated physical inverse IDs and skips missing/empty IDs before resolution", async () => {
    const env = nativePort(); const itemResponse = await creation.invoke([{ sku: "first" }], env.context), levelResponse = await levelCreation.invoke([{ inventory_item_id: "actual-first", location_id: "location" }], env.context);
    if (!(itemResponse instanceof StepResponse) || !(levelResponse instanceof StepResponse) || creation.compensate === undefined || levelCreation.compensate === undefined)
      throw new Error("Missing genuine retained creation responses");
    expect(itemResponse.compensateInput).toEqual(["actual-first"]); expect(levelResponse.compensateInput).toEqual(["level"]);
    env.trace.length = 0; await levelCreation.compensate(levelResponse.compensateInput, env.context); await creation.compensate(itemResponse.compensateInput, env.context);
    expect(env.trace).toEqual(["resolve-inventory", "delete-levels", "resolve-inventory", "delete-items"]);
    expect(env.deleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["level"]); expect(env.deleteInventoryItems).toHaveBeenCalledExactlyOnceWith(["actual-first"]);
    env.resolve.mockClear(); for (const ids of [[], undefined]) { await creation.compensate(ids, env.context); await levelCreation.compensate(ids, env.context); }
    expect(env.resolve).not.toHaveBeenCalled();
  });

  it("bounds facade inputs before helpers and keeps exact optional keys distinct from native output slots", () => {
    const decode = Schema.decodeUnknownSync(InventoryItemCreationInput, { onExcessProperty: "error" });
    expect(decode({})).toEqual({}); expect(decode({ items: [] })).toEqual({ items: [] });
    for (const input of [{ items: undefined }, { items: null }, { items: Array.from({ length: 5 }, () => ({})) },
      { items: [{ location_levels: Array.from({ length: 3 }, () => ({ location_id: "location" })) }] },
      { items: [{ location_levels: [{ location_id: "location", inventory_item_id: "other" }] }] },
      { items: [{ location_levels: [{ location_id: "location", reserved_quantity: 1 }] }] }]) expect(() => decode(input)).toThrow();
  });
});
