import { describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { BigNumber as NativeBigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { captureNativeNumericComparisonResult, encodeExactNumeric } from "../src/value/exact-numeric";

describe("native numeric storage regressions", () => {
  it("preserves native multiplication precision beyond JavaScript's safe integer range", async () => {
    const quantity = MathBN.mult("9007199254740993.125", 1);
    const encoded = await Effect.runPromise(encodeExactNumeric(quantity));
    expect(encoded).toEqual({ value: "9007199254740993.1250", raw: { value: "9007199254740993.1250", precision: 20 } });
  });

  it("retains the existing default precision when a genuine native BigNumber has a custom precision", async () => {
    const quantity = new BigNumber("1.234567890123456789123456", { precision: 30 });
    const before = { ...quantity.raw };
    const encoded = await Effect.runPromise(encodeExactNumeric(quantity));
    expect(encoded).toEqual({ value: "1.2345678901234567891", raw: { value: "1.2345678901234567891", precision: 20 } });
    expect(quantity.raw).toEqual(before);
    expect(quantity.raw?.precision).toBe(30);
  });

  it("classifies proxy recognition and native getter failures at the same foreign boundary", async () => {
    const prototypeFailure = new Error("numeric prototype inspection refused"), rawFailure = new Error("native numeric raw getter refused");
    const inputs = [
      { input: new Proxy({}, { getPrototypeOf: () => { throw prototypeFailure; } }), cause: prototypeFailure },
      { input: new Proxy(new BigNumber("3"), { get: (target, name, receiver) => {
        if (name === "raw") throw rawFailure;
        return Reflect.get(target, name, receiver);
      } }), cause: rawFailure },
    ];
    for (const { input, cause } of inputs) {
      const result = await Effect.runPromise(Effect.result(encodeExactNumeric(input)));
      Result.match(result, {
        onSuccess: () => { throw new Error("Expected a native numeric boundary refusal"); },
        onFailure: failure => { expect(failure.reason).toBe("invalidInput"); expect(failure.cause).toBe(cause); },
      });
    }
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(await Effect.runPromise(Effect.result(encodeExactNumeric(revoked.proxy))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("keeps the existing Effect storage API lazy", async () => {
    const input = MathBN.mult(2, 3), stringify = vi.fn(input.toString.bind(input));
    Object.defineProperty(input, "toString", { value: stringify });
    const computation = encodeExactNumeric(input);
    expect(stringify).not.toHaveBeenCalled();
    const normalized = await Effect.runPromise(computation);
    expect(stringify).toHaveBeenCalledOnce();
    expect(normalized).toEqual({ value: "6.0000000000000000000", raw: { value: "6.0000000000000000000", precision: 20 } });
  });
});

describe("lossless native numeric comparison arguments", () => {
  it("preserves the native insufficient-quantity verdict beyond 20 significant digits", async () => {
    const requested = MathBN.mult("1.000000000000000000001", 1);
    const argument = Result.getOrThrow(captureNativeNumericComparisonResult(requested));
    expect(argument).toBe("1.000000000000000000001");
    expect(MathBN.gte(new NativeBigNumber(1), requested)).toBe(false);
    expect(MathBN.gte(new NativeBigNumber(1), argument)).toBe(false);
    // Storage's separate native 20-digit companion remains deliberately intact.
    const stored = await Effect.runPromise(encodeExactNumeric(requested));
    expect(MathBN.gte(new NativeBigNumber(1), stored.value)).toBe(true);
  });

  it("reads a genuine native BigNumber's unrounded arithmetic value", () => {
    const requested = new NativeBigNumber("1.000000000000000000001");
    expect(requested.raw?.value).toBe("1.0000000000000000000");
    const argument = Result.getOrThrow(captureNativeNumericComparisonResult(requested));
    expect(argument).toBe("1.000000000000000000001");
    expect(MathBN.gte(1, argument)).toBe(MathBN.gte(1, requested));
    expect(MathBN.gte(1, argument)).toBe(false);
  });

  it("keeps decimal precision above 2^53 and finite native values beyond the number range", () => {
    const exact = "9007199254740993.125000000000000000001";
    for (const input of [exact, MathBN.mult(exact, 1), new NativeBigNumber(exact)])
      expect(Result.getOrThrow(captureNativeNumericComparisonResult(input))).toBe(exact);
    expect(Result.getOrThrow(captureNativeNumericComparisonResult("1e309"))).toBe("1e+309");
    expect(MathBN.convert(Result.getOrThrow(captureNativeNumericComparisonResult("1e309"))).isFinite()).toBe(true);
  });

  it.each([undefined, null, true, NaN, Infinity, -Infinity, "NaN", "Infinity", "-Infinity", "not-a-number", {},
    { value: "1", precision: 20 }, { bigNumber: MathBN.convert(1) }])("refuses malformed comparison inputs: %s", input => {
    expect(captureNativeNumericComparisonResult(input)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("refuses the separate storage constructor as the executing native comparison class", () => {
    expect(BigNumber).not.toBe(NativeBigNumber);
    expect(captureNativeNumericComparisonResult(new BigNumber("1.000000000000000000001")))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("keeps arbitrary native-looking accessors inert and preserves actual proxy failures", () => {
    const getter = vi.fn(() => MathBN.convert(1));
    const impostor = { get bigNumber() { return getter(); }, get raw() { return getter(); } };
    expect(captureNativeNumericComparisonResult(impostor)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(getter).not.toHaveBeenCalled();
    const cause = new Error("native comparison getter refused");
    const input = new Proxy(new NativeBigNumber(1), { get: (target, name, receiver) => {
      if (name === "bigNumber") throw cause;
      return Reflect.get(target, name, receiver);
    } });
    Result.match(captureNativeNumericComparisonResult(input), {
      onSuccess: () => { throw new Error("Expected native comparison getter refusal"); },
      onFailure: failure => { expect(failure.reason).toBe("invalidInput"); expect(failure.cause).toBe(cause); },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(captureNativeNumericComparisonResult(revoked.proxy)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });
});
