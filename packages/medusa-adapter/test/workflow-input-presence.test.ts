import { describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { commerceDecoder } from "../src/value/decoder";
import { defineWorkflowMethod, workflowMethodDefinition } from "../src/workflow/module";
import { captureWorkflowCommandInput, captureWorkflowInput, decodeWorkflowCommandInput,
  type WorkflowIntermediateValue } from "../src/workflow/value";

const Value = Schema.Struct({
  own: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
  omitted: Schema.optionalKey(Schema.UndefinedOr(Schema.String)),
  presentNull: Schema.Null,
  nested: Schema.Struct({ own: Schema.Undefined, items: Schema.Array(Schema.UndefinedOr(Schema.String)) }),
});
const decodeValue = commerceDecoder(Value, "invalidInput");
const decodeArguments = commerceDecoder(Schema.Tuple([Value]), "invalidInput");
const command = defineGraphReadCommand("inputPresenceUnitRead", () => Effect.die("Unit boundary must never execute a command"));
const source = () => ({ own: undefined, presentNull: null,
  nested: { own: undefined, items: [undefined, "kept"] } });

function expectPresence(value: typeof Value.Type) {
  expect(Object.hasOwn(value, "own")).toBe(true);
  expect(value.own).toBeUndefined();
  expect(Object.hasOwn(value, "omitted")).toBe(false);
  expect(value.presentNull).toBeNull();
  expect(Object.hasOwn(value.nested, "own")).toBe(true);
  expect(Object.hasOwn(value.nested.items, 0)).toBe(true);
  expect(value.nested.items).toEqual([undefined, "kept"]);
}

describe("workflow method input presence", () => {
  it("preserves object presence before decoding and through the command JSON transport", () => {
    const foreign = source(), before = structuredClone(foreign);
    const argumentsDecoder = vi.fn(decodeArguments);
    const method = Result.getOrThrow(defineWorkflowMethod({ command, inputPresence: "preserveOwnUndefined",
      arguments: argumentsDecoder, encode: ([value]) => value,
      output: value => Result.succeed(value),
    }));
    const definition = workflowMethodDefinition(method);
    if (definition === undefined) throw new Error("Missing authentic method definition");
    const input = Result.getOrThrow(definition.input([foreign]));
    const decoded = argumentsDecoder.mock.results[0];
    if (decoded?.type !== "return") throw new Error("Argument decoder did not return");
    expectPresence(Result.getOrThrow(decoded.value)[0]);
    // The actual wire value is pure JSON; no own undefined survives by accident.
    const wire: unknown = JSON.parse(JSON.stringify(input));
    const output = Result.getOrThrow(decodeWorkflowCommandInput(wire, decodeValue));
    expectPresence(output);
    expect(output).not.toBe(foreign);
    expect(output.nested).not.toBe(foreign.nested);
    Object.defineProperty(output.nested, "mutable", { value: true, enumerable: true });
    expect(foreign).toEqual(before);
  });

  it("retains default method and Query capture omission without a transport envelope", () => {
    const input = [{ own: undefined, nested: { own: undefined }, presentNull: null }, undefined];
    const captured = Result.getOrThrow(captureWorkflowInput(input));
    const expected = [{ nested: {}, presentNull: null }, undefined];
    expect(captured).toEqual(expected);
    const DefaultArguments = Schema.Tuple([Schema.JsonObject]);
    const method = Result.getOrThrow(defineWorkflowMethod({ command,
      arguments: commerceDecoder(DefaultArguments, "invalidInput"),
      encode: ([value]: typeof DefaultArguments.Type) => value, output: value => Result.succeed(value),
    }));
    const definition = workflowMethodDefinition(method);
    if (definition === undefined) throw new Error("Missing default method definition");
    expect(Result.getOrThrow(definition.input([input[0]]))).toEqual(expected[0]);
  });

  it.each([undefined, null, "value", [undefined], { value: undefined },
    { nested: { value: undefined } }])("round trips an intermediate value %#", value => {
    const captured = Result.getOrThrow(captureWorkflowCommandInput(value));
    const decode = vi.fn((input: unknown) => Result.succeed(input));
    const restored = Result.getOrThrow(decodeWorkflowCommandInput(JSON.parse(JSON.stringify(captured)), decode));
    expect(restored).toEqual(value);
    expect(decode).toHaveBeenCalledExactlyOnceWith(restored);
    if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "value"))
      expect(restored !== null && typeof restored === "object" && Object.hasOwn(restored, "value")).toBe(true);
  });

  it.each([null, false, "omit", "preserve", {}, ["preserveOwnUndefined"]])("refuses invalid registration policy %#", policy => {
    const config = { command, inputPresence: "preserveOwnUndefined" as const,
      arguments: decodeArguments, encode: ([value]: readonly [typeof Value.Type]) => value,
      output: (value: unknown) => Result.succeed(value) };
    Object.defineProperty(config, "inputPresence", { value: policy, enumerable: true });
    expect(defineWorkflowMethod(config)).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("captures registration policy without invoking an accessor", () => {
    const getter = vi.fn(() => "preserveOwnUndefined");
    const config = { command, inputPresence: "preserveOwnUndefined" as const,
      arguments: decodeArguments, encode: ([value]: readonly [typeof Value.Type]) => value,
      output: (value: unknown) => Result.succeed(value) };
    Object.defineProperty(config, "inputPresence", { get: getter, enumerable: true });
    expect(Result.isFailure(defineWorkflowMethod(config))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { payload: {}, undefinedPaths: [] },
    { payload: {}, undefinedPaths: [["foreign"]] },
    { payload: { value: {} }, undefinedPaths: [["value", "missing", "child"]] },
    { payload: { value: { own: null } }, undefinedPaths: [["value", "own"]] },
    { payload: { value: {} }, undefinedPaths: [["value", "own"], ["value", "own"]] },
    { payload: { value: [null] }, undefinedPaths: [["value", 0], ["value", 0]] },
    { payload: { value: [false] }, undefinedPaths: [["value", 0]] },
    { payload: { value: [null] }, undefinedPaths: [["value", "0"]] },
    { payload: { value: [null] }, undefinedPaths: [["value", 1]] },
    { payload: { value: [null] }, undefinedPaths: [["value", -1]] },
    { payload: { value: [null] }, undefinedPaths: [["value", 0.5]] },
    { payload: { value: [null] }, undefinedPaths: [["value", Number.MAX_SAFE_INTEGER + 1]] },
    { payload: {}, undefinedPaths: [Array(17).fill("value")] },
    { payload: {}, undefinedPaths: [[]] },
    { payload: {}, undefinedPaths: [["value"], ["value", "child"]] },
    { payload: { value: null, extra: null }, undefinedPaths: [] },
    { payload: { value: null }, undefinedPaths: [], extra: null },
    { payload: { value: undefined }, undefinedPaths: [] },
  ])("refuses malformed serialized paths before the module decoder %#", input => {
    const decode = vi.fn((value: unknown) => Result.succeed(value));
    expect(decodeWorkflowCommandInput(input, decode)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(decode).not.toHaveBeenCalled();
  });

  it("treats dangerous-looking object keys as data without mutating prototypes", () => {
    const input = Object.fromEntries([["__proto__", undefined], ["constructor", undefined], ["", undefined]]);
    const restored = Result.getOrThrow(decodeWorkflowCommandInput(
      Result.getOrThrow(captureWorkflowCommandInput(input)), value => Result.succeed(value)));
    expect(restored !== null && typeof restored === "object" && Object.hasOwn(restored, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("propagates the authoritative module decoder failure", () => {
    const failure = commerceError("unsupportedProfile");
    expect(decodeWorkflowCommandInput(Result.getOrThrow(captureWorkflowCommandInput(null)),
      () => Result.fail(failure))).toEqual(Result.fail(failure));
  });

  it("preserves descriptor, cycle, hole and finite-number capture refusals", () => {
    const getter = vi.fn(() => undefined), accessor = Object.defineProperty({}, "own", { enumerable: true, get: getter });
    const proxy = new Proxy({}, { ownKeys() { throw new Error("foreign reflection refused"); } });
    const cyclic: { self?: WorkflowIntermediateValue } = {}; cyclic.self = cyclic;
    const hole = new Array<WorkflowIntermediateValue>(1);
    for (const value of [accessor, proxy, cyclic, hole, Infinity, NaN]) {
      expect(Result.isFailure(captureWorkflowCommandInput(value))).toBe(true);
      expect(Result.isFailure(captureWorkflowInput(value, "preserveOwnUndefined"))).toBe(true);
      const decode = vi.fn((input: unknown) => Result.succeed(input));
      expect(Result.isFailure(decodeWorkflowCommandInput(value, decode))).toBe(true);
      expect(decode).not.toHaveBeenCalled();
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("bounds native values, serialized sidecars and their combined envelope", () => {
    const huge = "x".repeat(defaultCommerceResources.commandBytes + 1);
    expect(captureWorkflowCommandInput(huge)).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const decode = vi.fn((value: unknown) => Result.succeed(value));
    expect(decodeWorkflowCommandInput({ payload: { value: huge }, undefinedPaths: [] }, decode))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const paths = Array.from({ length: defaultCommerceResources.valueNodes + 1 }, () => ["value"]);
    expect(decodeWorkflowCommandInput({ payload: {}, undefinedPaths: paths }, decode))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    // Payload and sidecar each fit alone; their complete envelope does not.
    const key = "k".repeat(Math.floor(defaultCommerceResources.commandBytes / 3));
    expect(captureWorkflowCommandInput({ [key]: { [key]: undefined } }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    expect(decode).not.toHaveBeenCalled();
  });
});
