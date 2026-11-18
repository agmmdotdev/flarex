// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyOrderChangeCancellationSource } from "./check-medusa-order-change-cancellation-source.mjs";
import { adaptOrderChangeDeclineSource, orderChangeDeclineSourcePairs,
  verifyOrderChangeDeclineSource, verifyOrderChangeDeclineSharedSource,
  verifyOrderChangeDeclineSourceSelection, verifyOrderChangeDeclineProvenance,
  verifyOrderChangeDeclineFiles } from "./check-medusa-order-change-decline-source.mjs";

const failure = "Changed approved native Order Change decline source";
const canonicalFailure = "Changed approved native Order Change cancellation source";
const entries = orderChangeDeclineSourcePairs.map(pair => ({ ...pair,
  original: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") }));
/** @param {string} suffix */
function entry(suffix) {
  const selected = entries.find(pair => pair.target.endsWith(suffix));
  if (selected === undefined) throw new Error("Missing decline source pair");
  return selected;
}
/** @param {typeof entries[number]} selected @param {string} changed */
function verifyChanged(selected, changed) {
  if (selected.classification === "orderChangeDeclineFork")
    return verifyOrderChangeDeclineSource(selected.original, changed, selected.target);
  return verifyOrderChangeDeclineSharedSource(changed, selected.target);
}

describe("approved native Order Change decline correction", () => {
  it("authenticates pinned leaves and finite shared additions without duplicating the full class owner", () => {
    expect(verifyOrderChangeDeclineFiles(process.cwd())).toEqual({ sourcePairs: 5, standalonePairs: 2, composedPairs: 3 });
    expect(() => verifyOrderChangeDeclineSourceSelection(orderChangeDeclineSourcePairs)).not.toThrow();
    for (const selected of entries) {
      if (selected.classification === "orderChangeDeclineFork") {
        expect(() => verifyOrderChangeDeclineSource(selected.original, selected.actual, selected.target)).not.toThrow();
      } else {
        expect(() => verifyOrderChangeCancellationSource(selected.original, selected.actual, selected.target)).not.toThrow();
        expect(() => verifyOrderChangeDeclineSource(selected.original, selected.actual, selected.target)).toThrow("canonical composition");
        const prefix = verifyOrderChangeDeclineSharedSource(selected.actual, selected.target);
        expect(adaptOrderChangeDeclineSource(prefix, selected.target)).toBe(selected.actual.replaceAll("\r\n", "\n"));
      }
    }
  });

  it("preserves the original failed compensation and the unchanged forward decline call", () => {
    const step = entry("/steps/decline-order-change.ts");
    expect(step.original).not.toContain('"status",');
    expect(step.original).toContain("service.updateOrderChanges(rollbackData as UpdateOrderChangeDTO)");
    expect(step.original).toContain('"declined_reason"');
    expect(step.actual).toContain("await service.declineOrderChange(data)");
    expect(step.actual).not.toContain('"declined_reason"');
    expect(() => verifyOrderChangeDeclineSource(step.original, step.original, step.target)).toThrow(failure);
    const transfer = readFileSync("third_party/medusa/upstream/packages/core/core-flows/src/order/workflows/transfer/decline-order-transfer.ts", "utf8");
    expect(transfer).toContain('import { declineOrderChangeStep } from "../../steps"');
    expect(transfer).toContain("declineOrderChangeStep({ id: orderChange.id })");
    expect(orderChangeDeclineSourcePairs.some(pair => pair.source.endsWith("/transfer/decline-order-transfer.ts"))).toBe(false);
  });

  it.each([
    ["/steps/decline-order-change.ts", '"id", "status", "declined_at", "declined_by"', '"id", "declined_at", "declined_by"'],
    ["/steps/decline-order-change.ts", 'Object.prototype.hasOwnProperty.call(data, "metadata")', 'true'],
    ["/steps/decline-order-change.ts", '...(hasMetadata ? ["metadata"] : [])', '"metadata"'],
    ["/steps/decline-order-change.ts", 'relations: []', 'relations: ["actions"]'],
    ["/steps/decline-order-change.ts", 'status: previous.status', 'status: "declined"'],
    ["/steps/decline-order-change.ts", 'declined_at: previous.declined_at', 'declined_at: null'],
    ["/steps/decline-order-change.ts", 'declined_by: previous.declined_by', 'declined_by: null'],
    ["/steps/decline-order-change.ts", 'const preimage = structuredClone(retained)', 'const preimage = retained'],
    ["/steps/decline-order-change.ts", 'structuredClone(rollbackData)', 'rollbackData'],
    ["/steps/decline-order-change.ts", 'service.restoreOrderChangeDecline(', 'service.updateOrderChanges('],
    ["/steps/decline-order-change.ts", 'compensation: "transactionCovered"', 'compensation: "uncovered"'],
    ["/steps/decline-order-change.ts", 'new StepResponse(void 0, preimage)', 'new StepResponse(preimage, preimage)'],
    ["/workflows/decline-order-change.ts", 'declineOrderChangeStep(input)', 'declineOrderChangeStep({ id: "other" })'],
    ["/workflows/decline-order-change.ts", '../steps/decline-order-change', '../steps'],
    ["/workflows/decline-order-change.ts", '): void => {', '): WorkflowData<void> => {'],
    ["/workflows/decline-order-change.ts", 'WorkflowData<DeclineOrderChangeDTO>', 'WorkflowData<unknown>'],
    ["/order/mutations.ts", 'export interface RestoreOrderChangeDeclineDTO {', 'export interface OtherDeclineDTO {'],
    ["/order/mutations.ts", 'declined_at: Date | string | null', 'declined_at: Date'],
    ["/order/service.ts", 'data: RestoreOrderChangeDeclineDTO', 'data: UpdateOrderChangeDTO'],
    ["/services/order-module-service.ts", 'const update: OrderTypes.RestoreOrderChangeDeclineDTO = {', 'const update: OrderTypes.UpdateOrderChangeDTO = {'],
    ["/services/order-module-service.ts", 'declined_by: data.declined_by', 'declined_by: null'],
  ])("refuses changed decline correction %s %s", (suffix, before, after) => {
    const selected = entry(suffix);
    expect(selected.actual).toContain(before);
    const changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyChanged(selected, changed)).toThrow(failure);
  });

  it("clones before forward mutation and keeps every inverse detached", () => {
    const step = entry("/steps/decline-order-change.ts");
    const changed = step.actual.replace('    const preimage = structuredClone(retained)\n', '')
      .replace('    await service.declineOrderChange(data)', '    await service.declineOrderChange(data)\n    const preimage = structuredClone(retained)');
    expect(changed).not.toBe(step.actual);
    expect(() => verifyOrderChangeDeclineSource(step.original, changed, step.target)).toThrow(failure);
  });

  it("requires the named existing-row exact replacement without inverse forward guards or reason rewriting", () => {
    const service = entry("/services/order-module-service.ts");
    const methodStart = service.actual.indexOf('  /** Restore a decline preimage');
    expect(methodStart).toBeGreaterThan(0);
    const prefix = service.actual.slice(0, methodStart), method = service.actual.slice(methodStart);
    for (const [before, after] of [
      ['{ metadata: "replace" }', '{ metadata: "merge" }'],
      ['    const restored = await this.orderChangeService_.update(', '    const restored = await this.orderChangeService_.upsert('],
      ['    const restored = await this.orderChangeService_.update(', '    await this.getAndValidateOrderChange_([data.id], false, sharedContext)\n    const restored = await this.orderChangeService_.update('],
      ['      declined_by: data.declined_by,', '      declined_by: data.declined_by,\n      declined_reason: null,'],
      ['    return await this.baseRepository_.serialize<OrderChangeDTO>(restored)', '    return restored'],
    ]) {
      expect(method).toContain(before);
      const changed = prefix + method.replace(before, after);
      expect(changed).not.toBe(service.actual);
      expect(() => verifyOrderChangeDeclineSharedSource(changed, service.target)).toThrow(failure);
    }
  });

  it.each([
    ["transaction manager outside event draining", "  @InjectTransactionManager()\n  @EmitEvents()\n"],
    ["event draining without outer context preparation", "  @EmitEvents()\n  @InjectTransactionManager()\n"],
  ])("rejects decline restore decorators with %s", (_label, decorators) => {
    const service = entry("/services/order-module-service.ts");
    const methodStart = "  /** Restore a decline preimage without metadata merge or entity creation. */\n";
    const approved = methodStart + "  @InjectManager()\n  @EmitEvents()\n  @InjectTransactionManager()\n";
    expect(service.actual).toContain(approved);
    const changed = service.actual.replace(approved, methodStart + decorators);
    expect(changed).not.toBe(service.actual);
    expect(() => verifyOrderChangeDeclineSharedSource(changed, service.target)).toThrow(failure);
    expect(() => verifyOrderChangeCancellationSource(service.original, changed, service.target)).toThrow(canonicalFailure);
  });

  it("keeps full shared-source authority with canonical composition and rejects appended standalone runtime", () => {
    for (const selected of entries) {
      const changed = selected.actual + '\nthrow new Error("extra")\n';
      if (selected.classification === "orderChangeDeclineFork")
        expect(() => verifyOrderChangeDeclineSource(selected.original, changed, selected.target)).toThrow(failure);
      else expect(() => verifyOrderChangeCancellationSource(selected.original, changed, selected.target)).toThrow(canonicalFailure);
    }
    const service = entry("/services/order-module-service.ts");
    const changed = service.actual.replace('await this.getAndValidateOrderChange_(orderChangeIds, false, sharedContext)',
      'await this.getAndValidateOrderChange_(orderChangeIds, true, sharedContext)');
    expect(changed).not.toBe(service.actual);
    expect(() => verifyOrderChangeCancellationSource(service.original, changed, service.target)).toThrow(canonicalFailure);
  });

  it("refuses unexpected sources, changed pin, source drift, ambiguous anchors and repeated corrections", () => {
    const manifest = readFileSync("third_party/medusa/SOURCE_SHA256SUMS");
    const pin = JSON.parse(readFileSync("third_party/medusa/SOURCE.json", "utf8"));
    expect(() => verifyOrderChangeDeclineProvenance(pin, manifest)).not.toThrow();
    for (const changed of [null, { ...pin, commit: "other" }, { ...pin, packageBaseline: "2.14.0" },
      { ...pin, sourceManifestSha256: "other" }])
      expect(() => verifyOrderChangeDeclineProvenance(changed, manifest)).toThrow(failure);
    expect(() => verifyOrderChangeDeclineProvenance(pin, Buffer.concat([manifest, Buffer.from("\n")]))).toThrow(failure);
    for (const selected of entries.filter(pair => pair.classification === "orderChangeDeclineFork"))
      expect(() => adaptOrderChangeDeclineSource(selected.original + "\n", selected.target)).toThrow(failure);
    const service = entry("/services/order-module-service.ts");
    const previous = verifyOrderChangeDeclineSharedSource(service.actual, service.target);
    const anchor = '  async declineOrderChange(orderChangeId: string, sharedContext?: Context)';
    for (const changed of [previous.replace(anchor, ""), previous + "\n" + anchor])
      expect(() => adaptOrderChangeDeclineSource(changed, service.target)).toThrow(failure);
    expect(() => adaptOrderChangeDeclineSource(service.actual, service.target)).toThrow(failure);
    expect(() => verifyOrderChangeDeclineSharedSource(service.actual + '\nrestoreOrderChangeDecline()\n', service.target)).toThrow(failure);
    expect(() => adaptOrderChangeDeclineSource("", "packages/medusa-order/src/other.ts")).toThrow(failure);
    expect(() => verifyOrderChangeDeclineSource("", "", "packages/medusa-order/src/other.ts")).toThrow(failure);
  });

  it("rejects missing, duplicate, redirected, reclassified and wider source selections", () => {
    for (const pair of orderChangeDeclineSourcePairs) {
      for (const files of [orderChangeDeclineSourcePairs.filter(selected => selected !== pair),
        [...orderChangeDeclineSourcePairs, pair],
        orderChangeDeclineSourcePairs.map(selected => selected === pair ? { ...pair, source: pair.source + ".other" } : selected),
        orderChangeDeclineSourcePairs.map(selected => selected === pair ? { ...pair, classification: "authored" } : selected),
        [...orderChangeDeclineSourcePairs, { ...pair, target: pair.target + ".other" }]])
        expect(() => verifyOrderChangeDeclineSourceSelection(files)).toThrow(failure);
    }
    expect(() => verifyOrderChangeDeclineSourceSelection([...orderChangeDeclineSourcePairs, {
      source: "third_party/medusa/upstream/packages/core/core-flows/src/order/workflows/transfer/decline-order-transfer.ts",
      target: "packages/medusa-core-flows/src/order/workflows/transfer/decline-order-transfer.ts", classification: "orderChangeDeclineFork",
    }])).toThrow(failure);
  });
});
