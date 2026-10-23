// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderArchiveSourcePairs, orderArchiveAuthoredTargets, verifyOrderArchiveSourceSelection,
  verifyOrderArchiveSource, verifyOrderArchiveFiles } from "./check-medusa-order-archive-source.mjs";

const failure = "Changed native Order archive source";
/** @param {string} target */
function entry(target) {
  const pair = orderArchiveSourcePairs.find(pair => pair.target === target);
  if (pair === undefined) throw new Error("Missing Order archive source pair");
  return { ...pair, native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") };
}
const step = entry("packages/medusa-core-flows/src/order/steps/archive-orders.ts");
const workflow = entry("packages/medusa-core-flows/src/order/workflows/archive-orders.ts");
const joiner = entry("packages/medusa-order/src/joiner-config.ts");

describe("bounded native Order source preparation", () => {
  it("authenticates all original source hashes before standalone source verification", () => {
    expect(verifyOrderArchiveFiles(process.cwd())).toEqual({ sourcePairs: 95 });
  });
  it("selects the exact module, pure helpers and archive pair", () => {
    expect(orderArchiveSourcePairs).toHaveLength(95);
    expect(orderArchiveSourcePairs.filter(pair => pair.target.startsWith("packages/medusa-order/src/"))).toHaveLength(86);
    expect(() => verifyOrderArchiveSourceSelection(orderArchiveSourcePairs)).not.toThrow();
    // Other modules share the license source; they do not expand Order authority.
    expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs, {
      source: "third_party/medusa/upstream/LICENSE", target: "packages/medusa-cart/LICENSE", classification: "unchanged",
    }])).not.toThrow();
    expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs,
      ...orderArchiveAuthoredTargets.map(target => ({ target, classification: "authored" }))])).not.toThrow();
    for (const file of [
      { target: "packages/medusa-order/src/extra.ts", classification: "authored" },
      { target: "packages/medusa-order/package.json", source: "third_party/medusa/upstream/packages/modules/order/package.json", classification: "unchanged" },
      { target: "packages/medusa-order/tsconfig.json", classification: "orderArchiveFork" },
    ]) expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs, file])).toThrow(failure);
  });

  it("refuses omitted, repeated, relabeled and redirected pairs", () => {
    for (const pair of orderArchiveSourcePairs) {
      expect(() => verifyOrderArchiveSourceSelection(orderArchiveSourcePairs.filter(selected => selected !== pair))).toThrow(failure);
      expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs, pair])).toThrow(failure);
      expect(() => verifyOrderArchiveSourceSelection(orderArchiveSourcePairs.map(selected => selected === pair
        ? { ...pair, classification: "authored" } : selected))).toThrow(failure);
      expect(() => verifyOrderArchiveSourceSelection(orderArchiveSourcePairs.map(selected => selected === pair
        ? { ...pair, source: pair.source + ".other" } : selected))).toThrow(failure);
    }
    expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs, { ...step,
      target: "packages/medusa-core-flows/src/other.ts" }])).toThrow(failure);
  });

  it.each([
    ["packages/modules/order/src/index.ts", "packages/medusa-order/src/index.ts"],
    ["packages/modules/order/src/repositories/order.ts", "packages/medusa-order/src/repositories/order.ts"],
    ["packages/modules/order/src/migrations/Migration20250101.ts", "packages/medusa-order/src/migrations/Migration20250101.ts"],
    ["packages/modules/order/src/utils/base-repository-find.ts", "packages/medusa-order/src/utils/base-repository-find.ts"],
    ["packages/modules/order/src/utils/apply-mikro-orm-decorators.ts", "packages/medusa-order/src/utils/apply-mikro-orm-decorators.ts"],
    ["packages/modules/order/src/models/__tests__/order.spec.ts", "packages/medusa-order/src/models/__tests__/order.spec.ts"],
    ["packages/core/core-flows/src/order/workflows/create-order.ts", "packages/medusa-core-flows/src/order/workflows/create-order.ts"],
    ["packages/core/utils/src/order/extra.ts", "packages/medusa-utils/src/order/extra.ts"],
    ["packages/modules/order/src/repositories/order.ts", "packages/medusa-adapter/src/copied-order-repository.ts"],
  ])("refuses wider native closure %s", (source, target) => {
    expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs,
      { source: "third_party/medusa/upstream/" + source, target, classification: "unchanged" }])).toThrow(failure);
  });

  it("refuses forged fork labels and unknown source verification", () => {
    expect(() => verifyOrderArchiveSourceSelection([...orderArchiveSourcePairs,
      { target: "packages/medusa-utils/src/other.ts", classification: "orderArchiveFork" }])).toThrow(failure);
    expect(() => verifyOrderArchiveSource("", "", "packages/medusa-order/src/repositories/order.ts")).toThrow(failure);
  });

  it.each(orderArchiveSourcePairs)("preserves all selected source bytes in $target", pair => {
    const selected = entry(pair.target);
    expect(() => verifyOrderArchiveSource(selected.native, selected.actual, pair.target)).not.toThrow();
    expect(() => verifyOrderArchiveSource(selected.native, selected.actual + "\nexport const unauthorized = true\n", pair.target)).toThrow(failure);
  });

  it.each([
    ["packages/medusa-order/src/services/order-module-service.ts", "status: OrderStatus.ARCHIVED", "status: OrderStatus.COMPLETED"],
    ["packages/medusa-order/src/services/order-module-service.ts", "const orders = await this.archive_(orderId, sharedContext)", "const orders = await this.archive_(orderId, {})"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "service.archive(data.orderIds)", "service.archive([])"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "status: order.status", "status: 'pending'"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "const previousOrders = await service.listOrders(", "const previousOrders = await service.archive("],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", '{ select: ["id", "status"] }', '{ select: ["id"] }'],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "new StepResponse(archived, previousStatuses)", "new StepResponse(archived, archived)"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "if (!archived?.length)", "if (archived?.length)"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "service.updateOrders(archived)", "service.archive(archived.map(order => order.id))"],
    ["packages/medusa-core-flows/src/order/steps/archive-orders.ts", "compensation: \"transactionCovered\"", "compensation: \"none\""],
    ["packages/medusa-core-flows/src/order/workflows/archive-orders.ts", "eventName: OrderWorkflowEvents.ARCHIVED", "eventName: 'order.updated'"],
    ["packages/medusa-core-flows/src/order/workflows/archive-orders.ts", "data.input.orderIds.map((id) => ({ id }))", "[]"],
    ["packages/medusa-core-flows/src/order/workflows/archive-orders.ts", "new WorkflowResponse(archiveOrdersStep(input))", "new WorkflowResponse([])"],
  ])("refuses changed archive behavior in %s", (target, before, after) => {
    const selected = entry(target), changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyOrderArchiveSource(selected.native, changed, target)).toThrow(failure);
  });

  it("preserves erased contracts, exact leaf imports and native event order", () => {
    for (const changed of [step.actual.replace("orderIds: string[]", "orderIds: unknown[]"),
      step.actual.replace('from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"')])
      expect(() => verifyOrderArchiveSource(step.native, changed, step.target)).toThrow(failure);
    for (const changed of [workflow.actual.replace('from "../steps/archive-orders"', 'from "../steps"'),
      workflow.actual.replace('from "@medusajs/framework/utils/portable"', 'from "@medusajs/framework/utils"'),
      workflow.actual.replace("    emitEventStep({", "    archiveOrdersStep(input)\n    emitEventStep({")])
      expect(() => verifyOrderArchiveSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });

  it("retains the original faulty inverse as an explicit business-fork witness", () => {
    expect(step.classification).toBe("orderArchiveCompensationFork");
    expect(step.native).not.toContain("service.listOrders(");
    expect(step.native).toContain("archived.map((store)");
    expect(step.native).toContain("status: store.status");
    expect(() => verifyOrderArchiveSource(step.native, step.native, step.target)).toThrow(failure);
    const reordered = step.actual.replace("    const archived = await service.archive(data.orderIds)\n", "")
      .replace("    const previousStatuses = previousOrders.map", "    const archived = await service.archive(data.orderIds)\n    const previousStatuses = previousOrders.map");
    expect(reordered).not.toBe(step.actual);
    expect(() => verifyOrderArchiveSource(step.native, reordered, step.target)).toThrow(failure);
    expect(() => verifyOrderArchiveSourceSelection(orderArchiveSourcePairs.map(pair => pair.target === step.target
      ? { ...pair, classification: "orderArchiveFork" } : pair))).toThrow(failure);
  });

  it("allows only the native portable joiner builder seam", () => {
    for (const changed of [joiner.actual.replace("defineJoinerConfigFromModels(Modules.ORDER", "defineJoinerConfig(Modules.ORDER"),
      joiner.actual.replace('claim_id: "OrderClaim"', 'claim_id: "Order"'),
      joiner.actual.replace("    ReturnReason,", "    ReturnReason,\n    OrderCreditLine,"),
      joiner.actual.replace('"@medusajs/utils/modules-sdk/portable-joiner-config-builder"', '"@medusajs/utils"')]) {
      expect(changed).not.toBe(joiner.actual);
      expect(() => verifyOrderArchiveSource(joiner.native, changed, joiner.target)).toThrow(failure);
    }
  });

  it("permits newline normalization without broad source normalization", () => {
    expect(() => verifyOrderArchiveSource(step.native.replaceAll("\r\n", "\n"),
      step.actual.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), step.target)).not.toThrow();
  });
});
