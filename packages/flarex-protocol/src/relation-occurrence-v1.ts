import {
  bytesEqual,
  copyBytes,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Context, Data, Effect, Result, Schema } from "effect";

import { AppDocumentIdV1Schema } from "./app-document-id";
import { snapshotDecodedProtocolPlainData } from
  "./decoded-protocol-snapshot";
import {
  encodeCanonicalJson,
  type JsonObject,
} from "./json";
import { RelationSourcePathV1Schema } from "./relation-declaration-v1";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  exactOwnDataIssue,
  hasExactOwnDataKeys,
  inspectOwnDataRecord,
  type ExactOwnDataIssue,
} from "./exact-own-data";
import { snapshotExactRelationSourcePathV1 } from
  "./relation-source-path-v1-exact";

const UTF8_ENCODER = new TextEncoder();

export const RELATION_OCCURRENCE_FORMAT_V1 =
  "flarex.relation-occurrence" as const;
export const RELATION_OCCURRENCE_VERSION_V1 = 1 as const;
export const RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1 = 0 as const;
export const RELATION_OCCURRENCE_SHA256_BYTES_V1 = 32;
export const MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1 = 8_192;

export const RelationOccurrenceV1Schema = Schema.Struct({
  format: Schema.Literal(RELATION_OCCURRENCE_FORMAT_V1),
  version: Schema.Literal(RELATION_OCCURRENCE_VERSION_V1),
  sourceDocumentId: AppDocumentIdV1Schema,
  sourcePath: RelationSourcePathV1Schema,
  targetDocumentId: AppDocumentIdV1Schema,
  duplicateOrdinal: Schema.Literal(RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1),
}).annotate(StrictStructOptions);
export type RelationOccurrenceV1 = typeof RelationOccurrenceV1Schema.Type;

const decodeRelationOccurrenceShapeV1Result = Schema.decodeUnknownResult(
  RelationOccurrenceV1Schema,
  StrictParseOptions,
);

export type RelationOccurrenceV1Issue =
  | Readonly<{
      readonly reason: "invalidOccurrence";
      readonly cause: Schema.SchemaError;
    }>
  | Readonly<{
      readonly reason: "invalidOwnData";
      readonly path: string;
      readonly cause?: unknown;
    }>
  | Readonly<{
      readonly reason: "canonicalBytesExceeded";
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }>
  | Readonly<{
      readonly reason: "invalidSha256Length";
      readonly observedBytes: number | null;
      readonly expectedBytes: number;
    }>;

export class RelationOccurrenceV1Error extends Data.TaggedError(
  "RelationOccurrenceV1Error",
)<{
  readonly operation: "decode" | "canonicalize";
  readonly issue: RelationOccurrenceV1Issue;
}> {}

export class RelationOccurrenceSha256Error extends Data.TaggedError(
  "RelationOccurrenceSha256Error",
)<{
  readonly operation: "digest";
  readonly cause: unknown;
}> {}

export interface RelationOccurrenceSha256Api {
  readonly digest: (
    canonicalBytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, RelationOccurrenceSha256Error>;
}

export class RelationOccurrenceSha256 extends Context.Service<
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Api
>()("flarex/protocol/relationOccurrence/RelationOccurrenceSha256") {}

export interface CanonicalRelationOccurrenceV1 {
  readonly occurrence: RelationOccurrenceV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export function decodeRelationOccurrenceV1Result(
  input: unknown,
): Result.Result<RelationOccurrenceV1, RelationOccurrenceV1Error> {
  return snapshotExactRelationOccurrenceV1(input).pipe(
    Result.mapError(ownDataError),
    Result.flatMap(value => decodeRelationOccurrenceShapeV1Result(value).pipe(
      Result.mapError((cause) => new RelationOccurrenceV1Error({
        operation: "decode",
        issue: { reason: "invalidOccurrence", cause },
      })),
    )),
    Result.map((value) =>
      snapshotDecodedProtocolPlainData(value) satisfies RelationOccurrenceV1
    ),
  );
}

function snapshotExactRelationOccurrenceV1(
  input: unknown,
): Result.Result<unknown, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const occurrence = yield* inspectOwnDataRecord(
      input,
      "occurrence",
    );
    if (!hasExactOwnDataKeys(occurrence.properties, [
      "format",
      "version",
      "sourceDocumentId",
      "sourcePath",
      "targetDocumentId",
      "duplicateOrdinal",
    ])) {
      return yield* Result.fail(exactOwnDataIssue("occurrence"));
    }
    const sourcePath = yield* snapshotExactRelationSourcePathV1(
      occurrence.properties.get("sourcePath"),
      "occurrence.sourcePath",
      occurrence.ancestors,
    );
    return {
      format: occurrence.properties.get("format"),
      version: occurrence.properties.get("version"),
      sourceDocumentId: occurrence.properties.get("sourceDocumentId"),
      sourcePath,
      targetDocumentId: occurrence.properties.get("targetDocumentId"),
      duplicateOrdinal: occurrence.properties.get("duplicateOrdinal"),
    };
  });
}

