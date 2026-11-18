import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse, type StepExecutionContext } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import type { DAL } from "@medusajs/types";
import { StockLocation } from "@medusajs/stock-location/models";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { updateStockLocationsWorkflow, updateStockLocationsWorkflowId,
  type UpdateStockLocationsWorkflowInput } from "@medusajs/core-flows/stock-location/update-stock-locations";
import type { WorkflowGraphResource } from "@medusajs/core-flows/common/use-query-graph";

const prepared = Result.getOrThrow(updateStockLocationsWorkflow.prepare());
const location = { id: "sloc_a", name: "Updated", metadata: null, address_id: "laddr_a" };

/** The real composer, callbacks and native service helpers run over scripted
 * foreign ports. Connected tests prove actual DML, events and settlement. */
function nativePort(services: Readonly<Record<string, unknown>>) {
  const resolve = vi.fn((name: string) => {
    if (!Object.hasOwn(services, name)) throw new Error("Missing native resource " + name);
    return services[name];
  });
  const context: StepExecutionContext = { eventGroupId: "stock-location-update-group",
    // Generic native container boundary; exact resource resolution is checked.
    container: { resolve: <Value>(name: string) => resolve(name) as Value } };
  const port: WorkflowExecutionPort<unknown> = { context, checkpoint: Effect.void,
    capture: value => Effect.sync(() => structuredClone(value)),
    invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: cause => cause }) };
  return { context, resolve, run: (input: UpdateStockLocationsWorkflowInput) => executeWorkflow(prepared, input, port) };
}

function nativeStep(name: string) {
  const node = prepared.nodes.find(node => node.name === name);
  if (node === undefined || node.kind !== "step") throw new Error("Missing native Stock Location step " + name);
  return node;
}
function services(rows: readonly (typeof Schema.JsonObject.Type)[] = [{ id: "sloc_a", address: { id: "laddr_a" } }]) {
  const graph = vi.fn<WorkflowGraphResource["graph"]>().mockResolvedValue({ data: rows,
    metadata: { count: rows.length, take: 4, skip: 0 } });
  const listStockLocationAddresses = vi.fn(async () => []);
  const upsertStockLocationAddresses = vi.fn(async () => []);
  const listStockLocations = vi.fn(async () => [{ id: location.id, name: "Before" }]);
  const updateStockLocations = vi.fn(async () => location);
  return { graph, listStockLocationAddresses, upsertStockLocationAddresses, listStockLocations, updateStockLocations,
    modules: { query: { maxPageSize: 4, graph }, stock_location: {
      listStockLocationAddresses, upsertStockLocationAddresses, listStockLocations, updateStockLocations } } };
}
function callOrder(calls: readonly { readonly mock: { readonly invocationCallOrder: readonly number[] } }[]) {
  const order = calls.map(call => {
    const first = call.mock.invocationCallOrder[0];
    if (first === undefined) throw new Error("Missing native call");
    return first;
  });
  expect(order).toEqual([...order].sort((left, right) => left - right));
  expect(new Set(order).size).toBe(order.length);
}

