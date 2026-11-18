import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { batchInventoryItemLevelsWorkflow, batchInventoryItemLevelsWorkflowId,
  type BatchInventoryItemLevelsWorkflowInput } from "@medusajs/core-flows/inventory/batch-inventory-item-levels";
import { InventoryLevelBatchInput } from "../src/workflows/inventory/batch-levels";

it("bounds raw delete requests at the facade before native sibling callbacks", () => {
  const decode = Schema.decodeUnknownSync(InventoryLevelBatchInput, { onExcessProperty: "error" });
  expect(decode({ delete: ["a", "a", "missing", "b"] })).toEqual({ delete: ["a", "a", "missing", "b"] });
  expect(() => decode({ delete: ["a", "a", "a", "a", "a"] })).toThrow();
});

const prepared = Result.getOrThrow(batchInventoryItemLevelsWorkflow.prepare());
const level = { id: "ilev_before", inventory_item_id: "item", location_id: "location", stocked_quantity: 1.25,
  incoming_quantity: 2.5, reserved_quantity: 0, available_quantity: 1.25, metadata: { retained: true },
  created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z", deleted_at: null };
function nativePort() {
  const createInventoryLevels = vi.fn(async (_input: unknown) => [{ ...level, id: "created" }]);
  const listInventoryLevels = vi.fn(async (_filter: unknown, _config: unknown) => [level]);
  const updateInventoryLevels = vi.fn(async (_input: unknown) => [{ ...level, stocked_quantity: 9 }]);
  const softDeleteInventoryLevels = vi.fn(async (_ids: string[]) => ({ inventory_level_id: ["native-ignored-map"] }));
  const restoreInventoryLevels = vi.fn(async (_ids: string[]) => ({ inventory_level_id: ["native-inverse-map"] }));
  const deleteInventoryLevels = vi.fn(async (_ids: string[]) => undefined);
  const graph = vi.fn(async (_input: unknown) => ({ data: [{ id: "actual-selected", stocked_quantity: 0, reserved_quantity: 0, location_id: "location" }],
    metadata: { count: 1, skip: 0, take: 4 } }));
  const inventory = { createInventoryLevels, listInventoryLevels, updateInventoryLevels, softDeleteInventoryLevels, restoreInventoryLevels, deleteInventoryLevels };
  const services: Readonly<Record<string, unknown>> = { inventory, query: { maxPageSize: 4, graph } };
  const resolve = vi.fn((name: string) => { if (!Object.hasOwn(services, name)) throw new Error("Unexpected provider " + name); return services[name]; });
  const context: StepExecutionContext = { eventGroupId: "level-batch", container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)), invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { ...inventory, resolve, context, graph, run: (input: BatchInventoryItemLevelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}
function nativeStep(name: string) {
  const node = prepared.nodes.find(node => node.kind === "step" && node.name === name);
  if (node?.kind !== "step") throw new Error("Missing genuine Level batch callback " + name); return node;
}
const create = nativeStep("create-inventory-levels"), update = nativeStep("update-inventory-levels-step");
const child = prepared.nodes.find(node => node.kind === "workflow");
if (child?.kind !== "workflow") throw new Error("Missing genuine deletion child");
const deletion = child.workflow.nodes.find(node => node.kind === "step" && node.name === "delete-entities-step");
if (deletion?.kind !== "step") throw new Error("Missing genuine generic deletion");

describe("native Inventory Level parallel batch", () => {
  it("retains exact root identity, direct steps, deletion child and three parallel regions", () => {
    expect(batchInventoryItemLevelsWorkflowId).toBe("batch-inventory-item-levels-workflow");
    expect(prepared.nodes.map(node => node.kind === "workflow" ? "deletion-child" : node.kind === "step" ? node.name : node.kind))
      .toEqual(["create-inventory-levels", "update-inventory-levels-step", "deletion-child"]);
    expect(prepared.parallel).toEqual([{ branches: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }] }]);
    expect(prepared.nodes.length + child.workflow.nodes.length).toBe(6);
    for (const step of [create, update, deletion]) { expect(step.compensation).toBe("transactionCovered"); expect(step.compensate).toBeTypeOf("function"); }
  });

  it("retains raw delete output while mutating actual selected IDs and forwarding false force", async () => {
    const env = nativePort(), input = { create: [{ inventory_item_id: "item", location_id: "new" }],
      update: [{ inventory_item_id: "item", location_id: "location", stocked_quantity: 9 }], delete: ["raw", "missing", "raw"] };
    const result = await Effect.runPromise(env.run(input));
    expect(result).toEqual({ created: [{ ...level, id: "created" }], updated: [{ ...level, stocked_quantity: 9 }], deleted: input.delete });
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith(input.create);
    expect(env.listInventoryLevels).toHaveBeenCalledExactlyOnceWith({ $or: [{ inventory_item_id: "item", location_id: "location" }] }, {});
    expect(env.updateInventoryLevels).toHaveBeenCalledExactlyOnceWith(input.update);
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "inventory_levels", fields: ["id", "stocked_quantity", "reserved_quantity", "location_id"],
      filters: { id: input.delete }, pagination: { take: 4 } });
    expect(env.softDeleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["actual-selected"]);
    expect(env.resolve.mock.calls.flat()).not.toContain("stock_location"); expect(env.resolve.mock.calls.flat()).not.toContain("locking");
  });

  it.each([{}, { create: [] }, { update: [] }])("normalizes omitted branches to calls but retains an own undefined deleted result: %j", async input => {
    const env = nativePort(); env.createInventoryLevels.mockResolvedValueOnce([]); env.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
    const result = await Effect.runPromise(env.run(input));
    expect(result).toEqual({ created: [], updated: [], deleted: undefined }); expect(result !== null && typeof result === "object" && Object.hasOwn(result, "deleted")).toBe(true);
    expect(env.createInventoryLevels).toHaveBeenCalledExactlyOnceWith([]); expect(env.listInventoryLevels).not.toHaveBeenCalled(); expect(env.updateInventoryLevels).not.toHaveBeenCalled();
    expect(env.graph.mock.calls[0]?.[0]).toMatchObject({ filters: { id: [] } }); expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
    expect(env.resolve.mock.calls.flat().filter(name => name === "inventory")).toHaveLength(3); expect(env.resolve.mock.calls.flat().filter(name => name === "query")).toHaveLength(1);
  });

  it("preserves explicit empty deleted arrays and true force for actual selected positive stock", async () => {
    const empty = nativePort(); empty.createInventoryLevels.mockResolvedValueOnce([]); empty.graph.mockResolvedValueOnce({ data: [], metadata: { count: 0, skip: 0, take: 4 } });
    expect(await Effect.runPromise(empty.run({ delete: [] }))).toEqual({ created: [], updated: [], deleted: [] });
    expect(empty.softDeleteInventoryLevels).not.toHaveBeenCalled();
    const env = nativePort(); env.createInventoryLevels.mockResolvedValueOnce([]);
    env.graph.mockResolvedValueOnce({ data: [{ id: "actual-selected", stocked_quantity: 9, reserved_quantity: 0, location_id: "location" }], metadata: { count: 1, skip: 0, take: 4 } });
    expect(await Effect.runPromise(env.run({ delete: ["actual-selected"], force: true }))).toMatchObject({ created: [], updated: [], deleted: ["actual-selected"] });
    expect(env.softDeleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["actual-selected"]);
  });

  it("runs genuine sibling callbacks while creation is pending rather than substituting ordered composition", async () => {
    const env = nativePort(); let release: (() => void) | undefined, createStarted = false;
    env.createInventoryLevels.mockImplementationOnce(async () => { createStarted = true; await new Promise<void>(resolve => { release = resolve; }); return []; });
    env.graph.mockImplementationOnce(async () => { expect(createStarted).toBe(true); expect(env.listInventoryLevels).toHaveBeenCalledTimes(1); release?.();
      return { data: [], metadata: { count: 0, skip: 0, take: 4 } }; });
    try { expect(await Effect.runPromise(env.run({ update: [{ inventory_item_id: "item", location_id: "location" }] }))).toMatchObject({ created: [], updated: [{ ...level, stocked_quantity: 9 }] }); }
    finally { release?.(); }
  });

  it("retains native guard failure and never uses raw IDs as lifecycle membership", async () => {
    const env = nativePort(); env.graph.mockResolvedValueOnce({ data: [{ id: "reserved", stocked_quantity: 100, reserved_quantity: 2, location_id: "guard-location" }], metadata: { count: 1, skip: 0, take: 4 } });
    const result = await Effect.runPromise(Effect.result(env.run({ delete: ["raw"], force: true })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { type: "not_allowed", message:
      "Cannot remove Inventory Levels for guard-location because there are reserved or incoming items at the locations" } });
    expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled(); expect(env.deleteInventoryLevels).not.toHaveBeenCalled(); expect(env.restoreInventoryLevels).not.toHaveBeenCalled();
  });
});

