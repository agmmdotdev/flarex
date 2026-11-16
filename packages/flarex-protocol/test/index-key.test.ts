import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "../src/document-id";
import { encodeCapturedIndexValue, encodeDocumentIndexKey, encodeIndexKey, encodeIndexValue, compareIndexKeys, splitIndexKey } from "../src/index-key";
import { captureDocumentObject, isCapturedDocumentRoot, type DocumentValue } from "../src/document-value";

const hex = (value: DocumentValue | undefined) => Buffer.from(Result.getOrThrow(encodeIndexValue(value))).toString("hex");

describe("Convex ordinary index encoding", () => {
  it("matches source-derived tag/width/endianness/escape vectors", () => {
    const vectors: readonly [DocumentValue | undefined, string][] = [
      [undefined, "01"], [null, "03"], [-129n, "06ff7f"], [-128n, "0780"],
      [-1n, "07ff"], [0n, "08"], [1n, "0901"], [127n, "097f"], [128n, "0a0080"],
      [32768n, "0b00008000"], [-(1n << 63n), "048000000000000000"],
      [(1n << 63n) - 1n, "0c7fffffffffffffff"],
      [-Infinity, "0d000fffffffffffff"], [-1, "0d400fffffffffffff"],
      [-0, "0d7fffffffffffffff"], [0, "0d8000000000000000"],
      [1, "0dbff0000000000000"], [Infinity, "0dfff0000000000000"],
      [false, "0e"], [true, "0f"], ["", "1000"], ["a\0b", "106100ff6200"],
      [Uint8Array.of(0, 255).buffer, "1100ffff00"],
      [[], "1200"], [[null, true], "12030f00"], [{}, "1500"],
      [{ "": null }, "1500ff0300"], [{ b: 1n, a: null }, "156100036200090100"],
    ];
    for (const [value, expected] of vectors) expect(hex(value), String(value)).toBe(expected);
  });

  it("orders every admitted type, signed integer widths, float signs and nested prefixes", () => {
    const values: readonly (DocumentValue | undefined)[] = [
      undefined, null, -(1n << 63n), -2147483649n, -32769n, -129n, -128n, -1n, 0n,
      1n, 127n, 128n, 32767n, 32768n, 2147483648n, (1n << 63n) - 1n,
      -Infinity, -10, -0, 0, 1, Infinity, NaN, false, true, "", "\0", "a", "aa", "b", "é", "\uffff", "𐀀",
      new ArrayBuffer(0), Uint8Array.of(0).buffer, [], [null], [null, null], [true], {}, { "": null }, { a: null },
    ];
    const encoded = values.map(value => Result.getOrThrow(encodeIndexValue(value)));
    expect([...encoded].reverse().sort(compareIndexKeys)).toEqual(encoded);
  });

  it("appends developer ID as a string sort key and retains full long-key identity", () => {
    const first = Result.getOrThrow(encodeDocumentId(1, new Uint8Array(16)));
    const second = Result.getOrThrow(encodeDocumentId(1, Uint8Array.from({ length: 16 }, (_, i) => i)));
    const field = "x".repeat(2600);
    const a = Result.getOrThrow(encodeIndexKey([field, undefined, null], first));
    const b = Result.getOrThrow(encodeIndexKey([field, undefined, null], second));
    expect(a.byteLength).toBeGreaterThan(2500);
    expect(Buffer.from(a.subarray(-first.length - 2)).toString("hex")).toBe(hex(first));
    const split = splitIndexKey(a);
    expect(split.keyPrefix.byteLength).toBe(2500);
    expect(split.keySuffix).not.toBeNull();
    expect(Buffer.concat([split.keyPrefix, split.keySuffix ?? new Uint8Array()])).toEqual(Buffer.from(a));
    expect(Buffer.from(split.keySha256)).toEqual(createHash("sha256").update(a).digest());
    expect(splitIndexKey(b).keyPrefix).toEqual(split.keyPrefix);
    expect(splitIndexKey(b).keySha256).not.toEqual(split.keySha256);
    const before = a[0]; split.keyPrefix[0] = 255;
    expect(a[0]).toBe(before);
    expect(splitIndexKey(new Uint8Array(2500)).keySuffix).toBeNull();
    expect(Result.isFailure(encodeIndexKey([1], "1:old-id"))).toBe(true);
  });
});

