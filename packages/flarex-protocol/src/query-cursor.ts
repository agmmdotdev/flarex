/**
 * Convex keybroker/{broker,encryptor,secret}.rs and pb/protos/convex_cursor.proto
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.
 * Rust source license: FSL-1.1-Apache-2.0, enclosing convex-backend/LICENSE.md.
 */
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { gcmsiv } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Data, Encoding, Result, Schema } from "effect";

export type QueryCursorPosition = { readonly kind: "after"; readonly key: Uint8Array } | { readonly kind: "end" };
export interface QueryCursor {
  readonly position: QueryCursorPosition;
  readonly queryFingerprint: Uint8Array;
}
export class QueryCursorError extends Data.TaggedError("QueryCursorError")<{
  readonly reason: "invalidConfiguration" | "invalidEncoding" | "invalidVersion" | "authenticationFailed" | "invalidPayload" | "instanceMismatch";
}> {}
export interface QueryCursorBroker {
  readonly encode: (cursor: QueryCursor) => string;
  readonly decode: (cursor: string) => Result.Result<QueryCursor, QueryCursorError>;
  /** Exact public string length, without encryption or access to query/database state. */
  readonly encodedLength: (position: QueryCursorPosition, fingerprintByteLength?: number) => number;
}

const VERSION = 7;
const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const decodeConfiguration = Schema.decodeUnknownResult(Schema.Struct({
  instanceName: Schema.String,
  deploymentSecret: Schema.Uint8Array.check(Schema.makeFilter(bytes => bytes.byteLength === 32 ? undefined : "Expected exact 32-byte deployment secret")),
}));

/** Trusted, instance-bound composition. Secret and derived key never leave the closure. */
export function createQueryCursorBroker(configuration: {
  readonly instanceName: string; readonly deploymentSecret: Uint8Array;
}): Result.Result<QueryCursorBroker, QueryCursorError> {
  return decodeConfiguration(configuration).pipe(
    Result.mapError(() => new QueryCursorError({ reason: "invalidConfiguration" })),
    Result.map(({ instanceName, deploymentSecret }) => {
      const secret = deploymentSecret.slice();
      // aws-lc kbkdf_ctr_hmac's counter mode: counter (big endian 1) || purpose.
      const key = hmac(sha256, secret, Uint8Array.of(0, 0, 0, 1, ...utf8.encode("cursor"))).slice(0, 16);
      secret.fill(0);
      const instanceBytes = utf8.encode(instanceName);
      const broker: QueryCursorBroker = {
        encode: cursor => {
          const plaintext = encodeInstanceCursor(instanceBytes, cursor);
          const encrypted = gcmsiv(key, new Uint8Array(12), Uint8Array.of(VERSION)).encrypt(plaintext);
          return encodeBytesToLowercaseHex(concatenate([Uint8Array.of(VERSION), encrypted]));
        },
        decode: cursor => Result.gen(function* () {
          // Pinned const-hex 1.19.1 accepts mixed case and either optional 0x prefix.
          const hex = cursor.startsWith("0x") || cursor.startsWith("0X") ? cursor.slice(2) : cursor;
          const bytes = yield* Encoding.decodeHex(hex).pipe(Result.mapError(() => new QueryCursorError({ reason: "invalidEncoding" })));
          if (bytes[0] !== VERSION) return yield* Result.fail(new QueryCursorError({ reason: "invalidVersion" }));
          if (bytes.byteLength < 17) return yield* Result.fail(new QueryCursorError({ reason: "authenticationFailed" }));
          const plaintext = yield* Result.try({
            try: () => gcmsiv(key, new Uint8Array(12), Uint8Array.of(VERSION)).decrypt(bytes.subarray(1)),
            catch: (cause: unknown) => {
              // This exact installed-library exception is the foreign authentication verdict.
              // Key/nonce programming failures and unrelated defects propagate unchanged.
              if (cause instanceof Error && cause.message === "invalid polyval tag") return new QueryCursorError({ reason: "authenticationFailed" });
              throw cause;
            },
          });
          const decoded = yield* decodeInstanceCursor(plaintext);
          if (decoded.instanceName !== instanceName) return yield* Result.fail(new QueryCursorError({ reason: "instanceMismatch" }));
          return Object.freeze({ position: decoded.position, queryFingerprint: decoded.queryFingerprint });
        }),
        encodedLength: (position, fingerprintByteLength = 32) => {
          const instanceLength = instanceBytes.byteLength === 0 ? 0 : fieldLength(instanceBytes.byteLength);
          const fingerprintLength = fingerprintByteLength === 0 ? 0 : fieldLength(fingerprintByteLength);
          const positionLength = position.kind === "end" ? 2 : fieldLength(position.key.byteLength === 0 ? 0 : fieldLength(position.key.byteLength));
          return 2 * (1 + instanceLength + fingerprintLength + positionLength + 16);
        },
      };
      return Object.freeze(broker);
    }),
  );
}

function encodeInstanceCursor(instance: Uint8Array, cursor: QueryCursor): Uint8Array {
  // prost derives encode fields in tag order, including the oneof's minimum tag.
  const chunks: Uint8Array[] = [];
  if (instance.byteLength > 0) chunks.push(field(1, instance));
  if (cursor.position.kind === "end") chunks.push(field(3, new Uint8Array()));
  else chunks.push(field(2, cursor.position.key.byteLength === 0 ? new Uint8Array() : field(4, cursor.position.key)));
  if (cursor.queryFingerprint.byteLength > 0) chunks.push(field(4, cursor.queryFingerprint));
  return concatenate(chunks);
}

