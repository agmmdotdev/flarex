import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { decodeCommerceDriverRows } from "../src/commerceTransaction/driverRows";
import { commerceError } from "../src/commerceTransaction/model";
import { runEffect } from "./effectTestRuntime";

describe("commerce driver row boundary", () => {
  it("reads lazily once and leaves row decoding to the store", () => runEffect(Effect.gen(function* () {
    const rows: readonly unknown[] = [null, { value: "driver-owned" }];
    let reads = 0;
    const effect = decodeCommerceDriverRows(Object.defineProperty({}, "rows", { get() { reads++; return rows; } }));
    expect(reads).toBe(0);
    expect(yield* effect).toBe(rows);
    expect(reads).toBe(1);
  })));

  it("classifies malformed wrappers as stored corruption", () => runEffect(Effect.gen(function* () {
    for (const value of [null, [], {}, { rows: null }]) {
      expect(yield* Effect.flip(decodeCommerceDriverRows(value))).toMatchObject({ reason: "storedCorruption" });
    }
  })));

  it("preserves getter failures even when they resemble the shape sentinel", () => runEffect(Effect.gen(function* () {
    for (const cause of [new Error("driver getter failed"), commerceError("storedCorruption")]) {
      let reads = 0;
      const wrapper = Object.defineProperty({}, "rows", { get() { reads++; throw cause; } });
      const failure = yield* Effect.flip(decodeCommerceDriverRows(wrapper));
      expect(failure.reason).toBe("statementFailure");
      expect(failure.cause).toBe(cause);
      expect(reads).toBe(1);
    }
  })));
});
