import { desc, eq } from "drizzle-orm";
import {
  decodeCatalogIndexId,
  MAX_CATALOG_INDEX_ID,
  type CatalogIndexId,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";

export class StableLogicalIndexCatalogIdExhaustedError extends Error {
  constructor(readonly deploymentId: string) {
    super(
      `Stable logical index identity space is exhausted for deployment: ${deploymentId}`,
    );
    this.name = "StableLogicalIndexCatalogIdExhaustedError";
  }
}

export class StableLogicalIndexCatalogCorruptionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Stable logical index catalog is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "StableLogicalIndexCatalogCorruptionError";
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
    : decodeStableLogicalIndexCatalogId(deploymentId, value);
}

export function nextStableLogicalIndexCatalogId(
  deploymentId: string,
  currentHighWater: CatalogIndexId | null,
): CatalogIndexId {
  if (currentHighWater === MAX_CATALOG_INDEX_ID) {
    throw new StableLogicalIndexCatalogIdExhaustedError(deploymentId);
  }
  return decodeStableLogicalIndexCatalogId(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}

function decodeStableLogicalIndexCatalogId(
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
