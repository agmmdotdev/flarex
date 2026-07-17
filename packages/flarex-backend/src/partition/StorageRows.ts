import { Data, Effect, Schema } from "effect";
import {
  TablePlacement as ProtocolTablePlacement,
  ValidatorJson as ProtocolValidatorJson,
  type ValidatorJson as ProtocolValidatorJsonType,
} from "flarex-protocol/deployment";
import {
  isJsonArray,
  isJsonObject,
  JsonValue,
  type Json as ProtocolJson,
} from "flarex-protocol/json";
import type {
  CommitResponse,
  CommittedWrite,
  IndexWrite,
  Json,
  ReadSet,
  TablePlacement,
  ValidatorJson,
} from "../types";

export type PartitionStorageJsonOperation =
  | "commit-response"
  | "subscription-read-set"
  | "table-placement"
  | "table-validator"
  | "write-log-committed-writes"
  | "write-log-index-writes"
  | "document-json"
  | "index-fields";

export class PartitionStorageJsonError extends Data.TaggedError(
  "PartitionStorageJsonError",
)<{
  readonly operation: PartitionStorageJsonOperation;
  readonly message: string;
  readonly cause: unknown;
}> {}

const PartitionDocumentReadSchema = Schema.Struct({
  tableId: Schema.Number,
  id: Schema.String,
});

const PartitionTableReadSchema = Schema.Struct({
  tableId: Schema.Number,
});

const PartitionIndexReadSchema = Schema.Struct({
  indexId: Schema.Number,
  lower: Schema.optional(Schema.String),
  upper: Schema.optional(Schema.String),
});

const PartitionReadSetSchema = Schema.Struct({
  documents: Schema.optional(Schema.Array(PartitionDocumentReadSchema)),
  tables: Schema.optional(Schema.Array(PartitionTableReadSchema)),
  indexes: Schema.optional(Schema.Array(PartitionIndexReadSchema)),
});

const PartitionCommittedWriteSchema = Schema.Struct({
  tableId: Schema.Number,
  id: Schema.String,
  prevTs: Schema.Union([Schema.Number, Schema.Null]),
  ts: Schema.Number,
  value: JsonValue,
});

const PartitionIndexWriteSchema = Schema.Struct({
  indexId: Schema.Number,
  key: Schema.String,
  documentId: Schema.String,
  deleted: Schema.Boolean,
});

const PartitionCommitResponseSchema = Schema.Struct({
  committedTs: Schema.Number,
  writes: Schema.Array(PartitionCommittedWriteSchema),
  replayed: Schema.optional(Schema.Boolean),
});

const PartitionIndexFieldsSchema = Schema.Array(Schema.String);
const PartitionValidatorJsonOrNullSchema = Schema.Union([ProtocolValidatorJson, Schema.Null]);

const decodeUnknownCommitResponse = Schema.decodeUnknownEffect(PartitionCommitResponseSchema);
const decodeUnknownCommittedWrites = Schema.decodeUnknownEffect(Schema.Array(PartitionCommittedWriteSchema));
const decodeUnknownIndexWrites = Schema.decodeUnknownEffect(Schema.Array(PartitionIndexWriteSchema));
const decodeUnknownIndexFields = Schema.decodeUnknownEffect(PartitionIndexFieldsSchema);
const decodeUnknownJsonValue = Schema.decodeUnknownEffect(JsonValue);
const decodeUnknownReadSet = Schema.decodeUnknownEffect(PartitionReadSetSchema);
const decodeUnknownTablePlacement = Schema.decodeUnknownEffect(ProtocolTablePlacement);
const decodeUnknownValidatorJsonOrNull = Schema.decodeUnknownEffect(PartitionValidatorJsonOrNullSchema);

export const decodePartitionStorageCommitResponseJson = Effect.fn(
  "PartitionStorageRows.decodeCommitResponseJson",
)(function* (
  raw: string,
): Effect.fn.Return<CommitResponse, PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "commit-response").pipe(
    Effect.flatMap(value => decodeUnknownCommitResponse(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("commit-response", cause)),
  );
  return {
    committedTs: decoded.committedTs,
    writes: decoded.writes.map(committedWriteFromStorage),
    ...(decoded.replayed === undefined ? {} : { replayed: decoded.replayed }),
  };
});

export const decodePartitionStorageReadSetJson = Effect.fn(
  "PartitionStorageRows.decodeReadSetJson",
)(function* (
  raw: string,
): Effect.fn.Return<ReadSet, PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "subscription-read-set").pipe(
    Effect.flatMap(value => decodeUnknownReadSet(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("subscription-read-set", cause)),
  );
  return readSetFromStorage(decoded);
});

export const decodePartitionStorageTablePlacementJson = Effect.fn(
  "PartitionStorageRows.decodeTablePlacementJson",
)(function* (
  raw: string,
): Effect.fn.Return<TablePlacement, PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "table-placement").pipe(
    Effect.flatMap(value => decodeUnknownTablePlacement(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("table-placement", cause)),
  );
  return tablePlacementFromStorage(decoded);
});

export const decodePartitionStorageTableValidatorJson = Effect.fn(
  "PartitionStorageRows.decodeTableValidatorJson",
)(function* (
  raw: string,
): Effect.fn.Return<ValidatorJson | null, PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "table-validator").pipe(
    Effect.flatMap(value => decodeUnknownValidatorJsonOrNull(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("table-validator", cause)),
  );
  return decoded === null ? null : validatorJsonFromStorage(decoded);
});

