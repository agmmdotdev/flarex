import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import {
  decodeCatalogTableId,
  decodeCatalogTableNamespace,
  type CatalogTableId,
  type CatalogTableNamespace,
} from "flarex-protocol/catalog";
import { Cause, Effect, Exit, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { reconcileEffectTransactionFailure } from
  "./effectTransactionFailure";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { deployments, fxControlTables } from "./schema";
import {
  decodeStableTableCatalogIdResult as decodeTableIdResult,
} from "./stableTableCatalogDecoding";
import {
  nextStableTableCatalogIdResult,
  readStableTableCatalogHighWaterEffect,
  runStableTableCatalogAllocationQueryEffect,
  StableTableCatalogAllocationPersistenceError,
  StableTableCatalogCorruptionError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";

export {
  StableTableCatalogAllocationPersistenceError,
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
    readonly operation: "getById" | "getByName",
    readonly cause: unknown,
  ) {
    super(`Failed to read stable table identity by ${
      operation === "getById" ? "ID" : "name"
    }.`, { cause });
    this.name = "StableTableIdentityPersistenceError";
  }
}

export type GetStableTableIdentityError =
  | InvalidStableTableIdentityInputError
  | StableTableCatalogCorruptionError
  | StableTableIdentityPersistenceError;

export class StableTableCatalogDeploymentNotFoundError extends Error {
  readonly _tag = "StableTableCatalogDeploymentNotFoundError" as const;

  constructor(readonly deploymentId: string) {
    super(`Cannot allocate a table identity for missing deployment: ${deploymentId}`);
    this.name = "StableTableCatalogDeploymentNotFoundError";
  }
}

export class StableTableCatalogAllocationTransactionError extends Error {
  readonly _tag = "StableTableCatalogAllocationTransactionError" as const;

  constructor(
    readonly cause: unknown,
    readonly callbackCause: Cause.Cause<unknown> | undefined,
  ) {
    super("Stable table catalog allocation transaction failed.", { cause });
    this.name = "StableTableCatalogAllocationTransactionError";
  }
}

export type EnsureStableTableIdentityError =
  | InvalidStableTableIdentityInputError
  | StableTableCatalogAllocationPersistenceError
  | StableTableCatalogAllocationTransactionError
  | StableTableCatalogCorruptionError
  | StableTableCatalogDeploymentNotFoundError
  | StableTableCatalogIdExhaustedError
  | StableTableIdentityPersistenceError;

/**
 * Allocate or replay one deployment-scoped logical table identity.
 *
 * The operation owns a short database transaction. Locking the owning
 * deployment serializes the append-only numeric allocation without holding a
 * transaction open across analyzer or user-code execution.
 */
export const ensureStableTableIdentityEffect = Effect.fn(
  "StableTableCatalog.ensure",
)(function* (
  db: FlarexMetadataDatabase,
  input: EnsureStableTableIdentityInput,
): Effect.fn.Return<
  EnsureStableTableIdentityResult,
  EnsureStableTableIdentityError
> {
  const name = yield* Effect.fromResult(
    decodeEnsureStableTableIdentityInputResult(input),
  );
  return yield* runStableTableCatalogEffectTransaction(
    db,
    (tx) => ensureStableTableIdentityInTransactionEffect(tx, name),
  );
});

export function decodeEnsureStableTableIdentityInputResult(
  input: EnsureStableTableIdentityInput,
): Result.Result<
  StableTableIdentityName,
  InvalidStableTableIdentityInputError
> {
  if (Object.hasOwn(input, "tableId")) {
    return Result.fail(new InvalidStableTableIdentityInputError("tableId"));
  }
  return decodeStableTableIdentityNameResult(input);
}

const ensureStableTableIdentityInTransactionEffect = Effect.fn(
  "StableTableCatalog.ensureInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  name: StableTableIdentityName,
): Effect.fn.Return<
  EnsureStableTableIdentityResult,
  Exclude<
    EnsureStableTableIdentityError,
    InvalidStableTableIdentityInputError
      | StableTableCatalogAllocationTransactionError
  >
> {
  const deploymentQuery = tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, name.deploymentId))
    .limit(1)
    .for("update");
  const deploymentRows = yield* runStableTableCatalogAllocationQueryEffect(
    "lockDeployment",
    deploymentQuery,
  );
  if (deploymentRows[0] === undefined) {
    return yield* Effect.fail(
      new StableTableCatalogDeploymentNotFoundError(name.deploymentId),
    );
  }

  const existing = yield* getStableTableIdentityByValidatedNameEffect(
    tx,
    name,
  );
  if (existing !== null) {
    return { status: "existing", table: existing };
  }

  const latestTableId = yield* readStableTableCatalogHighWaterEffect(
    tx,
    name.deploymentId,
  );
  const tableId = yield* Effect.fromResult(
    nextStableTableCatalogIdResult(name.deploymentId, latestTableId),
  );
  const insertQuery = tx
    .insert(fxControlTables)
    .values({ ...name, tableId })
    .returning();
  const inserted = yield* runStableTableCatalogAllocationQueryEffect(
    "insert",
    insertQuery,
  );
  const row = inserted[0];
  if (row === undefined) {
    return yield* Effect.fail(
      new StableTableCatalogCorruptionError(
        name.deploymentId,
        "insert returned no row",
      ),
    );
  }

  return {
    status: "created",
    table: yield* Effect.fromResult(decodeStableTableIdentityResult(row)),
  } satisfies EnsureStableTableIdentityResult;
});

