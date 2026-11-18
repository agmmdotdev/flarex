import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/types";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { InventoryItem } from "@medusajs/inventory/models";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { updateInventoryItemsWorkflow, updateInventoryItemsWorkflowId,
  type UpdateInventoryItemsWorkflowInput } from "@medusajs/core-flows/inventory/update-inventory-items";

const prepared = Result.getOrThrow(updateInventoryItemsWorkflow.prepare());
const context = { manager: {}, transactionManager: {} };

/** Genuine composer, callbacks and module/internal-service helpers over scripted
 * foreign ports. Connected tests prove storage writes, no-op facts and events. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "inventory-item-update-group",
    // Generic native container boundary; exact resource resolution is checked.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: UpdateInventoryItemsWorkflowInput) => executeWorkflow(prepared, input, port) };
}

function nativeStep() {
  const node = prepared.nodes.find(node => node.name === "update-inventory-items-step");
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Inventory Item update step");
  return node;
}

function services() {
  const before = [{ id: "iitem_a", sku: "before", title: "Original", metadata: { keep: true } }];
  const after = [{ ...before[0], sku: "after" }];
  const listInventoryItems = vi.fn(async () => before);
  const updateInventoryItems = vi.fn(async () => after);
  return { before, after, listInventoryItems, updateInventoryItems,
    modules: { inventory: { listInventoryItems, updateInventoryItems } } };
}

describe("native Inventory Item update composer", () => {
  it("keeps the genuine identity, single transaction-covered step and unhooked array result", () => {
    expect(updateInventoryItemsWorkflowId).toBe("update-inventory-items-workflow");
    expect(prepared.nodes.map(node => node.name)).toEqual(["update-inventory-items-step"]);
    const node = nativeStep();
    expect(node.compensation).toBe("transactionCovered");
    expect(node.compensate).toBeTypeOf("function");
    expect(node.hook).toBe(false);
  });

  it("requires Inventory for empty input while skipping both native methods", async () => {
    const bound = services(), env = nativePort(bound.modules);
    expect(await Effect.runPromise(env.run({ updates: [] }))).toEqual([]);
    expect(env.resolve.mock.calls).toEqual([["inventory"]]);
    expect(bound.listInventoryItems).not.toHaveBeenCalled(); expect(bound.updateInventoryItems).not.toHaveBeenCalled();
    const response = await nativeStep().invoke([], env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing genuine empty response");
    expect(response.output).toEqual([]);
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: [], selects: [], relations: [] });
  });

  it("captures full preimages with empty config and forwards every raw update unchanged", async () => {
    const bound = services(), env = nativePort(bound.modules);
    const updates = [{ id: "iitem_b", title: "B" }, { id: "iitem_a", sku: "after" }, { id: "iitem_b", title: "Last B" }];
    expect(await Effect.runPromise(env.run({ updates }))).toEqual(bound.after);
    expect(bound.listInventoryItems).toHaveBeenCalledExactlyOnceWith({ id: ["iitem_b", "iitem_a", "iitem_b"] }, {});
    expect(bound.updateInventoryItems).toHaveBeenCalledExactlyOnceWith(updates);
    const listOrder = bound.listInventoryItems.mock.invocationCallOrder[0], updateOrder = bound.updateInventoryItems.mock.invocationCallOrder[0];
    if (listOrder === undefined || updateOrder === undefined) throw new Error("Missing native calls");
    expect(listOrder).toBeLessThan(updateOrder);
    expect(env.resolve.mock.calls).toEqual([["inventory"]]);
    expect(updates).toEqual([{ id: "iitem_b", title: "B" }, { id: "iitem_a", sku: "after" }, { id: "iitem_b", title: "Last B" }]);
  });

  it("keeps full preimages but restores only native helper-selected scalar fields", async () => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep();
    const response = await step.invoke([{ id: "iitem_a", sku: "after", title: "Changed" }], env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing genuine inverse");
    expect(response.output).toBe(bound.after);
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: bound.before, selects: ["id", "sku", "title"], relations: [] });
    bound.updateInventoryItems.mockClear();
    await step.compensate(undefined, env.context);
    await step.compensate({ dataBeforeUpdate: [], selects: ["sku"], relations: [] }, env.context);
    expect(bound.updateInventoryItems).not.toHaveBeenCalled();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.updateInventoryItems).toHaveBeenCalledExactlyOnceWith([{ id: "iitem_a", sku: "before", title: "Original" }]);
  });

  it("preserves dotted-metadata compensation instead of inventing a full metadata restore", async () => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep();
    const response = await step.invoke([{ id: "iitem_a", metadata: { nested: { change: true } } }], env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native metadata inverse");
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: bound.before,
      selects: ["id", "metadata.nested.change"], relations: [] });
    bound.updateInventoryItems.mockClear();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.updateInventoryItems).toHaveBeenCalledExactlyOnceWith([{ id: "iitem_a" }]);
  });

  it("retains a top-level metadata select for null input in the genuine inverse", async () => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep();
    const response = await step.invoke([{ id: "iitem_a", metadata: null }], env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native metadata inverse");
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: bound.before, selects: ["id", "metadata"], relations: [] });
    bound.updateInventoryItems.mockClear();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.updateInventoryItems).toHaveBeenCalledExactlyOnceWith([{ id: "iitem_a", metadata: { keep: true } }]);
  });

  it.each(["list", "update"] as const)("propagates native %s failure without invoking transaction-covered compensation", async phase => {
    const bound = services(), failure = new Error("Native Inventory " + phase + " failed");
    const fail = vi.fn(async () => { throw failure; });
    const env = nativePort({ inventory: { listInventoryItems: phase === "list" ? fail : bound.listInventoryItems,
      updateInventoryItems: phase === "update" ? fail : bound.updateInventoryItems } });
    const result = await Effect.runPromise(Effect.result(env.run({ updates: [{ id: "iitem_a", sku: "after" }] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(fail).toHaveBeenCalledTimes(1);
    if (phase === "list") expect(bound.updateInventoryItems).not.toHaveBeenCalled();
    else expect(bound.listInventoryItems).toHaveBeenCalledExactlyOnceWith({ id: ["iitem_a"] }, {});
    expect(env.resolve.mock.calls).toEqual([["inventory"]]);
  });
});

describe("genuine Inventory module update ABI", () => {
  it.each([false, true])("retains scalar/array shape and strips transient location_levels (%s)", async array => {
    const rows = [{ id: "iitem_a", sku: "after" }];
    const updateInventoryItems_ = vi.fn(async (_input: unknown, _context: unknown) => rows);
    const serialize = vi.fn(async (input: unknown) => input);
    const getFreshManager = vi.fn(() => ({}));
    const receiver = { updateInventoryItems_, baseRepository_: { serialize, getFreshManager } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    const update = { id: "iitem_a", sku: "after", location_levels: [{ location_id: "ignored", stocked_quantity: 999 }] };
    expect(await Reflect.apply(InventoryModuleService.prototype.updateInventoryItems, receiver,
      [array ? [update] : update, context])).toEqual(array ? rows : rows[0]);
    expect(updateInventoryItems_).toHaveBeenCalledTimes(1);
    expect(updateInventoryItems_.mock.calls[0]?.[0]).toEqual([{ id: "iitem_a", sku: "after" }]);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(rows);
    expect(getFreshManager).not.toHaveBeenCalled();
    expect(update.location_levels).toEqual([{ location_id: "ignored", stocked_quantity: 999 }]);
  });

  it("retains the real module helper's single internal update delegation", async () => {
    const rows = [{ id: "iitem_a", sku: "after" }];
    const update = vi.fn(async (_input: unknown, _context: unknown) => rows);
    const receiver = { inventoryItemService_: { update }, baseRepository_: { transaction: vi.fn() } };
    const input = [{ id: "iitem_a", sku: "after" }];
    expect(await Reflect.apply(InventoryModuleService.prototype.updateInventoryItems_, receiver, [input, context])).toBe(rows);
    expect(update).toHaveBeenCalledExactlyOnceWith(input, context);
    expect(receiver.baseRepository_.transaction).not.toHaveBeenCalled();
  });
});

/** This DAL observation port executes the real query/filter ordering helper.
 * It records native pairs without reimplementing metadata or write algorithms. */
