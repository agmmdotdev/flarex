import { Effect, Result, Schema } from "effect";
import type { ITaxModuleService, Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { setTaxRateRulesWorkflow, type SetTaxRatesRulesWorkflowInput } from "@medusajs/core-flows/tax/set-tax-rate-rules";
import { makeTaxRuleReplacementCommands } from "../../src/modules/tax/rule-replacement-service";
import { TaxRuleReplacementInput } from "../../src/modules/tax/rule-replacement-input";
import { TaxRulePhysicalDeletionIds } from "../../src/modules/tax/rule-create-input";
import { TaxRuleDeletionIds } from "../../src/modules/tax/rule-delete-input";
import { prepareTaxRuleReplacementWorkflow } from "../../src/workflows/tax/replace-rules";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalTaxRuleCreation } from "./logical-tax-rule-create-fixture";
import { taxRegion, taxRate, taxRule, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxReplacementRegion = "txreg167-us";
export const taxReplacementParents = ["txr167-0", "txr167-1", "txr167-2", "txr167-3"];
export const taxReplacementOldIds = ["txrule167-old-8", "txrule167-old-3", "txrule167-old-6", "txrule167-old-1",
  "txrule167-old-7", "txrule167-old-2", "txrule167-old-5", "txrule167-old-4"];
export const taxReplacementStamp = "2020-01-02T03:04:05.000Z";
export type TaxReplacementInput = typeof TaxRuleReplacementInput.Type;
const Inverse = Schema.Struct({ created: TaxRulePhysicalDeletionIds, old: TaxRuleDeletionIds });
const native = Result.getOrThrow(setTaxRateRulesWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(value => value.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Tax replacement inverse " + name);
  return { invoke: node.invoke, compensate: node.compensate };
}
const created = retained("create-tax-rate-rules"), deleted = retained("delete-tax-rate-rules");

export function taxRuleReplacementRows(): readonly TaxInitialRow[] {
  return taxSeed(taxReplacementParents.map((id, index) => taxRate(id, { tax_region_id: taxReplacementRegion,
    is_default: false, code: `REPLACE167_${index}`, rate: index + 5, created_by: "parent-creator" })), [taxRegion(taxReplacementRegion)],
  taxReplacementOldIds.map((id, index) => taxRule(id, taxReplacementParents[Math.floor(index / 2)] ?? "missing", "product", `old-${index}`, {
    metadata: { nested: { ordinal: index }, list: [null, index] }, created_by: `old-creator-${index}`,
    created_at: taxReplacementStamp, updated_at: taxReplacementStamp,
  })));
}
export function maximumTaxRuleReplacementInput(): TaxReplacementInput {
  return { tax_rate_ids: ["txr167-2", "txr167-0", "txr167-3", "txr167-1"], rules: [
    { reference: "product", reference_id: "replacement-first", metadata: { ordinal: 0 }, created_by: "template-first" },
    { reference: "product_type", reference_id: "replacement-second", metadata: { ordinal: 1 }, created_by: "template-second" },
  ] };
}

/** Seed and committed-row observation reuse the existing genuine Tax fixture.
 * This root registers one replacement participant over that same Tax schema. */
export async function prepareLogicalTaxRuleReplacement(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRuleReplacementRows(), shared?: Parameters<typeof prepareLogicalTaxRuleCreation>[3]) {
  const base = await prepareLogicalTaxRuleCreation(driver, close, rows, shared);
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRuleReplacementCommands(logger));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } }, revision = "c".repeat(64);
  const options: Parameters<typeof prepareTaxRuleReplacementWorkflow>[0] = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-tax-rule-replacement-167", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["listTaxRateRules", "createTaxRateRules", "deleteTaxRateRules", "softDeleteTaxRateRules", "restoreTaxRateRules"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRuleReplacementWorkflow(options)));
  const prepareInverse = async (repeat = false) => {
    const step = createStep("probe167-retained-inverse", resources.callback(async (input: typeof Inverse.Type, context) => {
      await created.compensate(input.created, context); await deleted.compensate(input.old, context);
      if (repeat) { await created.compensate(input.created, context); await deleted.compensate(input.old, context); }
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe167-retained-inverse-root", (input: WorkflowData<typeof Inverse.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleReplacementInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: Inverse,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Tax Rule replacement");
  const prepareLateFailure = async () => {
    const fail = createStep("probe167-late-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe167-late-parent-root", (input: WorkflowData<SetTaxRatesRulesWorkflowInput>) =>
      new WorkflowResponse(fail(setTaxRateRulesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleReplacementLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleReplacementInput,
        output: tax.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const prepareCaughtFailure = async () => {
    const step = createStep("probe167-caught-refusal", resources.callback(async (input: TaxReplacementInput, context) => {
      const service = context.container.resolve<ITaxModuleService>("tax");
      try { await service.listTaxRateRules({ tax_rate_id: input.tax_rate_ids }, { select: ["id"] }); } catch { /* Probe the existing sticky owner. */ }
      return service.createTaxRateRules([]);
    }));
    const flow = createWorkflow("probe167-caught-refusal-root", (input: WorkflowData<TaxReplacementInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRuleReplacementCaughtRefusal", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRuleReplacementInput,
        output: tax.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, tax, modules, options, resources, lateFailure, prepare, prepareInverse, prepareLateFailure, prepareCaughtFailure, closeCaseHosts,
    prepareCreation: base.prepare, prepareCalculation: base.prepareCalculation };
}
