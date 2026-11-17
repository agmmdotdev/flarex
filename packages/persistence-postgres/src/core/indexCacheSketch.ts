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

/** Reused UTF-8 scratch space: hashing is synchronous and retains none of it. */
let scratch = new Uint8Array(256);

/**
 * Keyed SipHash-1-3 over our canonical UTF-8 key representation. Seeds are
 * unsigned 64-bit words. Each state word is carried as two 32-bit halves, so
 * the rounds allocate nothing; the result is the same 64-bit word.
 */
export function hashCoreIndexPageKey(key: string, seed0: bigint, seed1: bigint): bigint {
  // A UTF-16 code unit encodes to at most three UTF-8 bytes.
  if (scratch.length < key.length * 3) scratch = new Uint8Array(key.length * 3);
  const bytes = scratch;
  const length = utf8.encodeInto(key, bytes).written;
  const k0l = Number(seed0 & 0xffff_ffffn) | 0;
  const k0h = Number(seed0 >> 32n) | 0;
  const k1l = Number(seed1 & 0xffff_ffffn) | 0;
  const k1h = Number(seed1 >> 32n) | 0;
  let v0h = k0h ^ 0x736f_6d65, v0l = k0l ^ 0x7073_6575;
  let v1h = k1h ^ 0x646f_7261, v1l = k1l ^ 0x6e64_6f6d;
  let v2h = k0h ^ 0x6c79_6765, v2l = k0l ^ 0x6e65_7261;
  let v3h = k1h ^ 0x7465_6462, v3l = k1l ^ 0x7974_6573;
  const blocks = length >>> 3;
  // Every full block and then the length-tagged tail compress once; three more rounds finalize.
  for (let step = 0; step < blocks + 4; step += 1) {
    let mh = 0, ml = 0;
    if (step < blocks) {
      const at = step << 3;
      ml = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24);
      mh = (bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8) | ((bytes[at + 6] ?? 0) << 16) | ((bytes[at + 7] ?? 0) << 24);
    } else if (step === blocks) {
      const at = blocks << 3;
      mh = (length & 255) << 24;
      for (let index = at; index < length; index += 1) {
        const shift = (index - at) << 3;
        if (shift < 32) ml |= (bytes[index] ?? 0) << shift;
        else mh |= (bytes[index] ?? 0) << (shift - 32);
      }
    } else if (step === blocks + 1) v2l ^= 255;
    v3h ^= mh; v3l ^= ml;
    let low = (v0l + v1l) | 0;
    v0h = (v0h + v1h + ((low >>> 0) < (v0l >>> 0) ? 1 : 0)) | 0; v0l = low;
    low = (v2l + v3l) | 0;
    v2h = (v2h + v3h + ((low >>> 0) < (v2l >>> 0) ? 1 : 0)) | 0; v2l = low;
    let high = (v1h << 13) | (v1l >>> 19);
    v1l = ((v1l << 13) | (v1h >>> 19)) ^ v0l; v1h = high ^ v0h;
    high = (v3h << 16) | (v3l >>> 16);
    v3l = ((v3l << 16) | (v3h >>> 16)) ^ v2l; v3h = high ^ v2h;
    low = v0h; v0h = v0l; v0l = low;
    low = (v2l + v1l) | 0;
    v2h = (v2h + v1h + ((low >>> 0) < (v2l >>> 0) ? 1 : 0)) | 0; v2l = low;
    low = (v0l + v3l) | 0;
    v0h = (v0h + v3h + ((low >>> 0) < (v0l >>> 0) ? 1 : 0)) | 0; v0l = low;
    high = (v1h << 17) | (v1l >>> 15);
    v1l = ((v1l << 17) | (v1h >>> 15)) ^ v2l; v1h = high ^ v2h;
    high = (v3h << 21) | (v3l >>> 11);
    v3l = ((v3l << 21) | (v3h >>> 11)) ^ v0l; v3h = high ^ v0h;
    low = v2h; v2h = v2l; v2l = low;
    v0h ^= mh; v0l ^= ml;
  }
  return (BigInt((v0h ^ v1h ^ v2h ^ v3h) >>> 0) << 32n) | BigInt((v0l ^ v1l ^ v2l ^ v3l) >>> 0);
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