interface DecodedInstanceCursor extends QueryCursor { readonly instanceName: string }
function decodeInstanceCursor(bytes: Uint8Array): Result.Result<DecodedInstanceCursor, QueryCursorError> {
  return Result.gen(function* () {
    const reader = new ProtoReader(bytes);
    let instanceName = "";
    let position: QueryCursorPosition | undefined;
    let queryFingerprint = new Uint8Array();
    while (!reader.done) {
      const tag = yield* reader.tag();
      if (tag.field === 1) {
        const text = yield* reader.lengthDelimited(tag.wire);
        instanceName = yield* Result.try({
          try: () => utf8Decoder.decode(text),
          catch: (cause: unknown) => { if (cause instanceof TypeError) return invalidPayload(); throw cause; },
        });
      } else if (tag.field === 2) {
        const keyBytes = yield* reader.lengthDelimited(tag.wire);
        const keyReader = new ProtoReader(keyBytes, 1);
        // prost merges repeated message-valued oneof members of the same variant.
        let key = position?.kind === "after" ? position.key : new Uint8Array();
        while (!keyReader.done) {
          const keyTag = yield* keyReader.tag();
          if (keyTag.field === 4) key = (yield* keyReader.lengthDelimited(keyTag.wire)).slice();
          else yield* keyReader.skip(keyTag);
        }
        position = Object.freeze({ kind: "after", key });
      } else if (tag.field === 3) {
        const emptyBytes = yield* reader.lengthDelimited(tag.wire);
        const emptyReader = new ProtoReader(emptyBytes, 1);
        while (!emptyReader.done) yield* emptyReader.skip(yield* emptyReader.tag());
        position = Object.freeze({ kind: "end" });
      } else if (tag.field === 4) queryFingerprint = (yield* reader.lengthDelimited(tag.wire)).slice();
      else yield* reader.skip(tag);
    }
    if (position === undefined) return yield* Result.fail(invalidPayload());
    return { instanceName, position, queryFingerprint };
  });
}

interface ProtoTag { readonly field: number; readonly wire: number }
/** Narrow protobuf wire decoder; accepts and skips source-compatible unknown fields. */
class ProtoReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array, private readonly depth = 0) {}
  get done(): boolean { return this.offset === this.bytes.byteLength; }
  varint(): Result.Result<bigint, QueryCursorError> {
    let value = 0n;
    for (let i = 0; i < 10; i += 1) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined || (i === 9 && byte > 1)) return Result.fail(invalidPayload());
      value |= BigInt(byte & 127) << BigInt(i * 7);
      if (byte < 128) return Result.succeed(value);
    }
    return Result.fail(invalidPayload());
  }
  tag(): Result.Result<ProtoTag, QueryCursorError> {
    return this.varint().pipe(Result.flatMap(value => value > 0xffffffffn || value < 8n
      ? Result.fail(invalidPayload()) : Result.succeed({ field: Number(value >> 3n), wire: Number(value & 7n) })));
  }
  lengthDelimited(wire: number): Result.Result<Uint8Array, QueryCursorError> {
    if (wire !== 2) return Result.fail(invalidPayload());
    return this.varint().pipe(Result.flatMap(length => {
      if (length > BigInt(this.bytes.byteLength - this.offset)) return Result.fail(invalidPayload());
      const start = this.offset; this.offset += Number(length);
      return Result.succeed(this.bytes.subarray(start, this.offset));
    }));
  }
  skip(tag: ProtoTag, depth = this.depth): Result.Result<void, QueryCursorError> {
    switch (tag.wire) {
      case 0: return this.varint().pipe(Result.map(() => undefined));
      case 1: return this.skipFixed(8);
      case 2: return this.lengthDelimited(2).pipe(Result.map(() => undefined));
      case 3: return Result.gen(this, function* () {
        // prost's decoder bounds nested protobuf messages/groups at 100.
        if (depth >= 100) return yield* Result.fail(invalidPayload());
        while (!this.done) {
          const child = yield* this.tag();
          if (child.wire === 4) return child.field === tag.field ? undefined : yield* Result.fail(invalidPayload());
          yield* this.skip(child, depth + 1);
        }
        return yield* Result.fail(invalidPayload());
      });
      case 5: return this.skipFixed(4);
      default: return Result.fail(invalidPayload());
    }
  }
  private skipFixed(length: number): Result.Result<void, QueryCursorError> {
    if (length > this.bytes.byteLength - this.offset) return Result.fail(invalidPayload());
    this.offset += length; return Result.void;
  }
}

function invalidPayload(): QueryCursorError { return new QueryCursorError({ reason: "invalidPayload" }); }
function field(tag: number, bytes: Uint8Array): Uint8Array { return concatenate([Uint8Array.of(tag * 8 + 2), varint(bytes.byteLength), bytes]); }
function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte | (value > 0 ? 128 : 0)); } while (value > 0);
  return Uint8Array.from(bytes);
}
function fieldLength(bytes: number): number { return 1 + varint(bytes).byteLength + bytes; }
function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}
