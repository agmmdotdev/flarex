import { desc, eq } from "drizzle-orm";
import {
  MAX_CATALOG_TABLE_ID,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlTables } from "./schema";
import { decodeStableTableCatalogId } from "./stableTableCatalogDecoding";

export { StableTableCatalogCorruptionError } from "./stableTableCatalogError";

export class StableTableCatalogIdExhaustedError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Stable table identity space is exhausted for deployment: ${deploymentId}`);
    this.name = "StableTableCatalogIdExhaustedError";
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
