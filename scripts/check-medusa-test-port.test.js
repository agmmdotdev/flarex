// @ts-check
import { describe, expect, it } from "vitest";
import { verifyTestPort, verifyShippingProfileCreateTests, verifyPricingCreateTests, verifyPricingWorkflowSelection, verifyInventoryCreateTests, verifyInventoryUpdateTests, verifyInventoryLevelUpdateTests, verifyCsvNormalizerTests,
  verifyNativeFilterValue, verifyNativeJoinerFieldAlias, verifyNativeNullToOneInitialization } from "./check-medusa-test-port.mjs";
import { readFileSync } from "node:fs";
import { verifyPriceListPriceUpdateSelection, verifyPriceListPriceUpdatePolicySelection, verifyPriceListDeleteSelection, verifyPriceListDeleteCallbacks, verifyPriceListCreateCallbacks, verifyPriceListUpdateCallbacks, verifyNativePriceListRuleBuilder } from "./check-medusa-test-port.mjs";
import { verifyTaxRuleDeleteCallbacks, verifyTaxRuleCreateCallbacks, verifyTaxRateCreateCallbacks } from "./check-medusa-test-port.mjs";

describe("complete native Tax Rate Rule deletion source", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/delete-tax-rate-rules.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/delete-tax-rate-rules.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/tax/workflows/delete-tax-rate-rules.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/tax/steps/delete-tax-rate-rules.ts", "utf8");
  it("admits only genuine lifecycle callbacks and exact relocated imports", () => {
    expect(() => verifyTaxRuleDeleteCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
  });
  it.each([
    ["empty resolution", "if (!ids?.length)", "if (false)"],
    ["empty retained IDs", "new StepResponse(void 0, [])", "new StepResponse(void 0, ids)"],
    ["physical forward", "service.softDeleteTaxRateRules(ids)", "service.deleteTaxRateRules(ids)"],
    ["partial forward", "service.softDeleteTaxRateRules(ids)", "service.softDeleteTaxRateRules(ids.slice(0, 1))"],
    ["unawaited forward", "await service.softDeleteTaxRateRules(ids)", "service.softDeleteTaxRateRules(ids)"],
    ["deduplicated retained request", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [...new Set(ids)])"],
    ["partial retained request", "new StepResponse(void 0, ids)", "new StepResponse(void 0, ids.slice(0, 1))"],
    ["nonvoid native result", "new StepResponse(void 0, ids)", "new StepResponse(null, ids)"],
    ["different module", "Modules.TAX", "Modules.CART"],
    ["empty inverse guard", "if (!prevIds?.length)", "if (false)"],
    ["different inverse", "service.restoreTaxRateRules(prevIds)", "service.deleteTaxRateRules(prevIds)"],
    ["partial inverse", "service.restoreTaxRateRules(prevIds)", "service.restoreTaxRateRules(prevIds.slice(0, 1))"],
    ["unawaited inverse", "await service.restoreTaxRateRules(prevIds)", "service.restoreTaxRateRules(prevIds)"],
    ["public step input", "DeleteTaxRateRulesStepInput = string[]", "DeleteTaxRateRulesStepInput = string"],
    ["erased import flag", "import type {", "import {"],
    ["missing covered metadata", '  { name: deleteTaxRateRulesStepId, compensation: "transactionCovered" },', "  deleteTaxRateRulesStepId,"],
    ["different covered metadata", 'compensation: "transactionCovered"', 'compensation: "other"'],
    ["extra host option", 'compensation: "transactionCovered"', 'compensation: "transactionCovered", retries: 1'],
    ["extra execution", "    await service.softDeleteTaxRateRules(ids)", "    void ids\n    await service.softDeleteTaxRateRules(ids)"],
  ])("refuses step drift: %s", (_name, before, after) => {
    const changed = step.replace(before, after);
    expect(changed).not.toBe(step);
    expect(() => verifyTaxRuleDeleteCallbacks(nativeWorkflow, workflow, nativeStep, changed)).toThrow("Changed native Tax Rate Rule deletion source");
  });
  it.each([
    ["different identity", '"delete-tax-rate-rules"', '"other-tax-rule-delete"'],
    ["barrel fallback", 'from "../steps/delete-tax-rate-rules"', 'from "../steps"'],
    ["partial root input", "deleteTaxRateRulesStep(input.ids)", "deleteTaxRateRulesStep(input.ids.slice(0, 1))"],
    ["wrong root property", "deleteTaxRateRulesStep(input.ids)", "deleteTaxRateRulesStep(input.otherIds)"],
    ["missing response wrapper", "new WorkflowResponse(deleteTaxRateRulesStep(input.ids))", "deleteTaxRateRulesStep(input.ids)"],
    ["public input shape", "ids: string[]", "ids: string"],
    ["public void output", "WorkflowResponse<WorkflowData<void>>", "WorkflowResponse<WorkflowData<null>>"],
    ["definition output", "  WorkflowData<void>,", "  WorkflowData<unknown>,"],
    ["definition input", "  DeleteTaxRateRulesWorkflowInput,", "  unknown,"],
    ["definition import flag", "  type WorkflowDefinition,", "  WorkflowDefinition,"],
    ["erased input type", "WorkflowData<DeleteTaxRateRulesWorkflowInput>", "WorkflowData<unknown>"],
    ["runtime import flag", "import {", "import type {"],
  ])("refuses workflow drift: %s", (_name, before, after) => {
    const changed = workflow.replace(before, after);
    expect(changed).not.toBe(workflow);
    expect(() => verifyTaxRuleDeleteCallbacks(nativeWorkflow, changed, nativeStep, step)).toThrow("Changed native Tax Rate Rule deletion source");
  });
  it("refuses missing or duplicate native relocation anchors", () => {
    const changed = nativeStep.replace('from "@medusajs/framework/types"', 'from "other/types"');
    expect(() => verifyTaxRuleDeleteCallbacks(nativeWorkflow, workflow, changed, step)).toThrow("relocation anchor");
    const duplicate = nativeWorkflow + '\nimport { Extra } from "@medusajs/framework/workflows-sdk"\n';
    expect(() => verifyTaxRuleDeleteCallbacks(duplicate, workflow, nativeStep, step)).toThrow("relocation anchor");
  });
});

