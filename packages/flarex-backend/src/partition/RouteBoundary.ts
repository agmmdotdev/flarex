import { HttpError, readJson } from "../http";
import type { DeploymentSchema } from "../types";

export type PartitionSchemaCacheRequest = Partial<DeploymentSchema> & {
  partitionKey?: string;
  schema?: Partial<DeploymentSchema>;
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
