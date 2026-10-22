import { Effect, Result, Schema } from "effect";
import type { ITaxModuleService, Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteTaxRateRulesWorkflow, type DeleteTaxRateRulesWorkflowInput } from "@medusajs/core-flows/tax/delete-tax-rate-rules";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeTaxRuleDeleteCommands } from "../../src/modules/tax/rule-delete-service";
import { TaxRuleDeletionIds, TaxRuleDeletionOutput } from "../../src/modules/tax/rule-delete-input";
import { prepareTaxRuleDeletionWorkflow } from "../../src/workflows/tax/delete-rules";
import { makeTaxRuleCreateCommands } from "../../src/modules/tax/rule-create-service";
import { prepareTaxRuleCreationWorkflow } from "../../src/workflows/tax/create-rules";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { projectNativeRow } from "../../src/repository/result";
import { prepareLogicalItemTaxLines, taxRegion, taxRate, taxRule, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxRuleDeleteRegion = "txreg166-us";
export const taxRuleDeleteParents = ["txr166-first", "txr166-second", "txr166-third", "txr166-fourth"];
export const taxRuleDeleteIds = ["txrule166-8", "txrule166-3", "txrule166-6", "txrule166-1", "txrule166-7", "txrule166-2", "txrule166-5", "txrule166-4"];
export const taxRuleDeleteStamp = "2020-01-02T03:04:05.000Z";
const native = Result.getOrThrow(deleteTaxRateRulesWorkflow.prepare());
const node = native.nodes.find(value => value.name === "delete-tax-rate-rules");
if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
  throw new Error("Missing genuine retained native Tax Rule deletion callbacks");
const retained = { invoke: node.invoke, compensate: node.compensate };
export type TaxRuleDeletionInput = typeof TaxRuleDeletionIds.Type;

export function taxRuleDeletionRows(): readonly TaxInitialRow[] {
  return taxSeed(taxRuleDeleteParents.map((id, index) => taxRate(id, { tax_region_id: taxRuleDeleteRegion,
    is_default: false, code: `DELETE166_${index}`, rate: 7 + index, created_by: "parent-creator" })), [taxRegion(taxRuleDeleteRegion)],
  taxRuleDeleteIds.map((id, index) => {
    const parent = taxRuleDeleteParents[Math.floor(index / 2)];
    if (parent === undefined) throw new Error("Missing Tax Rule deletion fixture parent");
    return taxRule(id, parent, index % 2 ? "product_type" : "product", `reference-${id}`, {
      metadata: { nested: { ordinal: index }, list: [index, null] }, created_by: `creator-${index}`,
      created_at: taxRuleDeleteStamp, updated_at: taxRuleDeleteStamp,
    });
  }));
}

/** Reuses genuine Tax initialization. Mutation probes invoke genuine retained
 * callbacks or an explicitly admitted native service method. */
export async function prepareLogicalTaxRuleDeletion(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRuleDeletionRows(), shared?: Parameters<typeof prepareLogicalItemTaxLines>[3]) {
  const base = await prepareLogicalItemTaxLines(driver, close, rows, shared);
  const lateFailure = new Error("Late parent failure after genuine native Tax Rule deletion");
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRuleDeleteCommands(logger));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } }, revision = "b".repeat(64);
  const options: Parameters<typeof prepareTaxRuleDeletionWorkflow>[0] = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-tax-rule-deletion-166", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["softDeleteTaxRateRules", "restoreTaxRateRules"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRuleDeletionWorkflow(options)));
  const prepareCreation = async () => {
    const creation = await Effect.runPromise(makeTaxRuleCreateCommands(logger));
    return own(await Effect.runPromise(prepareTaxRuleCreationWorkflow({ ...options,
      modules: { tax: { ...modules.tax, module: creation.workflow } } })));
  };
  const prepareForward = async () => {
    const step = createStep("probe166-retained-forward", resources.callback(async (ids: TaxRuleDeletionInput, context) => {
      const response = await retained.invoke(ids, context);
      if (!(response instanceof StepResponse) || response.output !== undefined) throw new Error("Missing genuine void Tax deletion StepResponse");
      return response.compensateInput;
    }));
    const flow = createWorkflow("probe166-retained-forward-root", (ids: WorkflowData<TaxRuleDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleDeletionForward", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleDeletionIds,
        output: TaxRuleDeletionIds, events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe166-retained-inverse", resources.callback(async (ids: TaxRuleDeletionInput, context) => {
      await retained.compensate(ids, context);
      if (repeat) await retained.compensate(ids, context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe166-retained-inverse-root", (ids: WorkflowData<TaxRuleDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleDeletionInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleDeletionIds,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareRaw = async (restore: boolean) => {
    const step = createStep("probe166-raw-lifecycle", resources.callback(async (ids: TaxRuleDeletionInput, context) => {
      const service = context.container.resolve<ITaxModuleService>("tax");
      return restore ? service.restoreTaxRateRules(ids) : service.softDeleteTaxRateRules(ids);
    }));
    const flow = createWorkflow("probe166-raw-lifecycle-root", (ids: WorkflowData<TaxRuleDeletionInput>) => new WorkflowResponse(step(ids)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleDeletionRaw", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleDeletionIds,
        output: TaxRuleDeletionOutput, events: internalModuleWorkflowEvents } })));
  };
  const prepareLateFailure = async () => {
    const fail = createStep("probe166-late-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe166-late-parent-root", (input: WorkflowData<DeleteTaxRateRulesWorkflowInput>) => {
      const output = deleteTaxRateRulesWorkflow.runAsStep({ input }); return new WorkflowResponse(fail(output));
    });
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleDeletionLateParent", resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ ids: TaxRuleDeletionIds }), output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const read = async (selected?: readonly string[]) => {
    const snapshot = await base.snapshot(), output: JsonObject[] = [], scopeUuid = projectScopeIdUuidV1(base.fixture.application.authority.scopeId).scopeUuid;
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
  return { ...base, tax, options, lateFailure, prepare, prepareCreation, prepareForward, prepareInverse, prepareRaw, prepareLateFailure, closeCaseHosts, read,
    prepareCalculation: base.prepare };
}
