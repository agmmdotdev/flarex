import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Brand, Encoding, Result } from "effect";

import {
  QuerySyncCanonicalValueError,
  QuerySyncInvariantDefect,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import type {
  QuerySyncCanonicalField,
  QuerySyncWorkRevisionOperation,
} from "./Errors.js";

export const MAX_SYNC_ID_UTF8_BYTES = 512;
export const MAX_CANONICAL_QUERY_IDENTITY_BYTES = 131_072;
export const MAX_CANONICAL_DEPENDENCY_KEY_BYTES = 16_384;
export const QUERY_KEY_BYTES = 32;
export const QUERY_RESULT_DIGEST_BYTES = 32;
export const QUERY_AUTHORITY_WITNESS_BYTES = 32;
export const MAX_SYNC_SEQUENCE = 9_223_372_036_854_775_807n;
export const MAX_QUERY_GENERATION = MAX_SYNC_SEQUENCE;
export const MAX_QUERY_SYNC_WORK_REVISION = MAX_SYNC_SEQUENCE;
export const MAX_PUBLICATION_ATTEMPT_ORDINAL = 128;
export const MAX_PUBLICATION_ATTEMPT_INSTANT = Number.MAX_SAFE_INTEGER;

const UNPADDED_BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

export type SyncNamespaceId = Brand.Branded<
  string,
  "FlarexQuerySync/SyncNamespaceId"
>;
export type SyncModelId = Brand.Branded<
  string,
  "FlarexQuerySync/SyncModelId"
>;
export type SyncEpoch = Brand.Branded<string, "FlarexQuerySync/SyncEpoch">;
export type SyncSequence = Brand.Branded<
  bigint,
  "FlarexQuerySync/SyncSequence"
>;
export type QueryGeneration = Brand.Branded<
  bigint,
  "FlarexQuerySync/QueryGeneration"
>;
export type QuerySnapshot = Brand.Branded<
  bigint,
  "FlarexQuerySync/QuerySnapshot"
>;
export type QuerySyncWorkRevision = Brand.Branded<
  bigint,
  "FlarexQuerySync/QuerySyncWorkRevision"
>;
export type PublicationAttemptOrdinal = Brand.Branded<
  number,
  "FlarexQuerySync/PublicationAttemptOrdinal"
>;
export type PublicationAttemptInstant = Brand.Branded<
  number,
  "FlarexQuerySync/PublicationAttemptInstant"
>;
export type CanonicalQueryKey = Brand.Branded<
  string,
  "FlarexQuerySync/CanonicalQueryKey"
>;
export type CanonicalQueryIdentity = Brand.Branded<
  string,
  "FlarexQuerySync/CanonicalQueryIdentity"
>;
export type CanonicalDependencyKey = Brand.Branded<
  string,
  "FlarexQuerySync/CanonicalDependencyKey"
>;
export type QueryResultDigest = Brand.Branded<
  string,
  "FlarexQuerySync/QueryResultDigest"
>;
export type QueryAuthorityWitness = Brand.Branded<
  string,
  "FlarexQuerySync/QueryAuthorityWitness"
>;

const brandSyncNamespaceId = Brand.nominal<SyncNamespaceId>();
const brandSyncModelId = Brand.nominal<SyncModelId>();
const brandSyncEpoch = Brand.nominal<SyncEpoch>();
const brandSyncSequence = Brand.nominal<SyncSequence>();
const brandQueryGeneration = Brand.nominal<QueryGeneration>();
const brandQuerySnapshot = Brand.nominal<QuerySnapshot>();
const brandQuerySyncWorkRevision = Brand.nominal<QuerySyncWorkRevision>();
const brandPublicationAttemptOrdinal = Brand.nominal<
  PublicationAttemptOrdinal
>();
const brandPublicationAttemptInstant = Brand.nominal<
  PublicationAttemptInstant
>();
const brandCanonicalQueryKey = Brand.nominal<CanonicalQueryKey>();
const brandCanonicalQueryIdentity = Brand.nominal<CanonicalQueryIdentity>();
const brandCanonicalDependencyKey = Brand.nominal<CanonicalDependencyKey>();
const brandQueryResultDigest = Brand.nominal<QueryResultDigest>();
const brandQueryAuthorityWitness = Brand.nominal<QueryAuthorityWitness>();

type BoundedTextBrand<A extends string> = (value: string) => A;
type CanonicalBase64UrlBrand<A extends string> = (value: string) => A;

function canonicalValueError(
  field: QuerySyncCanonicalField,
  reason: QuerySyncCanonicalValueError["reason"],
  maximum: number | bigint | null = null,
  observed: number | bigint | null = null,
): QuerySyncCanonicalValueError {
  return new QuerySyncCanonicalValueError({
    field,
    reason,
    maximum,
    observed,
  });
}

function inspectWellFormedUtf8Length(value: string): number | null {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
      continue;
    }
    if (codeUnit <= 0x7ff) {
      byteLength += 2;
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return null;
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return null;
      byteLength += 4;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return null;
    byteLength += 3;
  }
  return byteLength;
}

