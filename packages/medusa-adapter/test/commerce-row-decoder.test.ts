import { Result, Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { commerceDecoder, commerceRowDecoder } from "../src/value/decoder";
import { captureCommerceInput } from "../src/value/input";

const names = ["id", "title", "10", "2", "metadata", "variants", "__proto__"] as const;
const decodeRow = commerceRowDecoder(names, "invalidInput");
/** The complete Schema decode every row took before issued roots were recognized. */
const decodeSchema = commerceDecoder(Schema.Record(Schema.Literals(names), Schema.optionalKey(Schema.Json)), "invalidInput");
const source = (): unknown => JSON.parse('{"title":"shirt","10":1,"id":"prod_1","2":-0,"__proto__":{"own":true},' +
  '"metadata":{"tags":["a",{"deep":null}]},"variants":[{"sku":"S","prices":[{"amount":10}]}]}');
const issue = (input: unknown) => Result.getOrThrow(captureCommerceInput(input));
const member = (row: unknown, key: string): unknown => {
  if (typeof row !== "object" || row === null) throw new Error("Missing row");
  return Reflect.getOwnPropertyDescriptor(row, key)?.value;
};
/** Schema.Json validates every member container, classifying each one first. */
const walked = (work: () => unknown, container: unknown): number => {
  const spy = vi.spyOn(Array, "isArray");
  try {
    work();
    return spy.mock.calls.filter(([inspected]) => inspected === container).length;
  } finally {
    spy.mockRestore();
  }
};
const outcome = (result: Result.Result<unknown, { reason: string; cause?: unknown }>): unknown => Result.isSuccess(result)
  ? { keys: Reflect.ownKeys(Object(result.success)), text: JSON.stringify(result.success), frozen: Object.isFrozen(result.success),
    prototype: Object.getPrototypeOf(result.success) === Object.prototype, negativeZero: Object.is(member(result.success, "2"), -0) }
  : { reason: result.failure.reason, cause: String(result.failure.cause) };

afterEach(() => { vi.restoreAllMocks(); });

it("accepts an issued row by identity with the row the complete Schema decode returns", () => {
  const issued = issue(source());
  const variants = member(issued, "variants"), metadata = member(issued, "metadata");
  expect(walked(() => decodeSchema(issued), variants)).toBeGreaterThan(0);
  expect(walked(() => decodeRow(issued), variants)).toBe(0);
  expect(walked(() => decodeRow(issued), metadata)).toBe(0);
  const fast = decodeRow(issued), complete = decodeSchema(issued);
  expect(outcome(fast)).toEqual(outcome(complete));
  expect(outcome(fast)).toMatchObject({ keys: ["2", "10", "title", "id", "__proto__", "metadata", "variants"], frozen: false, prototype: true, negativeZero: true });
  const row = Result.getOrThrow(fast), reference = Result.getOrThrow(complete);
  expect(row).not.toBe(issued);
  for (const key of names) {
    expect(member(row, key)).toBe(member(issued, key));
    expect(member(reference, key)).toBe(member(issued, key));
    expect(Reflect.getOwnPropertyDescriptor(row, key)).toEqual(Reflect.getOwnPropertyDescriptor(reference, key));
  }
  // An issued member row is itself an issued root.
  const variant = member(variants, "0");
  const decodeVariant = commerceRowDecoder(["sku", "prices"], "invalidInput");
  expect(walked(() => decodeVariant(variant), member(variant, "prices"))).toBe(0);
  expect(Result.getOrThrow(decodeVariant(variant))).toEqual({ sku: "S", prices: [{ amount: 10 }] });
});

it("keeps the allowlist and object refusals of the complete decode for issued roots", () => {
  const excess = issue({ title: "shirt", variants: [{ sku: "S" }], handle: "shirt" });
  expect(Result.isFailure(decodeRow(excess))).toBe(true);
  expect(outcome(decodeRow(excess))).toEqual(outcome(decodeSchema(excess)));
  const array = issue([{ title: "shirt" }]);
  expect(Result.isFailure(decodeRow(array))).toBe(true);
  expect(outcome(decodeRow(array))).toEqual(outcome(decodeSchema(array)));
  expect(outcome(decodeRow(issue({})))).toEqual(outcome(decodeSchema(issue({}))));
});

it("still decodes frozen look-alikes and clones of issued roots completely", () => {
  const issued = issue(source());
  const freeze = (value: unknown): unknown => {
    if (typeof value === "object" && value !== null) { for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key)); Object.freeze(value); }
    return value;
  };
  for (const copy of [structuredClone(issued), freeze(structuredClone(issued)), freeze(source())]) {
    expect(walked(() => decodeRow(copy), member(copy, "variants"))).toBeGreaterThan(0);
    expect(outcome(decodeRow(copy))).toEqual(outcome(decodeSchema(copy)));
    expect(Result.isSuccess(decodeRow(copy))).toBe(true);
  }
  // The same shapes holding one value the capture owner would never issue.
  const mutated: unknown = structuredClone(issue({ title: "shirt", metadata: { size: 1 } }));
  const metadata = member(mutated, "metadata");
  if (typeof metadata !== "object" || metadata === null) throw new Error("Missing cloned metadata");
  Reflect.set(metadata, "size", 1n);
  const invalid = [
    freeze({ title: "shirt", variants: [{ sku: Number.NaN }] }),
    freeze({ title: "shirt", metadata: { at: new Date(0) } }),
    freeze({ title: "shirt", variants: [undefined] }),
    mutated,
  ];
  for (const copy of invalid) {
    expect(Result.isFailure(decodeRow(copy))).toBe(true);
    expect(outcome(decodeRow(copy))).toEqual(outcome(decodeSchema(copy)));
  }
});
