import { desc, eq } from "drizzle-orm";
import {
  MAX_CATALOG_INDEX_ID,
  type CatalogIndexId,
} from "flarex-protocol/catalog";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";
import {
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

export function nextStableLogicalIndexCatalogIdResult(
  deploymentId: string,
  currentHighWater: CatalogIndexId | null,
): Result.Result<
  CatalogIndexId,
  StableLogicalIndexCatalogIdExhaustedError
  | StableLogicalIndexCatalogCorruptionError
> {
  if (currentHighWater === MAX_CATALOG_INDEX_ID) {
    return Result.fail(
      new StableLogicalIndexCatalogIdExhaustedError(deploymentId),
    );
  }
  return decodeStableLogicalIndexCatalogIndexIdResult(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}
