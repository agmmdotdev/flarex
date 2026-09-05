import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { captureRelationalData } from "../src/relationalTransaction/data";

describe("owned relational command data", () => {
  it("captures descriptors without rereading a Proxy through get", () => {
    let reads = 0;
    const input = new Proxy(
      { value: "small" },
      {
        get: () => {
          reads++;
          return "x".repeat(2000);
        },
      },
    );
    const captured = Result.getOrThrow(captureRelationalData(input, 100));
    expect(captured).toEqual({ value: { value: "small" }, bytes: 17 });
    expect(reads).toBe(0);
    expect(Object.isFrozen(captured.value)).toBe(true);
  });
  it("rejects getters, failed reflection, sparse arrays, cycles and oversized data", () => {
    let reads = 0;
    const accessor = {
      get value() {
        reads++;
        return "value";
      },
    };
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const input of [
      accessor,
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("reflection");
          },
        },
      ),
      new Array(2),
      cycle,
      "x".repeat(101),
    ]) {
      expect(Result.isFailure(captureRelationalData(input, 100))).toBe(true);
    }
    expect(reads).toBe(0);
  });
  it("owns nested data and preserves special property names and UTF-8 budgets", () => {
    const input = { ["__proto__"]: { value: "é" }, values: [1, null, true] };
    const captured = Result.getOrThrow(captureRelationalData(input, 100));
    expect(captured.value).toEqual(input);
    expect(captured.bytes).toBe(Buffer.byteLength(JSON.stringify(input)));
    if (captured.value === null || typeof captured.value !== "object")
      throw new Error("Expected owned object");
    expect(Object.hasOwn(captured.value, "__proto__")).toBe(true);
    input["__proto__"].value = "changed";
    expect(captured.value).toMatchObject({ ["__proto__"]: { value: "é" } });
    expect(
      Result.isFailure(
        captureRelationalData(captured.value, captured.bytes - 1),
      ),
    ).toBe(true);
  });
});
