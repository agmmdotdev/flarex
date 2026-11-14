import { describe, expect, it } from "vitest";

import {
  bytesEqual,
  bytesEqualFullScan,
  compareBytesLexicographically,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
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

  it("preserves the native detached-view failure contract", () => {
    const buffer = new ArrayBuffer(2);
    const bytes = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });

    expect(() => copyBytes(bytes)).toThrow(TypeError);
  });

  it("copies intrinsic bytes instead of a caller-overridden iterator", () => {
    const bytes = new Uint8Array([1, 2]);
    Object.defineProperty(bytes, Symbol.iterator, {
      value: () => [9][Symbol.iterator](),
    });

    expect([...bytes]).toEqual([9]);
    expect(copyBytes(bytes)).toEqual(new Uint8Array([1, 2]));
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

describe("isUint8ArrayWithByteLength", () => {
  it("narrows only Uint8Array views with the requested visible length", () => {
    const backing = new Uint8Array([9, 1, 2, 8]);
    const visible = backing.subarray(1, 3);

    expect(isUint8ArrayWithByteLength(visible, 2)).toBe(true);
    expect(isUint8ArrayWithByteLength(visible, backing.byteLength)).toBe(false);
    expect(isUint8ArrayWithByteLength(new DataView(backing.buffer), 4))
      .toBe(false);
    expect(isUint8ArrayWithByteLength(backing.buffer, 4)).toBe(false);
    expect(isUint8ArrayWithByteLength([9, 1, 2, 8], 4)).toBe(false);
  });

  it("preserves detached views as zero-length Uint8Array values", () => {
    const buffer = new ArrayBuffer(2);
    const bytes = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });

    expect(isUint8ArrayWithByteLength(bytes, 0)).toBe(true);
    expect(isUint8ArrayWithByteLength(bytes, 2)).toBe(false);
  });

  it("does not consult a caller-overridden iterator", () => {
    const bytes = new Uint8Array([1, 2]);
    Object.defineProperty(bytes, Symbol.iterator, {
      value: () => [9][Symbol.iterator](),
    });

    expect([...bytes]).toEqual([9]);
    expect(isUint8ArrayWithByteLength(bytes, 2)).toBe(true);
  });

  it("reads the intrinsic view length instead of an own spoofed property", () => {
    const bytes = new Uint8Array([1]);
    Object.defineProperty(bytes, "byteLength", { value: 32 });

    expect(bytes.byteLength).toBe(32);
    expect(isUint8ArrayWithByteLength(bytes, 1)).toBe(true);
    expect(isUint8ArrayWithByteLength(bytes, 32)).toBe(false);
  });

  it("reads the intrinsic view length instead of a subclass override", () => {
    class SpoofedByteLength extends Uint8Array {
      override get byteLength(): number {
        return 32;
      }
    }

    const bytes = new SpoofedByteLength(1);
    expect(bytes.byteLength).toBe(32);
    expect(isUint8ArrayWithByteLength(bytes, 1)).toBe(true);
    expect(isUint8ArrayWithByteLength(bytes, 32)).toBe(false);
  });

  it("rejects forwarding and revoked Proxies without throwing", () => {
    const target = new Uint8Array([1]);
    expect(isUint8ArrayWithByteLength(new Proxy(target, {}), 1)).toBe(false);

    const forwarding = new Proxy(target, {
      get(value, key) {
        return Reflect.get(value, key, value);
      },
    });
    expect(forwarding.byteLength).toBe(1);
    expect(isUint8ArrayWithByteLength(forwarding, 1)).toBe(false);

    const revocable = Proxy.revocable(new Uint8Array([1]), {});
    revocable.revoke();
    expect(isUint8ArrayWithByteLength(revocable.proxy, 1)).toBe(false);
  });

  it("rejects typed-array prototype impostors without throwing", () => {
    const impostor: unknown = Object.create(Uint8Array.prototype);
    expect(impostor instanceof Uint8Array).toBe(true);
    expect(isUint8ArrayWithByteLength(impostor, 0)).toBe(false);

    const forgedProxy: unknown = new Proxy({}, {
      getPrototypeOf: () => Uint8Array.prototype,
    });
    expect(forgedProxy instanceof Uint8Array).toBe(true);
    expect(isUint8ArrayWithByteLength(forgedProxy, 0)).toBe(false);

    const wrongElementType = new Uint16Array([1]);
    Object.setPrototypeOf(wrongElementType, Uint8Array.prototype);
    expect(wrongElementType instanceof Uint8Array).toBe(true);
    expect(isUint8ArrayWithByteLength(wrongElementType, 2)).toBe(false);
  });
});

