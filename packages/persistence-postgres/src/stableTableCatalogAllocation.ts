import { desc, eq } from "drizzle-orm";
import {
  decodeCatalogTableId,
  MAX_CATALOG_TABLE_ID,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlTables } from "./schema";

export class StableTableCatalogIdExhaustedError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Stable table identity space is exhausted for deployment: ${deploymentId}`);
    this.name = "StableTableCatalogIdExhaustedError";
  }
}

export class StableTableCatalogCorruptionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly detail: string,
  ) {
    super(`Stable table catalog is corrupt for ${deploymentId}: ${detail}`);
    this.name = "StableTableCatalogCorruptionError";
  }
}

export async function readStableTableCatalogHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<CatalogTableId | null> {
  const rows = await db
    .select({ tableId: fxControlTables.tableId })
    .from(fxControlTables)
    .where(eq(fxControlTables.deploymentId, deploymentId))
    .orderBy(desc(fxControlTables.tableId))
    .limit(1);
  const value = rows[0]?.tableId;
  return value === undefined
    ? null
    : decodeStableTableCatalogId(deploymentId, value);
}

export function nextStableTableCatalogId(
  deploymentId: string,
  currentHighWater: CatalogTableId | null,
): CatalogTableId {
  if (currentHighWater === MAX_CATALOG_TABLE_ID) {
    throw new StableTableCatalogIdExhaustedError(deploymentId);
  }
  return decodeStableTableCatalogId(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}

function decodeStableTableCatalogId(
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
