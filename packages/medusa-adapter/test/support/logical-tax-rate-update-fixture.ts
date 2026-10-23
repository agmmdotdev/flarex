import { Effect, Result, Schema } from "effect";
import type { ITaxModuleService, Logger } from "@medusajs/framework/types";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateTaxRatesWorkflow, type UpdateTaxRatesWorkflowInput } from "@medusajs/core-flows/tax/update-tax-rates";
import { makeTaxRateUpdateCommands } from "../../src/modules/tax/rate-update-service";
import { TaxRateUpdateWorkflowInput, TaxRateUpdateSelector, TaxRateUpdateData, TaxRateUpdateUpserts } from "../../src/modules/tax/rate-update-input";
import { TaxRulePhysicalDeletionIds } from "../../src/modules/tax/rule-create-input";
import { TaxRuleDeletionIds } from "../../src/modules/tax/rule-delete-input";
import { prepareTaxRateUpdateWorkflow } from "../../src/workflows/tax/update-rates";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { prepareLogicalTaxRuleCreation } from "./logical-tax-rule-create-fixture";
import { taxRegion, taxRate, taxRule, taxSeed, type TaxInitialRow } from "./logical-item-tax-lines-fixture";

export const taxUpdateRegions = ["txreg168-us", "txreg168-ca"] as const;
export const taxUpdateRateIds = ["txr168-d", "txr168-b", "txr168-c", "txr168-a"] as const;
export const taxUpdateOldIds = ["txrule168-old-8", "txrule168-old-3", "txrule168-old-6", "txrule168-old-1",
  "txrule168-old-7", "txrule168-old-2", "txrule168-old-5", "txrule168-old-4"];
export const taxUpdateStamp = "2020-01-02T03:04:05.000Z";
export type TaxUpdateInput = typeof TaxRateUpdateWorkflowInput.Type;
export const TaxUpdateRetained = Schema.Struct({ rates: TaxRateUpdateUpserts,
  created: TaxRulePhysicalDeletionIds, old: TaxRuleDeletionIds });
export type TaxUpdateCompensation = typeof TaxUpdateRetained.Type;
const RateOnlyInput = Schema.Struct({ selector: TaxRateUpdateSelector, update: TaxRateUpdateData });
const native = Result.getOrThrow(updateTaxRatesWorkflow.prepare());
function retained(name: string) {
  const node = native.nodes.find(value => value.name === name);
  if (node?.kind !== "step" || node.compensation !== "transactionCovered" || node.compensate === undefined)
    throw new Error("Missing genuine Tax update retained callback " + name);
  return { invoke: node.invoke, compensate: node.compensate };
}
const rates = retained("update-tax-rates"), created = retained("create-tax-rate-rules"), deleted = retained("delete-tax-rate-rules");

/** Native creation, request and ID orders deliberately differ. The US Rates
 * have one matching old product reference for genuine cold calculation. */
export function taxRateUpdateRows(): readonly TaxInitialRow[] {
  const parents = taxUpdateRateIds.map((id, index) => taxRate(id, { tax_region_id: index % 2 === 0 ? taxUpdateRegions[0] : taxUpdateRegions[1],
    name: `Rate ${id}`, code: `UPDATE168_${index}`, rate: 7 + index, is_default: false, is_combinable: index >= 2,
    created_by: `creator-${id}`, metadata: { owner: id, [`only_${id}`]: index, remove_me: `from-${id}`, nested: { own: id } },
    created_at: taxUpdateStamp, updated_at: taxUpdateStamp }));
  const orderedParents = [parents[2], parents[0], parents[3], parents[1]];
  if (orderedParents.some(row => row === undefined)) throw new Error("Missing maximum Tax update parent");
  const rules = taxUpdateOldIds.map((id, index) => {
    const parent = taxUpdateRateIds[index % 4];
    if (parent === undefined) throw new Error("Missing Tax update Rule owner");
    return taxRule(id, parent, index % 2 ? "product_type" : "product",
      index < 4 && index % 2 === 0 ? "prod163-one" : `old-reference-${index}`, {
        metadata: { ordinal: index, nested: { original: true } }, created_by: `old-creator-${index}`,
        created_at: taxUpdateStamp, updated_at: taxUpdateStamp,
      });
  });
  return taxSeed(orderedParents.filter((row): row is TaxInitialRow => row !== undefined),
    [taxRegion(taxUpdateRegions[0]), taxRegion(taxUpdateRegions[1], { country_code: "ca" })], rules);
}
export function maximumTaxRateUpdateInput(): TaxUpdateInput {
  return Schema.decodeUnknownSync(TaxRateUpdateWorkflowInput)({
    selector: { id: [taxUpdateRateIds[0], taxUpdateRateIds[3], taxUpdateRateIds[2], taxUpdateRateIds[1]] },
    update: { name: "Maximum native Rate update", updated_by: "actor168", rules: [
      { reference: "product", reference_id: "replacement-product", created_by: "ignored-template-first", metadata: { template: 0 } },
      { reference: "product_type", reference_id: "replacement-type", created_by: "ignored-template-second", metadata: { template: 1 } },
    ] },
  });
}

/** Reuse admitted initialization, canonical committed-row observation and the
 * separate genuine calculator. The update graph has one native Tax instance. */