export const getStableTableIdentityByIdEffect = Effect.fn(
  "StableTableCatalog.getById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: CatalogTableId,
): Effect.fn.Return<
  StableTableIdentity | null,
  GetStableTableIdentityError
> {
  const input = yield* Effect.fromResult(
    decodeStableTableIdentityByIdInputResult(deploymentId, tableId),
  );
  return yield* getStableTableIdentityByValidatedIdEffect(db, input);
});

export const getStableTableIdentityByValidatedIdEffect = Effect.fn(function* (
  db: FlarexMetadataDatabase,
  input: Readonly<{
    deploymentId: string;
    tableId: CatalogTableId;
  }>,
): Effect.fn.Return<
  StableTableIdentity | null,
  StableTableCatalogCorruptionError | StableTableIdentityPersistenceError
> {
  const query = selectStableTableIdentityById(db, input);
  const rows = yield* readStableTableIdentityRowsEffect("getById", query);
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStableTableIdentityResult(row));
});

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

export const getStableTableIdentityByNameEffect = Effect.fn(
  "StableTableCatalog.getByName",
)(function* (
  db: FlarexMetadataDatabase,
  input: StableTableIdentityName,
): Effect.fn.Return<
  StableTableIdentity | null,
  GetStableTableIdentityError
> {
  const name = yield* Effect.fromResult(
    decodeStableTableIdentityNameResult(input),
  );
  return yield* getStableTableIdentityByValidatedNameEffect(db, name);
});

const getStableTableIdentityByValidatedNameEffect = Effect.fn(function* (
  db: FlarexMetadataDatabase,
  name: StableTableIdentityName,
): Effect.fn.Return<
  StableTableIdentity | null,
  StableTableCatalogCorruptionError | StableTableIdentityPersistenceError
> {
  const query = selectStableTableIdentityByName(db, name);
  const rows = yield* readStableTableIdentityRowsEffect("getByName", query);
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStableTableIdentityResult(row));
});

function selectStableTableIdentityByName(
  db: FlarexMetadataDatabase,
  input: StableTableIdentityName,
) {
  return db
    .select()
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, input.deploymentId),
        eq(fxControlTables.namespace, input.namespace),
        eq(fxControlTables.logicalName, input.logicalName),
      ),
    )
    .limit(1);
}

export function decodeStableTableIdentityNameResult(
  input: StableTableIdentityName,
): Result.Result<
  StableTableIdentityName,
  InvalidStableTableIdentityInputError
> {
  return Result.gen(function* () {
    const deploymentId = yield* validateNonBlankResult(
      input.deploymentId,
      "deploymentId",
    );
    const logicalName = yield* validateNonBlankResult(
      input.logicalName,
      "logicalName",
    );
    const namespace = yield* decodeInputNamespaceResult(input.namespace);
    return { deploymentId, namespace, logicalName };
  });
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

function decodeInputNamespaceResult(
  value: unknown,
): Result.Result<
  CatalogTableNamespace,
  InvalidStableTableIdentityInputError
> {
  return Result.try({
    try: () => decodeCatalogTableNamespace(value),
    catch: () => new InvalidStableTableIdentityInputError("namespace"),
  });
}

type StableTableIdentityRow = typeof fxControlTables.$inferSelect;

const readStableTableIdentityRowsEffect = Effect.fn((
  operation: StableTableIdentityPersistenceError["operation"],
  query: PromiseLike<ReadonlyArray<StableTableIdentityRow>>,
): Effect.Effect<
  ReadonlyArray<StableTableIdentityRow>,
  StableTableIdentityPersistenceError
> => Effect.uninterruptible(Effect.tryPromise({
  try: () => query,
  catch: (cause) => new StableTableIdentityPersistenceError(operation, cause),
})));

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

// Keep this driver-callback runner as a plain named boundary so the workspace
// runtime audit attributes its sole Effect.runPromise call exactly here.
function runStableTableCatalogEffectTransaction<ResultValue, Failure>(
  db: FlarexMetadataDatabase,
  work: (
    tx: StableTableCatalogTransaction,
  ) => Effect.Effect<ResultValue, Failure>,
): Effect.Effect<
  ResultValue,
  Failure | StableTableCatalogAllocationTransactionError
> {
  return Effect.suspend(() => {
    let callbackCause: Cause.Cause<Failure> | undefined;
    const rollbackSignal = new Error(
      "Stable table catalog Effect work failed; roll back the transaction.",
    );
    return Effect.uninterruptible(
      Effect.tryPromise({
        try: () => db.transaction(async (tx): Promise<ResultValue> => {
          const exit = await Effect.runPromise(Effect.exit(
            Effect.suspend(() => work(tx)),
          ));
          if (Exit.isFailure(exit)) {
            callbackCause = exit.cause;
            throw rollbackSignal;
          }
          return exit.value;
        }),
        catch: (cause) => new StableTableCatalogAllocationTransactionError(
          cause,
          callbackCause,
        ),
      }).pipe(
        Effect.catch((failure) => reconcileEffectTransactionFailure(
          failure,
          callbackCause,
          rollbackSignal,
        )),
      ),
    );
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
