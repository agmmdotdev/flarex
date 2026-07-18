import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";

export function decodeStableTableCatalogId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new StableTableCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    );
  }
}
