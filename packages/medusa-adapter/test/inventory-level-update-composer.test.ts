import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/types";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { updateInventoryLevelsWorkflow, updateInventoryLevelsWorkflowId,
  type UpdateInventoryLevelsWorkflowInput } from "@medusajs/core-flows/inventory/update-inventory-levels";

const prepared = Result.getOrThrow(updateInventoryLevelsWorkflow.prepare());
const context = { manager: {}, transactionManager: {} };
const level = { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_a",
  stocked_quantity: 10, incoming_quantity: 3, reserved_quantity: 2, available_quantity: 8,
  metadata: { keep: true }, created_at: "2026-10-16T00:00:00.000Z", updated_at: "2026-10-16T00:00:00.000Z", deleted_at: null };

/** Real composer, callbacks and native module/service helpers over scripted
 * foreign ports. Connected tests own actual writes, companions and events. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "inventory-level-update-group",
    // Generic native container boundary; exact resource resolution is checked.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: UpdateInventoryLevelsWorkflowInput) => executeWorkflow(prepared, input, port) };
}
function nativeStep() {
  const node = prepared.nodes.find(node => node.name === "update-inventory-levels-step");
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Inventory Level update step");
  return node;
}
function services() {
  const before = [structuredClone(level)], after = [{ ...level, stocked_quantity: 15, available_quantity: 13 }];
  const listInventoryLevels = vi.fn(async () => before), updateInventoryLevels = vi.fn(async () => after);
  return { before, after, listInventoryLevels, updateInventoryLevels,
    modules: { inventory: { listInventoryLevels, updateInventoryLevels } } };
}

describe("native absolute Inventory Level update composer", () => {
  it("keeps the genuine identity, one transaction-covered callback and unhooked array result", () => {
    expect(updateInventoryLevelsWorkflowId).toBe("update-inventory-levels-workflow");
    expect(prepared.nodes.map(node => node.name)).toEqual(["update-inventory-levels-step"]);
    const node = nativeStep();
    expect(node.compensation).toBe("transactionCovered"); expect(node.compensate).toBeTypeOf("function");
    expect(node.hook).toBe(false);
  });

  it("resolves Inventory for empty input without listing or updating", async () => {
    const bound = services(), env = nativePort(bound.modules);
    expect(await Effect.runPromise(env.run({ updates: [] }))).toEqual([]);
    expect(env.resolve.mock.calls).toEqual([["inventory"]]);
    expect(bound.listInventoryLevels).not.toHaveBeenCalled(); expect(bound.updateInventoryLevels).not.toHaveBeenCalled();
    const response = await nativeStep().invoke([], env.context);
    if (!(response instanceof StepResponse)) throw new Error("Missing genuine empty response");
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: [], selects: [], relations: [] });
  });

  it("captures all tuple preimages with config{} and preserves raw order, repeated pairs and caller IDs", async () => {
    const bound = services(), env = nativePort(bound.modules);
    const updates = [{ inventory_item_id: "iitem_b", location_id: "sloc_b", stocked_quantity: 1.25 },
      { id: "caller_wins", inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: -2 },
      { inventory_item_id: "iitem_b", location_id: "sloc_b", stocked_quantity: 2147483648 }];
    expect(await Effect.runPromise(env.run({ updates }))).toEqual(bound.after);
    expect(bound.listInventoryLevels).toHaveBeenCalledExactlyOnceWith({ $or: [
      { inventory_item_id: "iitem_b", location_id: "sloc_b" },
      { inventory_item_id: "iitem_a", location_id: "sloc_a" },
      { inventory_item_id: "iitem_b", location_id: "sloc_b" },
    ] }, {});
    expect(bound.updateInventoryLevels).toHaveBeenCalledExactlyOnceWith(updates);
    const first = bound.listInventoryLevels.mock.invocationCallOrder[0], second = bound.updateInventoryLevels.mock.invocationCallOrder[0];
    if (first === undefined || second === undefined) throw new Error("Missing native calls");
    expect(first).toBeLessThan(second); expect(env.resolve.mock.calls).toEqual([["inventory"]]);
  });

  it("forwards tuple-only updates without adding an empty-quantity shortcut", async () => {
    const bound = services(), env = nativePort(bound.modules), updates = [{ inventory_item_id: "iitem_a", location_id: "sloc_a" }];
    expect(await Effect.runPromise(env.run({ updates }))).toEqual(bound.after);
    expect(bound.updateInventoryLevels).toHaveBeenCalledExactlyOnceWith(updates);
    expect(bound.listInventoryLevels).toHaveBeenCalledExactlyOnceWith({ $or: updates }, {});
  });

  it("restores exact native helper-selected preimage fields and skips missing/empty preimages", async () => {
    const bound = services(), env = nativePort(bound.modules), step = nativeStep();
    const input = [{ inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: 15 }];
    const response = await step.invoke(input, env.context);
    if (!(response instanceof StepResponse) || step.compensate === undefined) throw new Error("Missing native Level inverse");
    expect(response.output).toBe(bound.after);
    expect(response.compensateInput).toEqual({ dataBeforeUpdate: bound.before,
      selects: ["inventory_item_id", "location_id", "stocked_quantity"], relations: [] });
    bound.updateInventoryLevels.mockClear();
    await step.compensate(undefined, env.context);
    await step.compensate({ dataBeforeUpdate: [], selects: ["stocked_quantity"], relations: [] }, env.context);
    expect(bound.updateInventoryLevels).not.toHaveBeenCalled();
    await step.compensate(response.compensateInput, env.context);
    expect(bound.updateInventoryLevels).toHaveBeenCalledExactlyOnceWith([
      { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: 10 },
    ]);
    expect(env.resolve.mock.calls).toEqual([["inventory"], ["inventory"]]);
  });

  it.each(["list", "update"] as const)("propagates native %s failure without invoking its transaction-covered inverse", async phase => {
    const bound = services(), failure = new Error("Native Level " + phase + " refused");
    const fail = vi.fn(async () => { throw failure; });
    const env = nativePort({ inventory: { listInventoryLevels: phase === "list" ? fail : bound.listInventoryLevels,
      updateInventoryLevels: phase === "update" ? fail : bound.updateInventoryLevels } });
    const result = await Effect.runPromise(Effect.result(env.run({ updates: [
      { inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: 4 },
    ] })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(fail).toHaveBeenCalledTimes(1);
    if (phase === "list") expect(bound.updateInventoryLevels).not.toHaveBeenCalled();
    else expect(bound.listInventoryLevels).toHaveBeenCalledTimes(1);
    expect(env.resolve.mock.calls).toEqual([["inventory"]]);
  });
});

describe("genuine Inventory module absolute-level ABI", () => {
  it.each([false, true])("preserves scalar/array shape and strips reserved_quantity before native update (%s)", async array => {
    const rows = [level], updateInventoryLevels_ = vi.fn(async (_input: unknown, _context: unknown) => rows);
    const serialize = vi.fn(async (input: unknown) => input), getFreshManager = vi.fn(() => ({}));
    const receiver = { updateInventoryLevels_, baseRepository_: { serialize, getFreshManager } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    const input = { inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: -1.25, reserved_quantity: 999 };
    expect(await Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels, receiver,
      [array ? [input] : input, context])).toEqual(array ? rows : rows[0]);
    expect(updateInventoryLevels_).toHaveBeenCalledTimes(1);
    expect(updateInventoryLevels_.mock.calls[0]?.[0]).toEqual([
      { inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: -1.25 },
    ]);
    expect(serialize).toHaveBeenCalledExactlyOnceWith(rows); expect(getFreshManager).not.toHaveBeenCalled();
    expect(input.reserved_quantity).toBe(999);
  });

  it("preserves caller-ID precedence after real pair validation", async () => {
    const list = vi.fn(async () => [level]);
    const update = vi.fn(async (_input: unknown, _context: unknown) => [level]);
    const receiver = { inventoryLevelService_: { list, update } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    const input = [{ id: "caller_wins", inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: 5 }];
    expect(await Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels_, receiver, [input, context])).toEqual([level]);
    expect(list).toHaveBeenCalledExactlyOnceWith({ $or: [{ id: [] },
      { inventory_item_id: "iitem_a", location_id: "sloc_a" }] }, {}, context);
    expect(update).toHaveBeenCalledExactlyOnceWith(input, context);
  });

  it("keeps tuple-only scalar fields in the internal update instead of turning it into an ID-only no-op", async () => {
    const list = vi.fn(async () => [level]), update = vi.fn(async (_input: unknown, _context: unknown) => [level]);
    const receiver = { inventoryLevelService_: { list, update } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    await Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels_, receiver,
      [[{ inventory_item_id: "iitem_a", location_id: "sloc_a" }], context]);
    expect(update).toHaveBeenCalledExactlyOnceWith([
      { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_a" },
    ], context);
  });

  it("reports missing pairs in raw request order before any internal update, even with caller IDs", async () => {
    const list = vi.fn(async () => []), update = vi.fn(async () => []);
    const receiver = { inventoryLevelService_: { list, update } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    await expect(Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels_, receiver, [[
      { id: "existing_elsewhere", inventory_item_id: "iitem_b", location_id: "sloc_b", stocked_quantity: 5 },
      { inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: 2 },
      { inventory_item_id: "iitem_b", location_id: "sloc_b" },
    ], context])).rejects.toMatchObject({ type: "not_found", message:
      "Item iitem_b is not stocked at location sloc_b, Item iitem_a is not stocked at location sloc_a, Item iitem_b is not stocked at location sloc_b" });
    expect(list).toHaveBeenCalledTimes(1); expect(update).not.toHaveBeenCalled();
  });

  it("does not impose an availability guard on absolute stock values", async () => {
    const list = vi.fn(async () => [level]), update = vi.fn(async (_input: unknown, _context: unknown) => [level]);
    const receiver = { inventoryLevelService_: { list, update } };
    Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
    await Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels_, receiver, [[
      { inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: -100 },
    ], context]);
    expect(update).toHaveBeenCalledExactlyOnceWith([
      { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: -100 },
    ], context);
  });
});

/** Scripted DAL selected rows feed genuine InventoryLevelService, inherited
 * internal update and native ordering. No query, deduplication or update
 * business algorithm is reproduced by this observation port. */
