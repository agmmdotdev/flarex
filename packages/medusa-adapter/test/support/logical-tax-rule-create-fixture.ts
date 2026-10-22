import { Effect, Result, Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createTaxRateRulesWorkflow, type CreateTaxRateRulesWorkflowInput } from "@medusajs/core-flows/tax/create-tax-rate-rules";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureTaxMetadata } from "../../src/modules/tax/schema";
import { makeTaxRuleCreateCommands } from "../../src/modules/tax/rule-create-service";
import { TaxRuleCreatesInput, TaxRulePhysicalDeletionIds, compileTaxRuleCreationContracts } from "../../src/modules/tax/rule-create-input";
import { prepareTaxRuleCreationWorkflow } from "../../src/workflows/tax/create-rules";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { prepareLogicalItemTaxLines, taxRegion, taxRate, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxRuleRegion = "txreg165-us";
export const taxRuleParents = ["txr165-first", "txr165-second", "txr165-third", "txr165-fourth"];
const RetainedIds = TaxRulePhysicalDeletionIds;
const native = Result.getOrThrow(createTaxRateRulesWorkflow.prepare());
const node = native.nodes.find(value => value.name === "create-tax-rate-rules");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Tax Rule creation callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
export type TaxRuleCreationInput = typeof TaxRuleCreatesInput.Type;

export function taxRuleCreationRows(): readonly TaxInitialRow[] {
  return taxSeed(taxRuleParents.map((id, index) => taxRate(id, { tax_region_id: taxRuleRegion,
    is_default: index === 0, code: `RULE165_${index}`, name: `Rule parent ${index}`, rate: index + 5,
    created_by: "parent-creator" })), [taxRegion(taxRuleRegion)]);
}
export function taxRuleCreationInput(referenceId = "native165", extra: JsonObject = {}): TaxRuleCreationInput {
  return Schema.decodeUnknownSync(TaxRuleCreatesInput)([{ tax_rate_id: taxRuleParents[0], reference: "product", reference_id: referenceId, ...extra }]);
}
export function maximumTaxRuleCreationInput(): TaxRuleCreationInput {
  return Schema.decodeUnknownSync(TaxRuleCreatesInput)(Array.from({ length: 8 }, (_, index) => ({
    tax_rate_id: taxRuleParents[Math.floor(index / 2)], reference: index % 2 ? "product_type" : "product",
    reference_id: `reference-${index}`, metadata: { ordinal: index }, created_by: `creator-${index}`,
  })));
}

/** Reuse genuine Tax schema initialization and the separate calculation host.
 * The tested creation and inverse always invoke retained native callbacks. */
export async function prepareLogicalTaxRuleCreation(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRuleCreationRows(), shared?: Parameters<typeof prepareLogicalItemTaxLines>[3]) {
  const base = await prepareLogicalItemTaxLines(driver, close, rows, shared);
  const lateFailure = new Error("Late parent failure after genuine native Tax Rule creation");
  const errors: Array<readonly [string | Error, Error | undefined]> = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error: (message, error) => { errors.push([message, error]); }, failure() {}, success: () => ({}), silly() {}, debug() {},
    verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRuleCreateCommands(logger));
  const contracts = Result.getOrThrow(compileTaxRuleCreationContracts((await Effect.runPromise(captureTaxMetadata())).frame));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } };
  const revision = "a".repeat(64);
  const options: Parameters<typeof prepareTaxRuleCreationWorkflow>[0] = { execution: base.execution, modules,
    revision, subscribers: [{ id: "native-tax-rule-creation-165", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["createTaxRateRules", "deleteTaxRateRules"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => {
    hosts.push(() => Effect.runPromise(host.close)); return host;
  };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRuleCreationWorkflow(options)));
  const prepareForward = async () => {
    const step = createStep("probe165-retained-forward", resources.callback(async (input: TaxRuleCreationInput, context) => {
      const response = await retained.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Tax creation StepResponse");
      return { output: response.output, compensation: response.compensateInput };
    }));
    const flow = createWorkflow("probe165-retained-forward-root", (input: WorkflowData<TaxRuleCreationInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleCreationForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleCreatesInput,
        output: Schema.Struct({ output: contracts.Output, compensation: RetainedIds }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe165-retained-inverse", resources.callback(async (ids: typeof RetainedIds.Type, context) => {
      await retained.compensate(ids, context); return new StepResponse(null);
    }));
    const flow = createWorkflow("probe165-retained-inverse-root", (ids: WorkflowData<typeof RetainedIds.Type>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleCreationInverse", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: RetainedIds, output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe165-late-parent", resources.callback(async (_output: unknown) => {
      throw lateFailure;
    }));
    const flow = createWorkflow("probe165-late-parent-root", (input: WorkflowData<CreateTaxRateRulesWorkflowInput>) => {
      const output = createTaxRateRulesWorkflow.runAsStep({ input });
      return new WorkflowResponse(fail(output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleCreationLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ rules: TaxRuleCreatesInput }), output: contracts.Output, events: internalModuleWorkflowEvents } })));
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
