/**
 * Scalar translation of rand_chacha 0.9.0 src/guts.rs, used by Convex at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Twelve rounds, a wrapping 64-bit
 * block counter and zero 64-bit stream identifier; no IETF counter restriction.
 * The caller owns a captured 32-byte seed. This is an internal primitive, not
 * a host input boundary or a mutable stream/transaction capability.
 *
 * Copyright 2019 The CryptoCorrosion Contributors
 * Copyright 2020 Developers of the Rand project.
 * Copyright 2018 Developers of the Rand project
 * Copyright (c) 2014 The Rust Project Developers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

type State = [number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number];
const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
type Position = typeof positions[number];

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function quarterRound(state: State, a: Position, b: Position, c: Position, d: Position): void {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotateLeft(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotateLeft(state[b] ^ state[c], 7);
}

/** The counter is interpreted modulo 2^64, matching Source's wrapping u64. */
export function chacha12Block(seed: Uint8Array, counter: bigint): Uint8Array {
  const key = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
  const initial: State = [0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574,
    key.getUint32(0, true), key.getUint32(4, true), key.getUint32(8, true), key.getUint32(12, true),
    key.getUint32(16, true), key.getUint32(20, true), key.getUint32(24, true), key.getUint32(28, true),
    Number(BigInt.asUintN(32, counter)), Number(BigInt.asUintN(32, counter >> 32n)), 0, 0];
  const state: State = [...initial];
  for (let round = 0; round < 6; round++) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }
  const output = new Uint8Array(64);
  const view = new DataView(output.buffer);
  for (const index of positions) view.setUint32(index * 4, (state[index] + initial[index]) >>> 0, true);
  return output;
}
