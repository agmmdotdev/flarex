import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { deleteInventoryLevelsWorkflow, deleteInventoryLevelsWorkflowId,
  type DeleteInventoryLevelsWorkflowInput } from "@medusajs/core-flows/inventory/delete-inventory-levels";

const prepared = Result.getOrThrow(deleteInventoryLevelsWorkflow.prepare());
const level = { id: "ilev_a", stocked_quantity: 0, reserved_quantity: 0, location_id: "sloc_a" };
const Fields = ["id", "stocked_quantity", "reserved_quantity", "location_id"];

/** Genuine composer and callbacks over scripted foreign resources. The graph
 * port supplies its already selected rows; connected tests own real selection,
 * lifecycle writes, full native result authentication and module events. */
function nativePort(rows: readonly (typeof Schema.JsonObject.Type)[] = [level], count = rows.length) {
  const graph = vi.fn(async (_input: unknown) => ({ data: rows, metadata: { count, skip: 0, take: 4 } }));
  const softDeleteInventoryLevels = vi.fn(async (_ids: string[]) => ({ inventory_level_id: ["discarded_native_map"] }));
  const restoreInventoryLevels = vi.fn(async (_ids: string[]) => ({ inventory_level_id: ["restored_native_map"] }));
  const services: Readonly<Record<string, unknown>> = { query: { maxPageSize: 4, graph },
    inventory: { softDeleteInventoryLevels, restoreInventoryLevels } };
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "inventory-level-delete-group",
    // The generic native container resolves the exact resources asserted below.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, graph, softDeleteInventoryLevels, restoreInventoryLevels,
    run: (input: DeleteInventoryLevelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}
function nativeStep(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native step " + name);
  return node;
}
const guard = nativeStep("validate-inventory-levels-delete");
const deletion = nativeStep("delete-entities-step");
const reservationMessage = (locations: string) => `Cannot remove Inventory Levels for ${locations} because there are reserved or incoming items at the locations`;
const stockMessage = (locations: string) => `Cannot remove Inventory Levels for ${locations} because there are stocked items at the locations. Use force flag to delete anyway.`;

async function failedWorkflow(env: ReturnType<typeof nativePort>, input: DeleteInventoryLevelsWorkflowInput) {
  const result = await Effect.runPromise(Effect.result(env.run(input)));
  if (Result.isSuccess(result)) throw new Error("Expected native workflow refusal");
  return result.failure;
}

describe("native Inventory Level deletion composer", () => {
  it("retains genuine identity, three native steps and transaction-covered deletion callback", () => {
    expect(deleteInventoryLevelsWorkflowId).toBe("delete-inventory-levels-workflow");
    expect(prepared.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual([
      "use-remote-query", "validate-inventory-levels-delete", "delete-entities-step",
    ]);
    expect(deletion.compensation).toBe("transactionCovered"); expect(deletion.compensate).toBeTypeOf("function");
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });

  it("strips force from native filters, selects exactly four fields and deletes actual selected IDs in query order", async () => {
    const rows = [{ ...level, id: "selected_b", stocked_quantity: 1.25 }, { ...level, id: "selected_a" }];
    const env = nativePort(rows);
    expect(await Effect.runPromise(env.run({ id: ["requested_a", "requested_b", "requested_a"], force: true }))).toBeUndefined();
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "inventory_levels", fields: Fields,
      filters: { id: ["requested_a", "requested_b", "requested_a"] }, pagination: { take: 4 } });
    expect(env.softDeleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["selected_b", "selected_a"]);
    expect(env.resolve.mock.calls).toEqual([["query"], ["inventory"]]);
    expect(env.restoreInventoryLevels).not.toHaveBeenCalled();
  });

  it("retains empty selectors and resolves Query and Inventory even when no levels match", async () => {
    const env = nativePort([]);
    expect(await Effect.runPromise(env.run({}))).toBeUndefined();
    expect(env.graph).toHaveBeenCalledExactlyOnceWith({ entity: "inventory_levels", fields: Fields,
      filters: {}, pagination: { take: 4 } });
    expect(env.resolve.mock.calls).toEqual([["query"], ["inventory"]]);
    expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
  });

  it("leaves empty ID filters as supplied and skips the lifecycle method", async () => {
    const env = nativePort([]);
    expect(await Effect.runPromise(env.run({ id: [], force: false }))).toBeUndefined();
    expect(env.graph.mock.calls[0]?.[0]).toMatchObject({ filters: { id: [] } });
    expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
  });

  it("preserves genuine missing incoming projection behavior despite positive incoming in the stored source", async () => {
    const complete = { ...level, incoming_quantity: 7, inventory_item_id: "iitem_a", available_quantity: 0,
      metadata: null, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z", deleted_at: null };
    // Script the native four-field projection, never a synthetic zero incoming.
    const selected = { id: complete.id, stocked_quantity: complete.stocked_quantity,
      reserved_quantity: complete.reserved_quantity, location_id: complete.location_id };
    expect(Object.hasOwn(selected, "incoming_quantity")).toBe(false);
    const env = nativePort([selected]);
    expect(await Effect.runPromise(env.run({ id: complete.id }))).toBeUndefined();
    expect(env.softDeleteInventoryLevels).toHaveBeenCalledExactlyOnceWith([complete.id]);
    await expect(guard.invoke({ inventoryLevels: [complete], force: true }, env.context)).rejects.toMatchObject({
      type: "not_allowed", message: reservationMessage("sloc_a"),
    });
  });

  it("keeps reservation refusal before stock refusal and force never bypasses reserved quantities", async () => {
    for (const force of [false, true]) {
      const env = nativePort([{ ...level, location_id: "stock", stocked_quantity: 9 },
        { ...level, id: "reserved", location_id: "reserved", reserved_quantity: 0.5 }]);
      expect(await failedWorkflow(env, { force })).toMatchObject({ type: "not_allowed", message: reservationMessage("reserved") });
      expect(env.resolve.mock.calls).toEqual([["query"]]); expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
    }
  });

  it("deduplicates refused location names in first occurrence order", async () => {
    const rows = ["sloc_b", "sloc_a", "sloc_b"].map((location_id, index) => ({ ...level, id: "level_" + index,
      location_id, reserved_quantity: 1 }));
    const env = nativePort(rows);
    expect(await failedWorkflow(env, { force: true })).toMatchObject({ type: "not_allowed", message: reservationMessage("sloc_b, sloc_a") });
    await expect(guard.invoke({ inventoryLevels: rows.map(row => ({ ...row, reserved_quantity: 0, stocked_quantity: 1 })) }, env.context))
      .rejects.toMatchObject({ type: "not_allowed", message: stockMessage("sloc_b, sloc_a") });
  });

  it("requires force for positive selected stock while zero and negative quantities remain deletable", async () => {
    const positive = nativePort([{ ...level, stocked_quantity: 0.25 }]);
    expect(await failedWorkflow(positive, {})).toMatchObject({ type: "not_allowed", message: stockMessage("sloc_a") });
    expect(positive.softDeleteInventoryLevels).not.toHaveBeenCalled();
    const nonpositive = nativePort([{ ...level, stocked_quantity: -5, reserved_quantity: -2 }, { ...level, id: "zero" }]);
    expect(await Effect.runPromise(nonpositive.run({}))).toBeUndefined();
    expect(nonpositive.softDeleteInventoryLevels).toHaveBeenCalledExactlyOnceWith(["ilev_a", "zero"]);
  });

  it("requires a complete bounded graph result before guard or deletion", async () => {
    const env = nativePort([level], 5);
    expect(await failedWorkflow(env, {})).toMatchObject({ reason: "unsupportedProfile", detail: "The graph step requires a complete bounded result" });
    expect(env.resolve.mock.calls).toEqual([["query"]]); expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
  });

  it.each([
    ["fifth row", Array.from({ length: 5 }, (_, index) => ({ ...level, id: "level_" + index }))],
    ["extra unselected field", [{ ...level, incoming_quantity: 1 }]],
    ["missing projected field", [{ id: level.id, stocked_quantity: 0, location_id: level.location_id }]],
    ["nonfinite quantity", [{ ...level, reserved_quantity: Number.POSITIVE_INFINITY }]],
  ] as const)("refuses unsupported projected rows: %s", async (_name, rows) => {
    const env = nativePort(rows);
    expect(await failedWorkflow(env, {})).toMatchObject({ reason: "unsupportedProfile",
      detail: "Inventory Level deletion query exceeds its admitted native result contract" });
    expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled(); expect(env.resolve.mock.calls).toEqual([["query"]]);
  });

  it.each(["query", "delete"] as const)("propagates the exact foreign %s failure without retry or inverse", async phase => {
    const env = nativePort(), failure = new Error("native " + phase + " failed");
    if (phase === "query") env.graph.mockRejectedValueOnce(failure);
    else env.softDeleteInventoryLevels.mockRejectedValueOnce(failure);
    expect(await failedWorkflow(env, {})).toBe(failure);
    expect(env.graph).toHaveBeenCalledTimes(1); expect(env.restoreInventoryLevels).not.toHaveBeenCalled();
    expect(env.softDeleteInventoryLevels).toHaveBeenCalledTimes(phase === "query" ? 0 : 1);
  });
});

describe("genuine generic entity deletion callback", () => {
  it("discards native result maps and stores exact selected identities and method for compensation", async () => {
    const env = nativePort(), ids = ["selected_b", "selected_a", "selected_b"];
    const response = await deletion.invoke({ moduleRegistrationName: "inventory", invokeMethod: "softDeleteInventoryLevels",
      compensateMethod: "restoreInventoryLevels", data: ids }, env.context);
    if (!(response instanceof StepResponse) || deletion.compensate === undefined) throw new Error("Missing native deletion response");
    expect(response.output).toBeUndefined(); expect(response.compensateInput).toEqual({ entityIdentifiers: ids,
      moduleRegistrationName: "inventory", compensateMethod: "restoreInventoryLevels" });
    await deletion.compensate(response.compensateInput, env.context);
    expect(env.restoreInventoryLevels).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.resolve.mock.calls).toEqual([["inventory"], ["inventory"]]);
  });

  it("resolves Inventory for empty deletion but skips empty compensation resolution", async () => {
    const env = nativePort([]);
    const response = await deletion.invoke({ moduleRegistrationName: "inventory", invokeMethod: "softDeleteInventoryLevels",
      compensateMethod: "restoreInventoryLevels", data: [] }, env.context);
    if (!(response instanceof StepResponse) || deletion.compensate === undefined) throw new Error("Missing native empty response");
    expect(response.output).toBeUndefined(); expect(response.compensateInput).toEqual({ entityIdentifiers: [],
      moduleRegistrationName: "inventory", compensateMethod: "restoreInventoryLevels" });
    await deletion.compensate(response.compensateInput, env.context);
    expect(env.resolve.mock.calls).toEqual([["inventory"]]); expect(env.softDeleteInventoryLevels).not.toHaveBeenCalled();
    expect(env.restoreInventoryLevels).not.toHaveBeenCalled();
  });

  it("retains the native undefined-compensation destructuring TypeError before resolution", async () => {
    const env = nativePort([]);
    if (deletion.compensate === undefined) throw new Error("Missing native inverse");
    await expect(deletion.compensate(undefined, env.context)).rejects.toBeInstanceOf(TypeError);
    expect(env.resolve).not.toHaveBeenCalled();
  });

  it("propagates the exact restore failure once", async () => {
    const env = nativePort([]), failure = new Error("native restore failed");
    if (deletion.compensate === undefined) throw new Error("Missing native inverse");
    env.restoreInventoryLevels.mockRejectedValueOnce(failure);
    await expect(deletion.compensate({ entityIdentifiers: ["ilev_a"], moduleRegistrationName: "inventory",
      compensateMethod: "restoreInventoryLevels" }, env.context)).rejects.toBe(failure);
    expect(env.restoreInventoryLevels).toHaveBeenCalledTimes(1);
  });
});