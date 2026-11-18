import { readFileSync } from "node:fs";
import { Encoding, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { chacha12Block } from "../../src/core/chacha12";
import { captureCoreEntropy, createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";

const Oracle = Schema.Struct({ sourcePin: Schema.String,
  dependencies: Schema.Struct({ rand: Schema.String, rand_chacha: Schema.String, rand_core: Schema.String, "ppv-lite86": Schema.String }),
  sequences: Schema.Array(Schema.Struct({ name: Schema.String, seed: Schema.String, day: Schema.Int,
    ids: Schema.Array(Schema.String), tableNumber: Schema.Int, publicIds: Schema.Array(Schema.String) })),
  blocks: Schema.Array(Schema.Struct({ name: Schema.String, seed: Schema.String, counter: Schema.BigIntFromString, bytes: Schema.String })),
  wrappedStreams: Schema.Array(Schema.Struct({ name: Schema.String, seed: Schema.String, counter: Schema.BigIntFromString, bytes: Schema.String })),
});
const oracle = Schema.decodeUnknownSync(Schema.fromJsonString(Oracle))(readFileSync(
  new URL("./fixtures/transactionIdOracle/vectors.json", import.meta.url), "utf8"));
const nanosecondsPerDay = 86_400_000_000_000n;
const unhex = (value: string) => Result.getOrThrow(Encoding.decodeHex(value));
const hex = encodeBytesToLowercaseHex;

describe("pinned Source transaction ID generator", () => {
  it("uses independently generated vectors from the pinned RNG versions", () => {
    expect(oracle.sourcePin).toBe("db914cf06e2b06ee985646611b9e12ed7a770318");
    expect(oracle.dependencies).toEqual({ rand: "0.9.4", rand_chacha: "0.9.0", rand_core: "0.9.1", "ppv-lite86": "0.2.17" });
    expect(oracle.sequences).toHaveLength(4);
    expect(oracle.blocks).toHaveLength(40);
    expect(oracle.wrappedStreams).toHaveLength(4);
  });

  it.each(oracle.sequences)("matches 33 complete IDs and public IDs for $name", sequence => {
    const generator = Result.getOrThrow(createTransactionIdGenerator(unhex(sequence.seed), BigInt(sequence.day) * nanosecondsPerDay));
    expect(sequence.ids).toHaveLength(33);
    expect(sequence.publicIds).toHaveLength(33);
    for (const [index, expected] of sequence.ids.entries()) {
      const id = generator.nextInternalId();
      expect(hex(id)).toBe(expected);
      const publicId = Result.getOrThrow(encodeDocumentId(sequence.tableNumber, id));
      expect(publicId).toBe(sequence.publicIds[index]);
      expect(hex(Result.getOrThrow(decodeDocumentId(publicId)).internalId)).toBe(expected);
    }
  });

  it.each(oracle.blocks)("matches $name block counter $counter without a 32-bit ceiling", vector => {
    expect(hex(chacha12Block(unhex(vector.seed), vector.counter))).toBe(vector.bytes);
  });

  it.each(oracle.wrappedStreams)("matches $name across the 64-bit counter wrap", vector => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 4; index++) bytes.set(chacha12Block(unhex(vector.seed), vector.counter + BigInt(index)), index * 64);
    expect(hex(bytes)).toBe(vector.bytes);
  });

  it.each([
    { now: 0n, day: "0000" },
    { now: nanosecondsPerDay - 1n, day: "0000" },
    { now: nanosecondsPerDay, day: "0001" },
    { now: 256n * nanosecondsPerDay, day: "0100" },
    { now: 65_535n * nanosecondsPerDay, day: "ffff" },
    { now: 65_536n * nanosecondsPerDay - 1n, day: "ffff" },
  ])("pins big-endian day $day at raw time $now", ({ now, day }) => {
    const generator = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), now));
    for (let index = 0; index < 20; index++) expect(hex(generator.nextInternalId()).slice(28)).toBe(day);
  });

  it.each([-1n, -nanosecondsPerDay, 65_536n * nanosecondsPerDay,
    65_536n * nanosecondsPerDay + 1n, 1n << 100n])("refuses unsupported raw time %s without wrapping/clamping", now => {
    expect(createTransactionIdGenerator(new Uint8Array(32), now)).toMatchObject({
      _tag: "Failure", failure: { reason: "invalidValue", cause: { phase: "time" } },
    });
  });

  it("keeps an already constructed transaction's day across midnight", () => {
    const before = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), nanosecondsPerDay - 1n));
    const after = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), nanosecondsPerDay));
    for (let index = 0; index < 33; index++) {
      const oldId = before.nextInternalId(), newId = after.nextInternalId();
      expect(hex(oldId).slice(0, 28)).toBe(hex(newId).slice(0, 28));
      expect(hex(oldId).slice(28)).toBe("0000");
      expect(hex(newId).slice(28)).toBe("0001");
    }
  });

  it.each([undefined, null, "seed", [], {}, new Uint8Array(0), new Uint8Array(16),
    new Uint8Array(31), new Uint8Array(33), new ArrayBuffer(32)])("refuses invalid seed %#", seed => {
    expect(captureCoreEntropy(seed, 32)).toMatchObject({ _tag: "Failure", failure: {
      reason: "invalidValue", cause: { owner: "CoreTransactionIdGenerator", phase: "entropy", length: 32 },
    } });
  });

  it("validates seed before time and never includes entropy in its diagnostic", () => {
    const seed = new Uint8Array(31).fill(0xab);
    const result = createTransactionIdGenerator(seed, -1n);
    expect(result).toMatchObject({ _tag: "Failure", failure: {
      cause: { owner: "CoreTransactionIdGenerator", phase: "entropy", length: 32 },
    } });
    expect(JSON.stringify(result)).not.toContain("171");
  });

  it("captures only visible bytes and owns seed state before the first draw", () => {
    const backing = new Uint8Array(64).fill(0xff);
    const view = backing.subarray(16, 48);
    view.set(Array.from({ length: 32 }, (_, index) => index));
    const captured = Result.getOrThrow(captureCoreEntropy(view, 32));
    backing.fill(0);
    const generator = Result.getOrThrow(createTransactionIdGenerator(captured, 0n));
    captured.fill(0xff);
    expect(hex(generator.nextInternalId())).toBe("f231f9ffd17ac65e4405f325d7e90000");
    expect(captured.buffer).not.toBe(backing.buffer);
    expect(captured.byteLength).toBe(32);
  });

  it("does not invoke a caller's typed-array species constructor while copying entropy", () => {
    const seed = new Uint8Array(32);
    Object.defineProperty(seed, "constructor", { get: () => { throw new Error("Entropy species constructor must not run"); } });
    const generator = Result.getOrThrow(createTransactionIdGenerator(seed, 0n));
    expect(hex(generator.nextInternalId())).toBe("9bf49a6a0755f953811fce125f260000");
  });

  it("uses intrinsic byte length rather than a caller's shadow length", () => {
    const short = new Uint8Array(31);
    Object.defineProperty(short, "length", { value: 32 });
    expect(captureCoreEntropy(short, 32)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidValue" } });
    expect(captureCoreEntropy(Object.create(Uint8Array.prototype), 32)).toMatchObject({ _tag: "Failure" });
  });

  it("captures genuine bytes without consulting shadow properties or iterators", () => {
    const seed = new Uint8Array(32);
    const forbidden = () => { throw new Error("Shadow entropy property must not run"); };
    for (const key of ["length", "byteLength", "buffer", "byteOffset", "constructor", Symbol.iterator]) {
      Object.defineProperty(seed, key, { get: forbidden });
    }
    const generator = Result.getOrThrow(createTransactionIdGenerator(seed, 0n));
    expect(hex(generator.nextInternalId())).toBe("9bf49a6a0755f953811fce125f260000");
  });

  it("returns independent owned IDs that survive later buffer refills", () => {
    const generator = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 0n));
    const first = generator.nextInternalId(), second = generator.nextInternalId();
    const original = hex(first);
    for (let index = 0; index < 33; index++) generator.nextInternalId();
    expect(hex(first)).toBe(original);
    first.fill(0xff);
    expect(hex(second)).toBe("0429c3bb49e074147e0089a52eae0000");
    expect(first.buffer).not.toBe(second.buffer);
  });

  it("keeps independent transaction state and offers no writable clone", () => {
    const left = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 0n));
    const right = Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 0n));
    const first = left.nextInternalId();
    left.nextInternalId();
    expect(hex(right.nextInternalId())).toBe(hex(first));
    expect("clone" in left).toBe(false);
    expect("setPosition" in left).toBe(false);
  });

  it("owns separate 16-byte UUID entropy without adding a day suffix", () => {
    const source = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const captured = Result.getOrThrow(captureCoreEntropy(source, 16));
    source.fill(0);
    expect(hex(captured)).toBe("0102030405060708090a0b0c0d0e0f10");
    expect(captureCoreEntropy(new Uint8Array(32), 16)).toMatchObject({ _tag: "Failure" });
  });
});
