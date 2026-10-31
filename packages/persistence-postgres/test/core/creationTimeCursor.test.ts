import { Result, Schema } from "effect";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { describe, expect, it } from "vitest";
import { captureCoreDocument, CoreCreationTimeSchema, incrementCoreCreationTime } from "../../src/core/document";

const id = Result.getOrThrow(encodeDocumentId(10001, new Uint8Array(16).fill(4)));
const document = (time: number) => captureCoreDocument({ _id: id, _creationTime: time }, false);

describe("Source creation cursor and document field domains", () => {
  it.each([
    { value: 0, next: Number.MIN_VALUE },
    { value: Number.MIN_VALUE, next: Number.MIN_VALUE * 2 },
    { value: 1, next: 1 + 2 ** -52 },
    { value: 2 ** -1022, next: 2 ** -1022 + Number.MIN_VALUE },
    { value: 2 ** 53 - 1, next: 2 ** 53 },
    { value: 2 ** 53, next: 2 ** 53 + 2 },
  ])("returns $value after validating its successor", expected => {
    expect(Result.getOrThrow(incrementCoreCreationTime(expected.value))).toEqual(expected);
  });

  it.each([-0, -Number.MIN_VALUE, -1, NaN, Infinity, -Infinity])("refuses invalid cursor %s", value => {
    expect(Result.isFailure(incrementCoreCreationTime(value))).toBe(true);
  });

  it("keeps zero allocatable while refusing it as a document field", () => {
    const step = Result.getOrThrow(incrementCoreCreationTime(0));
    expect(Result.isFailure(document(step.value))).toBe(true);
    expect(Result.isSuccess(document(step.next))).toBe(true);
  });

  it("preserves the last valid document time when its successor reaches the field limit", () => {
    const step = Result.getOrThrow(incrementCoreCreationTime(2 ** 53 - 1));
    expect(Result.isSuccess(document(step.value))).toBe(true);
    expect(Result.isFailure(document(step.next))).toBe(true);
    expect(Result.getOrThrow(incrementCoreCreationTime(step.next))).toEqual({ value: 2 ** 53, next: 2 ** 53 + 2 });
  });

  it("refuses an overflowing increment without inventing a finite cursor ceiling", () => {
    expect(Result.isSuccess(Schema.decodeUnknownResult(CoreCreationTimeSchema)(Number.MAX_VALUE))).toBe(true);
    expect(Result.isFailure(incrementCoreCreationTime(Number.MAX_VALUE))).toBe(true);
    expect(Result.isFailure(document(Number.MAX_VALUE))).toBe(true);
  });
});
