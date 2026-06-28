import { HttpError, readJson } from "../http";
import type { DeploymentSchema, ReadSet } from "../types";

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
  if (!isRecord(value) || typeof value[field] !== "number" || !Number.isInteger(value[field])) {
    throw new HttpError(400, `${field} must be an integer.`);
  }
  return value[field];
}

function requiredReadSet(value: unknown, field: string): ReadSet {
  if (!isRecord(value) || !isRecord(value[field])) {
    throw new HttpError(400, `${field} must be an object.`);
  }
  return value[field] as ReadSet;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
