import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import {
  decodeCatalogIndexId,
  decodeCatalogTableId,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";
import { StableLogicalIndexCatalogCorruptionError } from "./stableLogicalIndexCatalogAllocation";
import {
  decodeStableLogicalIndexCatalogIndexIdResult as decodeStoredIndexIdResult,
  decodeStableLogicalIndexCatalogTableIdResult as decodeStoredTableIdResult,
} from "./stableLogicalIndexCatalogDecoding";

export { StableLogicalIndexCatalogCorruptionError } from "./stableLogicalIndexCatalogAllocation";

export interface StableLogicalIndexIdentityName {
  readonly deploymentId: string;
  readonly tableId: CatalogTableId;
  readonly descriptor: string;
}

export interface StableLogicalIndexIdentity
  extends StableLogicalIndexIdentityName {
  readonly logicalIndexId: CatalogIndexId;
  readonly createdAt: Date;
}

export class InvalidStableLogicalIndexIdentityInputError extends Error {
  readonly _tag = "InvalidStableLogicalIndexIdentityInputError" as const;

  constructor(
    readonly field:
      | "deploymentId"
      | "logicalIndexId"
      | "tableId"
      | "descriptor",
  ) {
    super(`Stable logical index identity ${field} is invalid.`);
    this.name = "InvalidStableLogicalIndexIdentityInputError";
  }
}

export class StableLogicalIndexIdentityPersistenceError extends Error {
  readonly _tag = "StableLogicalIndexIdentityPersistenceError" as const;

  constructor(
    readonly operation: "getById" | "getByName",
    readonly cause: unknown,
  ) {
    super(`Failed to read stable logical index identity by ${
      operation === "getById" ? "ID" : "name"
    }.`, { cause });
    this.name = "StableLogicalIndexIdentityPersistenceError";
  }
}

export type GetStableLogicalIndexIdentityError =
  | InvalidStableLogicalIndexIdentityInputError
  | StableLogicalIndexCatalogCorruptionError
  | StableLogicalIndexIdentityPersistenceError;

export const getStableLogicalIndexIdentityByIdEffect = Effect.fn(
  "StableLogicalIndexCatalog.getById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalIndexId: CatalogIndexId,
): Effect.fn.Return<
  StableLogicalIndexIdentity | null,
  GetStableLogicalIndexIdentityError
> {
  const input = yield* Effect.fromResult(
    decodeIdentityIdInputResult(deploymentId, logicalIndexId),
  );
  const query = db
    .select()
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, input.deploymentId),
        eq(fxControlIndexes.logicalIndexId, input.logicalIndexId),
      ),
    )
    .limit(1);
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new StableLogicalIndexIdentityPersistenceError(
      "getById",
      cause,
    ),
  }));
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStableLogicalIndexIdentityResult(row));
});

export const getStableLogicalIndexIdentityByNameEffect = Effect.fn(
  "StableLogicalIndexCatalog.getByName",
)(function* (
  db: FlarexMetadataDatabase,
  input: StableLogicalIndexIdentityName,
): Effect.fn.Return<
  StableLogicalIndexIdentity | null,
  GetStableLogicalIndexIdentityError
> {
  const name = yield* Effect.fromResult(validateIdentityNameResult(input));
  const query = db
    .select()
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, name.deploymentId),
        eq(fxControlIndexes.tableId, name.tableId),
        eq(fxControlIndexes.descriptor, name.descriptor),
      ),
    )
    .limit(1);
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new StableLogicalIndexIdentityPersistenceError(
      "getByName",
      cause,
    ),
  }));
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStableLogicalIndexIdentityResult(row));
});

function validateIdentityNameResult(
  input: StableLogicalIndexIdentityName,
): Result.Result<
  StableLogicalIndexIdentityName,
  InvalidStableLogicalIndexIdentityInputError
> {
  return Result.gen(function* () {
    const deploymentId = yield* validateNonBlankResult(
      input.deploymentId,
      "deploymentId",
    );
    const descriptor = yield* validateNonBlankResult(
      input.descriptor,
      "descriptor",
    );
    const tableId = yield* decodeInputTableIdResult(input.tableId);
    return { deploymentId, tableId, descriptor };
  });
}

function validateNonBlankResult(
  value: unknown,
  field: "deploymentId" | "descriptor",
): Result.Result<string, InvalidStableLogicalIndexIdentityInputError> {
  if (!isNonBlankString(value)) {
    return Result.fail(new InvalidStableLogicalIndexIdentityInputError(field));
  }
  return Result.succeed(value);
}

function decodeIdentityIdInputResult(
  deploymentId: unknown,
  logicalIndexId: unknown,
): Result.Result<
  { readonly deploymentId: string; readonly logicalIndexId: CatalogIndexId },
  InvalidStableLogicalIndexIdentityInputError
> {
  return Result.gen(function* () {
    return {
      deploymentId: yield* validateNonBlankResult(
        deploymentId,
        "deploymentId",
      ),
      logicalIndexId: yield* decodeInputIndexIdResult(logicalIndexId),
    };
  });
}

function decodeInputIndexIdResult(
  value: unknown,
): Result.Result<CatalogIndexId, InvalidStableLogicalIndexIdentityInputError> {
  return Result.try({
    try: () => decodeCatalogIndexId(value),
    catch: () => new InvalidStableLogicalIndexIdentityInputError(
      "logicalIndexId",
    ),
  });
}

function decodeInputTableIdResult(
  value: unknown,
): Result.Result<CatalogTableId, InvalidStableLogicalIndexIdentityInputError> {
  return Result.try({
    try: () => decodeCatalogTableId(value),
    catch: () => new InvalidStableLogicalIndexIdentityInputError("tableId"),
  });
}

export function decodeStableLogicalIndexIdentityResult(
  row: typeof fxControlIndexes.$inferSelect,
): Result.Result<
  StableLogicalIndexIdentity,
  StableLogicalIndexCatalogCorruptionError
> {
  if (!isNonBlankString(row.deploymentId)) {
    return Result.fail(new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "deployment ID is blank",
    ));
  }
  if (!isNonBlankString(row.descriptor)) {
    return Result.fail(new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "descriptor is blank",
    ));
  }
  const createdAt = copyFiniteDate(row.createdAt);
  if (createdAt === undefined) {
    return Result.fail(new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "created timestamp is invalid",
    ));
  }
  return Result.gen(function* () {
    return {
      deploymentId: row.deploymentId,
      logicalIndexId: yield* decodeStoredIndexIdResult(
        row.deploymentId,
        row.logicalIndexId,
      ),
      tableId: yield* decodeStoredTableIdResult(
        row.deploymentId,
        row.tableId,
      ),
      descriptor: row.descriptor,
      createdAt,
    } satisfies StableLogicalIndexIdentity;
  });
}
