import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { StockLocationDeletionIds } from "../src/modules/stock-location/delete-input";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalStockLocationUpdate } from "./support/logical-stock-location-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const LifecycleInput = Schema.Struct({ operation: Schema.Literals(["softDelete", "restore"]), ids: StockLocationDeletionIds });
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject));
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStockLocationUpdate>>;
let lifecycle: Awaited<ReturnType<typeof prepareLifecycle>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const roots = (ids: readonly string[]) => Effect.runPromise(reader.read(connected.stock.list,
  { filters: { id: [...ids] }, config: { withDeleted: true, order: { id: "ASC" } } }).pipe(Effect.flatMap(decodeRows)));
const address = (id: string) => ({ id, address_1: "Retained street", country_code: "US", metadata: { retained: true } });

async function prepareLifecycle() {
  const native = await Effect.runPromise(makeStockLocationCommands("delete"));
  const resources = Result.getOrThrow(prepareWorkflowResources({ stock_location: {
    module: native.workflow, methods: ["softDeleteStockLocations", "restoreStockLocations"], graph: false,
  } }, true));
  const invoke = createStep("probe-stock-reference-lifecycle", resources.callback(async (input: typeof LifecycleInput.Type, context) => {
    if (input.operation === "softDelete") await context.resources.stock_location.softDeleteStockLocations([...input.ids]);
    else await context.resources.stock_location.restoreStockLocations([...input.ids]);
    return new StepResponse(null);
  }));
  const workflow = createWorkflow("probe-stock-one-to-one-lifecycle", (input: WorkflowData<typeof LifecycleInput.Type>) =>
    new WorkflowResponse(invoke(input)));
  return Effect.runPromise(prepareAtomicWorkflowHost({ execution: connected.execution,
    modules: { stock_location: { module: native.workflow, logicalStorage: connected.options.modules.stock_location.logicalStorage } },
    revision: "7".repeat(64), subscribers: [{ id: "native-stock-reference-lifecycle", revision: "8".repeat(64) }],
    workflow: { name: "probeStockOneToOneLifecycle", resources, prepared: Result.getOrThrow(workflow.prepare()),
      input: LifecycleInput, output: Schema.Null, events: internalModuleWorkflowEvents },
  }));
}

const runLifecycle = (operation: typeof LifecycleInput.Type["operation"], ids: readonly string[]) =>
  Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { operation, ids: [...ids] }));

