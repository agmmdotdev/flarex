import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import type { Json } from "flarex-protocol/json";
import {
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestTableDefinitionsV1,
  SchemaManifestAppTableNameSchema,
  type SchemaManifestAppDocumentDefinitionV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
  type SchemaManifestAppTableName,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
} from "./stableTableCatalog";
import {
  nextStableTableCatalogIdResult,
  readStableTableCatalogHighWaterEffect,
  type StableTableCatalogAllocationPersistenceError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";
import type { StableTableCatalogCorruptionError } from
  "./stableTableCatalogError";
import { deployments, fxControlTables } from "./schema";

const APP_TABLE_NAMESPACE: "app" = "app";

const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  CatalogTableIdSchema,
);
const decodeSchemaManifestAppTableNameResult = Schema.decodeUnknownResult(
  SchemaManifestAppTableNameSchema,
);

export interface PrepareSchemaManifestAppTableBindingsV1Input {
  readonly deploymentId: string;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>;
}

const preparedBindingsBrand: unique symbol = Symbol(
  "FlarexDB/PreparedSchemaManifestAppTableBindingsV1",
);

export interface PreparedSchemaManifestAppTableBindingsV1 {
  readonly deploymentId: string;
  readonly section: SchemaManifestTableDefinitionsV1;
  readonly [preparedBindingsBrand]: true;
}

export type InvalidSchemaManifestTableBindingInputIssue =
  | { readonly reason: "invalidDeploymentId" }
  | { readonly reason: "invalidDeclarations" };

export class InvalidSchemaManifestTableBindingInputError extends Error {
  readonly _tag = "InvalidSchemaManifestTableBindingInputError" as const;

  constructor(
    readonly issue: InvalidSchemaManifestTableBindingInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidBindingInputMessage(issue), options);
    this.name = "InvalidSchemaManifestTableBindingInputError";
  }
}

export class InvalidPreparedSchemaManifestTableBindingsError extends Error {
  readonly _tag =
    "InvalidPreparedSchemaManifestTableBindingsError" as const;

  constructor() {
    super(
      "Schema manifest table bindings were not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedSchemaManifestTableBindingsError";
  }
}

export type SchemaManifestTableBindingPlanStale =
  | {
      readonly reason: "bindingChanged";
      readonly logicalName: SchemaManifestAppTableName;
      readonly plannedTableId: CatalogTableId;
      readonly currentTableId: CatalogTableId | null;
    }
  | {
      readonly reason: "catalogHighWaterChanged";
      readonly observedTableId: CatalogTableId | null;
      readonly currentTableId: CatalogTableId | null;
    }
  | {
      readonly reason: "partiallyApplied";
      readonly appliedLogicalNames: ReadonlyArray<SchemaManifestAppTableName>;
      readonly missingLogicalNames: ReadonlyArray<SchemaManifestAppTableName>;
    };

export class SchemaManifestTableBindingPlanStaleError extends Error {
  readonly _tag = "SchemaManifestTableBindingPlanStaleError" as const;

  constructor(readonly stale: SchemaManifestTableBindingPlanStale) {
    super(staleBindingPlanMessage(stale));
    this.name = "SchemaManifestTableBindingPlanStaleError";
  }
}

export class SchemaManifestTableBindingCorruptionError extends Error {
  readonly _tag = "SchemaManifestTableBindingCorruptionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Schema manifest table binding catalog is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "SchemaManifestTableBindingCorruptionError";
  }
}

export type PrepareSchemaManifestAppTableBindingsV1Error =
  | InvalidSchemaManifestTableBindingInputError
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
  | SchemaManifestTableBindingCorruptionError
  | StableTableCatalogAllocationPersistenceError
  | StableTableCatalogCorruptionError
  | StableTableCatalogIdExhaustedError;

export type ApplySchemaManifestAppTableBindingsV1Error =
  | InvalidPreparedSchemaManifestTableBindingsError
  | SchemaManifestTableBindingPlanStaleError
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
  | SchemaManifestTableBindingCorruptionError
  | StableTableCatalogAllocationPersistenceError
  | StableTableCatalogCorruptionError;

