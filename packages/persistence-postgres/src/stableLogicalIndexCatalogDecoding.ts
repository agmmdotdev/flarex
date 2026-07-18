import {
  decodeCatalogIndexId,
  decodeCatalogTableId,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Result } from "effect";

import { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

export function decodeStableLogicalIndexCatalogIndexId(
  deploymentId: string,
  value: unknown,
): CatalogIndexId {
  return Result.getOrThrow(
    decodeStableLogicalIndexCatalogIndexIdResult(deploymentId, value),
  );
}

export function decodeStableLogicalIndexCatalogIndexIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogIndexId, StableLogicalIndexCatalogCorruptionError> {
  return Result.try({
    try: () => decodeCatalogIndexId(value),
    catch: () => new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid logical index ID: ${String(value)}`,
    ),
  });
}

export function decodeStableLogicalIndexCatalogTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  return Result.getOrThrow(
    decodeStableLogicalIndexCatalogTableIdResult(deploymentId, value),
  );
}

export function decodeStableLogicalIndexCatalogTableIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, StableLogicalIndexCatalogCorruptionError> {
  return Result.try({
    try: () => decodeCatalogTableId(value),
    catch: () => new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    ),
  });
}
