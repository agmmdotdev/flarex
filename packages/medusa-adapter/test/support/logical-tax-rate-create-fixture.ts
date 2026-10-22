import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createTaxRatesWorkflow, type CreateTaxRatesWorkflowInput } from "@medusajs/core-flows/tax/create-tax-rates";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureTaxMetadata } from "../../src/modules/tax/schema";
import { makeTaxRateCreateCommands } from "../../src/modules/tax/rate-create-service";
import { TaxRateCreatesInput, TaxRatePhysicalDeletionIds, compileTaxRateCreationContracts } from "../../src/modules/tax/rate-create-input";
import { prepareTaxRateCreationWorkflow } from "../../src/workflows/tax/create-rates";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { prepareLogicalItemTaxLines, taxRegion, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxCreationCountry = "txreg164-us", taxCreationOtherCountry = "txreg164-ca";
const RetainedIds = TaxRatePhysicalDeletionIds;
const native = Result.getOrThrow(createTaxRatesWorkflow.prepare());
const node = native.nodes.find(value => value.name === "create-tax-rates");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Tax Rate creation callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
export type TaxRateCreationInput = typeof TaxRateCreatesInput.Type;

export function taxRateCreationRows(): readonly TaxInitialRow[] {
  return taxSeed([], [taxRegion(taxCreationCountry), taxRegion(taxCreationOtherCountry, { country_code: "ca" })]);
}
export function taxRateCreationInput(name = "native164", extra: JsonObject = {}): TaxRateCreationInput {
  return Schema.decodeUnknownSync(TaxRateCreatesInput)([{ name, code: name, tax_region_id: taxCreationCountry, ...extra }]);
}
export function maximumTaxRateCreationInput(): TaxRateCreationInput {
  return Schema.decodeUnknownSync(TaxRateCreatesInput)(Array.from({ length: 4 }, (_, index) => ({
    name: `max-${index}`, code: `max-${index}`, tax_region_id: index % 2 ? taxCreationOtherCountry : taxCreationCountry,
    rate: 0.1 + index, is_default: false, is_combinable: index % 2 === 1,
    metadata: { ordinal: index }, created_by: `creator-${index}`, rules: [
      { reference: "product", reference_id: `product-${index}` },
      { reference: "product_type", reference_id: `type-${index}` },
    ],
  })));
}

/** Reuse genuine Tax schema initialization and the separate calculation host.
 * The tested creation and inverse always invoke retained native callbacks. */
export async function prepareLogicalTaxRateCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRateCreationRows(), shared?: Parameters<typeof prepareLogicalItemTaxLines>[3]) {
  const base = await prepareLogicalItemTaxLines(driver, close, rows, shared);
  const lateFailure = new Error("Late parent failure after genuine native Tax Rate creation");
  const errors: Array<readonly [string | Error, Error | undefined]> = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: (message, error) => { errors.push([message, error]); }, failure() {}, success: () => ({}), silly() {}, debug() {},
    verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRateCreateCommands(logger));
  const contracts = Result.getOrThrow(compileTaxRateCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } };
  const revision = "a".repeat(64);
  const options: Parameters<typeof prepareTaxRateCreationWorkflow>[0] = { execution: base.execution, modules,
    revision, subscribers: [{ id: "native-tax-rate-creation-164", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["createTaxRates", "deleteTaxRates"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => {
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRateCreationWorkflow(options)));
  const prepareForward = async () => {
    const step = createStep("probe164-retained-forward", resources.callback(async (input: TaxRateCreationInput, context) => {
      const response = await retained.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Tax creation StepResponse");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe164-retained-forward-root", (input: WorkflowData<TaxRateCreationInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateCreationForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateCreatesInput,
        output: Schema.Struct({ output: contracts.Output, compensation: RetainedIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe164-retained-inverse", resources.callback(async (ids: typeof RetainedIds.Type, context) => {
      await retained.compensate(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe164-retained-inverse-root", (ids: WorkflowData<typeof RetainedIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateCreationInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: RetainedIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe164-late-parent", resources.callback(async (_output: unknown) => {
      throw lateFailure;
    }));
    const flow = createWorkflow("probe164-late-parent-root", (input: WorkflowData<CreateTaxRatesWorkflowInput>) => {
      const output = createTaxRatesWorkflow.runAsStep({ input });
      return new WorkflowResponse(fail(output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateCreationLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: TaxRateCreatesInput, output: contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  /** Observe committed rows through existing authenticated canonical evidence.
   * No fixture-side conversion, selector, constraint or lifecycle algorithm. */
  const read = async (selected?: readonly string[]) => {
    const snapshot = await base.snapshot(), output: JsonObject[] = [];
    const scopeUuid = projectScopeIdUuidV1(base.fixture.application.authority.scopeId).scopeUuid;
    for (const row of snapshot.rows) {
      if (row.scopeUuid !== scopeUuid) continue;
      const version = snapshot.revisions.find(value => value.scopeUuid === row.scopeUuid && value.tableId === row.tableId &&
        value.commitSeq === row.commitSeq && Buffer.from(value.rowId).equals(Buffer.from(row.rowId)));
      if (version === undefined || version.isTombstone) continue;
      const decoded = await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: version.valueBytes, sha256: version.valueSha256, profile: "appDocument" });
      const value = projectNativeRow(Schema.decodeUnknownSync(Schema.JsonObject)(decoded.valueJson));
      if (typeof value.id === "string" && (selected === undefined || selected.includes(value.id))) output.push(value);
    }
    return output.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  };
  return { ...base, tax, options, contracts, errors, lateFailure, prepare, prepareForward, prepareInverse, prepareLateFailure, closeCaseHosts, read,
    prepareCalculation: base.prepare };
}
