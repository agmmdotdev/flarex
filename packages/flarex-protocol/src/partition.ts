import { Data, Effect } from "effect";
import type { DeploymentSchema } from "./deployment";
import { isJson } from "./json";

export type PartitionJson =
  | null
  | boolean
  | number
  | string
  | PartitionJson[]
  | { [key: string]: PartitionJson };

export type PartitionDocumentRead = {
  tableId: number;
  id: string;
};

export type PartitionTableRead = {
  tableId: number;
};

export type PartitionIndexRead = {
  indexId: number;
  lower?: string;
  upper?: string;
};

export type PartitionReadSet = {
  documents?: PartitionDocumentRead[];
  tables?: PartitionTableRead[];
  indexes?: PartitionIndexRead[];
};

export type PartitionDocumentWrite = {
  tableId: number;
  id?: string;
  value: PartitionJson | null;
};

export type PartitionSchemaCacheRequest = Partial<DeploymentSchema> & {
  partitionKey?: string;
  schema?: Partial<DeploymentSchema>;
};

export type PartitionSubscriptionRegistrationRequest = {
  connectionName: string;
  queryId: number;
  readSet: PartitionReadSet;
};

export type PartitionSubscriptionTargetRequest = {
  connectionName: string;
  queryId: number;
};

export type PartitionConnectionUnregisterRequest = {
  connectionName: string;
};

export type PartitionCommitRequest = {
  beginTs: number;
  schemaVersion?: number;
  source?: string;
  idempotencyKey?: string;
  readSet?: PartitionReadSet;
  writes: PartitionDocumentWrite[];
};

export class PartitionRoutePayloadError extends Data.TaggedError("PartitionRoutePayloadError")<{
  readonly message: string;
}> {}

export const decodePartitionSchemaCachePayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSchemaCachePayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
    return yield* partitionRoutePayloadValidationResultToEffect(
      normalizePartitionSchemaCachePayload(value),
    );
  },
);

export const decodePublicPartitionSchemaCachePayloadEffect = Effect.fn(
  "PartitionProtocol.decodePublicSchemaCachePayload",
)(
  function* (
    value: unknown,
    partitionKey: string,
  ): Effect.fn.Return<PartitionSchemaCacheRequest, PartitionRoutePayloadError> {
    yield* decodePartitionSchemaCachePayloadEffect(value);
    return { partitionKey, schema: value as Partial<DeploymentSchema> };
  },
);

export const decodePartitionCommitPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeCommitPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionCommitRequest, PartitionRoutePayloadError> {
    return yield* partitionRoutePayloadValidationResultToEffect(
      normalizePartitionCommitPayload(value),
    );
  },
);

export const decodePartitionSubscriptionRegistrationPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSubscriptionRegistrationPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSubscriptionRegistrationRequest, PartitionRoutePayloadError> {
    return yield* partitionRoutePayloadValidationResultToEffect(
      normalizePartitionSubscriptionRegistrationPayload(value),
    );
  },
);

export const decodePartitionSubscriptionTargetPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeSubscriptionTargetPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionSubscriptionTargetRequest, PartitionRoutePayloadError> {
    return yield* partitionRoutePayloadValidationResultToEffect(
      normalizePartitionSubscriptionTargetPayload(value),
    );
  },
);

export const decodePartitionConnectionUnregisterPayloadEffect = Effect.fn(
  "PartitionProtocol.decodeConnectionUnregisterPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<PartitionConnectionUnregisterRequest, PartitionRoutePayloadError> {
    return yield* partitionRoutePayloadValidationResultToEffect(
      normalizePartitionConnectionUnregisterPayload(value),
    );
  },
);

function normalizePartitionSchemaCachePayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSchemaCacheRequest> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure("schema-cache request body must be an object.");
  }
  return partitionRoutePayloadValidationSuccess(value as PartitionSchemaCacheRequest);
}

function normalizePartitionCommitPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionCommitRequest> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure("commit request body must be an object.");
  }
  const beginTs = requiredIntegerField(value, "beginTs");
  if (!beginTs.success) return beginTs;
  const schemaVersion = value.schemaVersion === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : integerField(value, "schemaVersion");
  if (!schemaVersion.success) return schemaVersion;
  const source = value.source === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : stringField(value, "source");
  if (!source.success) return source;
  const idempotencyKey = value.idempotencyKey === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : stringField(value, "idempotencyKey");
  if (!idempotencyKey.success) return idempotencyKey;
  const readSet = value.readSet === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : readSetField(value, "readSet");
  if (!readSet.success) return readSet;
  const writes = writesField(value, "writes");
  if (!writes.success) return writes;

  return partitionRoutePayloadValidationSuccess({
    beginTs: beginTs.value,
    ...(schemaVersion.value === undefined ? {} : { schemaVersion: schemaVersion.value }),
    ...(source.value === undefined ? {} : { source: source.value }),
    ...(idempotencyKey.value === undefined ? {} : { idempotencyKey: idempotencyKey.value }),
    ...(readSet.value === undefined ? {} : { readSet: readSet.value }),
    writes: writes.value,
  });
}

function normalizePartitionSubscriptionRegistrationPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSubscriptionRegistrationRequest> {
  const target = normalizePartitionSubscriptionTargetPayload(value);
  if (!target.success) return target;
  const readSet = requiredReadSet(value, "readSet");
  if (!readSet.success) return readSet;
  return partitionRoutePayloadValidationSuccess({
    ...target.value,
    readSet: readSet.value,
  });
}

function normalizePartitionSubscriptionTargetPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionSubscriptionTargetRequest> {
  const connectionName = requiredStringField(value, "connectionName");
  if (!connectionName.success) return connectionName;
  const queryId = requiredIntegerField(value, "queryId");
  if (!queryId.success) return queryId;
  return partitionRoutePayloadValidationSuccess({
    connectionName: connectionName.value,
    queryId: queryId.value,
  });
}

function normalizePartitionConnectionUnregisterPayload(
  value: unknown,
): PartitionRoutePayloadValidationResult<PartitionConnectionUnregisterRequest> {
  const connectionName = requiredStringField(value, "connectionName");
  if (!connectionName.success) return connectionName;
  return partitionRoutePayloadValidationSuccess({ connectionName: connectionName.value });
}

function requiredStringField(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  if (isRecord(value) && typeof value[field] === "string" && value[field].length > 0) {
    return partitionRoutePayloadValidationSuccess(value[field]);
  }
  return partitionRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
}

function requiredIntegerField(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<number> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an integer.`);
  }
  return integerField(value, field);
}

function integerField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<number> {
  const property = propertyForPath(value, field);
  if (typeof property !== "number" || !Number.isInteger(property)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an integer.`);
  }
  return partitionRoutePayloadValidationSuccess(property);
}

function requiredReadSet(
  value: unknown,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionReadSet> {
  if (!isRecord(value)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an object.`);
  }
  return readSetField(value, field);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRoutePayloadValidationFailure(`${field} must be a string.`);
  }
  return partitionRoutePayloadValidationSuccess(property);
}

function readSetField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionReadSet> {
  const candidate = value[field];
  if (!isRecord(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an object.`);
  }
  const documents = candidate.documents === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : documentReadsField(candidate, `${field}.documents`);
  if (!documents.success) return documents;
  const tables = candidate.tables === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : tableReadsField(candidate, `${field}.tables`);
  if (!tables.success) return tables;
  const indexes = candidate.indexes === undefined
    ? partitionRoutePayloadValidationSuccess(undefined)
    : indexReadsField(candidate, `${field}.indexes`);
  if (!indexes.success) return indexes;

  return partitionRoutePayloadValidationSuccess({
    ...(documents.value === undefined ? {} : { documents: documents.value }),
    ...(tables.value === undefined ? {} : { tables: tables.value }),
    ...(indexes.value === undefined ? {} : { indexes: indexes.value }),
  });
}

function documentReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionDocumentRead[]> {
  const candidate = value.documents;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  const entries: PartitionDocumentRead[] = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRoutePayloadValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    const id = nonEmptyStringProperty(entry, `${path}.id`);
    if (!id.success) return id;
    entries.push({
      tableId: tableId.value,
      id: id.value,
    });
  }
  return partitionRoutePayloadValidationSuccess(entries);
}

function tableReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionTableRead[]> {
  const candidate = value.tables;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  const entries: PartitionTableRead[] = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRoutePayloadValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    entries.push({ tableId: tableId.value });
  }
  return partitionRoutePayloadValidationSuccess(entries);
}

function indexReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionIndexRead[]> {
  const candidate = value.indexes;
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  const entries: PartitionIndexRead[] = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRoutePayloadValidationFailure(`${path} must be an object.`);
    const indexId = integerField(entry, `${path}.indexId`);
    if (!indexId.success) return indexId;
    const lower = entry.lower === undefined
      ? partitionRoutePayloadValidationSuccess(undefined)
      : stringProperty(entry, `${path}.lower`);
    if (!lower.success) return lower;
    const upper = entry.upper === undefined
      ? partitionRoutePayloadValidationSuccess(undefined)
      : stringProperty(entry, `${path}.upper`);
    if (!upper.success) return upper;
    entries.push({
      indexId: indexId.value,
      ...(lower.value === undefined ? {} : { lower: lower.value }),
      ...(upper.value === undefined ? {} : { upper: upper.value }),
    });
  }
  return partitionRoutePayloadValidationSuccess(entries);
}

function writesField(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionDocumentWrite[]> {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    return partitionRoutePayloadValidationFailure(`${field} must be an array.`);
  }
  const writes: PartitionDocumentWrite[] = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRoutePayloadValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    const id = entry.id === undefined
      ? partitionRoutePayloadValidationSuccess(undefined)
      : nonEmptyStringProperty(entry, `${path}.id`);
    if (!id.success) return id;
    const value = jsonProperty(entry, `${path}.value`);
    if (!value.success) return value;
    writes.push({
      tableId: tableId.value,
      ...(id.value === undefined ? {} : { id: id.value }),
      value: value.value,
    });
  }
  return partitionRoutePayloadValidationSuccess(writes);
}

function jsonProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<PartitionJson | null> {
  const property = propertyForPath(value, field);
  if (!isJson(property)) {
    return partitionRoutePayloadValidationFailure(`${field} must be a JSON value.`);
  }
  return partitionRoutePayloadValidationSuccess(property as PartitionJson);
}

function nonEmptyStringProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string" || property.length === 0) {
    return partitionRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
  }
  return partitionRoutePayloadValidationSuccess(property);
}

function stringProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRoutePayloadValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRoutePayloadValidationFailure(`${field} must be a string.`);
  }
  return partitionRoutePayloadValidationSuccess(property);
}

function propertyForPath(value: Record<string, unknown>, field: string): unknown {
  const propertyName = field.slice(field.lastIndexOf(".") + 1);
  return value[propertyName];
}

type PartitionRoutePayloadValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: PartitionRoutePayloadError;
    };

function partitionRoutePayloadValidationSuccess<A>(value: A): PartitionRoutePayloadValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function partitionRoutePayloadValidationFailure<A = never>(
  message: string,
): PartitionRoutePayloadValidationResult<A> {
  return {
    success: false,
    error: new PartitionRoutePayloadError({ message }),
  };
}

function partitionRoutePayloadValidationResultToEffect<A>(
  result: PartitionRoutePayloadValidationResult<A>,
): Effect.Effect<A, PartitionRoutePayloadError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
