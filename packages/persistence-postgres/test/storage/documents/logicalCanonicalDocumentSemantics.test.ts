import { Result, Schema } from "effect";
import { AppDocumentIdV1Schema } from "flarex-protocol/app-document-id";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { expect, it, vi } from "vitest";
import { canonicalizeFlarexValueV1, isCanonicalFlarexRuntimeObjectV1, type CanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import {
  detachLogicalCanonicalDocument, prepareLogicalCanonicalDocumentSemantics,
} from "../../../src/storage/documents/logicalDocuments/relationalRows";

const failure = () => new Error("documentInvalid");
const requireRuntime = (value: CanonicalFlarexRuntimeObjectV1 | undefined) => {
  if (value === undefined) throw new Error("Expected the exact canonical table verdict");
  return value;
};

it("reuses only the codec issuer's successful exact table/source-generation verdict across genuine close detachment", async () => {
  const document = await canonicalizeFlarexValueV1({ _id: "owned", _creationTime: 1, title: "valid" }, "appDocument");
  const validator = vi.fn(() => Result.succeed(true));
  const owner = prepareLogicalCanonicalDocumentSemantics(validator, failure);
  expect(Result.isSuccess(owner.validate(document))).toBe(true);
  const detached = detachLogicalCanonicalDocument(document);
  expect(Result.isSuccess(owner.validate(detached))).toBe(true);
  expect(validator).toHaveBeenCalledTimes(1);
  expect(requireRuntime(Result.getOrThrow(owner.inspect(detached))).title).toBe("valid");
  for (const copy of [structuredClone(document), { ...document }, Object.freeze({ ...document })]) {
    expect(Result.getOrThrow(owner.inspect(copy))).toBeUndefined();
    expect(Result.isSuccess(owner.validate(copy))).toBe(true);
    expect(Result.isSuccess(owner.validate(copy))).toBe(true);
  }
  expect(validator).toHaveBeenCalledTimes(7);
  const changedValidator = vi.fn(() => Result.fail(failure()));
  const changedGeneration = prepareLogicalCanonicalDocumentSemantics(changedValidator, failure);
  expect(Result.isFailure(changedGeneration.validate(detached))).toBe(true);
  expect(changedValidator).toHaveBeenCalledTimes(1);
  expect(Result.getOrThrow(changedGeneration.inspect(detached))).toBeUndefined();
});

it("retains the full runtime domain and detaches binary storage on every validation/inspection escape", async () => {
  const document = await canonicalizeFlarexValueV1({ _id: "owned", _creationTime: 1,
    bytes: new Uint8Array([1, 2, 3]).buffer, nested: { values: [9n, -0, NaN, Infinity, -Infinity] } }, "appDocument");
  const validator = vi.fn((runtime: CanonicalFlarexRuntimeObjectV1) => {
    if (!(runtime.bytes instanceof ArrayBuffer)) return Result.fail(failure());
    new Uint8Array(runtime.bytes).fill(8);
    return Result.succeed(true);
  });
  const owner = prepareLogicalCanonicalDocumentSemantics(validator, failure);
  expect(Result.isSuccess(owner.validate(document))).toBe(true);
  const detached = detachLogicalCanonicalDocument(document);
  const first = requireRuntime(Result.getOrThrow(owner.inspect(detached)));
  if (!(first.bytes instanceof ArrayBuffer)) throw new Error("Missing binary runtime");
  expect(new Uint8Array(first.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  new Uint8Array(first.bytes).fill(9);
  const escaped = detached.value;
  if (!isCanonicalFlarexRuntimeObjectV1(escaped) || !(escaped.bytes instanceof ArrayBuffer)) throw new Error("Missing escaped binary document");
  new Uint8Array(escaped.bytes).fill(7);
  const second = requireRuntime(Result.getOrThrow(owner.inspect(detached)));
  if (!(second.bytes instanceof ArrayBuffer)) throw new Error("Missing second binary runtime");
  expect(new Uint8Array(second.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  expect(second.nested).toBe(first.nested);
  expect(second.nested).toEqual({ values: [9n, -0, NaN, Infinity, -Infinity] });
  expect(validator).toHaveBeenCalledTimes(1);
});

it.each(["canonicalBytes", "sha256", "binary"] as const)("refuses altered authentic %s without laundering it through close", async field => {
  const document = await canonicalizeFlarexValueV1({ _id: "owned", _creationTime: 1,
    bytes: new Uint8Array([1, 2, 3]).buffer }, "appDocument");
  const validator = vi.fn(() => Result.succeed(true));
  const owner = prepareLogicalCanonicalDocumentSemantics(validator, failure);
  expect(Result.isSuccess(owner.validate(document))).toBe(true);
  if (field === "binary") {
    const value = document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(value) || !(value.bytes instanceof ArrayBuffer)) throw new Error("Missing original binary document");
    new Uint8Array(value.bytes).fill(9);
  } else document[field].fill(9);
  for (const candidate of [document, detachLogicalCanonicalDocument(document)]) {
    expect(Result.isFailure(owner.inspect(candidate))).toBe(true);
    expect(Result.isFailure(owner.validate(candidate))).toBe(true);
  }
  expect(validator).toHaveBeenCalledTimes(1);
});

it("preserves foreign getter defects and leaves later validation lazy after an earlier refusal", async () => {
  const document = await canonicalizeFlarexValueV1({ _id: "owned", _creationTime: 1, title: 123 }, "appDocument");
  const originalCause = new Error("foreign body getter");
  const getter = vi.fn((): never => { throw originalCause; });
  const foreign = { ...document, get value(): CanonicalFlarexRuntimeObjectV1 { return getter(); } };
  const validator = vi.fn(() => Result.fail(failure()));
  const owner = prepareLogicalCanonicalDocumentSemantics(validator, failure);
  const first = owner.validate(document);
  if (Result.isSuccess(first)) owner.validate(foreign);
  expect(Result.isFailure(first)).toBe(true);
  expect(getter).not.toHaveBeenCalled();
  expect(() => owner.validate(foreign)).toThrow(originalCause);
  expect(validator).toHaveBeenCalledTimes(1);
});

it("withholds reuse for malformed scalar fields without changing successful table semantics or commit's scalar refusal", async () => {
  const document = await canonicalizeFlarexValueV1({ _id: "malformed", _creationTime: -1, title: "valid" }, "appDocument");
  const decodeId = Schema.decodeUnknownResult(AppDocumentIdV1Schema);
  const decodeTime = Schema.decodeUnknownResult(AppCreationTimeV1Schema);
  const business = vi.fn(() => Result.succeed(undefined));
  const owner = prepareLogicalCanonicalDocumentSemantics(value => Result.gen(function* () {
    yield* business();
    return Result.isSuccess(decodeId(value._id)) && Result.isSuccess(decodeTime(value._creationTime));
  }), failure);
  for (const candidate of [document, detachLogicalCanonicalDocument(document)]) {
    expect(Result.isSuccess(owner.validate(candidate))).toBe(true);
    expect(Result.getOrThrow(owner.inspect(candidate))).toBeUndefined();
    const value = candidate.value;
    if (!isCanonicalFlarexRuntimeObjectV1(value)) throw new Error("Missing forged system runtime");
    expect(Result.isFailure(decodeId(value._id))).toBe(true);
    expect(Result.isFailure(decodeTime(value._creationTime))).toBe(true);
  }
  expect(business).toHaveBeenCalledTimes(2);
});