export const decodePartitionStorageCommittedWritesJson = Effect.fn(
  "PartitionStorageRows.decodeCommittedWritesJson",
)(function* (
  raw: string,
): Effect.fn.Return<CommittedWrite[], PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "write-log-committed-writes").pipe(
    Effect.flatMap(value => decodeUnknownCommittedWrites(value)),
    Effect.mapError(cause =>
      partitionStorageJsonErrorFromCause("write-log-committed-writes", cause),
    ),
  );
  return decoded.map(committedWriteFromStorage);
});

export const decodePartitionStorageIndexWritesJson = Effect.fn(
  "PartitionStorageRows.decodeIndexWritesJson",
)(function* (
  raw: string,
): Effect.fn.Return<IndexWrite[], PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "write-log-index-writes").pipe(
    Effect.flatMap(value => decodeUnknownIndexWrites(value)),
    Effect.mapError(cause =>
      partitionStorageJsonErrorFromCause("write-log-index-writes", cause),
    ),
  );
  return decoded.map(indexWriteFromStorage);
});

export const decodePartitionStorageDocumentJson = Effect.fn(
  "PartitionStorageRows.decodeDocumentJson",
)(function* (
  raw: string,
): Effect.fn.Return<Json, PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "document-json").pipe(
    Effect.flatMap(value => decodeUnknownJsonValue(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("document-json", cause)),
  );
  return jsonFromStorage(decoded);
});

export const decodePartitionStorageIndexFieldsJson = Effect.fn(
  "PartitionStorageRows.decodeIndexFieldsJson",
)(function* (
  raw: string,
): Effect.fn.Return<string[], PartitionStorageJsonError> {
  const decoded = yield* parsePartitionStorageJson(raw, "index-fields").pipe(
    Effect.flatMap(value => decodeUnknownIndexFields(value)),
    Effect.mapError(cause => partitionStorageJsonErrorFromCause("index-fields", cause)),
  );
  return Array.from(decoded);
});

function parsePartitionStorageJson(
  raw: string,
  operation: PartitionStorageJsonOperation,
): Effect.Effect<unknown, PartitionStorageJsonError> {
  return Effect.try({
    // Deliberate JSON bridge: persisted rows are schema-decoded after parsing.
    try: () => JSON.parse(raw) as unknown,
    catch: cause => partitionStorageJsonError(operation, cause),
  });
}

function partitionStorageJsonError(
  operation: PartitionStorageJsonOperation,
  cause: unknown,
): PartitionStorageJsonError {
  return new PartitionStorageJsonError({
    operation,
    message: `Invalid PartitionDO storage JSON for ${operation}.`,
    cause,
  });
}

function partitionStorageJsonErrorFromCause(
  operation: PartitionStorageJsonOperation,
  cause: unknown,
): PartitionStorageJsonError {
  return cause instanceof PartitionStorageJsonError
    ? cause
    : partitionStorageJsonError(operation, cause);
}

function readSetFromStorage(decoded: typeof PartitionReadSetSchema.Type): ReadSet {
  return {
    ...(decoded.documents === undefined
      ? {}
      : { documents: decoded.documents.map(entry => ({ tableId: entry.tableId, id: entry.id })) }),
    ...(decoded.tables === undefined
      ? {}
      : { tables: decoded.tables.map(entry => ({ tableId: entry.tableId })) }),
    ...(decoded.indexes === undefined
      ? {}
      : {
          indexes: decoded.indexes.map(entry => ({
            indexId: entry.indexId,
            ...(entry.lower === undefined ? {} : { lower: entry.lower }),
            ...(entry.upper === undefined ? {} : { upper: entry.upper }),
          })),
        }),
  };
}

function committedWriteFromStorage(decoded: typeof PartitionCommittedWriteSchema.Type): CommittedWrite {
  return {
    tableId: decoded.tableId,
    id: decoded.id,
    prevTs: decoded.prevTs,
    ts: decoded.ts,
    value: jsonFromStorage(decoded.value),
  };
}

function indexWriteFromStorage(decoded: typeof PartitionIndexWriteSchema.Type): IndexWrite {
  return {
    indexId: decoded.indexId,
    key: decoded.key,
    documentId: decoded.documentId,
    deleted: decoded.deleted,
  };
}

function tablePlacementFromStorage(decoded: typeof ProtocolTablePlacement.Type): TablePlacement {
  if (decoded.kind === "partitionBy") {
    return { kind: "partitionBy", field: decoded.field };
  }
  if (decoded.kind === "colocateWith") {
    return {
      kind: "colocateWith",
      table: decoded.table,
      field: decoded.field,
    };
  }
  return { kind: "global" };
}

function validatorJsonFromStorage(decoded: ProtocolValidatorJsonType): ValidatorJson {
  switch (decoded.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type: decoded.type };
    case "id":
      return { type: "id", tableName: decoded.tableName };
    case "literal":
      return { type: "literal", value: decoded.value };
    case "array":
      return { type: "array", value: validatorJsonFromStorage(decoded.value) };
    case "object": {
      const fields: Record<string, { fieldType: ValidatorJson; optional: boolean }> = {};
      for (const [fieldName, field] of Object.entries(decoded.value)) {
        fields[fieldName] = {
          fieldType: validatorJsonFromStorage(field.fieldType),
          optional: field.optional,
        };
      }
      return { type: "object", value: fields };
    }
    case "record":
      return {
        type: "record",
        keys: validatorJsonFromStorage(decoded.keys),
        values: validatorJsonFromStorage(decoded.values),
      };
    case "union":
      return { type: "union", value: decoded.value.map(validatorJsonFromStorage) };
  }
}

function jsonFromStorage(value: ProtocolJson): Json {
  if (isJsonArray(value)) return value.map(jsonFromStorage);
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonFromStorage(entry)]),
    );
  }
  return value;
}
