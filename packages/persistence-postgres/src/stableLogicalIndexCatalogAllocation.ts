import { desc, eq } from "drizzle-orm";
import {
  MAX_CATALOG_INDEX_ID,
  type CatalogIndexId,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";
import { decodeStableLogicalIndexCatalogIndexId } from
  "./stableLogicalIndexCatalogDecoding";

export { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

export class StableLogicalIndexCatalogIdExhaustedError extends Error {
  constructor(readonly deploymentId: string) {
    super(
      `Stable logical index identity space is exhausted for deployment: ${deploymentId}`,
    );
    this.name = "StableLogicalIndexCatalogIdExhaustedError";
  }
}

export async function readStableLogicalIndexCatalogHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<CatalogIndexId | null> {
  const rows = await db
    .select({ logicalIndexId: fxControlIndexes.logicalIndexId })
    .from(fxControlIndexes)
    .where(eq(fxControlIndexes.deploymentId, deploymentId))
    .orderBy(desc(fxControlIndexes.logicalIndexId))
    .limit(1);
  const value = rows[0]?.logicalIndexId;
  return value === undefined
    ? null
    : decodeStableLogicalIndexCatalogIndexId(deploymentId, value);
}

export function nextStableLogicalIndexCatalogId(
  deploymentId: string,
  currentHighWater: CatalogIndexId | null,
): CatalogIndexId {
  if (currentHighWater === MAX_CATALOG_INDEX_ID) {
    throw new StableLogicalIndexCatalogIdExhaustedError(deploymentId);
  }
  return decodeStableLogicalIndexCatalogIndexId(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}
