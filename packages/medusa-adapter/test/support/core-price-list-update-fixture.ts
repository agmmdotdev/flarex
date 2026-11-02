import { prepareCorePricingMaintenance } from "./core-pricing-maintenance-fixture";
import { priceListUpdateComparisonRows } from "./pricing-list-comparison-rows";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updatePriceListsWorkflow, type UpdatePriceListsWorkflowInput } from "@medusajs/core-flows/price-list/update-price-lists";
import { createPriceListsWorkflow } from "@medusajs/core-flows/price-list/create-price-lists";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { PriceListDeletionIds } from "../../src/modules/pricing/list-input";
import { PriceListUpdateWorkflowInput, PriceListUpdatesInput } from "../../src/modules/pricing/list-update-input";
import { prepareUpdatePriceListsWorkflow } from "../../src/workflows/pricing/update-price-lists";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";

const revision = "d".repeat(64);
const original = Result.getOrThrow(updatePriceListsWorkflow.prepare());
const validation = original.nodes.find(node => node.name === "validate-price-lists");
const updating = original.nodes.find(node => node.name === "update-price-lists");
const creation = Result.getOrThrow(createPriceListsWorkflow.prepare()).nodes.find(node => node.name === "create-price-lists");
if (validation?.kind !== "step" || updating?.kind !== "step" || updating.compensation !== "transactionCovered" || !updating.compensate ||
  creation?.kind !== "step" || creation.compensation !== "transactionCovered" || !creation.compensate)
  throw new Error("Missing genuine Price List update/creation callbacks");
const retained = { validate: validation.invoke, invoke: updating.invoke, compensate: updating.compensate, remove: creation.compensate };
export const PriceListUpdateCompensation = Schema.NullOr(Schema.Struct({
  dataBeforeUpdate: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  selects: Schema.Array(Schema.String), relations: Schema.Array(Schema.String),
}));
export const PriceListUpdateProbeOutput = Schema.Struct({
  output: Schema.NullOr(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))), compensation: PriceListUpdateCompensation,
});
type Options = Parameters<typeof prepareUpdatePriceListsWorkflow>[0];
type Input = typeof PriceListUpdateWorkflowInput.Type;
interface ParentOptions {
  readonly lateFailure?: Error; readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void;
  readonly afterNative?: () => Promise<void>;
}

export async function prepareCorePriceListUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-updates"));
  const comparison = priceListUpdateComparisonRows(), { seedRows, targetIds } = comparison;
  const connected = await prepareCorePricingMaintenance(driver, close, { pricing, seedRows });
  const { fixture, execution } = connected;
  const options: Options = { execution, pricing: { module: pricing.workflow, nativeStorage: connected.pricing.source, logicalPublication: "mixed" }, revision,
    subscribers: [{ id: "native-price-list-update", revision }] };
  const modules = { pricing: options.pricing };
  const resources = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: pricing.workflow, methods: ["listPriceLists", "updatePriceLists"], graph: false } }, true));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareForward = async () => {
    const step = createStep("probe153-original-forward", resources.callback(async (input: Input, context) => {
      await retained.validate(input.price_lists_data, context);
      const result = await retained.invoke(input.price_lists_data, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine native update StepResponse");
      return { output: result.output ?? null, compensation: result.compensateInput ?? null };
    }));
    const flow = createWorkflow("probe153-original-forward-root", (input: WorkflowData<Input>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateForward", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateWorkflowInput, output: PriceListUpdateProbeOutput, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe153-original-inverse", resources.callback(async (input: typeof PriceListUpdateCompensation.Type, context) => {
      await retained.compensate(input, context); if (repeat) await retained.compensate(input, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-original-inverse-root", (input: WorkflowData<typeof PriceListUpdateCompensation.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateInverse", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateCompensation, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareModuleUpdate = async () => {
    const step = createStep("probe153-native-outside-update", resources.callback(async (input: typeof PriceListUpdatesInput.Type, context) =>
      context.resources.pricing.updatePriceLists(structuredClone(input))));
    const flow = createWorkflow("probe153-native-outside-update-root", (input: WorkflowData<typeof PriceListUpdatesInput.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListNativeOutsideUpdate", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdatesInput, output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } })));
  };
  const preparePhysicalDeletion = async () => {
    const creation = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    const installed = { pricing: { module: creation.workflow, nativeStorage: connected.pricing.source } };
    const selected = Result.getOrThrow(prepareWorkflowResources({ pricing: { module: creation.workflow, methods: ["deletePriceLists"], graph: false } }, true));
    const step = createStep("probe153-existing-physical-inverse", selected.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await retained.remove(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-existing-physical-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules: installed, workflow: { name: "probePriceListExistingPhysicalInverse", resources: selected,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}) => {
    const step = createStep("probe153-parent", resources.callback(async (_: unknown, context) => {
      await configuration.afterNative?.(); configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.listPriceLists({ id: [targetIds[0]!] }));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* The native caller catches an authentic refusal. */ } }
      if (configuration.lateFailure !== undefined) throw configuration.lateFailure;
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe153-parent-root", (input: WorkflowData<UpdatePriceListsWorkflowInput>) => {
      const updated = updatePriceListsWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(updated));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, modules, workflow: { name: "probePriceListUpdateParent", resources,
      prepared: Result.getOrThrow(flow.prepare()), input: PriceListUpdateWorkflowInput, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const readRows = (ids?: readonly string[]) => connected.readRows(ids);
  const read = async (ids?: readonly string[]) => (await readRows(ids)).map(item => item.row);
  const readStorageOrder = (ids: readonly string[]) => connected.readStorageOrder("price_list_rule", ids);
  return { fixture, options, pricing, ...comparison, prepareForward, prepareInverse, prepareModuleUpdate, preparePhysicalDeletion, prepareWrapped, read, readRows,
    readStorageOrder, prepare: async () => own(await Effect.runPromise(prepareUpdatePriceListsWorkflow(options))), snapshot: fixture.snapshot, closeCaseHosts };
}
