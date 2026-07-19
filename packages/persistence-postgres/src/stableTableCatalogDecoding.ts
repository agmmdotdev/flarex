import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Result, Schema } from "effect";

import { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";

const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  CatalogTableIdSchema,
);

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
  return decodeCatalogTableIdResult(value).pipe(
    Result.mapError(() => new StableTableCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    )),
  );
}
