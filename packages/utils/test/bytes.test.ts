import { describe, expect, it } from "vitest";

import {
  bytesEqual,
  bytesEqualFullScan,
  compareBytesLexicographically,
  copyBytes,
  copyBytesToArrayBuffer,
} from "@flarex/utils/bytes";

describe("copyBytes", () => {
  it("copies only the visible byte range without retaining mutable aliases", () => {
    const backing = new Uint8Array([9, 1, 2, 8]);
    const source = backing.subarray(1, 3);
    const copy = copyBytes(source);

    expect(copy).toEqual(new Uint8Array([1, 2]));
    expect(copy).not.toBe(source);
    expect(copy.buffer).not.toBe(source.buffer);

    source.fill(7);
    expect(copy).toEqual(new Uint8Array([1, 2]));

    copy.fill(6);
    expect(source).toEqual(new Uint8Array([7, 7]));
  });
});

describe("copyBytesToArrayBuffer", () => {
  it("copies only the visible byte range into independent exact storage", () => {
    const backing = new Uint8Array([9, 1, 2, 8]);
    const source = backing.subarray(1, 3);
    const buffer = copyBytesToArrayBuffer(source);
    const copy = new Uint8Array(buffer);

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(2);
    expect(copy).toEqual(new Uint8Array([1, 2]));
    expect(buffer).not.toBe(source.buffer);

    source.fill(7);
    expect(copy).toEqual(new Uint8Array([1, 2]));

    copy.fill(6);
    expect(source).toEqual(new Uint8Array([7, 7]));
  });
});

describe("compareBytesLexicographically", () => {
  it("orders by the first differing unsigned byte", () => {
    expect(compareBytesLexicographically(
      new Uint8Array([1, 254]),
      new Uint8Array([1, 255]),
    )).toBeLessThan(0);
    expect(compareBytesLexicographically(
      new Uint8Array([255]),
      new Uint8Array([0]),
    )).toBeGreaterThan(0);
  });

  it("orders an equal prefix before a longer value", () => {
    expect(compareBytesLexicographically(
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 0]),
    )).toBeLessThan(0);
    expect(compareBytesLexicographically(
      new Uint8Array([1, 2, 0]),
      new Uint8Array([1, 2]),
    )).toBeGreaterThan(0);
  });

  it("treats identical values as equal", () => {
    expect(compareBytesLexicographically(
      new Uint8Array(),
      new Uint8Array(),
    )).toBe(0);
    expect(compareBytesLexicographically(
      new Uint8Array([0, 128, 255]),
      new Uint8Array([0, 128, 255]),
    )).toBe(0);
  });
});

const comparisons = [
  ["bytesEqual", bytesEqual],
  ["bytesEqualFullScan", bytesEqualFullScan],
] as const;

function observeByteReads(values: ReadonlyArray<number>): {
  readonly bytes: Uint8Array;
  readonly reads: ReadonlyArray<number>;
} {
  const reads: number[] = [];
  const target = new Uint8Array(values);
  const bytes = new Proxy(target, {
    get(value, key) {
      if (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)) {
        reads.push(Number(key));
      }
      return Reflect.get(value, key, value);
    },
  });
  return { bytes, reads };
}

describe.each(comparisons)("%s", (_name, compare) => {
  it("accepts equal byte arrays", () => {
    expect(compare(new Uint8Array(), new Uint8Array())).toBe(true);
    expect(compare(new Uint8Array([0, 1, 255]), new Uint8Array([0, 1, 255])))
      .toBe(true);
  });

  it("rejects different lengths", () => {
    expect(compare(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("rejects mismatches at either end", () => {
    expect(compare(new Uint8Array([1, 2, 3]), new Uint8Array([0, 2, 3])))
      .toBe(false);
    expect(compare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])))
      .toBe(false);
  });
});

describe("byte comparison policy", () => {
  it("allows ordinary equality to return at the first mismatch", () => {
    const observed = observeByteReads([1, 2, 3]);

    expect(bytesEqual(observed.bytes, new Uint8Array([0, 2, 3]))).toBe(false);
    expect(observed.reads).toEqual([0]);
  });

  it("checks every equal-length byte in the full-scan variant", () => {
    const observed = observeByteReads([1, 2, 3]);

    expect(bytesEqualFullScan(observed.bytes, new Uint8Array([0, 2, 3])))
      .toBe(false);
    expect(observed.reads).toEqual([0, 1, 2]);
  });
});
