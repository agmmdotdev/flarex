import { prepareCorePricingMaintenance } from "./core-pricing-maintenance-fixture";
import { priceListDeletionComparisonRows, type DeletionScenario } from "./pricing-list-comparison-rows";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deletePriceListsWorkflow } from "@medusajs/core-flows/price-list/delete-price-lists";
import { createPriceListsWorkflow } from "@medusajs/core-flows/price-list/create-price-lists";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListDeletionIds } from "../../src/modules/pricing/list-input";
import { PriceListDeletionWorkflowInput } from "../../src/modules/pricing/list-deletion-input";
import { PriceListUpdatesInput } from "../../src/modules/pricing/list-update-input";
import { preparePriceListDeletionLinkResource } from "../../src/links/price-list-deletion";
import { prepareDeletePriceListsWorkflow } from "../../src/workflows/pricing/delete-price-lists";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { priceListDeletionResources } from "../../src/workflow/policy";

const revision = "4".repeat(64);
const native = Result.getOrThrow(deletePriceListsWorkflow.prepare());
function callbacks(name: string) {
  const node = native.nodes.find(candidate => candidate.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || !node.compensate)
    throw new Error("Missing original retained deletion callback: " + name);
  return { invoke: node.invoke, compensate: node.compensate };
}
const pricingCallbacks = callbacks("delete-price-lists"), linkCallbacks = callbacks("remove-remote-links");
const creation = Result.getOrThrow(createPriceListsWorkflow.prepare()).nodes.find(node => node.name === "create-price-lists");
if (creation?.kind !== "step" || !creation.compensate) throw new Error("Missing original physical inverse");
const physicalInverse = creation.compensate;
export const PriceListDeletionRetained = Schema.Struct({ pricing: PriceListDeletionIds,
  link: Schema.Struct({ pricing: Schema.Struct({ price_list_id: PriceListDeletionIds }) }) });
type Retained = typeof PriceListDeletionRetained.Type;
type Options = Parameters<typeof prepareDeletePriceListsWorkflow>[0];
interface ParentOptions { readonly lateFailure?: boolean; readonly caughtRefusal?: boolean;
  readonly inspect?: (value: unknown) => void; readonly escape?: (work: () => Promise<unknown>) => void; }

/** Canonical comparison history is setup data, never a native administrative
 * API. Every forward, inverse and outside edit below uses existing native owners. */

export async function prepareCorePriceListDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  scenario: DeletionScenario = "maximum") {
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-deletions"));
  const comparison = priceListDeletionComparisonRows(scenario), { seedRows, targetIds } = comparison;
  const connected = await prepareCorePricingMaintenance(driver, close, { pricing, seedRows });
  const { fixture, execution } = connected;
  const link = Result.getOrThrow(preparePriceListDeletionLinkResource());
  const options: Options = { execution, pricing: { module: pricing.workflow, nativeStorage: connected.pricing.source }, link, revision,
    subscribers: [{ id: "native-price-list-delete", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow,
    methods: ["softDeletePriceLists", "restorePriceLists"], graph: false } }, true, { link }));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe154-original-forward", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      const deleted = await pricingCallbacks.invoke(ids, context);
      if (!(deleted instanceof StepResponse)) throw new Error("Missing genuine native deletion StepResponse");
      const removed = await linkCallbacks.invoke({ pricing: { price_list_id: ids } }, context);
      if (!(removed instanceof StepResponse)) throw new Error("Missing genuine native Link StepResponse");
      return { pricing: deleted.compensateInput, link: removed.compensateInput };
    }));
    const flow = createWorkflow("probe154-original-forward-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: PriceListDeletionRetained, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe154-original-inverse", resources.callback(async (input: Retained, context) => {
      await linkCallbacks.compensate(input.link, context); await pricingCallbacks.compensate(input.pricing, context);
      if (repeat) { await linkCallbacks.compensate(input.link, context); await pricingCallbacks.compensate(input.pricing, context); }
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe154-original-inverse-root", (input: WorkflowData<Retained>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionRetained,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}) => {
    const step = createStep("probe154-parent", resources.callback(async (_: unknown, context) => {
      configuration.inspect?.(context.resources); configuration.escape?.(() => context.resources.pricing.softDeletePriceLists([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Authentic caller catches refused authority. */ } }
      if (configuration.lateFailure) throw new Error("Late parent failure after genuine Price List deletion");
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe154-parent-root", (input: WorkflowData<typeof PriceListDeletionWorkflowInput.Type>) => {
      const deleted = deletePriceListsWorkflow.runAsStep({ input }); return new WorkflowResponse(step(deleted));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "probePriceListDeleteParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionWorkflowInput,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareRestore = async () => {
    const step = createStep("fixture154-restore", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) =>
      context.resources.pricing.restorePriceLists([...ids])));
    const flow = createWorkflow("fixture154-restore-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, logicalResources: priceListDeletionResources } }, operationScheduling: "queued",
      requestCallLimit: priceListDeletionResources.calls,
      workflow: { name: "fixturePriceListRestore", resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: Schema.JsonObject, events: internalModuleWorkflowEvents } })));
  };
  // Refusal/replay control: the identical original root and command identity
  // intentionally omit both named allowance selections. No caller chooses it.
  const prepareDefault64 = async () => own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
    modules: { pricing: options.pricing }, operationScheduling: "queued", workflow: { name: "deletePriceListsWorkflow", resources,
      prepared: native, input: PriceListDeletionWorkflowInput, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  const prepareOutsideUpdate = async () => {
    const update = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: update.workflow, methods: ["updatePriceLists"], graph: false } }, true));
    const step = createStep("fixture154-outside-update", selected.callback(async (data: typeof PriceListUpdatesInput.Type, context) =>
      context.resources.pricing.updatePriceLists(structuredClone(data))));
    const flow = createWorkflow("fixture154-outside-update-root", (data: WorkflowData<typeof PriceListUpdatesInput.Type>) => new WorkflowResponse(step(data)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, module: update.workflow, logicalPublication: "mixed" } },
      workflow: { name: "fixturePriceListOutsideUpdate", resources: selected, prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdatesInput,
        output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
  };
  const preparePhysicalDeletion = async () => {
    const create = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: create.workflow, methods: ["deletePriceLists"], graph: false } }, true));
    const step = createStep("fixture154-physical-inverse", selected.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await physicalInverse(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("fixture154-physical-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: { pricing: { ...options.pricing, module: create.workflow } },
      workflow: { name: "fixturePriceListPhysicalInverse", resources: selected, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const readRows = (ids?: readonly string[]) => connected.readRows(ids);
  return { fixture, pricing, options, native, ...comparison, prepareForward, prepareInverse, prepareWrapped, prepareRestore, prepareDefault64,
    prepareOutsideUpdate, preparePhysicalDeletion, readRows, read: async (ids?: readonly string[]) => (await readRows(ids)).map(item => item.row),
    prepare: async () => own(await Effect.runPromise(prepareDeletePriceListsWorkflow(options))), snapshot: fixture.snapshot, closeCaseHosts };
}
