import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { cancelFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/cancel-fulfillment";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { prepareFulfillmentCancellationResources, prepareFulfillmentCancellationWorkflow, FulfillmentCancellationInput } from "../src/workflows/fulfillment/cancel-fulfillment";
import { workflowResourceSelections } from "../src/workflow/resources";
import { defineWorkflowModule } from "../src/workflow/module";

describe("standalone native Fulfillment cancellation authority", () => {
  it("selects exactly the authentic cancellation method and retains the genuine no-inverse declaration", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const resources = Result.getOrThrow(prepareFulfillmentCancellationResources({ fulfillment: fulfillment.workflow }));
    expect(workflowResourceSelections(resources)?.map(member => ({ name: member.name, methods: member.methods, graph: member.graph })))
      .toEqual([{ name: "fulfillment", methods: ["cancelFulfillment"], graph: false }]);
    const native = Result.getOrThrow(cancelFulfillmentWorkflow.prepare()), node = native.nodes.find(node => node.name === "cancel-fulfillment");
    if (node?.kind !== "step") throw new Error("Missing genuine native cancellation node");
    expect(node.compensate).toBeUndefined(); expect(node.compensation).toBeUndefined();
    expect(Schema.is(FulfillmentCancellationInput)({ id: "ful143" })).toBe(true);
  });

  it("rejects copied identities, the broader reference-detachment module and extra source capabilities", async () => {
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    expect(prepareFulfillmentCancellationResources({ fulfillment: { ...fulfillment.workflow } })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(Reflect.apply(prepareFulfillmentCancellationResources, undefined, [{ fulfillment: combined.workflow }])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    for (const supplied of [{}, { fulfillment: fulfillment.workflow, stockLocation: fulfillment.workflow }, { fulfillment: fulfillment.workflow, query: {} }])
      expect(Reflect.apply(prepareFulfillmentCancellationResources, undefined, [supplied])).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("refuses extra facade capabilities and accessor or forged module registrations before execution admission", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Cancellation execution preparation must not run")));
    const wrong = Result.getOrThrow(defineWorkflowModule({ name: "fulfillment", source: { name: "flarex-fulfillment-create", profile: "wrong-profile" },
      methods: {}, graph: { aliases: [], reads: [] } }));
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, modules: { fulfillment: { module: wrong, logicalStorage: {} } },
      revision: "3".repeat(64), subscribers: [{ id: "cancel143", revision: "3".repeat(64) }] };
    for (const supplied of [{ ...base, hooks: {} }, { ...base, provider: {} }, { ...base, modules: {} },
      { ...base, modules: { ...base.modules, stockLocation: base.modules.fulfillment } }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentCancellationWorkflow, undefined, [supplied]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentCancellationWorkflow, undefined, [base]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const getter = vi.fn(() => base.modules.fulfillment), accessor = {};
    Object.defineProperty(accessor, "fulfillment", { enumerable: true, get: getter });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentCancellationWorkflow, undefined, [{ ...base, modules: accessor }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });
});
