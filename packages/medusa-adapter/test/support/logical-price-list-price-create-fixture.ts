import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPriceListPricesWorkflow, type CreatePriceListPricesWorkflowInput } from "@medusajs/core-flows/price-list/create-price-list-prices";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListPriceCreationWorkflowInput, compilePriceListPriceCreationContracts } from "../../src/modules/pricing/price-list-price-input";
import { prepareCreatePriceListPricesWorkflow } from "../../src/workflows/pricing/create-price-list-prices";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { priceListPriceCreationResources } from "../../src/workflow/policy";
import { prepareLogicalPriceListCreation } from "./logical-price-list-create-fixture";

const Ids = Schema.Array(Schema.String).check(Schema.isMaxLength(8));
type Input = typeof PriceListPriceCreationWorkflowInput.Type;
type Options = Parameters<typeof prepareCreatePriceListPricesWorkflow>[0];
const native = Result.getOrThrow(createPriceListPricesWorkflow.prepare());
const listValidation = native.nodes.find(node => node.name === "validate-price-lists");
const linkValidation = native.nodes.find(node => node.name === "validate-variant-price-links");
const creation = native.nodes.find(node => node.name === "create-price-list-prices");
if (listValidation?.kind !== "step" || linkValidation?.kind !== "step" || creation?.kind !== "step" ||
  creation.compensation !== "transactionCovered" || !creation.compensate)
  throw new Error("Missing genuine native Price List Price callbacks");
const callbacks = { lists: listValidation.invoke, links: linkValidation.invoke, create: creation.invoke, inverse: creation.compensate };

/** Reuse the installed Pricing/Link fixture and native List creation for seeds.
 * The tested branch and retained inverse always call original native callbacks. */
export async function prepareLogicalPriceListPriceCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalPriceListCreation(driver, close);
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-price-creations"));
  const options: Options = { ...base.options, modules: { ...base.options.modules,
    pricing: { ...base.options.modules.pricing, module: pricing.workflow, logicalResources: priceListPriceCreationResources, logicalPublication: "mixed" },
    link: { ...base.options.modules.link, logicalResources: priceListPriceCreationResources },
  } };
  const resources = Result.getOrThrow(prepareWorkflowResources({
    pricing: { module: pricing.workflow, methods: ["listPriceLists", "addPriceListPrices", "removePrices"], graph: false },
    link: { module: base.link.workflow, methods: [], graph: true, expose: false },
  }, true));
  const contracts = Result.getOrThrow(compilePriceListPriceCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); await base.closeCaseHosts(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareCreatePriceListPricesWorkflow(options)));
  // Same authenticated native root and selected participants, omitting only the
  // trusted root allowance to witness the default64 boundary and replay identity.
  const prepareDefault64 = async () => own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
    operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: {
      name: "createPriceListPricesWorkflow", resources, prepared: native, input: PriceListPriceCreationWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents,
    } })));
  const prepareForward = async () => {
    const step = createStep("probe155-retained-forward", resources.callback(async (input: Input, context) => {
      await callbacks.lists(input.data, context);
      const map = await callbacks.links(input.data, context);
      if (!(map instanceof StepResponse)) throw new Error("Missing genuine Link validation output");
      const response = await callbacks.create({ data: input.data, variant_price_map: map.output }, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Price creation output");
      return { output: response.output, compensation: response.compensateInput ?? [] };
    }));
    const flow = createWorkflow("probe155-retained-forward-root", (input: WorkflowData<CreatePriceListPricesWorkflowInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceCreationResources.calls, workflow: { name: "probePriceListPriceForward", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListPriceCreationWorkflowInput,
      output: Schema.Struct({ output: contracts.Output, compensation: Ids }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe155-retained-inverse", resources.callback(async (ids: typeof Ids.Type, context) => {
      await callbacks.inverse(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe155-retained-inverse-root", (ids: WorkflowData<typeof Ids.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceCreationResources.calls, workflow: { name: "probePriceListPriceInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: Ids, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
    readonly escape?: (callback: () => Promise<unknown>) => void } = {}) => {
    const step = createStep("probe155-parent", resources.callback(async (output: unknown, context) => {
      configuration.escape?.(() => context.resources.pricing.addPriceListPrices([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Authentic caught refusal remains sticky. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after native Price List Price creation");
      return output;
    }));
    const flow = createWorkflow("probe155-parent-root", (input: WorkflowData<CreatePriceListPricesWorkflowInput>) => {
      const created = createPriceListPricesWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ created }, value => value.created)));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued", requestCallLimit: priceListPriceCreationResources.calls, workflow: { name: "probePriceListPriceParent", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListPriceCreationWorkflowInput, output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const seedLists = async (input: Parameters<Awaited<ReturnType<typeof base.prepare>>["run"]>[1]) => {
    const host = await base.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  return { ...base, pricing, options, contracts, seedLists, prepare, prepareDefault64, prepareForward, prepareInverse, prepareWrapped, closeCaseHosts };
}
