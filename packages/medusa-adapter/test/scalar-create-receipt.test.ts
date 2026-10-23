import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { correlateScalarCreateReceipt, correlateScalarCreateWrites } from "../src/repository/scalar-create-receipt";

const a = { id: "a", value: "first", metadata: { filled: true } }, b = { id: "b", value: "second", metadata: null };
const inputs = [{ id: "a", value: "first", metadata: null }, { id: "b", value: "second" },
  { id: "a", value: "ignored", metadata: { filled: true } }];

describe("native scalar create identity receipt correlation", () => {
  it("retains every position while exposing a detached nullish-merged canonical cohort", () => {
    const before = structuredClone(inputs);
    const result = Result.getOrThrow(correlateScalarCreateReceipt(inputs, [a, b, a]));
    expect(result).toEqual({ inputs: [{ ...a }, { id: "b", value: "second" }], results: [a, b], positions: [0, 1, 0] });
    expect(inputs).toEqual(before);
  });

  it("authenticates hidden nested-create identities from the exact canonical write cohort", () => {
    expect(Result.getOrThrow(correlateScalarCreateWrites(inputs, [a, b]))).toEqual(
      Result.getOrThrow(correlateScalarCreateReceipt(inputs, [a, b, a])));
    expect(Result.isFailure(correlateScalarCreateWrites(inputs, [b, a]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateWrites(inputs, [a]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateWrites(inputs, [a, b, a]))).toBe(true);
  });

  it("requires fresh generated identities to be distinct from each other and all supplied IDs", () => {
    expect(Result.isFailure(correlateScalarCreateReceipt([{}, {}], [a, a]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateReceipt([{}, { id: "a" }], [a, a]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateWrites([{}, {}], [a, a]))).toBe(true);
    expect(Result.getOrThrow(correlateScalarCreateReceipt([{}, {}], [a, b])).positions).toEqual([0, 1]);
  });

  it("requires full identical DTOs for every alias and exact input/position cardinality", () => {
    expect(Result.isFailure(correlateScalarCreateReceipt(inputs, [a, b, { ...a, metadata: null }]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateReceipt(inputs, [a, b]))).toBe(true);
    expect(Result.isFailure(correlateScalarCreateReceipt(inputs, [a, b, b]))).toBe(true);
    expect(Result.getOrThrow(correlateScalarCreateReceipt([], []))).toEqual({ inputs: [], results: [], positions: [] });
  });
});
