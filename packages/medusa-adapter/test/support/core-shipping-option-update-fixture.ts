import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateShippingOptionsWorkflow } from "@medusajs/core-flows/fulfillment/update-shipping-options";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeLocalShippingOptionUpdateCommands } from "../../src/modules/fulfillment/shipping-option-update-service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { prepareShippingOptionUpdateWorkflow, prepareShippingOptionUpdateResources, ShippingOptionUpdateInput,
  shippingOptionUpdateEvents } from "../../src/workflows/fulfillment/update-shipping-options";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { shippingOptionUpdateResources, shippingOptionUpdateCommandMs } from "../../src/workflow/policy";
import { prepareCoreShippingOptionCreation } from "./core-shipping-option-creation-fixture";
import { finishOrderFixture, orderFixtureHosts } from "./core-order-fixture";
import { shippingOptionCreationInput, shippingOptionRegionIds } from "./shipping-option-creation-fixture-data";

const revision = createHash("sha256").update("native-shipping-option-update-139").digest("hex");
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
export interface ShippingOptionUpdateObservation {
  readonly participantOrdinal: number;
  readonly call: Parameters<LogicalCommerceCallValidation>[0];
  readonly activity: Parameters<LogicalCommerceCallValidation>[1];
}
type NativeInput = Parameters<typeof updateShippingOptionsWorkflow.runAsStep>[0]["input"];

/** Creation and update borrow the same seven authentic Core sources and owner.
 * The fixture captures actual activity without replacing its validation. */
export async function prepareCoreShippingOptionUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  settings: Parameters<typeof prepareCoreShippingOptionCreation>[2] = {}) {
  const base = await prepareCoreShippingOptionCreation(driver, close, settings);
  const fulfillment = await Effect.runPromise(makeLocalShippingOptionUpdateCommands());
  const pricing = await Effect.runPromise(makeLocalPricingCommands("shipping-option-updates"));
  const { own, closeCaseHosts: closeUpdateHosts } = orderFixtureHosts(close);
  const modules = {
    fulfillment: { module: fulfillment.workflow, nativeStorage: base.modules.fulfillment.nativeStorage },
    pricing: { module: pricing.workflow, nativeStorage: base.modules.pricing.nativeStorage },
    region: base.modules.region,
    stockLocation: base.modules.stockLocation,
    locationLinks: base.modules.locationLinks,
    providerLinks: base.modules.providerLinks,
    priceSetLinks: base.modules.priceSetLinks,
  };
  const options = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-shipping-update", revision: "9".repeat(64) }] };
  const resources = Result.getOrThrow(prepareShippingOptionUpdateResources({ fulfillment: fulfillment.workflow, pricing: pricing.workflow,
    region: base.region.workflow, stockLocation: base.stockLocation.workflow, locationLinks: base.locationLinks.workflow,
    providerLinks: base.providerLinks.workflow, priceSetLinks: base.priceSetLinks.workflow }));
  const observe = (observations?: ShippingOptionUpdateObservation[]): AtomicWorkflowExecution => observations === undefined ? base.execution : {
    ...base.execution,
    prepare: composition => base.execution.prepare({ ...composition,
      participants: composition.participants.map((member, participantOrdinal) => {
        const validate = member.validateLogicalCall;
        if (validate === undefined) return member;
        return { ...member, validateLogicalCall: (...args: Parameters<typeof validate>) => {
          const [call, activity] = args;
          observations.push({ participantOrdinal, call: structuredClone(call), activity: structuredClone(activity) });
          return validate.apply(member, args);
        } };
      }),
    }),
  };
  const prepare = async (observations?: ShippingOptionUpdateObservation[]) =>
    own(await Effect.runPromise(prepareShippingOptionUpdateWorkflow({ ...options, execution: observe(observations) })));
  const prepareRoundtrip = async (actualRetained: () => ShippingOptionUpdateRetained, lateFailure = false,
    observations?: ShippingOptionUpdateObservation[]) => {
    const inverse = createStep("probe-shipping-option-update-native-inverses", resources.callback(async (_input: null, context) => {
      const actual = actualRetained();
      await undo.event(actual.event, context); await undo.pricing(actual.pricing, context); await undo.option(actual.option, context);
      if (lateFailure) throw new Error("Late native Shipping Option update inverse failure");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe-shipping-option-update-retained-inverses", (value: WorkflowData<typeof ShippingOptionUpdateInput.Type>) => {
      // SAFETY: runtime admission supports the native partial Type/Rule and
      // omitted-price inputs beyond the public DTO's narrower declaration.
      const root = updateShippingOptionsWorkflow.runAsStep({ input: value as NativeInput });
      return new WorkflowResponse(inverse(transform(root, () => null)));
    });
    const installed = Object.fromEntries(Object.entries(modules).map(([name, binding]) => [name, { ...binding,
      logicalResources: shippingOptionUpdateResources, ...(name === "pricing" ? { logicalPublication: "mixed" as const } : {}) }]));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: installed, execution: observe(observations), operationScheduling: "queued",
      requestCallLimit: shippingOptionUpdateResources.calls, requestEventLimit: shippingOptionUpdateResources.eventMessages,
      requestByteLimit: shippingOptionUpdateResources.commandBytes, requestCommandMs: shippingOptionUpdateCommandMs,
      workflow: { name: "probeShippingOptionUpdateRetainedInverses", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: ShippingOptionUpdateInput, output: Schema.Null, events: shippingOptionUpdateEvents(fulfillment.workflow, fulfillment.contracts) } })));
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
  const closeCaseHosts = () => finishOrderFixture([closeUpdateHosts, base.closeCaseHosts]);
  return { ...base, creation: base, fulfillment, pricing, modules, options, resources, prepare, prepareRoundtrip, seed, closeCaseHosts };
}
