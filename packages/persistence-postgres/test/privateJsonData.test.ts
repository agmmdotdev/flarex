import { Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { expect, it } from "vitest";
import { capturePrivateJsonData, inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "../src/privateJsonData";

const failure = (reason: "invalidInput" | "limitExceeded", cause?: unknown) => ({ reason, cause });
const success = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) throw new Error("Unexpected capture refusal", { cause: result.failure });
  return result.success;
};

it("reuses exact captured trees internally while foreign and escaping values detach", () => {
  const input = { rows: [{ title: "雪 \ud83d\ude80", nested: { count: 1 } }] };
  const captured = success(capturePrivateJsonData(input, 1024, failure));
  input.rows[0]!.nested.count = 9;
  expect(captured.value).toEqual({ rows: [{ title: "雪 \ud83d\ude80", nested: { count: 1 } }] });
  expect(inspectCapturedPrivateJsonData(input)).toBeUndefined();
  expect(inspectCapturedPrivateJsonData(Object.freeze(structuredClone(captured.value)))).toBeUndefined();
  const used = success(useCapturedPrivateJsonData(captured.value, captured.bytes, failure));
  expect(used.value).toBe(captured.value);
  expect(used.bytes).toBe(captured.bytes);
  const escaped = success(capturePrivateJsonData(captured.value, captured.bytes, failure));
  expect(escaped.value).toEqual(captured.value);
  expect(escaped.value).not.toBe(captured.value);
  const wrapper = success(useCapturedPrivateJsonData([captured.value], 1024, failure));
  if (!Array.isArray(wrapper.value)) throw new Error("Missing wrapper array");
  expect(wrapper.value[0]).toBe(captured.value);
  expect(success(capturePrivateJsonData(wrapper.value, 1024, failure)).value).not.toBe(wrapper.value);
  expect(useCapturedPrivateJsonData(captured.value, captured.bytes - 1, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("retains relative depth and ordered byte refusal when issued children enter new wrappers", () => {
  let input: unknown = null;
  for (let depth = 0; depth < 64; depth++) input = [input];
  const captured = success(capturePrivateJsonData(input, 1024, failure));
  expect(inspectCapturedPrivateJsonData(captured.value)?.depth).toBe(64);
  expect(useCapturedPrivateJsonData([captured.value], 1024, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(capturePrivateJsonData([captured.value], 1024, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const large = success(capturePrivateJsonData({ value: "x".repeat(100) }, 1024, failure));
  let getterCalls = 0;
  const hidden = Object.defineProperty({ first: large.value }, "later", { enumerable: true,
    get() { getterCalls++; return "hidden"; } });
  expect(useCapturedPrivateJsonData(hidden, 40, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(useCapturedPrivateJsonData(hidden, 1024, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(getterCalls).toBe(0);
});

it("does not grant captured ownership to proxy, prototype, sparse or symbol copies", () => {
  const captured = success(capturePrivateJsonData({ value: [1] }, 1024, failure));
  if (captured.value === null || typeof captured.value !== "object") throw new Error("Missing captured object");
  const proxy = new Proxy(captured.value, { ownKeys() { throw new Error("foreign proxy"); } });
  expect(inspectCapturedPrivateJsonData(proxy)).toBeUndefined();
  for (const input of [proxy, Object.create(captured.value), Array(1), { [Symbol("foreign")]: 1 }])
    expect(useCapturedPrivateJsonData(input, 1024, failure))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
});

it("normalizes negative zero only under the binding's explicit canonical-number policy", () => {
  const original = success(capturePrivateJsonData({ nested: [-0, 0, 1] }, 1024, failure));
  if (!isJsonObject(original.value) ||
    !Array.isArray(original.value.nested)) throw new Error("Missing captured numbers");
  expect(Object.is(original.value.nested[0], -0)).toBe(true);
  expect(inspectCapturedPrivateJsonData(original.value)?.negativeZero).toBe(true);
  const canonical = success(capturePrivateJsonData(original.value, 1024, failure, { canonicalNumbers: true }));
  if (!isJsonObject(canonical.value) ||
    !Array.isArray(canonical.value.nested)) throw new Error("Missing canonical numbers");
  expect(Object.is(canonical.value.nested[0], 0)).toBe(true);
  expect(canonical.bytes).toBe(original.bytes);
  expect(inspectCapturedPrivateJsonData(canonical.value)?.negativeZero).toBe(false);
  expect(Object.is(original.value.nested[0], -0)).toBe(true);
  expect(success(useCapturedPrivateJsonData(original.value, 1024, failure)).value).toBe(original.value);
});
