import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { SalesChannelWorkflowEvents } from "@medusajs/utils/core-flows/events";
import {
  createSalesChannelsWorkflow,
  createSalesChannelsWorkflowId,
  type CreateSalesChannelsWorkflowInput,
} from "@medusajs/core-flows/sales-channel/create-sales-channels";

const prepared = Result.getOrThrow(createSalesChannelsWorkflow.prepare());

/** Actual SDK composer and native callbacks over scripted service ports. This
 * characterizes framework behavior; persistence and atomic settlement belong
 * to the connected adapter tests. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = {
    eventGroupId: "sales-channel-create-group",
    // The native container's generic resolver boundary is asserted through the
    // exact resource names below; it is not a persistence input decoder.
    container: { resolve: <Value>(name: string) => resolve(name) as Value },
  };
  const port: WorkflowExecutionPort<unknown> = {
    checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }),
    context,
  };
  const run = (input: CreateSalesChannelsWorkflowInput) => executeWorkflow(prepared, input, port);
  return { context, resolve, run };
}

function creationNode() {
  const node = prepared.nodes.find(node => node.name === "create-sales-channels");
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Sales Channel creation step");
  return node;
}

describe("native Sales Channel creation composer", () => {
  it("retains the native workflow and step identities", () => {
    expect(createSalesChannelsWorkflowId).toBe("create-sales-channels");
    expect(prepared.nodes.map(node => node.name)).toEqual(["create-sales-channels", "emit-event-step"]);
    expect(creationNode().compensation).toBe("transactionCovered");
  });

  it("resolves both native services for empty creation while emitting no messages", async () => {
    const createSalesChannels = vi.fn(async () => []);
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { createSalesChannels }, event_bus: { emit } });
    expect(await Effect.runPromise(env.run({ salesChannelsData: [] }))).toEqual([]);
    expect(createSalesChannels).toHaveBeenCalledExactlyOnceWith([]);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"], ["event_bus"]]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("forwards rich creation data and preserves returned DTOs and event ID order", async () => {
    const input = { salesChannelsData: [
      { id: "requested-a", name: "Web", description: "Web storefront", is_disabled: false,
        metadata: { position: 1, flags: [true, null], nested: { channel: "web" } } },
      { id: "requested-b", name: "Wholesale", description: null, is_disabled: true, metadata: null },
    ] };
    const created = [
      { id: "returned-z", name: "Web", description: "Web storefront", is_disabled: false,
        metadata: { position: 1, flags: [true, null], nested: { channel: "web" } } },
      { id: "returned-a", name: "Wholesale", description: null, is_disabled: true, metadata: null },
    ];
    const createSalesChannels = vi.fn(async () => created);
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { createSalesChannels }, event_bus: { emit } });
    expect(await Effect.runPromise(env.run(input))).toEqual(created);
    expect(createSalesChannels).toHaveBeenCalledExactlyOnceWith(input.salesChannelsData);
    expect(emit).toHaveBeenCalledExactlyOnceWith(created.map(({ id }) => ({
      name: SalesChannelWorkflowEvents.CREATED, data: { id }, metadata: { eventGroupId: "sales-channel-create-group" },
    })));
    expect(SalesChannelWorkflowEvents.CREATED).toBe("sales-channel.created");
    expect(env.resolve.mock.calls).toEqual([["sales_channel"], ["event_bus"]]);
  });

  it.each([1, 4])("retains all %i ordered native creation results", async count => {
    const input = { salesChannelsData: Array.from({ length: count }, (_, index) => ({ name: "Channel " + index })) };
    const created = input.salesChannelsData.map((row, index) => ({ ...row, id: "channel-" + index,
      description: null, is_disabled: false, metadata: null }));
    const createSalesChannels = vi.fn(async () => created), emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { createSalesChannels }, event_bus: { emit } });
    expect(await Effect.runPromise(env.run(input))).toEqual(created);
    expect(createSalesChannels).toHaveBeenCalledExactlyOnceWith(input.salesChannelsData);
    expect(emit).toHaveBeenCalledExactlyOnceWith(created.map(({ id }) => ({
      name: SalesChannelWorkflowEvents.CREATED, data: { id }, metadata: { eventGroupId: "sales-channel-create-group" },
    })));
  });

  it("retains the genuine creation compensator and its truthy empty-array behavior", async () => {
    const created = [
      { id: "compensate-z", name: "Web", description: null, is_disabled: false, metadata: null },
      { id: "compensate-a", name: "Wholesale", description: null, is_disabled: true, metadata: null },
    ];
    const createSalesChannels = vi.fn(async () => created), deleteSalesChannels = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { createSalesChannels, deleteSalesChannels } });
    const node = creationNode();
    const response = await node.invoke({ data: [{ name: "Web" }, { name: "Wholesale" }] }, env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing native StepResponse");
    expect(response.output).toBe(created);
    expect(response.compensateInput).toEqual(["compensate-z", "compensate-a"]);
    if (node.compensate === undefined) throw new Error("Missing native creation compensator");
    await node.compensate(undefined, env.context);
    expect(deleteSalesChannels).not.toHaveBeenCalled();
    await node.compensate([], env.context);
    expect(deleteSalesChannels).toHaveBeenCalledExactlyOnceWith([]);
    await node.compensate(response.compensateInput, env.context);
    expect(deleteSalesChannels).toHaveBeenLastCalledWith(["compensate-z", "compensate-a"]);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"], ["sales_channel"], ["sales_channel"]]);
  });

  it("propagates a native creation refusal before Event Bus resolution", async () => {
    const failure = new Error("Native Sales Channel creation refused");
    const createSalesChannels = vi.fn(async () => { throw failure; });
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { createSalesChannels }, event_bus: { emit } });
    const result = await Effect.runPromise(Effect.result(env.run({ salesChannelsData: [{ name: "Web" }] })));
    expect(result._tag).toBe("Failure");
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"]]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("propagates Event Bus refusal without invoking transaction-covered compensation", async () => {
    const failure = new Error("Native Event Bus refused");
    const created = [{ id: "refused-event", name: "Web", description: null, is_disabled: false, metadata: null }];
    const createSalesChannels = vi.fn(async () => created), deleteSalesChannels = vi.fn(async () => undefined);
    const emit = vi.fn(async () => { throw failure; });
    const env = nativePort({ sales_channel: { createSalesChannels, deleteSalesChannels }, event_bus: { emit } });
    const result = await Effect.runPromise(Effect.result(env.run({ salesChannelsData: [{ name: "Web" }] })));
    expect(result._tag).toBe("Failure");
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(deleteSalesChannels).not.toHaveBeenCalled();
  });
});
