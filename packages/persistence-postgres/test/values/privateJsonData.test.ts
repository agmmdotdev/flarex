import { Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { expect, it } from "vitest";
import { capturePrivateJsonData, capturePrivateJsonDataOmittingUndefined, capturePrivateIntermediateJsonData, inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "../../src/values/privateJsonData";

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

it("captures omission descriptors once and issues exact immutable accounting", () => {
  const reflected: string[] = [];
  const source = { omitted: undefined, nested: ["雪", -0, { absent: undefined, kept: true }] };
  const foreign = new Proxy(source, {
    ownKeys(target) { reflected.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { reflected.push(String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  const omitted: string[][] = [];
  const captured = success(capturePrivateJsonDataOmittingUndefined(foreign,
    { bytes: 1024, nodes: 20, depth: 16 }, failure, path => omitted.push([...path])));
  expect(reflected).toEqual(["keys", "omitted", "nested"]);
  expect(omitted).toEqual([["omitted"], ["nested", "2", "absent"]]);
  expect(captured.value).toEqual({ nested: ["雪", -0, { kept: true }] });
  expect(inspectCapturedPrivateJsonData(captured.value)).toMatchObject({
    bytes: captured.bytes, nodes: 6, depth: 3, negativeZero: true,
  });
  expect(captured.bytes).toBe(new TextEncoder().encode(JSON.stringify(captured.value)).length);
  source.nested[0] = "changed";
  expect(captured.value).toEqual({ nested: ["雪", -0, { kept: true }] });
  const exact = success(capturePrivateJsonDataOmittingUndefined(captured.value,
    { bytes: captured.bytes, nodes: 6, depth: 3 }, failure));
  expect(exact.value).toBe(captured.value);
  expect(capturePrivateJsonDataOmittingUndefined(captured.value,
    { bytes: captured.bytes - 1, nodes: 6, depth: 3 }, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  if (!isJsonObject(captured.value) || !Array.isArray(captured.value.nested)) throw new Error("Missing captured members");
  expect(inspectCapturedPrivateJsonData(captured.value.nested)).toMatchObject({ nodes: 5, depth: 2 });
  expect(inspectCapturedPrivateJsonData(foreign)).toBeUndefined();
});

it("retains strict byte refusal before reflecting later foreign children", () => {
  let inspections = 0;
  const later = new Proxy({}, { getPrototypeOf() { inspections++; throw new Error("Later foreign input"); } });
  expect(capturePrivateJsonData({ first: "x".repeat(100), later }, 20, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(inspections).toBe(0);
});

it("preserves normalized container key-count precedence and omitted key accounting", () => {
  const bounds = { bytes: 3, nodes: 20, depth: 16 };
  expect(capturePrivateJsonDataOmittingUndefined({ a: Infinity, b: 1, c: 2 }, bounds, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(capturePrivateJsonDataOmittingUndefined({ a: Infinity }, { ...bounds, bytes: 1024 }, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  const omittedOnly = success(capturePrivateJsonDataOmittingUndefined({ a: undefined, b: undefined, c: undefined },
    { ...bounds, bytes: 2 }, failure));
  expect(omittedOnly).toEqual({ value: {}, bytes: 2 });
  expect(inspectCapturedPrivateJsonData(omittedOnly.value)).toMatchObject({ nodes: 1, depth: 0 });
});

it("captures only genuine own undefined slots under the explicit intermediate representation", () => {
  const source = { "0": undefined, nested: [undefined, null, { missing: undefined, kept: true }], text: "雪" };
  const captured = success(capturePrivateIntermediateJsonData(source, { bytes: 1024, nodes: 20, depth: 16 }, failure));
  expect(captured.value).toEqual({ nested: [null, null, { kept: true }], text: "雪" });
  expect(captured.undefinedPaths).toEqual([["0"], ["nested", 0], ["nested", 2, "missing"]]);
  expect(Object.isFrozen(captured.undefinedPaths)).toBe(true);
  expect(captured.undefinedPaths.every(Object.isFrozen)).toBe(true);
  expect(inspectCapturedPrivateJsonData(captured.value)).toMatchObject({ bytes: captured.bytes, nodes: 7, depth: 3 });
  source.nested[0] = { missing: undefined, kept: false };
  expect(captured.value).toEqual({ nested: [null, null, { kept: true }], text: "雪" });
  // Ordinary JSON and native object-omission callers keep their prior refusal.
  for (const capture of [capturePrivateJsonData([undefined], 1024, failure),
    capturePrivateJsonDataOmittingUndefined([undefined], { bytes: 1024, nodes: 20, depth: 16 }, failure)])
    expect(capture).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(capturePrivateIntermediateJsonData(undefined, { bytes: 1024, nodes: 20, depth: 16 }, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  const counterfeit = { payload: [null], undefinedPaths: [[0]] };
  const ordinary = success(capturePrivateIntermediateJsonData(counterfeit, { bytes: 1024, nodes: 20, depth: 16 }, failure));
  expect(ordinary.value).toEqual(counterfeit); expect(ordinary.undefinedPaths).toEqual([]);
});

it("keeps intermediate array descriptor capture singular and all invalid structures refused", () => {
  const inspected: string[] = [];
  const source = new Proxy([undefined], { ownKeys(target) { inspected.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { inspected.push(String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
  expect(success(capturePrivateIntermediateJsonData(source, { bytes: 1024, nodes: 20, depth: 16 }, failure)).undefinedPaths).toEqual([[0]]);
  expect(inspected).toEqual(["keys", "0", "length"]);
  let calls = 0;
  const getter = Object.defineProperty([0], "0", { enumerable: true, get() { calls++; return undefined; } });
  const hidden = Object.defineProperty({}, "absent", { enumerable: false, value: undefined });
  const custom = Object.setPrototypeOf([undefined], {}), cycle: unknown[] = [];
  cycle.push(cycle);
  for (const input of [Array(1), Object.assign(Array(3), { 0: undefined, 2: undefined }), getter, hidden, custom, { [Symbol("absent")]: undefined }, cycle])
    expect(capturePrivateIntermediateJsonData(input, { bytes: 1024, nodes: 20, depth: 16 }, failure))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  expect(calls).toBe(0);
});

it("retains byte, node and depth bounds and accounts undefined-path metadata as ordinary JSON", () => {
  const source = { value: [undefined] }, bounds = { bytes: 1024, nodes: 4, depth: 2 };
  const captured = success(capturePrivateIntermediateJsonData(source, bounds, failure));
  expect(captured.bytes).toBe(new TextEncoder().encode(JSON.stringify(captured.value)).length);
  expect(success(capturePrivateIntermediateJsonData(source, { ...bounds, bytes: captured.bytes }, failure)).value).toEqual(captured.value);
  for (const limited of [{ ...bounds, bytes: captured.bytes - 1 }, { ...bounds, nodes: 3 }, { ...bounds, depth: 1 }])
    expect(capturePrivateIntermediateJsonData(source, limited, failure))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  const envelope = { payload: captured.value, undefinedPaths: captured.undefinedPaths };
  const budgeted = success(useCapturedPrivateJsonData(envelope, 1024, failure));
  expect(budgeted.bytes).toBe(new TextEncoder().encode(JSON.stringify(envelope)).length);
  expect(budgeted.bytes).toBeGreaterThan(captured.bytes);
  expect(useCapturedPrivateJsonData(envelope, captured.bytes, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(capturePrivateIntermediateJsonData({ ["key".repeat(100)]: undefined }, { ...bounds, bytes: 30 }, failure))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});

it("selects the first refusal and the exact charge across representative inputs", () => {
  const nest = (leaf: unknown, levels: number): unknown => { let value = leaf; for (let level = 0; level < levels; level++) value = [value]; return value; };
  const accessor = (): object => Object.defineProperty({ first: "x".repeat(50) }, "later", { enumerable: true, get: () => { throw new Error("getter read"); } });
  const cycle: unknown[] = [1]; cycle.push(cycle);
  const wide = { bytes: 1024, nodes: 20, depth: 16 };
  const strict = (input: unknown, maximum: number, policy?: Parameters<typeof capturePrivateJsonData>[3]) =>
    capturePrivateJsonData(input, maximum, failure, policy);
  const omitting = (input: unknown, bounds: typeof wide) => capturePrivateJsonDataOmittingUndefined(input, bounds, failure);
  const cases: readonly (readonly [string, () => ReturnType<typeof strict>, "invalidInput" | "limitExceeded" | number])[] = [
    ["bytes before a later invalid member", () => strict(["x".repeat(50), () => 1], 10), "limitExceeded"],
    ["invalid member before later bytes", () => strict([() => 1, "x".repeat(50)], 10), "invalidInput"],
    ["symbol key before the container charge", () => strict({ a: 1, [Symbol("k")]: 2 }, 1), "invalidInput"],
    ["key count before members", () => strict([Number.NaN, 2, 3, 4, 5], 4), "limitExceeded"],
    ["first member before key count allows it", () => strict([Number.NaN, 2, 3, 4, 5], 1024), "invalidInput"],
    ["sparse array", () => strict(Object.assign(Array(3), { 0: 1, 2: 3 }), 1024), "invalidInput"],
    ["array with a named member", () => strict(Object.assign([1], { extra: 1 }), 1024), "invalidInput"],
    ["accessor after bytes ran out", () => strict(accessor(), 10), "limitExceeded"],
    ["accessor within budget", () => strict(accessor(), 1024), "invalidInput"],
    ["depth before the leaf type", () => strict(nest(() => 1, 65), 1024), "limitExceeded"],
    ["invalid leaf at the deepest admitted level", () => strict(nest(() => 1, 64), 1024), "invalidInput"],
    ["deepest admitted tree", () => strict(nest(1, 64), 1024), 129],
    ["scalar under an invalid budget", () => strict(1, Number.NaN), "invalidInput"],
    ["container under a negative budget", () => strict({}, -1), "limitExceeded"],
    ["bytes before malformed Unicode", () => strict({ bad: "\ud800" }, 10, { wellFormedUnicode: true }), "limitExceeded"],
    ["malformed Unicode after complete capture", () => strict({ ok: "a", bad: "\ud800" }, 1024, { wellFormedUnicode: true }), "invalidInput"],
    ["malformed key after complete capture", () => strict({ "k\udc00": 1 }, 1024, { wellFormedUnicode: true }), "invalidInput"],
    ["escaped surrogates, own __proto__ and negative zero", () => strict(JSON.parse('{"__proto__":1,"雪":[-0,"\\ud800"],"n":null}'), 1024), 43],
    ["exact budget", () => strict({ a: [true, "é"] }, 17), 17],
    ["one byte short", () => strict({ a: [true, "é"] }, 16), "limitExceeded"],
    ["native descriptor before strict bytes", () => omitting(accessor(), { ...wide, bytes: 10 }), "invalidInput"],
    ["native nodes before a later invalid member", () => omitting({ a: [1, 2, 3], b: Number.NaN }, { ...wide, nodes: 3 }), "limitExceeded"],
    ["invalid member within native bounds", () => omitting({ a: [1, 2, 3], b: Number.NaN }, wide), "invalidInput"],
    ["native depth", () => omitting([[1]], { ...wide, depth: 1 }), "limitExceeded"],
    ["native cycle", () => omitting(cycle, wide), "invalidInput"],
    ["dense check after members", () => omitting(Object.assign(Array(2), { 1: () => 1 }), wide), "invalidInput"],
    ["omitted members are not charged", () => omitting({ a: undefined, b: [1, { c: undefined, d: "雪" }] }, wide), 21],
    ["strict bytes after native validation", () => omitting({ a: undefined, b: "x".repeat(50) }, { ...wide, bytes: 10 }), "limitExceeded"],
  ];
  for (const [name, run, expected] of cases) {
    const result = run();
    expect(Result.isSuccess(result) ? result.success.bytes : result.failure.reason, name).toBe(expected);
    if (Result.isSuccess(result))
      expect(result.success.bytes, name).toBe(new TextEncoder().encode(JSON.stringify(result.success.value)).length);
  }
});

it("defines captured members and elements without consulting inherited accessors or descriptor fields", () => {
  const objectPrototype: object = Object.prototype, arrayPrototype: object = Array.prototype;
  const text = '{"polluted":1,"__proto__":{"a":1},"toString":2,"0":"zero","nested":[["a","b"],{"polluted":"x","get":[3,4]},"c"]}';
  const bounds = { bytes: 1024, nodes: 100, depth: 16 };
  const issued = success(capturePrivateJsonData(JSON.parse(text), 1024, failure));
  let consulted = 0;
  type Captured = ReturnType<typeof capturePrivateJsonData<ReturnType<typeof failure>>>;
  // Named slots: writing results into an array here would itself meet the accessors.
  let freshResult: Captured | undefined, omittingResult: Captured | undefined, usedResult: Captured | undefined,
    detachedResult: Captured | undefined, wrappedResult: Captured | undefined;
  const accessor = { configurable: true, get() { consulted++; return undefined; }, set() { consulted++; } };
  const installed: (readonly [object, string])[] = [[objectPrototype, "polluted"], [objectPrototype, "0"], [objectPrototype, "2"],
    [arrayPrototype, "1"], [arrayPrototype, "0"]];
  for (const [prototype, key] of installed) Object.defineProperty(prototype, key, accessor);
  Object.defineProperty(objectPrototype, "get", { configurable: true, value: () => 1 });
  try {
    const input: unknown = JSON.parse(text);
    freshResult = capturePrivateJsonData(input, 1024, failure);
    omittingResult = capturePrivateJsonDataOmittingUndefined(input, bounds, failure);
    usedResult = useCapturedPrivateJsonData(input, 1024, failure);
    // An issued tree escaping to another owner is copied by the detach path.
    detachedResult = capturePrivateJsonData(issued.value, 1024, failure);
    wrappedResult = capturePrivateJsonData({ wrapped: [issued.value] }, 1024, failure);
  } finally {
    for (const [prototype, key] of installed) Reflect.deleteProperty(prototype, key);
    Reflect.deleteProperty(objectPrototype, "get");
  }
  if (freshResult === undefined || omittingResult === undefined || usedResult === undefined || detachedResult === undefined || wrappedResult === undefined)
    throw new Error("Missing capture under inherited accessors");
  expect(consulted).toBe(0);
  const fresh = success(freshResult), omitting = success(omittingResult), used = success(usedResult),
    detached = success(detachedResult), wrapped = success(wrappedResult);
  for (const captured of [fresh, omitting, used, detached]) {
    expect(JSON.stringify(captured.value)).toBe('{"0":"zero","polluted":1,"__proto__":{"a":1},"toString":2,"nested":[["a","b"],{"polluted":"x","get":[3,4]},"c"]}');
    expect(captured.bytes).toBe(issued.bytes);
    expect(Object.getPrototypeOf(captured.value)).toBe(Object.prototype);
    expect(Object.hasOwn(Object(captured.value), "__proto__")).toBe(true);
  }
  expect(detached.value).not.toBe(issued.value);
  expect(detached.value).toEqual(issued.value);
  expect(JSON.stringify(wrapped.value)).toBe(`{"wrapped":[${JSON.stringify(issued.value)}]}`);
  // Every array is dense with own data elements, whichever path built it.
  const arrays = (value: unknown): unknown[][] => Array.isArray(value) ? [value, ...value.flatMap(arrays)]
    : typeof value === "object" && value !== null ? Object.values(value).flatMap(arrays) : [];
  for (const captured of [fresh, omitting, used, detached, wrapped]) {
    expect(arrays(captured.value)).toHaveLength(captured === wrapped ? 4 : 3);
    for (const array of arrays(captured.value)) expect(Object.keys(array)).toHaveLength(array.length);
  }
});