function nativeLevels(selections: readonly (readonly Record<string, unknown>[])[]) {
  let selected = 0;
  const queries: unknown[] = [];
  const find = vi.fn<DAL.RepositoryService["find"]>().mockImplementation(async input => {
    queries.push(structuredClone(input));
    const rows = selections[selected++];
    if (rows === undefined) throw new Error("Unexpected native Level find");
    return preservePrimaryKeyOrFilterOrder(structuredClone([...rows]), input?.where, ["id"], [["id", "ASC"]]);
  });
  const output = [{ id: "native_return" }], update = vi.fn<DAL.RepositoryService["update"]>().mockResolvedValue(output);
  const unavailableManager = (): never => { throw new Error("Native witness must borrow its supplied manager"); };
  const repository: DAL.RepositoryService = {
    getFreshManager: unavailableManager, getActiveManager: unavailableManager,
    transaction: vi.fn<DAL.RepositoryService["transaction"]>(),
    serialize: async <Output extends object | object[]>(input: Output) => input,
    find, update, findAndCount: vi.fn<DAL.RepositoryService["findAndCount"]>(),
    create: vi.fn<DAL.RepositoryService["create"]>(), delete: vi.fn<DAL.RepositoryService["delete"]>(),
    softDelete: vi.fn<DAL.RepositoryService["softDelete"]>(), restore: vi.fn<DAL.RepositoryService["restore"]>(),
    upsert: vi.fn<DAL.RepositoryService["upsert"]>(), upsertWithReplace: vi.fn<DAL.RepositoryService["upsertWithReplace"]>(),
  };
  const unavailableQuantity = async (): Promise<never> => { throw new Error("Quantity aggregation is not part of absolute updates"); };
  const internal = new InventoryLevelService({ inventoryLevelRepository: { ...repository,
    getStockedQuantity: unavailableQuantity, getReservedQuantity: unavailableQuantity, getAvailableQuantity: unavailableQuantity } });
  const receiver = { inventoryLevelService_: internal };
  Object.setPrototypeOf(receiver, InventoryModuleService.prototype);
  return { receiver, internal, find, update, output, queries, repository,
    run: (input: unknown) => Reflect.apply(InventoryModuleService.prototype.updateInventoryLevels_, receiver, [input, context]) };
}

