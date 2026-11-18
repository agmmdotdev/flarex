import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { deleteStoresWorkflow, deleteStoresWorkflowId,
  type DeleteStoresWorkflowInput } from "@medusajs/core-flows/store/delete-stores";

const prepared = Result.getOrThrow(deleteStoresWorkflow.prepare());

/** Genuine native composition over scripted foreign services. Connected tests
 * own real Store/pivot lifecycle, native module events and transaction rollback. */
function nativePort() {
  const softDeleteStores = vi.fn(async (_ids: string[]) => ({ store_id: ["native-map-result"] }));
  const restoreStores = vi.fn(async (_ids: string[]) => ({ store_id: ["native-restored-map"] }));
  const deleteLinks = vi.fn(async (_input: unknown) => [null, { store: { store_id: ["native-link-result"] } }]);
  const restoreLinks = vi.fn(async (_input: unknown) => [null, { store: { store_id: ["native-link-restore"] } }]);
  const services: Readonly<Record<string, unknown>> = {
    store: { softDeleteStores, restoreStores }, link: { delete: deleteLinks, restore: restoreLinks },
  };
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing genuine resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "store-delete-test",
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, softDeleteStores, restoreStores, deleteLinks, restoreLinks,
    run: (input: DeleteStoresWorkflowInput) => executeWorkflow(prepared, input, port) };
}

function step(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node?.kind !== "step") throw new Error("Missing genuine Store deletion step " + name);
  return node;
}
const deletion = step("delete-stores"), links = step("remove-remote-links");

