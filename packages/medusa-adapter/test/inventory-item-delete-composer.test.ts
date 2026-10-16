import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { deleteInventoryItemWorkflow, deleteInventoryItemWorkflowId } from "@medusajs/core-flows/inventory/delete-inventory-items";

const prepared = Result.getOrThrow(deleteInventoryItemWorkflow.prepare());
function nativePort(rows: readonly (typeof Schema.JsonObject.Type)[] = [{ id: "selected", reserved_quantity: 0 }], count = rows.length) {
  const graph = vi.fn(async (_input: unknown) => ({ data: rows, metadata: { count, skip: 0, take: 8 } }));
  const softDeleteInventoryItems = vi.fn(async (_ids: string[]) => ({ inventory_item_id: ["actual"], inventory_level_id: ["level"], reservation_item_id: ["reservation"] }));
  const restoreInventoryItems = vi.fn(async (_ids: string[]) => ({ inventory_item_id: ["actual-restored"] }));
  const deleteLinks = vi.fn(async (_input: unknown) => [null, { inventory: { inventory_item_id: ["native-map"] } }]);
  const restoreLinks = vi.fn(async (_input: unknown) => [null, { inventory: { inventory_item_id: ["native-restored"] } }]);
  const services: Readonly<Record<string, unknown>> = { query: { maxPageSize: 8, graph },
    inventory: { softDeleteInventoryItems, restoreInventoryItems }, link: { delete: deleteLinks, restore: restoreLinks } };
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing genuine resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "item-delete-test",
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { graph, resolve, context, softDeleteInventoryItems, restoreInventoryItems, deleteLinks, restoreLinks,
    run: (ids: string[]) => executeWorkflow(prepared, ids, port) };
}
function step(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node?.kind !== "step") throw new Error("Missing genuine Item deletion step " + name);
  return node;
}
const deletion = step("delete-inventory-item-step"), links = step("remove-remote-links"), guard = step("validate-inventory-item-delete");
async function refusal(env: ReturnType<typeof nativePort>, ids: string[]) {
  const result = await Effect.runPromise(Effect.result(env.run(ids)));
  if (Result.isSuccess(result)) throw new Error("Expected genuine native refusal");
  return result.failure;
}

describe("genuine singular Inventory Item deletion composer", () => {
  it("retains the root identity and four ordered native steps with transaction-covered inverses", () => {
    expect(deleteInventoryItemWorkflowId).toBe("delete-inventory-item-workflow");
    expect(prepared.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual([
      "use-query-graph-step", "validate-inventory-item-delete", "delete-inventory-item-step", "remove-remote-links",
    ]);
    for (const node of [deletion, links]) { expect(node.compensation).toBe("transactionCovered"); expect(node.compensate).toBeTypeOf("function"); }
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });

  it("queries reserved quantities but deletes and returns raw IDs including missing and duplicate entries", async () => {
    const env = nativePort([{ id: "selected-b", reserved_quantity: 0 }, { id: "selected-a", reserved_quantity: -2.5 }]);
    const ids = ["raw-b", "missing", "raw-a", "raw-b"];
    expect(await Effect.runPromise(env.run(ids))).toEqual(ids);
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "inventory", fields: ["id", "reserved_quantity"],
      filters: { id: ids }, pagination: { take: 8 } });
    expect(env.softDeleteInventoryItems).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith({ inventory: { inventory_item_id: ids } });
    expect(env.resolve.mock.calls).toEqual([["query"], ["inventory"], ["link"]]);
    expect(env.restoreInventoryItems).not.toHaveBeenCalled(); expect(env.restoreLinks).not.toHaveBeenCalled();
  });

  it("calls Inventory and Link for an empty array after the empty Query", async () => {
    const env = nativePort([]);
    expect(await Effect.runPromise(env.run([]))).toEqual([]);
    expect(env.softDeleteInventoryItems).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith({ inventory: { inventory_item_id: [] } });
    expect(env.resolve.mock.calls).toEqual([["query"], ["inventory"], ["link"]]);
  });

  it("retains positive computed reservation refusal in actual selected row order before both mutations", async () => {
    const env = nativePort([{ id: "zero", reserved_quantity: 0 }, { id: "b", reserved_quantity: 0.125 },
      { id: "negative", reserved_quantity: -7 }, { id: "a", reserved_quantity: 1 }]);
    expect(await refusal(env, ["a", "b"])).toMatchObject({ type: "invalid_data", message:
      "Cannot remove following inventory item(s) since they have reservations: [b, a]." });
    expect(env.resolve.mock.calls).toEqual([["query"]]); expect(env.softDeleteInventoryItems).not.toHaveBeenCalled(); expect(env.deleteLinks).not.toHaveBeenCalled();
    await expect(guard.invoke({ inventory_items: [{ id: "exact-decimal", reserved_quantity: "0.0000000000000000001" }] }, env.context))
      .rejects.toMatchObject({ type: "invalid_data" });
  });

  it.each([
    ["extra projection field", [{ id: "a", reserved_quantity: 0, stocked_quantity: 999 }]],
    ["missing computed quantity", [{ id: "a" }]],
    ["nonfinite quantity", [{ id: "a", reserved_quantity: Number.POSITIVE_INFINITY }]],
    ["ninth selected Item", Array.from({ length: 9 }, (_, index) => ({ id: String(index), reserved_quantity: 0 }))],
  ] as const)("refuses unsupported checked projection: %s", async (_name, rows) => {
    const env = nativePort(rows);
    expect(await refusal(env, ["raw"])).toMatchObject({ reason: "unsupportedProfile" });
    expect(env.softDeleteInventoryItems).not.toHaveBeenCalled(); expect(env.deleteLinks).not.toHaveBeenCalled();
  });

  it("requires complete graph membership even though the response is the raw input", async () => {
    const env = nativePort([{ id: "a", reserved_quantity: 0 }], 9);
    expect(await refusal(env, ["raw"])).toMatchObject({ reason: "unsupportedProfile", detail: "The graph step requires a complete bounded result" });
    expect(env.softDeleteInventoryItems).not.toHaveBeenCalled();
  });

  it.each(["query", "inventory", "link"] as const)("propagates exact %s failure once without invoking inverse callbacks", async phase => {
    const env = nativePort(), failure = new Error("native " + phase + " failed");
    if (phase === "query") env.graph.mockRejectedValueOnce(failure);
    else if (phase === "inventory") env.softDeleteInventoryItems.mockRejectedValueOnce(failure);
    else env.deleteLinks.mockRejectedValueOnce(failure);
    expect(await refusal(env, ["raw"])).toBe(failure);
    expect(env.softDeleteInventoryItems).toHaveBeenCalledTimes(phase === "query" ? 0 : 1);
    expect(env.deleteLinks).toHaveBeenCalledTimes(phase === "link" ? 1 : 0);
    expect(env.restoreInventoryItems).not.toHaveBeenCalled(); expect(env.restoreLinks).not.toHaveBeenCalled();
  });
});