export interface PlannedAppTableBinding {
  readonly logicalName: SchemaManifestAppTableName;
  readonly tableId: CatalogTableId;
  readonly wasMissing: boolean;
}

export interface PreparedSchemaManifestAppTableBindingsState {
  readonly deploymentId: string;
  readonly observedHighWater: CatalogTableId | null;
  readonly tables: ReadonlyArray<PlannedAppTableBinding>;
  readonly section: SchemaManifestTableDefinitionsV1;
}

const preparedBindingStates = new WeakMap<
  PreparedSchemaManifestAppTableBindingsV1,
  PreparedSchemaManifestAppTableBindingsState
>();

/** Pure package-internal decoder for the authenticated optimistic-plan state. */
export function getPreparedSchemaManifestAppTableBindingsStateResult(
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Result.Result<
  PreparedSchemaManifestAppTableBindingsState,
  InvalidPreparedSchemaManifestTableBindingsError
> {
  const state = preparedBindingStates.get(prepared);
  return state === undefined
    ? Result.fail(new InvalidPreparedSchemaManifestTableBindingsError())
    : Result.succeed(state);
}

/** Build a deterministic optimistic binding plan without taking a SQL lock. */
export const prepareSchemaManifestAppTableBindingsV1Effect = Effect.fn(
  "SchemaManifestTableBindings.prepareAppBindings",
)(function* (
  db: FlarexMetadataDatabase,
  input: PrepareSchemaManifestAppTableBindingsV1Input,
): Effect.fn.Return<
  PreparedSchemaManifestAppTableBindingsV1,
  PrepareSchemaManifestAppTableBindingsV1Error
> {
  const deploymentId = yield* Effect.fromResult(
    validateDeploymentIdResult(input.deploymentId),
  );
  const declarations = yield* Effect.fromResult(
    decodeDeclarationsResult(input.tables),
  );
  const sortedDeclarations = [...declarations].sort(compareDeclarationsByName);

  yield* readSchemaManifestBindingDeploymentEffect(db, deploymentId);
  const observedBindings = yield* readSchemaManifestAppTableBindingsEffect(
    db,
    deploymentId,
    sortedDeclarations.map((table) => table.logicalName),
  );
  const observedHighWater = yield* readStableTableCatalogHighWaterEffect(
    db,
    deploymentId,
  );
  const plannedTables = yield* Effect.fromResult(
    planTableBindingsResult(
      deploymentId,
      sortedDeclarations,
      observedBindings,
      observedHighWater,
    ),
  );
  const section = detachAndFreezeSection(
    yield* Effect.fromResult(
      assembleSectionResult(deploymentId, sortedDeclarations, plannedTables),
    ),
  );
  return makePreparedTableBindings(
    deploymentId,
    observedHighWater,
    plannedTables,
    section,
  );
});

function makePreparedTableBindings(
  deploymentId: string,
  observedHighWater: CatalogTableId | null,
  plannedTables: ReadonlyArray<PlannedAppTableBinding>,
  section: SchemaManifestTableDefinitionsV1,
): PreparedSchemaManifestAppTableBindingsV1 {
  const prepared = Object.freeze({
    deploymentId,
    section,
    [preparedBindingsBrand]: true,
  } satisfies PreparedSchemaManifestAppTableBindingsV1);
  preparedBindingStates.set(prepared, {
    deploymentId,
    observedHighWater,
    tables: plannedTables,
    section,
  });
  return prepared;
}

/** Revalidate and apply one prepared plan inside a caller-owned transaction. */
export const applySchemaManifestAppTableBindingsV1InTransactionEffect =
Effect.fn(
  "SchemaManifestTableBindings.applyInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Effect.fn.Return<
  SchemaManifestTableDefinitionsV1,
  ApplySchemaManifestAppTableBindingsV1Error
> {
  const state = yield* Effect.fromResult(
    getPreparedSchemaManifestAppTableBindingsStateResult(prepared),
  );

  yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
  const currentBindings = yield* readSchemaManifestAppTableBindingsEffect(
    tx,
    state.deploymentId,
    state.tables.map((table) => table.logicalName),
  );
  const missingAtPreparation = state.tables.filter((table) => table.wasMissing);
  const appliedNames: SchemaManifestAppTableName[] = [];
  const stillMissingNames: SchemaManifestAppTableName[] = [];

  for (const table of state.tables) {
    const currentTableId = currentBindings.get(table.logicalName) ?? null;
    if (!table.wasMissing) {
      if (currentTableId !== table.tableId) {
        return yield* Effect.fail(bindingChanged(table, currentTableId));
      }
      continue;
    }
    if (currentTableId === table.tableId) {
      appliedNames.push(table.logicalName);
    } else if (currentTableId === null) {
      stillMissingNames.push(table.logicalName);
    } else {
      return yield* Effect.fail(bindingChanged(table, currentTableId));
    }
  }

  if (missingAtPreparation.length === appliedNames.length) {
    return state.section;
  }
  if (appliedNames.length > 0) {
    return yield* Effect.fail(new SchemaManifestTableBindingPlanStaleError({
      reason: "partiallyApplied",
      appliedLogicalNames: Object.freeze([...appliedNames]),
      missingLogicalNames: Object.freeze([...stillMissingNames]),
    }));
  }

  const currentHighWater = yield* readStableTableCatalogHighWaterEffect(
    tx,
    state.deploymentId,
  );
  if (currentHighWater !== state.observedHighWater) {
    return yield* Effect.fail(new SchemaManifestTableBindingPlanStaleError({
      reason: "catalogHighWaterChanged",
      observedTableId: state.observedHighWater,
      currentTableId: currentHighWater,
    }));
  }

  yield* insertPlannedSchemaManifestAppTableBindingsEffect(
    tx,
    state,
    missingAtPreparation,
  );
  return state.section;
});

function validateDeploymentIdResult(
  deploymentId: string,
): Result.Result<string, InvalidSchemaManifestTableBindingInputError> {
  return isNonBlankString(deploymentId)
    ? Result.succeed(deploymentId)
    : Result.fail(new InvalidSchemaManifestTableBindingInputError({
      reason: "invalidDeploymentId",
    }));
}

function decodeDeclarationsResult(
  value: unknown,
): Result.Result<
  ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  InvalidSchemaManifestTableBindingInputError
> {
  return Result.try({
    try: () => decodeSchemaManifestAppTableDeclarationsV1(value),
    catch: (cause) => new InvalidSchemaManifestTableBindingInputError(
      { reason: "invalidDeclarations" },
      { cause },
    ),
  });
}

function compareDeclarationsByName(
  left: SchemaManifestAppTableDeclarationV1,
  right: SchemaManifestAppTableDeclarationV1,
): number {
  return left.logicalName < right.logicalName
    ? -1
    : left.logicalName > right.logicalName
      ? 1
      : 0;
}

export class SchemaManifestTableBindingPersistenceError extends Error {
  readonly _tag = "SchemaManifestTableBindingPersistenceError" as const;

  constructor(
    readonly operation:
      | "readDeployment"
      | "lockDeployment"
      | "readBindings"
      | "insertBindings",
    readonly cause: unknown,
  ) {
    super(`Schema-manifest table binding ${operation} failed.`, { cause });
    this.name = "SchemaManifestTableBindingPersistenceError";
  }
}

const runSchemaManifestTableBindingQueryEffect = Effect.fn(<A>(
  operation: SchemaManifestTableBindingPersistenceError["operation"],
  query: PromiseLike<A>,
): Effect.Effect<A, SchemaManifestTableBindingPersistenceError> =>
  Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new SchemaManifestTableBindingPersistenceError(
      operation,
      cause,
    ),
  })));

