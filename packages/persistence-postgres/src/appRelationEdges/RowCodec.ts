import {
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Result, Schema } from "effect";

import {
  appRowIdHexV1FromBytesResult,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogRelationIdSchema,
  CatalogTableIdSchema,
  type CatalogEdgeDefinitionId,
  type CatalogRelationId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { MAX_RELATION_MANY_ITEMS_V1 } from
  "flarex-protocol/internal/relation-declaration-v1";
import {
  MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
  RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  RELATION_OCCURRENCE_SHA256_BYTES_V1,
  RELATION_OCCURRENCE_VERSION_V1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  AppRelationEdgeCorruptionError,
  type AppRelationEdgeIncomingPageItem,
  type AppRelationEdgeOperation,
  type AppRelationEdgePosition,
} from "./Model";

const decodeScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeEpochUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeRelationIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogRelationIdSchema),
);
const decodeEdgeDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogEdgeDefinitionIdSchema),
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogSchemaVersionIdSchema),
);

export interface StoredAppRelationEdge {
  readonly scopeUuid: ScopeUuidV1;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly sourceRowId: AppRowIdHexV1;
  readonly targetTableId: CatalogTableId;
  readonly targetRowId: AppRowIdHexV1;
  readonly duplicateOrdinal: 0;
  readonly occurrenceCodecVersion: 1;
  readonly occurrenceBytes: Uint8Array;
  readonly occurrenceSha256: Uint8Array;
  readonly locale: null;
  readonly position: AppRelationEdgePosition;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
}

export interface StoredAppRelationEdgeRow {
  readonly scopeUuid: unknown;
  readonly relationId: unknown;
  readonly edgeDefinitionId: unknown;
  readonly sourceTableId: unknown;
  readonly sourceRowId: unknown;
  readonly targetTableId: unknown;
  readonly targetRowId: unknown;
  readonly duplicateOrdinal: unknown;
  readonly occurrenceCodecVersion: unknown;
  readonly occurrenceBytes: unknown;
  readonly occurrenceSha256: unknown;
  readonly locale: unknown;
  readonly position: unknown;
  readonly schemaVersionId: unknown;
  readonly writeEpochUuid: unknown;
  readonly commitSeq: unknown;
}

export function decodeStoredAppRelationEdgeResult(
  operation: AppRelationEdgeOperation,
  row: StoredAppRelationEdgeRow,
): Result.Result<StoredAppRelationEdge, AppRelationEdgeCorruptionError> {
  return Result.gen(function* () {
    const scopeUuid = yield* decodeField(
      operation,
      decodeScopeUuidResult(row.scopeUuid),
      "scope UUID is invalid",
    );
    const relationId = yield* decodeField(
      operation,
      decodeRelationIdResult(row.relationId),
      "relation ID is invalid",
    );
    const edgeDefinitionId = yield* decodeField(
      operation,
      decodeEdgeDefinitionIdResult(row.edgeDefinitionId),
      "edge-definition ID is invalid",
    );
    const sourceTableId = yield* decodeField(
      operation,
      decodeTableIdResult(row.sourceTableId),
      "source table ID is invalid",
    );
    const sourceRowId = yield* decodeField(
      operation,
      appRowIdHexV1FromBytesResult(row.sourceRowId),
      "source row ID is invalid",
    );
    const targetTableId = yield* decodeField(
      operation,
      decodeTableIdResult(row.targetTableId),
      "target table ID is invalid",
    );
    const targetRowId = yield* decodeField(
      operation,
      appRowIdHexV1FromBytesResult(row.targetRowId),
      "target row ID is invalid",
    );
    if (
      row.duplicateOrdinal !== RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1
    ) {
      return yield* corrupt(operation, "duplicate ordinal is invalid");
    }
    if (row.occurrenceCodecVersion !== RELATION_OCCURRENCE_VERSION_V1) {
      return yield* corrupt(operation, "occurrence codec version is invalid");
    }
    const occurrenceBytes = yield* decodeBytes(
      operation,
      row.occurrenceBytes,
      1,
      MAX_RELATION_OCCURRENCE_CANONICAL_BYTES_V1,
      "canonical occurrence bytes are invalid",
    );
    const occurrenceSha256 = yield* decodeBytes(
      operation,
      row.occurrenceSha256,
      RELATION_OCCURRENCE_SHA256_BYTES_V1,
      RELATION_OCCURRENCE_SHA256_BYTES_V1,
      "occurrence digest is invalid",
    );
    if (row.locale !== null) {
      return yield* corrupt(operation, "locale is not absent");
    }
    const position = yield* decodePosition(operation, row.position);
    const schemaVersionId = yield* decodeField(
      operation,
      decodeSchemaVersionIdResult(row.schemaVersionId),
      "schema version ID is invalid",
    );
    const writeEpochUuid = yield* decodeField(
      operation,
      decodeEpochUuidResult(row.writeEpochUuid),
      "write epoch UUID is invalid",
    );
    const commitSeq = yield* decodePositiveCommitSeq(
      operation,
      row.commitSeq,
      "commit sequence is invalid",
    );
    const stableOccurrenceBytes = copyBytes(occurrenceBytes);
    const stableOccurrenceSha256 = copyBytes(occurrenceSha256);
    return Object.freeze({
      scopeUuid,
      relationId,
      edgeDefinitionId,
      sourceTableId,
      sourceRowId,
      targetTableId,
      targetRowId,
      duplicateOrdinal: RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
      occurrenceCodecVersion: RELATION_OCCURRENCE_VERSION_V1,
      get occurrenceBytes(): Uint8Array {
        return copyBytes(stableOccurrenceBytes);
      },
      get occurrenceSha256(): Uint8Array {
        return copyBytes(stableOccurrenceSha256);
      },
      locale: null,
      position,
      schemaVersionId,
      writeEpochUuid,
      commitSeq,
    });
  });
}

