import { Data, Effect } from "effect";
import { isJson } from "flarex-protocol/json";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { CommitRequest, DeploymentSchema, DocumentWrite, Json, ReadSet } from "../types";

export type PartitionSchemaCacheRequest = Partial<DeploymentSchema> & {
  partitionKey?: string;
  schema?: Partial<DeploymentSchema>;
};

export type PartitionSubscriptionRegistrationRequest = {
  connectionName: string;
  queryId: number;
  readSet: ReadSet;
};

export type PartitionSubscriptionTargetRequest = {
  connectionName: string;
  queryId: number;
};

export type PartitionConnectionUnregisterRequest = {
  connectionName: string;
};

export type PartitionCommitRequest = CommitRequest;

export class PartitionRouteValidationError extends Data.TaggedError("PartitionRouteValidationError")<{
  readonly message: string;
}> {}

export type PartitionRouteError = RequestJsonError | PartitionRouteValidationError;

export async function readPartitionSchemaCacheRequest(
  request: Request,
): Promise<PartitionSchemaCacheRequest> {
  return runPartitionRouteEffect(decodePartitionSchemaCacheRequest(request));
}

export function decodePartitionSchemaCacheRequest(
  request: Request,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePartitionSchemaCacheRequestEffect),
  );
}

export function parsePartitionSchemaCacheRequest(
  value: unknown,
): PartitionSchemaCacheRequest {
  return unwrapPartitionRouteValidation(normalizePartitionSchemaCacheRequest(value));
}

export function parsePartitionSchemaCacheRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSchemaCacheRequest, PartitionRouteValidationError> {
  return partitionRouteValidationResultToEffect(normalizePartitionSchemaCacheRequest(value));
}

function normalizePartitionSchemaCacheRequest(
  value: unknown,
): PartitionRouteValidationResult<PartitionSchemaCacheRequest> {
  if (!isRecord(value)) {
    return partitionRouteValidationFailure("schema-cache request body must be an object.");
  }
  return partitionRouteValidationSuccess(value as PartitionSchemaCacheRequest);
}

export async function readPartitionCommitRequest(
  request: Request,
): Promise<PartitionCommitRequest> {
  return runPartitionRouteEffect(decodePartitionCommitRequest(request));
}

export function decodePartitionCommitRequest(
  request: Request,
): Effect.Effect<PartitionCommitRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePartitionCommitRequestEffect),
  );
}

export function parsePartitionCommitRequest(value: unknown): PartitionCommitRequest {
  return unwrapPartitionRouteValidation(normalizePartitionCommitRequest(value));
}

export function parsePartitionCommitRequestEffect(
  value: unknown,
): Effect.Effect<PartitionCommitRequest, PartitionRouteValidationError> {
  return partitionRouteValidationResultToEffect(normalizePartitionCommitRequest(value));
}

function normalizePartitionCommitRequest(
  value: unknown,
): PartitionRouteValidationResult<PartitionCommitRequest> {
  if (!isRecord(value)) {
    return partitionRouteValidationFailure("commit request body must be an object.");
  }
  const beginTs = requiredIntegerField(value, "beginTs");
  if (!beginTs.success) return beginTs;
  const schemaVersion = value.schemaVersion === undefined
    ? partitionRouteValidationSuccess(undefined)
    : integerField(value, "schemaVersion");
  if (!schemaVersion.success) return schemaVersion;
  const source = value.source === undefined
    ? partitionRouteValidationSuccess(undefined)
    : stringField(value, "source");
  if (!source.success) return source;
  const idempotencyKey = value.idempotencyKey === undefined
    ? partitionRouteValidationSuccess(undefined)
    : stringField(value, "idempotencyKey");
  if (!idempotencyKey.success) return idempotencyKey;
  const readSet = value.readSet === undefined
    ? partitionRouteValidationSuccess(undefined)
    : readSetField(value, "readSet");
  if (!readSet.success) return readSet;
  const writes = writesField(value, "writes");
  if (!writes.success) return writes;

  return partitionRouteValidationSuccess({
    beginTs: beginTs.value,
    ...(schemaVersion.value === undefined ? {} : { schemaVersion: schemaVersion.value }),
    ...(source.value === undefined ? {} : { source: source.value }),
    ...(idempotencyKey.value === undefined ? {} : { idempotencyKey: idempotencyKey.value }),
    ...(readSet.value === undefined ? {} : { readSet: readSet.value }),
    writes: writes.value,
  });
}

export async function readPartitionSubscriptionRegistrationRequest(
  request: Request,
): Promise<PartitionSubscriptionRegistrationRequest> {
  return runPartitionRouteEffect(decodePartitionSubscriptionRegistrationRequest(request));
}

export function decodePartitionSubscriptionRegistrationRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePartitionSubscriptionRegistrationRequestEffect),
  );
}

export function parsePartitionSubscriptionRegistrationRequest(
  value: unknown,
): PartitionSubscriptionRegistrationRequest {
  return unwrapPartitionRouteValidation(normalizePartitionSubscriptionRegistrationRequest(value));
}

export function parsePartitionSubscriptionRegistrationRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSubscriptionRegistrationRequest, PartitionRouteValidationError> {
  return partitionRouteValidationResultToEffect(
    normalizePartitionSubscriptionRegistrationRequest(value),
  );
}

function normalizePartitionSubscriptionRegistrationRequest(
  value: unknown,
): PartitionRouteValidationResult<PartitionSubscriptionRegistrationRequest> {
  const target = normalizePartitionSubscriptionTargetRequest(value);
  if (!target.success) return target;
  const readSet = requiredReadSet(value, "readSet");
  if (!readSet.success) return readSet;
  return partitionRouteValidationSuccess({
    ...target.value,
    readSet: readSet.value,
  });
}

export async function readPartitionSubscriptionTargetRequest(
  request: Request,
): Promise<PartitionSubscriptionTargetRequest> {
  return runPartitionRouteEffect(decodePartitionSubscriptionTargetRequest(request));
}

export function decodePartitionSubscriptionTargetRequest(
  request: Request,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePartitionSubscriptionTargetRequestEffect),
  );
}

export function parsePartitionSubscriptionTargetRequest(
  value: unknown,
): PartitionSubscriptionTargetRequest {
  return unwrapPartitionRouteValidation(normalizePartitionSubscriptionTargetRequest(value));
}

export function parsePartitionSubscriptionTargetRequestEffect(
  value: unknown,
): Effect.Effect<PartitionSubscriptionTargetRequest, PartitionRouteValidationError> {
  return partitionRouteValidationResultToEffect(normalizePartitionSubscriptionTargetRequest(value));
}

function normalizePartitionSubscriptionTargetRequest(
  value: unknown,
): PartitionRouteValidationResult<PartitionSubscriptionTargetRequest> {
  const connectionName = requiredStringField(value, "connectionName");
  if (!connectionName.success) return connectionName;
  const queryId = requiredIntegerField(value, "queryId");
  if (!queryId.success) return queryId;
  return partitionRouteValidationSuccess({
    connectionName: connectionName.value,
    queryId: queryId.value,
  });
}

export async function readPartitionConnectionUnregisterRequest(
  request: Request,
): Promise<PartitionConnectionUnregisterRequest> {
  return runPartitionRouteEffect(decodePartitionConnectionUnregisterRequest(request));
}

export function decodePartitionConnectionUnregisterRequest(
  request: Request,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parsePartitionConnectionUnregisterRequestEffect),
  );
}

export function parsePartitionConnectionUnregisterRequest(
  value: unknown,
): PartitionConnectionUnregisterRequest {
  return unwrapPartitionRouteValidation(normalizePartitionConnectionUnregisterRequest(value));
}

export function parsePartitionConnectionUnregisterRequestEffect(
  value: unknown,
): Effect.Effect<PartitionConnectionUnregisterRequest, PartitionRouteValidationError> {
  return partitionRouteValidationResultToEffect(normalizePartitionConnectionUnregisterRequest(value));
}

function normalizePartitionConnectionUnregisterRequest(
  value: unknown,
): PartitionRouteValidationResult<PartitionConnectionUnregisterRequest> {
  const connectionName = requiredStringField(value, "connectionName");
  if (!connectionName.success) return connectionName;
  return partitionRouteValidationSuccess({ connectionName: connectionName.value });
}

function requiredStringField(
  value: unknown,
  field: string,
): PartitionRouteValidationResult<string> {
  if (isRecord(value) && typeof value[field] === "string" && value[field].length > 0) {
    return partitionRouteValidationSuccess(value[field]);
  }
  return partitionRouteValidationFailure(`${field} must be a non-empty string.`);
}

function requiredIntegerField(
  value: unknown,
  field: string,
): PartitionRouteValidationResult<number> {
  if (!isRecord(value)) {
    return partitionRouteValidationFailure(`${field} must be an integer.`);
  }
  return integerField(value, field);
}

function integerField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<number> {
  const property = propertyForPath(value, field);
  if (typeof property !== "number" || !Number.isInteger(property)) {
    return partitionRouteValidationFailure(`${field} must be an integer.`);
  }
  return partitionRouteValidationSuccess(property);
}

function requiredReadSet(value: unknown, field: string): PartitionRouteValidationResult<ReadSet> {
  if (!isRecord(value)) {
    return partitionRouteValidationFailure(`${field} must be an object.`);
  }
  return readSetField(value, field);
}

function stringField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRouteValidationFailure(`${field} must be a string.`);
  }
  return partitionRouteValidationSuccess(property);
}

