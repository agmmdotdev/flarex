import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray } from "drizzle-orm";
import type {
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import {
  decodeSchemaManifestAppIndexDeclarationsV1,
  decodeSchemaManifestAppSchemaV1,
  decodeSchemaManifestAppTableDeclarationsV1,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppIndexFieldPath,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  getPreparedSchemaManifestAppTableBindingsState,
  insertPlannedSchemaManifestAppTableBindingsEffect,
  lockSchemaManifestBindingDeploymentEffect,
  prepareSchemaManifestAppTableBindingsV1,
  readSchemaManifestAppTableBindingsEffect,
  type PlannedAppTableBinding,
  type PreparedSchemaManifestAppTableBindingsState,
  type SchemaManifestTableBindingCorruptionError,
  type SchemaManifestTableBindingPersistenceError,
} from "./schemaManifestTableBindings";
import { fxControlIndexes } from "./schema";
import {
  nextStableLogicalIndexCatalogId,
  readStableLogicalIndexCatalogHighWater,
  readStableLogicalIndexCatalogHighWaterEffect,
  type StableLogicalIndexCatalogAllocationPersistenceError,
  StableLogicalIndexCatalogCorruptionError,
} from "./stableLogicalIndexCatalogAllocation";
import {
  decodeStableLogicalIndexCatalogIndexIdResult as decodeStoredIndexIdResult,
  decodeStableLogicalIndexCatalogTableIdResult as decodeStoredTableIdResult,
} from "./stableLogicalIndexCatalogDecoding";
import {
  StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
} from "./stableTableCatalog";
import {
  readStableTableCatalogHighWaterEffect,
  type StableTableCatalogAllocationPersistenceError,
} from "./stableTableCatalogAllocation";
import type { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";

export interface PrepareSchemaManifestAppSchemaBindingsV1Input {
  readonly deploymentId: string;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationInputV1>;
}

const preparedBindingsBrand: unique symbol = Symbol(
  "FlarexDB/PreparedSchemaManifestAppSchemaBindingsV1",
);

export interface PreparedSchemaManifestAppSchemaBindingsV1 {
  readonly deploymentId: string;
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly [preparedBindingsBrand]: true;
}

export type InvalidSchemaManifestAppSchemaBindingInputIssue =
  | { readonly reason: "invalidDeploymentId" }
  | { readonly reason: "invalidTables" }
  | { readonly reason: "invalidIndexes" }
  | {
      readonly reason: "undeclaredIndexTable";
      readonly tableLogicalName: SchemaManifestAppTableName;
      readonly descriptor: SchemaManifestAppIndexDescriptor;
    };

export class InvalidSchemaManifestAppSchemaBindingInputError extends Error {
  constructor(
    readonly issue: InvalidSchemaManifestAppSchemaBindingInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidSchemaManifestAppSchemaBindingInputError";
  }
}

export class InvalidPreparedSchemaManifestAppSchemaBindingsError extends Error {
  readonly _tag =
    "InvalidPreparedSchemaManifestAppSchemaBindingsError" as const;

  constructor() {
    super(
      "Schema manifest app-schema bindings were not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedSchemaManifestAppSchemaBindingsError";
  }
}

export type SchemaManifestAppSchemaBindingIdentity =
  | {
      readonly kind: "table";
      readonly logicalName: SchemaManifestAppTableName;
      readonly tableId: CatalogTableId;
    }
  | {
      readonly kind: "index";
      readonly tableId: CatalogTableId;
      readonly descriptor: SchemaManifestAppIndexDescriptor;
      readonly logicalIndexId: CatalogIndexId;
    };

export type SchemaManifestAppSchemaBindingPlanStale =
  | {
      readonly reason: "tableBindingChanged";
      readonly logicalName: SchemaManifestAppTableName;
      readonly plannedTableId: CatalogTableId;
      readonly currentTableId: CatalogTableId | null;
    }
  | {
      readonly reason: "indexBindingChanged";
      readonly tableId: CatalogTableId;
      readonly descriptor: SchemaManifestAppIndexDescriptor;
      readonly plannedLogicalIndexId: CatalogIndexId;
      readonly currentLogicalIndexId: CatalogIndexId | null;
    }
  | {
      readonly reason: "tableCatalogHighWaterChanged";
      readonly observedTableId: CatalogTableId | null;
      readonly currentTableId: CatalogTableId | null;
    }
  | {
      readonly reason: "indexCatalogHighWaterChanged";
      readonly observedLogicalIndexId: CatalogIndexId | null;
      readonly currentLogicalIndexId: CatalogIndexId | null;
    }
  | {
      readonly reason: "partiallyApplied";
      readonly applied: ReadonlyArray<SchemaManifestAppSchemaBindingIdentity>;
      readonly missing: ReadonlyArray<SchemaManifestAppSchemaBindingIdentity>;
    };

export class SchemaManifestAppSchemaBindingPlanStaleError extends Error {
  readonly _tag = "SchemaManifestAppSchemaBindingPlanStaleError" as const;

  constructor(readonly stale: SchemaManifestAppSchemaBindingPlanStale) {
    super(stalePlanMessage(stale));
    this.name = "SchemaManifestAppSchemaBindingPlanStaleError";
  }
}

export class SchemaManifestAppSchemaBindingPersistenceError extends Error {
  readonly _tag = "SchemaManifestAppSchemaBindingPersistenceError" as const;

  constructor(
    readonly operation: "readIndexBindings" | "insertIndexBindings",
    readonly cause: unknown,
  ) {
    super(`Schema-manifest app-schema binding ${operation} failed.`, { cause });
    this.name = "SchemaManifestAppSchemaBindingPersistenceError";
  }
}

export type ApplySchemaManifestAppSchemaBindingsV1Error =
  | InvalidPreparedSchemaManifestAppSchemaBindingsError
  | SchemaManifestAppSchemaBindingPlanStaleError
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
  | SchemaManifestTableBindingCorruptionError
  | StableTableCatalogAllocationPersistenceError
  | StableTableCatalogCorruptionError
  | SchemaManifestAppSchemaBindingPersistenceError
  | StableLogicalIndexCatalogAllocationPersistenceError
  | StableLogicalIndexCatalogCorruptionError;

interface ResolvedAppIndexDeclaration {
  readonly tableId: CatalogTableId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly fields: ReadonlyArray<SchemaManifestAppIndexFieldPath>;
}

interface PlannedAppIndexBinding extends ResolvedAppIndexDeclaration {
  readonly logicalIndexId: CatalogIndexId;
  readonly wasMissing: boolean;
}

interface PreparedSchemaManifestAppSchemaBindingsState {
  readonly deploymentId: string;
  readonly tableState: PreparedSchemaManifestAppTableBindingsState;
  readonly observedIndexHighWater: CatalogIndexId | null;
  readonly indexes: ReadonlyArray<PlannedAppIndexBinding>;
  readonly manifest: SchemaManifestAppSchemaV1;
}

const preparedBindingStates = new WeakMap<
  PreparedSchemaManifestAppSchemaBindingsV1,
  PreparedSchemaManifestAppSchemaBindingsState
>();

function getPreparedSchemaManifestAppSchemaBindingsStateResult(
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Result.Result<
  PreparedSchemaManifestAppSchemaBindingsState,
  InvalidPreparedSchemaManifestAppSchemaBindingsError
> {
  const state = preparedBindingStates.get(prepared);
  return state === undefined
    ? Result.fail(new InvalidPreparedSchemaManifestAppSchemaBindingsError())
    : Result.succeed(state);
}

/**
 * Prepare stable table and logical-index candidates without taking a SQL lock.
 *
 * The token is repository-authenticated and cannot be split into independently
 * consumable table/index reservations. Physical definitions and build state are
 * deliberately outside this logical catalog checkpoint.
 */
export async function prepareSchemaManifestAppSchemaBindingsV1(
  db: FlarexMetadataDatabase,
  input: PrepareSchemaManifestAppSchemaBindingsV1Input,
): Promise<PreparedSchemaManifestAppSchemaBindingsV1> {
  const deploymentId = validateDeploymentId(input.deploymentId);
  const tables = decodeTables(input.tables);
  const indexes = decodeIndexes(input.indexes);
  validateIndexTableReferences(tables, indexes);

  const tablePlan = await prepareSchemaManifestAppTableBindingsV1(db, {
    deploymentId,
    tables,
  });
  const tableState = getPreparedSchemaManifestAppTableBindingsState(tablePlan);
  const resolvedIndexes = resolveAndSortIndexes(tableState, indexes);
  const observedBindings = await readAppIndexBindings(
    db,
    deploymentId,
    resolvedIndexes,
  );
  const observedIndexHighWater =
    await readStableLogicalIndexCatalogHighWater(db, deploymentId);
  const plannedIndexes = planIndexBindings(
    deploymentId,
    resolvedIndexes,
    observedBindings,
    observedIndexHighWater,
  );
  const manifest = snapshotSchemaManifestValue(
    assembleManifest(deploymentId, tableState, plannedIndexes),
  );
  const prepared = Object.freeze({
    deploymentId,
    manifest,
    [preparedBindingsBrand]: true,
  } satisfies PreparedSchemaManifestAppSchemaBindingsV1);
  preparedBindingStates.set(prepared, {
    deploymentId,
    tableState,
    observedIndexHighWater,
    indexes: plannedIndexes,
    manifest,
  });
  return prepared;
}

/**
 * Revalidate and apply one combined plan inside a caller-owned transaction.
 *
 * Partial application is classified across both catalogs before insertion, so
 * a separately published table mapping cannot be mistaken for an atomic replay
 * of its still-missing logical indexes. This helper never commits.
 */
export const applySchemaManifestAppSchemaBindingsV1InTransactionEffect =
Effect.fn(
  "SchemaManifestAppSchemaBindings.applyInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Effect.fn.Return<
  SchemaManifestAppSchemaV1,
  ApplySchemaManifestAppSchemaBindingsV1Error
> {
  const state = yield* Effect.fromResult(
    getPreparedSchemaManifestAppSchemaBindingsStateResult(prepared),
  );

  yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
  const currentTables = yield* readSchemaManifestAppTableBindingsEffect(
    tx,
    state.deploymentId,
    state.tableState.tables.map((table) => table.logicalName),
  );
  const currentIndexes = yield* readAppIndexBindingsEffect(
    tx,
    state.deploymentId,
    state.indexes,
  );
  const tableClassification = yield* Effect.fromResult(
    classifyTablesResult(state.tableState.tables, currentTables),
  );
  const indexClassification = yield* Effect.fromResult(
    classifyIndexesResult(state.indexes, currentIndexes),
  );
  const applied = [
    ...tableClassification.applied,
    ...indexClassification.applied,
  ];
  const missing = [
    ...tableClassification.missing,
    ...indexClassification.missing,
  ];
  if (missing.length === 0) {
    return state.manifest;
  }
  if (applied.length > 0) {
    return yield* Effect.fail(
      new SchemaManifestAppSchemaBindingPlanStaleError({
        reason: "partiallyApplied",
        applied: freezeIdentities(applied),
        missing: freezeIdentities(missing),
      }),
    );
  }

  if (tableClassification.stillMissing.length > 0) {
    const currentTableHighWater = yield* readStableTableCatalogHighWaterEffect(
      tx,
      state.deploymentId,
    );
    if (currentTableHighWater !== state.tableState.observedHighWater) {
      return yield* Effect.fail(
        new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "tableCatalogHighWaterChanged",
          observedTableId: state.tableState.observedHighWater,
          currentTableId: currentTableHighWater,
        }),
      );
    }
  }
  if (indexClassification.stillMissing.length > 0) {
    const currentIndexHighWater =
      yield* readStableLogicalIndexCatalogHighWaterEffect(
        tx,
        state.deploymentId,
      );
    if (currentIndexHighWater !== state.observedIndexHighWater) {
      return yield* Effect.fail(
        new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "indexCatalogHighWaterChanged",
          observedLogicalIndexId: state.observedIndexHighWater,
          currentLogicalIndexId: currentIndexHighWater,
        }),
      );
    }
  }

  yield* insertPlannedSchemaManifestAppTableBindingsEffect(
    tx,
    state.tableState,
    tableClassification.stillMissing,
  );
  yield* insertPlannedAppIndexBindingsEffect(
    tx,
    state,
    indexClassification.stillMissing,
  );
  return state.manifest;
});

