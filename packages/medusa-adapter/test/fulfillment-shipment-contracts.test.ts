import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { updateFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/update-fulfillment";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { prepareFulfillmentShipmentResources, prepareFulfillmentShipmentWorkflow, FulfillmentShipmentInput } from "../src/workflows/fulfillment/create-shipment";
import { workflowResourceSelections } from "../src/workflow/resources";
import { defineWorkflowModule } from "../src/workflow/module";

describe("native Fulfillment shipment authority", () => {
  it("selects only genuine retrieve and update methods and keeps the actual retained inverse", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const resources = Result.getOrThrow(prepareFulfillmentShipmentResources({ fulfillment: fulfillment.workflow }));
    expect(workflowResourceSelections(resources)?.map(member => ({ name: member.name, methods: member.methods, graph: member.graph })))
      .toEqual([{ name: "fulfillment", methods: ["retrieveFulfillment", "updateFulfillment"], graph: false }]);
    const native = Result.getOrThrow(updateFulfillmentWorkflow.prepare()), node = native.nodes.find(node => node.name === "update-fulfillment");
    expect(node).toMatchObject({ kind: "step", compensation: "transactionCovered", compensate: expect.any(Function) });
    expect(Schema.is(FulfillmentShipmentInput)({ id: "ful144", labels: [] })).toBe(true);
    for (const input of [{ labels: [] }, { id: "ful144" }, { id: "ful144", labels: null },
      { id: "ful144", labels: [{}] }, { id: "ful144", labels: Array.from({ length: 5 }, () => ({ tracking_number: "n", tracking_url: "u", label_url: "l" })) }])
      expect(Schema.is(FulfillmentShipmentInput)(input)).toBe(false);
  });

  it("refuses copied identities, reference-detachment authority and extra dependencies", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    for (const supplied of [{ fulfillment: { ...fulfillment.workflow } }, { fulfillment: combined.workflow }])
      expect(Reflect.apply(prepareFulfillmentShipmentResources, undefined, [supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    for (const supplied of [{}, { fulfillment: fulfillment.workflow, query: {} }, { fulfillment: fulfillment.workflow, provider: {} }])
      expect(Reflect.apply(prepareFulfillmentShipmentResources, undefined, [supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("refuses facade expansion and accessor registrations before preparing execution", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Shipment execution preparation must not run")));
    const wrong = Result.getOrThrow(defineWorkflowModule({ name: "fulfillment", source: { name: "flarex-fulfillment-create", profile: "wrong-profile" },
      methods: {}, graph: { aliases: [], reads: [] } }));
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, modules: { fulfillment: { module: wrong, logicalStorage: {} } },
      revision: "5".repeat(64), subscribers: [{ id: "shipment144", revision: "5".repeat(64) }] };
    for (const supplied of [{ ...base, hooks: {} }, { ...base, provider: {} }, { ...base, modules: {} },
      { ...base, modules: { ...base.modules, stockLocation: base.modules.fulfillment } }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentShipmentWorkflow, undefined, [supplied]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentShipmentWorkflow, undefined, [base]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const getter = vi.fn(() => base.modules.fulfillment), accessor = {};
    Object.defineProperty(accessor, "fulfillment", { enumerable: true, get: getter });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentShipmentWorkflow, undefined, [{ ...base, modules: accessor }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
});
