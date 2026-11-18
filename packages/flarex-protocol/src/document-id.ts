/**
 * Translation of Convex crates/value/src/{id_v6,base32}.rs at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.
 * Rust source: FSL-1.1-Apache-2.0, enclosing convex-backend/LICENSE.md.
 * The base32 alphabet/bit layout follows that file's MIT-licensed base32 fork;
 * this implementation uses a direct bit accumulator rather than its SIMD code.
 */
import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { sha256 } from "@noble/hashes/sha2.js";
import { Brand, Data, Encoding, Option, Result, Schema } from "effect";

import { decodeCanonicalDocumentIdParts, encodeCanonicalDocumentId, INTERNAL_DOCUMENT_ID_BYTES } from "./document-id-core";
export const DocumentTableNumberSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 0xffff_ffff }),
);
export const InternalDocumentIdSchema = Schema.Uint8Array.check(
  Schema.isLengthBetween(INTERNAL_DOCUMENT_ID_BYTES, INTERNAL_DOCUMENT_ID_BYTES),
);
const decodeTableNumber = Schema.decodeUnknownResult(DocumentTableNumberSchema);
// The fixed-width writer needs intrinsic byte slots. The public schema also
// supplies the Uint8Array codec metadata used by its consumers.
const decodeInternalId = Schema.decodeUnknownResult(Schema.declare((value): value is Uint8Array =>
  isUint8ArrayWithByteLength(value, INTERNAL_DOCUMENT_ID_BYTES),
));
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
  Schema.makeFilter(value => decodeCanonicalDocumentIdParts(value) !== undefined
    ? undefined : "Expected a canonical Convex v6 document ID"),
).pipe(Schema.brand("FlarexDB/DeveloperDocumentId"));
export type DeveloperDocumentId = typeof DeveloperDocumentIdSchema.Type;

// Issue only after canonical decoding or encoding with validated parts.
const brandCanonicalId = Brand.nominal<DeveloperDocumentId>();

/** Owns its result bytes; this proves encoding, never scope or table authority. */
export function decodeDocumentId(value: unknown): Result.Result<
  DocumentIdParts & { readonly id: DeveloperDocumentId }, DocumentIdError
> {
  return Result.gen(function* () {
    const text = yield* decodeEncodedId(value).pipe(
      Result.mapError(() => new DocumentIdError({ reason: "invalidId" })),
    );
    const parts = yield* decodeCanonicalParts(text);
    return Object.freeze({ ...parts, id: brandCanonicalId(text) });
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
    return encodeValidatedParts(table, id);
  });
}

/**
 * db914cf06 isolate/udf/syscall.rs::syscall_normalize_id and
 * value/document_id.rs::InternalId::from_developer_str. Old developer IDs are
 * accepted only here; ordinary document decoding remains canonical v6.
 */
export function normalizeDocumentId(
  tableNumber: number,
  value: unknown,
): Result.Result<Option.Option<DeveloperDocumentId>, DocumentIdError> {
  return Result.gen(function* () {
    const table = yield* decodeTableNumber(tableNumber).pipe(
      Result.mapError(() => new DocumentIdError({ reason: "invalidTableNumber" })),
    );
    if (typeof value !== "string") return Option.none();
    return Result.match(decodeDocumentId(value), {
      onSuccess: decoded => decoded.tableNumber === table ? Option.some(decoded.id) : normalizeOldId(table, value),
      onFailure: () => normalizeOldId(table, value),
    });
  });
}

function normalizeOldId(tableNumber: number, value: string): Option.Option<DeveloperDocumentId> {
  const internal = value.length > 22 ? decodeOldBase62Id(value) : decodeOldBase64Id(value);
  return Option.map(internal, id => encodeValidatedParts(tableNumber, id));
}

function decodeOldBase64Id(value: string): Option.Option<Uint8Array> {
  // URL_SAFE_NO_PAD decodes exactly sixteen bytes with canonical trailing bits.
  return Encoding.decodeBase64Url(value).pipe(Result.match({
    onFailure: () => Option.none(),
    onSuccess: bytes => bytes.length === INTERNAL_DOCUMENT_ID_BYTES && Encoding.encodeBase64Url(bytes) === value
      ? Option.some(bytes) : Option.none(),
  }));
}

/** kryptco/base62.rs 6f91a3da4b83f20379469835f64195bd52d7b9dd,
 * Copyright 2019 KryptCo, Inc., MIT. Its string digits are least-significant
 * first, and decode removes the first big-endian byte without checking it. */
function decodeOldBase62Id(value: string): Option.Option<Uint8Array> {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let last = value.length - 1;
  // Zero digits at the high end do not change the source integer. Bounding the
  // significant digits by the required eighteen-byte result avoids huge BigInts
  // without rejecting source-accepted zero padding.
  while (last >= 0 && value[last] === "0") last -= 1;
  if (last < 0 || last >= 25) return Option.none();
  let number = 0n;
  for (let index = last; index >= 0; index -= 1) {
    const digit = alphabet.indexOf(value[index] ?? "");
    if (digit < 0) return Option.none();
    number = number * 62n + BigInt(digit);
  }
  const encoded: number[] = [];
  while (number > 0n) { encoded.push(Number(number & 255n)); number >>= 8n; }
  if (encoded.length !== 18) return Option.none();
  const bytes = Uint8Array.from(encoded.toReversed().slice(1));
  const internal = new Uint8Array(INTERNAL_DOCUMENT_ID_BYTES);
  internal.set(sha256(bytes.subarray(0, 15)).subarray(0, 14));
  internal.set(bytes.subarray(15, 17), 14);
  return Option.some(internal);
}

function encodeValidatedParts(tableNumber: number, internalId: Uint8Array): DeveloperDocumentId {
  return brandCanonicalId(encodeCanonicalDocumentId(tableNumber, internalId));
}
function decodeCanonicalParts(text: string): Result.Result<DocumentIdParts, DocumentIdError> {
  const parts = decodeCanonicalDocumentIdParts(text);
  return parts === undefined ? invalidId() : Result.succeed(parts);
}

function invalidId(): Result.Result<never, DocumentIdError> {
  return Result.fail(new DocumentIdError({ reason: "invalidId" }));
}