function validateDeploymentId(deploymentId: string): string {
  if (!isNonBlankString(deploymentId)) {
    throw new InvalidSchemaManifestAppSchemaBindingInputError({
      reason: "invalidDeploymentId",
    });
  }
  return deploymentId;
}

function decodeTables(
  value: unknown,
): ReadonlyArray<SchemaManifestAppTableDeclarationV1> {
  try {
    return decodeSchemaManifestAppTableDeclarationsV1(value);
  } catch (cause) {
    throw new InvalidSchemaManifestAppSchemaBindingInputError(
      { reason: "invalidTables" },
      { cause },
    );
  }
}

function decodeIndexes(
  value: unknown,
): ReadonlyArray<SchemaManifestAppIndexDeclarationV1> {
  try {
    return decodeSchemaManifestAppIndexDeclarationsV1(value);
  } catch (cause) {
    throw new InvalidSchemaManifestAppSchemaBindingInputError(
      { reason: "invalidIndexes" },
      { cause },
    );
  }
}

function validateIndexTableReferences(
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): void {
  const declaredTables = new Set(tables.map((table) => table.logicalName));
  for (const index of indexes) {
    if (!declaredTables.has(index.tableLogicalName)) {
      throw new InvalidSchemaManifestAppSchemaBindingInputError({
        reason: "undeclaredIndexTable",
        tableLogicalName: index.tableLogicalName,
        descriptor: index.descriptor,
      });
    }
  }
}

