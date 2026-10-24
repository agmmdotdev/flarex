// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyTaxRegionCreateCallbacks } from "./check-medusa-test-port.mjs";
import { tax170SourcePairs, verifyTax170SourceSelection } from "./check-medusa-currency-promotion.mjs";

const prefix = "third_party/medusa/upstream/packages/core/core-flows/src/tax/";
const target = "packages/medusa-core-flows/src/tax/";
const nativeWorkflow = readFileSync(prefix + "workflows/create-tax-regions.ts", "utf8");
const workflow = readFileSync(target + "workflows/create-tax-regions.ts", "utf8");
const nativeStep = readFileSync(prefix + "steps/create-tax-regions.ts", "utf8");
const step = readFileSync(target + "steps/create-tax-regions.ts", "utf8");
const failure = "Changed native Tax Region creation source";

describe("native Tax Region creation source", () => {
  it("retains the complete root, both callbacks, types and exact source selection", () => {
    expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, workflow, nativeStep, step)).not.toThrow();
    expect(() => verifyTax170SourceSelection(tax170SourcePairs)).not.toThrow();
    expect(() => verifyTax170SourceSelection([...tax170SourcePairs,
      { target: "unrelated/target.ts", classification: "authored" }])).not.toThrow();
  });
  it("permits erased comments without changing the callback modules", () => {
    expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, workflow + "\n// unchanged\n",
      nativeStep, step + "\n// unchanged\n")).not.toThrow();
  });
  it.each([
    ["workflow", "CreateTaxRegionDTO[]", "readonly CreateTaxRegionDTO[]"],
    ["workflow", "CreateTaxRegionsWorkflowOutput = TaxRegionDTO[]", "CreateTaxRegionsWorkflowOutput = readonly TaxRegionDTO[]"],
    ["workflow", 'createTaxRegionsWorkflowId = "create-tax-regions"', 'createTaxRegionsWorkflowId = "other"'],
    ["workflow", "new WorkflowResponse(createTaxRegionsStep(input))", "new WorkflowResponse([])"],
    ["workflow", "createTaxRegionsStep(input)", "createTaxRegionsStep([])"],
    ["workflow", "createTaxRegionsStep(input)", "input.length ? createTaxRegionsStep(input) : []"],
    ["workflow", "WorkflowResponse<CreateTaxRegionsWorkflowOutput>", "WorkflowResponse<unknown>"],
    ["workflow", 'from "../steps/create-tax-regions"', 'from "../steps/create-tax-rates"'],
    ["workflow", "import type { CreateTaxRegionDTO", "import { CreateTaxRegionDTO"],
    ["step", "import type {", "import {"],
    ["step", 'createTaxRegionsStepId = "create-tax-regions"', 'createTaxRegionsStepId = "other"'],
    ["step", 'compensation: "transactionCovered"', 'compensation: "uncovered"'],
    ["step", 'compensation: "transactionCovered"', 'compensation: "transactionCovered", retries: 2'],
    ["step", "async (data: CreateTaxRegionDTO[]", "async (data: readonly CreateTaxRegionDTO[]"],
    ["step", "    const created = await service.createTaxRegions(data)", "    const created = await service.createTaxRegions([])"],
    ["step", "    const created = await service.createTaxRegions(data)", "    if (!data.length) return new StepResponse([], [])\n    const created = await service.createTaxRegions(data)"],
    ["step", "await service.createTaxRegions(data)", "service.createTaxRegions(data)"],
    ["step", "created.map((region) => region.id)", "created.map((region) => region.country_code)"],
    ["step", "if (!createdIds?.length)", "if (!createdIds)"],
    ["step", "if (!createdIds?.length)", "if (false)"],
    ["step", "await service.deleteTaxRegions(createdIds)", "await service.softDeleteTaxRegions(createdIds)"],
    ["step", "await service.deleteTaxRegions(createdIds)", "await service.deleteTaxRegions([])"],
    ["step", "await service.deleteTaxRegions(createdIds)", "await service.deleteTaxRegions([...new Set(createdIds)])"],
    ["step", "await service.deleteTaxRegions(createdIds)", "service.deleteTaxRegions(createdIds)"],
    ["step", '@medusajs/types/tax/index"', '@medusajs/types"'],
    ["step", '@medusajs/framework/utils/portable"', '@medusajs/framework/utils"'],
  ])("refuses changed %s source: %s", (key, before, after) => {
    const selected = (key === "workflow" ? workflow : step).replaceAll("\r\n", "\n");
    expect(selected.split(before).length).toBe(2);
    const changed = selected.replace(before, after);
    expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, key === "workflow" ? changed : workflow,
      nativeStep, key === "step" ? changed : step)).toThrow(failure);
  });
  it("retains resolver identity for both callbacks and rejects extra runtime/types", () => {
    expect(step.split("(Modules.TAX)").length).toBe(3);
    for (const callback of [0, 1]) {
      let seen = 0;
      const changed = step.replaceAll("(Modules.TAX)", () => seen++ === callback ? '("other")' : "(Modules.TAX)");
      expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, workflow, nativeStep, changed)).toThrow(failure);
    }
    for (const extra of ['\nexport const extra = 1\n', '\nexport type Extra = string\n', '\nthrow new Error("extra")\n']) {
      expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, workflow + extra, nativeStep, step)).toThrow(failure);
      expect(() => verifyTaxRegionCreateCallbacks(nativeWorkflow, workflow, nativeStep, step + extra)).toThrow(failure);
    }
  });
  it("refuses missing, duplicate, redirected, reclassified and adjacent source pairs", () => {
    for (const pair of tax170SourcePairs) {
      expect(() => verifyTax170SourceSelection(tax170SourcePairs.filter(item => item !== pair))).toThrow();
      expect(() => verifyTax170SourceSelection([...tax170SourcePairs, pair])).toThrow();
      for (const patch of [{ source: "adjacent/source.ts" }, { target: pair.target.replace(".ts", "-adjacent.ts") },
        { classification: "importRelocation" }, { source: undefined, classification: "authored" }]) {
        expect(() => verifyTax170SourceSelection(tax170SourcePairs.map(item => item === pair ? { ...item, ...patch } : item))).toThrow();
      }
      expect(() => verifyTax170SourceSelection([...tax170SourcePairs,
        { ...pair, source: "adjacent/source.ts", target: "adjacent/target.ts" }])).toThrow();
    }
  });
});