describe("genuine Level tuple-to-keyed update composition", () => {
  it("retains native final-patch selection and repeated-ID result ordering after tuple lookup", async () => {
    const a = { ...level }, b = { ...level, id: "ilev_b", inventory_item_id: "iitem_b", location_id: "sloc_b" };
    const bound = nativeLevels([[a, b], [a, b]]);
    const input = [{ inventory_item_id: "iitem_b", location_id: "sloc_b", stocked_quantity: 100 },
      { inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: 4 },
      { inventory_item_id: "iitem_b", location_id: "sloc_b", incoming_quantity: 9 }];
    expect(await bound.run(input)).toBe(bound.output);
    expect(bound.queries).toEqual([
      { where: { $or: [{ id: [] },
        { inventory_item_id: "iitem_b", location_id: "sloc_b" },
        { inventory_item_id: "iitem_a", location_id: "sloc_a" },
        { inventory_item_id: "iitem_b", location_id: "sloc_b" }] },
        options: { populate: [], fields: undefined, limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
      { where: { $or: [{ id: "ilev_b" }, { id: "ilev_a" }, { id: "ilev_b" }] },
        options: { populate: [], fields: undefined, limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
    ]);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([
      { entity: a, update: { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_a", incoming_quantity: 4 } },
      { entity: b, update: { id: "ilev_b", inventory_item_id: "iitem_b", location_id: "sloc_b", incoming_quantity: 9 } },
    ], context);
    expect(bound.repository.transaction).not.toHaveBeenCalled();
  });

  it("preserves a mismatched caller ID and lets actual DAL uniqueness own its eventual outcome", async () => {
    const selectedPair = { ...level }, foreign = { ...level, id: "ilev_foreign", inventory_item_id: "other", location_id: "elsewhere" };
    const bound = nativeLevels([[selectedPair], [foreign]]);
    await bound.run([{ id: "ilev_foreign", inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: 7 }]);
    expect(bound.update).toHaveBeenCalledExactlyOnceWith([
      { entity: foreign, update: { id: "ilev_foreign", inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: 7 } },
    ], context);
    expect(bound.queries[1]).toMatchObject({ where: { $or: [{ id: "ilev_foreign" }] } });
  });

  it("reaches native keyed NOT_FOUND for missing caller IDs only after finding the supplied pair", async () => {
    const bound = nativeLevels([[level], []]);
    await expect(bound.run([{ id: "missing_id", inventory_item_id: "iitem_a", location_id: "sloc_a" }])).rejects.toMatchObject({
      type: "not_found", message: 'InventoryLevel with id "missing_id" not found',
    });
    expect(bound.find).toHaveBeenCalledTimes(2); expect(bound.update).not.toHaveBeenCalled();
  });

  it("retains actual internal failures after complete pair validation without retry", async () => {
    const bound = nativeLevels([[level], [level]]), failure = new Error("Native Level DAL refused");
    bound.update.mockRejectedValueOnce(failure);
    await expect(bound.run([{ inventory_item_id: "iitem_a", location_id: "sloc_a", stocked_quantity: 0 }])).rejects.toBe(failure);
    expect(bound.find).toHaveBeenCalledTimes(2); expect(bound.update).toHaveBeenCalledTimes(1);
  });
});