function internalService(rows: readonly Record<string, unknown>[]) {
  const queries: unknown[] = [];
  const find = vi.fn<DAL.RepositoryService["find"]>().mockImplementation(async input => {
    queries.push(structuredClone(input));
    return preservePrimaryKeyOrFilterOrder(structuredClone([...rows]), input?.where, ["id"], [["id", "ASC"]]);
  });
  const output = [{ id: "native_return" }];
  const update = vi.fn<DAL.RepositoryService["update"]>().mockResolvedValue(output);
  const unavailableManager = (): never => { throw new Error("Native witness must borrow the supplied manager"); };
  const repository: DAL.RepositoryService = {
    getFreshManager: unavailableManager, getActiveManager: unavailableManager,
    transaction: vi.fn<DAL.RepositoryService["transaction"]>(),
    serialize: async <Output extends object | object[]>(input: Output) => input,
    find, update, findAndCount: vi.fn<DAL.RepositoryService["findAndCount"]>(),
    create: vi.fn<DAL.RepositoryService["create"]>(), delete: vi.fn<DAL.RepositoryService["delete"]>(),
    softDelete: vi.fn<DAL.RepositoryService["softDelete"]>(), restore: vi.fn<DAL.RepositoryService["restore"]>(),
    upsert: vi.fn<DAL.RepositoryService["upsert"]>(), upsertWithReplace: vi.fn<DAL.RepositoryService["upsertWithReplace"]>(),
  };
  const Service = MedusaInternalService(InventoryItem);
  const native = new Service<object, typeof InventoryItem>({ inventoryItemRepository: repository });
  return { native, find, update, output, queries, repository };
}