describe("complete native Tax Rate Rule creation source", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/create-tax-rate-rules.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/create-tax-rate-rules.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/tax/workflows/create-tax-rate-rules.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/tax/steps/create-tax-rate-rules.ts", "utf8");
  it("admits only the genuine complete callbacks and exact relocated imports", () => {
    expect(() => verifyTaxRuleCreateCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
  });
  it.each([
    ["skip empty forward", "const created = await service.createTaxRateRules(data)", "const created = data.length ? await service.createTaxRateRules(data) : []"],
    ["truncate forward input", "service.createTaxRateRules(data)", "service.createTaxRateRules(data.slice(0, 1))"],
    ["different module", "Modules.TAX", "Modules.CART"],
    ["truncate complete output", "      created,", "      created.slice(0, 1),"],
    ["reverse retained IDs", "created.map((rule) => rule.id)", "created.map((rule) => rule.id).reverse()"],
    ["different retained key", "created.map((rule) => rule.id)", "created.map((rule) => rule.name)"],
    ["drop empty inverse guard", "if (!createdIds?.length)", "if (false)"],
    ["soft inverse", "service.deleteTaxRateRules(createdIds)", "service.softDeleteTaxRateRules(createdIds)"],
    ["partial inverse", "service.deleteTaxRateRules(createdIds)", "service.deleteTaxRateRules(createdIds.slice(0, 1))"],
    ["unawaited inverse", "await service.deleteTaxRateRules(createdIds)", "service.deleteTaxRateRules(createdIds)"],
    ["different inverse binding", "async (createdIds, { container })", "async (otherIds, { container })"],
    ["widened forward type", "data: CreateTaxRateRuleDTO[]", "data: CreateTaxRateRuleDTO[] | undefined"],
    ["erased type import drift", "import {", "import type {"],
    ["missing covered metadata", '  { name: createTaxRateRulesStepId, compensation: "transactionCovered" },', "  createTaxRateRulesStepId,"],
    ["different covered metadata", 'compensation: "transactionCovered"', 'compensation: "other"'],
    ["extra host option", 'compensation: "transactionCovered"', 'compensation: "transactionCovered", retries: 1'],
    ["extra execution", "    return new StepResponse(", "    void created\n    return new StepResponse("],
  ])("refuses step drift: %s", (_name, before, after) => {
    const changed = step.replace(before, after);
    expect(changed).not.toBe(step);
    expect(() => verifyTaxRuleCreateCallbacks(nativeWorkflow, workflow, nativeStep, changed)).toThrow("Changed native Tax Rate Rule creation source");
  });
  it.each([
    ["different workflow identity", '"create-tax-rate-rules"', '"other-tax-rate-rules"'],
    ["barrel fallback", 'from "../steps/create-tax-rate-rules"', 'from "../steps"'],
    ["partial root input", "createTaxRateRulesStep(input.rules)", "createTaxRateRulesStep(input.rules.slice(0, 1))"],
    ["missing response wrapper", "new WorkflowResponse(createTaxRateRulesStep(input.rules))", "createTaxRateRulesStep(input.rules)"],
    ["public input shape", "rules: CreateTaxRateRuleDTO[]", "rules: CreateTaxRateRuleDTO"],
    ["public output shape", "CreateTaxRateRulesWorkflowOutput = TaxRateRuleDTO[]", "CreateTaxRateRulesWorkflowOutput = unknown[]"],
    ["erased response type", "WorkflowResponse<CreateTaxRateRulesWorkflowOutput>", "WorkflowResponse<unknown>"],
    ["erased type import drift", "import type {", "import {"],
  ])("refuses workflow drift: %s", (_name, before, after) => {
    const changed = workflow.replace(before, after);
    expect(changed).not.toBe(workflow);
    expect(() => verifyTaxRuleCreateCallbacks(nativeWorkflow, changed, nativeStep, step)).toThrow("Changed native Tax Rate Rule creation source");
  });
  it("refuses changed or duplicated native relocation anchors", () => {
    const changed = nativeStep.replace('from "@medusajs/framework/types"', 'from "another/types"');
    expect(() => verifyTaxRuleCreateCallbacks(nativeWorkflow, workflow, changed, step)).toThrow("relocation anchor");
    const duplicated = nativeWorkflow + '\nimport type { Extra } from "@medusajs/framework/types"\n';
    expect(() => verifyTaxRuleCreateCallbacks(duplicated, workflow, nativeStep, step)).toThrow("relocation anchor");
  });
});
describe("complete native Tax Rate creation source", () => {
  const nativeWorkflow = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/workflows/create-tax-rates.ts", "utf8");
  const nativeStep = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/tax/steps/create-tax-rates.ts", "utf8");
  const workflow = readFileSync("packages/medusa-core-flows/src/tax/workflows/create-tax-rates.ts", "utf8");
  const step = readFileSync("packages/medusa-core-flows/src/tax/steps/create-tax-rates.ts", "utf8");
  it("admits only the genuine complete callbacks and exact relocated imports", () => {
    expect(() => verifyTaxRateCreateCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
  });
  it.each([
    ["skip empty forward", "const created = await service.createTaxRates(data)", "const created = data.length ? await service.createTaxRates(data) : []"],
    ["truncate forward input", "service.createTaxRates(data)", "service.createTaxRates(data.slice(0, 1))"],
    ["different module", "Modules.TAX", "Modules.CART"],
    ["truncate complete output", "      created,", "      created.slice(0, 1),"],
    ["reverse retained IDs", "created.map((rate) => rate.id)", "created.map((rate) => rate.id).reverse()"],
    ["different retained key", "created.map((rate) => rate.id)", "created.map((rate) => rate.name)"],
    ["drop empty inverse guard", "if (!createdIds?.length)", "if (false)"],
    ["soft inverse", "service.deleteTaxRates(createdIds)", "service.softDeleteTaxRates(createdIds)"],
    ["partial inverse", "service.deleteTaxRates(createdIds)", "service.deleteTaxRates(createdIds.slice(0, 1))"],
    ["unawaited inverse", "await service.deleteTaxRates(createdIds)", "service.deleteTaxRates(createdIds)"],
    ["different inverse binding", "async (createdIds, { container })", "async (otherIds, { container })"],
    ["widened forward type", "data: CreateTaxRateDTO[]", "data: CreateTaxRateDTO[] | undefined"],
    ["erased type import drift", "import type {", "import {"],
    ["missing covered metadata", '  { name: createTaxRatesStepId, compensation: "transactionCovered" },', "  createTaxRatesStepId,"],
    ["different covered metadata", 'compensation: "transactionCovered"', 'compensation: "other"'],
    ["extra host option", 'compensation: "transactionCovered"', 'compensation: "transactionCovered", retries: 1'],
    ["extra execution", "    return new StepResponse(", "    void created\n    return new StepResponse("],
  ])("refuses step drift: %s", (_name, before, after) => {
    const changed = step.replace(before, after);
    expect(changed).not.toBe(step);
    expect(() => verifyTaxRateCreateCallbacks(nativeWorkflow, workflow, nativeStep, changed)).toThrow("Changed native Tax Rate creation source");
  });
  it.each([
    ["different workflow identity", '"create-tax-rates"', '"other-tax-rates"'],
    ["barrel fallback", 'from "../steps/create-tax-rates"', 'from "../steps"'],
    ["partial root input", "createTaxRatesStep(input)", "createTaxRatesStep(input.slice(0, 1))"],
    ["missing response wrapper", "new WorkflowResponse(createTaxRatesStep(input))", "createTaxRatesStep(input)"],
    ["public input shape", "CreateTaxRatesWorkflowInput = CreateTaxRateDTO[]", "CreateTaxRatesWorkflowInput = CreateTaxRateDTO"],
    ["public output shape", "CreateTaxRatesWorkflowOutput = TaxRateDTO[]", "CreateTaxRatesWorkflowOutput = unknown[]"],
    ["erased response type", "WorkflowResponse<CreateTaxRatesWorkflowOutput>", "WorkflowResponse<unknown>"],
    ["erased type import drift", "import type {", "import {"],
  ])("refuses workflow drift: %s", (_name, before, after) => {
    const changed = workflow.replace(before, after);
    expect(changed).not.toBe(workflow);
    expect(() => verifyTaxRateCreateCallbacks(nativeWorkflow, changed, nativeStep, step)).toThrow("Changed native Tax Rate creation source");
  });
  it("refuses changed or duplicated native relocation anchors", () => {
    const changed = nativeStep.replace('from "@medusajs/framework/types"', 'from "another/types"');
    expect(() => verifyTaxRateCreateCallbacks(nativeWorkflow, workflow, changed, step)).toThrow("relocation anchor");
    const duplicated = nativeWorkflow + '\nimport type { Extra } from "@medusajs/framework/types"\n';
    expect(() => verifyTaxRateCreateCallbacks(duplicated, workflow, nativeStep, step)).toThrow("relocation anchor");
  });
});

describe("PriceList Price update replay and timestamp receipt selection", () => {
  const source = readFileSync("packages/medusa-adapter/src/modules/pricing/price-list-price-update-receipt.ts", "utf8").replaceAll("\r\n", "\n");
  it("binds the complete update dispatch to both managed-row capabilities", () => {
    expect(() => verifyPriceListPriceUpdatePolicySelection(source)).not.toThrow();
  });
  it.each([
    ["advancing timestamps", 'allowPreservingDeletionUpsert: "preserveTimestamps" as const', 'allowPreservingDeletionUpsert: true as const'],
    ["caller timestamp mode", 'allowPreservingDeletionUpsert: "preserveTimestamps" as const', 'allowPreservingDeletionUpsert: contracts.timestampMode'],
    ["omitted timestamp mode", ',\n    allowPreservingDeletionUpsert: "preserveTimestamps" as const', ''],
    ["disabled recorded history", 'allowRecordedRowReplay: true as const', 'allowRecordedRowReplay: false as const'],
    ["omitted recorded history", ', allowRecordedRowReplay: true as const', ''],
    ["unbound replay validator", 'capture, validateLogicalCall, allowStorageInsertionOrder:', 'capture, validateLogicalCall: undefined, allowStorageInsertionOrder:'],
    ["creation validator fallback", 'return yield* validateRestore(contracts, call, activity)', 'return yield* validatePriceListPriceWriteReceipt(contracts, call, activity, contracts)'],
    ["snapshot route displaced", 'call.commandName === "pricingListPriceSnapshot"', 'call.commandName === "pricingAddPriceListPrices"'],
    ["unknown command acceptance", 'return yield* Effect.fail(commerceError("receiptMismatch"));\n  }, Effect.mapError', 'return;\n  }, Effect.mapError'],
    ["caller policy spread", 'return { capture, validateLogicalCall,', 'return { ...contracts.policy, capture, validateLogicalCall,'],
    ["unexported policy", 'export function pricingListPriceUpdatePolicy', 'function pricingListPriceUpdatePolicy'],
  ])("rejects %s", (_label, before, after) => {
    const changed = source.replace(before, after);
    expect(changed).not.toBe(source);
    expect(() => verifyPriceListPriceUpdatePolicySelection(changed)).toThrow("Changed PriceList Price update receipt policy selection");
  });
  it("rejects an early capability return and duplicate policy declarations", () => {
    const changed = source.replace('export function pricingListPriceUpdatePolicy(contracts: PriceListPriceUpdateContracts) {',
      'export function pricingListPriceUpdatePolicy(contracts: PriceListPriceUpdateContracts) {\n  if (contracts.fast) return { allowRecordedRowReplay: true };');
    expect(changed).not.toBe(source);
    expect(() => verifyPriceListPriceUpdatePolicySelection(changed)).toThrow("Changed PriceList Price update receipt policy selection");
    expect(() => verifyPriceListPriceUpdatePolicySelection(source + '\nexport function pricingListPriceUpdatePolicy() {}'))
      .toThrow("Changed PriceList Price update receipt policy selection");
  });
});

describe("PriceList deletion named resource selection", () => {
  const facade = readFileSync("packages/medusa-adapter/src/workflows/pricing/delete-price-lists.ts", "utf8").replaceAll("\r\n", "\n");
  const policy = readFileSync("packages/medusa-adapter/src/workflow/policy.ts", "utf8").replaceAll("\r\n", "\n");
  it("binds the approved calls-only allowance after exact module authentication", () => {
    expect(() => verifyPriceListDeleteSelection(facade, policy)).not.toThrow();
  });
  it("compares typed and runtime structure independently of source line layout", () => {
    const changed = facade.replace('requestCallLimit: priceListDeletionResources.calls, workflow:',
      'requestCallLimit: priceListDeletionResources.calls,\n      workflow:');
    const changedPolicy = policy.replace('export const priceListDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });',
      'export const priceListDeletionResources = Object.freeze({\n  ...defaultCommerceResources,\n  calls: 128\n});');
    expect(changed).not.toBe(facade); expect(changedPolicy).not.toBe(policy);
    expect(() => verifyPriceListDeleteSelection(changed, changedPolicy)).not.toThrow();
  });
  it.each([
    ['readonly revision: string;', 'readonly revision: unknown;'],
    ['readonly subscribers: AtomicCommerceEvents["subscribers"];', 'readonly subscribers?: AtomicCommerceEvents["subscribers"];'],
    ['readonly link: Links;', 'readonly link: Links; readonly requestCallLimit?: number;'],
  ])("retains the complete public type contract: %s", (before, after) => {
    const changed = facade.replace(before, after); expect(changed).not.toBe(facade);
    expect(() => verifyPriceListDeleteSelection(changed, policy)).toThrow("Changed PriceList deletion resource selection");
  });
  it("keeps existing runtime-only Pricing comparisons unchanged", () => {
    const native = readFileSync("third_party/medusa/upstream/packages/core/types/src/pricing/service.ts", "utf8");
    const selected = readFileSync("packages/medusa-adapter/src/modules/pricing/service.ts", "utf8");
    const repository = readFileSync("packages/medusa-adapter/src/modules/pricing/repository.ts", "utf8");
    const typesOnly = selected.replace('(ctx: CommerceCommandContext, owner: CommercePromiseOwner)', '(ctx: unknown, owner: unknown)');
    expect(typesOnly).not.toBe(selected);
    expect(() => verifyPricingWorkflowSelection(native, typesOnly, repository)).not.toThrow();
    const changed = typesOnly.replace('new PricingModuleService(container, { scope: "internal" })', 'new OtherPricingModuleService(container, { scope: "internal" })');
    expect(changed).not.toBe(typesOnly);
    expect(() => verifyPricingWorkflowSelection(native, changed, repository)).toThrow("Unadmitted native Pricing workflow selection");
  });
  it.each([
    ["caller call limit", '["execution", "pricing", "link", "revision", "subscribers"]', '["execution", "pricing", "link", "revision", "subscribers", "requestCallLimit"]'],
    ["caller policy", '["execution", "pricing", "link", "revision", "subscribers"]', '["execution", "pricing", "link", "revision", "subscribers", "logicalResources"]'],
    ["profile identity", 'definition.source.profile !== "pricing-price-list-deletions"', 'definition.source.profile !== "pricing-price-list-updates"'],
    ["native module identity", 'definition?.source.name !== "flarex-pricing-local"', 'false'],
    ["unequal installed allowance", 'installed.pricing.logicalResources !== undefined && !jsonEqual(installed.pricing.logicalResources, priceListDeletionResources)', 'false'],
    ["participant default", 'logicalResources: priceListDeletionResources', 'logicalResources: undefined'],
    ["caller participant allowance", 'logicalResources: priceListDeletionResources', 'logicalResources: installed.pricing.logicalResources'],
    ["caller call allowance", 'requestCallLimit: priceListDeletionResources.calls', 'requestCallLimit: options.requestCallLimit'],
    ["different calls", 'requestCallLimit: priceListDeletionResources.calls', 'requestCallLimit: 256'],
    ["caller spread", 'execution: options.execution, revision: options.revision', '...options, execution: options.execution, revision: options.revision'],
    ["graph overgrant", 'graph: false', 'graph: true'],
    ["method overgrant", 'methods: ["softDeletePriceLists", "restorePriceLists"]', 'methods: ["softDeletePriceLists", "restorePriceLists", "deletePriceLists"]'],
    ["other policy owner", 'from "../../workflow/policy"', 'from "../../workflow/other-policy"'],
  ])("rejects %s", (_label, before, after) => {
    const changed = facade.replace(before, after); expect(changed).not.toBe(facade);
    expect(() => verifyPriceListDeleteSelection(changed, policy)).toThrow("Changed PriceList deletion resource selection");
  });
  it.each([
    ["calls", 'calls: 128', 'calls: 256'],
    ["event limit", '...defaultCommerceResources, calls: 128', '...defaultCommerceResources, calls: 128, eventMessages: 128'],
    ["query limit", '...defaultCommerceResources, calls: 128', '...defaultCommerceResources, calls: 128, queryRows: 512'],
    ["default resource owner", '...defaultCommerceResources, calls: 128', '...otherResources, calls: 128'],
    ["unfrozen resource", 'Object.freeze({ ...defaultCommerceResources, calls: 128 })', '({ ...defaultCommerceResources, calls: 128 })'],
  ])("rejects named policy %s mutation", (_label, before, after) => {
    const named = 'export const priceListDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });';
    expect(policy).toContain(named);
    const changed = policy.replace(named, named.replace(before, after)); expect(changed).not.toBe(policy);
    expect(() => verifyPriceListDeleteSelection(facade, changed)).toThrow("Changed PriceList deletion resource selection");
  });
  it("requires the unchanged core defaults and immutable exported selection", () => {
    for (const changed of [policy.replace('export const priceListDeletionResources', 'export let priceListDeletionResources'),
      policy.replace('from "@flarex/persistence-postgres/internal/commerce-values"', 'from "./other-values"')]) {
      expect(changed).not.toBe(policy);
      expect(() => verifyPriceListDeleteSelection(facade, changed)).toThrow("Changed PriceList deletion resource selection");
    }
    const changed = facade.replace('export const prepareDeletePriceListsWorkflow', 'export let prepareDeletePriceListsWorkflow');
    expect(changed).not.toBe(facade);
    expect(() => verifyPriceListDeleteSelection(changed, policy)).toThrow("Changed PriceList deletion resource selection");
  });
});

describe("native PriceList deletion callback provenance", () => {
  const paths = ["price-list/workflows/delete-price-lists.ts", "price-list/steps/delete-price-lists.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  /** @param {string[]} values */
  const verify = values => verifyPriceListDeleteCallbacks(originals[0], values[0], originals[1], values[1]);
  it("admits the complete native root and raw-ID retained callbacks", () => {
    expect(() => verify(targets)).not.toThrow();
  });
  it.each([
    [0, "input.ids", "[]"],
    [0, "WorkflowData<DeletePriceListsWorkflowInput>) =>", "WorkflowData<DeletePriceListsWorkflowInput>): WorkflowData<void> =>"],
    [0, "return deletedPriceLists", "return undefined"],
    [0, "price_list_id: input.ids", "price_list_id: []"],
    [0, 'from "../steps/delete-price-lists"', 'from "../steps"'],
    [1, 'compensation: "transactionCovered"', 'compensation: "noCompensation"'],
    [1, "softDeletePriceLists(ids)", "deletePriceLists(ids)"],
    [1, "softDeletePriceLists(ids)", "softDeletePriceLists([...new Set(ids)])"],
    [1, "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    [1, "if (!idsToRestore?.length)", "if (true)"],
    [1, "restorePriceLists(idsToRestore)", "restorePriceLists([])"],
  ])("rejects native callback mutation %s: %s", (index, before, after) => {
    const values = targets.slice(), selected = Number(index);
    values[selected] = values[selected].replace(String(before), String(after));
    expect(values[selected]).not.toBe(targets[selected]);
    expect(() => verify(values)).toThrow("Changed native PriceList deletion callback behavior");
  });
  it("rejects an added empty forward guard and extra runtime statements", () => {
    const values = targets.slice();
    values[1] = values[1].replace("await pricingModule.softDeletePriceLists(ids)", "if (!ids.length) return\n    await pricingModule.softDeletePriceLists(ids)");
    expect(values[1]).not.toBe(targets[1]);
    expect(() => verify(values)).toThrow();
    for (const index of [0, 1]) {
      const extra = targets.slice(); extra[index] += "\nglobalThis.changedDeletion = true;\n";
      expect(() => verify(extra)).toThrow();
    }
  });
});

describe("native PriceList update callback provenance", () => {
  const paths = ["price-list/workflows/update-price-lists.ts", "price-list/steps/update-price-lists.ts",
    "price-list/steps/validate-price-lists.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  /** @param {string[]} values */
  const verify = values => verifyPriceListUpdateCallbacks(originals[0], values[0], originals[1], values[1], originals[2], values[2]);
  it("admits complete native programs with only the declared portable and erased seams", () => {
    expect(() => verify(targets)).not.toThrow();
  });
  it.each([
    [0, "input.price_lists_data", "[]"],
    [0, "UpdatePriceListWorkflowInputDTO[]", "unknown[]"],
    [0, "): void => {", "): unknown => {"],
    [1, "compensation: \"transactionCovered\"", "compensation: undefined"],
    [1, "if (!data.length)", "if (true)"],
    [1, "pricingModule.updatePriceLists(data)", "pricingModule.updatePriceLists([])"],
    [1, "dataBeforeUpdate,\n      selects,", "dataBeforeUpdate: [],\n      selects,"],
    [1, "if (!revertInput)", "if (true)"],
    [1, "price_list_rules: priceListRules = []", "price_list_rules: priceListRules"],
    [1, "rules: buildPriceListRules(priceListRules)!", "rules: {}"],
    [1, "buildPriceListRules(priceListRules)!", "buildPriceListRules(priceListRules) ?? {}"],
    [1, "objectFields: [\"rules\"]", "objectFields: []"],
    [1, "selectsClone.splice(index, 1)", "selectsClone.splice(index, 0)"],
    [1, '"price_list_rules.value", "price_list_rules.attribute"', '"price_list_rules.value"'],
    [1, 'relationsClone.push("price_list_rules")', 'relationsClone.push("prices")'],
    [1, "{ id: data.map((d) => d.id) }", "{ id: data.map((d) => d.id).sort() }"],
    [1, "{ relations: relationsClone, select: selectsClone }", "{}"],
    [2, "if (!data.length)", "if (true)"],
    [2, "data.map((d) => d.id)", "data.map((d) => d.id).reverse()"],
    [2, "listPriceLists({ id: priceListIds })", "listPriceLists({ id: [] })"],
    [2, "diff.join(\", \")", "diff.reverse().join(\", \")"],
    [2, "priceListMap[priceList.id] = priceList", "priceListMap[priceList.id] = {}"],
    [2, "return new StepResponse(priceListMap)", "return new StepResponse({})"],
  ])("refuses complete native program mutation %s: %s", (index, before, after) => {
    const selected = Number(index), values = targets.slice();
    values[selected] = values[selected].replace(String(before), String(after));
    expect(values[selected]).not.toBe(targets[selected]);
    expect(() => verify(values)).toThrow("Changed native PriceList update callback behavior");
  });
  it("rejects additional effects and changed resource imports", () => {
    for (const index of [0, 1, 2]) {
      const values = targets.slice(); values[index] += "\nglobalThis.changedNativeListUpdate = true;";
      expect(() => verify(values)).toThrow();
    }
    const values = targets.slice();
    values[1] = values[1].replace('@medusajs/framework/utils/portable', 'untrusted-native-utils');
    expect(() => verify(values)).toThrow();
  });
});

describe("native PriceList rule builder provenance", () => {
  const source = readFileSync("third_party/medusa/upstream/packages/core/utils/src/pricing/builders.ts", "utf8");
  const target = readFileSync("packages/medusa-utils/src/pricing/price-list-rules.ts", "utf8");
  it("admits the complete original helper with its exact type dependency", () => {
    expect(() => verifyNativePriceListRuleBuilder(source, target)).not.toThrow();
  });
  it.each([
    ['priceListRules?.reduce', 'priceListRules.reduce'],
    ['curr.value || []', 'curr.value ?? []'],
    ['acc[ruleAttribute] = ruleValues', 'acc[ruleAttribute] ??= ruleValues'],
    ['return acc', 'return {}'],
    ['PriceListRuleDTO[]', 'unknown[]'],
  ])("rejects changed native helper contract %s", (before, after) => {
    const changed = target.replace(before, after); expect(changed).not.toBe(target);
    expect(() => verifyNativePriceListRuleBuilder(source, changed)).toThrow("Changed native PriceList rule builder extraction");
  });
  it("rejects unrelated exports and side effects", () => {
    expect(() => verifyNativePriceListRuleBuilder(source, target + "\nglobalThis.changedNativeBuilder = true;")).toThrow();
    expect(() => verifyNativePriceListRuleBuilder(source, target + "\nexport function otherBuilder() {}\n")).toThrow();
  });
});

describe("native PriceList creation callback provenance", () => {
  const paths = ["price-list/workflows/create-price-lists.ts", "price-list/steps/create-price-lists.ts",
    "price-list/steps/validate-variant-price-links.ts"];
  const originals = paths.map(file => readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/" + file, "utf8"));
  const targets = paths.map(file => readFileSync("packages/medusa-core-flows/src/" + file, "utf8"));
  /** @param {string[]} values */
  const verify = values => verifyPriceListCreateCallbacks(originals[0], values[0], originals[1], values[1], originals[2], values[2]);
  it("admits all original callbacks and public type declarations", () => {
    expect(() => verify(targets)).not.toThrow();
  });
  it.each([
    [0, "input.price_lists_data", "[]"],
    [0, "CreatePriceListWorkflowInputDTO[]", "unknown[]"],
    [0, "WorkflowResponse<PriceListDTO[]>", "WorkflowResponse<unknown[]>"],
    [0, "variant_price_map: variantPriceMap", "variant_price_map: {}"],
    [1, "compensation: \"transactionCovered\"", "compensation: undefined"],
    [1, "if (!data.length)", "if (false)"],
    [1, "prices = []", "prices = undefined"],
    [1, "amount: price.amount", "amount: 0"],
    [1, "min_quantity: price.min_quantity", "min_quantity: null"],
    [1, "price_set_id: variantPriceMap![price.variant_id]!", "price_set_id: price.variant_id"],
    [1, "variantPriceMap![price.variant_id]!", "variantPriceMap?.[price.variant_id] ?? ''"],
    [1, "rules: price.rules", "rules: {}"],
    [1, "createdPriceLists.map((createdPriceLists) => createdPriceLists.id)", "[]"],
    [1, "if (!createdPriceListIds?.length)", "if (true)"],
    [1, "deletePriceLists(createdPriceListIds)", "deletePriceLists([])"],
    [2, "if (!data.length)", "if (true)"],
    [2, "pl?.prices?.map", "pl.prices.map"],
    [2, "variables: { variant_id: variantIds }", "variables: { id: variantIds }"],
    [2, "fields: [\"variant_id\", \"price_set_id\"]", "fields: [\"variant_id\"]"],
    [2, "variantPriceSetMap[link.variant_id] = link.price_set_id", "variantPriceSetMap[link.variant_id] = link.variant_id"],
    [2, "withoutLinks.join(\", \")", "withoutLinks.reverse().join(\", \")"],
    [2, "return new StepResponse(variantPriceSetMap)", "return new StepResponse({})"],
  ])("refuses native program mutation %s: %s", (index, before, after) => {
    const values = targets.slice();
    values[Number(index)] = values[Number(index)].replace(String(before), String(after));
    expect(values[Number(index)]).not.toBe(targets[Number(index)]);
    expect(() => verify(values)).toThrow("Changed native PriceList creation callback behavior");
  });
  it("refuses additional source effects and changed imports", () => {
    for (const index of [0, 1, 2]) {
      const values = targets.slice();
      values[index] += "\nglobalThis.changedNativePriceLists = true;";
      expect(() => verify(values)).toThrow();
    }
    const values = targets.slice();
    values[2] = values[2].replace('@medusajs/framework/utils/portable', 'untrusted-native-utils');
    expect(() => verify(values)).toThrow();
  });
});

const source = `import { runner } from "./runner";
describe("suite", () => {
  beforeEach(async () => { await runner.create({ title: "fixture" }); });
  it("case", async () => { const rows = await runner.list(); expect(rows[0].id).toEqual("id"); });
});`;

describe("native pure Query helper extraction proofs", () => {
  it("authenticates the whole native scalar-filter function and refuses changed runtime behavior", () => {
    const native = readFileSync(new URL("../third_party/medusa/upstream/packages/database/drizzle/src/repository.ts", import.meta.url), "utf8");
    const target = readFileSync(new URL("../packages/medusa-drizzle/src/filter-value.ts", import.meta.url), "utf8");
    expect(() => verifyNativeFilterValue(native, target)).not.toThrow();
    const mutations = [
      target.replace('return ""', 'return null'),
      target.replace('field.endsWith("_date")', 'field.endsWith("_time")'),
      target.replace('return new Date(value)', 'return value'),
      target.replace('value === undefined', 'value == undefined'),
      target.replace('export function', 'function'),
      target + '\nglobalThis.changedNativeQuery = true;',
      'import "changed-native-filter";\n' + target,
      target + '\nexport function coerceFilterValue() { return ""; }',
    ];
    for (const mutated of mutations) {
      expect(mutated).not.toBe(target);
      expect(() => verifyNativeFilterValue(native, mutated)).toThrow("Changed native scalar filter-value extraction");
    }
    expect(() => verifyNativeFilterValue(native + '\nfunction coerceFilterValue() {}', target)).toThrow();
  });

  it("authenticates native alias merge, singleton selection and entity-specific failure order", () => {
    const native = readFileSync(new URL("../third_party/medusa/upstream/packages/core/orchestration/src/joiner/remote-joiner.ts", import.meta.url), "utf8");
    const target = readFileSync(new URL("../packages/medusa-orchestration/src/joiner-field-alias.ts", import.meta.url), "utf8");
    expect(() => verifyNativeJoinerFieldAlias(native, target)).not.toThrow();
    const mutations = [
      target.replace('a.entity == currentPathEntity', 'a.entity === currentPathEntity'),
      target.replace('f.entity === extend.entity', 'f.entity !== extend.entity'),
      target.replace('alias = alias.find', 'alias = alias.filter'),
      target.replace('let alias: JoinerFieldAlias | JoinerFieldAlias[] | undefined = value',
        'let alias: JoinerFieldAlias | JoinerFieldAlias[] | undefined = Array.isArray(value) ? value : [value]'),
      target.replace('return alias', 'return value'),
      target.replace('Cannot resolve alias path', 'Cannot resolve different path'),
      target.replace('common/is-string', 'common/is-object'),
      target.replace('isString }', 'isString as nativeIsString }'),
      target + '\nglobalThis.changedNativeAlias = true;',
    ];
    for (const mutated of mutations) {
      expect(mutated).not.toBe(target);
      expect(() => verifyNativeJoinerFieldAlias(native, mutated)).toThrow("Changed native Joiner field-alias extraction");
    }
    // Change the selected block itself: earlier native methods also contain path lookups.
    const selectedBlock = native.replace('const currentPathEntity = parsedExpands.get(', 'const wrongPathEntity = parsedExpands.get(');
    expect(selectedBlock).not.toBe(native);
    expect(() => verifyNativeJoinerFieldAlias(selectedBlock, target)).toThrow();
  });

  it("authenticates the complete native null-to-one body after descriptor type erasure", () => {
    const native = readFileSync(new URL("../third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts", import.meta.url), "utf8");
    const target = readFileSync(new URL("../packages/medusa-drizzle/src/relation-query.ts", import.meta.url), "utf8");
    expect(() => verifyNativeNullToOneInitialization(native, target)).not.toThrow();
    const mutations = [
      target.replace('row[foreignKey] === null', 'row[foreignKey] == null'),
      target.replace('descriptor.ownerForeignKeys.every(', 'descriptor.ownerForeignKeys.some('),
      target.replace('!descriptor.relationship.nullable', 'descriptor.relationship.nullable'),
      target.replace('row[relationName] = null', 'row[relationName] = undefined'),
      target.replace('descriptor.relationship.type !== "hasOneWithFK"', 'descriptor.relationship.type !== "hasOne"'),
      target + '\nexport function fillNullToOneRelations() {}',
    ];
    for (const mutated of mutations) {
      expect(mutated).not.toBe(target);
      expect(() => verifyNativeNullToOneInitialization(native, mutated)).toThrow("Changed native nullable to-one initialization extraction");
    }
  });
});

describe("maintained Medusa test ports", () => {
  it("preserves the complete native CSV suite, snapshots and exact fixtures", () => {
    const nativeRoot = "../third_party/medusa/upstream/packages/core/utils/src/product/__tests__/";
    const targetRoot = "../packages/medusa-utils/src/product/__tests__/";
    const original = readFileSync(new URL(nativeRoot + "csv-normalizer.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL(targetRoot + "csv-normalizer.spec.ts", import.meta.url), "utf8");
    const names = ["multiple-products-multiple-variants.json", "same-product-multiple-rows.json",
      "same-product-multiple-variant-options.json", "single-row-create.json"];
    const sourceFixtures = Object.fromEntries(names.map(name => [name,
      readFileSync(new URL(nativeRoot + "__fixtures__/" + name, import.meta.url), "utf8")]));
    const targetFixtures = Object.fromEntries(names.map(name => [name,
      readFileSync(new URL(targetRoot + "__fixtures__/" + name, import.meta.url), "utf8")]));
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures, targetFixtures)).not.toThrow();
    const mutations = [
      selected.replace("should process a CSV row", "renamed native case"),
      selected.replace('it("should process a CSV row"', 'it.skip("should process a CSV row"'),
      selected.replace('"title": "Medusa Sweatshirt"', '"title": "Changed snapshot"'),
      selected.replace('readFile(join(__dirname, "__fixtures__", fileName)', 'readFile(join(__dirname, "other", fileName)'),
      selected.replace('from "../csv-normalizer"', 'from "../fake-normalizer"'),
      selected.replace('describe, expect, it', 'describe, expect, it, vi'),
      selected.replace('describe, expect, it', 'describe, expect as check, it'),
      selected.replace('const csvData: any[]', 'const csvData: unknown[]'),
      selected + '\nit("extra", () => {});',
    ];
    for (const changed of mutations) {
      expect(changed).not.toBe(selected);
      expect(() => verifyCsvNormalizerTests(original, changed, sourceFixtures, targetFixtures)).toThrow();
    }
    for (const name of names) {
      expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures,
        { ...targetFixtures, [name]: targetFixtures[name] + " " })).toThrow("Changed native CSV fixtures");
    }
    const missing = { ...targetFixtures }; delete missing[names[0]];
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures, missing)).toThrow("Changed native CSV fixtures");
    expect(() => verifyCsvNormalizerTests(original, selected, sourceFixtures,
      { ...targetFixtures, "extra.json": "{}" })).toThrow("Changed native CSV fixtures");
  });
  it("preserves both selected native Inventory item creation bodies", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryCreateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('...data[1]', '...data[0]'), selected.replace('await service.createInventoryItems(data)', 'service.createInventoryItems(data)'),
      selected.replace('it("should create an inventory item"', 'it.skip("should create an inventory item"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryCreateTests(original, changed)).toThrow();
  });
  it("preserves both native Inventory item update bodies and their seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-update-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryUpdateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('origin_country: "test-country"', 'origin_country: "changed"'),
      selected.replace('await service.updateInventoryItems(update)', 'service.updateInventoryItems(update)'),
      selected.replace('it("should update the inventory item"', 'it.skip("should update the inventory item"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryUpdateTests(original, changed)).toThrow();
  });
  it("preserves both native absolute Inventory Level update bodies and their seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/inventory-level-update-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyInventoryLevelUpdateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('stocked_quantity: 2', 'stocked_quantity: 3'),
      selected.replace('incoming_quantity: 4', 'incoming_quantity: 5'),
      selected.replace('it("should update inventory level"', 'it.skip("should update inventory level"'),
      selected + 'it("unselected", () => {});']) expect(() => verifyInventoryLevelUpdateTests(original, changed)).toThrow();
  });
  describe("finite native Pricing workflow selection", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/core/types/src/pricing/service.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/src/modules/pricing/service.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const repository = readFileSync(new URL("../packages/medusa-adapter/src/modules/pricing/repository.ts", import.meta.url), "utf8");
    const methods = 'methods: { ...(variantItemPricing ? { calculatePrices } : {}), ...(listPriceRemovals ? { listPrices: listPricesForRemoval, softDeletePrices: softDeletePricesForRemoval, restorePrices: restorePricesForRemoval } : {}), ...(listPriceUpdates ? { listPriceLists: listPriceListsForPriceUpdate, snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } : {}), ...(listPriceCreations ? { listPriceLists: listPriceListsForPriceCreation, addPriceListPrices, removePrices } : {}), ...(listDeletions ? { softDeletePriceLists, restorePriceLists } : {}), ...(listUpdates ? { listPriceLists: listPriceListsForUpdate, updatePriceLists } : {}), ...(listCreations ? { createPriceLists, deletePriceLists } : {}), ...(shippingUpdates ? { updatePriceSets: updateShippingPriceSets, listPrices: listShippingPrices,\n        listPriceRules: listShippingPriceRules, createPriceRules: createShippingPriceRules } : {}),\n        ...(preferences && !preferenceUpdates && !preferenceDeletions ? { createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences } : {}),\n        ...(preferenceUpdates ? { listPricePreferences: listUpdatePricePreferences, updatePricePreferences, upsertPricePreferences: upsertUpdatePricePreferences } : {}),\n        ...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {}),\n        ...(!variantItemPricing && !preferences && !shippingUpdates && !listCreations && !listUpdates && !listDeletions && !listPrices ? { createPriceSets, ...(!shipping ? { createPriceLists, createPricePreferences } : {}), ...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {}), ...(lifecycle || shipping ? { softDeletePriceSets } : {}), ...(shipping ? { restorePriceSets, deletePriceSets } : {}) } : {}) }';
    it("preserves the complete native selection and exact public method anchor", () => {
      expect(() => verifyPricingWorkflowSelection(original, selected, repository)).not.toThrow();
      expect(selected).toContain(methods);
    });
    it.each(["softDeletePricePreferences", "restorePricePreferences", "deletePriceLists", "softDeletePriceLists", "restorePriceLists", "listPriceLists", "updatePriceLists", "addPriceListPrices", "removePrices", "updatePriceListPrices", "listPrices", "softDeletePrices", "restorePrices", "calculatePrices"])("rejects missing native method %s", method => {
      const changed = original.replace(new RegExp("\\b" + method + "(?=\\s*[<(])", "g"), method + "Unadmitted");
      expect(changed).not.toBe(original);
      expect(() => verifyPricingWorkflowSelection(changed, selected, repository)).toThrow("Missing native Pricing admitted methods");
    });
    it.each(['methods: {}', 'methods: { createPriceSets, createPriceLists, createPricePreferences, calculatePrices }',
      'methods: { createPriceLists, createPricePreferences }', 'methods: { createPriceSets, createPricePreferences }',
      'methods: { createPriceSets, createPriceLists }'])("rejects public method replacement %s", replacement => {
      expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods, replacement), repository)).toThrow();
    });
    it.each([
      ["selector", 'const variantItemPricing = admission === "variant-item-pricing"', 'const variantItemPricing = true'],
      ["selector spelling", 'const variantItemPricing = admission === "variant-item-pricing"', 'const variantItemPricing = admission === "variant-updates"'],
      ["profile", 'variantItemPricing ? "pricing-variant-item-pricing"', 'variantItemPricing ? "pricing-base-prices"'],
      ["command overgrant", 'variantItemPricing ? [count, calculate]', 'variantItemPricing ? [count, calculate, create]'],
      ["command omission", 'variantItemPricing ? [count, calculate]', 'variantItemPricing ? [calculate]'],
      ["method overgrant", 'variantItemPricing ? { calculatePrices }', 'variantItemPricing ? { calculatePrices, createPriceSets }'],
      ["method fallback", 'variantItemPricing ? { calculatePrices } : {}', 'variantItemPricing ? { calculatePrices } : { calculatePrices }'],
      ["method selector", 'variantItemPricing ? { calculatePrices }', 'mutable ? { calculatePrices }'],
      ["creation fallback", '!variantItemPricing && !preferences && !shippingUpdates', '!preferences && !shippingUpdates'],
      ["PriceSet creation refusal", 'createPriceSets: variantItemPricing || preferences', 'createPriceSets: preferences'],
      ["PriceList creation refusal", 'createPriceLists: variantItemPricing || preferences', 'createPriceLists: preferences'],
      ["preference creation refusal", 'createPricePreferences: variantItemPricing || shipping', 'createPricePreferences: shipping'],
      ["native calculation visibility", 'calculatePrices: preferences || shipping', 'calculatePrices: variantItemPricing || preferences || shipping'],
      ["native calculation owner", 'native.calculatePrices.bind(native)', 'native.listPriceSets.bind(native)'],
      ["calculation dispatch", 'commands.read("pricingCalculateVariantItems"', 'commands.write("pricingCalculateVariantItems"'],
      ["calculation decoder", 'prepare(decodeVariantItemPricingCalculation)', 'prepare(decodePricingCalculation)'],
      ["calculation context", '[{ id: [...args.filters.id] }, args.pricingContext, context]', '[{ id: [...args.filters.id] }, {}, context]'],
      ["calculation receiver", 'Reflect.apply(service.calculatePrices, service,', 'Reflect.apply(service.calculatePrices, {},'],
      ["method command", 'defineWorkflowMethod({ command: calculate,', 'defineWorkflowMethod({ command: count,'],
      ["method output", 'commerceDecoder(VariantItemPricingCalculationOutput, "storedCorruption")', 'commerceDecoder(Schema.Unknown, "storedCorruption")'],
      ["graph relation overgrant", 'paths: variantItemPricing ? [] : prepared.paths', 'paths: prepared.paths'],
      ["calculation import", 'from "./calculation"', 'from "./other-calculation"'],
    ])("rejects variant item pricing service %s mutation", (_name, before, after) => {
      const changed = selected.replace(before, after);
      expect(changed).not.toBe(selected);
      expect(() => verifyPricingWorkflowSelection(original, changed, repository)).toThrow("Unadmitted native Pricing workflow selection");
    });
    it.each([
      ["selector", 'const variantItemPricing = admission === "variant-item-pricing"', 'const variantItemPricing = false'],
      ["PriceSet creation refusal", 'create: variantItemPricing ? refuse : (input, shared)', 'create: (input, shared)'],
      ["PriceList creation refusal", 'create: variantItemPricing || listUpdates', 'create: listUpdates'],
      ["preference creation refusal", 'create: variantItemPricing ? refuse : preferenceCreate', 'create: preferenceCreate'],
      ["calculation profile", 'variantItemPricing ? "variant-item-pricing" : "scalar"', '"scalar"'],
      ["calculation profile fallback", 'variantItemPricing ? "variant-item-pricing" : "scalar"', '"variant-item-pricing"'],
      ["calculation arguments", 'calculateLogicalPrices(ctx, { filters, pricingContext },', 'calculateLogicalPrices(ctx, { filters, pricingContext: {} },'],
      ["calculation owner", 'calculateLogicalPrices(ctx, { filters, pricingContext },', 'otherCalculatePrices(ctx, { filters, pricingContext },'],
      ["admission union", '| "variant-item-pricing";', '| "all-pricing";'],
    ])("rejects variant item pricing repository %s mutation", (_name, before, after) => {
      const changed = repository.replace(before, after);
      expect(changed).not.toBe(repository);
      expect(() => verifyPricingWorkflowSelection(original, selected, changed)).toThrow("Unadmitted native Pricing workflow selection");
    });
    it.each(['...{ methods: { calculatePrices } }', '["methods"]: { calculatePrices }',
      'get methods() { return { calculatePrices }; }', 'methods'])("rejects public method override %s", override => {
      expect(() => verifyPricingWorkflowSelection(original, selected.replace(methods,
        `${methods}, ${override}`), repository)).toThrow();
    });
    it.each([
      selected.replace('const listPriceRemovals = admission === "price-list-price-removals"', 'const listPriceRemovals = listPriceUpdates'),
      selected.replace('listPriceRemovals ? "pricing-price-list-price-removals"', 'listPriceRemovals ? "pricing-price-list-price-updates"'),
      selected.replace('[priceRemovalRead, priceRemovalSoftDelete, priceRemovalRestore]', '[priceRemovalRead, priceRemovalSoftDelete, priceRemovalRestore, removeListPrices]'),
      selected.replace('[priceRemovalRead, priceRemovalSoftDelete, priceRemovalRestore]', '[priceRemovalRead, priceRemovalSoftDelete]'),
      selected.replace('listPrices: listPricesForRemoval, softDeletePrices: softDeletePricesForRemoval, restorePrices: restorePricesForRemoval', 'listPrices: listPricesForRemoval, softDeletePrices: softDeletePricesForRemoval, restorePrices: restorePricesForRemoval, removePrices'),
      selected.replace('listPriceRemovals ? pricingPriceListPriceRemovalPolicy(listPriceRemovalContracts)', 'listPriceRemovals ? pricingListPriceUpdatePolicy(listPriceUpdateContracts)'),
      selected.replace('compilePriceListPriceRemovalContracts(metadata.frame)', 'compilePriceListPriceRemovalContracts(otherFrame)'),
      selected.replace('listPriceRemovals ? model === Price ? bound.priceRepository : bound.denied', 'listPriceRemovals ? model === Price ? bound.priceRepository : bound.listRepository'),
      selected.replace('softDeletePrices: listPriceRemovals ? native.softDeletePrices.bind(native)', 'softDeletePrices: listPriceRemovals ? native.removePrices.bind(native)'),
      selected.replace('restorePrices: listPriceRemovals ? native.restorePrices.bind(native)', 'restorePrices: listPriceRemovals ? native.restorePriceListPrices.bind(native)'),
      selected.replace('listPrices: shippingUpdates || listPriceRemovals ?', 'listPrices: shippingUpdates ?'),
      selected.replace('commands.read("pricingListPricesForRemovalWorkflow"', 'commands.write("pricingListPricesForRemovalWorkflow"'),
      selected.replace('commands.write("pricingPriceSoftDeleteForRemovalWorkflow"', 'commands.write("pricingRemovePriceListPrices"'),
      selected.replace('commands.write("pricingPriceRestoreForRemovalWorkflow"', 'commands.read("pricingPriceRestoreForRemovalWorkflow"'),
      selected.replace('Reflect.apply(service.softDeletePrices, service, [[...ids], {}, context])', 'Reflect.apply(service.softDeletePrices, service, [[...ids], {}, {}])'),
      selected.replace('Reflect.apply(service.restorePrices, service, [[...ids], {}, context])', 'Reflect.apply(service.restorePrices, service, [[...ids], context])'),
      selected.replace('output: listPriceRemovalContracts.decodeReadOutput', 'output: listPriceContracts.decodeOutput'),
      selected.replace('command: priceRemovalSoftDelete,', 'command: removeListPrices,'),
      selected.replace('moduleEvents: ["price", "price_rule"].flatMap', 'moduleEvents: ["price", "price_rule", "price_list"].flatMap'),
      selected.replace('command: priceRemovalRestore,\n      arguments: decodePriceListPriceRemovalLifecycleArguments, encode: ([ids]) => ids, output: listPriceRemovalContracts.decodeOutput',
        'command: priceRemovalRestore,\n      arguments: decodePriceListPriceRemovalLifecycleArguments, encode: ([ids]) => ids, output: listPriceRemovalContracts.decodeOutput, moduleEvents: priceCreationEvents'),
      selected.replace('from "./price-list-price-removal-input"', 'from "./price-list-price-input"'),
      selected.replace('from "./price-list-price-removal-receipt"', 'from "./price-list-price-update-receipt"'),
      selected.replace('const listPriceUpdates = admission === "price-list-price-updates"', 'const listPriceUpdates = listPriceCreations'),
      selected.replace('const listPrices = listPriceCreations || listPriceUpdates', 'const listPrices = listPriceCreations'),
      selected.replace('listPriceUpdates ? "pricing-price-list-price-updates"', 'listPriceUpdates ? "pricing-price-list-price-creations"'),
      selected.replace('[listPriceUpdateRead, listPriceSnapshot, listPriceUpdate, listPriceRestore]', '[listPriceUpdateRead, listPriceUpdate]'),
      selected.replace('[listPriceUpdateRead, listPriceSnapshot, listPriceUpdate, listPriceRestore]', '[listPriceUpdateRead, listPriceSnapshot, listPriceUpdate, listPriceRestore, removeListPrices]'),
      selected.replace('snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices } : {})', 'snapshotPriceListPricesForUpdate, updatePriceListPrices, restorePriceListPrices, removePrices } : {})'),
      selected.replace('listPriceUpdates ? pricingListPriceUpdatePolicy(listPriceUpdateContracts)', 'listPriceUpdates ? pricingListPriceCreationPolicy(listPriceContracts)'),
      selected.replace('compilePriceListPriceUpdateContracts(metadata.frame)', 'compilePriceListPriceUpdateContracts(otherFrame)'),
      selected.replace('snapshotPriceListPricesForUpdate: listPriceUpdates ?', 'snapshotPriceListPricesForUpdate: listPrices ?'),
      selected.replace('restorePriceListPrices: listPriceUpdates ? native.restorePriceListPrices.bind(native)', 'restorePriceListPrices: listPriceUpdates ? native.updatePriceListPrices.bind(native)'),
      selected.replace('commands.read("pricingListPriceSnapshot"', 'commands.write("pricingListPriceSnapshot"'),
      selected.replace('commands.write("pricingListPriceRestore", prepare(listPriceUpdateContracts.decodeCompensation)', 'commands.write("pricingListPriceRestore", prepare(decodeUpdatePriceListPrices)'),
      selected.replace('output: listPriceUpdateContracts.decodeSnapshot', 'output: listPriceUpdateContracts.decodeOutput'),
      selected.replace('output: listPriceUpdateContracts.decodeOutput, moduleEvents: priceCreationEvents', 'output: listPriceContracts.decodeOutput, moduleEvents: priceCreationEvents'),
      selected.replace('listPriceUpdateContracts.decodeCompensation(data)', 'Result.succeed(data)'),
      selected.replace('listPriceUpdates && model === PriceRule ? bound.ruleRepository : bound.denied', 'model === PriceRule ? bound.ruleRepository : bound.denied'),
      selected.replace('from "./price-list-price-update-input"', 'from "./price-list-price-input"'),
      selected.replace('from "./price-list-price-update-receipt"', 'from "./price-list-price-receipt"'),
      selected.replace('const listUpdates = admission === "price-list-updates"', 'const listUpdates = listCreations'),
      selected.replace('listUpdates ? "pricing-price-list-updates"', 'listUpdates ? "pricing-price-list-creations"'),
      selected.replace('listUpdates ? [listUpdateRead, listUpdate]', 'listUpdates ? [listUpdateRead, listUpdate, createList]'),
      selected.replace('listUpdates ? [listUpdateRead, listUpdate]', 'listUpdates ? [listUpdateRead, listUpdate, deleteList]'),
      selected.replace('listUpdates ? { listPriceLists: listPriceListsForUpdate, updatePriceLists }', 'listUpdates ? { listPriceLists: listPriceListsForUpdate, updatePriceLists, deletePriceLists }'),
      selected.replace('listUpdates ? pricingListUpdatePolicy(listUpdateContracts)', 'listUpdates ? pricingListCreationPolicy(listContracts)'),
      selected.replace('compilePriceListUpdateContracts(metadata.frame)', 'compilePriceListUpdateContracts(otherFrame)'),
      selected.replace('listPriceLists: listUpdates || listPriceCreations || listPriceUpdates ? native.listPriceLists.bind(native)', 'listPriceLists: listUpdates ? native.listPriceSets.bind(native)'),
      selected.replace('updatePriceLists: listUpdates ? native.updatePriceLists.bind(native)', 'updatePriceLists: listUpdates ? native.upsertPriceSets.bind(native)'),
      selected.replace('command: listUpdateRead, arguments: listUpdateReadArguments', 'command: list, arguments: listUpdateReadArguments'),
      selected.replace('output: listUpdateContracts.decodeReadOutput', 'output: listUpdateContracts.decodeUpdateOutput'),
      selected.replace('commerceDecoder(Schema.Tuple([PriceListUpdatesInput])', 'commerceDecoder(Schema.Tuple([PriceListsInput])'),
      selected.replace('const mutable = admission === "variant-updates" || admission === "product-updates"', 'const mutable = true'),
      selected.replace('const preferences = admission === "price-preferences" || preferenceUpdates || preferenceDeletions', 'const preferences = true'),
      selected.replace('const preferenceUpdates = admission === "price-preference-updates"', 'const preferenceUpdates = preferences'),
      selected.replace('const preferenceDeletions = admission === "price-preference-deletions"', 'const preferenceDeletions = preferenceUpdates'),
      selected.replace('yield* compilePricePreferenceContracts(metadata.frame)', 'yield* compilePricePreferenceContracts(otherFrame)'),
      selected.replace('pricingPreferencePolicy(preferenceContracts)', 'pricingLogicalCreateEventPolicy(preferenceContracts)'),
      selected.replace('...(preferences && !preferenceUpdates && !preferenceDeletions ? { createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences } : {})',
        '...(preferences ? { listPricePreferences, upsertPricePreferences, deletePricePreferences } : {})'),
      selected.replace('preferences ? [createPreference, preferenceList, preferenceUpsert, preferenceDelete]', 'preferences ? [preferenceList, preferenceUpsert, preferenceDelete]'),
      selected.replace('createPricePreferences: variantItemPricing || shipping || preferenceUpdates || preferenceDeletions || listCreations || listUpdates || listDeletions || listPrices ? binding.refuse : native.createPricePreferences.bind(native)',
        'createPricePreferences: preferences || shipping ? binding.refuse : native.createPricePreferences.bind(native)'),
      selected.replace('listPricePreferences: listUpdatePricePreferences', 'listPricePreferences'),
      selected.replace('upsertPricePreferences: upsertUpdatePricePreferences', 'upsertPricePreferences'),
      selected.replace('updatePricePreferences: preferenceUpdates ? native.updatePricePreferences.bind(native) : binding.refuse',
        'updatePricePreferences: preferences ? native.updatePricePreferences.bind(native) : binding.refuse'),
      selected.replace('preparePricingRepository(metadata.frame, admission)', 'preparePricingRepository(metadata.frame, "price-preference-updates")'),
      selected.replace('preparePricingRepository(metadata.frame, admission)', 'preparePricingRepository(metadata.frame)'),
      selected.replace('preferenceDeletions ? [preferenceSoftDelete, preferenceRestore]',
        'preferenceDeletions ? [preferenceSoftDelete, preferenceRestore, preferenceDelete]'),
      selected.replace('preferenceDeletions ? [preferenceSoftDelete, preferenceRestore]',
        'preferenceDeletions ? [preferenceSoftDelete, preferenceRestore, preferenceList]'),
      selected.replace('...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {})',
        '...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences, upsertPricePreferences } : {})'),
      selected.replace('...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {})',
        '...(preferences ? { softDeletePricePreferences, restorePricePreferences } : {})'),
      selected.replace('softDeletePricePreferences: preferenceDeletions ? native.softDeletePricePreferences.bind(native) : binding.refuse',
        'softDeletePricePreferences: preferences ? native.softDeletePricePreferences.bind(native) : binding.refuse'),
      selected.replace('restorePricePreferences: preferenceDeletions ? native.restorePricePreferences.bind(native) : binding.refuse',
        'restorePricePreferences: preferenceDeletions ? native.softDeletePricePreferences.bind(native) : binding.refuse'),
      selected.replace('listPricePreferences: preferences && !preferenceDeletions ?', 'listPricePreferences: preferences ?'),
      selected.replace('upsertPricePreferences: preferences && !preferenceDeletions ?', 'upsertPricePreferences: preferences ?'),
      selected.replace('createPricePreferences: variantItemPricing || shipping || preferenceUpdates || preferenceDeletions || listCreations || listUpdates || listDeletions || listPrices ?',
        'createPricePreferences: variantItemPricing || shipping || preferenceUpdates || listCreations || listUpdates || listDeletions || listPrices ?'),
      selected.replace('deletePricePreferences: preferences && !preferenceUpdates && !preferenceDeletions ?',
        'deletePricePreferences: preferences && !preferenceUpdates ?'),
      selected.replace('preferenceDeletions ? "pricing-price-preference-deletions"', 'preferenceDeletions ? "pricing-price-preference-updates"'),
      selected.replace('preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert]',
        'preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert, preferenceDelete]'),
      selected.replace('preferences || listCreations || listUpdates || listDeletions || listPrices ? { aliases: [], reads: [] }', 'preferences && !preferenceUpdates ? { aliases: [], reads: [] }'),
      selected.replace('preferences ? preferencePolicy : lifecycle ?', 'preferences && !preferenceUpdates ? preferencePolicy : lifecycle ?'),
      selected.replace('preferenceUpdates ? "pricing-price-preference-updates"', 'preferenceUpdates ? "pricing-price-preferences"'),
      selected.replace('lifecycle = admission === "product-updates"', 'lifecycle = true'),
      selected.replace('...(lifecycle || shipping ? { softDeletePriceSets } : {})', '...(mutable ? { softDeletePriceSets } : {})'),
      selected.replace('...(lifecycle || shipping ? { softDeletePriceSets } : {})', '...(lifecycle || shipping ? { softDeletePriceSets, calculatePrices } : {})'),
      selected.replace('...(lifecycle || shipping ? { softDeletePriceSets } : {})', '...(lifecycle || shipping ? { softDeletePriceSets } : { softDeletePriceSets })'),
      selected.replace('= "create")', '= "variant-updates")'),
      selected.replace('...(mutable ? { upsertPriceSets', '...(true ? { upsertPriceSets'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, listPriceSets, calculatePrices } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'get upsertPriceSets() { return calculatePrices; }, updatePriceSets, listPriceSets } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, ["listPriceSets"]: listPriceSets } : {}'),
      selected.replace('upsertPriceSets, updatePriceSets, listPriceSets } : {}', 'upsertPriceSets, updatePriceSets, listPriceSets } : { calculatePrices }'),
      selected.replace('const shipping = admission === "shipping-options"', 'const shipping = admission !== "price-preferences"'),
      selected.replace('...(shipping ? { restorePriceSets, deletePriceSets } : {})', '...(lifecycle || shipping ? { restorePriceSets, deletePriceSets } : {})'),
      selected.replace('...(shipping ? { restorePriceSets, deletePriceSets } : {})', '...(shipping ? { restorePriceSets, deletePriceSets, calculatePrices } : {})'),
      selected.replace('...(!shipping ? { createPriceLists, createPricePreferences } : {})', '...{ createPriceLists, createPricePreferences }'),
      selected.replace('shipping ? [create, list, count, retrieve, softDeletePriceSetsCommand, restorePriceSetsCommand, deletePriceSetsCommand]',
        'shipping ? [create, list, count, retrieve, calculate, softDeletePriceSetsCommand, restorePriceSetsCommand, deletePriceSetsCommand]'),
      selected.replace('...(lifecycle ? [softDeletePriceSetsCommand] : [])', '...(lifecycle ? [softDeletePriceSetsCommand, restorePriceSetsCommand] : [])'),
      selected.replace('restorePriceSets: shipping ? native.restorePriceSets.bind(native) : binding.refuse',
        'restorePriceSets: lifecycle || shipping ? native.restorePriceSets.bind(native) : binding.refuse'),
      selected.replace('deletePriceSets: shipping ? native.deletePriceSets.bind(native) : binding.refuse',
        'deletePriceSets: mutable || shipping ? native.deletePriceSets.bind(native) : binding.refuse'),
      selected.replace('if (shipping && !shippingUpdates) shippingLifecycleServices.set', 'if (lifecycle || shipping) shippingLifecycleServices.set'),
      selected.replace('shipping ? pricingShippingOptionPolicy(preferencePolicy, shippingOutput, shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined)', 'shipping ? pricingLogicalProductUpdateEventPolicy()'),
      selected.replace('const shippingUpdates = admission === "shipping-option-updates"', 'const shippingUpdates = shipping'),
      selected.replace('...(!variantItemPricing && !preferences && !shippingUpdates && !listCreations && !listUpdates && !listDeletions && !listPrices ?', '...(!preferences ?'),
      selected.replace('createPriceRules: createShippingPriceRules } : {})', 'createPriceRules: createShippingPriceRules, deletePriceSets } : {})'),
      selected.replace('updatePriceSets: updateShippingPriceSets', 'updatePriceSets'),
      selected.replace('[shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules, list, count, retrieve]', '[shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules, create, list, count, retrieve]'),
      selected.replace('shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined', 'undefined, shippingUpdates ? prepared : undefined'),
      selected.replace('shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined', 'shippingUpdates ? shippingMutation : undefined, undefined'),
      selected.replace('const listCreations = admission === "price-list-creations"', 'const listCreations = !preferences'),
      selected.replace('listCreations ? "pricing-price-list-creations"', 'listCreations ? "pricing-base-prices"'),
      selected.replace('listCreations ? [createList, deleteList]', 'listCreations ? [createList, deleteList, create]'),
      selected.replace('listCreations ? [createList, deleteList]', 'listCreations ? [createList, deleteList, list]'),
      selected.replace('...(listCreations ? { createPriceLists, deletePriceLists } : {})', '...(listCreations ? { createPriceLists, deletePriceLists, upsertPriceSets } : {})'),
      selected.replace('listCreations || listUpdates || listDeletions ? model === PriceList ? bound.listRepository : bound.denied', 'listCreations ? bound.repository'),
      selected.replace('deletePriceLists: listCreations ? native.deletePriceLists.bind(native) : binding.refuse', 'deletePriceLists: native.deletePriceLists.bind(native)'),
      selected.replace('yield* compilePriceListCreationContracts(metadata.frame)', 'yield* compilePriceListCreationContracts(otherFrame)'),
      selected.replace('output: listContracts.decodeOutput', 'output: preferenceContracts.decodeOutput'),
      selected.replace('listCreations ? pricingListCreationPolicy(listContracts)', 'listCreations ? existingPolicy'),
      selected.replace('pricingListCreationPolicy(listContracts, existingPolicy)', 'pricingListCreationPolicy(listContracts)'),
      selected.replace('PricingRepositoryAdmission = "create"', 'string = "create"'),
    ].map((changed, index) => ({ index, changed })))("rejects service mutation $index", ({ changed }) => {
      expect(changed).not.toBe(selected);
      expect(() => verifyPricingWorkflowSelection(original, changed, repository)).toThrow();
    });
    it.each([
      ['const listPriceRemovals = admission === "price-list-price-removals"', 'const listPriceRemovals = true'],
      ['listPriceRemovals ? yield* compilePriceListPriceRemovalContracts(metadata)', 'listPriceRemovals ? yield* compilePriceListPriceRemovalContracts(otherFrame)'],
      ['...priceListPriceRemovalLifecycleMethods(listPriceRemovalContracts, bridge, events)', '...priceListLifecycleMethods(listDeletionContracts, bridge, events)'],
      ['readPriceListPriceRemovalRows(ctx, listPriceRemovalContracts, captured)', 'readPriceListPriceCandidates(ctx, listPrice.contracts, captured)'],
      ['priceRepository: priceRemovalRepository ?? listPriceRepository', 'priceRepository: listPriceRepository'],
      ['mutable || shipping || listDeletions || listPriceRemovals ? ["afterDelete", "afterUpdate"]', 'mutable || shipping || listDeletions || listPriceRemovals ? ["afterCreate", "afterDelete", "afterUpdate"]'],
      ['from "./price-list-price-removal-input"', 'from "./price-list-price-input"'],
      ['from "./price-list-price-removal-repository"', 'from "./price-list-price-repository"'],
      ['from "./price-list-price-removal-lifecycle"', 'from "./price-list-lifecycle"'],
      ['listUpdates || listPriceCreations || listPriceUpdates ? ["afterCreate", "afterUpdate", "afterDelete"]', 'listUpdates || listPriceCreations ? ["afterCreate", "afterUpdate", "afterDelete"]'],
      ['!events.isSubscribed(shared) && (subscriber === undefined || !events.ownsSubscriber(subscriber))', '!events.isSubscribed(shared) && subscriber === undefined'],
      ['const listPriceUpdates = admission === "price-list-price-updates"', 'const listPriceUpdates = true'],
      ['listPriceUpdates ? yield* compilePriceListPriceUpdateContracts(metadata)', 'listPriceUpdates ? yield* compilePriceListPriceUpdateContracts(otherFrame)'],
      ['preparePriceListPriceReplay(listPriceUpdateContracts)', 'preparePriceListPriceReplay(otherContracts)'],
      ['preparePriceListPriceReplacement(contracts, listPriceUpdates ? "update" : "creation")', 'preparePriceListPriceReplacement(contracts, "update")'],
      ['listPriceUpdateContracts === undefined ? readPriceListPriceCandidates(ctx, listPrice.contracts, captured)', 'false ? readPriceListPriceCandidates(ctx, listPrice.contracts, captured)'],
      ['readPriceListPriceUpdateRows(ctx, listPriceUpdateContracts, captured)', 'readPriceListPriceCandidates(ctx, listPrice.contracts, captured)'],
      ['readPriceListPriceSnapshotRules(ctx, listPriceUpdateContracts, captured)', 'findTaxRules(ctx, captured)'],
      ['listPriceReplay !== undefined && Array.isArray(captured)', 'Array.isArray(captured)'],
      ['Object.hasOwn(row, "created_at")', 'Object.hasOwn(row, "id")'],
      ['listPriceReplay.replay(ctx, captured, config)', 'listPriceReplay.replay(ctx, captured, {})'],
      ['listPrice.replace(ctx, captured, config)', 'listPrice.replace(ctx, input, config)'],
      ['priceRepository: priceRemovalRepository ?? listPriceRepository ?? mutationRepositories?.priceRepository ?? denied', 'priceRepository: mutationRepositories?.priceRepository ?? denied'],
      ['ruleRepository: mutationRepositories?.ruleRepository ?? ruleRepository', 'ruleRepository: denied'],
      ['from "./price-list-price-update-input"', 'from "./price-list-price-input"'],
      ['from "./price-list-price-update-repository"', 'from "./price-list-price-repository"'],
      ['const listUpdates = admission === "price-list-updates"', 'const listUpdates = true'],
      ['compilePriceListUpdateContracts(metadata)', 'compilePriceListUpdateContracts(otherFrame)'],
      ['preparePriceListUpdateReplacement(contracts)', 'preparePriceListUpdateReplacement(otherContracts)'],
      ['create: variantItemPricing || listUpdates || listDeletions || listPriceCreations || listPriceUpdates || listPriceRemovals ? refuse :', 'create: false ? refuse :'],
      ['readPriceListUpdateRows(ctx, listPrice.contracts.listReadContracts, captured))) : listUpdate === undefined ? refuse :', 'readPriceListUpdateRows(ctx, listPrice.contracts.listReadContracts, captured))) : undefined === undefined ? refuse :'],
      ['readPriceListUpdateRows(ctx, listUpdate.contracts, input)', 'readPriceListUpdateRows(ctx, otherContracts, input)'],
      ['listUpdate.replace(ctx, input, config)', 'listUpdate.replace(ctx, input, {})'],
      ['"price-list-creations" | "price-list-updates" | "price-list-deletions" | "price-list-price-creations" | "price-list-price-updates" | "price-list-price-removals" | "shipping-options"', '"price-list-creations" | "price-list-updates" | "unbounded" | "shipping-options"'],
      ['preferenceDeletions ? "deletions" : preferenceUpdates ? "updates" : "store"', 'preferenceDeletions ? "updates" : preferenceUpdates ? "deletions" : "store"'],
      ['delete: listCreations ?', 'delete: !preferences ?'],
      ['deletePricingPriceLists(ctx, metadata, input)', 'softDeletePricingPriceSets(ctx, metadata, input)'],
    ].map(([before, after], index) => ({ index, before, after })))("rejects repository mutation $index", ({ before, after }) => {
      const changed = repository.replace(before, after);
      expect(changed).not.toBe(repository);
      expect(() => verifyPricingWorkflowSelection(original, selected, changed)).toThrow();
    });
  });
  it("preserves all selected Pricing statements and the actual rule-bearing seed", () => {
    const original = readFileSync(new URL("../third_party/medusa/upstream/packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-set.spec.ts", import.meta.url), "utf8");
    const selected = readFileSync(new URL("../packages/medusa-adapter/test/support/pricing-native-tests.ts", import.meta.url), "utf8");
    expect(() => verifyPricingCreateTests(original, selected)).not.toThrow();
    for (const changed of [selected.replace('amount: 500', 'amount: 1'), selected.replace('currency_code: "CAD"', 'currency_code: "USD"'),
      selected.replace('await service.createPriceSets(priceSets)', 'service.createPriceSets(priceSets)'),
      selected.replace('it("should create a priceSet successfully"', 'it.skip("should create a priceSet successfully"'),
      selected.replace('amount: 200', 'amount: 201'), selected + 'it("additional", () => {});']) {
      expect(() => verifyPricingCreateTests(original, changed)).toThrow();
    }
  });
  it("preserves exactly the two selected ShippingProfile bodies without admitting deferred tests", () => {
    const create = 'it("should create a new shipping profile", async () => { expect(await service.create(data)).toEqual(data); });';
    const many = 'it("should create multiple new shipping profiles", async () => { expect(await service.create([data])).toHaveLength(1); });';
    const selected = create + many;
    const original = selected + 'it("duplicate", () => {}); it("delete", () => {}); it("associated delete", () => {});';
    expect(() => verifyShippingProfileCreateTests(original, selected)).not.toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected.replace("toHaveLength(1)", "toHaveLength(0)"))).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, create)).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected + 'it("duplicate", () => {});')).toThrow();
    expect(() => verifyShippingProfileCreateTests(original, selected.replace('it("should create a new', 'it.skip("should create a new'))).toThrow();
  });
  it("permits only erased types and explicit Vitest globals around the same program", () => {
    const target = 'import { beforeEach, describe, expect, it } from "vitest";\n' + source
      .replace("const rows =", "const rows: { id: string }[] =").replace("rows[0].id", "rows[0]!.id");
    expect(() => verifyTestPort(source, target)).not.toThrow();
  });
  it.each([
    ["assertion", source.replace('toEqual("id")', 'toEqual("other")')],
    ["fixture", source.replace('title: "fixture"', 'title: "different"')],
    ["title", source.replace('it("case"', 'it("renamed"')],
    ["skip", source.replace('it("case"', 'it.skip("case"')],
    ["await", source.replace("await runner.create", "runner.create")],
    ["runtime import", source.replace('"./runner"', '"./fake-runner"')],
    ["missing assertion", source.replace('expect(rows[0].id).toEqual("id");', '')],
    ["extra case", source + 'it("extra", () => expect(true).toBe(true));'],
  ])("rejects a changed %s", (_label, target) => {
    expect(() => verifyTestPort(source, target)).toThrow("changed executable");
  });
  it("preserves the original unused fixture result without hiding evaluation", () => {
    const before = "async function setup() { const result = await create(); }";
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void result;"))).not.toThrow();
    expect(() => verifyTestPort(before, before.replace("const result", "void result; const result"))).toThrow();
    expect(() => verifyTestPort(before, before.replace("await create();", "await create(); void destroy();"))).toThrow();
  });
  it.each([
    ["prefix sign", "expect(-1).toBe(-1);", "expect(+1).toBe(-1);"],
    ["prefix operator", "expect(!result).toBe(true);", "expect(~result).toBe(true);"],
    ["postfix increment", "for (let i = 0; i < 2; i++) create(i);", "for (let i = 0; i < 2; i--) create(i);"],
    ["template raw text", "expect(String.raw`\\n`).toBe(value);", "expect(String.raw`\n`).toBe(value);"],
    ["template span raw text", "expect(String.raw`x${value}\\n`).toBe(value);", "expect(String.raw`x${value}\n`).toBe(value);"],
  ])("rejects changed executable %s", (_label, before, after) => {
    expect(() => verifyTestPort(before, after)).toThrow("changed executable");
  });
  it("requires the exact explicitly selected Currency timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { currencyTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(200000);", "", { currencyTimeout: true })).toThrow();
  });
  it("allows only the exact Currency static import relocations", () => {
    const before = 'import value from "../index"; expect(value).toBeDefined();';
    const after = before.replace('"../index"', '"@medusajs/currency/index"');
    expect(() => verifyTestPort(before, after, { currencyStaticImports: true })).not.toThrow();
    expect(() => verifyTestPort(before, after)).toThrow();
  });
  it("requires the exact explicitly selected Sales Channel timeout", () => {
    expect(() => verifyTestPort("jest.setTimeout(30000);", "", { salesChannelTimeout: true })).not.toThrow();
    expect(() => verifyTestPort("jest.setTimeout(30000);", "")).toThrow();
    expect(() => verifyTestPort("jest.setTimeout(100000);", "", { salesChannelTimeout: true })).toThrow();
  });
  it("refuses renamed Vitest bindings and syntax errors", () => {
    expect(() => verifyTestPort(source, 'import { expect as check } from "vitest";' + source)).toThrow("Unadmitted Vitest");
    expect(() => verifyTestPort(source, "const = ;")).toThrow("Invalid test-port syntax");
  });
});

