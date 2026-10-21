import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type PreparedWorkflow, type WorkflowData } from "@medusajs/workflows-sdk";
import { batchPriceListPricesWorkflow, type BatchPriceListPricesWorkflowInput } from "@medusajs/core-flows/price-list/batch-price-list-prices";
import { createPriceListPricesWorkflow } from "@medusajs/core-flows/price-list/create-price-list-prices";
import { updatePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/update-price-list-prices";
import { removePriceListPricesWorkflow } from "@medusajs/core-flows/price-list/remove-price-list-prices";
import { makePriceListPriceBatchCommands } from "../../src/modules/pricing/price-list-price-batch-service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceSetsInput } from "../../src/modules/pricing/input";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { PriceListPriceBatchWorkflowInput, compilePriceListPriceBatchContracts } from "../../src/modules/pricing/price-list-price-batch-input";
import { PriceListPriceCreationWorkflowInput, PriceListPriceRemovalIds, compilePriceListPriceCreationContracts } from "../../src/modules/pricing/price-list-price-input";
import { PriceListPriceUpdateWorkflowInput, compilePriceListPriceUpdateContracts } from "../../src/modules/pricing/price-list-price-update-input";
import { PriceListPriceRemovalWorkflowInput } from "../../src/modules/pricing/price-list-price-removal-input";
import { prepareBatchPriceListPricesWorkflow } from "../../src/workflows/pricing/batch-price-list-prices";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { priceListPriceBatchResources } from "../../src/workflow/policy";
import { prepareLogicalPriceListCreation } from "./logical-price-list-create-fixture";

const native = Result.getOrThrow(batchPriceListPricesWorkflow.prepare());
const nativeCreate = Result.getOrThrow(createPriceListPricesWorkflow.prepare());
const nativeUpdate = Result.getOrThrow(updatePriceListPricesWorkflow.prepare());
const nativeRemove = Result.getOrThrow(removePriceListPricesWorkflow.prepare());
function step(prepared: PreparedWorkflow, name: string) {
  const selected = prepared.nodes.find(node => node.name === name);
  if (selected?.kind !== "step") throw new Error("Missing genuine native child step: " + name);
  return selected;
}
const create = step(nativeCreate, "create-price-list-prices"), update = step(nativeUpdate, "update-price-list-prices"), remove = step(nativeRemove, "remove-price-list-prices");
if (!create.compensate || !update.compensate || !remove.compensate ||
  [create, update, remove].some(node => node.compensation !== "transactionCovered"))
  throw new Error("Missing genuine retained native Price batch callbacks");
const original = { create: create.invoke, undoCreate: create.compensate, update: update.invoke, undoUpdate: update.compensate,
  remove: remove.invoke, undoRemove: remove.compensate,
  createLists: step(nativeCreate, "validate-price-lists").invoke, createLinks: step(nativeCreate, "validate-variant-price-links").invoke,
  updateLists: step(nativeUpdate, "validate-price-lists").invoke, updateLinks: step(nativeUpdate, "validate-variant-price-links").invoke };
type Options = Parameters<typeof prepareBatchPriceListPricesWorkflow>[0];

/** Reuse 152's installed Pricing and genuine stored Link fixture. Tests choose
 * active variants 0..2; the fourth Set remains 152's historical-Set witness.
 * Actual parent execution retains its three native parallel child workflows.
 * Separate probes below prove each original child callback/inverse under the
 * combined admission; they do not simulate native parent cancellation order. */
export async function prepareLogicalPriceListPriceBatch(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const base = await prepareLogicalPriceListCreation(driver, close);
  const pricing = await Effect.runPromise(makePriceListPriceBatchCommands());
  const options: Options = { ...base.options, modules: {
    pricing: { ...base.options.modules.pricing, module: pricing.workflow, logicalResources: priceListPriceBatchResources, logicalPublication: "mixed" },
    link: { ...base.options.modules.link, logicalResources: priceListPriceBatchResources },
  } };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow, graph: false, methods: [
    "listPriceLists", "addPriceListPrices", "removePrices", "snapshotPriceListPricesForUpdate", "updatePriceListPrices", "restorePriceListPrices",
    "listPrices", "softDeletePrices", "restorePrices",
  ] }, link: { module: base.link.workflow, methods: [], graph: true, expose: false } }, true));
  const metadata = (await Effect.runPromise(capturePricingMetadata())).frame;
  const contracts = Result.getOrThrow(compilePriceListPriceBatchContracts(metadata));
  const creation = Result.getOrThrow(compilePriceListPriceCreationContracts(metadata)), updated = Result.getOrThrow(compilePriceListPriceUpdateContracts(metadata));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); await base.closeCaseHosts(); };
  close(closeCaseHosts);
  const prepareEffect = () => prepareBatchPriceListPricesWorkflow(options).pipe(Effect.tap(host => Effect.sync(() => { own(host); })));
  const prepare = async () => Effect.runPromise(prepareEffect());
  const prepareWrapped = async (configuration: { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
    readonly inspect?: (resources: unknown) => void; readonly escape?: (work: () => Promise<unknown>) => void } = {}) => {
    const parent = createStep("probe158-parent", resources.callback(async (output: unknown, context) => {
      configuration.inspect?.(context.resources); configuration.escape?.(() => context.resources.pricing.restorePrices([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Existing outer refusal remains sticky. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after original Price batch");
      return output;
    }));
    const flow = createWorkflow("probe158-parent-root", (input: WorkflowData<BatchPriceListPricesWorkflowInput>) => new WorkflowResponse(parent(batchPriceListPricesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatchParent", resources,
        prepared: Result.getOrThrow(flow.prepare()), input: PriceListPriceBatchWorkflowInput, output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const prepareCreationForward = async () => {
    const probe = createStep("probe158-original-create-forward", resources.callback(async (input: typeof PriceListPriceCreationWorkflowInput.Type, context) => {
      await original.createLists(input.data, context); const links = await original.createLinks(input.data, context);
      if (!(links instanceof StepResponse)) throw new Error("Missing genuine creation Link response");
      const response = await original.create({ data: input.data, variant_price_map: links.output }, context);
      if (!(response instanceof StepResponse) || response.compensateInput === undefined) throw new Error("Missing genuine creation retention");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe158-original-create-root", (input: WorkflowData<typeof PriceListPriceCreationWorkflowInput.Type>) => new WorkflowResponse(probe(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatchCreationForward", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceCreationWorkflowInput, output: Schema.Struct({ output: creation.Output, compensation: PriceListPriceRemovalIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareUpdateForward = async () => {
    const probe = createStep("probe158-original-update-forward", resources.callback(async (input: typeof PriceListPriceUpdateWorkflowInput.Type, context) => {
      await original.updateLists(input.data, context); const links = await original.updateLinks(input.data, context);
      if (!(links instanceof StepResponse)) throw new Error("Missing genuine update Link response");
      const response = await original.update({ data: input.data, variant_price_map: links.output }, context);
      if (!(response instanceof StepResponse) || response.compensateInput === undefined) throw new Error("Missing genuine update retention");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe158-original-update-root", (input: WorkflowData<typeof PriceListPriceUpdateWorkflowInput.Type>) => new WorkflowResponse(probe(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatchUpdateForward", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceUpdateWorkflowInput, output: Schema.Struct({ output: updated.Output, compensation: updated.Compensation }), events: internalModuleWorkflowEvents } })));
  };
  const prepareRemovalForward = async () => {
    const probe = createStep("probe158-original-removal-forward", resources.callback(async (input: typeof PriceListPriceRemovalWorkflowInput.Type, context) => {
      const response = await original.remove(input.ids, context);
      if (!(response instanceof StepResponse) || response.compensateInput === undefined) throw new Error("Missing genuine removal retention");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe158-original-removal-root", (input: WorkflowData<typeof PriceListPriceRemovalWorkflowInput.Type>) => new WorkflowResponse(probe(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatchRemovalForward", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalWorkflowInput, output: Schema.Struct({ output: PriceListPriceRemovalIds, compensation: PriceListPriceRemovalIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareIdsInverse = async (kind: "creation" | "removal") => {
    const probe = createStep("probe158-original-" + kind + "-inverse", resources.callback(async (ids: typeof PriceListPriceRemovalIds.Type, context) => {
      await (kind === "creation" ? original.undoCreate : original.undoRemove)(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe158-original-" + kind + "-inverse-root", (ids: WorkflowData<typeof PriceListPriceRemovalIds.Type>) => new WorkflowResponse(probe(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatch" + kind + "Inverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: PriceListPriceRemovalIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareUpdateInverse = async () => {
    const probe = createStep("probe158-original-update-inverse", resources.callback(async (input: typeof updated.Compensation.Type, context) => {
      await original.undoUpdate(input, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe158-original-update-inverse-root", (input: WorkflowData<typeof updated.Compensation.Type>) => new WorkflowResponse(probe(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      requestCallLimit: priceListPriceBatchResources.calls, workflow: { name: "probePriceBatchUpdateInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: updated.Compensation, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const seedLists = async (input: Parameters<Awaited<ReturnType<typeof base.prepare>>["run"]>[1]) => {
    const host = await base.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input));
  };
  const seedBasePrice = async () => {
    const createSet = await Effect.runPromise(makeLocalPricingCommands());
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: createSet.workflow, methods: ["createPriceSets"], graph: false } }, true));
    const probe = createStep("fixture158-genuine-base-price", selected.callback(async (input: typeof PriceSetsInput.Type, context) => context.resources.pricing.createPriceSets(input)));
    const flow = createWorkflow("fixture158-genuine-base-price-root", (input: WorkflowData<typeof PriceSetsInput.Type>) => new WorkflowResponse(probe(input)));
    const host = own(await Effect.runPromise(prepareAtomicWorkflowHost({ execution: options.execution, revision: options.revision, subscribers: options.subscribers,
      modules: { pricing: { ...base.options.modules.pricing, module: createSet.workflow } }, workflow: { name: "fixtureBatchBasePriceCreation", resources: selected,
        prepared: Result.getOrThrow(flow.prepare()), input: PriceSetsInput, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
    return Effect.runPromise(host.run(host.newRequestKey(), [{ prices: [{ currency_code: "USD", amount: 123 }] }]));
  };
  return { ...base, pricing, options, contracts, updateContracts: updated, native, seedLists, prepare, prepareEffect, prepareWrapped, prepareCreationForward, prepareUpdateForward,
    prepareRemovalForward, prepareIdsInverse, prepareUpdateInverse, seedBasePrice, closeCaseHosts };
}
