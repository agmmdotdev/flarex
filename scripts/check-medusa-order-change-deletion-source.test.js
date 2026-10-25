// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderChangeDeletionSourcePairs, verifyOrderChangeDeletionSourceSelection, verifyOrderChangeDeletionSource,
  verifyOrderChangeDeletionFiles } from "./check-medusa-order-change-deletion-source.mjs";

const failure = "Changed native Order Change deletion source";
const selected = orderChangeDeletionSourcePairs.map(pair => ({ ...pair,
  native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
const step = selected[0], workflow = selected[1];

describe("bounded native Order Change deletion source", () => {
  it("authenticates both original source hashes before comparing the complete native pair", () => {
    expect(verifyOrderChangeDeletionFiles(process.cwd())).toEqual({ sourcePairs: 2 });
    expect(() => verifyOrderChangeDeletionSourceSelection(orderChangeDeletionSourcePairs)).not.toThrow();
  });
  it.each(orderChangeDeletionSourcePairs)("requires exactly the named pair $target", pair => {
    for (const files of [orderChangeDeletionSourcePairs.filter(entry => entry !== pair), [...orderChangeDeletionSourcePairs, pair],
      orderChangeDeletionSourcePairs.map(entry => entry === pair ? { ...pair, classification: "unchanged" } : entry),
      orderChangeDeletionSourcePairs.map(entry => entry === pair ? { ...pair, source: pair.source + ".other" } : entry),
      orderChangeDeletionSourcePairs.map(entry => entry === pair ? { ...pair, target: pair.target + ".other" } : entry),
      [...orderChangeDeletionSourcePairs, { ...pair, target: pair.target + ".other" }]])
      expect(() => verifyOrderChangeDeletionSourceSelection(files)).toThrow(failure);
  });
  it("does not admit adjacent Order roots, action deletion or forged classifications", () => {
    for (const name of ["delete-order-change-actions", "cancel-order-change", "request-order-change", "update-order-changes"])
      expect(() => verifyOrderChangeDeletionSourceSelection([...orderChangeDeletionSourcePairs, {
        source: `third_party/medusa/upstream/packages/core/core-flows/src/order/workflows/${name}.ts`,
        target: `packages/medusa-core-flows/src/order/workflows/${name}.ts`, classification: "orderChangeDeletionFork",
      }])).toThrow(failure);
    expect(() => verifyOrderChangeDeletionSource("", "", "packages/medusa-core-flows/src/order/steps/delete-order-change-actions.ts")).toThrow(failure);
  });
  it.each(selected)("preserves the complete source bytes of $target", pair => {
    expect(() => verifyOrderChangeDeletionSource(pair.native, pair.actual, pair.target)).not.toThrow();
    expect(() => verifyOrderChangeDeletionSource(pair.native, pair.actual + "\nexport const extra = true\n", pair.target)).toThrow(failure);
    expect(() => verifyOrderChangeDeletionSource(pair.native, pair.actual.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), pair.target)).not.toThrow();
    expect(() => verifyOrderChangeDeletionSource(pair.native + "\n", pair.actual, pair.target)).toThrow(failure);
  });
  it.each([
    ["import type { IOrderModuleService }", "import type { UnknownOrderService }"],
    ['from "@medusajs/framework/types"', 'from "other-types"'],
    ['from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'],
    ['from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"'],
    ["interface DeleteOrderChangesStepInput", "interface OtherStepInput"],
    ["ids: string[]", "ids: unknown[]"],
    ['deleteOrderChangesStepId = "delete-order-change"', 'deleteOrderChangesStepId = "other"'],
    ['compensation: "transactionCovered"', 'compensation: "none"'],
    ['{ name: deleteOrderChangesStepId, compensation: "transactionCovered" }', "deleteOrderChangesStepId"],
    ["async (data: DeleteOrderChangesStepInput, { container })", "async (data: unknown, { container })"],
    ["container.resolve<IOrderModuleService>(Modules.ORDER)", "container.resolve<IOrderModuleService>(Modules.PAYMENT)"],
    ["service.softDeleteOrderChanges(data.ids)", "service.softDeleteOrderChanges([])"],
    ["new StepResponse(deleted, data.ids)", "new StepResponse(undefined, data.ids)"],
    ["new StepResponse(deleted, data.ids)", "new StepResponse(deleted, deleted)"],
    ["new StepResponse(deleted, data.ids)", "new StepResponse(deleted, [...new Set(data.ids)])"],
    ["async (ids, { container })", "async (ids, _context)"],
    ["if (!ids)", "if (!ids?.length)"],
    ["if (!ids)", "if (ids)"],
    ["service.restoreOrderChanges(ids)", "service.restoreOrderChanges([])"],
    ["service.restoreOrderChanges(ids)", "service.updateOrderChanges(ids)"],
    ["await service.restoreOrderChanges(ids)", "return"],
  ])("refuses changed native deletion step %s", (before, after) => {
    const changed = step.actual.replace(before, after); expect(changed).not.toBe(step.actual);
    expect(() => verifyOrderChangeDeletionSource(step.native, changed, step.target)).toThrow(failure);
  });
  it.each([
    ['from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"'],
    ['from "../steps/delete-order-changes"', 'from "../steps"'],
    ["type DeleteOrderChangeWorkflowInput", "type OtherWorkflowInput"],
    ["ids: string[]", "ids?: string[]"],
    ['deleteOrderChangeWorkflowId = "delete-order-change"', 'deleteOrderChangeWorkflowId = "other"'],
    ["WorkflowData<DeleteOrderChangeWorkflowInput>", "WorkflowData<unknown>"],
    ["): void => {", "): WorkflowData<void> => {"],
    ["deleteOrderChangesStep(input)", "deleteOrderChangesStep({ ids: [] })"],
    ["    deleteOrderChangesStep(input)", "    return deleteOrderChangesStep(input)"],
  ])("refuses changed native deletion root %s", (before, after) => {
    const changed = workflow.actual.replace(before, after); expect(changed).not.toBe(workflow.actual);
    expect(() => verifyOrderChangeDeletionSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });
  it("preserves both callback service resolutions and their original execution order", () => {
    const normalized = step.actual.replaceAll("\r\n", "\n");
    expect(normalized.split("container.resolve<IOrderModuleService>(Modules.ORDER)")).toHaveLength(3);
    const changed = normalized.replace("    await service.restoreOrderChanges(ids)", "    await service.softDeleteOrderChanges(ids)");
    expect(changed).not.toBe(normalized);
    expect(() => verifyOrderChangeDeletionSource(step.native, changed, step.target)).toThrow(failure);
    const reordered = normalized.replace("    const deleted = await service.softDeleteOrderChanges(data.ids)\n\n    return new StepResponse(deleted, data.ids)",
      "    return new StepResponse(await service.softDeleteOrderChanges(data.ids), data.ids)");
    expect(reordered).not.toBe(normalized);
    expect(() => verifyOrderChangeDeletionSource(step.native, reordered, step.target)).toThrow(failure);
  });
  it("preserves the original branded void annotation as provenance while transporting its erased void type", () => {
    expect(workflow.native).toContain("): WorkflowData<void> => {");
    expect(workflow.actual).toContain("): void => {");
    expect(workflow.native).toContain("    deleteOrderChangesStep(input)");
    expect(workflow.actual).toContain("    deleteOrderChangesStep(input)");
  });
  it("normalizes only the three pinned blank documentation lines", () => {
    expect((workflow.native.replaceAll("\r\n", "\n").match(/^ \* $/gm) ?? [])).toHaveLength(3);
    expect(workflow.actual.replaceAll("\r\n", "\n")).not.toMatch(/^ \* $/m);
    const changed = workflow.actual.replace(" *\n", " * \n");
    expect(changed).not.toBe(workflow.actual);
    expect(() => verifyOrderChangeDeletionSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });
});
