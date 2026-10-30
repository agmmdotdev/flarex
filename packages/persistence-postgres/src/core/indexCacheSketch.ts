/**
 * FrequencySketch translated from convex/moka 0.12.16, revision
 * ef75713ad43a39fae18c3c01fa414eefa9439af0, src/common/frequency_sketch.rs.
 * That source incorporates Caffeine FrequencySketch, Copyright its contributors,
 * Apache-2.0. Moka is Copyright its contributors, Apache-2.0 OR MIT.
 * SipHash-1-3 follows Rust core/hash/sip.rs (Rust contributors, Apache-2.0 OR MIT).
 * Hashing is private residency policy; exact keys, not hashes, establish identity.
 */

const SEEDS = [0xc3a5_c85c_97cb_3127n, 0xb492_b66f_be98_f273n,
  0x9ae1_6a3b_2f90_404fn, 0xcbf2_9ce4_8422_2325n] as const;
const RESET_MASK = 0x7777_7777_7777_7777n;
const ONE_MASK = 0x1111_1111_1111_1111n;
const utf8 = new TextEncoder();

function rotate(value: bigint, count: bigint): bigint {
  return BigInt.asUintN(64, (value << count) | (value >> (64n - count)));
}

/** Keyed SipHash-1-3 over our canonical UTF-8 key representation. */
export function hashCoreIndexPageKey(key: string, seed0: bigint, seed1: bigint): bigint {
  const bytes = utf8.encode(key);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let v0 = seed0 ^ 0x736f_6d65_7073_6575n;
  let v1 = seed1 ^ 0x646f_7261_6e64_6f6dn;
  let v2 = seed0 ^ 0x6c79_6765_6e65_7261n;
  let v3 = seed1 ^ 0x7465_6462_7974_6573n;
  const round = () => {
    v0 = BigInt.asUintN(64, v0 + v1);
    v2 = BigInt.asUintN(64, v2 + v3);
    v1 = rotate(v1, 13n) ^ v0;
    v3 = rotate(v3, 16n) ^ v2;
    v0 = rotate(v0, 32n);
    v2 = BigInt.asUintN(64, v2 + v1);
    v0 = BigInt.asUintN(64, v0 + v3);
    v1 = rotate(v1, 17n) ^ v2;
    v3 = rotate(v3, 21n) ^ v0;
    v2 = rotate(v2, 32n);
  };
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const word = view.getBigUint64(offset, true);
    v3 ^= word;
    round();
    v0 ^= word;
    offset += 8;
  }
  let tail = BigInt(bytes.length & 255) << 56n;
  for (let index = offset; index < bytes.length; index += 1)
    tail |= BigInt(bytes[index] ?? 0) << BigInt(8 * (index - offset));
  v3 ^= tail;
  round();
  v0 ^= tail;
  v2 ^= 255n;
  round();
  round();
  round();
  return v0 ^ v1 ^ v2 ^ v3;
}

/** Four 4-bit counters per sample, with the pinned saturation and aging rules. */
export class CoreIndexCacheFrequencySketch {
  private table = new BigUint64Array(0);
  private mask = 0n;
  private sampleSize = 0;
  private size = 0;

  ensureCapacity(capacity: number): void {
    const maximum = Math.min(capacity, 2 ** 30);
    const tableSize = maximum === 0 ? 1 : 2 ** Math.ceil(Math.log2(maximum));
    if (this.table.length >= tableSize) return;
    this.table = new BigUint64Array(tableSize);
    this.mask = BigInt(tableSize - 1);
    this.sampleSize = capacity === 0 ? 10 : Math.min(maximum * 10, 2 ** 31 - 1);
  }

  frequency(hash: bigint): number {
    if (this.table.length === 0) return 0;
    const start = Number((hash & 3n) << 2n);
    let frequency = 15;
    for (const [depth, seed] of SEEDS.entries()) {
      const index = this.index(hash, seed);
      const count = Number(((this.table[index] ?? 0n) >> BigInt((start + depth) * 4)) & 15n);
      frequency = Math.min(frequency, count);
    }
    return frequency;
  }

  increment(hash: bigint): void {
    if (this.table.length === 0) return;
    const start = Number((hash & 3n) << 2n);
    let added = false;
    for (const [depth, seed] of SEEDS.entries()) {
      const index = this.index(hash, seed);
      const shift = BigInt((start + depth) * 4);
      const word = this.table[index] ?? 0n;
      if (((word >> shift) & 15n) !== 15n) {
        this.table[index] = word + (1n << shift);
        added = true;
      }
    }
    if (added) {
      this.size += 1;
      if (this.size >= this.sampleSize) this.reset();
    }
  }

  private index(hash: bigint, seed: bigint): number {
    let mixed = BigInt.asUintN(64, BigInt.asUintN(64, hash + seed) * seed);
    mixed = BigInt.asUintN(64, mixed + (mixed >> 32n));
    return Number(mixed & this.mask);
  }

  private reset(): void {
    let odd = 0;
    for (let index = 0; index < this.table.length; index += 1) {
      const word = this.table[index] ?? 0n;
      let bits = word & ONE_MASK;
      while (bits !== 0n) { bits &= bits - 1n; odd += 1; }
      this.table[index] = (word >> 1n) & RESET_MASK;
    }
    this.size = Math.floor(this.size / 2) - Math.floor(odd / 4);
  }
}
