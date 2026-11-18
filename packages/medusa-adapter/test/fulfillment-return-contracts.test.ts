import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { createReturnFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/create-return-fulfillment";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { prepareFulfillmentReturnResources, prepareFulfillmentReturnWorkflow } from "../src/workflows/fulfillment/create-return-fulfillment";
import { workflowResourceSelections } from "../src/workflow/resources";

describe("native Return Fulfillment authority", () => {
  it("selects the original create-return and retained cancellation methods with hidden singleton Location reads", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands()), stockLocation = await Effect.runPromise(makeStockLocationCommands("update"));
    const resources = Result.getOrThrow(prepareFulfillmentReturnResources({ fulfillment: fulfillment.workflow, stockLocation: stockLocation.workflow }));
    expect(workflowResourceSelections(resources)?.map(value => ({ name: value.name, methods: value.methods, graph: value.graph, expose: value.expose })))
      .toEqual([{ name: "fulfillment", methods: ["createReturnFulfillment", "cancelFulfillment"], graph: false, expose: undefined },
        { name: "stockLocation", methods: [], graph: true, expose: false }]);
    const native = Result.getOrThrow(createReturnFulfillmentWorkflow.prepare());
    expect(native.nodes.find(node => node.name === "create-return-fulfillment"))
      .toMatchObject({ kind: "step", compensation: "transactionCovered", compensate: expect.any(Function) });
  });

  it("refuses copied module identities, combined reference-detachment authority and extra resources", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands()), stockLocation = await Effect.runPromise(makeStockLocationCommands("update"));
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    for (const module of [{ ...fulfillment.workflow }, combined.workflow])
      expect(Reflect.apply(prepareFulfillmentReturnResources, undefined, [{ fulfillment: module, stockLocation: stockLocation.workflow }]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    for (const resources of [{ fulfillment: fulfillment.workflow }, { fulfillment: fulfillment.workflow, stockLocation: stockLocation.workflow, provider: {} }])
      expect(Reflect.apply(prepareFulfillmentReturnResources, undefined, [resources]))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("rejects facade expansion and accessor registrations before execution preparation", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Return execution must not prepare")));
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, modules: {}, revision: "6".repeat(64), subscribers: [] };
    for (const raw of [{ ...base, hooks: {} }, { ...base, provider: {} }, base])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentReturnWorkflow, undefined, [raw]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const getter = vi.fn(() => ({})), modules = {};
    Object.defineProperty(modules, "fulfillment", { enumerable: true, get: getter });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentReturnWorkflow, undefined, [{ ...base, modules }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
});
