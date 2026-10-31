import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeValidatorJsonV1,
  decodeValidatorJsonWireV1,
  decodeValidatorJsonWireResultCoreV1,
  decodeValidatorJsonResultCoreV1,
  decodeValidatorLiteralSourceV1,
  decodeValidatorLiteralWireV1,
  encodeValidatorJsonV1,
  ObjectValidatorJsonWireCodecV1,
  ValidatorJson,
  ValidatorJsonWireCodecV1,
  validatorJsonHasNonfiniteLiteralV1,
  validatorLiteralEqualV1,
  validatorIsSubsetOfStringV1,
  validatorIsStringSubtypeWithStringLiteralV1,
  validatorIsValidRecordKeyV1,
  validatorSourceRecordIssueV1,
  type ValidatorJsonV1,
} from "../src/validator-json";

const decodeValidatorJson = Schema.decodeUnknownSync(ValidatorJson);
const decodeSemanticWireType = Schema.decodeUnknownSync(Schema.toType(ValidatorJsonWireCodecV1));

describe("ValidatorJson", () => {
  it("exposes the admission-bounded semantic decoder", () => {
    expect(decodeValidatorJsonV1({ type: "array", value: { type: "string" } })).toEqual({ type: "array", value: { type: "string" } });
    const cyclic: { type: "array"; value?: unknown } = { type: "array" };
    cyclic.value = cyclic;
    expect(() => decodeValidatorJsonV1(cyclic)).toThrow();
  });

  it("requires ID validators to name a non-empty table", () => {
    expect(decodeValidatorJson({ type: "id", tableName: "users" })).toEqual({ type: "id", tableName: "users" });
    expect(() => decodeValidatorJson({ type: "id", tableName: "" })).toThrow();
  });

  it("captures all float patterns and signed-int64 literals semantically", () => {
    for (const value of [Number.MAX_VALUE, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, -(1n << 63n), (1n << 63n) - 1n]) {
      const captured = decodeValidatorJson({ type: "literal", value });
      expect(captured.type).toBe("literal");
      if (captured.type === "literal") expect(validatorLiteralEqualV1(captured.value, value)).toBe(true);
    }
    for (const value of [-(1n << 63n) - 1n, 1n << 63n]) expect(() => decodeValidatorJson({ type: "literal", value })).toThrow();
    expect(() => decodeValidatorJson({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } })).toThrow();
  });

  it("projects exceptional numeric literal leaves and leaves existing primitive bytes unchanged", () => {
    for (const [value, wire] of [
      [0n, { $integer: "AAAAAAAAAAA=" }],
      [1n, { $integer: "AQAAAAAAAAA=" }],
      [-1n, { $integer: "//////////8=" }],
      [-(1n << 63n), { $integer: "AAAAAAAAAIA=" }],
      [(1n << 63n) - 1n, { $integer: "/////////38=" }],
      [-0, { $float: "AAAAAAAAAIA=" }],
      [Number.POSITIVE_INFINITY, { $float: "AAAAAAAA8H8=" }],
      [1, 1], [0, 0], [true, true], ["a\u0000b", "a\u0000b"],
    ] satisfies ReadonlyArray<readonly [string | boolean | number | bigint, unknown]>) {
      const encoded = encodeValidatorJsonV1({ type: "literal", value });
      expect(encoded).toEqual({ type: "literal", value: wire });
      const decoded = decodeValidatorJsonWireV1(encoded);
      expect(decoded.type).toBe("literal");
      if (decoded.type === "literal") expect(validatorLiteralEqualV1(decoded.value, value)).toBe(true);
    }
    expect(() => encodeValidatorJsonV1({ type: "literal", value: 1n << 63n })).toThrow();
    expect(JSON.stringify(encodeValidatorJsonV1({ type: "literal", value: "a\u0000b" }))).toBe('{"type":"literal","value":"a\\u0000b"}');
  });

  it("round-trips NaN sign and payload through encoded validator metadata", () => {
    for (const payload of ["AQAAAAAA+H8=", "AgAAAAAA+H8=", "AQAAAAAA+P8="]) {
      const wire = { type: "literal", value: { $float: payload } };
      const semantic = decodeValidatorJsonWireV1(wire);
      expect(encodeValidatorJsonV1(semantic)).toEqual(wire);
    }
  });
  it("keeps canonical numeric bytes when captured numeric intrinsics are mutated", () => {
    const define = Object.defineProperty;
    const remove = Reflect.deleteProperty;
    const nan = decodeValidatorLiteralWireV1({ $float: "AQAAAAAA+H8=" });
    const mutations = [
      { target: Object, key: "freeze" }, { target: Object, key: "defineProperty" }, { target: Object, key: "is" },
      { target: Number, key: "isFinite" }, { target: Number, key: "isNaN" },
      { target: DataView.prototype, key: "setFloat64" }, { target: DataView.prototype, key: "getFloat64" }, { target: DataView.prototype, key: "getBigUint64" },
      { target: globalThis, key: "ArrayBuffer" }, { target: globalThis, key: "DataView" }, { target: globalThis, key: "Uint8Array" },
      { target: String.prototype, key: "charAt" }, { target: String.prototype, key: "charCodeAt" }, { target: String.prototype, key: "endsWith" },
    ].map(item => ({ ...item, original: Object.getOwnPropertyDescriptor(item.target, item.key) }));
    let integer: unknown;
    let zero: unknown;
    let payload: unknown;
    let decodedInteger: unknown;
    let decodedZero: unknown;
    let nanEqual = false;
    try {
      for (let index = 0; index < mutations.length; index += 1) {
        const mutation = mutations[index];
        if (mutation === undefined) throw new Error("Missing numeric mutation fixture");
        define(mutation.target, mutation.key, { configurable: true, value: function poisonedNumericIntrinsic() { throw new Error("A mutable numeric intrinsic was consulted"); } });
      }
      integer = encodeValidatorJsonV1({ type: "literal", value: 1n });
      zero = encodeValidatorJsonV1({ type: "literal", value: -0 });
      payload = encodeValidatorJsonV1({ type: "literal", value: nan });
      decodedInteger = decodeValidatorJsonWireV1({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } });
      decodedZero = decodeValidatorJsonWireV1({ type: "literal", value: { $float: "AAAAAAAAAIA=" } });
      nanEqual = validatorLiteralEqualV1(nan, decodeValidatorLiteralWireV1({ $float: "AQAAAAAA+H8=" }));
    } finally {
      for (let index = mutations.length - 1; index >= 0; index -= 1) {
        const mutation = mutations[index];
        if (mutation === undefined) continue;
        if (mutation.original === undefined) remove(mutation.target, mutation.key);
        else define(mutation.target, mutation.key, mutation.original);
      }
    }
    expect(integer).toEqual({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } });
    expect(zero).toEqual({ type: "literal", value: { $float: "AAAAAAAAAIA=" } });
    expect(payload).toEqual({ type: "literal", value: { $float: "AQAAAAAA+H8=" } });
    expect(decodedInteger).toEqual({ type: "literal", value: 1n });
    expect(decodedZero).toEqual({ type: "literal", value: -0 });
    expect(nanEqual).toBe(true);
  });
  it("keeps semantic input and strict encoded input contracts separate", () => {
    for (const value of [1n, -0, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => decodeValidatorJsonWireV1({ type: "literal", value })).toThrow();
    for (const value of [1n, -0]) expect(decodeSemanticWireType({ type: "literal", value })).toEqual({ type: "literal", value });
    expect(() => decodeSemanticWireType({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } })).toThrow();
  });

  it("reports malformed wire and encoder overflow as typed Schema failures", () => {
    const decode = Schema.decodeUnknownResult(ValidatorJsonWireCodecV1);
    const encode = Schema.encodeUnknownResult(ValidatorJsonWireCodecV1);
    for (const value of [{ $integer: "A".repeat(1 << 20) }, { $float: "AAAAAAAAAAA=" }, { $integer: "AQAAAAAAAAB=" }])
      expect(Result.isFailure(decode({ type: "literal", value }))).toBe(true);
    expect(Result.isFailure(encode({ type: "literal", value: 1n << 63n }))).toBe(true);
    expect(Result.isFailure(encode({ type: "literal", value: -(1n << 63n) - 1n }))).toBe(true);
  });

  it("preserves recursive values, union order, object optionals and exact object codec shape", () => {
    const semantic = { type: "object", value: { nested: { optional: true, fieldType: { type: "union", value: [{ type: "literal", value: 1n }, { type: "literal", value: -0 }, { type: "literal", value: 1 }] } } } } satisfies ValidatorJsonV1;
    const encoded = Schema.encodeSync(ObjectValidatorJsonWireCodecV1)(semantic);
    expect(encoded.value.nested?.fieldType).toEqual({ type: "union", value: [{ type: "literal", value: { $integer: "AQAAAAAAAAA=" } }, { type: "literal", value: { $float: "AAAAAAAAAIA=" } }, { type: "literal", value: 1 }] });
    const decoded = Schema.decodeUnknownSync(ObjectValidatorJsonWireCodecV1)(encoded);
    expect(decoded).toEqual(semantic);
    expect(decoded).not.toBe(semantic);
    expect(decoded.value).not.toBe(semantic.value);
  });

  it("distinguishes the Rust source numeric-tag policy from strict JS wire", () => {
    expect(() => decodeValidatorLiteralWireV1({ $float: "AAAAAAAAAAA=" })).toThrow();
    expect(decodeValidatorLiteralWireV1({ $float: "AAAAAAAAAAA=" }, "convexSchema")).toBe(0);
    expect(Object.is(decodeValidatorLiteralWireV1({ $float: "AAAAAAAAAIA=" }, "convexSchema"), -0)).toBe(true);
    expect(Object.is(decodeValidatorLiteralWireV1(-0, "convexSchema"), -0)).toBe(true);
    for (const payload of ["AAAAAAAA8D8=", "AQAAAAAAAAA="]) {
      expect(() => decodeValidatorLiteralWireV1({ $float: payload }, "canonical")).toThrow();
      expect(() => decodeValidatorLiteralWireV1({ $float: payload }, "convexSchema")).toThrow();
    }
    expect(Result.isSuccess(decodeValidatorLiteralSourceV1({ $float: "AAAAAAAAAAA=" }))).toBe(true);
    expect(Result.isFailure(decodeValidatorLiteralSourceV1({ $float: "AAAAAAAA8D8=" }))).toBe(true);
  });

  it("refuses malformed and oversized numeric tags before interpretation", () => {
    for (const value of [
      { $integer: "AQAAAAAAAAA" }, { $integer: "AQAAAAAAAAA==" }, { $integer: "AQAAAAAAAAB=" },
      { $integer: "???????????=" }, { $integer: "A".repeat(1 << 20) },
      { $float: "AAAAAAAA8H8=", extra: true }, { $integer: "AQAAAAAAAAA=", $float: "AAAAAAAA8H8=" },
      { $bytes: "AQAAAAAAAAA=" }, { $integer: 1 }, Object.create({ $integer: "AQAAAAAAAAA=" }),
    ]) expect(() => decodeValidatorJsonWireV1({ type: "literal", value })).toThrow();
  });

  it("refuses array/function containers in every metadata position without reading getters", () => {
    let reads = 0;
    const foreign = new Error("Foreign metadata getter executed");
    for (const throws of [false, true]) {
      const array: unknown[] = [];
      const callable = () => undefined;
      for (const gadget of [array, callable]) {
        Object.defineProperty(gadget, "type", { get() { reads += 1; if (throws) throw foreign; return "string"; } });
        Object.defineProperty(gadget, "optional", { get() { reads += 1; if (throws) throw foreign; return false; } });
        Object.defineProperty(gadget, "fieldType", { get() { reads += 1; if (throws) throw foreign; return { type: "string" }; } });
        const inputs: unknown[] = [gadget, { type: "array", value: gadget }, { type: "record", keys: gadget, values: { type: "number" } }, { type: "record", keys: { type: "string" }, values: gadget }, { type: "object", value: gadget }, { type: "object", value: { required: gadget } }];
        if (typeof gadget === "function") inputs.push({ type: "union", value: gadget });
        for (const input of inputs) for (const options of [undefined, { onExcessProperty: "error" as const }]) {
          expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJson, options)(input))).toBe(true);
          expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, options)(input))).toBe(true);
          expect(Result.isFailure(Schema.decodeUnknownResult(Schema.toType(ValidatorJsonWireCodecV1), options)(input))).toBe(true);
          expect(Result.isFailure(Schema.decodeUnknownResult(ObjectValidatorJsonWireCodecV1, options)(input))).toBe(true);
        }
      }
    }
    expect(reads).toBe(0);
  });
  it("never evaluates literal, numeric tag or field accessors, including through Schema.toType", () => {
    let reads = 0;
    const literal = { type: "literal", get value() { reads += 1; return 1; } };
    const tag = { get $integer() { reads += 1; return "AQAAAAAAAAA="; } };
    const optional = { fieldType: { type: "number" }, get optional() { reads += 1; return true; } };
    for (const value of [literal, { type: "literal", value: tag }, { type: "object", value: { field: optional } }]) {
      expect(() => decodeValidatorJsonV1(value)).toThrow();
      expect(() => decodeValidatorJsonWireV1(value)).toThrow();
      expect(() => decodeSemanticWireType(value)).toThrow();
    }
    expect(reads).toBe(0);
  });

  it("keeps full pure foreign wire admission typed while supported same-realm intrinsics are mutated", () => {
    const define = Object.defineProperty;
    const remove = Reflect.deleteProperty;
    const mutations = [
      { target: Object, key: "freeze", replacement: { value: () => ({ polluted: true }) } },
      { target: Object, key: "create", replacement: { value: () => { throw new Error("polluted create"); } } },
      { target: Object, key: "entries", replacement: { value: () => [] } },
      { target: Object, key: "defineProperty", replacement: { value: () => { throw new Error("polluted defineProperty"); } } },
      { target: Object, key: "is", replacement: { value: () => false } },
      { target: Number, key: "isFinite", replacement: { value: () => false } },
      { target: Number, key: "isNaN", replacement: { value: () => false } },
      { target: Array.prototype, key: Symbol.iterator, replacement: { value: function* () { yield { type: "any" }; } } },
      { target: Array.prototype, key: "map", replacement: { value: () => [{ type: "any" }] } },
      { target: Array.prototype, key: "constructor", replacement: { get() { throw new Error("polluted constructor"); } } },
      { target: Array.prototype, key: "0", replacement: { set() { throw new Error("polluted index setter"); } } },
      { target: Array, key: Symbol.species, replacement: { get() { throw new Error("polluted species"); } } },
    ].map(item => ({ ...item, original: Object.getOwnPropertyDescriptor(item.target, item.key) }));
    const cases = [{ type: "id", tableName: "" }, { type: "literal", value: 1n }, { type: "literal", value: { $integer: "AQAAAAAAAAB=" } }];
    let rejected = true;
    let valid: unknown;
    try {
      for (let index = 0; index < mutations.length; index += 1) {
        const mutation = mutations[index];
        if (mutation === undefined) throw new Error("Missing mutation fixture");
        define(mutation.target, mutation.key, { configurable: true, ...mutation.replacement });
      }
      for (let index = 0; index < cases.length; index += 1) {
        const result = decodeValidatorJsonWireResultCoreV1(cases[index]);
        rejected = !result.ok && rejected;
      }
      valid = decodeValidatorJsonWireV1({ type: "literal", value: { $integer: "AQAAAAAAAAA=" } });
    } finally {
      for (let index = mutations.length - 1; index >= 0; index -= 1) {
        const mutation = mutations[index];
        if (mutation === undefined) continue;
        if (mutation.original === undefined) remove(mutation.target, mutation.key);
        else define(mutation.target, mutation.key, mutation.original);
      }
    }
    expect(rejected).toBe(true);
    expect(valid).toEqual({ type: "literal", value: 1n });
  });
  it("captures proxy data descriptors without invoking get traps", () => {
    let reads = 0;
    const handler = { get() { reads += 1; throw new Error("Property get trap executed"); } };
    const wire = new Proxy({ type: "object", value: new Proxy({ amount: new Proxy({ optional: false, fieldType: new Proxy({ type: "literal", value: new Proxy({ $integer: "AQAAAAAAAAA=" }, handler) }, handler) }, handler) }, handler) }, handler);
    expect(decodeValidatorJsonWireV1(wire)).toEqual({ type: "object", value: { amount: { optional: false, fieldType: { type: "literal", value: 1n } } } });
    const semantic = new Proxy({ type: "literal", value: 1n }, handler);
    expect(decodeValidatorJsonV1(semantic)).toEqual({ type: "literal", value: 1n });
    expect(decodeSemanticWireType(semantic)).toEqual({ type: "literal", value: 1n });
    expect(reads).toBe(0);
  });
  it("keeps strict nested excess-key refusal and default stripping without reading extras", () => {
    const extra = new Proxy({}, { get() { throw new Error("Foreign extra graph read"); } });
    const input = { type: "object", value: { name: { optional: false, fieldType: { type: "string", legacy: extra } } } };
    const strict = { onExcessProperty: "error" as const };
    expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, strict)(input))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(Schema.toType(ValidatorJsonWireCodecV1), strict)(input))).toBe(true);
    expect(decodeValidatorJsonWireV1(input)).toEqual({ type: "object", value: { name: { optional: false, fieldType: { type: "string" } } } });
    const fieldExtra = { type: "object", value: { name: { optional: false, fieldType: { type: "string" }, legacy: extra } } };
    expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, strict)(fieldExtra))).toBe(true);
    let reads = 0;
    const accessorExtra = { type: "string", get legacy() { reads += 1; return extra; } };
    expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, strict)(accessorExtra))).toBe(true);
    expect(decodeValidatorJsonWireV1(accessorExtra)).toEqual({ type: "string" });
    expect(reads).toBe(0);
  });

  it("keeps the array parser's ignored custom-property behavior without reading it", () => {
    let reads = 0;
    const members = [{ type: "literal", value: 1 }];
    Object.defineProperty(members, "legacy", { enumerable: true, get() { reads += 1; return {}; } });
    const input = { type: "union", value: members };
    const result = Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, { onExcessProperty: "error" })(input);
    expect(result).toEqual(Result.succeed({ type: "union", value: [{ type: "literal", value: 1 }] }));
    expect(reads).toBe(0);
  });
  it("refuses preserving foreign extra values as a typed canonical DTO error", () => {
    const preserve = { onExcessProperty: "preserve" as const };
    expect(Result.isFailure(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1, preserve)({ type: "string", legacy: {} }))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(Schema.toType(ValidatorJsonWireCodecV1), preserve)({ type: "string", legacy: {} }))).toBe(true);
  });
  it("admits declarations beyond displaced node and logical-depth quotas", () => {
    const shared = { type: "number" };
    const wide = { type: "union", value: Array.from({ length: 65_537 }, () => shared) };
    let deep: unknown = { type: "number" };
    for (let index = 0; index < 300; index += 1) deep = { type: "array", value: deep };
    for (const value of [wide, deep]) {
      expect(() => decodeValidatorJson(value)).not.toThrow();
      expect(() => decodeValidatorJsonWireV1(value)).not.toThrow();
      expect(() => decodeSemanticWireType(value)).not.toThrow();
    }
  });

  it("keeps typed structural failure reasons and exact first-failure metadata paths", () => {
    const cases = [
      [{ type: "record", keys: null, values: null }, "malformedContainer", ["keys"]],
      [{ type: "object" }, "malformedContainer", ["value"]],
      [{ type: "union", value: [{ type: "array", value: null }, { type: "literal", value: null }] }, "malformedContainer", ["value", 0, "value"]],
      [{ type: "object", value: { name: { optional: false } } }, "missingProperty", ["value", "name", "fieldType"]],
      [{ type: "id", tableName: "" }, "invalidShape", ["tableName"]],
    ] as const;
    for (const [input, reason, segments] of cases) {
      const result = decodeValidatorJsonWireResultCoreV1(input);
      expect(result).toMatchObject({ ok: false, issue: { reason, segments } });
    }
    expect(decodeValidatorJsonResultCoreV1({ type: "literal", value: 1n })).toEqual({ ok: true, value: { type: "literal", value: 1n } });
  });
  it("identifies nonfinite persistence policy without changing semantic identity", () => {
    expect(validatorJsonHasNonfiniteLiteralV1({ type: "array", value: { type: "literal", value: Number.NaN } })).toBe(true);
    expect(validatorJsonHasNonfiniteLiteralV1({ type: "record", keys: { type: "string" }, values: { type: "literal", value: Number.POSITIVE_INFINITY } })).toBe(true);
    expect(validatorJsonHasNonfiniteLiteralV1({ type: "literal", value: -0 })).toBe(false);
    expect(validatorJsonHasNonfiniteLiteralV1({ type: "literal", value: 1n })).toBe(false);
  });
});
describe("Convex source record admission", () => {
  const record = (keys: ValidatorJsonV1, values: ValidatorJsonV1 = { type: "number" }): ValidatorJsonV1 => ({ type: "record", keys, values });

  it("admits string/ID keys and vacuous empty unions while refusing literal key cases", () => {
    for (const keys of [{ type: "string" }, { type: "id", tableName: "items" }, { type: "union", value: [] }, { type: "union", value: [{ type: "string" }, { type: "id", tableName: "items" }] }] satisfies readonly ValidatorJsonV1[]) {
      expect(validatorIsSubsetOfStringV1(keys)).toBe(true);
      expect(validatorIsStringSubtypeWithStringLiteralV1(keys)).toBe(false);
      expect(validatorIsValidRecordKeyV1(keys)).toBe(true);
      expect(validatorSourceRecordIssueV1(record(keys))).toBeUndefined();
    }
    for (const value of [1n, 1, -0, Number.NaN, Number.POSITIVE_INFINITY, true]) {
      const keys = { type: "literal", value } satisfies ValidatorJsonV1;
      expect(validatorIsSubsetOfStringV1(keys)).toBe(false);
      expect(validatorIsStringSubtypeWithStringLiteralV1(keys)).toBe(false);
      expect(validatorIsValidRecordKeyV1(keys)).toBe(false);
      expect(validatorSourceRecordIssueV1(record(keys))).toEqual({ reason: "nonStringRecordKey", path: "$.keys" });
    }
    for (const keys of [{ type: "literal", value: "only" }, { type: "union", value: [{ type: "string" }, { type: "union", value: [{ type: "literal", value: "only" }] }] }] satisfies readonly ValidatorJsonV1[]) {
      expect(validatorIsSubsetOfStringV1(keys)).toBe(true);
      expect(validatorIsStringSubtypeWithStringLiteralV1(keys)).toBe(true);
      expect(validatorIsValidRecordKeyV1(keys)).toBe(false);
      expect(validatorSourceRecordIssueV1(record(keys))).toEqual({ reason: "stringLiteralRecordKey", path: "$.keys" });
    }
  });

  it("keeps source string-literal detection limited to literal/union cases", () => {
    for (const validator of [{ type: "array", value: { type: "literal", value: "only" } }, { type: "object", value: { name: { optional: false, fieldType: { type: "literal", value: "only" } } } }, record({ type: "string" }, { type: "literal", value: "only" })] satisfies readonly ValidatorJsonV1[]) {
      expect(validatorIsSubsetOfStringV1(validator)).toBe(false);
      expect(validatorIsStringSubtypeWithStringLiteralV1(validator)).toBe(false);
    }
  });

  it("refuses a mixed non-string union before its string-literal-key case", () => {
    const keys = { type: "union", value: [{ type: "number" }, { type: "literal", value: "only" }] } satisfies ValidatorJsonV1;
    expect(validatorIsSubsetOfStringV1(keys)).toBe(false);
    expect(validatorIsStringSubtypeWithStringLiteralV1(keys)).toBe(true);
    expect(validatorSourceRecordIssueV1(record(keys))).toEqual({ reason: "nonStringRecordKey", path: "$.keys" });
  });
  it("validates nested keys before their outer subtype and values", () => {
    const invalid = record({ type: "literal", value: 1n });
    expect(validatorSourceRecordIssueV1(record(invalid, invalid))).toEqual({ reason: "nonStringRecordKey", path: "$.keys.keys" });
    expect(validatorSourceRecordIssueV1(record({ type: "number" }, invalid))).toEqual({ reason: "nonStringRecordKey", path: "$.keys" });
  });

  it("validates values before refusing an outer string literal key", () => {
    const invalidValue = record({ type: "number" });
    expect(validatorSourceRecordIssueV1(record({ type: "literal", value: "only" }, invalidValue))).toEqual({ reason: "nonStringRecordKey", path: "$.values.keys" });
    expect(validatorSourceRecordIssueV1(record({ type: "literal", value: "only" }, { type: "literal", value: Number.NaN }))).toEqual({ reason: "stringLiteralRecordKey", path: "$.keys" });
    expect(validatorSourceRecordIssueV1(record({ type: "string" }, { type: "literal", value: Number.NaN }))).toBeUndefined();
  });

  it("follows array/union order and source-sorted object fields", () => {
    const invalid = record({ type: "literal", value: 1n });
    expect(validatorSourceRecordIssueV1({ type: "array", value: invalid })).toEqual({ reason: "nonStringRecordKey", path: "$.value.keys" });
    expect(validatorSourceRecordIssueV1({ type: "union", value: [{ type: "string" }, invalid] })).toEqual({ reason: "nonStringRecordKey", path: "$.value[1].keys" });
    expect(validatorSourceRecordIssueV1({ type: "object", value: { z: { optional: false, fieldType: invalid }, a: { optional: false, fieldType: invalid } } })).toEqual({ reason: "nonStringRecordKey", path: '$.value["a"].fieldType.keys' });
  });

  it("does not globally ban records in semantic, wire or historical-compatible codecs", () => {
    const semantic = record({ type: "literal", value: 1n }, { type: "literal", value: Number.NaN });
    expect(decodeValidatorJsonV1(semantic)).toEqual(semantic);
    expect(decodeValidatorJsonWireV1(encodeValidatorJsonV1(semantic))).toEqual(semantic);
    expect(validatorSourceRecordIssueV1(semantic)).toEqual({ reason: "nonStringRecordKey", path: "$.keys" });
  });
});