function ownDataError(issue: ExactOwnDataIssue): RelationOccurrenceV1Error {
  return new RelationOccurrenceV1Error({
    operation: "decode",
    issue: {
      reason: "invalidOwnData",
      path: issue.path,
      ...(issue.reason === "invalidOwnData" && issue.cause !== undefined
        ? { cause: issue.cause }
        : {}),
    },
  });
}

export const canonicalizeRelationOccurrenceV1 = Effect.fn(
  "RelationOccurrence.canonicalizeV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalRelationOccurrenceV1,
  RelationOccurrenceV1Error | RelationOccurrenceSha256Error,
  RelationOccurrenceSha256
> {
  const occurrence = yield* Effect.fromResult(
    decodeRelationOccurrenceV1Result(input),
  );
  const canonicalText = encodeRelationOccurrenceV1CanonicalText(occurrence);
  const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
  if (
    canonicalBytes.byteLength > MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1
  ) {
    return yield* Effect.fail(new RelationOccurrenceV1Error({
      operation: "canonicalize",
      issue: {
        reason: "canonicalBytesExceeded",
        observedBytes: canonicalBytes.byteLength,
        maximumBytes: MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
      },
    }));
  }

  const stableBytes = copyBytes(canonicalBytes);
  const sha256Service = yield* RelationOccurrenceSha256;
  const digest = yield* sha256Service.digest(copyBytes(stableBytes));
  if (!isUint8ArrayWithByteLength(
    digest,
    RELATION_OCCURRENCE_SHA256_BYTES_V1,
  )) {
    return yield* Effect.fail(new RelationOccurrenceV1Error({
      operation: "canonicalize",
      issue: {
        reason: "invalidSha256Length",
        observedBytes: uint8ArrayByteLength(digest) ?? null,
        expectedBytes: RELATION_OCCURRENCE_SHA256_BYTES_V1,
      },
    }));
  }
  const stableSha256 = copyBytes(digest);

  return Object.freeze({
    occurrence,
    canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
  } satisfies CanonicalRelationOccurrenceV1);
});

export type RelationOccurrenceEvidenceComparisonV1 =
  | Readonly<{ readonly kind: "equal" }>
  | Readonly<{ readonly kind: "distinct" }>;

export type RelationOccurrenceComparisonV1Issue =
  | Readonly<{
      readonly reason: "sha256Collision";
      readonly leftCanonicalText: string;
      readonly rightCanonicalText: string;
    }>
  | Readonly<{
      readonly reason: "inconsistentDigest";
      readonly canonicalText: string;
    }>;

export class RelationOccurrenceComparisonV1Error extends Data.TaggedError(
  "RelationOccurrenceComparisonV1Error",
)<{
  readonly operation: "compareEvidence";
  readonly issue: RelationOccurrenceComparisonV1Issue;
}> {}

const EQUAL_OCCURRENCE_EVIDENCE_V1 = Object.freeze({
  kind: "equal",
} as const satisfies RelationOccurrenceEvidenceComparisonV1);
const DISTINCT_OCCURRENCE_EVIDENCE_V1 = Object.freeze({
  kind: "distinct",
} as const satisfies RelationOccurrenceEvidenceComparisonV1);

export function compareRelationOccurrenceEvidenceV1(
  left: CanonicalRelationOccurrenceV1,
  right: CanonicalRelationOccurrenceV1,
): Result.Result<
  RelationOccurrenceEvidenceComparisonV1,
  RelationOccurrenceComparisonV1Error
> {
  const leftBytes = left.canonicalBytes;
  const rightBytes = right.canonicalBytes;
  const bytesMatch = bytesEqual(leftBytes, rightBytes);
  const digestsMatch = bytesEqual(left.sha256, right.sha256);

  if (digestsMatch) {
    return bytesMatch
      ? Result.succeed(EQUAL_OCCURRENCE_EVIDENCE_V1)
      : Result.fail(new RelationOccurrenceComparisonV1Error({
        operation: "compareEvidence",
        issue: {
          reason: "sha256Collision",
          leftCanonicalText: left.canonicalText,
          rightCanonicalText: right.canonicalText,
        },
      }));
  }
  return bytesMatch
    ? Result.fail(new RelationOccurrenceComparisonV1Error({
      operation: "compareEvidence",
      issue: {
        reason: "inconsistentDigest",
        canonicalText: left.canonicalText,
      },
    }))
    : Result.succeed(DISTINCT_OCCURRENCE_EVIDENCE_V1);
}

function encodeRelationOccurrenceV1CanonicalText(
  occurrence: RelationOccurrenceV1,
): string {
  return encodeCanonicalJson(
    relationOccurrenceV1ToJson(occurrence),
    (issue) => {
      throw new Error(
        `Typed relation occurrence lost its JSON representation: ${issue.reason}`,
      );
    },
  );
}

function relationOccurrenceV1ToJson(
  occurrence: RelationOccurrenceV1,
): JsonObject {
  return {
    duplicateOrdinal: occurrence.duplicateOrdinal,
    format: occurrence.format,
    sourceDocumentId: occurrence.sourceDocumentId,
    sourcePath: [{
      kind: occurrence.sourcePath[0].kind,
      name: occurrence.sourcePath[0].name,
    }],
    targetDocumentId: occurrence.targetDocumentId,
    version: occurrence.version,
  };
}