const readSchemaManifestBindingDeploymentEffect = Effect.fn(
  "SchemaManifestTableBindings.readDeployment",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Effect.fn.Return<
  void,
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
> {
  const query = selectSchemaManifestBindingDeployment(db, deploymentId);
  const rows = yield* runSchemaManifestTableBindingQueryEffect(
    "readDeployment",
    query,
  );
  if (rows[0] === undefined) {
    return yield* Effect.fail(
      new StableTableCatalogDeploymentNotFoundError(deploymentId),
    );
  }
});

function selectSchemaManifestBindingDeployment(
  db: FlarexMetadataDatabase,
  deploymentId: string,
) {
  return db
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1);
}

export const lockSchemaManifestBindingDeploymentEffect = Effect.fn(
  "SchemaManifestTableBindings.lockDeployment",
)(function* (
  tx: StableTableCatalogTransaction,
  deploymentId: string,
): Effect.fn.Return<
  void,
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
> {
  const query = selectLockedSchemaManifestBindingDeployment(tx, deploymentId);
  const rows = yield* runSchemaManifestTableBindingQueryEffect(
    "lockDeployment",
    query,
  );
  if (rows[0] === undefined) {
    return yield* Effect.fail(
      new StableTableCatalogDeploymentNotFoundError(deploymentId),
    );
  }
});

