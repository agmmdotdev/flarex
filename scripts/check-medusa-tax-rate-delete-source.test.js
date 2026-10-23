// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { taxRateDeletionSourcePairs, verifyTaxRateDeletionCallbacks,
  verifyTaxRateDeletionSelection } from "./check-medusa-tax-rate-delete-source.mjs";

const failure = "Changed native Tax Rate deletion source";
const [workflowPair, stepPair] = taxRateDeletionSourcePairs;
if (workflowPair === undefined || stepPair === undefined) throw new Error("Missing Tax Rate deletion source pair");
const nativeWorkflow = readFileSync(workflowPair.source, "utf8"), workflow = readFileSync(workflowPair.target, "utf8");
const nativeStep = readFileSync(stepPair.source, "utf8"), step = readFileSync(stepPair.target, "utf8");

describe("native Tax Rate deletion source", () => {
  it("retains complete typed/emitted root, required empty forward call and raw retained inverse", () => {
    expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
    expect(() => verifyTaxRateDeletionSelection(taxRateDeletionSourcePairs)).not.toThrow();
    expect(() => verifyTaxRateDeletionSelection([...taxRateDeletionSourcePairs,
      { source: "unrelated/source.ts", target: "unrelated/target.ts", classification: "unchanged" }])).not.toThrow();
  });
  it("permits comments and layout without changing imports, contracts or executable callbacks", () => {
    expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow,
      workflow.replace("    return new WorkflowResponse", "    // preserved native root\n    return new WorkflowResponse"),
      nativeStep, step.replace("    await service.softDeleteTaxRates", "\n    // preserved native call\n    await service.softDeleteTaxRates"))).not.toThrow();
  });
  it.each([
    ["workflow", "ids: string[]", "ids: readonly string[]"],
    ["workflow", 'deleteTaxRatesWorkflowId = "delete-tax-rates"', 'deleteTaxRatesWorkflowId = "other"'],
    ["workflow", "new WorkflowResponse(deleteTaxRatesStep(input.ids))", "new WorkflowResponse(undefined)"],
    ["workflow", "deleteTaxRatesStep(input.ids)", "deleteTaxRatesStep([])"],
    ["workflow", "deleteTaxRatesStep(input.ids)", "input.ids.length ? deleteTaxRatesStep(input.ids) : undefined"],
    ["workflow", "WorkflowResponse<WorkflowData<void>>", "WorkflowResponse<WorkflowData<string[]>>"],
    ["workflow", "  WorkflowData<void>,", "  WorkflowData<unknown>,"],
    ["workflow", "  readonly []", "  []"],
    ["workflow", "type WorkflowDefinition,", "WorkflowDefinition,"],
    ["workflow", "  WorkflowData,", "  type WorkflowData,"],
    ["workflow", '../steps/delete-tax-rates"', '../steps/delete-tax-rate-rules"'],
    ["step", "DeleteTaxRatesStepInput = string[]", "DeleteTaxRatesStepInput = readonly string[]"],
    ["step", 'deleteTaxRatesStepId = "delete-tax-rates"', 'deleteTaxRatesStepId = "other"'],
    ["step", 'compensation: "transactionCovered"', 'compensation: "uncovered"'],
    ["step", 'compensation: "transactionCovered"', 'compensation: "transactionCovered", retries: 5'],
    ["step", "    const service = container.resolve", "    if (!ids?.length) return new StepResponse(void 0, [])\n    const service = container.resolve"],
    ["step", "(Modules.TAX)\n\n    await service.softDeleteTaxRates", '("other")\n\n    await service.softDeleteTaxRates'],
    ["step", "service.softDeleteTaxRates(ids)", "service.deleteTaxRates(ids)"],
    ["step", "service.softDeleteTaxRates(ids)", "service.softDeleteTaxRates([])"],
    ["step", "service.softDeleteTaxRates(ids)", "service.softDeleteTaxRates([...new Set(ids)])"],
    ["step", "service.softDeleteTaxRates(ids)", "service.softDeleteTaxRates(ids.sort())"],
    ["step", "await service.softDeleteTaxRates(ids)", "service.softDeleteTaxRates(ids)"],
    ["step", "new StepResponse(void 0, ids)", "new StepResponse(null, ids)"],
    ["step", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [...ids])"],
    ["step", "new StepResponse(void 0, ids)", "new StepResponse(void 0, [])"],
    ["step", "if (!prevIds?.length)", "if (false)"],
    ["step", "if (!prevIds?.length)", "if (!prevIds)"],
    ["step", "(Modules.TAX)\n\n    await service.restoreTaxRates", '("other")\n\n    await service.restoreTaxRates'],
    ["step", "service.restoreTaxRates(prevIds)", "service.restoreTaxRates([])"],
    ["step", "service.restoreTaxRates(prevIds)", "service.restoreTaxRates([...new Set(prevIds)])"],
    ["step", "service.restoreTaxRates(prevIds)", "service.restoreTaxRateRules(prevIds)"],
    ["step", "await service.restoreTaxRates(prevIds)", "service.restoreTaxRates(prevIds)"],
    ["step", "import type { ITaxModuleService }", "import { ITaxModuleService }"],
    ["step", '@medusajs/types/tax/index"', '@medusajs/types"'],
    ["step", '@medusajs/framework/utils/portable"', '@medusajs/framework/utils"'],
  ])("refuses changed %s source: %s", (key, before, after) => {
    const original = (key === "workflow" ? workflow : step).replaceAll("\r\n", "\n");
    // The step has two resolver sites; replace selects the first, forward one.
    // Every other control must identify exactly one mutation anchor.
    expect(original.split(before).length).toBe(before === "    const service = container.resolve" ? 3 : 2);
    const changed = original.replace(before, after);
    expect(changed).not.toBe(original);
    expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, key === "workflow" ? changed : workflow,
      nativeStep, key === "step" ? changed : step)).toThrow(failure);
  });
  it("refuses restore resolution before the empty-inverse guard", () => {
    const source = step.replaceAll("\r\n", "\n");
    const before = "  async (prevIds, { container }) => {\n    if (!prevIds?.length)";
    expect(source.split(before)).toHaveLength(2);
    const changed = source.replace(before,
      "  async (prevIds, { container }) => {\n    container.resolve<ITaxModuleService>(Modules.TAX)\n    if (!prevIds?.length)");
    expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow, nativeStep, changed)).toThrow(failure);
  });
  it("refuses appended execution, declarations and invalid syntax", () => {
    for (const suffix of ['\nthrow new Error("extra");', "\nexport type AddedContract = string", "\nconst invalid = ;"]) {
      expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow + suffix, nativeStep, step)).toThrow(failure);
      expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow, nativeStep, step + suffix)).toThrow(failure);
    }
  });
  it("refuses missing, repeated and redirected native adaptation anchors", () => {
    for (const changed of [nativeWorkflow.replace('from "../steps"', 'from "../other"'),
      nativeWorkflow + '\nimport { other } from "../steps"',
      nativeWorkflow.replace("  createWorkflow,", "  createWorkflow: other,"),
      nativeWorkflow.replace("WorkflowResponse<void>", "WorkflowResponse<unknown>")]) {
      expect(() => verifyTaxRateDeletionCallbacks(changed, workflow, nativeStep, step)).toThrow(failure);
    }
    expect(() => verifyTaxRateDeletionCallbacks(nativeWorkflow, workflow,
      nativeStep.replace("  deleteTaxRatesStepId,", "  otherStepId,"), step)).toThrow(failure);
  });
  it("refuses missing, duplicate, redirected, reclassified and adjacent source-pair selections", () => {
    for (const files of [[], [workflowPair], [stepPair], [...taxRateDeletionSourcePairs, workflowPair],
      [...taxRateDeletionSourcePairs, stepPair],
      [{ ...workflowPair, source: stepPair.source }, stepPair],
      [{ ...workflowPair, classification: "importRelocation" }, stepPair],
      [{ target: workflowPair.target, classification: workflowPair.classification }, stepPair],
      [...taxRateDeletionSourcePairs, { ...workflowPair, target: workflowPair.target + ".adjacent" }],
      [...taxRateDeletionSourcePairs, { ...workflowPair, source: workflowPair.source + ".adjacent" }],
      [...taxRateDeletionSourcePairs, { ...workflowPair, source: "other/source.ts", target: "other/target.ts" }],
      [...taxRateDeletionSourcePairs, { ...workflowPair, classification: "unchanged" }]]) {
      expect(() => verifyTaxRateDeletionSelection(files)).toThrow(failure);
    }
  });
});
