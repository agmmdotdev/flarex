// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { taxRuleReplacementSourcePairs, verifyTaxRuleReplacementCallbacks,
  verifyTaxRuleReplacementSelection } from "./check-medusa-tax-rule-replacement-source.mjs";

const failure = "Changed native Tax Rate Rule replacement source";
const [workflowPair, listPair] = taxRuleReplacementSourcePairs;
if (workflowPair === undefined || listPair === undefined) throw new Error("Missing Tax replacement source pair");
const nativeWorkflow = readFileSync(workflowPair.source, "utf8"), workflow = readFileSync(workflowPair.target, "utf8");
const nativeList = readFileSync(listPair.source, "utf8"), list = readFileSync(listPair.target, "utf8");

describe("native Tax Rate Rule replacement source", () => {
  it("retains the complete typed and emitted native root and list step", () => {
    expect(() => verifyTaxRuleReplacementCallbacks(nativeWorkflow, workflow, nativeList, list)).not.toThrow();
    expect(() => verifyTaxRuleReplacementSelection(taxRuleReplacementSourcePairs)).not.toThrow();
  });
  it.each([
    ["workflow", "selector: { tax_rate_id: input.tax_rate_ids }", "selector: { tax_rate_id: [] }"],
    ["workflow", "deleteTaxRateRulesStep(ruleIds)", "deleteTaxRateRulesStep([])"],
    ["workflow", "deleteTaxRateRulesStep(ruleIds)", ""],
    ["workflow", "return rules\n          .map((r)", "return [...rules].reverse()\n          .map((r)"],
    ["workflow", "return rateIds.map((id)", "return [...rateIds].reverse().map((id)"],
    ["workflow", "...r,\n                tax_rate_id: id,", "tax_rate_id: id,\n                ...r,"],
    ["workflow", "createTaxRateRulesStep(rulesWithRateId)", "createTaxRateRulesStep([])"],
    ["workflow", 'rules: Omit<CreateTaxRateRuleDTO, "tax_rate_id">[]', 'rules: CreateTaxRateRuleDTO[]'],
    ["workflow", "tax_rate_ids: string[]", "tax_rate_ids: readonly string[]"],
    ["workflow", "WorkflowResponse<TaxRateRuleDTO[]>", "WorkflowResponse<unknown[]>"],
    ["workflow", '../steps/create-tax-rate-rules"', '../steps/other-rules"'],
    ["list", "Modules.TAX", '"other"'],
    ["list", "const service = container.resolve", "if (!input.selector.tax_rate_id?.length) return new StepResponse([])\n    const service = container.resolve"],
    ["list", "service.listTaxRateRules(input.selector", "service.listTaxRateRules({}"],
    ["list", 'select: ["id"],', 'select: ["id"], take: 15,'],
    ["list", 'select: ["id"],', 'select: ["reference_id"],'],
    ["list", "rules.map((r) => r.id)", "rules.reverse().map((r) => r.id)"],
    ["list", "selector: FilterableTaxRateRuleProps", "selector: Record<string, unknown>"],
    ["list", "import {\n  FilterableTaxRateRuleProps", "import type {\n  FilterableTaxRateRuleProps"],
  ])("refuses changed %s source: %s", (key, before, after) => {
    const original = key === "workflow" ? workflow : list;
    const changed = original.replaceAll("\r\n", "\n").replace(before, after);
    expect(changed).not.toBe(original.replaceAll("\r\n", "\n"));
    expect(() => verifyTaxRuleReplacementCallbacks(nativeWorkflow, key === "workflow" ? changed : workflow,
      nativeList, key === "list" ? changed : list)).toThrow(failure);
  });
  it("refuses appended execution and changed native adaptation anchors", () => {
    expect(() => verifyTaxRuleReplacementCallbacks(nativeWorkflow, workflow + '\nthrow new Error("extra");', nativeList, list)).toThrow(failure);
    expect(() => verifyTaxRuleReplacementCallbacks(nativeWorkflow.replace('from "../steps"', 'from "../other"'), workflow, nativeList, list)).toThrow(failure);
  });
  it("refuses altered step order", () => {
    const changed = workflow.replace("    deleteTaxRateRulesStep(ruleIds)", "")
      .replace("    return new WorkflowResponse", "    deleteTaxRateRulesStep(ruleIds)\n    return new WorkflowResponse");
    expect(changed).not.toBe(workflow);
    expect(() => verifyTaxRuleReplacementCallbacks(nativeWorkflow, changed, nativeList, list)).toThrow(failure);
  });
  it("refuses missing, duplicate, redirected, reclassified and unrelated source pairs", () => {
    for (const files of [[], [...taxRuleReplacementSourcePairs, workflowPair],
      [{ ...workflowPair, source: listPair.source }, listPair],
      [{ ...workflowPair, classification: "importRelocation" }, listPair],
      [...taxRuleReplacementSourcePairs, { ...workflowPair, target: workflowPair.target + ".adjacent" }],
      [...taxRuleReplacementSourcePairs, { ...workflowPair, source: "other", target: "other" }]]) {
      expect(() => verifyTaxRuleReplacementSelection(files)).toThrow(failure);
    }
  });
});