function selectLockedSchemaManifestBindingDeployment(
  tx: StableTableCatalogTransaction,
  deploymentId: string,
) {
  return tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1)
    .for("update");
}

export const readSchemaManifestAppTableBindingsEffect = Effect.fn(
  "SchemaManifestTableBindings.readAppBindings",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
): Effect.fn.Return<
  ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
  | SchemaManifestTableBindingPersistenceError
  | SchemaManifestTableBindingCorruptionError
> {
  if (logicalNames.length === 0) return new Map();
  const query = selectSchemaManifestAppTableBindingRowsQuery(
    db,
    deploymentId,
    logicalNames,
  );
  const rows = yield* runSchemaManifestTableBindingQueryEffect(
    "readBindings",
    query,
  );
  return yield* Effect.fromResult(
    decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      logicalNames,
      rows,
    ),
  );
});

export type SchemaManifestAppTableBindingRow = Pick<
  typeof fxControlTables.$inferSelect,
  "deploymentId" | "tableId" | "logicalName"
>;

function selectSchemaManifestAppTableBindingRowsQuery(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
) {
  return db
    .select({
      deploymentId: fxControlTables.deploymentId,
      tableId: fxControlTables.tableId,
      logicalName: fxControlTables.logicalName,
    })
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, deploymentId),
        eq(fxControlTables.namespace, APP_TABLE_NAMESPACE),
        inArray(fxControlTables.logicalName, logicalNames),
      ),
    );
}

/** Pure recoverable decoder for rows acquired from the stable table catalog. */
export function decodeSchemaManifestAppTableBindingRowsResult(
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
  rows: ReadonlyArray<SchemaManifestAppTableBindingRow>,
): Result.Result<
  ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
  SchemaManifestTableBindingCorruptionError
> {
  return Result.gen(function* () {
    const requestedNames = new Set(logicalNames);
    const bindings = new Map<SchemaManifestAppTableName, CatalogTableId>();
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        return yield* Result.fail(
          new SchemaManifestTableBindingCorruptionError(
            deploymentId,
            `cross-deployment row returned for ${row.deploymentId}`,
          ),
        );
      }
      const logicalName = yield* decodeStoredLogicalNameResult(
        deploymentId,
        row.logicalName,
      );
      if (!requestedNames.has(logicalName) || bindings.has(logicalName)) {
        return yield* Result.fail(
          new SchemaManifestTableBindingCorruptionError(
            deploymentId,
            `unexpected or duplicate app binding for ${logicalName}`,
          ),
        );
      }
      const tableId = yield* decodeStoredTableIdResult(
        deploymentId,
        row.tableId,
      );
      bindings.set(logicalName, tableId);
    }
    return bindings;
  });
}

function planTableBindingsResult(
  deploymentId: string,
  declarations: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  observedBindings: ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
  observedHighWater: CatalogTableId | null,
): Result.Result<
  ReadonlyArray<PlannedAppTableBinding>,
  StableTableCatalogCorruptionError | StableTableCatalogIdExhaustedError
