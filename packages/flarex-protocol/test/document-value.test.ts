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

  it("walks an issued scalar root once more and then returns that walk's output", () => {
    const first = Result.getOrThrow(captureDocumentObjectWithSize({ title: "a", nested: { list: [1, "é"] } }));
    const proven = Result.getOrThrow(captureDocumentObjectWithSize(first.value));
    expect(proven).toEqual(first);
    expect(proven.value).not.toBe(first.value);
    for (const root of [first.value, proven.value]) for (let repeat = 0; repeat < 2; repeat++) {
      expect(Result.getOrThrow(captureDocumentObjectWithSize(root)).value).toBe(proven.value);
      expect(Result.getOrThrow(captureDocumentValueWithSize(root))).toEqual(proven);
      expect(Result.getOrThrow(captureDocumentValue(root))).toBe(proven.value);
    }
    // A nested container was never issued as a root; a copy is a foreign value.
    expect(Result.getOrThrow(captureDocumentValue(proven.value.nested))).not.toBe(proven.value.nested);
    expect(Result.getOrThrow(captureDocumentValue({ ...proven.value }))).not.toBe(proven.value);

    const binary = Result.getOrThrow(captureDocumentObject({ bytes: Uint8Array.of(1, 2).buffer }));
    const copies = [1, 2, 3].map(() => Result.getOrThrow(captureDocumentObject(binary)));
    expect(new Set([binary, ...copies]).size).toBe(4);
    expect(new Set([binary.bytes, ...copies.map(copy => copy.bytes)]).size).toBe(4);
    new Uint8Array(binary.bytes as ArrayBuffer).fill(9);
    expect(copies[2]!.bytes).toEqual(Uint8Array.of(1, 2).buffer);
  });

  it("never returns a tree holding a leaf the codec copied from a foreign binary value", () => {
    const planted = (leaf: unknown, bytes = 1) => {
      class Forged extends ArrayBuffer { override slice(): ArrayBuffer { return leaf as ArrayBuffer; } }
      return Result.getOrThrow(captureDocumentValueWithSize({ leaf: new Forged(bytes) }));
    };
    const settles = (issued: unknown, expected: ReturnType<typeof captureDocumentValueWithSize>) => {
      for (let repeat = 0; repeat < 3; repeat++) {
        const again = captureDocumentValueWithSize(issued);
        if (Result.isFailure(expected)) expect(Result.isFailure(again)).toBe(true);
        else {
          expect(again).toEqual(expected);
          expect(Result.getOrThrow(again).value).not.toBe(issued);
        }
      }
    };
    for (const leaf of [() => 1, Symbol("s"), "\ud800", "x".repeat(64), "x", 1n << 70n, Object.freeze({ $bad: 1 })])
      settles(planted(leaf).value, captureDocumentValueWithSize({ leaf }));

    // A frozen array that inherits from ArrayBuffer would send a later walk down the binary branch again.
    const mutable = { changed: false };
    const binaryArray = Object.freeze(Object.setPrototypeOf([], Object.create(ArrayBuffer.prototype, {
      slice: { value: () => mutable }, byteLength: { value: 1 },
    })));
    const relayed = planted(binaryArray).value;
    const walks = [1, 2, 3].map(() => captureDocumentValue(relayed));
    const successes = walks.filter(Result.isSuccess).map(walk => walk.success);
    expect(new Set(successes).size).toBe(successes.length);
    expect(successes.length).toBeGreaterThan(0);

    // Unsorted keys of a planted frozen object never reach a returned tree.
    const unsorted = planted(Object.freeze({ b: 1, a: 2 }), 22).value;
    for (let repeat = 0; repeat < 3; repeat++)
      expect(Object.keys((Result.getOrThrow(captureDocumentValue(unsorted)) as { leaf: object }).leaf)).toEqual(["a", "b"]);

    const left: Record<string, unknown> = {}, right: Record<string, unknown> = { left };
    left.right = right; Object.freeze(left); Object.freeze(right);
    settles(planted(left).value, captureDocumentValueWithSize({ leaf: left }));

    // A shared frozen subtree is refused by the node budget or the codec's limits, not walked without bound.
    let shared: unknown = "x".repeat(1 << 22);
    for (let depth = 0; depth < 40; depth++) shared = Object.freeze({ a: shared, b: shared });
    const started = Date.now();
    expect(Result.isFailure(captureDocumentValue(planted(shared).value))).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);

    // A Proxy leaf that changes its target during a later walk is never returned.
    const target: Record<string, unknown> = { a: 1 };
    let prototypeReads = 0;
    const shifting = new Proxy(target, {
      getPrototypeOf(current) {
        if (++prototypeReads > 1 && !Object.isFrozen(current)) { current.a = 1n << 70n; Object.freeze(current); }
        return Reflect.getPrototypeOf(current);
      },
    });
    const disguised = planted(shifting, 11).value;
    for (let repeat = 0; repeat < 3; repeat++) {
      const again = captureDocumentValueWithSize(disguised);
      if (Result.isSuccess(again)) {
        expect(again.success.value).not.toBe(disguised);
        expect((again.success.value as { leaf: unknown }).leaf).not.toBe(shifting);
      }
    }
  });

  it("proves a decoded scalar document at once and still copies a decoded binary one", () => {
    const scalar = Result.getOrThrow(decode('{"a":[1,{"$integer":"AQAAAAAAAAA="}],"b":"x"}'));
    expect(scalar).toEqual({ a: [1, 1n], b: "x" });
    expect(Result.getOrThrow(captureDocumentValue(scalar))).toBe(scalar);
    expect(Result.getOrThrow(captureDocumentObject(scalar))).toBe(scalar);
    expect(Result.getOrThrow(captureDocumentValueWithSize(scalar)))
      .toEqual(Result.getOrThrow(captureDocumentValueWithSize({ a: [1, 1n], b: "x" })));
    const binary = Result.getOrThrow(decode('{"bytes":{"$bytes":"AP8B"}}')) as { bytes: ArrayBuffer };
    for (let repeat = 0; repeat < 3; repeat++) {
      const copied = Result.getOrThrow(captureDocumentValue(binary)) as { bytes: ArrayBuffer };
      expect(copied).not.toBe(binary);
      expect(copied.bytes).not.toBe(binary.bytes);
    }
    // Refusals keep their reason and order through the plain decoder.
    expect(decode('{"a":{"$bytes":"?"},"b":{"$unknown":1}}')).toMatchObject({ _tag: "Failure", failure: { reason: "invalidTag" } });
    expect(decode("[".repeat(65) + "]".repeat(65))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidValue" } });
  });

  it("selects the same refusal for a proven root outside the requested profile", () => {
    const prove = (input: unknown) => Result.getOrThrow(captureDocumentValue(Result.getOrThrow(captureDocumentValue(input))));
    let deep: unknown = 1;
    for (let depth = 0; depth < 17; depth++) deep = { child: deep };
    const general = prove(deep);
    expect(Result.getOrThrow(captureDocumentValue(general))).toBe(general);
    const fresh = captureDocumentObjectWithSize(structuredClone(deep));
    for (let repeat = 0; repeat < 2; repeat++) {
      const refused = captureDocumentObjectWithSize(general);
      expect(Result.isFailure(refused)).toBe(true);
      expect(refused).toEqual(fresh);
    }
    const large = prove({ text: "x".repeat((1 << 20) + 1) });
    expect(captureDocumentObjectWithSize(large)).toEqual(captureDocumentObjectWithSize({ text: "x".repeat((1 << 20) + 1) }));
    const list = prove([1, 2]);
    expect(captureDocumentObjectWithSize(list)).toEqual(captureDocumentObjectWithSize([1, 2]));
    expect(Result.isFailure(captureDocumentObjectWithSize(list))).toBe(true);
    // A refusal under the stricter profile does not demote a proven root.
    for (const root of [general, large, list]) expect(Result.getOrThrow(captureDocumentValue(root))).toBe(root);

    let edge: unknown = 1;
    for (let depth = 0; depth < 16; depth++) edge = { child: edge };
    const atLimit = prove(edge);
    expect(Result.getOrThrow(captureDocumentObject(atLimit))).toBe(atLimit);
    const document = Result.getOrThrow(captureDocumentObject(Result.getOrThrow(captureDocumentObject({ a: 1 }))));
    expect(Result.getOrThrow(captureDocumentObject(document))).toBe(document);
    expect(Result.getOrThrow(captureDocumentValue(document))).toBe(document);
  });
});
