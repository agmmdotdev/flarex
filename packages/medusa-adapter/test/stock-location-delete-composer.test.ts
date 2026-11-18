import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { MessageAggregator } from "@medusajs/framework/utils/portable";
import { dispatchCascadedUpdateMutations } from "@medusajs/drizzle/mutation-events";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { deleteStockLocationsWorkflow, deleteStockLocationsWorkflowId,
  type DeleteStockLocationWorkflowInput } from "@medusajs/core-flows/stock-location/delete-stock-locations";

const prepared = Result.getOrThrow(deleteStockLocationsWorkflow.prepare());
type Deleted = Record<string, string[]>;

/** Genuine composer and callbacks over scripted module and Link ports. The
 * connected tests prove actual selected rows, alias production and persistence. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "stock-location-delete-group",
    // Generic native container boundary; exact resource resolution is checked.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: DeleteStockLocationWorkflowInput) => executeWorkflow(prepared, input, port) };
}

function nativeStep(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Stock Location deletion step " + name);
  return node;
}

function services(actual: Deleted = {}) {
  const softDeleteStockLocations = vi.fn(async () => actual);
  const restoreStockLocations = vi.fn(async () => undefined);
  const remove = vi.fn(async () => [null, {}]);
  const restore = vi.fn(async () => [null, {}]);
  return { softDeleteStockLocations, restoreStockLocations, remove, restore,
    modules: { stock_location: { softDeleteStockLocations, restoreStockLocations }, link: { delete: remove, restore } } };
}

function precedes(first: { mock: { invocationCallOrder: readonly number[] } }, second: { mock: { invocationCallOrder: readonly number[] } }) {
  const left = first.mock.invocationCallOrder[0], right = second.mock.invocationCallOrder[0];
  if (left === undefined || right === undefined) throw new Error("Missing required native call");
  expect(left).toBeLessThan(right);
}

describe("native Stock Location deletion composer", () => {
  it("retains the genuine conventional restore source spelling when no subscriber is registered", async () => {
    const messageAggregator = new MessageAggregator(), context = { messageAggregator };
    await dispatchCascadedUpdateMutations({ StockLocation: [{ id: "loc", deleted_at: null }] }, context,
      row => ({ entity: row, originalEntity: { deleted_at: "2026-10-16T00:00:00.000Z" } }));
    expect(messageAggregator.getMessages().default).toMatchObject([{ name: "stock.stock-location.restored",
      metadata: { source: "stock", object: "stock_location", action: "restored" }, data: { id: "loc" } }]);
  });
  it("keeps native identities, exactly two transaction-covered callbacks and the unhooked void result", () => {
    expect(deleteStockLocationsWorkflowId).toBe("delete-stock-locations-workflow");
    expect(prepared.nodes.map(node => node.name)).toEqual(["delete-stock-locations-step", "remove-remote-links"]);
    for (const name of ["delete-stock-locations-step", "remove-remote-links"]) {
      const node = nativeStep(name);
      expect(node.compensation).toBe("transactionCovered");
      expect(node.compensate).toBeTypeOf("function");
      expect(node.hook).toBe(false);
    }
  });

  it("cleans the actual returned identities and both aliases rather than the requested IDs", async () => {
    const ids = ["sloc_z", "missing", "sloc_z", "already_deleted"];
    const actual = { stock_location_id: ["sloc_z"], location_id: ["sloc_z"] };
    const bound = services(actual), env = nativePort(bound.modules);
    expect(await Effect.runPromise(env.run({ ids }))).toBeUndefined();
    expect(bound.softDeleteStockLocations).toHaveBeenCalledExactlyOnceWith(ids);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith({ stock_location: actual });
    precedes(bound.softDeleteStockLocations, bound.remove);
    expect(env.resolve.mock.calls).toEqual([["stock_location"], ["link"]]);
    expect(bound.restoreStockLocations).not.toHaveBeenCalled(); expect(bound.restore).not.toHaveBeenCalled();
    expect(ids).toEqual(["sloc_z", "missing", "sloc_z", "already_deleted"]);
  });

  it.each([
    { reason: "empty request", ids: [] },
    { reason: "missing target", ids: ["missing"] },
    { reason: "already-deleted target with a retained active pivot", ids: ["already_deleted", "already_deleted"] },
  ])("still resolves and calls Link with an actual empty map for $reason", async ({ ids }) => {
    const bound = services(), env = nativePort(bound.modules);
    expect(await Effect.runPromise(env.run({ ids }))).toBeUndefined();
    expect(bound.softDeleteStockLocations).toHaveBeenCalledExactlyOnceWith(ids);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith({ stock_location: {} });
    expect(env.resolve.mock.calls).toEqual([["stock_location"], ["link"]]);
    precedes(bound.softDeleteStockLocations, bound.remove);
  });

  it("preserves the service's actual order without recreating aliases or repeating requested IDs", async () => {
    const actual = { stock_location_id: ["sloc_b", "sloc_a"], location_id: ["sloc_b", "sloc_a"] };
    const bound = services(actual), env = nativePort(bound.modules);
    await Effect.runPromise(env.run({ ids: ["sloc_a", "sloc_b", "sloc_a"] }));
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith({ stock_location: actual });
    expect(actual).toEqual({ stock_location_id: ["sloc_b", "sloc_a"], location_id: ["sloc_b", "sloc_a"] });
  });

  it("retains the original requested list for Location compensation, including missing and repeated IDs", async () => {
    const actual = { stock_location_id: ["sloc_a"], location_id: ["sloc_a"] };
    const bound = services(actual), env = nativePort(bound.modules), step = nativeStep("delete-stock-locations-step");
    const ids = ["sloc_a", "missing", "sloc_a"];
    const response = await step.invoke(ids, env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native Location inverse");
    expect(response.output).toEqual({ stock_location: actual });
    expect(response.compensateInput).toBe(ids);
    expect(bound.softDeleteStockLocations).toHaveBeenCalledExactlyOnceWith(ids);
    await step.compensate(undefined, env.context); await step.compensate([], env.context);
    expect(bound.restoreStockLocations).not.toHaveBeenCalled();
    expect(env.resolve.mock.calls).toEqual([["stock_location"]]);
    await step.compensate(response.compensateInput, env.context);
    expect(bound.restoreStockLocations).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.resolve.mock.calls).toEqual([["stock_location"], ["stock_location"]]);
  });

  it.each([
    { stock_location: {} },
    { stock_location: { stock_location_id: ["sloc_a"], location_id: ["sloc_a"] } },
  ])("retains the actual grouped map for Link compensation, including a truthy empty map: %j", async endpoint => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep("remove-remote-links");
    const response = await step.invoke(endpoint, env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native Link inverse");
    expect(response.output).toEqual(endpoint); expect(response.compensateInput).toEqual(endpoint);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith(endpoint);
    await step.compensate(undefined, env.context);
    expect(bound.restore).not.toHaveBeenCalled();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.restore).toHaveBeenCalledExactlyOnceWith(endpoint);
    expect(env.resolve.mock.calls).toEqual([["link"], ["link"]]);
  });

  it("ignores native Link errors-as-data while preserving native undefined completion", async () => {
    const actual = { stock_location_id: ["sloc_a"], location_id: ["sloc_a"] }, bound = services(actual);
    const error = new Error("Native Link errors-as-data witness");
    const remove = vi.fn(async () => [[{ serviceName: "locationLink", method: "softDelete", args: {}, error }], {}]);
    const env = nativePort({ ...bound.modules, link: { ...bound.modules.link, delete: remove } });
    expect(await Effect.runPromise(env.run({ ids: ["sloc_a"] }))).toBeUndefined();
    expect(remove).toHaveBeenCalledExactlyOnceWith({ stock_location: actual });
    expect(bound.restoreStockLocations).not.toHaveBeenCalled(); expect(bound.restore).not.toHaveBeenCalled();
  });

  it("propagates a Location failure before Link resolution", async () => {
    const bound = services(), failure = new Error("Native Stock Location deletion refused");
    const softDeleteStockLocations = vi.fn(async () => { throw failure; });
    const env = nativePort({ ...bound.modules, stock_location: { ...bound.modules.stock_location, softDeleteStockLocations } });
    const result = await Effect.runPromise(Effect.result(env.run({ ids: ["sloc_a"] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(env.resolve.mock.calls).toEqual([["stock_location"]]);
    expect(bound.remove).not.toHaveBeenCalled(); expect(bound.restoreStockLocations).not.toHaveBeenCalled();
  });

  it("propagates a late Link rejection without invoking transaction-covered compensation", async () => {
    const actual = { stock_location_id: ["sloc_a"], location_id: ["sloc_a"] }, bound = services(actual);
    const failure = new Error("Native Link deletion rejected"), remove = vi.fn(async () => { throw failure; });
    const env = nativePort({ ...bound.modules, link: { ...bound.modules.link, delete: remove } });
    const result = await Effect.runPromise(Effect.result(env.run({ ids: ["sloc_a"] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(bound.softDeleteStockLocations).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledExactlyOnceWith({ stock_location: actual });
    expect(bound.restoreStockLocations).not.toHaveBeenCalled(); expect(bound.restore).not.toHaveBeenCalled();
  });
});