describe("Price List Price update named call allowance", () => {
  const facade = readFileSync("packages/medusa-adapter/src/workflows/pricing/update-price-list-prices.ts", "utf8").replaceAll("\r\n", "\n");
  const policy = readFileSync("packages/medusa-adapter/src/workflow/policy.ts", "utf8").replaceAll("\r\n", "\n");
  it("pins the exact typed host and calls-only trusted selection", () => {
    expect(() => verifyPriceListPriceUpdateSelection(facade, policy)).not.toThrow();
  });
  it.each([
    ["missing root limit", "requestCallLimit: priceListPriceUpdateResources.calls, ", ""],
    ["wrong root limit", "requestCallLimit: priceListPriceUpdateResources.calls", "requestCallLimit: 256"],
    ["wrong module profile", 'pricing.source.profile !== "pricing-price-list-price-updates"', 'pricing.source.profile !== "pricing-price-list-price-creations"'],
    ["caller knob", '["execution", "modules", "revision", "subscribers"]', '["execution", "modules", "revision", "subscribers", "requestCallLimit"]'],
    ["resource bypass", "binding.logicalResources !== undefined && !jsonEqual(binding.logicalResources, priceListPriceUpdateResources)", "false"],
    ["native method closure", '"restorePriceListPrices"], graph: false', '"restorePriceListPrices", "removePrices"], graph: false'],
    ["root queue", 'operationScheduling: "queued", ', ""],
    ["borrowed queue", 'borrowedOperationScheduling: "queued",', ""],
    ["detached binding", 'logicalResources: priceListPriceUpdateResources, logicalPublication: "mixed"', 'logicalResources: installed.pricing.logicalResources, logicalPublication: "mixed"'],
    ["public type knob", "readonly revision: string;", "readonly revision: string; readonly requestCallLimit?: number;"],
  ])("refuses %s", (_name, before, after) => {
    const changed = facade.replace(before, after); expect(changed).not.toBe(facade);
    expect(() => verifyPriceListPriceUpdateSelection(changed, policy)).toThrow("Changed PriceList Price update resource selection");
  });
  it.each([
    ["calls64", "calls: 128", "calls: 64"],
    ["calls256", "calls: 128", "calls: 256"],
    ["event allowance", "calls: 128", "calls: 128, eventMessages: 128"],
    ["byte allowance", "calls: 128", "calls: 128, commandBytes: 2097152"],
  ])("refuses a changed update policy: %s", (_name, before, after) => {
    const declaration = "export const priceListPriceUpdateResources = Object.freeze({ ...defaultCommerceResources, " + before + " });";
    const changed = policy.replace(declaration, declaration.replace(before, after)); expect(changed).not.toBe(policy);
    expect(() => verifyPriceListPriceUpdateSelection(facade, changed)).toThrow("Changed PriceList Price update resource selection");
  });
});