function readSetField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<ReadSet> {
  const candidate = value[field];
  if (!isRecord(candidate)) {
    return partitionRouteValidationFailure(`${field} must be an object.`);
  }
  const documents = candidate.documents === undefined
    ? partitionRouteValidationSuccess(undefined)
    : documentReadsField(candidate, `${field}.documents`);
  if (!documents.success) return documents;
  const tables = candidate.tables === undefined
    ? partitionRouteValidationSuccess(undefined)
    : tableReadsField(candidate, `${field}.tables`);
  if (!tables.success) return tables;
  const indexes = candidate.indexes === undefined
    ? partitionRouteValidationSuccess(undefined)
    : indexReadsField(candidate, `${field}.indexes`);
  if (!indexes.success) return indexes;

  return partitionRouteValidationSuccess({
    ...(documents.value === undefined ? {} : { documents: documents.value }),
    ...(tables.value === undefined ? {} : { tables: tables.value }),
    ...(indexes.value === undefined ? {} : { indexes: indexes.value }),
  });
}

function documentReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<NonNullable<ReadSet["documents"]>> {
  const candidate = value.documents;
  if (!Array.isArray(candidate)) {
    return partitionRouteValidationFailure(`${field} must be an array.`);
  }
  const entries: NonNullable<ReadSet["documents"]> = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRouteValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    const id = nonEmptyStringProperty(entry, `${path}.id`);
    if (!id.success) return id;
    entries.push({
      tableId: tableId.value,
      id: id.value,
    });
  }
  return partitionRouteValidationSuccess(entries);
}

function tableReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<NonNullable<ReadSet["tables"]>> {
  const candidate = value.tables;
  if (!Array.isArray(candidate)) {
    return partitionRouteValidationFailure(`${field} must be an array.`);
  }
  const entries: NonNullable<ReadSet["tables"]> = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRouteValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    entries.push({ tableId: tableId.value });
  }
  return partitionRouteValidationSuccess(entries);
}

function indexReadsField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<NonNullable<ReadSet["indexes"]>> {
  const candidate = value.indexes;
  if (!Array.isArray(candidate)) {
    return partitionRouteValidationFailure(`${field} must be an array.`);
  }
  const entries: NonNullable<ReadSet["indexes"]> = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRouteValidationFailure(`${path} must be an object.`);
    const indexId = integerField(entry, `${path}.indexId`);
    if (!indexId.success) return indexId;
    const lower = entry.lower === undefined
      ? partitionRouteValidationSuccess(undefined)
      : stringProperty(entry, `${path}.lower`);
    if (!lower.success) return lower;
    const upper = entry.upper === undefined
      ? partitionRouteValidationSuccess(undefined)
      : stringProperty(entry, `${path}.upper`);
    if (!upper.success) return upper;
    entries.push({
      indexId: indexId.value,
      ...(lower.value === undefined ? {} : { lower: lower.value }),
      ...(upper.value === undefined ? {} : { upper: upper.value }),
    });
  }
  return partitionRouteValidationSuccess(entries);
}

function writesField(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<DocumentWrite[]> {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    return partitionRouteValidationFailure(`${field} must be an array.`);
  }
  const writes: DocumentWrite[] = [];
  for (const [index, entry] of candidate.entries()) {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) return partitionRouteValidationFailure(`${path} must be an object.`);
    const tableId = integerField(entry, `${path}.tableId`);
    if (!tableId.success) return tableId;
    const id = entry.id === undefined
      ? partitionRouteValidationSuccess(undefined)
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
  return partitionRouteValidationSuccess(writes);
}

function jsonProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<Json | null> {
  const property = propertyForPath(value, field);
  if (!isJson(property)) {
    return partitionRouteValidationFailure(`${field} must be a JSON value.`);
  }
  return partitionRouteValidationSuccess(property as Json);
}

function nonEmptyStringProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string" || property.length === 0) {
    return partitionRouteValidationFailure(`${field} must be a non-empty string.`);
  }
  return partitionRouteValidationSuccess(property);
}

function stringProperty(
  value: Record<string, unknown>,
  field: string,
): PartitionRouteValidationResult<string> {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    return partitionRouteValidationFailure(`${field} must be a string.`);
  }
  return partitionRouteValidationSuccess(property);
}

function propertyForPath(value: Record<string, unknown>, field: string): unknown {
  const propertyName = field.slice(field.lastIndexOf(".") + 1);
  return value[propertyName];
}

type PartitionRouteValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: PartitionRouteValidationError;
    };

function partitionRouteValidationSuccess<A>(value: A): PartitionRouteValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function partitionRouteValidationFailure<A = never>(
  message: string,
): PartitionRouteValidationResult<A> {
  return {
    success: false,
    error: new PartitionRouteValidationError({ message }),
  };
}

function partitionRouteValidationResultToEffect<A>(
  result: PartitionRouteValidationResult<A>,
): Effect.Effect<A, PartitionRouteValidationError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapPartitionRouteValidation<A>(result: PartitionRouteValidationResult<A>): A {
  if (result.success) return result.value;
  throw partitionRouteErrorToHttpError(result.error);
}

function runPartitionRouteEffect<A>(effect: Effect.Effect<A, PartitionRouteError>): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(partitionRouteErrorToHttpError),
  ));
}

export function partitionRouteErrorToHttpError(error: PartitionRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
