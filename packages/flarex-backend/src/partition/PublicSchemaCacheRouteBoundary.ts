import {
  parsePartitionSchemaCacheRequest,
  type PartitionSchemaCacheRequest,
} from "./RouteBoundary";
import { readJson } from "../http";
import type { DeploymentSchema } from "../types";

export async function readPublicPartitionSchemaCacheRequest(
  request: Request,
  partitionKey: string,
): Promise<PartitionSchemaCacheRequest> {
  return parsePublicPartitionSchemaCacheRequest(await readJson(request), partitionKey);
}

export function parsePublicPartitionSchemaCacheRequest(
  value: unknown,
  partitionKey: string,
): PartitionSchemaCacheRequest {
  parsePartitionSchemaCacheRequest(value);
  return { partitionKey, schema: value as Partial<DeploymentSchema> };
}