function captureBoundedText<A extends string>(
  input: unknown,
  field: "namespaceId" | "syncModelId" | "sourceEpoch",
  brand: BoundedTextBrand<A>,
): Result.Result<A, QuerySyncCanonicalValueError> {
  if (typeof input !== "string") {
    return Result.fail(canonicalValueError(field, "invalidType"));
  }
  if (input.length === 0) {
    return Result.fail(canonicalValueError(field, "empty"));
  }
  if (input.includes("\0")) {
    return Result.fail(canonicalValueError(field, "containsNul"));
  }
  const byteLength = inspectWellFormedUtf8Length(input);
  if (byteLength === null) {
    return Result.fail(canonicalValueError(field, "illFormedUnicode"));
  }
  if (byteLength > MAX_SYNC_ID_UTF8_BYTES) {
    return Result.fail(canonicalValueError(
      field,
      "tooLarge",
      MAX_SYNC_ID_UTF8_BYTES,
      byteLength,
    ));
  }
  return Result.succeed(brand(input));
}

export function captureCanonicalBase64UrlValue<A extends string>(
  input: unknown,
  field:
    | "queryKey"
    | "queryIdentity"
    | "dependencyKey"
    | "publicationContent"
    | "resultDigest"
    | "authorityWitness",
  maximumBytes: number,
  exactBytes: number | null,
  brand: CanonicalBase64UrlBrand<A>,
): Result.Result<A, QuerySyncCanonicalValueError> {
  if (typeof input !== "string") {
    return Result.fail(canonicalValueError(field, "invalidType"));
  }

  const maximumEncodedLength = canonicalBase64UrlEncodedLength(maximumBytes);
  if (input.length > maximumEncodedLength) {
    return Result.fail(canonicalValueError(
      field,
      "tooLarge",
      maximumBytes,
      Math.floor((input.length * 3) / 4),
    ));
  }
  if (
    !UNPADDED_BASE64URL_PATTERN.test(input)
    || input.length % 4 === 1
  ) {
    return Result.fail(canonicalValueError(field, "invalidSyntax"));
  }

  return Encoding.decodeBase64Url(input).pipe(
    Result.mapError(() => canonicalValueError(field, "decodingFailed")),
    Result.flatMap((bytes): Result.Result<A, QuerySyncCanonicalValueError> => {
      if (bytes.byteLength > maximumBytes) {
        return Result.fail(canonicalValueError(
          field,
          "tooLarge",
          maximumBytes,
          bytes.byteLength,
        ));
      }
      if (exactBytes !== null && bytes.byteLength !== exactBytes) {
        return Result.fail(canonicalValueError(
          field,
          "wrongByteLength",
          exactBytes,
          bytes.byteLength,
        ));
      }
      if (Encoding.encodeBase64Url(bytes) !== input) {
        return Result.fail(canonicalValueError(field, "nonCanonical"));
      }
      return Result.succeed(brand(input));
    }),
  );
}