describe("retained native Level batch compensators", () => {
  it("captures generated create IDs and physically deletes them through the plural generated API", async () => {
    const env = nativePort(), response = await create.invoke([{ inventory_item_id: "item", location_id: "new" }], env.context);
    if (!(response instanceof StepResponse) || create.compensate === undefined) throw new Error("Missing native create response");
    expect(response.compensateInput).toEqual(["created"]); await create.compensate(response.compensateInput, env.context);
    expect(env.deleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["created"]); expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
    env.resolve.mockClear(); await create.compensate([], env.context); await create.compensate(undefined, env.context); expect(env.resolve).not.toHaveBeenCalled();
  });

  it("retains empty update compensation and exact selected scalar preimages without metadata replay", async () => {
    const env = nativePort(), response = await update.invoke([{ inventory_item_id: "item", location_id: "location", stocked_quantity: 9 }], env.context);
    if (!(response instanceof StepResponse) || update.compensate === undefined) throw new Error("Missing native update response");
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: [level], selects: ["inventory_item_id", "location_id", "stocked_quantity"], relations: [] });
    env.updateInventoryLevels.mockClear(); await update.compensate(response.compensateInput, env.context);
    expect(env.updateInventoryLevels).toHaveBeenCalledExactlyOnceWith([{ id: level.id, inventory_item_id: "item", location_id: "location", stocked_quantity: 1.25 }]);
    env.resolve.mockClear(); await update.compensate(undefined, env.context); await update.compensate({ dataBeforeUpdate: [], selects: [], relations: [] }, env.context); expect(env.resolve).not.toHaveBeenCalled();
  });

  it("preserves genuine selected-ID restoration and the undefined generic payload TypeError", async () => {
    const env = nativePort(); if (deletion.compensate === undefined) throw new Error("Missing native deletion inverse");
    await deletion.compensate({ entityIdentifiers: ["actual-selected"], moduleRegistrationName: "inventory", compensateMethod: "restoreInventoryLevels" }, env.context);
    expect(env.restoreInventoryLevels).toHaveBeenCalledExactlyOnceWith(["actual-selected"]);
    await expect(deletion.compensate(undefined, env.context)).rejects.toBeInstanceOf(TypeError);
  });
});
