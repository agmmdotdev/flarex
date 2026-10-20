import { Effect, Result, Schema } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import type { PriceListPriceUpdateCompensation } from "@medusajs/types";
import { updatePriceListPricesWorkflow, type UpdatePriceListPricesWorkflowInput } from "@medusajs/core-flows/price-list/update-price-list-prices";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListPriceUpdateWorkflowInput, compilePriceListPriceUpdateContracts } from "../../src/modules/pricing/price-list-price-update-input";
import { prepareUpdatePriceListPricesWorkflow } from "../../src/workflows/pricing/update-price-list-prices";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { priceListPriceUpdateResources } from "../../src/workflow/policy";
import { prepareLogicalPriceListCreation } from "./logical-price-list-create-fixture";

type Input = typeof PriceListPriceUpdateWorkflowInput.Type;
type Options = Parameters<typeof prepareUpdatePriceListPricesWorkflow>[0];
const native = Result.getOrThrow(updatePriceListPricesWorkflow.prepare());
const listValidation = native.nodes.find(node => node.name === "validate-price-lists");
const linkValidation = native.nodes.find(node => node.name === "validate-variant-price-links");
const update = native.nodes.find(node => node.name === "update-price-list-prices");
if (listValidation?.kind !== "step" || linkValidation?.kind !== "step" || update?.kind !== "step" ||
  update.compensation !== "transactionCovered" || !update.compensate)
  throw new Error("Missing genuine corrected native Price List Price callbacks");
const callbacks = { lists: listValidation.invoke, links: linkValidation.invoke, update: update.invoke, inverse: update.compensate };

/** The existing installed Pricing/Link catalog and genuine native List creation
 * seed complete graphs. All tested updates/inverses use the corrected callbacks. */
export async function prepareLogicalPriceListPriceUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalPriceListCreation(driver, close);
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-price-updates"));
  const options: Options = { ...base.options, modules: {
    pricing: { ...base.options.modules.pricing, module: pricing.workflow, logicalResources: priceListPriceUpdateResources, logicalPublication: "mixed" },
    link: { ...base.options.modules.link, logicalResources: priceListPriceUpdateResources },
  } };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    pricing: { module: pricing.workflow, methods: ["listPriceLists", "snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices"], graph: false },
    link: { module: base.link.workflow, methods: [], graph: true, expose: false },
  }, true));
  const contracts = Result.getOrThrow(compilePriceListPriceUpdateContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); await base.closeCaseHosts(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareUpdatePriceListPricesWorkflow(options)));
  // The same authentic native root and callbacks under the original64 policy.
  const prepareDefault64 = async () => own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: {
    pricing: { ...options.modules.pricing, logicalResources: defaultCommerceResources },
    link: { ...options.modules.link, logicalResources: defaultCommerceResources },
  }, operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: {
    name: "updatePriceListPricesWorkflow", resources, prepared: native, input: PriceListPriceUpdateWorkflowInput,
    output: contracts.Output, events: internalModuleWorkflowEvents,
  } })));
  const prepareForward = async () => {
    const step = createStep("probe156-retained-forward", resources.callback(async (input: Input, context) => {
      await callbacks.lists(input.data, context);
      const map = await callbacks.links(input.data, context);
      if (!(map instanceof StepResponse)) throw new Error("Missing genuine Link validation output");
      const response = await callbacks.update({ data: input.data, variant_price_map: map.output }, context);
      if (!(response instanceof StepResponse) || response.compensateInput === undefined)
        throw new Error("Missing genuine complete Price update retention");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe156-retained-forward-root", (input: WorkflowData<UpdatePriceListPricesWorkflowInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceUpdateResources.calls, workflow: {
        name: "probePriceListPriceUpdateForward", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceUpdateWorkflowInput,
        output: Schema.Struct({ output: contracts.Output, compensation: contracts.Compensation }), events: internalModuleWorkflowEvents,
      } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe156-retained-inverse", resources.callback(async (compensation: PriceListPriceUpdateCompensation, context) => {
      await callbacks.inverse(compensation, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe156-retained-inverse-root", (compensation: WorkflowData<PriceListPriceUpdateCompensation>) => new WorkflowResponse(step(compensation)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceUpdateResources.calls, workflow: {
        name: "probePriceListPriceUpdateInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: contracts.Compensation, output: Schema.Null, events: internalModuleWorkflowEvents,
      } })));
  };
  const prepareWrapped = async (configuration: { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
    readonly inspect?: (resources: unknown) => void; readonly escape?: (callback: () => Promise<unknown>) => void } = {}) => {
    const step = createStep("probe156-parent", resources.callback(async (output: unknown, context) => {
      configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.snapshotPriceListPricesForUpdate([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Existing refusal remains sticky. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after native Price List Price update");
      return output;
    }));
    const flow = createWorkflow("probe156-parent-root", (input: WorkflowData<UpdatePriceListPricesWorkflowInput>) =>
      new WorkflowResponse(step(updatePriceListPricesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceUpdateResources.calls, workflow: {
        name: "probePriceListPriceUpdateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceUpdateWorkflowInput, output: contracts.Output, events: internalModuleWorkflowEvents,
      } })));
  };
  const seedLists = async (input: Parameters<Awaited<ReturnType<typeof base.prepare>>["run"]>[1]) => {
    const host = await base.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  return { ...base, pricing, options, contracts, seedLists, prepare, prepareDefault64, prepareForward, prepareInverse, prepareWrapped, closeCaseHosts };
}
