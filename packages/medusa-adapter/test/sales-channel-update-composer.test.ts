import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { updateSalesChannelsWorkflow, type UpdateSalesChannelsWorkflowInput } from "@medusajs/core-flows/sales-channel/update-sales-channels";

const prepared = Result.getOrThrow(updateSalesChannelsWorkflow.prepare());
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "sales-channel-update-group",
    // Native generic container boundary; exact resolution/calls are checked below.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: UpdateSalesChannelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}
function updateNode() {
  const node = prepared.nodes.find(node => node.name === "update-sales-channels");
  if (node === undefined || node.kind !== "step") throw new Error("Missing genuine native Sales Channel update step");
  return node;
}
const row = { id: "sc_first", name: "Updated", description: null, is_disabled: true, metadata: null };

/** Genuine composer/step characterization over scripted service ports. The
 * connected suite separately proves actual selector writes and no-op storage. */
describe("native Sales Channel selector update composer", () => {
  it("returns the native scalar and emits only that returned ID after preimage capture", async () => {
    const selector = { id: ["sc_first", "sc_second"] }, update = { name: "Updated", is_disabled: true };
    const preimages = [{ id: "sc_first", name: "First", is_disabled: false }, { id: "sc_second", name: "Second", is_disabled: false }];
    const listSalesChannels = vi.fn(async () => preimages), updateSalesChannels = vi.fn(async () => row);
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels }, event_bus: { emit } });
    expect(await Effect.runPromise(env.run({ selector, update }))).toEqual(row);
    expect(listSalesChannels).toHaveBeenCalledExactlyOnceWith(selector, { select: ["name", "is_disabled"], relations: [] });
    expect(updateSalesChannels).toHaveBeenCalledExactlyOnceWith(selector, update);
    const listedAt = listSalesChannels.mock.invocationCallOrder[0], updatedAt = updateSalesChannels.mock.invocationCallOrder[0];
    if (listedAt === undefined || updatedAt === undefined) throw new Error("Native service calls did not execute");
    expect(listedAt).toBeLessThan(updatedAt);
    expect(emit).toHaveBeenCalledExactlyOnceWith([{ name: "sales-channel.updated", data: { id: row.id },
      metadata: { eventGroupId: "sales-channel-update-group" } }]);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"], ["event_bus"]]);
    expect(updateNode().compensation).toBe("transactionCovered");
  });

  it("preserves the genuine zero-match undefined-to-ID failure without Event Bus resolution", async () => {
    const selector = { id: "missing" }, update = { name: "Unused" };
    const listSalesChannels = vi.fn(async () => []), updateSalesChannels = vi.fn(async () => undefined);
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels }, event_bus: { emit } });
    const result = await Effect.runPromise(Effect.result(env.run({ selector, update })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(TypeError);
      expect(result.failure).toMatchObject({ message: expect.stringContaining("Cannot read properties of undefined") });
    }
    expect(updateSalesChannels).toHaveBeenCalledExactlyOnceWith(selector, update);
    expect(env.resolve.mock.calls).toEqual([["sales_channel"]]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("passes empty-update native preimage selects unchanged and still emits the scalar result", async () => {
    const selector = { id: row.id };
    const listSalesChannels = vi.fn(async () => [{ id: row.id }]), updateSalesChannels = vi.fn(async () => row);
    const emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels }, event_bus: { emit } });
    expect(await Effect.runPromise(env.run({ selector, update: {} }))).toEqual(row);
    expect(listSalesChannels).toHaveBeenCalledExactlyOnceWith(selector, { select: [], relations: [] });
    expect(updateSalesChannels).toHaveBeenCalledExactlyOnceWith(selector, {});
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("retains native preimages and their exact mapped upsert compensator", async () => {
    const preimages = [{ id: "sc_first", name: "Before", description: null, is_disabled: false, metadata: { old: true } }];
    const listSalesChannels = vi.fn(async () => preimages), updateSalesChannels = vi.fn(async () => row);
    const upsertSalesChannels = vi.fn(async () => preimages);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels, upsertSalesChannels } });
    const node = updateNode();
    const response = await node.invoke({ selector: { id: row.id }, update: { name: "Updated" } }, env.context);
    if (!(response instanceof StepResponse) || node.compensate === undefined) throw new Error("Missing native response or compensator");
    expect(response.output).toBe(row);
    expect(response.compensateInput).toBe(preimages);
    await node.compensate(undefined, env.context); await node.compensate([], env.context);
    expect(upsertSalesChannels).not.toHaveBeenCalled();
    await node.compensate(response.compensateInput, env.context);
    expect(upsertSalesChannels).toHaveBeenCalledExactlyOnceWith(preimages);
  });

  it("retains nested-metadata selection and ID-only compensation without expanding it", async () => {
    const preimages = [{ id: row.id }];
    const listSalesChannels = vi.fn(async () => preimages), updateSalesChannels = vi.fn(async () => row);
    const upsertSalesChannels = vi.fn(async () => preimages);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels, upsertSalesChannels } });
    const node = updateNode();
    const response = await node.invoke({ selector: { id: row.id }, update: { metadata: { nested: { enabled: true }, drop: "" } } }, env.context);
    expect(listSalesChannels).toHaveBeenCalledExactlyOnceWith({ id: row.id },
      { select: ["metadata.nested.enabled", "metadata.drop"], relations: [] });
    if (!(response instanceof StepResponse) || node.compensate === undefined) throw new Error("Missing native response or compensator");
    expect(response.compensateInput).toBe(preimages);
    await node.compensate(response.compensateInput, env.context);
    expect(upsertSalesChannels).toHaveBeenCalledExactlyOnceWith([{ id: row.id,
      name: undefined, description: undefined, is_disabled: undefined, metadata: undefined }]);
  });

  it("retains a native update failure after preimage selection without invoking compensation", async () => {
    const failure = new Error("Native selector update refused");
    const listSalesChannels = vi.fn(async () => [{ id: row.id }]);
    const updateSalesChannels = vi.fn(async () => { throw failure; });
    const upsertSalesChannels = vi.fn(async () => []), emit = vi.fn(async () => undefined);
    const env = nativePort({ sales_channel: { listSalesChannels, updateSalesChannels, upsertSalesChannels }, event_bus: { emit } });
    const result = await Effect.runPromise(Effect.result(env.run({ selector: { id: row.id }, update: { name: "Unused" } })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(listSalesChannels).toHaveBeenCalledTimes(1);
    expect(emit).not.toHaveBeenCalled(); expect(upsertSalesChannels).not.toHaveBeenCalled();
  });
});
