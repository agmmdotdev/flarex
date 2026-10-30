import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  captureDocumentObject, captureDocumentPatch, captureDocumentValue,
  captureDocumentObjectWithSize, captureDocumentValueWithSize,
  decodeDocumentValue, encodeDocumentValue,
} from "../src/document-value";

const text = (value: unknown) => new TextDecoder().decode(Result.getOrThrow(encodeDocumentValue(value)));
const decode = (value: string) => decodeDocumentValue(new TextEncoder().encode(value));

describe("Convex internal document JSON", () => {
  it("uses the pinned scalar tags and a full document without the old envelope", () => {
    expect(text({ _id: "document", _creationTime: 2, nul: "a\0b", removed: undefined })).toBe(
      '{"_creationTime":2,"_id":"document","nul":"a\\u0000b"}',
    );
    expect(text(1n)).toBe('{"$integer":"AQAAAAAAAAA="}');
    expect(text(-1n)).toBe('{"$integer":"//////////8="}');
    expect(text(new Uint8Array([0, 255, 1]).buffer)).toBe('{"$bytes":"AP8B"}');
    expect(text(-0)).toBe('{"$float":"AAAAAAAAAIA="}');
    expect(text(Infinity)).toBe('{"$float":"AAAAAAAA8H8="}');
    expect(text(-Infinity)).toBe('{"$float":"AAAAAAAA8P8="}');
    expect(text(NaN)).toBe('{"$float":"AAAAAAAA+H8="}');
  });

  it("round trips special numbers, signed integer limits, binary leaves and nested omission", () => {
    for (const value of [NaN, -0, Infinity, -Infinity, -(1n << 63n), (1n << 63n) - 1n, "a\0b", [null, { omitted: undefined, yes: true }]]) {
      const encoded = Result.getOrThrow(encodeDocumentValue(value));
      expect(Result.getOrThrow(decodeDocumentValue(encoded))).toEqual(value instanceof Array ? [null, { yes: true }] : value);
    }
    const input = new Uint8Array([0, 1, 255]);
    const captured = Result.getOrThrow(captureDocumentObject({ bytes: input.buffer, nested: { x: 1 } }));
    input.fill(4);
    expect(captured.bytes).toEqual(new Uint8Array([0, 1, 255]).buffer);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.nested)).toBe(true);
  });

  it("reports semantic accounting separately from tagged JSON size in the same capture", () => {
    const input = { i: 1n, b: Uint8Array.of(1, 2, 3).buffer };
    const captured = Result.getOrThrow(captureDocumentObjectWithSize(input));
    // Object delimiters2 + i/name separator2/int64 9 + b/name separator2/bytes5.
    expect(captured).toMatchObject({ value: input, semanticSizeBytes: 20, nestingDepth: 1 });
    expect(Result.getOrThrow(encodeDocumentValue(input)).byteLength).toBeGreaterThan(captured.semanticSizeBytes);
    expect(Result.getOrThrow(captureDocumentValueWithSize(1n)))
      .toEqual({ value: 1n, semanticSizeBytes: 9, nestingDepth: 0 });
    expect(captured.value).not.toBe(input);
    expect(captured.value.b).not.toBe(input.b);
    expect(Result.isFailure(captureDocumentObjectWithSize([]))).toBe(true);
  });

  it("refuses malformed tagged storage, invalid UTF8 and unadmitted placeholders", () => {
    for (const input of [
      '{"$integer":"AQ=="}', '{"$float":"AAAAAAAA8D8="}', '{"$bytes":1}',
      '{"$bytes":"?"}', '{"$string":"AA=="}', '{"$commitTs":null}', '{"$set":[]}',
      '{"$map":[]}', '{"$integer":"AQAAAAAAAAA=","x":1}', '1e400', '{',
    ]) expect(Result.isFailure(decode(input)), input).toBe(true);
    expect(Result.isFailure(decodeDocumentValue(Uint8Array.of(0xc0, 0x80)))).toBe(true);
    expect(Result.isFailure(decodeDocumentValue(Uint8Array.of(0xef, 0xbb, 0xbf, 0x31)))).toBe(true);
    expect(Result.getOrThrow(decode('{"__proto__":{"polluted":true}}'))).toEqual(JSON.parse('{"__proto__":{"polluted":true}}'));
    const prototypeField = Result.getOrThrow(captureDocumentObject(Result.getOrThrow(decode('{"__proto__":null}'))));
    expect(Object.hasOwn(prototypeField, "__proto__")).toBe(true);
  });

  it("preserves patch deletion without evaluating accessors or accepting invalid deletion names", () => {
    const patch = Result.getOrThrow(captureDocumentPatch({ remove: undefined, keep: { omitted: undefined, n: 1 } }));
    expect(Object.hasOwn(patch, "remove")).toBe(true);
    expect(patch).toEqual({ remove: undefined, keep: { n: 1 } });
    let reads = 0;
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { reads += 1; return 1; } });
    expect(Result.isFailure(captureDocumentValue(accessor))).toBe(true);
    expect(Result.isFailure(captureDocumentPatch(accessor))).toBe(true);
    expect(reads).toBe(0);
    expect(Result.isFailure(captureDocumentPatch({ $invalid: undefined }))).toBe(true);
  });

  it("returns typed failures for deeply nested stored JSON before recursive decoding", () => {
    expect(Result.isSuccess(decode("[".repeat(64) + "0" + "]".repeat(64)))).toBe(true);
    expect(Result.isSuccess(decode("[".repeat(64) + '{"$integer":"AQAAAAAAAAA="}' + "]".repeat(64)))).toBe(true);
    for (const input of [
      "[".repeat(65) + "0" + "]".repeat(65),
      "[".repeat(10_000) + "0" + "]".repeat(10_000),
      '{"x":'.repeat(10_000) + "0" + "}".repeat(10_000),
    ]) expect(Result.isFailure(decode(input))).toBe(true);
  });

  it("enforces the pinned value and document shapes instead of silently coercing", () => {
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    for (const value of [undefined, 1n << 63n, new Set(), new Map(), new Date(), Uint8Array.of(1), [undefined], [,], cycle, { "$x": 1 }, { "non\0ascii": 1 }])
      expect(Result.isFailure(captureDocumentValue(value)), String(typeof value)).toBe(true);
    for (const value of [null, [], "x", 1]) expect(Result.isFailure(captureDocumentObject(value))).toBe(true);
    expect(Result.isFailure(captureDocumentObject({ long: "x".repeat(1 << 20) }))).toBe(true);
    let nested: unknown = 1;
    for (let i = 0; i < 16; i += 1) nested = [nested];
    expect(Result.isFailure(captureDocumentObject({ nested }))).toBe(true);
    const defect = new Error("unexpected proxy failure");
    const foreign = new Proxy({}, { ownKeys() { throw defect; } });
    expect(() => captureDocumentValue(foreign)).toThrow(defect);
  });
});
