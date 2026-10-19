import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { makeLocalFulfillmentCreationCommands } from "../src/modules/fulfillment/fulfillment-create-service";
import { makeLocalFulfillmentShippingOptionReferenceDetachmentCommands } from "../src/modules/fulfillment/fulfillment-reference-detachment-service";
import { prepareFulfillmentUpdateWorkflow } from "../src/workflows/fulfillment/update-fulfillment";
import { fulfillmentUpdateResources } from "../src/workflow/policy";

describe("standalone Fulfillment update facade authority", () => {
  it("refuses expanded configuration, extra participants and accessor registrations before preparing execution", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Update execution preparation must not run")));
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const binding = { module: fulfillment.workflow, logicalStorage: {} };
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, modules: { fulfillment: binding },
      revision: "7".repeat(64), subscribers: [{ id: "update147", revision: "7".repeat(64) }] };
    for (const supplied of [{ ...base, hooks: {} }, { ...base, provider: {} }, { ...base, modules: {} },
      { ...base, modules: { fulfillment: binding, stockLocation: binding } }])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentUpdateWorkflow, undefined, [supplied]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    const getter = vi.fn(() => binding), accessor = {};
    Object.defineProperty(accessor, "fulfillment", { enumerable: true, get: getter });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentUpdateWorkflow, undefined, [{ ...base, modules: accessor }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("refuses copied or combined authority and altered resource limits before preparing execution", async () => {
    const prepare = vi.fn(() => Effect.die(new Error("Update execution preparation must not run")));
    const fulfillment = await Effect.runPromise(makeLocalFulfillmentCreationCommands());
    const combined = await Effect.runPromise(makeLocalFulfillmentShippingOptionReferenceDetachmentCommands());
    const base = { execution: { identityAndAccessPolicy: {}, prepare }, revision: "7".repeat(64),
      subscribers: [{ id: "update147", revision: "7".repeat(64) }] };
    for (const module of [{ ...fulfillment.workflow }, combined.workflow])
      expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentUpdateWorkflow, undefined,
        [{ ...base, modules: { fulfillment: { module, logicalStorage: {} } } }]))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await Effect.runPromise(Effect.result(Reflect.apply(prepareFulfillmentUpdateWorkflow, undefined,
      [{ ...base, modules: { fulfillment: { module: fulfillment.workflow, logicalStorage: {},
        logicalResources: { ...fulfillmentUpdateResources, calls: fulfillmentUpdateResources.calls - 1 } } } }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(prepare).not.toHaveBeenCalled();
  });
});
