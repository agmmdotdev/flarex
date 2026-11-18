import { describe, expect, it } from "vitest";
import { hashCoreIndexPageKey } from "../../src/core/indexCacheSketch";

const WORD = 0xffff_ffff_ffff_ffffn;
const rotate = (value: bigint, count: bigint) => ((value << count) | (value >> (64n - count))) & WORD;

/** Rust core/hash/sip.rs SipHash-1-3 on 64-bit words: the definition the 32-bit form must equal. */
function sipHash13(bytes: Uint8Array, seed0: bigint, seed1: bigint): bigint {
  let v0 = seed0 ^ 0x736f_6d65_7073_6575n;
  let v1 = seed1 ^ 0x646f_7261_6e64_6f6dn;
  let v2 = seed0 ^ 0x6c79_6765_6e65_7261n;
  let v3 = seed1 ^ 0x7465_6462_7974_6573n;
  const round = () => {
    v0 = (v0 + v1) & WORD; v2 = (v2 + v3) & WORD;
    v1 = rotate(v1, 13n) ^ v0; v3 = rotate(v3, 16n) ^ v2; v0 = rotate(v0, 32n);
    v2 = (v2 + v1) & WORD; v0 = (v0 + v3) & WORD;
    v1 = rotate(v1, 17n) ^ v2; v3 = rotate(v3, 21n) ^ v0; v2 = rotate(v2, 32n);
  };
  const compress = (word: bigint) => { v3 ^= word; round(); v0 ^= word; };
  const blocks = bytes.length - bytes.length % 8;
  for (let offset = 0; offset < blocks; offset += 8) {
    let word = 0n;
    for (let index = 0; index < 8; index += 1) word |= BigInt(bytes[offset + index] ?? 0) << BigInt(8 * index);
    compress(word);
  }
  let tail = BigInt(bytes.length & 255) << 56n;
  for (let index = blocks; index < bytes.length; index += 1) tail |= BigInt(bytes[index] ?? 0) << BigInt(8 * (index - blocks));
  compress(tail);
  v2 ^= 255n;
  round(); round(); round();
  return v0 ^ v1 ^ v2 ^ v3;
}

/** Deterministic xorshift32, so a failure names a reproducible input. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return state >>> 0;
  };
}

describe("page-key hash on 32-bit halves", () => {
  const utf8 = new TextEncoder();
  const expectSame = (key: string, seed0: bigint, seed1: bigint) => {
    const actual = hashCoreIndexPageKey(key, seed0, seed1);
    if (actual !== sipHash13(utf8.encode(key), seed0, seed1))
      expect.fail(`hash differs for ${JSON.stringify(key)} with seeds ${seed0} and ${seed1}`);
  };

  it("equals 64-bit SipHash-1-3 at every block and carry boundary", () => {
    const seeds = [0n, 1n, 0xffff_ffffn, 0x1_0000_0000n, 0x8000_0000_0000_0000n, WORD, 0x0706_0504_0302_0100n, 0x0f0e_0d0c_0b0a_0908n];
    for (const seed0 of seeds) for (const seed1 of seeds) {
      for (let length = 0; length <= 41; length += 1) {
        expectSame("a".repeat(length), seed0, seed1);
        expectSame("\u007f".repeat(length), seed0, seed1);
        expectSame(String.fromCharCode(...Array.from({ length }, (_, index) => (index * 37 + 11) & 127)), seed0, seed1);
      }
    }
  });

  it("equals 64-bit SipHash-1-3 for random keys, including multi-byte and ill-formed text", () => {
    const next = generator(0x9e37_79b9);
    const word = () => (BigInt(next()) << 32n) | BigInt(next());
    const alphabets = [127, 0x7ff, 0xffff];
    for (let sample = 0; sample < 20_000; sample += 1) {
      const limit = alphabets[sample % alphabets.length] ?? 127;
      const length = sample % 50 === 0 ? 300 + next() % 4_000 : next() % 70;
      // Lone surrogates take the encoder's replacement character on both sides.
      expectSame(String.fromCharCode(...Array.from({ length }, () => next() % (limit + 1))), word(), word());
    }
    expectSame("😀".repeat(33), word(), word());
    expectSame("x".repeat(100_000), word(), word());
    expectSame("short after the scratch space grew", word(), word());
  });
});
