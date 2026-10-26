import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { BigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { captureCommerceInput } from "../src/value/input";
import { captureNativeNumericDto } from "../src/value/native-numeric";

describe("native numeric DTO boundary", () => {
  it("normalizes nested native quantities while preserving strict storage input", () => {
    const input = { total: new BigNumber("12.5"), nested: [{ amount: MathBN.mult("1.000000000000000000001", -1) }], absent: undefined };
    expect(Result.getOrThrow(captureNativeNumericDto(input))).toEqual({ total: 12.5, nested: [{ amount: "-1.000000000000000000001" }] });
    expect(captureCommerceInput(input)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("refuses accessors, foreign serializers, cycles and sparse arrays without executing callbacks", () => {
    const callback = vi.fn(() => 12), accessor = Object.defineProperty({}, "total", { get: callback, enumerable: true });
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const input of [accessor, { total: { toJSON: callback } }, cyclic, new Array(2)]) {
      expect(captureNativeNumericDto(input)).toMatchObject({ _tag: "Failure" });
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("reuses an inert numeric snapshot while charging each expanded occurrence", () => {
    const inspected = vi.fn((target: object) => Reflect.ownKeys(target));
    const value = new Proxy(MathBN.convert("12345678901234567890"), { ownKeys: inspected });
    expect(Result.getOrThrow(captureNativeNumericDto([value, value], { commandBytes: 64, valueNodes: 10 })))
      .toEqual(["12345678901234567890", "12345678901234567890"]);
    expect(inspected).toHaveBeenCalledOnce();
    expect(captureNativeNumericDto([value, value], { commandBytes: 32, valueNodes: 10 }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  });

  it("stops repeated numeric expansion at its byte budget before visiting later input", () => {
    const value = MathBN.convert("1".repeat(2048)), later = vi.fn(() => []);
    const input = [...Array.from({ length: 64 }, () => value), new Proxy({}, { ownKeys: later })];
    expect(captureNativeNumericDto(input, { commandBytes: 4096, valueNodes: 8192 }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(later).not.toHaveBeenCalled();
  });
});
