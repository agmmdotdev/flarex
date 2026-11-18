import { describe, expect, it, vi } from "vitest";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { MathBN } from "@medusajs/utils/totals/math";
import { snapshotNativeNumber } from "@medusajs/utils/totals/native-number";
import { prepareTransformResolution } from "../src/resolution";

describe("finite native number normalization", () => {
  it("retains native exact arithmetic strings and quantity JSON presentation", () => {
    const exact = MathBN.mult("3.125000000000000000001", -1);
    expect(snapshotNativeNumber(exact)).toEqual({ json: "-3.125000000000000000001", exact: "-3.125000000000000000001" });
    const quantity = new BigNumber("12.5"), zero = MathBN.convert(-0);
    expect(snapshotNativeNumber(quantity)?.json).toBe(12.5);
    expect(prepareTransformResolution(exact)).toMatchObject({ _tag: "Success", success: { kind: "constant", value: "-3.125000000000000000001" } });
    expect(prepareTransformResolution(quantity)).toMatchObject({ _tag: "Success", success: { kind: "constant", value: 12.5 } });
    expect(prepareTransformResolution(zero)).toMatchObject({ _tag: "Success", success: { kind: "constant", value: "-0" } });
    expect(prepareTransformResolution({ exact, quantity, zero }))
      .toMatchObject({ _tag: "Success", success: { kind: "record", members: [
        { kind: "constant", value: "-3.125000000000000000001" }, { kind: "constant", value: 12.5 }, { kind: "constant", value: "-0" },
      ] } });
    expect(snapshotNativeNumber(new BigNumber("0.00001"))?.json).toBe(0);
  });

  it("refuses decorated values, subclasses, nonfinite state and inert counterfeit state without callbacks", () => {
    const callback = vi.fn(() => "17"), decorated = MathBN.convert(17);
    Object.defineProperty(decorated, "toJSON", { value: callback, enumerable: true });
    expect(prepareTransformResolution(decorated)).toMatchObject({ _tag: "Failure" });
    const accessor = MathBN.convert(17);
    Object.defineProperty(accessor, "c", { get: callback, enumerable: true });
    expect(prepareTransformResolution(accessor)).toMatchObject({ _tag: "Failure" });
    const exponent = MathBN.convert(17);
    Object.defineProperty(exponent, "e", { value: { valueOf: callback }, enumerable: true });
    expect(prepareTransformResolution(exponent)).toMatchObject({ _tag: "Failure" });
    for (const value of [new BigNumber(Infinity), MathBN.convert(NaN), new (class extends BigNumber {})(17),
      Object.create(Object.getPrototypeOf(MathBN.convert(0)))]) {
      expect(prepareTransformResolution(value)).toMatchObject({ _tag: "Failure" });
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("bounds retained raw spelling before native parsing or final JSON charging", () => {
    const padded = new BigNumber({ value: "1." + "0".repeat(60_000), precision: 20 });
    expect(prepareTransformResolution(padded)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidReference" } });
  });
});
