// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { taxRateUpdateSourcePairs, updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair, verifyTaxRuleCreatorType, verifyUpdateMetadataExtraction, verifyTaxRateUpdateCallbacks,
  verifyTaxRateUpdateSelection } from "./check-medusa-tax-rate-update-source.mjs";

const failure = "Changed native Tax Rate update source";
const [workflowPair, stepPair] = taxRateUpdateSourcePairs;
if (workflowPair === undefined || stepPair === undefined) throw new Error("Missing Tax Rate update pair");
const nativeWorkflow = readFileSync(workflowPair.source, "utf8"), workflow = readFileSync(workflowPair.target, "utf8");
const nativeStep = readFileSync(stepPair.source, "utf8"), step = readFileSync(stepPair.target, "utf8");
const [internalPair, metadataPair] = updateMetadataSourcePairs;
if (internalPair === undefined || metadataPair === undefined) throw new Error("Missing native metadata extraction pair");
const nativeInternal = readFileSync(internalPair.source, "utf8"), internal = readFileSync(internalPair.target, "utf8");
const metadata = readFileSync(metadataPair.target, "utf8");
const nativeTypes = readFileSync(taxRuleCreatorTypeSourcePair.source, "utf8"), types = readFileSync(taxRuleCreatorTypeSourcePair.target, "utf8");
const allPairs = [...taxRateUpdateSourcePairs, ...updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair];

