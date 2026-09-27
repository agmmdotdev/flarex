import { describe, expect, it } from "vitest";
import { prepareMixedMutationPerformanceSeries } from "./support/mixedMutationProductFixture";

describe("prepared private mixed mutation performance series", () => {
  it("runs two fresh signed Product attempts on one prepared scope with separate Workers", async () => {
    const series = await prepareMixedMutationPerformanceSeries({
      driver: "pglite", suffix: "performance-reuse", profile: "product", sampleCount: 2,
    });
    try {
      await series.prepareAttempt(0);
      const first = await series.runAttempt(0);
      expect(series.workerConstructionCount).toBe(1);
      await series.prepareAttempt(1);
      const second = await series.runAttempt(1);
      expect(first.seed.productId).not.toBe(second.seed.productId);
      expect(first.fixture.activation.anchor.sessionId)
        .not.toBe(second.fixture.activation.anchor.sessionId);
      expect(first.fixture.eventGroup).not.toBe(second.fixture.eventGroup);
      expect(first.fixture.currency.resource).toBe(second.fixture.currency.resource);
      expect(series.workerConstructionCount).toBe(2);
      for (const sample of [first, second]) {
        expect(sample.returnedValue).toMatchObject({
          pending: { id: sample.seed.productId, title: sample.seed.newTitle },
          updated: { id: sample.seed.productId, title: sample.seed.newTitle },
        });
        expect(sample.publication).toMatchObject({ kind: "published" });
        expect(sample.workerConstructionMilliseconds).toBeGreaterThan(0);
        expect(sample.sealedJournalBytes).toBeGreaterThan(0);
        expect(sample.fixture.nativeInvokeCount.get("update")).toBe(1);
      }
      await expect(series.runAttempt(0)).rejects.toThrow("already used");
    } finally { await series.close(); }
  }, 180_000);
});
