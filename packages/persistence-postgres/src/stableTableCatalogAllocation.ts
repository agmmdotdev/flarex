import { desc, eq } from "drizzle-orm";
import {
  MAX_CATALOG_TABLE_ID,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlTables } from "./schema";
import {
  decodeStableTableCatalogIdResult,
} from "./stableTableCatalogDecoding";
import { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";

export { StableTableCatalogCorruptionError };

export class StableTableCatalogIdExhaustedError extends Error {
  readonly _tag = "StableTableCatalogIdExhaustedError" as const;

  constructor(readonly deploymentId: string) {
    super(`Stable table identity space is exhausted for deployment: ${deploymentId}`);
    this.name = "StableTableCatalogIdExhaustedError";
  }
}

export class StableTableCatalogAllocationPersistenceError extends Error {
  readonly _tag = "StableTableCatalogAllocationPersistenceError" as const;

  constructor(
    readonly operation: "lockDeployment" | "readHighWater" | "insert",
    readonly cause: unknown,
  ) {
    super(`Stable table catalog allocation ${operation} failed.`, { cause });
    this.name = "StableTableCatalogAllocationPersistenceError";
  }
}

export const runStableTableCatalogAllocationQueryEffect = Effect.fn(<A>(
  operation: StableTableCatalogAllocationPersistenceError["operation"],
  query: PromiseLike<A>,
): Effect.Effect<A, StableTableCatalogAllocationPersistenceError> =>
  Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new StableTableCatalogAllocationPersistenceError(
      operation,
      cause,
    ),
  })));

export const readStableTableCatalogHighWaterEffect = Effect.fn(
  "StableTableCatalog.readHighWater",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Effect.fn.Return<
  CatalogTableId | null,
  StableTableCatalogAllocationPersistenceError | StableTableCatalogCorruptionError
> {
  const query = selectStableTableCatalogHighWater(db, deploymentId);
  const rows = yield* runStableTableCatalogAllocationQueryEffect(
    "readHighWater",
    query,
  );
  const value = rows[0]?.tableId;
  return value === undefined
    ? null
    : yield* Effect.fromResult(
      decodeStableTableCatalogIdResult(deploymentId, value),
    );
});

function selectStableTableCatalogHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
) {
  return db
    .select({ tableId: fxControlTables.tableId })
    .from(fxControlTables)
    .where(eq(fxControlTables.deploymentId, deploymentId))
    .orderBy(desc(fxControlTables.tableId))
    .limit(1);
}

export function nextStableTableCatalogIdResult(
  deploymentId: string,
  currentHighWater: CatalogTableId | null,
): Result.Result<
  CatalogTableId,
  StableTableCatalogCorruptionError | StableTableCatalogIdExhaustedError
> {
  if (currentHighWater === MAX_CATALOG_TABLE_ID) {
    return Result.fail(new StableTableCatalogIdExhaustedError(deploymentId));
  }
  return decodeStableTableCatalogIdResult(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}
