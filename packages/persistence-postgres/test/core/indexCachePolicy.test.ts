import { describe, expect, it } from "vitest";
import { CoreIndexCachePolicy } from "../../src/core/indexCachePolicy";
import { CoreIndexCacheFrequencySketch, hashCoreIndexPageKey } from "../../src/core/indexCacheSketch";
import { CoreIndexCacheIntervals } from "../../src/core/indexCacheIntervals";
import type { CoreInterval } from "../../src/core/contracts";

const hash = (key: string) => hashCoreIndexPageKey(key, 0n, 1n);
const byte = (value: number) => Uint8Array.of(value);

describe("translated weighted page residency", () => {
  it("matches published Rust SipHash-1-3 vectors across the tail/block boundary", () => {
    // Rust coretests/tests/hash/sip.rs at rust-lang/rust 1.90.0, Apache-2.0 OR MIT.
    const vectors = [0xabac0158050fc4dcn, 0xc9f49bf37d57ca93n, 0x82cb9b024dc7d44dn,
      0x8bf80ab8e7ddf7fbn, 0xcf75576088d38328n, 0xdef9d52f49533b67n,
      0xc50d2b50c59f22a7n, 0xd3927d989bb11140n, 0x369095118d299a8en];
    for (const [length, expected] of vectors.entries()) {
      const key = String.fromCharCode(...Array.from({ length }, (_, index) => index));
      expect(hashCoreIndexPageKey(key, 0x0706050403020100n, 0x0f0e0d0c0b0a0908n)).toBe(expected);
    }
  });

  it("saturates the four-bit sketch and ages old popularity", () => {
    const sketch = new CoreIndexCacheFrequencySketch();
    sketch.ensureCapacity(128);
    for (let count = 0; count < 100; count += 1) sketch.increment(hash("old"));
    expect(sketch.frequency(hash("old"))).toBe(15);
    expect(sketch.frequency(hash("never"))).toBe(0);
    for (let count = 0; count < 10_000; count += 1) sketch.increment(hash(`new-${count}`));
    expect(sketch.frequency(hash("old"))).toBeLessThan(15);
    expect(sketch.frequency(hash("old"))).toBeGreaterThanOrEqual(0);
  });

  it("counts misses, rejects frequency ties, and preserves existing entries", () => {
    const removed: string[] = [];
    const policy = new CoreIndexCachePolicy<number>(2, hash, key => { removed.push(key); });
    expect(policy.insert("a", 1, 1)).toBe(true);
    expect(policy.insert("b", 2, 1)).toBe(true);
    expect(policy.insert("c", 3, 1)).toBe(false);
    expect(policy.insert("a", 100, 1)).toBe(false);
    expect(policy.peek("a")).toBe(1);
    expect(policy.get("c")).toBeUndefined();
    expect(policy.insert("c", 3, 1)).toBe(true);
    expect(removed).toEqual(["a"]);
    expect(policy.weightedSize).toBe(2);
    expect(policy.size).toBe(2);
  });

  it("compares a weighted candidate against the combined LRU victims", () => {
    const removed: string[] = [];
    const policy = new CoreIndexCachePolicy<string>(10, hash, key => { removed.push(key); });
    policy.insert("a", "a", 5);
    policy.get("a");
    policy.get("a");
    policy.insert("b", "b", 5);
    policy.get("c");
    policy.get("c");
    expect(policy.insert("c", "c", 8)).toBe(false);
    expect(removed).toEqual([]);
    policy.get("c");
    expect(policy.insert("c", "c", 8)).toBe(true);
    expect(removed).toEqual(["a", "b"]);
    expect(policy.weightedSize).toBe(8);
    expect(policy.size).toBe(1);
    expect(policy.insert("oversized", "large", 11)).toBe(false);
    expect(policy.weightedSize).toBe(8);
    policy.clear();
    expect(removed).toEqual(["a", "b", "c"]);
    expect(policy.weightedSize).toBe(0);
  });

  it("moves hits and same-weight ready replacements to the MRU position", () => {
    const removed: string[] = [];
    const policy = new CoreIndexCachePolicy<number>(3, hash, key => { removed.push(key); });
    policy.insert("a", 1, 1);
    policy.insert("b", 2, 1);
    policy.insert("c", 3, 1);
    policy.touch("a");
    for (let count = 0; count < 3; count += 1) policy.get("d");
    expect(policy.insert("d", 4, 1)).toBe(true);
    expect(removed).toEqual(["b"]);
    expect(policy.peek("a")).toBe(1);
  });
});

describe("translated page interval registrations", () => {
  it("retains exact half-open coverage through duplicate starts, rotations and removals", () => {
    const intervals = new CoreIndexCacheIntervals();
    const expected = new Map<string, CoreInterval>();
    let random = 0x51a4b71;
    const next = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random; };
    for (let index = 0; index < 500; index += 1) {
      const start = next() % 240;
      const end = Math.min(255, start + 1 + next() % 16);
      const interval = { start: index % 17 === 0 ? null : byte(start), end: index % 19 === 0 ? null : byte(end) };
      expected.set(String(index), interval);
      intervals.insert(String(index), interval, next());
    }
    for (const [key, start, end] of [["empty", 12, 12], ["adjacent-left", 12, 14],
      ["adjacent-right", 14, 16], ["same-start", 12, 16]] as const) {
      const interval = { start: byte(start), end: byte(end) };
      expected.set(key, interval);
      intervals.insert(key, interval, next());
    }
    const check = () => {
      for (let point = 0; point < 256; point += 1) {
        const wanted = [...expected].filter(([, interval]) =>
          (interval.start === null || (interval.start[0] ?? 0) <= point)
          && (interval.end === null || point < (interval.end[0] ?? 0))).map(([key]) => key).sort();
        expect([...intervals.query(byte(point))].sort()).toEqual(wanted);
      }
    };
    check();
    for (let index = 0; index < 500; index += 3) { intervals.remove(String(index)); expected.delete(String(index)); }
    check();
    for (let index = 0; index < 150; index += 3) {
      const interval = { start: byte(index), end: byte(index + 1) };
      intervals.insert(String(index), interval, next());
      expected.set(String(index), interval);
    }
    check();
    expect(intervals.size).toBe(expected.size);
    for (const key of expected.keys()) intervals.remove(key);
    expect(intervals.size).toBe(0);
    expect(intervals.query(byte(128))).toEqual([]);
  });
});
