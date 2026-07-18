import {
  decodeCatalogIndexId,
  decodeCatalogTableId,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

export function decodeStableLogicalIndexCatalogIndexId(
  deploymentId: string,
  value: unknown,
): CatalogIndexId {
  try {
    return decodeCatalogIndexId(value);
  } catch {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid logical index ID: ${String(value)}`,
    );
  }
}

export function decodeStableLogicalIndexCatalogTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    );
  }
}
