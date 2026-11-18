import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { captureFulfillmentCreationMetadata, compileFulfillmentCreationDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalShippingOptionCreationCommands } from "../src/modules/fulfillment/shipping-option-create-service";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { prepareFulfillmentCreationResources, prepareFulfillmentCreationWorkflow } from "../src/workflows/fulfillment/create-fulfillment";
import { workflowResourceSelections } from "../src/workflow/resources";
import { fulfillmentCreationResources, fulfillmentCreationCommandMs } from "../src/workflow/policy";
import type { AtomicWorkflowHostComposition, InstalledWorkflowModule } from "../src/workflow/host";

const selected = Effect.gen(function* () {
  const fulfillment = yield* makeLocalFulfillmentCreationCommands(), stockLocation = yield* makeStockLocationCommands("update");
  return { fulfillment: fulfillment.workflow, stockLocation: stockLocation.workflow };
});
let modules: Effect.Success<typeof selected>;
beforeAll(async () => { modules = await Effect.runPromise(selected); });

describe("native Fulfillment creation schema and capability contract", () => {
  it("adds the four native models in one fresh twelve-table definition and preserves exact FK/index metadata", async () => {
    const definition = await Effect.runPromise(compileFulfillmentCreationDefinition());
    const metadata = await Effect.runPromise(captureFulfillmentCreationMetadata());
    expect(definition.schema.tables).toHaveLength(12); expect(metadata.frame.tables).toHaveLength(12);
    for (const name of ["fulfillment", "fulfillment_address", "fulfillment_item", "fulfillment_label"])
      expect(definition.schema.tables.some(table => table.identity.tableId === name)).toBe(true);
    const root = metadata.frame.tables.find(table => table.name === "fulfillment");
    if (root === undefined) throw new Error("Missing checked native Fulfillment model");
    for (const [column, referencedTable] of [["delivery_address_id", "fulfillment_address"], ["provider_id", "fulfillment_provider"], ["shipping_option_id", "shipping_option"]])
      expect(root.foreignKeys).toContainEqual(expect.objectContaining({ columns: [column], referencedTable, referencedColumns: ["id"] }));
    expect(root.indexes).toContainEqual(expect.objectContaining({ columns: ["location_id"], where: "deleted_at IS NULL" }));
    expect(root.cascades.delete).toEqual(["delivery_address", "items", "labels"]);
    const item = metadata.frame.tables.find(table => table.name === "fulfillment_item");
    expect(item?.columns).toContainEqual(expect.objectContaining({ name: "quantity", type: "bigNumber" }));
    for (const column of ["line_item_id", "inventory_item_id"])
      expect(item?.indexes).toContainEqual(expect.objectContaining({ columns: [column], where: "deleted_at IS NULL" }));
    expect(definition.provenance.paths).toContain("packages/modules/fulfillment/src/models/address.ts");
    expect(definition.provenance.paths).not.toContain("packages/modules/fulfillment/src/models/fulfillment-address.ts");
  });

  it("selects exactly native creation/cancellation and hides the existing Location graph reader", () => {
    const resources = Result.getOrThrow(prepareFulfillmentCreationResources(modules));
    expect(workflowResourceSelections(resources)?.map(selection => [selection.name, selection.methods, selection.graph, selection.expose])).toEqual([
      ["fulfillment", ["createFulfillment", "cancelFulfillment"], false, undefined],
      ["stockLocation", [], true, false],
    ]);
    for (const altered of [{ ...modules, fulfillment: { ...modules.fulfillment } },
      { ...modules, stockLocation: { ...modules.stockLocation, methods: { ...modules.stockLocation.methods } } },
      { ...modules, provider: modules.fulfillment }, { fulfillment: modules.fulfillment }])
      expect(Result.isFailure(Reflect.apply(prepareFulfillmentCreationResources, undefined, [altered]))).toBe(true);
    const getter = vi.fn(() => modules.stockLocation), accessor = { ...modules };
    Object.defineProperty(accessor, "stockLocation", { enumerable: true, get: getter });
    expect(Result.isFailure(Reflect.apply(prepareFulfillmentCreationResources, undefined, [accessor]))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it("refuses scalar Location and other Fulfillment profiles before execution", async () => {
    const scalar = await Effect.runPromise(makeStockLocationCommands("read"));
    const options = await Effect.runPromise(makeLocalShippingOptionCreationCommands());
    for (const altered of [{ ...modules, stockLocation: scalar.workflow }, { ...modules, fulfillment: options.workflow }])
      expect(Result.isFailure(Reflect.apply(prepareFulfillmentCreationResources, undefined, [altered]))).toBe(true);
  });

  it("binds both participants to the named allowance and rejects resource substitutions before host execution", async () => {
    const installed: Record<string, InstalledWorkflowModule> = {};
    for (const [name, module] of Object.entries(modules)) Object.defineProperty(installed, name, {
      enumerable: true, value: { module, logicalStorage: {}, logicalPublication: "mixed" },
    });
    const captured: AtomicWorkflowHostComposition[] = [];
    const prepare = vi.fn((composition: AtomicWorkflowHostComposition) => {
      captured.push(composition);
      return Effect.succeed({ close: Effect.void, newRequestKey: () => "unit-key", run: () => Effect.succeed({}) });
    });
    const input = { execution: { identityAndAccessPolicy: { fixture: "preparation-only" }, prepare }, modules: installed,
      revision: "a".repeat(64), subscribers: [{ id: "fulfillment-creation", revision: "b".repeat(64) }] };
    await Effect.runPromise(Reflect.apply(prepareFulfillmentCreationWorkflow, undefined, [input]));
    expect(prepare).toHaveBeenCalledOnce();
    const composition = captured[0]; if (composition === undefined) throw new Error("Missing genuine creation composition");
    expect(composition.participants).toHaveLength(2);
    expect(composition).toMatchObject({ operationScheduling: "queued", requestCallLimit: fulfillmentCreationResources.calls,
      requestEventLimit: fulfillmentCreationResources.eventMessages, requestByteLimit: fulfillmentCreationResources.commandBytes,
      requestCommandMs: fulfillmentCreationCommandMs });
    for (const participant of composition.participants) {
      expect("logicalResources" in participant ? participant.logicalResources : undefined).toEqual(fulfillmentCreationResources);
      expect("logicalPublication" in participant ? participant.logicalPublication : undefined).toBeUndefined();
    }
    const altered = { ...installed, fulfillment: { module: modules.fulfillment, logicalStorage: {},
      logicalResources: { ...fulfillmentCreationResources, calls: fulfillmentCreationResources.calls - 1 } } };
    for (const options of [{ ...input, modules: altered }, { ...input, requestCallLimit: 1 }, { ...input, provider: {} }, { ...input, hooks: {} }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentCreationWorkflow, undefined, [options]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).toHaveBeenCalledOnce();
  });
});
