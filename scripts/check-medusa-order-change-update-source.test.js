// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderChangeUpdateSourcePairs, verifyOrderChangeUpdateSourceSelection, verifyOrderChangeUpdateSource,
  verifyOrderChangeUpdateFiles } from "./check-medusa-order-change-update-source.mjs";

const failure = "Changed native Order Change update source";
const selected = orderChangeUpdateSourcePairs.map(pair => ({ ...pair,
  native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
const step = selected[0], workflow = selected[1];

describe("bounded native Order Change update source", () => {
  it("authenticates both original source hashes before comparison", () => {
    expect(verifyOrderChangeUpdateFiles(process.cwd())).toEqual({ sourcePairs: 2 });
    expect(() => verifyOrderChangeUpdateSourceSelection(orderChangeUpdateSourcePairs)).not.toThrow();
  });
  it.each(orderChangeUpdateSourcePairs)("requires exactly the named pair $target", pair => {
    for (const files of [orderChangeUpdateSourcePairs.filter(entry => entry !== pair), [...orderChangeUpdateSourcePairs, pair],
      orderChangeUpdateSourcePairs.map(entry => entry === pair ? { ...pair, classification: "unchanged" } : entry),
      orderChangeUpdateSourcePairs.map(entry => entry === pair ? { ...pair, source: pair.source + ".other" } : entry),
      orderChangeUpdateSourcePairs.map(entry => entry === pair ? { ...pair, target: pair.target + ".other" } : entry)])
      expect(() => verifyOrderChangeUpdateSourceSelection(files)).toThrow(failure);
  });
  it("does not grant adjacent Order workflows or forged fork classifications", () => {
    for (const name of ["cancel-order-change", "update-order-change-actions", "complete-orders"])
      expect(() => verifyOrderChangeUpdateSourceSelection([...orderChangeUpdateSourcePairs, {
        source: `third_party/medusa/upstream/packages/core/core-flows/src/order/workflows/${name}.ts`,
        target: `packages/medusa-core-flows/src/order/workflows/${name}.ts`, classification: "orderChangeUpdateFork",
      }])).toThrow(failure);
    expect(() => verifyOrderChangeUpdateSource("", "", "packages/medusa-core-flows/src/order/steps/cancel-order-change.ts")).toThrow(failure);
  });
  it.each(selected)("preserves complete source bytes in $target", pair => {
    expect(() => verifyOrderChangeUpdateSource(pair.native, pair.actual, pair.target)).not.toThrow();
    expect(() => verifyOrderChangeUpdateSource(pair.native, pair.actual + "\nexport const extra = true\n", pair.target)).toThrow(failure);
    expect(() => verifyOrderChangeUpdateSource(pair.native, pair.actual.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), pair.target)).not.toThrow();
  });
  it.each([
    ["if (!data.length)", "if (data.length)"],
    ["new StepResponse([], [])", "new StepResponse([], undefined)"],
    ['objectFields: ["metadata"]', "objectFields: []"],
    ["{ id: data.map((d) => d.id) }", "{ id: [] }"],
    ["{ relations, select: selects }", "{}"],
    ["service.updateOrderChanges(data)", "service.updateOrderChanges([])"],
    ["new StepResponse(updated, dataBeforeUpdate)", "new StepResponse(updated, updated)"],
    ["if (!dataBeforeUpdate?.length)", "if (dataBeforeUpdate?.length)"],
    ["service.updateOrderChanges(dataBeforeUpdate as UpdateOrderChangeDTO[])", "service.updateOrderChanges([])"],
    ['compensation: "transactionCovered"', 'compensation: "none"'],
    ["UpdateOrderChangesStepInput = UpdateOrderChangeDTO[]", "UpdateOrderChangesStepInput = unknown[]"],
    ['from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"'],
  ])("refuses changed update step %s", (before, after) => {
    const changed = step.actual.replace(before, after); expect(changed).not.toBe(step.actual);
    expect(() => verifyOrderChangeUpdateSource(step.native, changed, step.target)).toThrow(failure);
  });
  it.each([
    ["WorkflowData<UpdateOrderChangeDTO[]>", "WorkflowData<UpdateOrderChangeActionDTO[]>"],
    ["WorkflowResponse<OrderChangeDTO[]>", "WorkflowResponse<unknown[]>"],
    ["new WorkflowResponse(updateOrderChangesStep(input))", "new WorkflowResponse([])"],
    ['from "../steps/update-order-changes"', 'from "../steps"'],
    ['updateOrderChangesWorkflowId = "update-order-change"', 'updateOrderChangesWorkflowId = "other"'],
  ])("refuses changed update workflow %s", (before, after) => {
    const changed = workflow.actual.replace(before, after); expect(changed).not.toBe(workflow.actual);
    expect(() => verifyOrderChangeUpdateSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });
  it("retains the erased native DTO typo as provenance without changing callbacks", () => {
    expect(workflow.native).toContain("WorkflowData<UpdateOrderChangeActionDTO[]>");
    expect(workflow.actual).toContain("WorkflowData<UpdateOrderChangeDTO[]>");
    expect(step.native).toContain("UpdateOrderChangesStepInput = UpdateOrderChangeDTO[]");
  });
  it("normalizes only the three pinned blank documentation lines", () => {
    expect((workflow.native.replaceAll("\r\n", "\n").match(/^ \* $/gm) ?? [])).toHaveLength(3);
    expect(workflow.actual.replaceAll("\r\n", "\n")).not.toMatch(/^ \* $/m);
    const changed = workflow.actual.replace(" *\n", " * \n");
    expect(changed).not.toBe(workflow.actual);
    expect(() => verifyOrderChangeUpdateSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });
});
