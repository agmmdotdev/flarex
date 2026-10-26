import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BigNumber } from "@medusajs/framework/utils/portable";
import { snapshotNativeNumber } from "@medusajs/utils/totals/native-number";
import { captureExactNumericRow, encodeExactNumeric, encodeNativeExactNumeric } from "../src/value/exact-numeric";

describe("native Order financial numeric input", () => {
  it("captures the executing native quantity with the existing storage precision", async () => {
    const quantity = new BigNumber("12.500000000000000000001");
    const before = { ...quantity.raw };
    expect(snapshotNativeNumber(quantity)?.json).toBe(12.5);
    expect(await Effect.runPromise(encodeExactNumeric(quantity))).toEqual({ value: "12.500000000000000000",
      raw: { value: "12.500000000000000000", precision: 20 } });
    expect(quantity.raw).toEqual(before);
  });

  it("admits native raw amounts only through the explicit native input profile", async () => {
    const amount = { value: "9007199254740993.125", precision: 30 };
    expect(await Effect.runPromise(Effect.result(encodeExactNumeric(amount))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    const expected = { value: "9007199254740993.1250", raw: { value: "9007199254740993.1250", precision: 20 } };
    expect(await Effect.runPromise(encodeNativeExactNumeric(amount))).toEqual(expected);
    expect(await Effect.runPromise(captureExactNumericRow({ id: "native", amount }, [{ name: "amount" }], false, "nativeRaw")))
      .toEqual({ id: "native", amount: expected.value, raw_amount: expected.raw });
    expect(await Effect.runPromise(Effect.result(captureExactNumericRow({ amount }, [{ name: "amount" }]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(amount).toEqual({ value: "9007199254740993.125", precision: 30 });
  });

  it("refuses decorated quantities and malformed raw records without invoking callbacks", async () => {
    const callback = vi.fn(() => "12.5"), quantity = new BigNumber("12.5");
    Object.defineProperty(quantity, "toJSON", { value: callback, enumerable: true });
    for (const input of [quantity, { get value() { return callback(); }, precision: 20 },
      { value: "1", precision: 20, extra: true }, { value: "Infinity", precision: 20 }, { value: "1", precision: 0 }]) {
      expect(await Effect.runPromise(Effect.result(encodeNativeExactNumeric(input))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    }
    expect(callback).not.toHaveBeenCalled();
    expect(await Effect.runPromise(Effect.result(captureExactNumericRow({ amount: 1,
      raw_amount: { value: "1", precision: 20 } }, [{ name: "amount" }], false, "nativeRaw"))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
