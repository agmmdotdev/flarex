import { createHash } from "node:crypto";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "../src/document-id";
import { encodeIndexKey, encodeIndexValue, compareIndexKeys, splitIndexKey } from "../src/index-key";
import type { DocumentValue } from "../src/document-value";

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
