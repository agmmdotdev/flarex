import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Result, Schema } from "effect";

import { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

const decodeCatalogIndexIdResult = Schema.decodeUnknownResult(
  CatalogIndexIdSchema,
);
const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  CatalogTableIdSchema,
);

export function decodeStableLogicalIndexCatalogIndexIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogIndexId, StableLogicalIndexCatalogCorruptionError> {
  return decodeCatalogIndexIdResult(value).pipe(
    Result.mapError(() => new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid logical index ID: ${String(value)}`,
    )),
  );
}

export function decodeStableLogicalIndexCatalogTableIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, StableLogicalIndexCatalogCorruptionError> {
  return decodeCatalogTableIdResult(value).pipe(
    Result.mapError(() => new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    )),
  );
}