function resolveAndSortIndexes(
  tableState: PreparedSchemaManifestAppTableBindingsState,
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): ReadonlyArray<ResolvedAppIndexDeclaration> {
  const tableIds = new Map(
    tableState.tables.map((table) => [table.logicalName, table.tableId]),
  );
  const resolved = indexes.map((index) => {
    const tableId = tableIds.get(index.tableLogicalName);
    if (tableId === undefined) {
      throw new InvalidSchemaManifestAppSchemaBindingInputError({
        reason: "undeclaredIndexTable",
        tableLogicalName: index.tableLogicalName,
        descriptor: index.descriptor,
      });
    }
    return {
      tableId,
      descriptor: index.descriptor,
      fields: index.fields,
    } satisfies ResolvedAppIndexDeclaration;
  });
  resolved.sort(compareResolvedIndexes);
  return Object.freeze(resolved.map((index) => Object.freeze(index)));
}

function compareResolvedIndexes(
  left: ResolvedAppIndexDeclaration,
  right: ResolvedAppIndexDeclaration,
): number {
  if (left.tableId !== right.tableId) return left.tableId - right.tableId;
  return left.descriptor < right.descriptor
    ? -1
    : left.descriptor > right.descriptor
      ? 1
      : 0;
}

export interface SchemaManifestAppIndexBindingRow {
  readonly deploymentId: string;
  readonly logicalIndexId: unknown;
  readonly tableId: unknown;
  readonly descriptor: string;
}

