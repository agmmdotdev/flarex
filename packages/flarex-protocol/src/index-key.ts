/**
 * Translation of Convex crates/value/src/sorting.rs and common/src/index.rs at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.
 * Rust source license: FSL-1.1-Apache-2.0, enclosing convex-backend/LICENSE.md.
 */
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { sha256 } from "@noble/hashes/sha2.js";
import { Data, Result } from "effect";
import { decodeDocumentId } from "./document-id";
import { captureDocumentValue, isDocumentArray, type DocumentValue, type DocumentValueError } from "./document-value";

export const MAX_INDEX_KEY_PREFIX_BYTES = 2500;
const utf8 = new TextEncoder();

export class IndexKeyError extends Data.TaggedError("IndexKeyError")<{
  readonly reason: "invalidValue" | "invalidDocumentId";
  readonly cause?: DocumentValueError;
}> {}

/** Encodes a field/bound; undefined is missing, distinct from null. */
export function encodeIndexValue(value: DocumentValue | undefined): Result.Result<Uint8Array, IndexKeyError> {
  if (value === undefined) return Result.succeed(Uint8Array.of(1));
  return captureDocumentValue(value).pipe(
    Result.mapError(cause => new IndexKeyError({ reason: "invalidValue", cause })),
    Result.map(encodeCapturedIndexValue),
  );
}

/** Internal established-value path: capture remains with the caller's boundary. */
export function encodeCapturedIndexValue(value: DocumentValue | undefined): Uint8Array {
  if (value === undefined) return Uint8Array.of(1);
  const bytes: number[] = [];
  writeValue(value, bytes);
  return Uint8Array.from(bytes);
}

/** Full ordinary key: indexed field values followed by the developer-ID string. */
export function encodeIndexKey(
  indexedValues: readonly (DocumentValue | undefined)[],
  developerId: string,
): Result.Result<Uint8Array, IndexKeyError> {
  return Result.gen(function* () {
    const id = yield* decodeDocumentId(developerId).pipe(Result.mapError(() => new IndexKeyError({ reason: "invalidDocumentId" })));
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (const value of [...indexedValues, id.id]) {
      const chunk = yield* encodeIndexValue(value);
      chunks.push(chunk);
      length += chunk.byteLength;
    }
    const key = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { key.set(chunk, offset); offset += chunk.byteLength; }
    return key;
  });
}

/** Owned physical split; the digest covers the complete key, including its ID. */
export function splitIndexKey(fullKey: Uint8Array) {
  return Object.freeze({
    keyPrefix: fullKey.slice(0, MAX_INDEX_KEY_PREFIX_BYTES),
    keySuffix: fullKey.byteLength > MAX_INDEX_KEY_PREFIX_BYTES ? fullKey.slice(MAX_INDEX_KEY_PREFIX_BYTES) : null,
    keySha256: sha256(fullKey),
  });
}

export const compareIndexKeys = compareBytesLexicographically;

function writeValue(value: DocumentValue, out: number[]): void {
  if (value === null) { out.push(3); return; }
  if (typeof value === "bigint") { writeInt64(value, out); return; }
  if (typeof value === "number") {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    if (((bytes[0] ?? 0) & 128) !== 0) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (bytes[i] ?? 0) ^ 255;
    } else bytes[0] = (bytes[0] ?? 0) | 128;
    out.push(13, ...bytes);
    return;
  }
  if (typeof value === "boolean") { out.push(value ? 15 : 14); return; }
  if (typeof value === "string") { out.push(16); writeEscaped(utf8.encode(value), out); return; }
  if (value instanceof ArrayBuffer) { out.push(17); writeEscaped(new Uint8Array(value), out); return; }
  if (isDocumentArray(value)) {
    out.push(18);
    for (const child of value) writeValue(child, out);
    out.push(0);
    return;
  }
  out.push(21);
  for (const field of Object.keys(value).toSorted()) {
    const child = value[field];
    if (child === undefined) continue;
    writeEscaped(utf8.encode(field), out);
    if (field === "") out.push(255);
    writeValue(child, out);
  }
  out.push(0);
}

function writeEscaped(bytes: Uint8Array, out: number[]): void {
  for (const byte of bytes) { out.push(byte); if (byte === 0) out.push(255); }
  out.push(0);
}

function writeInt64(value: bigint, out: number[]): void {
  if (value === 0n) { out.push(8); return; }
  const width = value >= -128n && value <= 127n ? 1
    : value >= -32768n && value <= 32767n ? 2
      : value >= -2147483648n && value <= 2147483647n ? 4 : 8;
  const distance = width === 1 ? 1 : width === 2 ? 2 : width === 4 ? 3 : 4;
  out.push(8 + (value < 0n ? -distance : distance));
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, false);
  for (const byte of bytes.subarray(8 - width)) out.push(byte);
}
