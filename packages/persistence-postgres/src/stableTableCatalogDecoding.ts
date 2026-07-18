import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Result } from "effect";

import { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";

export function decodeStableTableCatalogId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  return Result.getOrThrow(
    decodeStableTableCatalogIdResult(deploymentId, value),
  );
}

export function decodeStableTableCatalogIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, StableTableCatalogCorruptionError> {
  return Result.try({
    try: () => decodeCatalogTableId(value),
    catch: () => new StableTableCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    ),
  });
}