> {
  return Result.gen(function* () {
    let nextTableId = observedHighWater;
    const planned: PlannedAppTableBinding[] = [];
    for (const declaration of declarations) {
      const existingTableId = observedBindings.get(declaration.logicalName);
      if (existingTableId !== undefined) {
        planned.push({
          logicalName: declaration.logicalName,
          tableId: existingTableId,
          wasMissing: false,
        });
        continue;
      }
      const tableId = yield* nextStableTableCatalogIdResult(
        deploymentId,
        nextTableId,
      );
      nextTableId = tableId;
      planned.push({
        logicalName: declaration.logicalName,
        tableId,
        wasMissing: true,
      });
    }
    return Object.freeze(planned.map((table) => Object.freeze(table)));
  });
}

function assembleSectionResult(
  deploymentId: string,
  declarations: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  plannedTables: ReadonlyArray<PlannedAppTableBinding>,
): Result.Result<
  SchemaManifestTableDefinitionsV1,
  SchemaManifestTableBindingCorruptionError
> {
  const definitionsByName = new Map<
    SchemaManifestAppTableName,
    SchemaManifestAppDocumentDefinitionV1
  >(
    declarations.map((table) => [table.logicalName, table.definition]),
  );
  const tablesResult = Result.gen(function* () {
    const tables: Array<SchemaManifestTableDefinitionsV1["tables"][number]> = [];
    for (const table of plannedTables) {
      const definition = definitionsByName.get(table.logicalName);
      if (definition === undefined) {
        return yield* Result.fail(new SchemaManifestTableBindingCorruptionError(
          deploymentId,
          `planned table ${table.logicalName} lost its definition`,
        ));
      }
      tables.push({
        tableId: table.tableId,
        namespace: "app",
        logicalName: table.logicalName,
        definition,
      });
    }
    return tables.sort((left, right) => left.tableId - right.tableId);
  });
  return tablesResult.pipe(Result.flatMap((tables) => Result.try({
    try: () => decodeSchemaManifestTableDefinitionsV1({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables,
    }),
    catch: (cause) => new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      "planned bindings could not form a semantic table section",
      { cause },
    ),
  })));
}

function detachAndFreezeSection(
  section: SchemaManifestTableDefinitionsV1,
): SchemaManifestTableDefinitionsV1 {
  const copy = structuredClone(section);
  deepFreezeJson(copy);
  return copy;
}

function deepFreezeJson(value: Json): void {
  if (value === null || typeof value !== "object") return;
  for (const item of Array.isArray(value)
    ? value
    : Object.values(value)) {
    deepFreezeJson(item);
  }
  Object.freeze(value);
}

export const insertPlannedSchemaManifestAppTableBindingsEffect = Effect.fn(
  "SchemaManifestTableBindings.insertPlannedAppBindings",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppTableBindingsState,
  missingTables: ReadonlyArray<PlannedAppTableBinding>,
): Effect.fn.Return<
  void,
  | SchemaManifestTableBindingPersistenceError
  | SchemaManifestTableBindingCorruptionError
> {
  if (missingTables.length === 0) return;
  const query = insertPlannedSchemaManifestAppTableBindingsQuery(
    tx,
    state,
    missingTables,
  );
  const rows = yield* runSchemaManifestTableBindingQueryEffect(
    "insertBindings",
    query,
  );
  yield* Effect.fromResult(
    verifyInsertedSchemaManifestAppTableBindingRowsResult(
      state.deploymentId,
      missingTables,
      rows,
    ),
  );
});

function insertPlannedSchemaManifestAppTableBindingsQuery(
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppTableBindingsState,
  missingTables: ReadonlyArray<PlannedAppTableBinding>,
) {
  return tx
    .insert(fxControlTables)
    .values(
      missingTables.map((table) => ({
        deploymentId: state.deploymentId,
        tableId: table.tableId,
        namespace: APP_TABLE_NAMESPACE,
        logicalName: table.logicalName,
      })),
    )
    .returning({
      deploymentId: fxControlTables.deploymentId,
      tableId: fxControlTables.tableId,
      logicalName: fxControlTables.logicalName,
    });
}

