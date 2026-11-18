import { Result } from "effect";
import * as orderedIndex from "flarex-protocol/ordered-index";
import { expect, it, vi } from "vitest";
import { decodeLogicalFindQuery, prepareLogicalQueryPredicate } from "../../../src/storage/documents/logicalDocuments/query";
import { capturePrivateJsonData } from "../../../src/values/privateJsonData";

const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
const prepare = (where: unknown) => {
  const captured = Result.getOrThrow(capturePrivateJsonData({ where, offset: 0, limit: 10 }, 65_536, failure));
  const query = Result.getOrThrow(decodeLogicalFindQuery(captured.value));
  return prepareLogicalQueryPredicate(query.where, failure);
};

it("lowers each captured bound once while encoding every actual candidate in order", () => {
  const encoder = vi.spyOn(orderedIndex, "encodeOrderedIndexComponentsV1");
  try {
    const matches = prepare({ label: { gte: "a", lt: "z" } });
    expect(encoder).not.toHaveBeenCalled();
    expect(Result.getOrThrow(matches({ label: "b" }))).toBe(true);
    expect(encoder).toHaveBeenCalledTimes(3);
    expect(Result.getOrThrow(matches({ label: "c" }))).toBe(true);
    expect(encoder).toHaveBeenCalledTimes(4);
    expect(Result.getOrThrow(matches({ label: "0" }))).toBe(false);
    expect(encoder).toHaveBeenCalledTimes(5);
    const another = prepare({ label: { gte: "a", lt: "z" } });
    expect(Result.getOrThrow(another({ label: "b" }))).toBe(true);
    expect(encoder).toHaveBeenCalledTimes(8);
  } finally { encoder.mockRestore(); }
});

it("keeps missing fields, unsupported actuals and earlier false comparisons before later bound failure", () => {
  const oversized = "z".repeat(orderedIndex.MAX_ORDERED_INDEX_KEY_BYTES_V1 + 1);
  const matches = prepare({ enabled: true, label: { gt: "m", lt: oversized } });
  expect(Result.getOrThrow(matches({ enabled: false, label: "n" }))).toBe(false);
  expect(Result.getOrThrow(matches({ enabled: true }))).toBe(false);
  expect(Result.getOrThrow(matches({ enabled: true, label: [] }))).toBe(false);
  expect(Result.getOrThrow(matches({ enabled: true, label: "a" }))).toBe(false);
  expect(matches({ enabled: true, label: "n" })).toMatchObject({ _tag: "Failure",
    failure: { message: "limitExceeded", cause: { _tag: "OrderedIndexKeyTooLargeError" } } });
  expect(matches({ enabled: true, label: "o" })).toMatchObject({ _tag: "Failure",
    failure: { message: "limitExceeded", cause: { _tag: "OrderedIndexKeyTooLargeError" } } });
});

it("preserves actual encoder and getter defects and never retains failed lowering", () => {
  const originalCause = new Error("actual getter");
  const matches = prepare({ label: { gt: "a" } });
  expect(() => matches({ get label(): never { throw originalCause; } })).toThrow(originalCause);
  const defect = new Error("bound encoder");
  const actualEncoder = orderedIndex.encodeOrderedIndexComponentsV1;
  const encoder = vi.spyOn(orderedIndex, "encodeOrderedIndexComponentsV1");
  try {
    encoder.mockImplementationOnce(actualEncoder).mockImplementationOnce(() => { throw defect; });
    expect(() => matches({ label: "b" })).toThrow(defect);
    expect(Result.getOrThrow(matches({ label: "b" }))).toBe(true);
    // The successful actual and failed bound are repeated at their same cuts.
    expect(encoder).toHaveBeenCalledTimes(4);
  } finally { encoder.mockRestore(); }
});

it("owns one guarded query capture and preserves signed-zero scalar comparisons", () => {
  const input = { label: { gt: "a" }, number: -0 };
  const matches = prepare(input);
  input.label.gt = "z";
  input.number = 0;
  expect(Result.getOrThrow(matches({ label: "b", number: -0 }))).toBe(true);
  expect(Result.getOrThrow(matches({ label: "b", number: 0 }))).toBe(false);
});
