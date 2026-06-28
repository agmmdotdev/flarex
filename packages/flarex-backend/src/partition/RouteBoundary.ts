import { HttpError, readJson } from "../http";
import { isJson } from "flarex-protocol/json";
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

export async function readPartitionSchemaCacheRequest(
  request: Request,
): Promise<PartitionSchemaCacheRequest> {
  return parsePartitionSchemaCacheRequest(await readJson(request));
}

export function parsePartitionSchemaCacheRequest(
  value: unknown,
): PartitionSchemaCacheRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "schema-cache request body must be an object.");
  }
  return value as PartitionSchemaCacheRequest;
}

export async function readPartitionCommitRequest(
  request: Request,
): Promise<PartitionCommitRequest> {
  return parsePartitionCommitRequest(await readJson(request));
}

export function parsePartitionCommitRequest(value: unknown): PartitionCommitRequest {
  if (!isRecord(value)) {
    throw new HttpError(400, "commit request body must be an object.");
  }
  return {
    beginTs: requiredIntegerField(value, "beginTs"),
    ...(value.schemaVersion === undefined
      ? {}
      : { schemaVersion: integerField(value, "schemaVersion") }),
    ...(value.source === undefined
      ? {}
      : { source: stringField(value, "source") }),
    ...(value.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: stringField(value, "idempotencyKey") }),
    ...(value.readSet === undefined
      ? {}
      : { readSet: readSetField(value, "readSet") }),
    writes: writesField(value, "writes"),
  };
}

export async function readPartitionSubscriptionRegistrationRequest(
  request: Request,
): Promise<PartitionSubscriptionRegistrationRequest> {
  return parsePartitionSubscriptionRegistrationRequest(await readJson(request));
}

export function parsePartitionSubscriptionRegistrationRequest(
  value: unknown,
): PartitionSubscriptionRegistrationRequest {
  return {
    ...parsePartitionSubscriptionTargetRequest(value),
    readSet: requiredReadSet(value, "readSet"),
  };
}

export async function readPartitionSubscriptionTargetRequest(
  request: Request,
): Promise<PartitionSubscriptionTargetRequest> {
  return parsePartitionSubscriptionTargetRequest(await readJson(request));
}

export function parsePartitionSubscriptionTargetRequest(
  value: unknown,
): PartitionSubscriptionTargetRequest {
  return {
    connectionName: requiredStringField(value, "connectionName"),
    queryId: requiredIntegerField(value, "queryId"),
  };
}

export async function readPartitionConnectionUnregisterRequest(
  request: Request,
): Promise<PartitionConnectionUnregisterRequest> {
  return parsePartitionConnectionUnregisterRequest(await readJson(request));
}

export function parsePartitionConnectionUnregisterRequest(
  value: unknown,
): PartitionConnectionUnregisterRequest {
  return {
    connectionName: requiredStringField(value, "connectionName"),
  };
}

function requiredStringField(value: unknown, field: string): string {
  if (!isRecord(value) || typeof value[field] !== "string" || value[field].length === 0) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }
  return value[field];
}

function requiredIntegerField(value: unknown, field: string): number {
  if (!isRecord(value)) {
    throw new HttpError(400, `${field} must be an integer.`);
  }
  return integerField(value, field);
}

function integerField(value: Record<string, unknown>, field: string): number {
  const property = propertyForPath(value, field);
  if (typeof property !== "number" || !Number.isInteger(property)) {
    throw new HttpError(400, `${field} must be an integer.`);
  }
  return property;
}

function requiredReadSet(value: unknown, field: string): ReadSet {
  if (!isRecord(value)) {
    throw new HttpError(400, `${field} must be an object.`);
  }
  return readSetField(value, field);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    throw new HttpError(400, `${field} must be a string.`);
  }
  return property;
}

function readSetField(value: Record<string, unknown>, field: string): ReadSet {
  const candidate = value[field];
  if (!isRecord(candidate)) {
    throw new HttpError(400, `${field} must be an object.`);
  }
  return {
    ...(candidate.documents === undefined
      ? {}
      : { documents: documentReadsField(candidate, `${field}.documents`) }),
    ...(candidate.tables === undefined
      ? {}
      : { tables: tableReadsField(candidate, `${field}.tables`) }),
    ...(candidate.indexes === undefined
      ? {}
      : { indexes: indexReadsField(candidate, `${field}.indexes`) }),
  };
}

function documentReadsField(
  value: Record<string, unknown>,
  field: string,
): NonNullable<ReadSet["documents"]> {
  const candidate = value.documents;
  if (!Array.isArray(candidate)) {
    throw new HttpError(400, `${field} must be an array.`);
  }
  return candidate.map((entry, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) throw new HttpError(400, `${path} must be an object.`);
    return {
      tableId: integerField(entry, `${path}.tableId`),
      id: nonEmptyStringProperty(entry, `${path}.id`),
    };
  });
}

function tableReadsField(
  value: Record<string, unknown>,
  field: string,
): NonNullable<ReadSet["tables"]> {
  const candidate = value.tables;
  if (!Array.isArray(candidate)) {
    throw new HttpError(400, `${field} must be an array.`);
  }
  return candidate.map((entry, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) throw new HttpError(400, `${path} must be an object.`);
    return { tableId: integerField(entry, `${path}.tableId`) };
  });
}

function indexReadsField(
  value: Record<string, unknown>,
  field: string,
): NonNullable<ReadSet["indexes"]> {
  const candidate = value.indexes;
  if (!Array.isArray(candidate)) {
    throw new HttpError(400, `${field} must be an array.`);
  }
  return candidate.map((entry, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) throw new HttpError(400, `${path} must be an object.`);
    return {
      indexId: integerField(entry, `${path}.indexId`),
      ...(entry.lower === undefined ? {} : { lower: stringProperty(entry, `${path}.lower`) }),
      ...(entry.upper === undefined ? {} : { upper: stringProperty(entry, `${path}.upper`) }),
    };
  });
}

function writesField(value: Record<string, unknown>, field: string): DocumentWrite[] {
  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    throw new HttpError(400, `${field} must be an array.`);
  }
  return candidate.map((entry, index) => {
    const path = `${field}[${index}]`;
    if (!isRecord(entry)) throw new HttpError(400, `${path} must be an object.`);
    return {
      tableId: integerField(entry, `${path}.tableId`),
      ...(entry.id === undefined ? {} : { id: nonEmptyStringProperty(entry, `${path}.id`) }),
      value: jsonProperty(entry, `${path}.value`),
    };
  });
}

function jsonProperty(value: Record<string, unknown>, field: string): Json | null {
  const property = propertyForPath(value, field);
  if (!isJson(property)) {
    throw new HttpError(400, `${field} must be a JSON value.`);
  }
  return property as Json;
}

function nonEmptyStringProperty(value: Record<string, unknown>, field: string): string {
  const property = propertyForPath(value, field);
  if (typeof property !== "string" || property.length === 0) {
    throw new HttpError(400, `${field} must be a non-empty string.`);
  }
  return property;
}

function stringProperty(value: Record<string, unknown>, field: string): string {
  const property = propertyForPath(value, field);
  if (typeof property !== "string") {
    throw new HttpError(400, `${field} must be a string.`);
  }
  return property;
}

function propertyForPath(value: Record<string, unknown>, field: string): unknown {
  const propertyName = field.slice(field.lastIndexOf(".") + 1);
  return value[propertyName];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