/** Pure post-insert verification; the transaction boundary owns rollback. */
export function verifyInsertedSchemaManifestAppTableBindingRowsResult(
  deploymentId: string,
  missingTables: ReadonlyArray<PlannedAppTableBinding>,
  rows: ReadonlyArray<SchemaManifestAppTableBindingRow>,
): Result.Result<void, SchemaManifestTableBindingCorruptionError> {
  return Result.gen(function* () {
    const returned = new Map<SchemaManifestAppTableName, CatalogTableId>();
    for (const row of rows) {
      if (row.deploymentId !== deploymentId) {
        return yield* Result.fail(
          new SchemaManifestTableBindingCorruptionError(
            deploymentId,
            `cross-deployment insert row returned for ${row.deploymentId}`,
          ),
        );
      }
      const logicalName = yield* decodeStoredLogicalNameResult(
        deploymentId,
        row.logicalName,
      );
      const tableId = yield* decodeStoredTableIdResult(
        deploymentId,
        row.tableId,
      );
      if (returned.has(logicalName)) {
        return yield* Result.fail(
          new SchemaManifestTableBindingCorruptionError(
            deploymentId,
            `insert returned duplicate planned binding ${logicalName}`,
          ),
        );
      }
      returned.set(logicalName, tableId);
    }
    for (const table of missingTables) {
      if (returned.get(table.logicalName) !== table.tableId) {
        return yield* Result.fail(
          new SchemaManifestTableBindingCorruptionError(
            deploymentId,
            `insert did not return planned binding ${table.logicalName}/${table.tableId}`,
          ),
        );
      }
    }
    if (returned.size !== missingTables.length) {
      return yield* Result.fail(
        new SchemaManifestTableBindingCorruptionError(
          deploymentId,
          "insert returned an unexpected number of planned bindings",
        ),
      );
    }
  });
}

function decodeStoredLogicalNameResult(
  deploymentId: string,
  value: unknown,
): Result.Result<
  SchemaManifestAppTableName,
  SchemaManifestTableBindingCorruptionError
> {
  return decodeSchemaManifestAppTableNameResult(value).pipe(
    Result.mapError((cause) => new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      `invalid stored app table name: ${String(value)}`,
      { cause },
    )),
  );
}

function decodeStoredTableIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, SchemaManifestTableBindingCorruptionError> {
  return decodeCatalogTableIdResult(value).pipe(
    Result.mapError((cause) => new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      `invalid stored table ID: ${String(value)}`,
      { cause },
    )),
  );
}

function bindingChanged(
  table: PlannedAppTableBinding,
  currentTableId: CatalogTableId | null,
): SchemaManifestTableBindingPlanStaleError {
  return new SchemaManifestTableBindingPlanStaleError({
    reason: "bindingChanged",
    logicalName: table.logicalName,
    plannedTableId: table.tableId,
    currentTableId,
  });
}

function invalidBindingInputMessage(
  issue: InvalidSchemaManifestTableBindingInputIssue,
): string {
  switch (issue.reason) {
    case "invalidDeploymentId":
      return "Schema manifest table binding deployment ID is invalid.";
    case "invalidDeclarations":
      return "Schema manifest app table declarations are invalid.";
  }
  return assertNever(issue);
}

function staleBindingPlanMessage(
  stale: SchemaManifestTableBindingPlanStale,
): string {
  switch (stale.reason) {
    case "bindingChanged":
      return `Schema manifest binding plan is stale for ${stale.logicalName}: planned ${stale.plannedTableId}, current ${String(stale.currentTableId)}.`;
    case "catalogHighWaterChanged":
      return `Schema manifest binding plan high-water mark changed from ${String(stale.observedTableId)} to ${String(stale.currentTableId)}.`;
    case "partiallyApplied":
      return "Schema manifest binding plan is only partially present in the stable catalog.";
  }
  return assertNever(stale);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled schema manifest table binding case: ${String(value)}`);
}
