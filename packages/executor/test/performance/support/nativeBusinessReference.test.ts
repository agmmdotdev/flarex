import { describe, expect, it } from "vitest";
import { loadNativeBusinessReference, nativeBusinessComparison, quietSamplingEligible } from "./nativeBusinessReference";

describe("complete native business reference", () => {
  const reference = loadNativeBusinessReference();
  it("reports real pinned complete costs and one root budget without claiming paired excess", () => {
    const measured = { samples: 100, medianMs: 120, p95Ms: 140, minMs: 110, maxMs: 155 };
    const comparison = nativeBusinessComparison(reference, "mixed-product", "small", measured);
    expect(comparison).toMatchObject({ status: "reference-only", nativeGraph: "mixed-product",
      observedCompleteCost: measured, pairedExcess: null, acceptance: "pending-paired-comparison",
      wholeGraphAddedBudget: { medianMs: 5, p95Ms: 10 } });
    expect(comparison.nativeMedianMs).toBeCloseTo(9.2776, 4);
    expect(comparison.nativeP95Ms).toBeCloseTo(11.3846, 4);
    expect(comparison.reference).toMatchObject({ warmups: 5, measured: 100 });
    expect(comparison.reference.sha256Hex).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not lend other graphs or sizes an unrelated native number", () => {
    for (const scenario of ["product-update", "payload-update", "mixed-repeated-product"] as const)
      expect(nativeBusinessComparison(reference, scenario, "small", null)).toMatchObject({
        status: "missing-native-graph", nativeGraph: null, nativeMedianMs: null, planningTotalBudget: null });
    expect(nativeBusinessComparison(reference, "mixed-product", "typical", null)).toMatchObject({
      status: "missing-native-graph", nativeMedianMs: null, pairedExcess: null });
  });
  it("keeps short/full, failed, partial and profiled series out of acceptance sampling", () => {
    expect(quietSamplingEligible({ warmups: 5, measured: 100 }, 100, false, false, false)).toBe(true);
    expect(quietSamplingEligible({ warmups: 5, measured: 30 }, 30, false, false, false)).toBe(true);
    expect(quietSamplingEligible({ warmups: 3, measured: 20 }, 20, false, false, false)).toBe(false);
    expect(quietSamplingEligible({ warmups: 5, measured: 100 }, 99, false, false, false)).toBe(false);
    expect(quietSamplingEligible({ warmups: 5, measured: 100 }, 100, true, false, false)).toBe(false);
    expect(quietSamplingEligible({ warmups: 5, measured: 100 }, 100, false, true, false)).toBe(false);
    expect(quietSamplingEligible({ warmups: 5, measured: 100 }, 100, false, false, true)).toBe(false);
  });
});
