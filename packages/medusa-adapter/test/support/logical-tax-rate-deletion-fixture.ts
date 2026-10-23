import { Effect, Result, Schema } from "effect";
import type { ITaxModuleService, Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteTaxRatesWorkflow, type DeleteTaxRatesWorkflowInput } from "@medusajs/core-flows/tax/delete-tax-rates";
import { createTaxRatesWorkflow } from "@medusajs/core-flows/tax/create-tax-rates";
import { makeTaxRateDeleteCommands } from "../../src/modules/tax/rate-delete-service";
import { TaxRateDeletionIds, TaxRateDeletionOutput } from "../../src/modules/tax/rate-delete-input";
import { prepareTaxRateDeletionWorkflow } from "../../src/workflows/tax/delete-rates";
import { makeTaxRuleCreateCommands } from "../../src/modules/tax/rule-create-service";
import { prepareTaxRuleCreationWorkflow } from "../../src/workflows/tax/create-rules";
import { makeTaxRateCreateCommands } from "../../src/modules/tax/rate-create-service";
import { TaxRatePhysicalDeletionIds } from "../../src/modules/tax/rate-create-input";
import { prepareTaxRateCreationWorkflow } from "../../src/workflows/tax/create-rates";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalTaxRuleCreation } from "./logical-tax-rule-create-fixture";
import { taxRegion, taxRate, taxRule, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxRateDeleteRegions = ["txreg169-us", "txreg169-ca"] as const;
export const taxRateDeleteIds = ["txr169-c", "txr169-d", "txr169-a", "txr169-b"] as const;
export const taxRateDeleteRuleIds = ["txrule169-8", "txrule169-3", "txrule169-6", "txrule169-1", "txrule169-7", "txrule169-2", "txrule169-5", "txrule169-4"];
export const taxRateDeleteStamp = "2020-01-02T03:04:05.000Z";
const native = Result.getOrThrow(deleteTaxRatesWorkflow.prepare());
const node = native.nodes.find(value => value.name === "delete-tax-rates");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Tax Rate deletion callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
const creationNode = Result.getOrThrow(createTaxRatesWorkflow.prepare()).nodes.find(value => value.name === "create-tax-rates");
if (creationNode?.kind !== "step" || creationNode.compensate === undefined) throw new Error("Missing native physical Rate inverse");
const removeCreatedRates = creationNode.compensate;
export type TaxRateDeletionInput = typeof TaxRateDeletionIds.Type;

/** Creation, request, Rate ID and Rule ID orders deliberately differ. */
export function taxRateDeletionRows(): readonly TaxInitialRow[] {
  return taxSeed(taxRateDeleteIds.map((id, index) => taxRate(id, { tax_region_id: index % 2 ? taxRateDeleteRegions[1] : taxRateDeleteRegions[0],
    is_default: false, code: `DELETE169_${index}`, rate: 7 + index, created_by: `parent-creator-${index}`,
    metadata: { owner: id, nested: [index, null] }, created_at: taxRateDeleteStamp, updated_at: taxRateDeleteStamp })),
  [taxRegion(taxRateDeleteRegions[0]), taxRegion(taxRateDeleteRegions[1], { country_code: "ca" })],
  taxRateDeleteRuleIds.map((id, index) => {
    const parent = taxRateDeleteIds[Math.floor(index / 2)];
    if (parent === undefined) throw new Error("Missing Tax Rate deletion fixture parent");
    return taxRule(id, parent, index % 2 ? "product_type" : "product", `reference-${id}`, {
      metadata: { nested: { ordinal: index }, list: [index, null] }, created_by: `creator-${index}`,
      created_at: taxRateDeleteStamp, updated_at: taxRateDeleteStamp,
    });
  }));
}

/** Reuses genuine Tax initialization. Mutation probes invoke genuine retained
 * callbacks or an explicitly admitted native service method. */
export async function prepareLogicalTaxRateDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRateDeletionRows(), shared?: Parameters<typeof prepareLogicalTaxRuleCreation>[3]) {
  const base = await prepareLogicalTaxRuleCreation(driver, close, rows, shared);
  const lateFailure = new Error("Late parent failure after genuine native Tax Rate deletion");
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRateDeleteCommands(logger));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } }, revision = "b".repeat(64);
  const options: Parameters<typeof prepareTaxRateDeletionWorkflow>[0] = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-tax-rate-deletion-169", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["softDeleteTaxRates", "restoreTaxRates"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRateDeletionWorkflow(options)));
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareCaptured = async () => {
    const capture = createStep("probe169-capture-owned-native-method", resources.callback(async (input: DeleteTaxRatesWorkflowInput, context) => {
      const service = context.container.resolve<ITaxModuleService>("tax"), ids = [...input.ids];
      escaped = () => service.restoreTaxRates(ids);
      return input;
    }));
    const flow = createWorkflow("probe169-captured-native-root", (input: WorkflowData<DeleteTaxRatesWorkflowInput>) =>
      new WorkflowResponse(deleteTaxRatesWorkflow.runAsStep({ input: capture(input) })));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionCapturedRoot", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ ids: TaxRateDeletionIds }), output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareCreation = async () => {
    const creation = await Effect.runPromise(makeTaxRuleCreateCommands(logger));
    return own(await Effect.runPromise(prepareTaxRuleCreationWorkflow({ ...options,
      modules: { tax: { ...modules.tax, module: creation.workflow } } })));
  };
  const prepareRateCreation = async () => {
    const creation = await Effect.runPromise(makeTaxRateCreateCommands(logger));
    return own(await Effect.runPromise(prepareTaxRateCreationWorkflow({ ...options,
      modules: { tax: { ...modules.tax, module: creation.workflow } } })));
  };
  const preparePhysicalRates = async () => {
    const creation = await Effect.runPromise(makeTaxRateCreateCommands(logger));
    const physicalResources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: creation.workflow,
      methods: ["deleteTaxRates"], graph: false } }, true));
    const step = createStep("probe169-native-physical-rate-intervention", physicalResources.callback(async (ids: typeof TaxRatePhysicalDeletionIds.Type, context) => {
      await removeCreatedRates(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe169-native-physical-rate-intervention-root", (ids: WorkflowData<typeof TaxRatePhysicalDeletionIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options,
      modules: { tax: { ...modules.tax, module: creation.workflow } }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionPhysicalIntervention", resources: physicalResources, prepared: Result.getOrThrow(flow.prepare()),
        input: TaxRatePhysicalDeletionIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareForward = async () => {
    const step = createStep("probe169-retained-forward", resources.callback(async (ids: TaxRateDeletionInput, context) => {
      const response = await retained.invoke(ids, context);
      if (!(response instanceof StepResponse) || response.output !== undefined) throw new Error("Missing genuine void Tax deletion StepResponse");
      return response.compensateInput;
    }));
    const flow = createWorkflow("probe169-retained-forward-root", (ids: WorkflowData<TaxRateDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateDeletionIds,
        output: TaxRateDeletionIds, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe169-retained-inverse", resources.callback(async (ids: TaxRateDeletionInput, context) => {
      await retained.compensate(ids, context);
      if (repeat) await retained.compensate(ids, context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe169-retained-inverse-root", (ids: WorkflowData<TaxRateDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateDeletionIds,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareRaw = async (restore: boolean) => {
    const step = createStep("probe169-raw-lifecycle", resources.callback(async (ids: TaxRateDeletionInput, context) => {
      const service = context.container.resolve<ITaxModuleService>("tax");
      return restore ? service.restoreTaxRates(ids) : service.softDeleteTaxRates(ids);
    }));
    const flow = createWorkflow("probe169-raw-lifecycle-root", (ids: WorkflowData<TaxRateDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionRaw", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateDeletionIds,
        output: TaxRateDeletionOutput, events: internalModuleWorkflowEvents } })));
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe169-late-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe169-late-parent-root", (input: WorkflowData<DeleteTaxRatesWorkflowInput>) => {
      const output = deleteTaxRatesWorkflow.runAsStep({ input }); return new WorkflowResponse(fail(output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateDeletionLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ ids: TaxRateDeletionIds }), output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, tax, options, lateFailure, prepare, prepareCaptured, prepareCreation, prepareRateCreation, preparePhysicalRates, prepareForward, prepareInverse, prepareRaw, prepareLateFailure, closeCaseHosts, read: base.read, preparePhysicalRules: base.prepareInverse,
    callEscaped: () => { if (escaped === undefined) throw new Error("Missing captured native Tax Rate method"); return escaped(); },
    prepareCalculation: base.prepareCalculation };
}
