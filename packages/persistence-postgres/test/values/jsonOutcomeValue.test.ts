import { createHash } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { expect, it, vi } from "vitest";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { capturePrivateJsonData, inspectCapturedPrivateJsonData } from "../../src/values/privateJsonData";
import { captureJsonOutcomeValue, canonicalizeJsonOutcome, JsonOutcomeError, useJsonOutcomeValue, verifyJsonOutcome } from "../../src/values/jsonOutcome";
import { runEffect } from "../support/effectTestRuntime";

const success = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) throw new Error("Unexpected outcome capture refusal", { cause: result.failure });
  return result.success;
};
const failure = (reason: "invalidInput" | "limitExceeded", cause?: unknown) => ({ reason, cause });
const unicodeDecode = Schema.decodeUnknownResult(Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF]*$/u)));
const unicodeFailure = (value: string): JsonOutcomeError => {
  const decoded = unicodeDecode(value);
  if (Result.isSuccess(decoded)) throw new Error("Expected malformed Unicode");
  return new JsonOutcomeError({ reason: "invalidInput", cause: decoded.failure });
};

it("retains genuine canonical values and detaches escaping or forged values", () => {
  const foreign = { nested: { values: ["雪 🚀", 1] } };
  const captured = success(captureJsonOutcomeValue(foreign, 1024));
  expect(captured.value).not.toBe(foreign);
  expect(inspectCapturedPrivateJsonData(captured.value)).toMatchObject({
    bytes: captured.bytes, negativeZero: false, wellFormedUnicode: true,
  });
  expect(success(useJsonOutcomeValue(captured.value, captured.bytes)).value).toBe(captured.value);
  const escaped = success(captureJsonOutcomeValue(captured.value, captured.bytes));
  expect(escaped.value).toEqual(captured.value);
  expect(escaped.value).not.toBe(captured.value);
  if (!isJsonObject(escaped.value) || !isJsonObject(captured.value)) throw new Error("Expected captured object");
  expect(escaped.value.nested).not.toBe(captured.value.nested);
  const forged = Object.freeze(structuredClone(captured.value));
  expect(inspectCapturedPrivateJsonData(forged)).toBeUndefined();
  const retained = success(useJsonOutcomeValue(forged, captured.bytes));
  expect(retained.value).not.toBe(forged);
  foreign.nested.values[0] = "changed";
  expect(captured.value).toEqual({ nested: { values: ["雪 🚀", 1] } });
  expect(useJsonOutcomeValue(captured.value, captured.bytes - 1))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: undefined } });
});

it("normalizes negative zero while retaining independently issued canonical children", () => {
  const native = success(capturePrivateJsonData({ zero: -0, child: { number: 1 } }, 1024, failure));
  const canonical = success(useJsonOutcomeValue(native.value, native.bytes));
  if (!isJsonObject(native.value) || !isJsonObject(canonical.value)) throw new Error("Expected captured numbers");
  expect(canonical.value).not.toBe(native.value);
  expect(Object.is(canonical.value.zero, 0)).toBe(true);
  expect(Object.is(native.value.zero, -0)).toBe(true);
  expect(canonical.value.child).toBe(native.value.child);
  expect(inspectCapturedPrivateJsonData(canonical.value)).toMatchObject({ negativeZero: false, wellFormedUnicode: true });
  expect(canonical.bytes).toBe(native.bytes);
  expect(success(useJsonOutcomeValue(canonical.value, canonical.bytes)).value).toBe(canonical.value);
});

