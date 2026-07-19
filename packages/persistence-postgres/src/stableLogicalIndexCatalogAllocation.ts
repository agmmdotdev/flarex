import { desc, eq } from "drizzle-orm";
import {
  MAX_CATALOG_INDEX_ID,
  type CatalogIndexId,
} from "flarex-protocol/catalog";
import { Effect } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";
import {
  decodeStableLogicalIndexCatalogIndexId,
  decodeStableLogicalIndexCatalogIndexIdResult,
} from
  "./stableLogicalIndexCatalogDecoding";
import { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

export { StableLogicalIndexCatalogCorruptionError } from
  "./stableLogicalIndexCatalogError";

export class StableLogicalIndexCatalogIdExhaustedError extends Error {
  readonly _tag = "StableLogicalIndexCatalogIdExhaustedError" as const;

  constructor(readonly deploymentId: string) {
    super(
      `Stable logical index identity space is exhausted for deployment: ${deploymentId}`,
    );
    this.name = "StableLogicalIndexCatalogIdExhaustedError";
  }
}

export class StableLogicalIndexCatalogAllocationPersistenceError extends Error {
  readonly _tag =
    "StableLogicalIndexCatalogAllocationPersistenceError" as const;

  constructor(
    readonly operation: "readHighWater",
    readonly cause: unknown,
  ) {
    super("Stable logical-index catalog high-water read failed.", { cause });
    this.name = "StableLogicalIndexCatalogAllocationPersistenceError";
  }
}

export const readStableLogicalIndexCatalogHighWaterEffect = Effect.fn(
  "StableLogicalIndexCatalog.readHighWater",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Effect.fn.Return<
  CatalogIndexId | null,
  | StableLogicalIndexCatalogAllocationPersistenceError
  | StableLogicalIndexCatalogCorruptionError
> {
  const query = selectStableLogicalIndexCatalogHighWater(db, deploymentId);
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) =>
      new StableLogicalIndexCatalogAllocationPersistenceError(
        "readHighWater",
        cause,
      ),
  }));
  const value = rows[0]?.logicalIndexId;
  return value === undefined
    ? null
    : yield* Effect.fromResult(
      decodeStableLogicalIndexCatalogIndexIdResult(deploymentId, value),
    );
});

/** Promise compatibility boundary for the D2a preparation chain. */
export async function readStableLogicalIndexCatalogHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<CatalogIndexId | null> {
  const rows = await selectStableLogicalIndexCatalogHighWater(db, deploymentId);
  const value = rows[0]?.logicalIndexId;
  return value === undefined
    ? null
    : decodeStableLogicalIndexCatalogIndexId(deploymentId, value);
}

function selectStableLogicalIndexCatalogHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
) {
  return db
    .select({ logicalIndexId: fxControlIndexes.logicalIndexId })
    .from(fxControlIndexes)
    .where(eq(fxControlIndexes.deploymentId, deploymentId))
    .orderBy(desc(fxControlIndexes.logicalIndexId))
    .limit(1);
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