const runSchemaManifestAppSchemaBindingQueryEffect = Effect.fn(<A>(
  operation: SchemaManifestAppSchemaBindingPersistenceError["operation"],
  query: PromiseLike<A>,
): Effect.Effect<A, SchemaManifestAppSchemaBindingPersistenceError> =>
  Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new SchemaManifestAppSchemaBindingPersistenceError(
      operation,
      cause,
    ),
  })));

async function readAppIndexBindings(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexes: ReadonlyArray<ResolvedAppIndexDeclaration>,
): Promise<ReadonlyMap<string, CatalogIndexId>> {
  const rows = await selectSchemaManifestAppIndexBindingRows(
    db,
    deploymentId,
    indexes,
  );
  // Temporary throwing projection for the Promise-based D2a schema planner.
  // Delete it when that planner owns an Effect failure channel.
  return Result.getOrThrow(
    decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      indexes,
      rows,
    ),
  );
}

const readAppIndexBindingsEffect = Effect.fn(
  "SchemaManifestAppSchemaBindings.readIndexBindings",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexes: ReadonlyArray<ResolvedAppIndexDeclaration>,
): Effect.fn.Return<
  ReadonlyMap<string, CatalogIndexId>,
  | SchemaManifestAppSchemaBindingPersistenceError
  | StableLogicalIndexCatalogCorruptionError
