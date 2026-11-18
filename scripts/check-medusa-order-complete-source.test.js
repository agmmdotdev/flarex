// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderCompleteSourcePairs, verifyOrderCompleteSourceSelection, verifyOrderCompleteSource,
  verifyOrderCompleteFiles } from "./check-medusa-order-complete-source.mjs";

const failure = "Changed native Order completion source";
const selected = orderCompleteSourcePairs.map(pair => ({ ...pair,
  native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
const step = selected[0], workflow = selected[1];

describe("bounded native Order completion source", () => {
  it("authenticates both original source hashes before comparison", () => {
    expect(verifyOrderCompleteFiles(process.cwd())).toEqual({ sourcePairs: 2 });
    expect(() => verifyOrderCompleteSourceSelection(orderCompleteSourcePairs)).not.toThrow();
  });
  it.each(orderCompleteSourcePairs)("requires exactly the named pair $target", pair => {
    for (const files of [orderCompleteSourcePairs.filter(entry => entry !== pair), [...orderCompleteSourcePairs, pair],
      orderCompleteSourcePairs.map(entry => entry === pair ? { ...pair, classification: "unchanged" } : entry),
      orderCompleteSourcePairs.map(entry => entry === pair ? { ...pair, source: pair.source + ".other" } : entry),
      orderCompleteSourcePairs.map(entry => entry === pair ? { ...pair, target: pair.target + ".other" } : entry)])
      expect(() => verifyOrderCompleteSourceSelection(files)).toThrow(failure);
  });
  it("does not extend completion classification to adjacent sources", () => {
    for (const name of ["archive-orders", "cancel-orders", "create-order", "complete-cart"])
      expect(() => verifyOrderCompleteSourceSelection([...orderCompleteSourcePairs, {
        source: `third_party/medusa/upstream/packages/core/core-flows/src/order/workflows/${name}.ts`,
        target: `packages/medusa-core-flows/src/order/workflows/${name}.ts`, classification: "orderCompleteFork",
      }])).toThrow(failure);
    expect(() => verifyOrderCompleteSource("", "", "packages/medusa-core-flows/src/order/steps/cancel-orders.ts")).toThrow(failure);
    expect(() => verifyOrderCompleteSourceSelection([...orderCompleteSourcePairs, {
      target: "packages/medusa-core-flows/src/order/workflows/archive-orders.ts", classification: "orderArchiveFork",
    }])).not.toThrow();
  });
  it.each(selected)("preserves complete source bytes in $target", pair => {
    expect(() => verifyOrderCompleteSource(pair.native, pair.actual, pair.target)).not.toThrow();
    expect(() => verifyOrderCompleteSource(pair.native, pair.actual + "\nexport const extra = true\n", pair.target)).toThrow(failure);
    expect(() => verifyOrderCompleteSource(pair.native, pair.actual.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"), pair.target)).not.toThrow();
  });
  it.each([
    ["service.completeOrder(data.orderIds)", "service.completeOrder([])"],
    ['select: ["id", "status"]', 'select: ["id"]'],
    ["status: prevData.status", "status: order.status"],
    ["orders.find((o) => o.id === order.id)!", "orders[0]"],
    ["service.updateOrders(completed)", "service.completeOrder(completed.map(order => order.id))"],
    ["if (!completed?.length)", "if (completed?.length)"],
    ['compensation: "transactionCovered"', 'compensation: "none"'],
    ["orderIds: string[]", "orderIds: unknown[]"],
    ['from "@medusajs/workflows-sdk"', 'from "@medusajs/framework/workflows-sdk"'],
  ])("refuses changed completion step %s", (before, after) => {
    const changed = step.actual.replace(before, after); expect(changed).not.toBe(step.actual);
    expect(() => verifyOrderCompleteSource(step.native, changed, step.target)).toThrow(failure);
  });
  it.each([
    ["eventName: OrderWorkflowEvents.COMPLETED", "eventName: 'order.updated'"],
    ["data.input.orderIds.map((id) => ({ id }))", "[]"],
    ['createHook("ordersCompleted"', 'createHook("ordersArchived"'],
    ["orders: completedOrders", "orders: []"],
    ["additional_data: input.additional_data", "additional_data: undefined"],
    ["hooks: [ordersCompleted]", "hooks: []"],
    ["new WorkflowResponse(completedOrders", "new WorkflowResponse([]"],
    ['from "../steps/complete-orders"', 'from "../steps"'],
    ["    emitEventStep({", "    completeOrdersStep(input)\n    emitEventStep({"],
    ["} & AdditionalData", "}"],
  ])("refuses changed completion workflow %s", (before, after) => {
    const changed = workflow.actual.replace(before, after); expect(changed).not.toBe(workflow.actual);
    expect(() => verifyOrderCompleteSource(workflow.native, changed, workflow.target)).toThrow(failure);
  });
});
