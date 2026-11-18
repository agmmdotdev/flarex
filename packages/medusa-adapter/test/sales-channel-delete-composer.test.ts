import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { deleteSalesChannelsWorkflow, deleteSalesChannelsWorkflowId,
  type DeleteSalesChannelsWorkflowInput } from "@medusajs/core-flows/sales-channel/delete-sales-channels";

const prepared = Result.getOrThrow(deleteSalesChannelsWorkflow.prepare());

/** Genuine composer and callbacks over scripted foreign ports. Persistence,
 * Link participant scheduling and settlement are proved by connected tests. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "sales-channel-delete-group",
    // Native generic container boundary; exact resolution is asserted below.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: DeleteSalesChannelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}

function nativeStep(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Sales Channel deletion step " + name);
  return node;
}

function services() {
  const listStores = vi.fn(async () => []);
  const softDeleteSalesChannels = vi.fn(async () => undefined);
  const restoreSalesChannels = vi.fn(async () => undefined);
  const remove = vi.fn(async () => [null, {}]);
  const restore = vi.fn(async () => [null, {}]);
  const emit = vi.fn(async () => undefined);
  return { listStores, softDeleteSalesChannels, restoreSalesChannels, remove, restore, emit,
    modules: { store: { listStores }, sales_channel: { softDeleteSalesChannels, restoreSalesChannels },
      link: { delete: remove, restore }, event_bus: { emit } } };
}

function callOrder(calls: readonly { readonly mock: { readonly invocationCallOrder: readonly number[] } }[]) {
  const orders = calls.map(call => {
    const order = call.mock.invocationCallOrder[0];
    if (order === undefined) throw new Error("Missing required native call");
    return order;
  });
  expect(orders).toEqual([...orders].sort((left, right) => left - right));
  expect(new Set(orders).size).toBe(orders.length);
}

describe("native Sales Channel deletion composer", () => {
  it("retains native identities, transaction-covered compensators and the unhooked void result", () => {
    expect(deleteSalesChannelsWorkflowId).toBe("delete-sales-channels");
    expect(prepared.nodes.map(node => node.name)).toEqual([
      "can-delete-sales-channels-or-throw-step", "delete-sales-channels", "remove-remote-links", "emit-event-step",
    ]);
    expect(nativeStep("can-delete-sales-channels-or-throw-step").compensate).toBeUndefined();
    for (const name of ["delete-sales-channels", "remove-remote-links", "emit-event-step"])
      expect(nativeStep(name).compensation).toBe("transactionCovered");
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });

  it("guards before deletion, forwards the grouped Link endpoint and emits every requested ID in order", async () => {
    const bound = services(), env = nativePort(bound.modules);
    const ids = ["sc_z", "missing", "sc_z", "sc_a"];
    expect(await Effect.runPromise(env.run({ ids }))).toBeUndefined();
    expect(bound.listStores).toHaveBeenCalledExactlyOnceWith({ default_sales_channel_id: ids }, { select: ["default_sales_channel_id"] });
    expect(bound.softDeleteSalesChannels).toHaveBeenCalledExactlyOnceWith(ids);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith({ sales_channel: { sales_channel_id: ids } });
    expect(bound.emit).toHaveBeenCalledExactlyOnceWith(ids.map(id => ({ name: "sales-channel.deleted", data: { id },
      metadata: { eventGroupId: "sales-channel-delete-group" } })));
    callOrder([bound.listStores, bound.softDeleteSalesChannels, bound.remove, bound.emit]);
    expect(env.resolve.mock.calls).toEqual([["store"], ["sales_channel"], ["link"], ["event_bus"]]);
    expect(bound.restoreSalesChannels).not.toHaveBeenCalled(); expect(bound.restore).not.toHaveBeenCalled();
    expect(ids).toEqual(["sc_z", "missing", "sc_z", "sc_a"]);
  });

  it("refuses every matching default Store in the exact native message before downstream resolution", async () => {
    const bound = services();
    const listStores = vi.fn(async () => [{ default_sales_channel_id: "sc_b" }, { default_sales_channel_id: "sc_a" },
      { default_sales_channel_id: "sc_b" }]);
    const env = nativePort({ ...bound.modules, store: { listStores } });
    const ids = ["sc_a", "sc_b"];
    const result = await Effect.runPromise(Effect.result(env.run({ ids })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ type: "invalid_data",
      message: "Cannot delete default sales channels: sc_b, sc_a, sc_b" });
    expect(listStores).toHaveBeenCalledExactlyOnceWith({ default_sales_channel_id: ids }, { select: ["default_sales_channel_id"] });
    expect(env.resolve.mock.calls).toEqual([["store"]]);
    expect(bound.softDeleteSalesChannels).not.toHaveBeenCalled(); expect(bound.remove).not.toHaveBeenCalled();
    expect(bound.emit).not.toHaveBeenCalled();
  });

  it("resolves Store, Sales Channel, Link and Event Bus for empty input while returning native undefined", async () => {
    const bound = services(), env = nativePort(bound.modules);
    expect(await Effect.runPromise(env.run({ ids: [] }))).toBeUndefined();
    expect(bound.listStores).toHaveBeenCalledExactlyOnceWith({ default_sales_channel_id: [] }, { select: ["default_sales_channel_id"] });
    expect(bound.softDeleteSalesChannels).toHaveBeenCalledExactlyOnceWith([]);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith({ sales_channel: { sales_channel_id: [] } });
    expect(env.resolve.mock.calls).toEqual([["store"], ["sales_channel"], ["link"], ["event_bus"]]);
    expect(bound.emit).not.toHaveBeenCalled();
    callOrder([bound.listStores, bound.softDeleteSalesChannels, bound.remove]);
  });

  it("retains native scalar normalization on the guard step", async () => {
    const bound = services(), env = nativePort(bound.modules);
    const response = await nativeStep("can-delete-sales-channels-or-throw-step").invoke({ ids: "sc_one" }, env.context);
    expect(bound.listStores).toHaveBeenCalledExactlyOnceWith({ default_sales_channel_id: ["sc_one"] }, { select: ["default_sales_channel_id"] });
    expect(response).toBeInstanceOf(StepResponse);
    if (response instanceof StepResponse) expect(response.output).toBe(true);
  });

  it("retains Sales Channel compensation for nonempty IDs and skips both missing and empty IDs", async () => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep("delete-sales-channels");
    const ids = ["sc_z", "missing", "sc_z"];
    const response = await step.invoke(ids, env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing Sales Channel compensator");
    expect(response.output).toBeUndefined(); expect(response.compensateInput).toBe(ids);
    expect(bound.softDeleteSalesChannels).toHaveBeenCalledExactlyOnceWith(ids);
    await step.compensate(undefined, env.context); await step.compensate([], env.context);
    expect(bound.restoreSalesChannels).not.toHaveBeenCalled();
    expect(env.resolve.mock.calls).toEqual([["sales_channel"]]);
    await step.compensate(response.compensateInput, env.context);
    expect(bound.restoreSalesChannels).toHaveBeenCalledExactlyOnceWith(ids);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"], ["sales_channel"]]);
  });

  it.each([{ ids: [] }, { ids: ["sc_z", "missing", "sc_z"] }])("retains the original grouped Link endpoint for compensation: $ids", async ({ ids }) => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep("remove-remote-links");
    const endpoint = { sales_channel: { sales_channel_id: ids } };
    const response = await step.invoke(endpoint, env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native Link compensator");
    expect(response.output).toEqual(endpoint); expect(response.compensateInput).toEqual(endpoint);
    expect(bound.remove).toHaveBeenCalledExactlyOnceWith(endpoint);
    await step.compensate(undefined, env.context);
    expect(bound.restore).not.toHaveBeenCalled();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.restore).toHaveBeenCalledExactlyOnceWith(endpoint);
    expect(env.resolve.mock.calls).toEqual([["link"], ["link"]]);
  });

  it("propagates a late Event Bus failure without running transaction-covered compensation", async () => {
    const bound = services(), failure = new Error("Native deletion publication refused");
    const emit = vi.fn(async () => { throw failure; });
    const env = nativePort({ ...bound.modules, event_bus: { emit } });
    const result = await Effect.runPromise(Effect.result(env.run({ ids: ["sc_late"] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(bound.softDeleteSalesChannels).toHaveBeenCalledTimes(1); expect(bound.remove).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(bound.restoreSalesChannels).not.toHaveBeenCalled(); expect(bound.restore).not.toHaveBeenCalled();
  });
});
