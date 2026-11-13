import { expect, it, vi } from "vitest";
import { Result } from "effect";
import { capturePrivateIntermediateJsonData, inspectCapturedPrivateJsonData, commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../src/value/input";
import { captureWorkflowCommandInput, captureWorkflowInput, decodeWorkflowCommandInput, type WorkflowIntermediateValue } from "../src/workflow/value";
import { storeOrderReadResources } from "../src/modules/order/store-read-input";

const bounds = { bytes: defaultCommerceResources.commandBytes, nodes: defaultCommerceResources.valueNodes, depth: 16 };
const chain = (depth: number, leaf: WorkflowIntermediateValue = "leaf"): WorkflowIntermediateValue => {
  let value = leaf;
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
};

it("preserves source-wrapper depth16 through the additional transport level", () => {
  const input = chain(15), source = Result.getOrThrow(capturePrivateIntermediateJsonData({ value: input }, bounds, commerceError));
  expect(inspectCapturedPrivateJsonData(source.value)).toMatchObject({ depth: 16, nodes: 17 });
  const expected = { payload: source.value, undefinedPaths: source.undefinedPaths };
  const transport = Result.getOrThrow(capturePrivateIntermediateJsonData(expected, { ...bounds, depth: bounds.depth + 1 }, commerceError));
  expect(inspectCapturedPrivateJsonData(transport.value)).toMatchObject({ depth: 17, nodes: 19 });
  // Ordinary native JSON retains depth16. Only this private transport owns its
  // extra payload level, after the unchanged source capture has succeeded.
  expect(captureCommerceInput(expected)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(Result.getOrThrow(captureWorkflowInput(input))).toEqual(input);
  const encoded = Result.getOrThrow(captureWorkflowCommandInput(input));
  expect(JSON.stringify(encoded)).toBe(JSON.stringify(expected));
  const decode = vi.fn((value: unknown) => Result.succeed(value));
  expect(Result.getOrThrow(decodeWorkflowCommandInput(JSON.parse(JSON.stringify(encoded)), decode))).toEqual(input);
  expect(decode).toHaveBeenCalledExactlyOnceWith(input);
});

it("continues refusing source-wrapper depth17 before the authoritative decoder", () => {
  const input = chain(16), source = capturePrivateIntermediateJsonData({ value: input }, bounds, commerceError);
  expect(source).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(captureWorkflowInput(input)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(captureWorkflowCommandInput(input)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const decode = vi.fn((value: unknown) => Result.succeed(value));
  expect(decodeWorkflowCommandInput({ payload: { value: input }, undefinedPaths: [] }, decode))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(decode).not.toHaveBeenCalled();
});

it("retains deepest admitted object presence, dense undefined positions and serialized path shape", () => {
  for (const input of [chain(14, { own: undefined, keep: "leaf" }), chain(14, [undefined])]) {
    const source = Result.getOrThrow(capturePrivateIntermediateJsonData({ value: input }, bounds, commerceError));
    expect(source.undefinedPaths).toHaveLength(1); expect(source.undefinedPaths[0]).toHaveLength(16);
    const retained = Result.getOrThrow(captureWorkflowInput(input, "preserveOwnUndefined"));
    expect(retained).toEqual(input); expect(retained).not.toBe(input);
    const encoded = Result.getOrThrow(captureWorkflowCommandInput(input));
    expect(encoded).toEqual({ payload: source.value, undefinedPaths: source.undefinedPaths });
    expect(Result.getOrThrow(decodeWorkflowCommandInput(JSON.parse(JSON.stringify(encoded)), value => Result.succeed(value)))).toEqual(input);
  }
  expect(Result.getOrThrow(captureWorkflowInput(chain(14, { own: undefined, keep: "leaf" })))).toEqual(chain(14, { keep: "leaf" }));
  expect(Result.getOrThrow(captureWorkflowInput(chain(14, [undefined])))).toEqual(chain(14, [undefined]));
});

it("retains the complete transport node and byte caps", () => {
  const input = Array.from({ length: bounds.nodes - 2 }, () => 0);
  expect(Result.isSuccess(capturePrivateIntermediateJsonData({ value: input }, bounds, commerceError))).toBe(true);
  for (const capture of [captureWorkflowInput, captureWorkflowCommandInput])
    expect(capture(input)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const key = "k".repeat(Math.floor(bounds.bytes / 3));
  expect(captureWorkflowCommandInput({ [key]: { [key]: undefined } }))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const decode = vi.fn((value: unknown) => Result.succeed(value));
  expect(decodeWorkflowCommandInput({ payload: { value: input }, undefinedPaths: [] }, decode))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(decode).not.toHaveBeenCalled();
});

it("uses an explicit native read value budget while retaining ordinary capture and descriptor refusals", () => {
  const input = { values: Array.from({ length: 9_000 }, () => 0), own: undefined, dense: [undefined] };
  expect(captureWorkflowInput(input, "preserveOwnUndefined"))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const captured = Result.getOrThrow(captureWorkflowInput(input, "preserveOwnUndefined", storeOrderReadResources));
  expect(captured).toEqual(input); expect(captured).not.toBe(input);
  let getters = 0;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { getters++; return 1; } });
  expect(captureWorkflowInput(getter, "preserveOwnUndefined", storeOrderReadResources))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(getters).toBe(0);
  expect(captureWorkflowCommandInput(input)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("charges the selected source and complete undefined sidecar envelope independently", () => {
  const positions = Array.from({ length: 9_000 }, () => undefined);
  expect(Result.getOrThrow(captureWorkflowInput(positions, "preserveOwnUndefined", storeOrderReadResources))).toEqual(positions);
  for (const input of [Array.from({ length: storeOrderReadResources.valueNodes }, () => 0),
    Array.from({ length: 18_000 }, () => undefined)])
    expect(captureWorkflowInput(input, "preserveOwnUndefined", storeOrderReadResources))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});