describe("isUint8Array", () => {
  it("classifies intrinsic views without a caller-supplied length", () => {
    expect(isUint8Array(new Uint8Array([1]))).toBe(true);
    expect(isUint8Array(new Uint8Array([1]).subarray(1))).toBe(true);
    expect(isUint8Array(new Uint16Array([1]))).toBe(false);
    expect(isUint8Array(new DataView(new ArrayBuffer(1)))).toBe(false);
  });

  it("preserves detached Uint8Array classification", () => {
    const buffer = new ArrayBuffer(2);
    const bytes = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });

    expect(isUint8Array(bytes)).toBe(true);
  });

  it("rejects Proxies and prototype impostors without throwing", () => {
    const bytes = new Uint8Array([1]);
    expect(isUint8Array(new Proxy(bytes, {}))).toBe(false);

    const impostor: unknown = Object.create(Uint8Array.prototype);
    expect(impostor instanceof Uint8Array).toBe(true);
    expect(isUint8Array(impostor)).toBe(false);
  });
});

describe("uint8ArrayByteLength", () => {
  it("returns intrinsic visible length without consulting spoofed properties", () => {
    const bytes = new Uint8Array([1, 2]);
    Object.defineProperty(bytes, "byteLength", { value: 99 });

    expect(uint8ArrayByteLength(bytes)).toBe(2);
    expect(uint8ArrayByteLength(new Proxy(bytes, {}))).toBeUndefined();
    expect(uint8ArrayByteLength(new Uint16Array([1]))).toBeUndefined();
  });
});

describe("encodeBytesToLowercaseHex", () => {
  it("uses the exact two-character lowercase spelling for every byte", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, byte) => byte);

    expect(encodeBytesToLowercaseHex(bytes)).toBe(
      "000102030405060708090a0b0c0d0e0f" +
      "101112131415161718191a1b1c1d1e1f" +
      "202122232425262728292a2b2c2d2e2f" +
      "303132333435363738393a3b3c3d3e3f" +
      "404142434445464748494a4b4c4d4e4f" +
      "505152535455565758595a5b5c5d5e5f" +
      "606162636465666768696a6b6c6d6e6f" +
      "707172737475767778797a7b7c7d7e7f" +
      "808182838485868788898a8b8c8d8e8f" +
      "909192939495969798999a9b9c9d9e9f" +
      "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf" +
      "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf" +
      "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf" +
      "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf" +
      "e0e1e2e3e4e5e6e7e8e9eaebecedeeef" +
      "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
    );
  });

  it("encodes only the visible byte range with lowercase spelling", () => {
    const backing = new Uint8Array([255, 0, 1, 15, 16, 171, 254]);

    expect(encodeBytesToLowercaseHex(backing.subarray(1, 6))).toBe(
      "00010f10ab",
    );
    expect(encodeBytesToLowercaseHex(new Uint8Array())).toBe("");
  });

  it.each([0, 2])("rejects a detached view with original visible length %s", length => {
    const buffer = new ArrayBuffer(2);
    const bytes = new Uint8Array(buffer, 0, length);
    structuredClone(buffer, { transfer: [buffer] });

    expect(() => encodeBytesToLowercaseHex(bytes)).toThrow(TypeError);
  });

  it("reads backing bytes instead of a caller-overridden iterator", () => {
    const bytes = new Uint8Array([0]);
    Object.defineProperty(bytes, Symbol.iterator, {
      value: () => [255][Symbol.iterator](),
    });

    expect([...bytes]).toEqual([255]);
    expect(encodeBytesToLowercaseHex(bytes)).toBe("00");
  });

  it("ignores a subclass's own iterator, values and byteLength properties", () => {
    class Bytes extends Uint8Array {}
    const bytes = new Bytes([0, 15, 16, 171, 255]);
    let reads = 0;
    const poisoned = () => {
      reads += 1;
      throw new Error("Caller property must not be read");
    };
    Object.defineProperties(bytes, {
      [Symbol.iterator]: { get: poisoned },
      values: { get: poisoned },
      byteLength: { get: poisoned },
    });

    expect(encodeBytesToLowercaseHex(bytes)).toBe("000f10abff");
    expect(reads).toBe(0);
  });

  it("preserves intrinsic refusal of forwarding proxies and prototype impostors", () => {
    const proxy = new Proxy(new Uint8Array([1]), {});
    const impostor = Object.create(Uint8Array.prototype);

    expect(() => encodeBytesToLowercaseHex(proxy)).toThrow(TypeError);
    expect(() => encodeBytesToLowercaseHex(impostor)).toThrow(TypeError);
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