export async function prepareLogicalTaxRateUpdate(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  rows: readonly TaxInitialRow[] = taxRateUpdateRows(), shared?: Parameters<typeof prepareLogicalTaxRuleCreation>[3]) {
  const base = await prepareLogicalTaxRuleCreation(driver, close, rows, shared);
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: message => message,
    progress() {}, error() {}, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const tax = await Effect.runPromise(makeTaxRateUpdateCommands(logger));
  const modules = { tax: { ...base.modules.tax, module: tax.workflow } }, revision = "d".repeat(64);
  const options: Parameters<typeof prepareTaxRateUpdateWorkflow>[0] = { execution: base.execution, modules, revision,
    subscribers: [{ id: "native-tax-rate-update-168", revision }] };
  const resources = Result.getOrThrow(prepareWorkflowResources({ tax: { module: tax.workflow,
    methods: ["listTaxRates", "updateTaxRates", "upsertTaxRates", "listTaxRateRules", "createTaxRateRules", "deleteTaxRateRules",
      "softDeleteTaxRateRules", "restoreTaxRateRules"], graph: false } }, true));
  const hosts: Array<() => Promise<void>> = [];
  const own = <H extends { readonly close: Effect.Effect<void> }>(host: H) => { hosts.push(() => Effect.runPromise(host.close)); return host; };
  const closeCaseHosts = async () => { for (const dispose of hosts.splice(0).reverse()) await dispose(); };
  close(closeCaseHosts);
  const prepare = async () => own(await Effect.runPromise(prepareTaxRateUpdateWorkflow(options)));
  const prepareForward = async (roundtrip = false) => {
    const step = createStep("probe168-real-rate-step", resources.callback(async (input: typeof RateOnlyInput.Type, context) => {
      const response = await rates.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing genuine Rate update StepResponse");
      const preimages = Result.getOrThrow(tax.contracts.decodePreimages(response.compensateInput));
      if (roundtrip) await rates.compensate(response.compensateInput, context);
      return { output: response.output, preimages };
    }));
    const flow = createWorkflow("probe168-real-rate-step-root", (input: WorkflowData<typeof RateOnlyInput.Type>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateUpdateStep", resources, prepared: Result.getOrThrow(flow.prepare()), input: RateOnlyInput,
        output: Schema.Struct({ output: tax.contracts.Output, preimages: TaxRateUpdateUpserts }), events: internalModuleWorkflowEvents } })));
  };
  const prepareInverse = async () => {
    const step = createStep("probe168-real-retained-inverses", resources.callback(async (input: TaxUpdateCompensation, context) => {
      await created.compensate(input.created, context);
      await deleted.compensate(input.old, context);
      await rates.compensate(input.rates, context);
      return new StepResponse(null);
    }));
    const flow = createWorkflow("probe168-real-retained-inverses-root", (input: WorkflowData<TaxUpdateCompensation>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateUpdateRetainedInverse", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxUpdateRetained,
        output: Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  const prepareFullRoundtrip = async (captured: () => TaxUpdateCompensation) => {
    const undo = createStep("probe168-actual-root-retained-roundtrip", resources.callback(async (output: unknown, context) => {
      const actual = captured();
      await created.compensate(actual.created, context);
      await deleted.compensate(actual.old, context);
      await rates.compensate(actual.rates, context);
      return Result.getOrThrow(tax.contracts.decodeRows(output));
    }));
    const flow = createWorkflow("probe168-actual-root-retained-roundtrip-root", (input: WorkflowData<UpdateTaxRatesWorkflowInput>) =>
      new WorkflowResponse(undo(updateTaxRatesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateUpdateFullRoundtrip", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateUpdateWorkflowInput,
        output: tax.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  const lateFailure = new Error("Late parent failure after genuine native Tax Rate update and Rule replacement");
  const prepareLateFailure = async () => {
    const fail = createStep("probe168-late-parent", resources.callback(async (_output: unknown) => { throw lateFailure; }));
    const flow = createWorkflow("probe168-late-parent-root", (input: WorkflowData<UpdateTaxRatesWorkflowInput>) =>
      new WorkflowResponse(fail(updateTaxRatesWorkflow.runAsStep({ input }))));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateUpdateLateParent", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateUpdateWorkflowInput,
        output: tax.contracts.Output, events: internalModuleWorkflowEvents } })));
  };
  let escaped: (() => Promise<unknown>) | undefined;
  const prepareCaughtFailure = async (catchFailure = true) => {
    const step = createStep("probe168-caught-receipt", resources.callback(async (input: TaxUpdateInput, context) => {
      const service = context.container.resolve<ITaxModuleService>("tax");
      escaped = () => service.listTaxRates(input.selector, { select: ["name"] });
      if (catchFailure) {
        try { await service.listTaxRates(input.selector, { select: ["name"] }); }
        catch { /* A caught receipt refusal must remain sticky at the owner. */ }
        return service.createTaxRateRules([]);
      }
      // The checked runtime field grammar is wider than the public DTO's
      // metadata declaration; retain the genuine method and bound receiver.
      await Reflect.apply(service.updateTaxRates, service, [input.selector, input.update]);
      return null;
    }));
    const flow = createWorkflow("probe168-caught-receipt-root", (input: WorkflowData<TaxUpdateInput>) => new WorkflowResponse(step(input)));
    return own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "probeTaxRateUpdateCaughtReceipt", resources, prepared: Result.getOrThrow(flow.prepare()), input: TaxRateUpdateWorkflowInput,
        output: catchFailure ? tax.rules.contracts.Output : Schema.Null, events: internalModuleWorkflowEvents } })));
  };
  return { ...base, tax, modules, options, resources, lateFailure, prepare, prepareForward, prepareInverse, prepareFullRoundtrip,
    prepareLateFailure, prepareCaughtFailure, closeCaseHosts, creationModule: base.modules.tax.module,
    callEscaped: () => { if (escaped === undefined) throw new Error("No captured native Tax method"); return escaped(); },
    prepareCreation: base.prepare, prepareCalculation: base.prepareCalculation };
}