describe("genuine Store deletion composer", () => {
  it("retains both native identities, ordered steps and transaction-covered inverses", () => {
    expect(deleteStoresWorkflowId).toBe("delete-stores");
    expect(prepared.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual([
      "delete-stores", "remove-remote-links",
    ]);
    for (const node of [deletion, links]) {
      expect(node.compensation).toBe("transactionCovered");
      expect(node.compensate).toBeTypeOf("function");
    }
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });

  it("calls Store then Link with raw duplicate and missing IDs and discards native maps", async () => {
    const env = nativePort(), ids = ["raw-b", "missing", "raw-a", "raw-b"];
    expect(await Effect.runPromise(env.run({ ids }))).toBeUndefined();
    expect(env.softDeleteStores).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith({ store: { store_id: ids } });
    const storeOrder = env.softDeleteStores.mock.invocationCallOrder[0], linkOrder = env.deleteLinks.mock.invocationCallOrder[0];
    if (storeOrder === undefined || linkOrder === undefined) throw new Error("Missing genuine provider calls");
    expect(storeOrder).toBeLessThan(linkOrder);
    expect(env.resolve.mock.calls).toEqual([["store"], ["link"]]);
    expect(env.restoreStores).not.toHaveBeenCalled();
    expect(env.restoreLinks).not.toHaveBeenCalled();
  });

  it("retains both provider calls and the void result for empty raw IDs", async () => {
    const env = nativePort();
    expect(await Effect.runPromise(env.run({ ids: [] }))).toBeUndefined();
    expect(env.softDeleteStores).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith({ store: { store_id: [] } });
    expect(env.resolve.mock.calls).toEqual([["store"], ["link"]]);
  });

  it.each(["store", "link"] as const)("propagates exact %s failure once with no callback inverse", async phase => {
    const env = nativePort(), failure = new Error("native " + phase + " failure");
    if (phase === "store") env.softDeleteStores.mockRejectedValueOnce(failure);
    else env.deleteLinks.mockRejectedValueOnce(failure);
    const result = await Effect.runPromise(Effect.result(env.run({ ids: ["raw"] })));
    if (Result.isSuccess(result)) throw new Error("Expected genuine native failure");
    expect(result.failure).toBe(failure);
    expect(env.softDeleteStores).toHaveBeenCalledExactlyOnceWith(["raw"]);
    expect(env.deleteLinks).toHaveBeenCalledTimes(phase === "link" ? 1 : 0);
    expect(env.restoreStores).not.toHaveBeenCalled();
    expect(env.restoreLinks).not.toHaveBeenCalled();
  });
});

describe("retained genuine Store and grouped Link callbacks", () => {
  it("captures raw Store IDs for restore while discarding the lifecycle map", async () => {
    const env = nativePort(), ids = ["missing", "a", "a"];
    const response = await deletion.invoke(ids, env.context);
    if (!(response instanceof StepResponse) || deletion.compensate === undefined) throw new Error("Missing native Store response");
    expect(response.output).toBeUndefined();
    expect(response.compensateInput).toBe(ids);
    await deletion.compensate(response.compensateInput, env.context);
    expect(env.restoreStores).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.resolve.mock.calls).toEqual([["store"], ["store"]]);
  });

  it("calls the empty Store forward callback but skips undefined and empty inverses before resolution", async () => {
    const env = nativePort();
    const response = await deletion.invoke([], env.context);
    if (!(response instanceof StepResponse) || deletion.compensate === undefined) throw new Error("Missing native Store response");
    expect(response.output).toBeUndefined();
    expect(response.compensateInput).toEqual([]);
    expect(env.softDeleteStores).toHaveBeenCalledExactlyOnceWith([]);
    env.resolve.mockClear();
    await deletion.compensate(undefined, env.context);
    await deletion.compensate(response.compensateInput, env.context);
    expect(env.resolve).not.toHaveBeenCalled();
    expect(env.restoreStores).not.toHaveBeenCalled();
  });

  it("retains grouped empty Link invocation and restore instead of treating them as absent", async () => {
    const env = nativePort(), grouped = { store: { store_id: [] } };
    const response = await links.invoke(grouped, env.context);
    if (!(response instanceof StepResponse) || links.compensate === undefined) throw new Error("Missing native Link response");
    expect(response.output).toEqual(grouped);
    expect(response.compensateInput).toEqual(grouped);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith(grouped);
    await links.compensate(response.compensateInput, env.context);
    expect(env.restoreLinks).toHaveBeenCalledExactlyOnceWith(grouped);
    expect(env.resolve.mock.calls).toEqual([["link"], ["link"]]);
    env.resolve.mockClear();
    await links.compensate(undefined, env.context);
    expect(env.resolve).not.toHaveBeenCalled();
  });

  it("keeps the native Link entry-array empty branch distinct from grouped empty Store IDs", async () => {
    const env = nativePort();
    const response = await links.invoke([], env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing native Link response");
    expect(response.output).toBeUndefined();
    expect(response.compensateInput).toBeUndefined();
    expect(env.resolve).not.toHaveBeenCalled();
    expect(env.deleteLinks).not.toHaveBeenCalled();
  });

  it("preserves duplicate endpoints and native grouping order across Link entries", async () => {
    const env = nativePort(), grouped = { store: { store_id: ["b", "missing", "b", "a", "b"] } };
    const response = await links.invoke([
      { store: { store_id: ["b", "missing", "b"] } }, { store: { store_id: ["a", "b"] } },
    ], env.context);
    if (!(response instanceof StepResponse) || links.compensate === undefined) throw new Error("Missing native Link response");
    expect(response.output).toEqual(grouped);
    expect(response.compensateInput).toEqual(grouped);
    expect(env.deleteLinks).toHaveBeenCalledExactlyOnceWith(grouped);
    await links.compensate(response.compensateInput, env.context);
    expect(env.restoreLinks).toHaveBeenCalledExactlyOnceWith(grouped);
  });

  it("propagates exact Store and Link restore failures without retry", async () => {
    const env = nativePort(), failure = new Error("native restore failure");
    if (deletion.compensate === undefined || links.compensate === undefined) throw new Error("Missing native inverses");
    env.restoreStores.mockRejectedValueOnce(failure);
    await expect(deletion.compensate(["b", "missing", "b"], env.context)).rejects.toBe(failure);
    env.restoreLinks.mockRejectedValueOnce(failure);
    await expect(links.compensate({ store: { store_id: ["b", "missing", "b"] } }, env.context)).rejects.toBe(failure);
    expect(env.restoreStores).toHaveBeenCalledExactlyOnceWith(["b", "missing", "b"]);
    expect(env.restoreLinks).toHaveBeenCalledExactlyOnceWith({ store: { store_id: ["b", "missing", "b"] } });
  });
});