it("keeps escaped lone surrogates valid for generic capture and defers outcome Unicode refusal", () => {
  const malformed = { "\udfff": "\ud800" };
  const native = success(capturePrivateJsonData(malformed, 1024, failure));
  expect(native.value).toEqual(malformed);
  expect(inspectCapturedPrivateJsonData(native.value)).toMatchObject({ wellFormedUnicode: false });
  expect(captureJsonOutcomeValue(malformed, 1024)).toEqual(Result.fail(unicodeFailure("\udfff")));
  expect(useJsonOutcomeValue(native.value, native.bytes)).toEqual(Result.fail(unicodeFailure("\udfff")));
  const escapedNative = success(capturePrivateJsonData(native.value, native.bytes, failure));
  expect(escapedNative.value).not.toBe(native.value);
  expect(inspectCapturedPrivateJsonData(escapedNative.value)).toMatchObject({ wellFormedUnicode: false });
  expect(useJsonOutcomeValue(escapedNative.value, escapedNative.bytes)).toEqual(Result.fail(unicodeFailure("\udfff")));
  expect(captureJsonOutcomeValue(malformed, 5))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: undefined } });
  expect(captureJsonOutcomeValue({ first: "\ud800", later: "x".repeat(100) }, 30))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: undefined } });
  const getter = vi.fn(() => "unsafe");
  const accessor = Object.defineProperty({ first: "\ud800" }, "later", { get: getter, enumerable: true });
  expect(captureJsonOutcomeValue(accessor, 1024))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput", cause: undefined } });
  expect(getter).not.toHaveBeenCalled();
  const cause = new Error("Later structural refusal");
  const later = new Proxy({}, { getPrototypeOf() { throw cause; } });
  expect(captureJsonOutcomeValue({ first: "\ud800", later }, 1024))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput", cause } });
});

it("selects malformed Unicode in detached native numeric-key order after foreign proxy capture", () => {
  const source: Record<string, Json> = { z: "\ud800-z", 1: "\udfff-one", 0: "\ud800-zero" };
  const foreign = new Proxy(source, { ownKeys() { return ["z", "1", "0"]; } });
  expect(captureJsonOutcomeValue(foreign, 1024)).toEqual(Result.fail(unicodeFailure("\ud800-zero")));
  const issued = success(capturePrivateJsonData(foreign, 1024, failure));
  expect(Object.keys(issued.value ?? {})).toEqual(["0", "1", "z"]);
  expect(useJsonOutcomeValue(issued.value, issued.bytes)).toEqual(Result.fail(unicodeFailure("\ud800-zero")));
});

it("preserves canonical bytes, immutable value identity and full stored digest verification", async () => {
  const captured = success(captureJsonOutcomeValue({ z: [-0, "雪"], "$ne": { value: true } }, 1024));
  const canonical = success(canonicalizeJsonOutcome(captured.value, captured.bytes));
  expect(canonical.valueJson).toBe(captured.value);
  expect(canonical.canonicalText).toBe('{"$ne":{"value":true},"z":[0,"雪"]}');
  const bytes = canonical.canonicalBytes;
  const digest = new Uint8Array(createHash("sha256").update(bytes).digest());
  const verified = await runEffect(verifyJsonOutcome(bytes, digest));
  expect(verified.valueJson).toEqual(canonical.valueJson);
  expect(verified.valueJson).not.toBe(canonical.valueJson);
  expect(verified.canonicalBytes).toEqual(bytes);
  expect(verified.sha256).toEqual(digest);
  bytes.fill(0);
  expect(canonical.canonicalBytes).not.toEqual(bytes);
  const wrongDigest = await runEffect(Effect.result(verifyJsonOutcome(canonical.canonicalBytes, new Uint8Array(32))));
  expect(wrongDigest).toMatchObject({ _tag: "Failure", failure: { reason: "invalidEvidence" } });
  expect(canonicalizeJsonOutcome(captured.value, captured.bytes - 1))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("fully captures foreign canonicalization input without executing getters", () => {
  let descriptorReads = 0;
  const input = { values: [1] };
  const foreign = new Proxy(input, {
    getOwnPropertyDescriptor(target, key) { descriptorReads++; return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  const outcome = success(canonicalizeJsonOutcome(foreign));
  expect(descriptorReads).toBe(1);
  input.values[0] = 9;
  expect(outcome.valueJson).toEqual({ values: [1] });
  expect(outcome.canonicalText).toBe('{"values":[1]}');
  const getter = vi.fn(() => 1);
  expect(canonicalizeJsonOutcome(Object.defineProperty({}, "value", { get: getter, enumerable: true })))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(getter).not.toHaveBeenCalled();
});