describe(`genuine native Stock Location active one-to-one constraints - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalStockLocationUpdate(driver, close => cleanup.push(close));
    reader = await Effect.runPromise(makeCommerceHost({ ...connected.fixture.hostInput,
      commands: connected.stock.commands, logicalStorage: connected.options.modules.stock_location.logicalStorage }));
    cleanup.push(() => Effect.runPromise(reader.close));
    lifecycle = await prepareLifecycle();
    cleanup.push(() => Effect.runPromise(lifecycle.close));
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("allows multiple active roots whose nullable Address references are NULL", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: "stock-null-reference-a", name: "No Address A" },
      { id: "stock-null-reference-b", name: "No Address B" },
    ]));
    expect(result).toMatchObject([
      { id: "stock-null-reference-a", address_id: null }, { id: "stock-null-reference-b", address_id: null },
    ]);
    expect(await Effect.runPromise(connected.addresses())).toEqual([]);
    const after = await snapshot();
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(after.events.slice(before.events.length).map(event => event.envelope)).toMatchObject([
      { contract: "stock_location.stock-location.created", message: { data: { id: "stock-null-reference-a" } } },
      { contract: "stock_location.stock-location.created", message: { data: { id: "stock-null-reference-b" } } },
    ]);
  }, 180_000);

  it("releases only deleted owners' claims, refuses an atomic conflicting restore cohort and retains Address history", async () => {
    const old = "stock-unique-z-old", peer = "stock-unique-a-peer", cold = "stock-unique-cold", replacement = "stock-unique-new";
    const shared = "stock-unique-retained-address", peerAddress = "stock-unique-peer-address", coldAddress = "stock-unique-cold-address";
    await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: old, name: "Original", address: address(shared) },
      { id: peer, name: "Restore cohort peer", address: address(peerAddress) },
      { id: cold, name: "Untouched guard", address: address(coldAddress) },
    ]));
    const original = await roots([old, peer, cold]);
    const retainedAddresses = await Effect.runPromise(connected.addresses([shared, peerAddress, coldAddress]));
    const beforeDeletion = await snapshot();
    expect(await runLifecycle("softDelete", [old, peer])).toBeNull();
    const deleted = await roots([old, peer]);
    for (const row of deleted) expect(row).toEqual({ ...original.find(value => value.id === row.id),
      deleted_at: expect.any(String), updated_at: expect.any(String) });
    const afterDeletion = await snapshot();
    expect(afterDeletion.rowChanges.length - beforeDeletion.rowChanges.length).toBe(2);
    expect(afterDeletion.events.slice(beforeDeletion.events.length).map(event => event.envelope)).toMatchObject([
      { contract: "stock_location.stock-location.deleted", message: { data: { id: peer } } },
      { contract: "stock_location.stock-location.deleted", message: { data: { id: old } } },
    ]);
    expect(await Effect.runPromise(connected.addresses([shared, peerAddress, coldAddress]))).toEqual(retainedAddresses);

    const created = await Effect.runPromise(connected.creator.run(connected.creator.newRequestKey(), [
      { id: replacement, name: "New active owner", address_id: shared },
    ]));
    expect(created).toMatchObject([{ id: replacement, address_id: shared }]);
    const afterReuse = await snapshot();
    expect(afterReuse.rows.length - afterDeletion.rows.length).toBe(1);
    expect(afterReuse.rowChanges.length - afterDeletion.rowChanges.length).toBe(1);
    expect(afterReuse.events.slice(afterDeletion.events.length).map(event => event.envelope)).toMatchObject([
      { contract: "stock_location.stock-location.created", message: { data: { id: replacement } } },
    ]);

    // Native membership ordering selects the nonconflicting peer first. The
    // owning settlement must roll back the whole restore cohort and its events.
    await expect(runLifecycle("restore", [peer, old])).rejects.toThrow();
    expect(await snapshot()).toEqual(afterReuse);
    expect(await roots([old, peer])).toEqual(deleted);
    expect(await roots([cold])).toEqual(original.filter(row => row.id === cold));
    expect(await Effect.runPromise(connected.addresses([shared, peerAddress, coldAddress]))).toEqual(retainedAddresses);

    expect(await runLifecycle("softDelete", [replacement])).toBeNull();
    const beforeRestore = await snapshot();
    expect(await runLifecycle("restore", [peer, old])).toBeNull();
    const restored = await roots([peer, old]);
    for (const row of restored) expect(row).toEqual({ ...original.find(value => value.id === row.id),
      deleted_at: null, updated_at: expect.any(String) });
    expect(await roots([replacement])).toMatchObject([{ id: replacement, address_id: shared, deleted_at: expect.any(String) }]);
    expect(await roots([cold])).toEqual(original.filter(row => row.id === cold));
    expect(await Effect.runPromise(connected.addresses([shared, peerAddress, coldAddress]))).toEqual(retainedAddresses);
    const afterRestore = await snapshot();
    expect(afterRestore.rows.map(row => row.rowId)).toEqual(beforeRestore.rows.map(row => row.rowId));
    expect(afterRestore.revisions).toEqual(expect.arrayContaining(beforeRestore.revisions));
    expect(afterRestore.revisions.length - beforeRestore.revisions.length).toBe(2);
    expect(afterRestore.rowChanges.length - beforeRestore.rowChanges.length).toBe(2);
    expect(afterRestore.events.slice(beforeRestore.events.length).map(event => event.envelope)).toMatchObject([
      { contract: "stock.stock-location.restored", message: { data: { id: peer } } },
      { contract: "stock.stock-location.restored", message: { data: { id: old } } },
    ]);
    expect(afterRestore.events.slice(beforeRestore.events.length).every(event => event.envelope.internal)).toBe(true);
  }, 240_000);
});