describe("captured document index keys", () => {
  it("encode exactly like the capturing path, for captured and uncaptured roots alike", () => {
    const id = Result.getOrThrow(encodeDocumentId(100, new Uint8Array(16).fill(7)));
    const bytes = new Uint8Array([0, 255, 1]);
    const document = Result.getOrThrow(captureDocumentObject({ _id: id, _creationTime: 1, nothing: null, int: 9_007_199_254_740_993n,
      minimum: -(2n ** 63n), maximum: 2n ** 63n - 1n, negative: -0, float: 1.5, nan: Number.NaN, up: Number.POSITIVE_INFINITY,
      down: Number.NEGATIVE_INFINITY, yes: true, text: "a\u0000b", bytes: bytes.buffer,
      list: [1, "two", [null]], nested: { b: 2, a: { "": 1 } } }));
    expect(isCapturedDocumentRoot(document)).toBe(true);
    const copy = { ...document };
    expect(isCapturedDocumentRoot(copy)).toBe(false);
    const fields = ["nothing", "int", "minimum", "maximum", "negative", "float", "nan", "up", "down", "yes", "text", "bytes", "list",
      "nested", "missing"] as const;
    const same = (values: readonly (DocumentValue | undefined)[]) => {
      const expected = Result.getOrThrow(encodeIndexKey(values, id));
      expect(Result.getOrThrow(encodeDocumentIndexKey(document, values, id))).toEqual(expected);
      expect(Result.getOrThrow(encodeDocumentIndexKey(copy, values, id))).toEqual(expected);
    };
    for (const field of fields) same([document[field]]);
    same(fields.map(field => document[field]));
    // A binary leaf is read at encoding time on both paths.
    const leaf = document.bytes;
    if (!(leaf instanceof ArrayBuffer)) throw new Error("Missing captured bytes leaf");
    new Uint8Array(leaf)[0] = 9;
    same([leaf]);
    for (const root of [document, copy])
      expect(encodeDocumentIndexKey(root, [], "not-an-id")).toMatchObject({ _tag: "Failure", failure: { reason: "invalidDocumentId" } });
    expect(encodeIndexKey([], "not-an-id")).toMatchObject({ _tag: "Failure", failure: { reason: "invalidDocumentId" } });
    // The last proven ID is kept; a refusal is never kept and never displaces it wrongly.
    const valid = Result.getOrThrow(encodeDocumentId(1, new Uint8Array(16).fill(7)));
    const key = Result.getOrThrow(encodeIndexKey([1], valid));
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(Result.getOrThrow(encodeIndexKey([1], valid))).toEqual(key);
      expect(encodeIndexKey([1], `${valid}x`)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidDocumentId" } });
      expect(encodeIndexKey([1], "not-an-id")).toMatchObject({ _tag: "Failure", failure: { reason: "invalidDocumentId" } });
    }
  });
});

describe("index key text encoding", () => {
  const reference = new TextEncoder();
  const escaped = (text: string): number[] => {
    const out: number[] = [];
    for (const byte of reference.encode(text)) { out.push(byte); if (byte === 0) out.push(255); }
    out.push(0);
    return out;
  };
  // 4096 scratch bytes hold 1365 code units at three bytes each.
  const lengths = [0, 1, 2, 7, 1364, 1365, 1366, 1367, 4095, 4096, 4097, 9000];
  const alphabets: readonly (readonly string[])[] = [
    ["a", "Z", "0", " "],
    ["é", "ß", "€", "中", "a"],
    ["😀", "𝄞", "a", "€"],
    ["\u0000", "a", "\u0000"],
    ["\ud800", "a", "\udc00", "😀", "\udbff", "\udfff", "€"],
  ];
  const samples = (): string[] => {
    const texts = ["", "\u0000", "\ud800", "\udc00", "\udc00\ud800", "a\ud83d", "\ude00a", "😀"];
    let seed = 0x9e3779b9;
    const next = (bound: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % bound;
    };
    for (const alphabet of alphabets) {
      for (const length of lengths) {
        let text = "";
        while (text.length < length) text += alphabet[next(alphabet.length)] ?? "";
        texts.push(text, text.slice(0, length));
      }
    }
    return texts;
  };

  it("matches TextEncoder.encode for string values and object field names, at every scratch boundary", () => {
    for (const text of samples()) {
      expect(Array.from(encodeCapturedIndexValue(text))).toEqual([16, ...escaped(text)]);
      expect(Array.from(encodeCapturedIndexValue({ [text]: text })))
        .toEqual([21, ...escaped(text), ...(text === "" ? [255] : []), 16, ...escaped(text), 0]);
    }
  });

  it("keeps no state between strings of different lengths", () => {
    const long = "€".repeat(1365);
    expect(Array.from(encodeCapturedIndexValue([long, "a", "", long])))
      .toEqual([18, 16, ...escaped(long), 16, ...escaped("a"), 16, ...escaped(""), 16, ...escaped(long), 0]);
  });
});