describe("retained genuine Item and grouped Link compensators", () => {
  it("ignores actual generated Item maps and captures raw IDs for the native inverse", async () => {
    const env = nativePort(), ids = ["missing", "a", "a"];
    const response = await deletion.invoke(ids, env.context);
    if (!(response instanceof StepResponse) || deletion.compensate === undefined) throw new Error("Missing native Item response");
    expect(response.output).toBeUndefined(); expect(response.compensateInput).toEqual(ids);
    await deletion.compensate(response.compensateInput, env.context);
    expect(env.restoreInventoryItems).toHaveBeenCalledExactlyOnceWith(ids);
  });

  it("skips undefined and empty Item inverses before resolving Inventory", async () => {
    const env = nativePort(); if (deletion.compensate === undefined) throw new Error("Missing native Item inverse");
    await deletion.compensate(undefined, env.context); await deletion.compensate([], env.context);
    expect(env.resolve).not.toHaveBeenCalled(); expect(env.restoreInventoryItems).not.toHaveBeenCalled();
  });

  it("retains the grouped empty Link inverse rather than treating it as an absent inverse", async () => {
    const env = nativePort(), grouped = { inventory: { inventory_item_id: [] } };
    const response = await links.invoke(grouped, env.context);
    if (!(response instanceof StepResponse) || links.compensate === undefined) throw new Error("Missing native Link response");
    expect(response.output).toEqual(grouped); expect(response.compensateInput).toEqual(grouped);
    await links.compensate(response.compensateInput, env.context);
    expect(env.restoreLinks).toHaveBeenCalledExactlyOnceWith(grouped);
    expect(env.resolve.mock.calls).toEqual([["link"], ["link"]]);
    env.resolve.mockClear(); await links.compensate(undefined, env.context); expect(env.resolve).not.toHaveBeenCalled();
  });

  it("preserves raw duplicate Link endpoints and propagates exact restore failures", async () => {
    const env = nativePort(), grouped = { inventory: { inventory_item_id: ["b", "missing", "b"] } };
    if (links.compensate === undefined || deletion.compensate === undefined) throw new Error("Missing native inverses");
    await links.compensate(grouped, env.context); expect(env.restoreLinks).toHaveBeenCalledExactlyOnceWith(grouped);
    const failure = new Error("native inverse failed"); env.restoreInventoryItems.mockRejectedValueOnce(failure);
    await expect(deletion.compensate(["b", "missing", "b"], env.context)).rejects.toBe(failure);
    env.restoreLinks.mockRejectedValueOnce(failure); await expect(links.compensate(grouped, env.context)).rejects.toBe(failure);
  });
});