function captureBoundedBigInt<A extends bigint>(
  input: unknown,
  field: "sourceSequence" | "queryGeneration" | "workRevision",
  minimum: bigint,
  maximum: bigint,
  brand: (value: bigint) => A,
): Result.Result<A, QuerySyncCanonicalValueError> {
  if (typeof input !== "bigint") {
    return Result.fail(canonicalValueError(field, "invalidType"));
  }
  if (input < minimum || input > maximum) {
    return Result.fail(canonicalValueError(
      field,
      "outOfRange",
      maximum,
      input,
    ));
  }
  return Result.succeed(brand(input));
}

function captureBoundedSafeInteger<A extends number>(
  input: unknown,
  field: "publicationAttemptOrdinal" | "publicationAttemptInstant",
  minimum: number,
  maximum: number,
  brand: (value: number) => A,
): Result.Result<A, QuerySyncCanonicalValueError> {
  if (typeof input !== "number") {
    return Result.fail(canonicalValueError(field, "invalidType"));
  }
  if (
    !isNonNegativeSafeInteger(input)
    || input < minimum
    || input > maximum
  ) {
    return Result.fail(canonicalValueError(
      field,
      "outOfRange",
      maximum,
      input,
    ));
  }
  return Result.succeed(brand(input));
}

export function captureSyncNamespaceId(
  input: unknown,
): Result.Result<SyncNamespaceId, QuerySyncCanonicalValueError> {
  return captureBoundedText(input, "namespaceId", brandSyncNamespaceId);
}

export function captureSyncModelId(
  input: unknown,
): Result.Result<SyncModelId, QuerySyncCanonicalValueError> {
  return captureBoundedText(input, "syncModelId", brandSyncModelId);
}

export function captureSyncEpoch(
  input: unknown,
): Result.Result<SyncEpoch, QuerySyncCanonicalValueError> {
  return captureBoundedText(input, "sourceEpoch", brandSyncEpoch);
}

export function captureSyncSequence(
  input: unknown,
): Result.Result<SyncSequence, QuerySyncCanonicalValueError> {
  return captureBoundedBigInt(
    input,
    "sourceSequence",
    0n,
    MAX_SYNC_SEQUENCE,
    brandSyncSequence,
  );
}

export function captureQueryGeneration(
  input: unknown,
): Result.Result<QueryGeneration, QuerySyncCanonicalValueError> {
  return captureBoundedBigInt(
    input,
    "queryGeneration",
    1n,
    MAX_QUERY_GENERATION,
    brandQueryGeneration,
  );
}

export function captureQuerySnapshot(
  input: unknown,
): Result.Result<QuerySnapshot, QuerySyncCanonicalValueError> {
  return captureBoundedBigInt(
    input,
    "sourceSequence",
    0n,
    MAX_SYNC_SEQUENCE,
    brandQuerySnapshot,
  );
}

export function captureQuerySyncWorkRevision(
  input: unknown,
): Result.Result<QuerySyncWorkRevision, QuerySyncCanonicalValueError> {
  return captureBoundedBigInt(
    input,
    "workRevision",
    0n,
    MAX_QUERY_SYNC_WORK_REVISION,
    brandQuerySyncWorkRevision,
  );
}

export function capturePublicationAttemptOrdinal(
  input: unknown,
): Result.Result<PublicationAttemptOrdinal, QuerySyncCanonicalValueError> {
  return captureBoundedSafeInteger(
    input,
    "publicationAttemptOrdinal",
    1,
    MAX_PUBLICATION_ATTEMPT_ORDINAL,
    brandPublicationAttemptOrdinal,
  );
}

export function capturePublicationAttemptInstant(
  input: unknown,
): Result.Result<PublicationAttemptInstant, QuerySyncCanonicalValueError> {
  return captureBoundedSafeInteger(
    input,
    "publicationAttemptInstant",
    0,
    MAX_PUBLICATION_ATTEMPT_INSTANT,
    brandPublicationAttemptInstant,
  );
}

export function captureCanonicalQueryKey(
  input: unknown,
): Result.Result<CanonicalQueryKey, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input,
    "queryKey",
    QUERY_KEY_BYTES,
    QUERY_KEY_BYTES,
    brandCanonicalQueryKey,
  );
}

