import { prepareCorePricingMaintenance } from "./core-pricing-maintenance-fixture";
import { priceListCreationComparisonRows } from "./pricing-list-comparison-rows";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, transform, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createPriceListsWorkflow, type CreatePriceListsWorkflowInput } from "@medusajs/core-flows/price-list/create-price-lists";
import { capturePricingMetadata } from "../../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { compilePriceListCreationContracts, PriceListDeletionIds, PriceListWorkflowInput } from "../../src/modules/pricing/list-input";
import { prepareCreatePriceListsWorkflow } from "../../src/workflows/pricing/create-price-lists";
import { prepareVariantPricingLink } from "../../src/links/variant-pricing-service";
import { captureVariantPricingLinkMetadata } from "../../src/composition/product-variant-pricing-schema";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";

const revision = "b".repeat(64);
const preparedNative = Result.getOrThrow(createPriceListsWorkflow.prepare());
const validation = preparedNative.nodes.find(node => node.name === "validate-variant-price-links");
const creation = preparedNative.nodes.find(node => node.name === "create-price-lists");
if (validation?.kind !== "step" || creation?.kind !== "step" || creation.compensation !== "transactionCovered" || !creation.compensate)
  throw new Error("Missing genuine native Price List creation callbacks");
const retained = { validate: validation.invoke, invoke: creation.invoke, compensate: creation.compensate };

type Options = Parameters<typeof prepareCreatePriceListsWorkflow>[0];
type Host = Effect.Success<ReturnType<typeof prepareCreatePriceListsWorkflow>>;
interface ParentOptions {
  readonly lateFailure?: Error; readonly caughtRefusal?: boolean;
  readonly inspect?: (resources: unknown) => void;
  readonly escape?: (work: () => Promise<unknown>) => void;
}
const selectResources = (modules: Options["modules"]) => prepareWorkflowResources({
  pricing: { module: modules.pricing.module, methods: ["createPriceLists", "deletePriceLists"], graph: false },
  link: { module: modules.link.module, methods: [], graph: true, expose: false },
}, true);

/** Existing canonical initialization owns comparison seeds. All exercised
 * mutations run native Pricing callbacks through the shared participant. */
export async function prepareCorePriceListCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void) {
  // Authentic Product/Pricing relationship metadata belongs to the standalone
  // Link; its flat query needs neither a Product source nor endpoint authority.
  const pricing = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
  const link = await Effect.runPromise(prepareVariantPricingLink());
  const { setIds, variantIds, protectedIds, seedRows, linkRows, historicalRootId, historicalIds, insertionRootIds } =
    priceListCreationComparisonRows((await Effect.runPromise(captureVariantPricingLinkMetadata())).frame.name);
  const connected = await prepareCorePricingMaintenance(driver, close, { pricing, link, seedRows, linkRows });
  const { fixture, execution } = connected;
  const options: Options = { execution, modules: {
    pricing: { module: pricing.workflow, nativeStorage: connected.pricing.source }, link: { module: link.workflow, nativeStorage: connected.link.source },
  }, revision, subscribers: [{ id: "native-price-list-create", revision }] };
  const resources = Result.getOrThrow(selectResources(options.modules));
  const contracts = Result.getOrThrow(compilePriceListCreationContracts((await Effect.runPromise(capturePricingMetadata())).frame));
  const caseHosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { caseHosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of caseHosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepareInverse = async () => {
    const step = createStep("probe152-genuine-inverse", resources.callback(async (ids: typeof PriceListDeletionIds.Type, context) => {
      await retained.compensate(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe152-genuine-inverse-root", (ids: WorkflowData<typeof PriceListDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateInverse",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareForward = async () => {
    const step = createStep("probe152-genuine-forward", resources.callback(async (input: typeof PriceListWorkflowInput.Type, context) => {
      const map = await retained.validate(input.price_lists_data, context);
      if (!(map instanceof StepResponse)) throw new Error("Missing genuine validation StepResponse");
      const result = await retained.invoke({ data: input.price_lists_data, variant_price_map: map.output }, context);
      if (!(result instanceof StepResponse)) throw new Error("Missing genuine creation StepResponse");
      return { output: result.output, compensation: result.compensateInput ?? [] };
    }));
    const flow = createWorkflow("probe152-genuine-forward-root", (input: WorkflowData<CreatePriceListsWorkflowInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateForward",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListWorkflowInput,
      output: Schema.Struct({ output: contracts.Output, compensation: PriceListDeletionIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareWrapped = async (configuration: ParentOptions = {}): Promise<Host> => {
    const step = createStep("probe152-parent", resources.callback(async (created: unknown, context) => {
      configuration.inspect?.(context.resources);
      configuration.escape?.(() => context.resources.pricing.createPriceLists([]));
      if (configuration.caughtRefusal) { try { context.container.resolve("region"); } catch { /* Caller catches an authentic refusal. */ } }
      if (configuration.lateFailure !== undefined) throw configuration.lateFailure;
      return created;
    }));
    const flow = createWorkflow("probe152-parent-root", (input: WorkflowData<CreatePriceListsWorkflowInput>) => {
      const created = createPriceListsWorkflow.runAsStep({ input });
      return new WorkflowResponse(step(transform({ created }, value => value.created)));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, workflow: { name: "probePriceListCreateParent",
      resources, prepared: Result.getOrThrow(flow.prepare()), input: PriceListWorkflowInput,
      output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const read = (selected?: readonly string[]) => connected.read(selected);
  const readStorageOrder = (ids: readonly string[], table = "price_list") => connected.readStorageOrder(table, ids);
  return { fixture, options, pricing, link, variantIds, setIds, historicalRootId, historicalIds, insertionRootIds, readStorageOrder,
    protectedIds: [...protectedIds, ...linkRows.map(item => Schema.decodeUnknownSync(Schema.String)(item.row.id))],
    prepare: async () => own(await Effect.runPromise(prepareCreatePriceListsWorkflow(options))), prepareForward, prepareInverse,
    prepareWrapped, read, snapshot: fixture.snapshot, closeCaseHosts };
}
