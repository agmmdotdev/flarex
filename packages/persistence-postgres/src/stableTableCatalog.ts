import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import {
  decodeCatalogTableId,
  decodeCatalogTableNamespace,
  type CatalogTableId,
  type CatalogTableNamespace,
} from "flarex-protocol/catalog";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { deployments, fxControlTables } from "./schema";
import {
  decodeStableTableCatalogIdResult as decodeTableIdResult,
} from "./stableTableCatalogDecoding";
import {
  nextStableTableCatalogId,
  readStableTableCatalogHighWater,
  StableTableCatalogCorruptionError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";

export {
  StableTableCatalogCorruptionError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";

export interface StableTableIdentityName {
  readonly deploymentId: string;
  readonly namespace: CatalogTableNamespace;
  readonly logicalName: string;
}

export interface StableTableIdentity extends StableTableIdentityName {
  readonly tableId: CatalogTableId;
  readonly createdAt: Date;
}

export interface EnsureStableTableIdentityInput extends StableTableIdentityName {
  readonly tableId?: never;
}

export type EnsureStableTableIdentityResult =
  | {
      readonly status: "created";
      readonly table: StableTableIdentity;
    }
  | {
      readonly status: "existing";
      readonly table: StableTableIdentity;
    };

export type StableTableCatalogTransaction = FlarexMetadataTransaction;

export class InvalidStableTableIdentityInputError extends Error {
  readonly _tag = "InvalidStableTableIdentityInputError" as const;

  constructor(
    readonly field:
      | "deploymentId"
      | "namespace"
      | "logicalName"
      | "tableId",
  ) {
    super(`Stable table identity ${field} is invalid.`);
    this.name = "InvalidStableTableIdentityInputError";
  }
}

export class StableTableIdentityPersistenceError extends Error {
  readonly _tag = "StableTableIdentityPersistenceError" as const;

  constructor(
    readonly operation: "getById",
    readonly cause: unknown,
  ) {
    super("Failed to read stable table identity by ID.", { cause });
    this.name = "StableTableIdentityPersistenceError";
  }
}

export type GetStableTableIdentityByIdError =
  | InvalidStableTableIdentityInputError
  | StableTableCatalogCorruptionError
  | StableTableIdentityPersistenceError;

export class StableTableCatalogDeploymentNotFoundError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Cannot allocate a table identity for missing deployment: ${deploymentId}`);
    this.name = "StableTableCatalogDeploymentNotFoundError";
  }
}

/**
 * Allocate or replay one deployment-scoped logical table identity.
 *
 * The caller must use a short database transaction. Locking the owning
 * deployment serializes the append-only numeric allocation without holding a
 * transaction open across analyzer or user-code execution.
 */
export async function ensureStableTableIdentityInTransaction(
  tx: StableTableCatalogTransaction,
  input: EnsureStableTableIdentityInput,
): Promise<EnsureStableTableIdentityResult> {
  if (Object.hasOwn(input, "tableId")) {
    throw new InvalidStableTableIdentityInputError("tableId");
  }
  const name = validateIdentityName(input);
  const deploymentRows = await tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, name.deploymentId))
    .limit(1)
    .for("update");
  if (deploymentRows[0] === undefined) {
    throw new StableTableCatalogDeploymentNotFoundError(name.deploymentId);
  }

  const existing = await getStableTableIdentityByName(tx, name);
  if (existing !== null) {
    return { status: "existing", table: existing };
  }

  const latestTableId = await readStableTableCatalogHighWater(
    tx,
    name.deploymentId,
  );
  const tableId = nextStableTableCatalogId(name.deploymentId, latestTableId);
  const inserted = await tx
    .insert(fxControlTables)
    .values({ ...name, tableId })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new StableTableCatalogCorruptionError(
      name.deploymentId,
      "insert returned no row",
    );
  }

  return {
    status: "created",
    table: decodeStableTableIdentity(row),
  } satisfies EnsureStableTableIdentityResult;
}

export const getStableTableIdentityByIdEffect = Effect.fn(
  "StableTableCatalog.getById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: CatalogTableId,
): Effect.fn.Return<
  StableTableIdentity | null,
  GetStableTableIdentityByIdError
> {
  const input = yield* Effect.fromResult(
    decodeStableTableIdentityByIdInputResult(deploymentId, tableId),
  );
  const query = selectStableTableIdentityById(db, input);
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new StableTableIdentityPersistenceError(
      "getById",
      cause,
    ),
  }));
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStableTableIdentityResult(row));
});

/**
 * Temporary Promise projection for the current app-index-definition Drizzle
 * transaction callback. Delete it when that transaction chain becomes
 * Effect-native; it is intentionally not exported from the package root.
 */
export async function getStableTableIdentityByIdForPromiseTransaction(
  db: StableTableCatalogTransaction,
  deploymentId: string,
  tableId: CatalogTableId,
): Promise<StableTableIdentity | null> {
  const input = Result.getOrThrow(
    decodeStableTableIdentityByIdInputResult(deploymentId, tableId),
  );
  const rows = await selectStableTableIdentityById(db, input);
  const row = rows[0];
  return row === undefined
    ? null
    : Result.getOrThrow(decodeStableTableIdentityResult(row));
}

function selectStableTableIdentityById(
  db: FlarexMetadataDatabase,
  input: Readonly<{
    deploymentId: string;
    tableId: CatalogTableId;
  }>,
) {
  return db
    .select()
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, input.deploymentId),
        eq(fxControlTables.tableId, input.tableId),
      ),
    )
    .limit(1);
}

export async function getStableTableIdentityByName(
  db: FlarexMetadataDatabase,
  input: StableTableIdentityName,
): Promise<StableTableIdentity | null> {
  const name = validateIdentityName(input);
  const rows = await db
    .select()
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, name.deploymentId),
        eq(fxControlTables.namespace, name.namespace),
        eq(fxControlTables.logicalName, name.logicalName),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStableTableIdentity(row);
}

function validateIdentityName(
  input: StableTableIdentityName,
): StableTableIdentityName {
  validateNonBlank(input.deploymentId, "deploymentId");
  validateNonBlank(input.logicalName, "logicalName");
  let namespace: CatalogTableNamespace;
  try {
    namespace = decodeCatalogTableNamespace(input.namespace);
  } catch {
    throw new InvalidStableTableIdentityInputError("namespace");
  }
  return {
    deploymentId: input.deploymentId,
    namespace,
    logicalName: input.logicalName,
  } satisfies StableTableIdentityName;
}

function validateNonBlank(
  value: string,
  field: "deploymentId" | "logicalName",
): void {
  Result.getOrThrow(validateNonBlankResult(value, field));
}

function validateNonBlankResult(
  value: unknown,
  field: "deploymentId" | "logicalName",
): Result.Result<string, InvalidStableTableIdentityInputError> {
  if (!isNonBlankString(value)) {
    return Result.fail(new InvalidStableTableIdentityInputError(field));
  }
  return Result.succeed(value);
}

export function decodeStableTableIdentityByIdInputResult(
  deploymentId: unknown,
  tableId: unknown,
): Result.Result<
  { readonly deploymentId: string; readonly tableId: CatalogTableId },
  InvalidStableTableIdentityInputError
> {
  return Result.gen(function* () {
    return {
      deploymentId: yield* validateNonBlankResult(
        deploymentId,
        "deploymentId",
      ),
      tableId: yield* decodeInputTableIdResult(tableId),
    };
  });
}

function decodeInputTableIdResult(
  value: unknown,
): Result.Result<CatalogTableId, InvalidStableTableIdentityInputError> {
  return Result.try({
    try: () => decodeCatalogTableId(value),
    catch: () => new InvalidStableTableIdentityInputError("tableId"),
  });
}

function decodeStableTableIdentity(
  row: typeof fxControlTables.$inferSelect,
): StableTableIdentity {
  return Result.getOrThrow(decodeStableTableIdentityResult(row));
}

export function decodeStableTableIdentityResult(
  row: typeof fxControlTables.$inferSelect,
): Result.Result<StableTableIdentity, StableTableCatalogCorruptionError> {
  return Result.gen(function* () {
    const namespace = yield* decodeStoredNamespaceResult(row);
    if (!isNonBlankString(row.deploymentId)) {
      return yield* Result.fail(new StableTableCatalogCorruptionError(
        row.deploymentId,
        "deployment ID is blank",
      ));
    }
    if (!isNonBlankString(row.logicalName)) {
      return yield* Result.fail(new StableTableCatalogCorruptionError(
        row.deploymentId,
        "logical name is blank",
      ));
    }
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) {
      return yield* Result.fail(new StableTableCatalogCorruptionError(
        row.deploymentId,
        "created timestamp is invalid",
      ));
    }
    const tableId = yield* decodeTableIdResult(
      row.deploymentId,
      row.tableId,
    );
    return {
      deploymentId: row.deploymentId,
      tableId,
      namespace,
      logicalName: row.logicalName,
      createdAt,
    } satisfies StableTableIdentity;
  });
}

function decodeStoredNamespaceResult(
  row: typeof fxControlTables.$inferSelect,
): Result.Result<CatalogTableNamespace, StableTableCatalogCorruptionError> {
  return Result.try({
    try: () => decodeCatalogTableNamespace(row.namespace),
    catch: () => new StableTableCatalogCorruptionError(
      row.deploymentId,
      `invalid namespace: ${String(row.namespace)}`,
    ),
  });
}