export function captureCanonicalQueryIdentity(
  input: unknown,
): Result.Result<CanonicalQueryIdentity, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input,
    "queryIdentity",
    MAX_CANONICAL_QUERY_IDENTITY_BYTES,
    null,
    brandCanonicalQueryIdentity,
  );
}

export function captureCanonicalDependencyKey(
  input: unknown,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input,
    "dependencyKey",
    MAX_CANONICAL_DEPENDENCY_KEY_BYTES,
    null,
    brandCanonicalDependencyKey,
  );
}

export function captureQueryResultDigest(
  input: unknown,
): Result.Result<QueryResultDigest, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input,
    "resultDigest",
    QUERY_RESULT_DIGEST_BYTES,
    QUERY_RESULT_DIGEST_BYTES,
    brandQueryResultDigest,
  );
}

export function captureQueryAuthorityWitness(
  input: unknown,
): Result.Result<QueryAuthorityWitness, QuerySyncCanonicalValueError> {
  return captureCanonicalBase64UrlValue(
    input,
    "authorityWitness",
    QUERY_AUTHORITY_WITNESS_BYTES,
    QUERY_AUTHORITY_WITNESS_BYTES,
    brandQueryAuthorityWitness,
  );
}

export function canonicalBase64UrlEncodedLength(byteLength: number): number {
  return Math.ceil((byteLength * 4) / 3);
}

export function canonicalBase64UrlDecodedLength(
  value:
    | CanonicalQueryKey
    | CanonicalQueryIdentity
    | CanonicalDependencyKey
    | QueryResultDigest
    | QueryAuthorityWitness,
): number {
  return Math.floor((value.length * 3) / 4);
}

export function compareCanonicalBase64Url(
  left: string,
  right: string,
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function successorSyncSequence(
  sequence: SyncSequence,
): SyncSequence | null {
  return sequence === MAX_SYNC_SEQUENCE
    ? null
    : brandSyncSequence(sequence + 1n);
}

export function successorQueryGeneration(
  generation: QueryGeneration,
): QueryGeneration | null {
  return generation === MAX_QUERY_GENERATION
    ? null
    : brandQueryGeneration(generation + 1n);
}

export function successorQuerySyncWorkRevision<
  Operation extends QuerySyncWorkRevisionOperation,
>(
  operation: Operation,
  revision: QuerySyncWorkRevision,
): Result.Result<
  QuerySyncWorkRevision,
  QuerySyncWorkRevisionExhaustedError<Operation>
> {
  return revision === MAX_QUERY_SYNC_WORK_REVISION
    ? Result.fail(new QuerySyncWorkRevisionExhaustedError({
      operation,
      currentRevision: revision,
    }))
    : Result.succeed(brandQuerySyncWorkRevision(revision + 1n));
}

export function successorPublicationAttemptOrdinal(
  ordinal: PublicationAttemptOrdinal,
): PublicationAttemptOrdinal | null {
  return ordinal === MAX_PUBLICATION_ATTEMPT_ORDINAL
    ? null
    : brandPublicationAttemptOrdinal(ordinal + 1);
}

export function initialQueryGeneration(): QueryGeneration {
  return brandQueryGeneration(1n);
}

export function initialQuerySyncWorkRevision(): QuerySyncWorkRevision {
  return brandQuerySyncWorkRevision(0n);
}

export function initialPublicationAttemptOrdinal(): PublicationAttemptOrdinal {
  return brandPublicationAttemptOrdinal(1);
}

export function querySnapshotAsSyncSequence(
  snapshot: QuerySnapshot,
): SyncSequence {
  return brandSyncSequence(snapshot);
}

export function wellFormedUtf8ByteLength(value: string): number {
  const byteLength = inspectWellFormedUtf8Length(value);
  if (byteLength === null) {
    throw new QuerySyncInvariantDefect({
      operation: "buildQuerySyncState",
      invariant: "capturedTextBecameIllFormed",
    });
  }
  return byteLength;
}
