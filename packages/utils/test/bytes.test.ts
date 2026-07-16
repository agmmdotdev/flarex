import { describe, expect, it } from "vitest";

import { bytesEqual, bytesEqualFullScan } from "@flarex/utils/bytes";

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