> {
  if (indexes.length === 0) return new Map();
  const query = selectSchemaManifestAppIndexBindingRowsQuery(
    db,
    deploymentId,
    indexes,
  );
  const rows = yield* runSchemaManifestAppSchemaBindingQueryEffect(
    "readIndexBindings",
    query,
  );
  return yield* Effect.fromResult(
    decodeSchemaManifestAppIndexBindingRowsResult(
      deploymentId,
      indexes,
      rows,
    ),
  );
});

/** Package-internal raw row acquisition; callers own stored-row decoding. */
export async function selectSchemaManifestAppIndexBindingRows(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexes: ReadonlyArray<{
    readonly tableId: CatalogTableId;
    readonly descriptor: string;
  }>,
): Promise<ReadonlyArray<SchemaManifestAppIndexBindingRow>> {
  if (indexes.length === 0) return [];
  return selectSchemaManifestAppIndexBindingRowsQuery(
    db,
    deploymentId,
    indexes,
  );
}

function selectSchemaManifestAppIndexBindingRowsQuery(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexes: ReadonlyArray<{
    readonly tableId: CatalogTableId;
    readonly descriptor: string;
  }>,
) {
  const tableIds = [...new Set(indexes.map((index) => index.tableId))];
  return db
    .select({
      deploymentId: fxControlIndexes.deploymentId,
      logicalIndexId: fxControlIndexes.logicalIndexId,
      tableId: fxControlIndexes.tableId,
      descriptor: fxControlIndexes.descriptor,
    })
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, deploymentId),
        inArray(fxControlIndexes.tableId, tableIds),
      ),
    );
}

/** Pure recoverable decoder for rows acquired from the logical-index catalog. */
export function decodeSchemaManifestAppIndexBindingRowsResult(
  deploymentId: string,
  indexes: ReadonlyArray<{
    readonly tableId: CatalogTableId;
    readonly descriptor: string;
  }>,
  rows: ReadonlyArray<SchemaManifestAppIndexBindingRow>,
): Result.Result<
  ReadonlyMap<string, CatalogIndexId>,
  StableLogicalIndexCatalogCorruptionError
> {
  return Result.gen(function* () {
    const requested = new Set(indexes.map(indexIdentityKey));
    const bindings = new Map<string, CatalogIndexId>();
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        return yield* Result.fail(
          new StableLogicalIndexCatalogCorruptionError(
            deploymentId,
            `cross-deployment row returned for ${row.deploymentId}`,
          ),
        );
      }
      const tableId = yield* decodeStoredTableIdResult(
        deploymentId,
        row.tableId,
      );
      const key = indexIdentityKey({
        tableId,
        descriptor: row.descriptor,
      });
      if (!requested.has(key)) continue;
      if (bindings.has(key)) {
        return yield* Result.fail(
          new StableLogicalIndexCatalogCorruptionError(
            deploymentId,
            `duplicate logical identity for table ${tableId} descriptor ${row.descriptor}`,
          ),
        );
      }
      bindings.set(
        key,
        yield* decodeStoredIndexIdResult(deploymentId, row.logicalIndexId),
      );
    }
    return bindings;
  });
}