export interface StoredIncomingAppRelationEdgePageRow {
  readonly sourceRowId: unknown;
  readonly duplicateOrdinal: unknown;
  readonly position: unknown;
  readonly commitSeq: unknown;
}

export function decodeStoredIncomingAppRelationEdgePageItemResult(
  row: StoredIncomingAppRelationEdgePageRow,
): Result.Result<
  AppRelationEdgeIncomingPageItem,
  AppRelationEdgeCorruptionError
> {
  const operation = "readIncomingPage" as const;
  return Result.gen(function* () {
    const sourceRowId = yield* decodeField(
      operation,
      appRowIdHexV1FromBytesResult(row.sourceRowId),
      "source row ID is invalid",
    );
    if (
      row.duplicateOrdinal !== RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1
    ) {
      return yield* corrupt(operation, "duplicate ordinal is invalid");
    }
    const position = yield* decodePosition(operation, row.position);
    const commitSeq = yield* decodePositiveCommitSeq(
      operation,
      row.commitSeq,
      "commit sequence is invalid",
    );
    return Object.freeze({
      sourceRowId,
      duplicateOrdinal: RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
      position,
      commitSeq,
    });
  });
}

export function decodeStoredAdjacencyVersionResult(
  operation:
    | "readAdjacencyVersion"
    | "readIncomingAdjacencyVersions"
    | "readIncomingPage",
  value: unknown,
): Result.Result<CommitSeq, AppRelationEdgeCorruptionError> {
  return decodePositiveCommitSeq(
    operation,
    value,
    "adjacency version is invalid",
  );
}

function decodePosition(
  operation: AppRelationEdgeOperation,
  value: unknown,
): Result.Result<AppRelationEdgePosition, AppRelationEdgeCorruptionError> {
  if (value === null) return Result.succeed(null);
  return Number.isInteger(value) && typeof value === "number" &&
      value >= 0 && value < MAX_RELATION_MANY_ITEMS_V1
    ? Result.succeed(value)
    : corrupt(operation, "position is invalid");
}

function decodePositiveCommitSeq(
  operation: AppRelationEdgeOperation,
  value: unknown,
  reason: string,
): Result.Result<CommitSeq, AppRelationEdgeCorruptionError> {
  return decodeField(operation, decodeCommitSeqResult(value), reason).pipe(
    Result.flatMap((commitSeq) =>
      commitSeq >= 1n
        ? Result.succeed(commitSeq)
        : corrupt(operation, reason)
    ),
  );
}

function decodeBytes(
  operation: AppRelationEdgeOperation,
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
  reason: string,
): Result.Result<Uint8Array, AppRelationEdgeCorruptionError> {
  const byteLength = uint8ArrayByteLength(value);
  if (
    byteLength === undefined || byteLength < minimumBytes ||
    byteLength > maximumBytes ||
    (minimumBytes === maximumBytes &&
      !isUint8ArrayWithByteLength(value, minimumBytes))
  ) {
    return corrupt(operation, reason);
  }
  return isUint8Array(value)
    ? Result.succeed(value)
    : corrupt(operation, reason);
}

function decodeField<Value, Error>(
  operation: AppRelationEdgeOperation,
  result: Result.Result<Value, Error>,
  reason: string,
): Result.Result<Value, AppRelationEdgeCorruptionError> {
  return result.pipe(Result.mapError((cause) =>
    new AppRelationEdgeCorruptionError({ operation, reason, cause })
  ));
}

function corrupt(
  operation: AppRelationEdgeOperation,
  reason: string,
): Result.Result<never, AppRelationEdgeCorruptionError> {
  return Result.fail(new AppRelationEdgeCorruptionError({
    operation,
    reason,
  }));
}
