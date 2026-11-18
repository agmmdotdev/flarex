/**
 * TransactionIdGenerator translated from crates/database/src/
 * transaction_id_generator.rs at db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc.; enclosing convex-backend/LICENSE.md.
 * The scalar RNG primitive carries its dependency's MIT notice in chacha12.ts.
 */
import { Result, Schema } from "effect";
import { copyBytes, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { CoreTransactionError } from "./api";
import { chacha12Block } from "./chacha12";
import type { CoreTimestamp } from "./contracts";

const nanosecondsPerDay = 86_400_000_000_000n;
// A typed array's public length can be shadowed. Source owns fixed-size arrays;
// reuse the intrinsic byte-view owner rather than reading caller properties.
const entropy16 = Schema.decodeUnknownResult(Schema.Uint8Array.check(Schema.makeFilter(value =>
  isUint8ArrayWithByteLength(value, 16) ? undefined : "Expected 16 entropy bytes")));
const entropy32 = Schema.decodeUnknownResult(Schema.Uint8Array.check(Schema.makeFilter(value =>
  isUint8ArrayWithByteLength(value, 32) ? undefined : "Expected 32 entropy bytes")));
const rawTime = Schema.decodeUnknownResult(Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 0n && value < nanosecondsPerDay * 65_536n ? undefined : "Expected a supported transaction day")));

/** Validate and detach host bytes before any later asynchronous clock read. */
export function captureCoreEntropy(value: unknown, length: 16 | 32): Result.Result<Uint8Array, CoreTransactionError> {
  return (length === 16 ? entropy16(value) : entropy32(value)).pipe(
    Result.mapError(() => new CoreTransactionError({ reason: "invalidValue",
      cause: { owner: "CoreTransactionIdGenerator", phase: "entropy", length } })),
    Result.map(copyBytes),
  );
}

export interface CoreTransactionIdGenerator {
  readonly nextInternalId: () => Uint8Array;
}

class TransactionIdGenerator implements CoreTransactionIdGenerator {
  readonly #seed: Uint8Array;
  readonly #dayHigh: number;
  readonly #dayLow: number;
  readonly #buffer = new Uint8Array(256);
  #counter = 0n;
  #offset = 256;

  constructor(seed: Uint8Array, day: number) {
    this.#seed = seed;
    this.#dayHigh = day >>> 8;
    this.#dayLow = day & 255;
  }

  readonly nextInternalId = (): Uint8Array => {
    if (this.#offset === this.#buffer.length) {
      for (let block = 0; block < 4; block++) {
        this.#buffer.set(chacha12Block(this.#seed, this.#counter), block * 64);
        this.#counter = BigInt.asUintN(64, this.#counter + 1n);
      }
      this.#offset = 0;
    }
    // rand_core::BlockRng<u32>::fill_bytes(14) consumes four words and discards
    // the last two bytes. Using contiguous 14-byte slices would change ID two.
    const id = this.#buffer.slice(this.#offset, this.#offset + 16);
    this.#offset += 16;
    id[14] = this.#dayHigh;
    id[15] = this.#dayLow;
    return id;
  };
}

/** One owned seed/day per transaction; retries construct another generator. */
export function createTransactionIdGenerator(seed: Uint8Array, rawNow: CoreTimestamp): Result.Result<
  CoreTransactionIdGenerator, CoreTransactionError
> {
  return Result.gen(function* () {
    const captured = yield* captureCoreEntropy(seed, 32);
    const timestamp = yield* rawTime(rawNow).pipe(Result.mapError(() => new CoreTransactionError({
      reason: "invalidValue", cause: { owner: "CoreTransactionIdGenerator", phase: "time" },
    })));
    return Object.freeze(new TransactionIdGenerator(captured, Number(timestamp / nanosecondsPerDay)));
  });
}