function planIndexBindings(
  deploymentId: string,
  indexes: ReadonlyArray<ResolvedAppIndexDeclaration>,
  observedBindings: ReadonlyMap<string, CatalogIndexId>,
  observedHighWater: CatalogIndexId | null,
): ReadonlyArray<PlannedAppIndexBinding> {
  let nextLogicalIndexId = observedHighWater;
  const planned: PlannedAppIndexBinding[] = [];
  for (const index of indexes) {
    const existingLogicalIndexId = observedBindings.get(indexIdentityKey(index));
    if (existingLogicalIndexId !== undefined) {
      planned.push({
        ...index,
        logicalIndexId: existingLogicalIndexId,
        wasMissing: false,
      });
      continue;
    }
    const logicalIndexId = nextStableLogicalIndexCatalogId(
      deploymentId,
      nextLogicalIndexId,
    );
    nextLogicalIndexId = logicalIndexId;
    planned.push({ ...index, logicalIndexId, wasMissing: true });
  }
  return Object.freeze(planned.map((index) => Object.freeze(index)));
}

function assembleManifest(
  deploymentId: string,
  tableState: PreparedSchemaManifestAppTableBindingsState,
  indexes: ReadonlyArray<PlannedAppIndexBinding>,
): SchemaManifestAppSchemaV1 {
  try {
    return decodeSchemaManifestAppSchemaV1({
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: tableState.section,
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: indexes
          .map((index) => ({
            logicalIndexId: index.logicalIndexId,
            tableId: index.tableId,
            namespace: "app",
            descriptor: index.descriptor,
            spec: {
              kind: "developerOrdered",
              specVersion: 1,
              fields: index.fields,
            },
          }))
          .sort((left, right) =>
            left.logicalIndexId - right.logicalIndexId
          ),
      },
    });
  } catch (cause) {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      "planned bindings could not form a semantic app-schema manifest",
      { cause },
    );
  }
}

interface AppSchemaBindingClassification<Binding> {
  readonly applied: ReadonlyArray<SchemaManifestAppSchemaBindingIdentity>;
  readonly missing: ReadonlyArray<SchemaManifestAppSchemaBindingIdentity>;
  readonly stillMissing: ReadonlyArray<Binding>;
}

function classifyTablesResult(
  planned: ReadonlyArray<PlannedAppTableBinding>,
  current: ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
): Result.Result<
  AppSchemaBindingClassification<PlannedAppTableBinding>,
  SchemaManifestAppSchemaBindingPlanStaleError
> {
  const applied: SchemaManifestAppSchemaBindingIdentity[] = [];
  const missing: SchemaManifestAppSchemaBindingIdentity[] = [];
  const stillMissing: PlannedAppTableBinding[] = [];
  for (const table of planned) {
    const currentTableId = current.get(table.logicalName) ?? null;
    if (!table.wasMissing) {
      if (currentTableId !== table.tableId) {
        return Result.fail(
          new SchemaManifestAppSchemaBindingPlanStaleError({
            reason: "tableBindingChanged",
            logicalName: table.logicalName,
            plannedTableId: table.tableId,
            currentTableId,
          }),
        );
      }
      continue;
    }
    const identity = tableBindingIdentity(table);
    if (currentTableId === table.tableId) {
      applied.push(identity);
    } else if (currentTableId === null) {
      missing.push(identity);
      stillMissing.push(table);
    } else {
      return Result.fail(
        new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "tableBindingChanged",
          logicalName: table.logicalName,
          plannedTableId: table.tableId,
          currentTableId,
        }),
      );
    }
  }
  return Result.succeed(Object.freeze({
    applied: Object.freeze(applied),
    missing: Object.freeze(missing),
    stillMissing: Object.freeze(stillMissing),
  }));
}

