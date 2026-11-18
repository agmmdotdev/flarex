import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/update-shipping-options";
import { makeLocalShippingOptionUpdateCommands } from "../../src/modules/fulfillment/shipping-option-update-service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { prepareShippingOptionUpdateWorkflow, prepareShippingOptionUpdateResources, ShippingOptionUpdateInput,
  shippingOptionUpdateEvents } from "../../src/workflows/fulfillment/update-shipping-options";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { shippingOptionUpdateResources, shippingOptionUpdateCommandMs } from "../../src/workflow/policy";
import { prepareLogicalShippingOptionCreation, shippingOptionCreationInput, shippingOptionRegionIds } from "./logical-shipping-option-creation-fixture";

const native = Result.getOrThrow(updateShippingOptionsWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(node => node.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Shipping Option update inverse: " + name);
  return node.compensate;
}
const undo = { option: retained("create-shipping-options-step"), pricing: retained("set-shipping-options-prices-step"),
  event: retained("emit-event-step") };
export type ShippingOptionUpdateRetained = { readonly option: unknown; readonly pricing: unknown; readonly event: unknown };
type Base = Awaited<ReturnType<typeof prepareLogicalShippingOptionCreation>>;
type NativeInput = Parameters<typeof updateShippingOptionsWorkflow.runAsStep>[0]["input"];

/** Existing creation supplies authentic initial graphs and installed sources.
 * The update profile borrows the same kernel; this fixture invents no service,
 * Query result, provider, timestamp, storage write or inverse payload. */
export async function prepareLogicalShippingOptionUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  shared?: Parameters<typeof prepareLogicalShippingOptionCreation>[2]) {
  const base = await prepareLogicalShippingOptionCreation(driver, close, shared);
  const fulfillment = await Effect.runPromise(makeLocalShippingOptionUpdateCommands());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-option-updates"));
  const registration = <Module>(module: Module, original: Pick<Base["modules"]["fulfillment"], "logicalStorage">) => ({ module,
    logicalStorage: original.logicalStorage, logicalResources: shippingOptionUpdateResources });
  const modules = {
    fulfillment: registration(fulfillment.workflow, base.modules.fulfillment),
    pricing: { ...registration(pricing.workflow, base.modules.pricing), logicalPublication: "mixed" as const },
    region: registration(base.region.workflow, base.modules.region),
    stockLocation: registration(base.stockLocation.workflow, base.modules.stockLocation),
    locationLinks: registration(base.locationLinks.workflow, base.modules.locationLinks),
    providerLinks: registration(base.providerLinks.workflow, base.modules.providerLinks),
    priceSetLinks: registration(base.priceSetLinks.workflow, base.modules.priceSetLinks),
  };
  const options = { execution: base.execution, modules, revision: "9".repeat(64),
    subscribers: [{ id: "native-shipping-update", revision: "9".repeat(64) }] };
  const resources = Result.getOrThrow(prepareShippingOptionUpdateResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
    region: base.region.workflow, stockLocation: base.stockLocation.workflow, locationLinks: base.locationLinks.workflow,
    providerLinks: base.providerLinks.workflow, priceSetLinks: base.priceSetLinks.workflow }));
  const prepare = async () => {
    const host = await Effect.runPromise(prepareShippingOptionUpdateWorkflow(options));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const prepareRoundtrip = async (actualRetained: () => ShippingOptionUpdateRetained, lateFailure = false) => {
    const inverse = createStep("probe-shipping-option-update-native-inverses", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undo.event(actual.event, context);
      await undo.pricing(actual.pricing, context);
      await undo.option(actual.option, context);
      if (lateFailure) throw new Error("Late native Shipping Option update inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-shipping-option-update-retained-inverses", (value: WorkflowData<typeof ShippingOptionUpdateInput.Type>) => {
      // SAFETY: runtime admission deliberately supports the actual partial
      // Type/Rule and price omissions that the native DTO under-describes.
      const root = updateShippingOptionsWorkflow.runAsStep({ input: value as NativeInput });
      return new WorkflowResponse(inverse(transform(root, () => null)));
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued",
      requestCallLimit: shippingOptionUpdateResources.calls, requestEventLimit: shippingOptionUpdateResources.eventMessages,
      requestByteLimit: shippingOptionUpdateResources.commandBytes, requestCommandMs: shippingOptionUpdateCommandMs,
      workflow: { name: "probeShippingOptionUpdateRetainedInverses", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionUpdateInput, output: Schema.Null, events: shippingOptionUpdateEvents(fulfillment.workflow, fulfillment.contracts) } }));
    close(() => Effect.runPromise(host.close)); return host;
  };
  const seed = async (prefix: string, count = 1, maximum = false) => {
    const host = await base.prepare();
    const input = shippingOptionCreationInput(prefix, count).map((option, index) => ({ ...option,
      ...(maximum ? { rules: [0, 1, 2, 3].map(rule => ({ attribute: "attribute" + rule, operator: "eq", value: "old" + rule })) } : {}),
      prices: (maximum ? [0, 1] : [0]).map(price => {
        const region = shippingOptionRegionIds[index * 2 + price];
        if (region === undefined) throw new Error("Missing Region for complete Shipping Option graph");
        return { region_id: region, amount: 100 + index + price, rules: [{ attribute: "cart_total", operator: "gte", value: 1 },
          { attribute: "cart_total", operator: "lt", value: 100 }] };
      }),
    }));
    return await Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  return { ...base, creation: base, fulfillment, pricing, modules, options, resources, prepare, prepareRoundtrip, seed };
}
