import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import oracle from "./fixtures/pinned-validator-source-dto.json";
import {
  captureSourceJson, convertValidatorSourceDto, decodeFieldTypeSourceDto,
  decodeValidatorSourceDto, decodeValidatorSourceTextResult, normalizeSourceDocumentValidator,
  parseSourceJsonText, validateSourceValidatorResult,
} from "../src/validator-source";
import {
  decodeValidatorJsonV1, decodeValidatorJsonWireV1, encodeValidatorJsonV1,
  decodeLegacyValidatorJsonResultCoreV1, decodeLegacyValidatorJsonWireResultCoreV1,
  encodeLegacyValidatorJsonWireCoreV1, LegacyObjectValidatorJsonWireCodecV1,
  DocumentValidatorJsonWireCodecV1, type ValidatorJsonV1,
} from "../src/validator-json";
import { isFunctionHandleString, validateValidatorValueIssueV1 } from "../src/validator-engine-core";
import { encodeCanonicalDocumentId } from "../src/document-id-core";

describe("pinned Rust source DTO acceptance", () => {
  for (const vector of oracle.vectors) it(vector.id, () => {
    const text = parseSourceJsonText(vector.input);
    const actual = !text.ok || vector.mode === "value" ? text : vector.mode === "field"
      ? decodeFieldTypeSourceDto(text.value) : decodeValidatorSourceDto(text.value);
    expect(actual.ok).toBe(vector.accepted);
    if (!actual.ok) expect(actual.issue.phase).toBe("raw");
  });
});

