import { Result } from "effect";
import { expect, it } from "vitest";
import { captureCommerceInput } from "../src/commerce-input";
import { inspectCapturedPrivateJsonData } from "../../persistence-postgres/src/privateJsonData";
import { isJsonObject, type Json } from "flarex-protocol/json";

const captured = (input: unknown): Json => {
  const result = captureCommerceInput(input);
  if (Result.isFailure(result)) throw new Error("Unexpected native capture refusal", { cause: result.failure });
  return result.success;
};

it("preserves native node and relative-depth limits through exact issued handoffs", () => {
  const value = captured({ values: ["雪", true] });
  expect(inspectCapturedPrivateJsonData(value)).toMatchObject({ nodes: 4, depth: 2 });
  expect(captureCommerceInput(value, { commandBytes: 1024, valueNodes: 4 }))
    .toMatchObject({ _tag: "Success", success: value });
  const reused = captureCommerceInput(value);
  if (Result.isFailure(reused)) throw new Error("Missing captured native value");
  expect(reused.success).toBe(value);
  expect(captureCommerceInput([value], { commandBytes: 1024, valueNodes: 4 }))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  let deep: unknown = null;
  for (let depth = 0; depth < 16; depth++) deep = [deep];
  const atLimit = captured(deep);
  expect(captureCommerceInput([atLimit]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("keeps omission and descriptor refusal ahead of strict native byte measurement", () => {
  const paths: string[][] = [];
  const input = { absent: undefined, nested: { omitted: undefined, kept: "x" } };
  const result = captureCommerceInput(input, undefined, path => paths.push([...path]));
  expect(result).toMatchObject({ _tag: "Success", success: { nested: { kept: "x" } } });
  expect(paths).toEqual([["absent"], ["nested", "omitted"]]);
  let getterCalls = 0;
  const hidden = Object.defineProperty({ first: "x".repeat(200) }, "later", { enumerable: true,
    get() { getterCalls++; return "hidden"; } });
  expect(captureCommerceInput(hidden, { commandBytes: 10, valueNodes: 100 }))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(getterCalls).toBe(0);
  expect(captureCommerceInput({ nonfinite: Infinity, later: [1, 2] }, { commandBytes: 1024, valueNodes: 2 }))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const issued = captured({ value: [1] });
  if (!isJsonObject(issued)) throw new Error("Missing issued object");
  const copied = structuredClone(issued);
  expect(Reflect.set(copied, "value", "mutated")).toBe(true);
  expect(captured(copied)).toEqual({ value: "mutated" });
  expect(issued).toEqual({ value: [1] });
});