function classifyIndexesResult(
  planned: ReadonlyArray<PlannedAppIndexBinding>,
  current: ReadonlyMap<string, CatalogIndexId>,
): Result.Result<
  AppSchemaBindingClassification<PlannedAppIndexBinding>,
  SchemaManifestAppSchemaBindingPlanStaleError
> {
  const applied: SchemaManifestAppSchemaBindingIdentity[] = [];
  const missing: SchemaManifestAppSchemaBindingIdentity[] = [];
  const stillMissing: PlannedAppIndexBinding[] = [];
  for (const index of planned) {
    const currentLogicalIndexId = current.get(indexIdentityKey(index)) ?? null;
    if (!index.wasMissing) {
      if (currentLogicalIndexId !== index.logicalIndexId) {
        return Result.fail(
          indexBindingChanged(index, currentLogicalIndexId),
        );
      }
      continue;
    }
    const identity = indexBindingIdentity(index);
    if (currentLogicalIndexId === index.logicalIndexId) {
      applied.push(identity);
    } else if (currentLogicalIndexId === null) {
      missing.push(identity);
      stillMissing.push(index);
    } else {
      return Result.fail(indexBindingChanged(index, currentLogicalIndexId));
    }
  }
  return Result.succeed(Object.freeze({
    applied: Object.freeze(applied),
    missing: Object.freeze(missing),
    stillMissing: Object.freeze(stillMissing),
  }));
}

function indexBindingChanged(
  index: PlannedAppIndexBinding,
  currentLogicalIndexId: CatalogIndexId | null,
): SchemaManifestAppSchemaBindingPlanStaleError {
  return new SchemaManifestAppSchemaBindingPlanStaleError({
    reason: "indexBindingChanged",
    tableId: index.tableId,
    descriptor: index.descriptor,
    plannedLogicalIndexId: index.logicalIndexId,
    currentLogicalIndexId,
  });
}

const insertPlannedAppIndexBindingsEffect = Effect.fn(
  "SchemaManifestAppSchemaBindings.insertPlannedIndexBindings",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppSchemaBindingsState,
  indexes: ReadonlyArray<PlannedAppIndexBinding>,
): Effect.fn.Return<
  void,
  | SchemaManifestAppSchemaBindingPersistenceError
  | StableLogicalIndexCatalogCorruptionError
> {
  if (indexes.length === 0) return;
  const query = insertPlannedAppIndexBindingsQuery(tx, state, indexes);
  const rows = yield* runSchemaManifestAppSchemaBindingQueryEffect(
    "insertIndexBindings",
    query,
  );
  yield* Effect.fromResult(
    verifyInsertedSchemaManifestAppIndexBindingRowsResult(
      state.deploymentId,
      indexes,
      rows,
    ),
  );
});

function insertPlannedAppIndexBindingsQuery(
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppSchemaBindingsState,
  indexes: ReadonlyArray<PlannedAppIndexBinding>,
) {
  return tx
    .insert(fxControlIndexes)
    .values(
      indexes.map((index) => ({
        deploymentId: state.deploymentId,
        logicalIndexId: index.logicalIndexId,
        tableId: index.tableId,
        descriptor: index.descriptor,
      })),
    )
    .returning({
      deploymentId: fxControlIndexes.deploymentId,
      logicalIndexId: fxControlIndexes.logicalIndexId,
      tableId: fxControlIndexes.tableId,
      descriptor: fxControlIndexes.descriptor,
    });
}