describe("ordered source semantic conversion", () => {
  const source = (value: unknown) => decodeValidatorSourceTextResult(JSON.stringify(value));
  const literal = { type: "literal", value: { $float: "not-base64!" } };
  it("completes every raw DTO before starting record semantics", () => {
    expect(source({ type: "record", keys: { type: "bigint" }, values: { fieldType: literal } })).toMatchObject({ ok: false, issue: { phase: "raw" } });
    expect(source({ type: "record", keys: { type: "bigint" }, values: { fieldType: literal, optional: false } })).toMatchObject({ ok: false, issue: { phase: "semantic", reason: "nonStringRecordKey" } });
    expect(source({ type: "record", keys: { type: "literal", value: "key" }, values: { fieldType: literal, optional: true } })).toMatchObject({ ok: false, issue: { reason: "invalidLiteral" } });
    expect(source({ type: "record", keys: { type: "literal", value: "key" }, values: { fieldType: { type: "number" }, optional: true } })).toMatchObject({ ok: false, issue: { reason: "stringLiteralRecordKey" } });
    expect(source({ type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" }, optional: true } })).toMatchObject({ ok: false, issue: { reason: "optionalRecordValue" } });
  });
  it("keeps raw arbitrary literal JSON and empty ID names until semantics", () => {
    for (const value of [{ type: "literal", value: null }, { type: "literal", value: [1] }, { type: "id", tableName: "" }]) {
      const ast = parseSourceJsonText(JSON.stringify(value)); expect(ast.ok).toBe(true);
      if (!ast.ok) return;
      const dto = decodeValidatorSourceDto(ast.value); expect(dto.ok).toBe(true);
      if (dto.ok) expect(convertValidatorSourceDto(dto.value)).toMatchObject({ ok: false, issue: { phase: "semantic" } });
    }
  });
  it("retains duplicate map replacement only after parsing earlier values", () => {
    expect(decodeValidatorSourceTextResult('{"type":"object","value":{"x":{"fieldType":{"type":"id","tableName":""},"optional":false},"x":[["number"],false]}}')).toEqual({ ok: true, value: { type: "object", value: { x: { fieldType: { type: "number" }, optional: false } } } });
    expect(decodeValidatorSourceTextResult('{"type":"object","value":{"x":{"fieldType":{"type":"unknown"},"optional":false},"x":[["number"],false]}}')).toMatchObject({ ok: false, issue: { phase: "raw" } });
  });
  it("uses source +0 policy while strict JavaScript decoding refuses its tag", () => {
    const wire = { type: "literal", value: { $float: "AAAAAAAAAAA=" } };
    expect(source(wire)).toEqual({ ok: true, value: { type: "literal", value: 0 } });
    expect(() => decodeValidatorJsonWireV1(wire)).toThrow();
    expect(encodeValidatorJsonV1({ type: "record", keys: { type: "string" }, values: { type: "number" } })).toEqual({ type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" }, optional: false } });
    expect(() => decodeValidatorJsonWireV1({ type: "record", keys: { type: "string" }, values: { type: "number" } })).toThrow();
  });
  it("selects historical bare bytes only through the named historical codec", () => {
    const semantic: ValidatorJsonV1 = { type: "object", value: { record: { fieldType: { type: "record", keys: { type: "string" }, values: { type: "literal", value: Infinity } }, optional: false } } };
    const historical = { type: "object", value: { record: { fieldType: { type: "record", keys: { type: "string" }, values: { type: "literal", value: { $float: "AAAAAAAA8H8=" } } }, optional: false } } };
    expect(encodeLegacyValidatorJsonWireCoreV1(semantic)).toEqual(historical);
    expect(decodeLegacyValidatorJsonResultCoreV1(semantic)).toEqual({ ok: true, value: semantic });
    expect(decodeLegacyValidatorJsonWireResultCoreV1(historical)).toEqual({ ok: true, value: semantic });
    expect(Schema.decodeUnknownSync(LegacyObjectValidatorJsonWireCodecV1)(historical)).toEqual(semantic);
    if (semantic.type === "object") expect(Schema.encodeSync(LegacyObjectValidatorJsonWireCodecV1)(semantic)).toEqual(historical);
    expect(() => decodeValidatorJsonWireV1(historical)).toThrow();
    for (const type of ["function", "commitTs"]) expect(decodeLegacyValidatorJsonResultCoreV1({ type }).ok).toBe(false);
  });
  it("uses source document normalization in the shared document wire codec", () => {
    const decode = Schema.decodeUnknownSync(DocumentValidatorJsonWireCodecV1);
    expect(decode({ type: "union", value: [{ type: "object", value: { _removed: { fieldType: { type: "number" }, optional: false }, kept: { fieldType: { type: "string" }, optional: false } } }] })).toEqual({ type: "object", value: { kept: { fieldType: { type: "string" }, optional: false } } });
    expect(() => decode({ type: "union", value: [{ type: "any" }] })).toThrow();
  });
  it("checks sorted field names before their children and preserves string scalars", () => {
    expect(source({ type: "object", value: { z: { fieldType: literal, optional: false }, "a-b": { fieldType: { type: "string" }, optional: false } } })).toMatchObject({ ok: false, issue: { reason: "invalidIdentifier", path: '$.value["a-b"]' } });
    for (const name of ["$a", "a\u007f", "é", "_", "__", "a".repeat(65), "a".repeat(1025)]) expect(source({ type: "object", value: { [name]: { fieldType: { type: "number" }, optional: false } } }).ok).toBe(false);
    for (const value of ["a\u0000b", "é", "e\u0301", "😀"]) expect(source({ type: "literal", value })).toEqual({ ok: true, value: { type: "literal", value } });
    expect(parseSourceJsonText('{"type":"string","ignored":"\\ud800"}')).toMatchObject({ ok: false, issue: { reason: "invalidUnicode" } });
  });
  it("normalizes document roots after all child semantics, before finite projection", () => {
    const value = source({ type: "object", value: { _drop: { fieldType: { type: "literal", value: { $float: "AAAAAAAA8H8=" } }, optional: false }, nested: { fieldType: { type: "object", value: { _keep: { fieldType: { type: "number" }, optional: false } } }, optional: false } } });
    expect(value.ok).toBe(true); if (!value.ok) return;
    expect(normalizeSourceDocumentValidator(value.value)).toEqual({ ok: true, value: { type: "object", value: { nested: { fieldType: { type: "object", value: { _keep: { fieldType: { type: "number" }, optional: false } } }, optional: false } } } });
    expect(normalizeSourceDocumentValidator({ type: "union", value: [] })).toEqual({ ok: true, value: { type: "union", value: [] } });
    expect(normalizeSourceDocumentValidator({ type: "union", value: [{ type: "object", value: {} }] })).toEqual({ ok: true, value: { type: "object", value: {} } });
    expect(normalizeSourceDocumentValidator({ type: "union", value: [{ type: "any" }] }).ok).toBe(false);
    expect(normalizeSourceDocumentValidator({ type: "union", value: [{ type: "union", value: [] }] }).ok).toBe(false);
    expect(source({ type: "object", value: { _drop: { fieldType: literal, optional: false } } }).ok).toBe(false);
  });
  it("owns semantic DAGs without arbitrary field, node or logical depth quotas", () => {
    let node: ValidatorJsonV1 = { type: "string" };
    for (let index = 0; index < 300; index += 1) node = { type: "union", value: [node, node] };
    const parsed = decodeValidatorJsonV1(node);
    expect(parsed.type).toBe("union");
    if (parsed.type === "union") expect(parsed.value[0]).toBe(parsed.value[1]);
    expect(validateSourceValidatorResult(parsed).ok).toBe(true);
    const wire = encodeValidatorJsonV1(parsed); if (wire.type === "union") expect(wire.value[0]).toBe(wire.value[1]);
    const fields = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`f${index}`, { fieldType: { type: "number" }, optional: false }]));
    expect(source({ type: "object", value: fields }).ok).toBe(true);
    const cycle: { type: "array"; value?: unknown } = { type: "array" }; cycle.value = cycle;
    expect(() => decodeValidatorJsonV1(cycle)).toThrow();
    expect(Object.isFrozen(parsed)).toBe(true);
  });
  it("never invokes foreign accessors", () => {
    let reads = 0; const foreign = { type: "literal", get value() { reads += 1; return 1; } };
    expect(captureSourceJson(foreign).ok).toBe(false); expect(reads).toBe(0);
    expect(validateSourceValidatorResult(foreign).ok).toBe(false); expect(reads).toBe(0);
  });
  it("uses captured intrinsics while parsing, normalizing and projecting", () => {
    const define = Object.defineProperty;
    const originals = [
      { target: Object, key: "freeze" }, { target: Object, key: "defineProperty" },
      { target: Object, key: "getOwnPropertyDescriptor" }, { target: Object, key: "hasOwn" },
      { target: Reflect, key: "apply" }, { target: Reflect, key: "ownKeys" },
      { target: JSON, key: "parse" }, { target: JSON, key: "stringify" },
      { target: String.prototype, key: "slice" }, { target: String.prototype, key: "charCodeAt" },
      { target: Array.prototype, key: "slice" }, { target: Array.prototype, key: "sort" },
      { target: Array.prototype, key: Symbol.iterator },
      { target: WeakMap.prototype, key: "get" }, { target: WeakMap.prototype, key: "set" },
      { target: WeakSet.prototype, key: "has" }, { target: WeakSet.prototype, key: "add" }, { target: WeakSet.prototype, key: "delete" },
      { target: globalThis, key: "WeakMap" }, { target: globalThis, key: "WeakSet" },
    ].map(item => ({ ...item, descriptor: Object.getOwnPropertyDescriptor(item.target, item.key)! }));
    let parsed: unknown; let normalized: unknown; let projected: unknown;
    const semantic: ValidatorJsonV1 = { type: "object", value: { record: { fieldType: { type: "record", keys: { type: "function" }, values: { type: "commitTs" } }, optional: false } } };
    try {
      for (let index = 0; index < originals.length; index += 1) { const original = originals[index]!; define(original.target, original.key, { configurable: true, value: function poisonedIntrinsic() { throw new Error("Mutable intrinsic used"); } }); }
      parsed = decodeValidatorSourceTextResult('["object",{"x":[["record",["function",null,null,null],[["commitTs"],false]],false]}]');
      normalized = normalizeSourceDocumentValidator(semantic);
      projected = encodeValidatorJsonV1(semantic);
    } finally {
      for (let index = originals.length - 1; index >= 0; index -= 1) { const original = originals[index]!; define(original.target, original.key, original.descriptor); }
    }
    expect(parsed).toMatchObject({ ok: true }); expect(normalized).toMatchObject({ ok: true });
    expect(projected).toEqual({ type: "object", value: { record: { fieldType: { type: "record", keys: { type: "function" }, values: { fieldType: { type: "commitTs" }, optional: false } }, optional: false } } });
  });
});

describe("Function and CommitTs value semantics", () => {
  const id = encodeCanonicalDocumentId(7, new Uint8Array(16));
  const fn: ValidatorJsonV1 = { type: "function", fnType: "query", args: { type: "number" }, returns: { type: "boolean" } };
  it("matches canonical handle strings with advisory fragments and no signature matching", () => {
    for (const handle of [`function://${id}`, `function://${id}#invalid fragment/#\u0000#more`]) {
      expect(isFunctionHandleString(handle)).toBe(true);
      expect(validateValidatorValueIssueV1(fn, handle, { idPolicy: { mode: "tableAware", check: () => { throw new Error("Function metadata must not resolve IDs"); } } })).toBeUndefined();
    }
    for (const handle of [id, `Function://${id}`, `function://${id}x`, "function://", `function://#${id}`]) expect(isFunctionHandleString(handle)).toBe(false);
  });
  it("matches canonical handles with poisoned inherited byte operations", () => {
    const typedArrayPrototype: object = Object.getPrototypeOf(Uint8Array.prototype);
    const targets = [
      { target: globalThis, key: "Uint8Array", descriptor: { value: poisoned } },
      { target: typedArrayPrototype, key: "length", descriptor: { get: poisoned } },
      { target: Array.prototype, key: "0", descriptor: { set: poisoned } },
    ].map(item => ({ ...item, original: Object.getOwnPropertyDescriptor(item.target, item.key) }));
    function poisoned(): never { throw new Error("Mutable byte operation used"); }
    let canonical: boolean;
    let alias: boolean;
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index]!;
        Object.defineProperty(item.target, item.key, { configurable: true, ...item.descriptor });
      }
      canonical = isFunctionHandleString(`function://${id}#advisory`);
      alias = isFunctionHandleString("function://040020g30g2gc1r81450p30d1r7qke9");
    } finally {
      for (let index = targets.length - 1; index >= 0; index -= 1) {
        const item = targets[index]!;
        if (item.original === undefined) Reflect.deleteProperty(item.target, item.key);
        else Object.defineProperty(item.target, item.key, item.original);
      }
    }
    expect(canonical).toBe(true);
    expect(alias).toBe(false);
  });
  it("treats CommitTs as ordinary signed Int64 at runtime", () => {
    for (const value of [-(1n << 63n), -1n, 0n, (1n << 63n) - 1n]) expect(validateValidatorValueIssueV1({ type: "commitTs" }, value, { idPolicy: { mode: "shapeOnly" } })).toBeUndefined();
    expect(validateValidatorValueIssueV1({ type: "commitTs" }, 0, { idPolicy: { mode: "shapeOnly" } })).toMatchObject({ reason: "typeMismatch", expected: "commitTs" });
  });
});