describe("native Stock Location update composer", () => {
  it("keeps native identities, unconditional graph and both transaction-covered inverses", () => {
    expect(updateStockLocationsWorkflowId).toBe("update-stock-locations-workflow");
    expect(prepared.nodes.map(node => node.name)).toEqual([
      "get-stock-location", "upsert-stock-location-addresses-step", "update-stock-locations-step",
    ]);
    expect(nativeStep("get-stock-location").compensate).toBeUndefined();
    for (const name of ["upsert-stock-location-addresses-step", "update-stock-locations-step"])
      expect(nativeStep(name).compensation).toBe("transactionCovered");
    expect(prepared.nodes.some(node => node.kind === "step" && node.hook)).toBe(false);
  });

  it("queries and calls the empty Address list/upsert even for a name-only update", async () => {
    const bound = services(), env = nativePort(bound.modules), selector = { id: ["sloc_a", "sloc_b"] };
    expect(await Effect.runPromise(env.run({ selector, update: { name: "Updated" } }))).toEqual(location);
    expect(bound.graph).toHaveBeenCalledExactlyOnceWith({ entity: "stock_location", filters: selector,
      fields: ["id", "address.id"], pagination: { take: 4 } });
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([]);
    expect(bound.listStockLocations).toHaveBeenCalledExactlyOnceWith(selector, { select: ["name"], relations: [] });
    expect(bound.updateStockLocations).toHaveBeenCalledExactlyOnceWith(selector, { name: "Updated" });
    callOrder([bound.graph, bound.listStockLocationAddresses, bound.upsertStockLocationAddresses,
      bound.listStockLocations, bound.updateStockLocations]);
    expect(env.resolve.mock.calls).toEqual([["query"], ["stock_location"], ["stock_location"]]);
  });

  it("passes attached partial patches without requiring creation fields and removes the nested Address from the root", async () => {
    const bound = services(), env = nativePort(bound.modules), selector = { id: "sloc_a" };
    expect(await Effect.runPromise(env.run({ selector, update: { address: { city: "Yangon" } } }))).toEqual(location);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: ["laddr_a"] },
      { select: ["id", "city"], relations: [] });
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([{ id: "laddr_a", city: "Yangon" }]);
    expect(bound.listStockLocations).toHaveBeenCalledExactlyOnceWith(selector, { select: [], relations: [] });
    expect(bound.updateStockLocations).toHaveBeenCalledExactlyOnceWith(selector, {});
  });

  it("creates a standalone Address for an addressless target and strips even an explicit address_id", async () => {
    const bound = services([{ id: "sloc_a", address: null }]), env = nativePort(bound.modules);
    const address = { address_1: "1855 Powder Mill Rd", country_code: "us" }, selector = { id: "sloc_a" };
    expect(await Effect.runPromise(env.run({ selector, update: {
      name: "Updated", address, address_id: "laddr_caller", metadata: { touched: true },
    } }))).toEqual(location);
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([address]);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: [] },
      { select: ["address_1", "country_code"], relations: [] });
    expect(bound.updateStockLocations).toHaveBeenCalledExactlyOnceWith(selector, { name: "Updated", metadata: { touched: true } });
  });

  it("keeps selected Location order when normalizing a mixed Address selection", async () => {
    const bound = services([{ id: "sloc_a", address: { id: "laddr_a" } }, { id: "sloc_b" },
      { id: "sloc_c", address: { id: "laddr_c" } }]), env = nativePort(bound.modules);
    const address = { address_1: "Shared street", country_code: "mm", metadata: { nested: { keep: true } } };
    await Effect.runPromise(env.run({ selector: {}, update: { address } }));
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([
      { id: "laddr_a", ...address }, address, { id: "laddr_c", ...address },
    ]);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: ["laddr_a", "laddr_c"] },
      { select: ["id", "address_1", "country_code", "metadata.nested.keep"], relations: [] });
    expect(bound.updateStockLocations).toHaveBeenCalledExactlyOnceWith({}, {});
  });

  it("treats an empty attached Address patch as truthy and still upserts its selected ID", async () => {
    const bound = services(), env = nativePort(bound.modules);
    await Effect.runPromise(env.run({ selector: { id: "sloc_a" }, update: { address: {} } }));
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([{ id: "laddr_a" }]);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: ["laddr_a"] },
      { select: ["id"], relations: [] });
    expect(bound.updateStockLocations).toHaveBeenCalledExactlyOnceWith({ id: "sloc_a" }, {});
  });

  it("successfully returns undefined for no matches while still executing every empty-input dependency", async () => {
    const bound = services([]), updateStockLocations = vi.fn(async () => undefined), listStockLocations = vi.fn(async () => []);
    const env = nativePort({ ...bound.modules, stock_location: {
      ...bound.modules.stock_location, listStockLocations, updateStockLocations } });
    expect(await Effect.runPromise(env.run({ selector: {}, update: { address: { city: "Unused" } } }))).toBeUndefined();
    expect(bound.graph).toHaveBeenCalledTimes(1);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: [] }, { select: [], relations: [] });
    expect(bound.upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([]);
    expect(listStockLocations).toHaveBeenCalledExactlyOnceWith({}, { select: [], relations: [] });
    expect(updateStockLocations).toHaveBeenCalledExactlyOnceWith({}, {});
    expect(env.resolve.mock.calls).toEqual([["query"], ["stock_location"], ["stock_location"]]);
  });

  it("preserves Address failure after preimages and never reaches the Location write", async () => {
    const failure = new Error("Native Address upsert refused"), bound = services();
    const upsertStockLocationAddresses = vi.fn(async () => { throw failure; });
    const env = nativePort({ ...bound.modules, stock_location: {
      ...bound.modules.stock_location, upsertStockLocationAddresses } });
    const result = await Effect.runPromise(Effect.result(env.run({ selector: {}, update: { address: { city: "Patch" } } })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(bound.listStockLocationAddresses).toHaveBeenCalledTimes(1);
    expect(bound.listStockLocations).not.toHaveBeenCalled(); expect(bound.updateStockLocations).not.toHaveBeenCalled();
  });

  it("refuses malformed selected Address IDs at the portable graph boundary before module calls", async () => {
    const bound = services([{ id: "sloc_a", address: { id: 123 } }]), env = nativePort(bound.modules);
    const result = await Effect.runPromise(Effect.result(env.run({ selector: {}, update: {} })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ reason: "unsupportedProfile" });
    expect(env.resolve.mock.calls).toEqual([["query"]]);
    expect(bound.listStockLocationAddresses).not.toHaveBeenCalled();
  });

  it("retains genuine Address preimages, identifies creations and keeps delete-before-upsert compensation calls", async () => {
    const preimages = [{ id: "laddr_existing", city: "Before" }];
    const updated = [{ id: "laddr_new", city: "Created" }, { id: "laddr_existing", city: "After" }];
    const listStockLocationAddresses = vi.fn(async () => preimages), upsertStockLocationAddresses = vi.fn(async () => updated);
    const deleteStockLocationAddresses = vi.fn(async () => undefined);
    const env = nativePort({ stock_location: { listStockLocationAddresses, upsertStockLocationAddresses, deleteStockLocationAddresses } });
    const node = nativeStep("upsert-stock-location-addresses-step");
    const response = await node.invoke([{ id: "laddr_existing", city: "After" }, { address_1: "New", country_code: "mm" }], env.context);
    if (!(response instanceof StepResponse) || node.compensate === undefined) throw new Error("Missing genuine Address response or inverse");
    expect(listStockLocationAddresses).toHaveBeenCalledExactlyOnceWith({ id: ["laddr_existing"] },
      { select: ["id", "city", "address_1", "country_code"], relations: [] });
    expect(response.output).toBe(updated);
    expect(response.compensateInput).toEqual({ dataToUpdate: preimages, dataToDelete: [updated[0]] });
    upsertStockLocationAddresses.mockClear();
    await node.compensate(undefined, env.context);
    expect(deleteStockLocationAddresses).not.toHaveBeenCalled(); expect(upsertStockLocationAddresses).not.toHaveBeenCalled();
    await node.compensate(response.compensateInput, env.context);
    expect(deleteStockLocationAddresses).toHaveBeenCalledExactlyOnceWith(["laddr_new"]);
    expect(upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith(preimages);
    callOrder([deleteStockLocationAddresses, upsertStockLocationAddresses]);
  });

  it("preserves truthy empty-array Address compensation instead of adding a length guard", async () => {
    const deleteStockLocationAddresses = vi.fn(async () => undefined), upsertStockLocationAddresses = vi.fn(async () => []);
    const env = nativePort({ stock_location: { deleteStockLocationAddresses, upsertStockLocationAddresses } });
    const node = nativeStep("upsert-stock-location-addresses-step");
    if (node.compensate === undefined) throw new Error("Missing genuine Address inverse");
    await node.compensate({ dataToDelete: [], dataToUpdate: [] }, env.context);
    expect(deleteStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([]);
    expect(upsertStockLocationAddresses).toHaveBeenCalledExactlyOnceWith([]);
    callOrder([deleteStockLocationAddresses, upsertStockLocationAddresses]);
  });

  it("keeps partial Location preimages and its precise truthy-field compensation mapping", async () => {
    const preimages = [{ id: "sloc_a", metadata: null }, { id: "sloc_b", name: "Before", metadata: { keep: true }, address: {} }];
    const listStockLocations = vi.fn(async () => preimages), updateStockLocations = vi.fn(async () => location);
    const upsertStockLocations = vi.fn(async () => []);
    const env = nativePort({ stock_location: { listStockLocations, updateStockLocations, upsertStockLocations } });
    const node = nativeStep("update-stock-locations-step");
    const response = await node.invoke({ selector: {}, update: { metadata: { nested: { yes: true } } } }, env.context);
    if (!(response instanceof StepResponse) || node.compensate === undefined) throw new Error("Missing genuine Location response or inverse");
    expect(listStockLocations).toHaveBeenCalledExactlyOnceWith({}, { select: ["metadata.nested.yes"], relations: [] });
    expect(response.output).toBe(location); expect(response.compensateInput).toBe(preimages);
    await node.compensate(undefined, env.context); await node.compensate([], env.context);
    expect(upsertStockLocations).not.toHaveBeenCalled();
    await node.compensate(response.compensateInput, env.context);
    expect(upsertStockLocations).toHaveBeenCalledExactlyOnceWith([
      { id: "sloc_a", name: undefined }, { id: "sloc_b", name: "Before", metadata: { keep: true }, address: {} },
    ]);
  });
});

describe("genuine native Stock Location service update helpers", () => {
  it("partitions by truthy Address ID, starts creation first and flattens created rows before updated rows", async () => {
    const created = [{ id: "laddr_new" }], updated = [{ id: "laddr_existing" }];
    const create = vi.fn(async () => created), update = vi.fn(async () => updated);
    const receiver = { stockLocationAddressService_: { create, update } }, context = { transactionManager: {} };
    const oldPatch = { id: "laddr_existing", city: "Patch" }, newAddress = { address_1: "Street", country_code: "mm" };
    const result = await Reflect.apply(StockLocationModuleService.prototype.upsertStockLocationAddresses_, receiver,
      [[oldPatch, newAddress], context]);
    expect(create).toHaveBeenCalledExactlyOnceWith([newAddress], context);
    expect(update).toHaveBeenCalledExactlyOnceWith([oldPatch], context);
    callOrder([create, update]); expect(result).toEqual([...created, ...updated]);
  });

  it("retains the genuine empty Address upsert without creating or updating any rows", async () => {
    const create = vi.fn(async () => []), update = vi.fn(async () => []);
    const receiver = { stockLocationAddressService_: { create, update } };
    expect(await Reflect.apply(StockLocationModuleService.prototype.upsertStockLocationAddresses_, receiver,
      [[], { transactionManager: {} }])).toEqual([]);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });

  it.each([false, true])("returns serialized[0] for selector/object update, including native absence (%s)", async missing => {
    const rows = missing ? [] : [location, { ...location, id: "sloc_b" }];
    const updateStockLocations_ = vi.fn(async (_input: unknown, _context: unknown) => rows), serialize = vi.fn(async (input: unknown) => input);
    const getFreshManager = vi.fn(() => ({}));
    const receiver = { updateStockLocations_, baseRepository_: { serialize, getFreshManager } };
    const selector = { id: ["sloc_a", "sloc_b"] }, patch = { name: "Updated" };
    expect(await Reflect.apply(StockLocationModuleService.prototype.updateStockLocations, receiver,
      [selector, patch, { manager: {}, transactionManager: {} }])).toEqual(rows[0]);
    expect(updateStockLocations_).toHaveBeenCalledTimes(1);
    expect(updateStockLocations_.mock.calls[0]?.[0]).toEqual({ selector, data: patch });
    expect(serialize).toHaveBeenCalledExactlyOnceWith(rows);
    expect(getFreshManager).not.toHaveBeenCalled();
  });
});

/** Exact selector expansion and metadata handling stay inside the native
 * internal service. This scripted DAL captures its output pairs only. */
describe("native Stock Location selector metadata ordering", () => {
  it("retains the shared selector patch mutation across distinct existing metadata rows", async () => {
    const rows = [
      { id: "sloc_a", name: "First", metadata: { keep: "first", drop: "old-first", first: true } },
      { id: "sloc_b", name: "Second", metadata: { keep: "second", drop: "old-second", second: true } },
    ];
    const find = vi.fn<DAL.RepositoryService["find"]>().mockResolvedValue(rows);
    const update = vi.fn<DAL.RepositoryService["update"]>().mockResolvedValue([]);
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
    const Service = MedusaInternalService(StockLocation);
    const internal = new Service<object, typeof StockLocation>({ stockLocationRepository: repository });
    const selector = { id: ["sloc_a", "sloc_b"] };
    const data = { metadata: { drop: "", added: true } };
    const context = { manager: {}, transactionManager: {} };
    expect(await internal.update({ selector, data }, context)).toEqual([]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledExactlyOnceWith([
      { entity: { id: "sloc_a", name: "First", metadata: { keep: "first", first: true, added: true } },
        update: { metadata: { keep: "first", drop: "old-second", second: true, first: true, added: true } } },
      { entity: { id: "sloc_b", name: "Second", metadata: { keep: "first", drop: "old-second", second: true, first: true, added: true } },
        update: { metadata: { keep: "first", drop: "old-second", second: true, first: true, added: true } } },
    ], context);
    const pairs = update.mock.calls[0]?.[0];
    if (!Array.isArray(pairs) || pairs.length !== 2) throw new Error("Missing genuine native update pairs");
    const first = pairs[0], second = pairs[1];
    if (first === undefined || second === undefined) throw new Error("Missing ordered native update pairs");
    expect(first.update).toBe(data); expect(second.update).toBe(data);
    expect(data.metadata).toEqual({ keep: "first", drop: "old-second", second: true, first: true, added: true });
    expect(repository.transaction).not.toHaveBeenCalled();
  });
});
