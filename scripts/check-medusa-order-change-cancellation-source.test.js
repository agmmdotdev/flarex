// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderChangeCancellationSourcePairs, verifyOrderChangeCancellationSource,
  verifyOrderChangeCancellationSourceSelection, verifyOrderChangeCancellationFiles } from "./check-medusa-order-change-cancellation-source.mjs";

const failure = "Changed approved native Order Change cancellation source";
const entries = orderChangeCancellationSourcePairs.map(pair => ({ ...pair,
  original: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
/** @param {string} suffix */
function entry(suffix) {
  const selected = entries.find(pair => pair.target.endsWith(suffix));
  if (selected === undefined) throw new Error("Missing cancellation source pair");
  return selected;
}

describe("approved native Order Change cancellation correction", () => {
  it("authenticates the seven exact original/promoted pairs and preserves the original failing inverse", () => {
    expect(verifyOrderChangeCancellationFiles(process.cwd())).toEqual({ sourcePairs: 7 });
    expect(() => verifyOrderChangeCancellationSourceSelection(orderChangeCancellationSourcePairs)).not.toThrow();
    const step = entry("/steps/cancel-order-change.ts");
    expect(step.original).not.toContain('"status",');
    expect(step.original).toContain("service.updateOrderChanges(rollbackData as UpdateOrderChangeDTO)");
    expect(() => verifyOrderChangeCancellationSource(step.original, step.original, step.target)).toThrow(failure);
  });
  it.each([
    ["/steps/cancel-order-change.ts", '"id", "status", "canceled_at", "canceled_by"', '"id", "canceled_at", "canceled_by"'],
    ["/steps/cancel-order-change.ts", 'Object.prototype.hasOwnProperty.call(data, "metadata")', 'true'],
    ["/steps/cancel-order-change.ts", '...(hasMetadata ? ["metadata"] : [])', '"metadata"'],
    ["/steps/cancel-order-change.ts", 'relations: []', 'relations: ["actions"]'],
    ["/steps/cancel-order-change.ts", 'status: previous.status', 'status: "canceled"'],
    ["/steps/cancel-order-change.ts", 'canceled_at: previous.canceled_at', 'canceled_at: null'],
    ["/steps/cancel-order-change.ts", 'const preimage = structuredClone(retained)', 'const preimage = retained'],
    ["/steps/cancel-order-change.ts", 'structuredClone(rollbackData)', 'rollbackData'],
    ["/steps/cancel-order-change.ts", 'service.restoreOrderChangeCancellation(', 'service.updateOrderChanges('],
    ["/steps/cancel-order-change.ts", 'compensation: "transactionCovered"', 'compensation: "uncovered"'],
    ["/steps/cancel-order-change.ts", 'new StepResponse(void 0, preimage)', 'new StepResponse(preimage, preimage)'],
    ["/workflows/cancel-order-change.ts", 'cancelOrderChangeStep(input)', 'cancelOrderChangeStep({ id: "other" })'],
    ["/workflows/cancel-order-change.ts", '../steps/cancel-order-change', '../steps'],
    ["/workflows/cancel-order-change.ts", '): void => {', '): WorkflowData<void> => {'],
    ["/workflows/cancel-order-change.ts", 'WorkflowData<CancelOrderChangeDTO>', 'WorkflowData<unknown>'],
    ["/order/mutations.ts", 'status: string | null', 'status?: string'],
    ["/order/mutations.ts", 'canceled_at: Date | string | null', 'canceled_at: Date'],
    ["/order/service.ts", 'data: RestoreOrderChangeCancellationDTO', 'data: UpdateOrderChangeDTO'],
    ["/dal/repository-service.ts", 'metadata?: "merge" | "replace"', 'metadata?: "replace"'],
    ["/modules-sdk/medusa-internal-service.ts", 'options?: UpdateOptions', 'options: UpdateOptions'],
    ["/services/order-module-service.ts", '{ metadata: "replace" }', '{ metadata: "merge" }'],
    ["/services/order-module-service.ts", 'const restored = await this.orderChangeService_.update(', 'const restored = await this.orderChangeService_.upsert('],
    ["/services/order-module-service.ts", 'canceled_by: data.canceled_by', 'canceled_by: null'],
    ["/services/order-module-service.ts", 'return await this.baseRepository_.serialize<OrderChangeDTO>(restored)', 'return restored'],
  ])("refuses changed correction %s %s", (suffix, before, after) => {
    const selected = entry(suffix);
    expect(selected.actual).toContain(before);
    const changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyOrderChangeCancellationSource(selected.original, changed, selected.target)).toThrow(failure);
  });
  it("clones the retained fields before cancellation can mutate native entities", () => {
    const step = entry("/steps/cancel-order-change.ts");
    const changed = step.actual.replace('    const preimage = structuredClone(retained)\n', '')
      .replace('    await service.cancelOrderChange(data)', '    await service.cancelOrderChange(data)\n    const preimage = structuredClone(retained)');
    expect(changed).not.toBe(step.actual);
    expect(() => verifyOrderChangeCancellationSource(step.original, changed, step.target)).toThrow(failure);
  });
  it("rejects appended runtime and edits outside the named inverse method in every native module", () => {
    for (const selected of entries) {
      expect(() => verifyOrderChangeCancellationSource(selected.original, selected.actual + '\nthrow new Error("extra")\n', selected.target)).toThrow(failure);
    }
    const service = entry("/services/order-module-service.ts");
    const changed = service.actual.replace('await this.getAndValidateOrderChange_(orderChangeIds, false, sharedContext)',
      'await this.getAndValidateOrderChange_(orderChangeIds, true, sharedContext)');
    expect(changed).not.toBe(service.actual);
    expect(() => verifyOrderChangeCancellationSource(service.original, changed, service.target)).toThrow(failure);
  });
  it("rejects source-anchor drift and any missing, duplicate, redirected or reclassified pair", () => {
    const step = entry("/steps/cancel-order-change.ts");
    expect(() => verifyOrderChangeCancellationSource(step.original + '\n', step.actual, step.target)).toThrow(failure);
    for (const pair of orderChangeCancellationSourcePairs) {
      for (const files of [orderChangeCancellationSourcePairs.filter(selected => selected !== pair),
        [...orderChangeCancellationSourcePairs, pair],
        orderChangeCancellationSourcePairs.map(selected => selected === pair ? { ...pair, source: pair.source + ".other" } : selected),
        orderChangeCancellationSourcePairs.map(selected => selected === pair ? { ...pair, classification: "authored" } : selected),
        [...orderChangeCancellationSourcePairs, { ...pair, target: pair.target + ".other" }]])
        expect(() => verifyOrderChangeCancellationSourceSelection(files)).toThrow(failure);
    }
  });
});
