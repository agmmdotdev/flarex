/**
 * Translation of Convex crates/value/src/{id_v6,base32}.rs at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.
 * Rust source: FSL-1.1-Apache-2.0, enclosing convex-backend/LICENSE.md.
 * The base32 alphabet/bit layout follows that file's MIT-licensed base32 fork;
 * this implementation uses a direct bit accumulator rather than its SIMD code.
 */
import { Data, Result, Schema } from "effect";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const TableNumberSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0xffff_ffff }),
);
export const InternalDocumentIdSchema = Schema.Uint8Array.check(Schema.isLengthBetween(16, 16));
const decodeTableNumber = Schema.decodeUnknownResult(TableNumberSchema);
const decodeInternalId = Schema.decodeUnknownResult(InternalDocumentIdSchema);
const EncodedIdSchema = Schema.String.check(Schema.isLengthBetween(31, 37));
const decodeEncodedId = Schema.decodeUnknownResult(EncodedIdSchema);

export class DocumentIdError extends Data.TaggedError("DocumentIdError")<{
  readonly reason: "invalidId" | "invalidTableNumber" | "invalidInternalId";
}> {}

interface DocumentIdParts {
  readonly tableNumber: number;
  readonly internalId: Uint8Array;
}

export const DeveloperDocumentIdSchema = Schema.String.check(
  Schema.makeFilter(value => Result.isSuccess(decodeCanonicalParts(value))
    ? undefined : "Expected a canonical Convex v6 document ID"),
).pipe(Schema.brand("FlarexDB/DeveloperDocumentId"));
export type DeveloperDocumentId = typeof DeveloperDocumentIdSchema.Type;

/** Owns its result bytes; this proves encoding, never scope or table authority. */
export function decodeDocumentId(value: unknown): Result.Result<
  DocumentIdParts & { readonly id: DeveloperDocumentId }, DocumentIdError
> {
  return Result.gen(function* () {
    const text = yield* decodeEncodedId(value).pipe(
      Result.mapError(() => new DocumentIdError({ reason: "invalidId" })),
    );
    const parts = yield* decodeCanonicalParts(text);
    return Object.freeze({ ...parts, id: DeveloperDocumentIdSchema.make(text) });
  });
}

export function encodeDocumentId(
  tableNumber: number,
  internalId: Uint8Array,
): Result.Result<DeveloperDocumentId, DocumentIdError> {
  return Result.gen(function* () {
    const table = yield* decodeTableNumber(tableNumber).pipe(
      Result.mapError(() => new DocumentIdError({ reason: "invalidTableNumber" })),
    );
    const id = yield* decodeInternalId(internalId).pipe(
      Result.mapError(() => new DocumentIdError({ reason: "invalidInternalId" })),
    );
    return DeveloperDocumentIdSchema.make(encodeParts(table, id));
  });
}

function encodeParts(tableNumber: number, internalId: Uint8Array): string {
  const bytes: number[] = [];
  let remaining = tableNumber;
  while (remaining >= 128) {
    bytes.push((remaining % 128) | 128);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining, ...internalId);
  const checksum = fletcher16(bytes);
  bytes.push(checksum & 255, checksum >>> 8);
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET.charAt((accumulator >>> bits) & 31);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += ALPHABET.charAt((accumulator << (5 - bits)) & 31);
  return output;
}

function decodeCanonicalParts(text: string): Result.Result<DocumentIdParts, DocumentIdError> {
  if (text.length < 31 || text.length > 37) return invalidId();
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of text) {
    const value = ALPHABET.indexOf(character);
    if (value < 0) return invalidId();
    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
      accumulator &= (1 << bits) - 1;
    }
  }
  let tableNumber = 0;
  let position = 0;
  for (; position < 5; position += 1) {
    const byte = bytes[position];
    if (byte === undefined) return invalidId();
    tableNumber += (byte & 127) * 2 ** (position * 7);
    if (byte < 128) { position += 1; break; }
  }
  if (tableNumber < 1 || tableNumber > 0xffff_ffff || bytes.length !== position + 18) return invalidId();
  const checksum = fletcher16(bytes.slice(0, position + 16));
  if (bytes[position + 16] !== (checksum & 255) || bytes[position + 17] !== (checksum >>> 8)) return invalidId();
  const internalId = Uint8Array.from(bytes.slice(position, position + 16));
  if (encodeParts(tableNumber, internalId) !== text) return invalidId();
  return Result.succeed(Object.freeze({ tableNumber, internalId }));
}

function fletcher16(bytes: readonly number[]): number {
  let low = 0;
  let high = 0;
  for (const byte of bytes) {
    low = (low + byte) & 255;
    high = (high + low) & 255;
  }
  return (high << 8) | low;
}

function invalidId(): Result.Result<never, DocumentIdError> {
  return Result.fail(new DocumentIdError({ reason: "invalidId" }));
}
