import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { createInventoryLevelsWorkflow, createInventoryLevelsWorkflowId,
  type CreateInventoryLevelsWorkflowInput } from "@medusajs/core-flows/inventory/create-inventory-levels";
import { InventoryLevelCreationInput, InventoryLevelCreationOutput } from "../src/workflows/inventory/create-levels";

const prepared = Result.getOrThrow(createInventoryLevelsWorkflow.prepare());
const level = { id: "native-level", inventory_item_id: "item", location_id: "location", stocked_quantity: -1.25,
  incoming_quantity: 2.5, reserved_quantity: 0, available_quantity: -1.25, metadata: null,
  created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z", deleted_at: null };
const creation = prepared.nodes.find(node => node.kind === "step" && node.name === "create-inventory-levels");
if (creation?.kind !== "step" || creation.compensate === undefined) throw new Error("Missing genuine retained Level creation callback");
const invokeCreation = creation.invoke, compensateCreation = creation.compensate;
function nativePort() {
  const trace: string[] = [];
  const graph = vi.fn(async (_input: unknown) => ({ data: [{ id: "location" }], metadata: { count: 1, skip: 0, take: 8 } }));
  const createInventoryLevels = vi.fn(async (_input: unknown) => [level]);
  const deleteInventoryLevels = vi.fn(async (_ids: string[]) => {});
  // Observe actual service calls independently of scripted mock return values.
  const services: Readonly<Record<string, unknown>> = {
    query: { maxPageSize: 8, graph: (input: unknown) => { trace.push("query"); return graph(input); } },
    inventory: {
      createInventoryLevels: (input: unknown) => { trace.push("create-levels"); return createInventoryLevels(input); },
      deleteInventoryLevels: (ids: string[]) => { trace.push("delete-levels"); return deleteInventoryLevels(ids); },
    },
  };
  const resolve = vi.fn((name: string) => { if (!Object.hasOwn(services, name)) throw new Error("Unexpected Level creation provider " + name); trace.push("resolve-" + name); return services[name]; });
  const context: StepExecutionContext = { eventGroupId: "level-create", container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)), invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { trace, graph, resolve, context, createInventoryLevels, deleteInventoryLevels,
    run: (input: CreateInventoryLevelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}

describe("native standalone Inventory Level creation", () => {
  it("retains exact root identity and two ordered native nodes without parallel or child-workflow scheduling", () => {
    expect(createInventoryLevelsWorkflowId).toBe("create-inventory-levels-workflow"); expect(prepared.parallel).toBeUndefined();
    expect(prepared.nodes.map(node => [node.kind, node.name])).toEqual([["step", "validate-inventory-levels-step"], ["step", "create-inventory-levels"]]);
    expect(creation.compensation).toBe("transactionCovered"); expect(compensateCreation).toBeTypeOf("function");
  });

  it("passes all eight raw Location IDs in order and exposes the full native Level result array unchanged", async () => {
    const env = nativePort(), inventory_levels = Array.from({ length: 8 }, (_, index) => ({ inventory_item_id: "item-" + index,
      location_id: "location-" + index, stocked_quantity: index - 1.25, incoming_quantity: index + 0.5 })), original = structuredClone(inventory_levels);
    const result = inventory_levels.map((input, index) => ({ ...level, ...input, id: "returned-level-" + index, available_quantity: input.stocked_quantity }));
    env.graph.mockResolvedValueOnce({ data: inventory_levels.map(row => ({ id: row.location_id })), metadata: { count: 8, skip: 0, take: 8 } });
    env.createInventoryLevels.mockResolvedValueOnce(result);
    expect(await Effect.runPromise(env.run({ inventory_levels }))).toEqual(result);
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "stock_location", fields: ["id"], filters: { id: inventory_levels.map(row => row.location_id) }, pagination: { take: 8 } });
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith(inventory_levels); expect(inventory_levels).toEqual(original);
    expect(env.trace).toEqual(["resolve-query", "query", "resolve-inventory", "create-levels"]); expect(env.deleteInventoryLevels).not.toHaveBeenCalled();
  });

  it("queries and invokes native Inventory for an explicit empty array", async () => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 8 } }); env.createInventoryLevels.mockResolvedValueOnce([]);
    expect(await Effect.runPromise(env.run({ inventory_levels: [] }))).toEqual([]);
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "stock_location", fields: ["id"], filters: { id: [] }, pagination: { take: 8 } });
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith([]); expect(env.trace).toEqual(["resolve-query", "query", "resolve-inventory", "create-levels"]);
  });

  it("retains repeated raw Location IDs and mixed Item association without adapter deduplication", async () => {
    const env = nativePort(), inventory_levels = [{ inventory_item_id: "a", location_id: "location", stocked_quantity: 1 },
      { inventory_item_id: "b", location_id: "location" }, { inventory_item_id: "a", location_id: "second" }];
    env.graph.mockResolvedValueOnce({ data: [{ id: "location" }, { id: "second" }], metadata: { count: 2, skip: 0, take: 8 } });
    await Effect.runPromise(env.run({ inventory_levels }));
    expect(env.graph.mock.calls[0]?.[0]).toMatchObject({ filters: { id: ["location", "location", "second"] } });
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith(inventory_levels);
  });

  it("uses native first-missing occurrence order and refuses before resolving Inventory", async () => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [{ id: "location" }], metadata: { count: 1, skip: 0, take: 8 } });
    await expect(Effect.runPromise(env.run({ inventory_levels: ["missing-b", "location", "missing-a", "missing-b"].map(location_id => ({ inventory_item_id: "item", location_id })) })))
      .rejects.toMatchObject({ type: "not_found", message: "Stock locations with ids: missing-b, missing-a was not found" });
    expect(env.createInventoryLevels).not.toHaveBeenCalled(); expect(env.resolve.mock.calls.flat()).toEqual(["query"]); expect(env.trace).toEqual(["resolve-query", "query"]);
  });

  it.each([{ count: 2, skip: 0, take: 8 }, { count: 1, skip: 1, take: 8 }])("preserves the exact complete bounded Query refusal: %j", async metadata => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [{ id: "location" }], metadata });
    await expect(Effect.runPromise(env.run({ inventory_levels: [{ inventory_item_id: "item", location_id: "location" }] })))
      .rejects.toMatchObject({ reason: "unsupportedProfile", detail: "Inventory validation requires a complete bounded ID result" });
    expect(env.createInventoryLevels).not.toHaveBeenCalled(); expect(env.resolve.mock.calls.flat()).toEqual(["query"]);
  });

  it("retains generated compensation IDs and invokes the plural physical inverse with exact raw IDs", async () => {
    const env = nativePort(), returned = Array.from({ length: 8 }, (_, index) => ({ ...level, id: "created-" + index })); env.createInventoryLevels.mockResolvedValueOnce(returned);
    const response = await invokeCreation([{ inventory_item_id: "item", location_id: "location" }], env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing genuine native Level StepResponse");
    expect(response.output).toEqual(returned); expect(response.compensateInput).toEqual(returned.map(row => row.id));
    env.trace.length = 0; await compensateCreation(response.compensateInput, env.context);
    expect(env.deleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(returned.map(row => row.id)); expect(env.trace).toEqual(["resolve-inventory", "delete-levels"]);
    env.deleteInventoryLevels.mockClear(); const raw = ["missing", "created", "created"]; await compensateCreation(raw, env.context);
    expect(env.deleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(raw);
  });

  it("skips absent and empty compensation IDs before native provider resolution", async () => {
    const env = nativePort(); await compensateCreation(undefined, env.context); await compensateCreation([], env.context);
    expect(env.resolve).not.toHaveBeenCalled(); expect(env.deleteInventoryLevels).not.toHaveBeenCalled(); expect(env.trace).toEqual([]);
  });

  it("requires the array key, preserves the mutable eight-row bound and refuses managed quantity/identity fields", () => {
    const decode = Schema.decodeUnknownSync(InventoryLevelCreationInput, { onExcessProperty: "error" });
    const eight = Array.from({ length: 8 }, (_, index) => ({ inventory_item_id: "item-" + index, location_id: "location-" + index }));
    expect(decode({ inventory_levels: [] })).toEqual({ inventory_levels: [] }); expect(decode({ inventory_levels: eight })).toEqual({ inventory_levels: eight });
    for (const input of [{}, { inventory_levels: undefined }, { inventory_levels: null }, { inventory_levels: [...eight, eight[0]] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", id: "managed" }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", reserved_quantity: 1 }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", raw_stocked_quantity: { value: "1" } }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", stocked_quantity: Infinity }] }]) expect(() => decode(input)).toThrow();
  });

  it("uses the complete strict eight-row DTO output and refuses missing or foreign fields", () => {
    const decode = Schema.decodeUnknownSync(InventoryLevelCreationOutput, { onExcessProperty: "error" });
    const eight = Array.from({ length: 8 }, (_, index) => ({ ...level, id: "level-" + index })); expect(decode(eight)).toEqual(eight);
    const { metadata: _metadata, ...incomplete } = level;
    for (const rows of [[...eight, level], [incomplete], [{ ...level, foreign: true }], [{ ...level, available_quantity: Infinity }]]) expect(() => decode(rows)).toThrow();
  });
});