/** Pure post-insert verification; the transaction boundary owns rollback. */
export function verifyInsertedSchemaManifestAppIndexBindingRowsResult(
  deploymentId: string,
  indexes: ReadonlyArray<{
    readonly logicalIndexId: CatalogIndexId;
    readonly tableId: CatalogTableId;
    readonly descriptor: string;
  }>,
  rows: ReadonlyArray<SchemaManifestAppIndexBindingRow>,
): Result.Result<void, StableLogicalIndexCatalogCorruptionError> {
  return Result.gen(function* () {
    const returned = new Map<string, CatalogIndexId>();
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        return yield* Result.fail(
          new StableLogicalIndexCatalogCorruptionError(
            deploymentId,
            `insert returned cross-deployment row for ${row.deploymentId}`,
          ),
        );
      }
      const tableId = yield* decodeStoredTableIdResult(
        deploymentId,
        row.tableId,
      );
      const key = indexIdentityKey({
        tableId,
        descriptor: row.descriptor,
      });
      if (returned.has(key)) {
        return yield* Result.fail(
          new StableLogicalIndexCatalogCorruptionError(
            deploymentId,
            `insert returned duplicate logical identity for table ${tableId} descriptor ${row.descriptor}`,
          ),
        );
      }
      returned.set(
        key,
        yield* decodeStoredIndexIdResult(deploymentId, row.logicalIndexId),
      );
    }
    if (returned.size !== indexes.length) {
      return yield* Result.fail(
        new StableLogicalIndexCatalogCorruptionError(
          deploymentId,
          "insert returned an unexpected number of planned logical index bindings",
        ),
      );
    }
    for (const index of indexes) {
      if (returned.get(indexIdentityKey(index)) !== index.logicalIndexId) {
        return yield* Result.fail(
          new StableLogicalIndexCatalogCorruptionError(
            deploymentId,
            `insert did not return planned binding ${index.tableId}/${index.descriptor}/${index.logicalIndexId}`,
          ),
        );
      }
    }
  });
}

function indexIdentityKey(
  index: {
    readonly tableId: CatalogTableId;
    readonly descriptor: string;
  },
): string {
  return `${index.tableId}\u0000${index.descriptor}`;
}

function tableBindingIdentity(
  table: PlannedAppTableBinding,
): SchemaManifestAppSchemaBindingIdentity {
  return Object.freeze({
    kind: "table",
    logicalName: table.logicalName,
    tableId: table.tableId,
  });
}

function indexBindingIdentity(
  index: PlannedAppIndexBinding,
): SchemaManifestAppSchemaBindingIdentity {
  return Object.freeze({
    kind: "index",
    tableId: index.tableId,
    descriptor: index.descriptor,
    logicalIndexId: index.logicalIndexId,
  });
}

function freezeIdentities(
  identities: ReadonlyArray<SchemaManifestAppSchemaBindingIdentity>,
): ReadonlyArray<SchemaManifestAppSchemaBindingIdentity> {
  return Object.freeze([...identities]);
}

function invalidInputMessage(
  issue: InvalidSchemaManifestAppSchemaBindingInputIssue,
): string {
  switch (issue.reason) {
    case "invalidDeploymentId":
      return "Schema manifest app-schema deployment ID is invalid.";
    case "invalidTables":
      return "Schema manifest app-schema table declarations are invalid.";
    case "invalidIndexes":
      return "Schema manifest app-schema index declarations are invalid.";
    case "undeclaredIndexTable":
      return `Index ${issue.descriptor} references undeclared app table ${issue.tableLogicalName}.`;
  }
}

function stalePlanMessage(
  stale: SchemaManifestAppSchemaBindingPlanStale,
): string {
  switch (stale.reason) {
    case "tableBindingChanged":
      return `App table ${stale.logicalName} no longer matches planned table ID ${stale.plannedTableId}.`;
    case "indexBindingChanged":
      return `App index ${stale.tableId}/${stale.descriptor} no longer matches planned logical index ID ${stale.plannedLogicalIndexId}.`;
    case "tableCatalogHighWaterChanged":
      return "The stable table catalog advanced after app-schema preparation.";
    case "indexCatalogHighWaterChanged":
      return "The stable logical index catalog advanced after app-schema preparation.";
    case "partiallyApplied":
      return "The app-schema binding plan was only partially applied and must be rebuilt.";
  }
}
