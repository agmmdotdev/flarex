import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createTaxRegionsWorkflow, type CreateTaxRegionsWorkflowInput } from "@medusajs/core-flows/tax/create-tax-regions";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureTaxMetadata } from "../../src/modules/tax/schema";
import { makeTaxRegionCreateCommands } from "../../src/modules/tax/region-create-service";
import { compileTaxRegionCreationContracts } from "../../src/modules/tax/region-create-input";
import { prepareTaxRegionCreationWorkflow } from "../../src/workflows/tax/create-regions";
import { makeTaxRuleCreateCommands } from "../../src/modules/tax/rule-create-service";
import { prepareTaxRuleCreationWorkflow } from "../../src/workflows/tax/create-rules";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalTaxRateCreation } from "./logical-tax-rate-create-fixture";
import { taxRegion, taxRate, taxRule, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

const native = Result.getOrThrow(createTaxRegionsWorkflow.prepare());
const node = native.nodes.find(value => value.name === "create-tax-regions");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Tax Region creation callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
export type TaxRegionCreationInput = JsonObject[];
export const taxRegionCreationParent = "txreg170-existing-parent";
export const taxRegionCreationUnrelated = "txreg170-unrelated";
export function taxRegionCreationRows(): readonly TaxInitialRow[] {
  return taxSeed([taxRate("txr170-unrelated", { tax_region_id: taxRegionCreationUnrelated, is_default: false })],
    [taxRegion(taxRegionCreationParent), taxRegion(taxRegionCreationUnrelated, { country_code: "unrelated" })],
    [taxRule("txrule170-unrelated", "txr170-unrelated", "product", "prod170-unrelated")]);
}
export function taxRegionCreationInput(extra: JsonObject = {}): TaxRegionCreationInput {
  return [{ country_code: "NEW170", ...extra }];
}
export function maximumTaxRegionCreationInput(): TaxRegionCreationInput {
  return Array.from({ length: 4 }, (_, index) => ({ id: `txreg170-max-${index}`, country_code: `MAX170-${index}`,
    metadata: { ordinal: index }, created_by: `creator-${index}`, default_tax_rate: {
      id: `txr170-max-${index}`, tax_region_id: "native-overwrites", name: `Rate ${index}`, code: `MAX170-${index}`,
      rate: index + 0.1, is_default: false, is_combinable: index % 2 === 1, created_by: "native-overwrites",
      metadata: { nested: { ordinal: index } }, rules: [
        { id: `txrule170-max-${index}-0`, tax_rate_id: "native-overwrites", reference: "product", reference_id: `prod170-${index}`, created_by: "native-overwrites" },
        { id: `txrule170-max-${index}-1`, reference: "product_type", reference_id: `ptyp170-${index}` },
      ],
    } }));
}

/** Reuse the existing four-model initialization, complete inventory, canonical
 * cold reads and independent Tax Lines host. Every creation/inverse probe below
 * invokes the genuine Region root or its retained native step callbacks. */
export async function prepareLogicalTaxRegionCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRegionCreationRows(), shared?: Parameters<typeof prepareLogicalTaxRateCreation>[3]) {
  const base = await prepareLogicalTaxRateCreation(driver, close, rows, shared);
  const lateFailure = new Error("Late parent failure after genuine native Tax Region creation");
  const errors: Array<readonly [string | Error, Error | undefined]> = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: (message, error) => { errors.push([message, error]); }, failure() {}, success: () => ({}), silly() {}, debug() {},
    verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRegionCreateCommands(logger));
  const contracts = Result.getOrThrow(compileTaxRegionCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } }, revision = "e".repeat(64);
  const options: Parameters<typeof prepareTaxRegionCreationWorkflow>[0] = { execution: base.execution, modules,
    revision, subscribers: [{ id: "native-tax-region-creation-170", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["createTaxRegions", "deleteTaxRegions"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRegionCreationWorkflow(options)));
  const prepareForward = async () => {
    const step = createStep("probe170-retained-forward", resources.callback(async (input: TaxRegionCreationInput, context) => {
      const response = await retained.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Tax Region StepResponse");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe170-retained-forward-root", (input: WorkflowData<TaxRegionCreationInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRegionCreationForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: contracts.Input,
        output: Schema.Struct({ output: contracts.Output, compensation: contracts.PhysicalIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe170-retained-inverse", resources.callback(async (ids: typeof contracts.PhysicalIds.Type, context) => {
      await retained.compensate(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe170-retained-inverse-root", (ids: WorkflowData<typeof contracts.PhysicalIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRegionCreationInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: contracts.PhysicalIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe170-late-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe170-late-parent-root", (input: WorkflowData<CreateTaxRegionsWorkflowInput>) => {
      const output = createTaxRegionsWorkflow.runAsStep({ input }); return new WorkflowResponse(fail(output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRegionCreationLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: contracts.Input, output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const prepareAdditionalRules = async () => {
    const rules = await Effect.runPromise(makeTaxRuleCreateCommands(logger));
    return own(await Effect.runPromise(prepareTaxRuleCreationWorkflow({ ...options,
      modules: { tax: { ...base.modules.tax, module: rules.workflow } } })));
  };
  return { ...base, tax, options, contracts, errors, lateFailure, prepare, prepareForward, prepareInverse, prepareLateFailure, closeCaseHosts,
    prepareAdditionalRates: base.prepare, prepareAdditionalRules };
}