describe("native Tax Rate selector update source", () => {
  it("retains complete typed/emitted root, inline maybe-list, projected update and retained inverse", () => {
    expect(() => verifyTaxRateUpdateCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
    expect(() => verifyTaxRateUpdateSelection(allPairs)).not.toThrow();
    expect(() => verifyUpdateMetadataExtraction(nativeInternal, internal, metadata)).not.toThrow();
    expect(() => verifyTaxRuleCreatorType(nativeTypes, types)).not.toThrow();
  });
  it.each([
    ["workflow", "if (data.update.rules)", "if (false)"],
    ["workflow", "delete data.update.rules", "data.update.rules = []"],
    ["workflow", "selector: data.selector", "selector: {}"],
    ["workflow", "update: data.update", "update: {}"],
    ["workflow", "updateTaxRatesStep(cleanedUpdateInput)", "updateTaxRatesStep(input)"],
    ["workflow", "rates.map((r) => r.id)", "rates.reverse().map((r) => r.id)"],
    ["workflow", "if (!update.rules) {\n      return new StepResponse([])", "if (!update.rules?.length) {\n      return new StepResponse([])"],
    ["workflow", "Modules.TAX", '"other"'],
    ["workflow", "{ tax_rate_id: tax_rate_ids }", "{ tax_rate_id: [] }"],
    ["workflow", '{ select: ["id"] }', '{ select: ["id"], take: 15 }'],
    ["workflow", '{ select: ["id"] }', '{ select: ["reference_id"] }'],
    ["workflow", "rules.map((r) => r.id)", "rules.reverse().map((r) => r.id)"],
    ["workflow", "deleteTaxRateRulesStep(ruleIds)", "deleteTaxRateRulesStep([])"],
    ["workflow", "deleteTaxRateRulesStep(ruleIds)", ""],
    ["workflow", "const updatedBy = update.updated_by", "const updatedBy = undefined"],
    ["workflow", "return update.rules\n          .map((r)", "return [...update.rules].reverse()\n          .map((r)"],
    ["workflow", "return rateIds.map((id)", "return [...rateIds].reverse().map((id)"],
    ["workflow", "...r,\n                created_by: updatedBy,", "created_by: updatedBy,\n                ...r,"],
    ["workflow", "tax_rate_id: id,", 'tax_rate_id: "other",'],
    ["workflow", "createTaxRateRulesStep(rulesWithRateId)", "rulesWithRateId.length && createTaxRateRulesStep(rulesWithRateId)"],
    ["workflow", "new WorkflowResponse(updatedRates)", "new WorkflowResponse(rulesWithRateId)"],
    ["workflow", "selector: FilterableTaxRateProps", "selector: Record<string, unknown>"],
    ["workflow", "WorkflowResponse<UpdateTaxRatesWorkflowOutput>", "WorkflowResponse<unknown[]>"],
    ["workflow", "import {\n  FilterableTaxRateProps", "import type {\n  FilterableTaxRateProps"],
    ["workflow", '../steps/update-tax-rates"', '../steps/upsert-tax-rates"'],
    ["step", "(Modules.TAX)\n\n    const { selects", '("other")\n\n    const { selects'],
    ["step", "(Modules.TAX)\n\n    await service.upsertTaxRates", '("other")\n\n    await service.upsertTaxRates'],
    ["step", "[\n      data.update,\n    ]", "[{}]"],
    ["step", "service.listTaxRates(data.selector", "service.listTaxRates({}"],
    ["step", "select: selects,", 'select: ["id"],'],
    ["step", "relations,", "relations: [],"],
    ["step", "service.updateTaxRates(data.selector, data.update)", "service.updateTaxRates({}, data.update)"],
    ["step", "new StepResponse(taxRates, prevData)", "new StepResponse(taxRates, taxRates)"],
    ["step", "if (!prevData?.length)", "if (false)"],
    ["step", "service.upsertTaxRates(prevData)", "service.upsertTaxRates([])"],
    ["step", "service.upsertTaxRates(prevData)", "service.updateTaxRates(prevData, {})"],
    ["step", "update: UpdateTaxRateDTO", "update: Partial<UpdateTaxRateDTO>"],
    ["step", 'compensation: "transactionCovered"', 'compensation: "uncovered"'],
    ["step", "import {\n  FilterableTaxRateProps", "import type {\n  FilterableTaxRateProps"],
  ])("refuses changed %s source: %s", (key, before, after) => {
    const original = (key === "workflow" ? workflow : step).replaceAll("\r\n", "\n");
    expect(original.split(before)).toHaveLength(2);
    const changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    expect(() => verifyTaxRateUpdateCallbacks(nativeWorkflow, key === "workflow" ? changed : workflow,
      nativeStep, key === "step" ? changed : step)).toThrow(failure);
  });
  it("refuses appended execution and native adaptation-anchor drift", () => {
    expect(() => verifyTaxRateUpdateCallbacks(nativeWorkflow, workflow + '\nthrow new Error("extra");', nativeStep, step)).toThrow(failure);
    expect(() => verifyTaxRateUpdateCallbacks(nativeWorkflow.replace('from "../steps"', 'from "../other"'), workflow, nativeStep, step)).toThrow(failure);
  });
  it("refuses Rule deletion moved after creation", () => {
    const changed = workflow.replace("    deleteTaxRateRulesStep(ruleIds)", "")
      .replace("    return new WorkflowResponse", "    deleteTaxRateRulesStep(ruleIds)\n    return new WorkflowResponse");
    expect(changed).not.toBe(workflow);
    expect(() => verifyTaxRateUpdateCallbacks(nativeWorkflow, changed, nativeStep, step)).toThrow(failure);
  });
  it("refuses missing, duplicate, redirected, reclassified and adjacent/upsert selections", () => {
    for (const files of [[], [...allPairs, workflowPair],
      [{ ...workflowPair, source: stepPair.source }, stepPair, ...updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair],
      [{ ...workflowPair, classification: "importRelocation" }, stepPair, ...updateMetadataSourcePairs, taxRuleCreatorTypeSourcePair],
      [...allPairs, { ...workflowPair, target: workflowPair.target + ".adjacent" }],
      [...allPairs, { ...workflowPair, source: workflowPair.source.replace("update-tax-rates", "upsert-tax-rates"),
        target: workflowPair.target.replace("update-tax-rates", "upsert-tax-rates") }]]) {
      expect(() => verifyTaxRateUpdateSelection(files)).toThrow(failure);
    }
  });
  it.each([
    ["metadata", "entity_.metadata = update_.metadata = mergeMetadata(", "entity_.metadata = mergeMetadata("],
    ["metadata", "toUpdateData.forEach", "[...toUpdateData].reverse().forEach"],
    ["metadata", "if (isPresent(update_.metadata))", "if (true)"],
    ["metadata", "entity_.metadata ?? {}", "{}"],
    ["metadata", "entity as TEntity", "entity as unknown"],
    ["internal", "prepareUpdateMetadata(toUpdateData)", "prepareUpdateMetadata([...toUpdateData].reverse())"],
    ["internal", "prepareUpdateMetadata(toUpdateData)", ""],
  ])("refuses changed native metadata %s source: %s", (key, before, after) => {
    const original = (key === "metadata" ? metadata : internal).replaceAll("\r\n", "\n");
    expect(original.split(before)).toHaveLength(2);
    const changed = original.replace(before, after);
    expect(() => verifyUpdateMetadataExtraction(nativeInternal, key === "internal" ? changed : internal,
      key === "metadata" ? changed : metadata)).toThrow(failure);
  });
  it("refuses extracted helper append and extraction reclassification/redirection", () => {
    expect(() => verifyUpdateMetadataExtraction(nativeInternal, internal, metadata + "\nthrow new Error('extra')")).toThrow(failure);
    for (const files of [taxRateUpdateSourcePairs, [...allPairs, metadataPair],
      [...taxRateUpdateSourcePairs, internalPair, { ...metadataPair, classification: "authored" }, taxRuleCreatorTypeSourcePair],
      [...taxRateUpdateSourcePairs, internalPair, { ...metadataPair, target: metadataPair.target + ".other" }, taxRuleCreatorTypeSourcePair]]) {
      expect(() => verifyTaxRateUpdateSelection(files)).toThrow(failure);
    }
  });
  it.each([
    ["created_by?: string | null | undefined", "created_by?: string | null"],
    ["created_by?: string | null | undefined", "created_by?: string | null | number | undefined"],
    ["created_by?: string | null | undefined", "created_by: string | null | undefined"],
    ["created_by?: string\n", "created_by?: string | undefined\n"],
    ["updated_by?: string", "updated_by?: string | undefined"],
    ["rules?: Omit<CreateTaxRateRuleDTO, \"tax_rate_id\">[]", "rules?: CreateTaxRateRuleDTO[]"],
  ])("refuses Tax type changes outside the one creator adaptation: %s", (before, after) => {
    const original = types.replaceAll("\r\n", "\n"), changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    expect(() => verifyTaxRuleCreatorType(nativeTypes, changed)).toThrow(failure);
  });
  it("refuses type-pair omission, reclassification, redirection and appended runtime", () => {
    expect(() => verifyTaxRuleCreatorType(nativeTypes, types + "\nconsole.log('extra')")).toThrow(failure);
    for (const files of [[...taxRateUpdateSourcePairs, ...updateMetadataSourcePairs], [...allPairs, taxRuleCreatorTypeSourcePair],
      [...taxRateUpdateSourcePairs, ...updateMetadataSourcePairs, { ...taxRuleCreatorTypeSourcePair, classification: "unchanged" }],
      [...taxRateUpdateSourcePairs, ...updateMetadataSourcePairs, { ...taxRuleCreatorTypeSourcePair, target: taxRuleCreatorTypeSourcePair.target + ".other" }]]) {
      expect(() => verifyTaxRateUpdateSelection(files)).toThrow(failure);
    }
  });
});