describe("genuine Inventory internal keyed update behavior", () => {
  it("retains native query normalization, last duplicate patch and distinct preimage/update ordering", async () => {
    const a = { id: "iitem_a", title: "A" }, b = { id: "iitem_b", title: "B" };
    const bound = internalService([a, b]);
    expect(await bound.native.list({ id: ["iitem_b", "iitem_a", "iitem_b"] }, {}, context)).toEqual([b, a]);
    const input = [{ id: "iitem_b", title: "Discarded", sku: "discarded" },
      { id: "iitem_a", title: "Changed A" }, { id: "iitem_b", title: "Last B" }];
    expect(await bound.native.update(input, context)).toBe(bound.output);
    expect(bound.queries).toEqual([
      { where: { id: ["iitem_b", "iitem_a"] }, options: { populate: [], fields: undefined, limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
      { where: { $or: [{ id: "iitem_b" }, { id: "iitem_a" }, { id: "iitem_b" }] },
        options: { populate: [], fields: undefined, limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
    ]);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([
      { entity: a, update: input[1] }, { entity: b, update: input[2] },
    ], context);
    expect(bound.repository.transaction).not.toHaveBeenCalled();
  });

  it("fails native missing unique IDs before any DAL update despite repeated missing requests", async () => {
    const bound = internalService([{ id: "iitem_a", title: "A" }]);
    await expect(bound.native.update([{ id: "iitem_a", title: "After" },
      { id: "missing", title: "First" }, { id: "missing", title: "Last" }], context)).rejects.toMatchObject({
      type: "not_found", message: 'InventoryItem with id "missing" not found',
    });
    expect(bound.find).toHaveBeenCalledTimes(1); expect(bound.update).not.toHaveBeenCalled();
  });

  it("merges each keyed metadata patch independently, retaining shallow replacement and deletion markers", async () => {
    const bound = internalService([
      { id: "iitem_a", metadata: { keep: "A", drop: true, nested: { old: true } } },
      { id: "iitem_b", metadata: { keep: "B", drop: true } },
    ]);
    await bound.native.update([
      { id: "iitem_a", metadata: { drop: "", nested: { replacement: true }, added: "A" } },
      { id: "iitem_b", metadata: { drop: "", added: "B" } },
    ], context);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([
      { entity: { id: "iitem_a", metadata: { keep: "A", nested: { replacement: true }, added: "A" } },
        update: { id: "iitem_a", metadata: { keep: "A", nested: { replacement: true }, added: "A" } } },
      { entity: { id: "iitem_b", metadata: { keep: "B", added: "B" } },
        update: { id: "iitem_b", metadata: { keep: "B", added: "B" } } },
    ], context);
  });

  it.each([null, {}])("passes nonpresent metadata %j through without native merge", async metadata => {
    const row = { id: "iitem_a", metadata: { keep: true } }, bound = internalService([row]);
    await bound.native.update([{ id: "iitem_a", metadata }], context);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([{ entity: row, update: { id: "iitem_a", metadata } }], context);
  });

  it("passes an ID-only patch to the DAL without inventing scalar changes", async () => {
    const row = { id: "iitem_a", title: "Keep", metadata: null }, bound = internalService([row]);
    await bound.native.update([{ id: "iitem_a" }], context);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([{ entity: row, update: { id: "iitem_a" } }], context);
  });

  it("returns an empty batch before reading or writing", async () => {
    const bound = internalService([]);
    expect(await bound.native.update([], context)).toEqual([]);
    expect(bound.find).not.toHaveBeenCalled(); expect(bound.update).not.toHaveBeenCalled();
  });
});
