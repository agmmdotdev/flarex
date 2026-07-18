import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray } from "drizzle-orm";
import { Result } from "effect";
import {
  decodeCatalogTableId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import type { Json } from "flarex-protocol/json";
import {
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestAppTableName,
  decodeSchemaManifestTableDefinitionsV1,
  type SchemaManifestAppDocumentDefinitionV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
  type SchemaManifestAppTableName,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";

import {
  getDeploymentMetadata,
  type FlarexMetadataDatabase,
} from "./deployments";
import {
  StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
} from "./stableTableCatalog";
import {
  nextStableTableCatalogId,
  readStableTableCatalogHighWater,
} from "./stableTableCatalogAllocation";
import { deployments, fxControlTables } from "./schema";

const APP_TABLE_NAMESPACE: "app" = "app";

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
  constructor(
    readonly issue: InvalidSchemaManifestTableBindingInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidBindingInputMessage(issue), options);
    this.name = "InvalidSchemaManifestTableBindingInputError";
  }
}

export class InvalidPreparedSchemaManifestTableBindingsError extends Error {
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

/** Internal composition seam for the full app-schema planner. */
export function getPreparedSchemaManifestAppTableBindingsState(
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): PreparedSchemaManifestAppTableBindingsState {
  const state = preparedBindingStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedSchemaManifestTableBindingsError();
  }
  return state;
}

/**
 * Build a deterministic optimistic binding plan without taking a database lock.
 *
 * The section is safe to canonicalize outside SQL. Applying the opaque plan in
 * a later short transaction revalidates the observed catalog state before any
 * planned ID is inserted.
 */
export async function prepareSchemaManifestAppTableBindingsV1(
  db: FlarexMetadataDatabase,
  input: PrepareSchemaManifestAppTableBindingsV1Input,
): Promise<PreparedSchemaManifestAppTableBindingsV1> {
  const deploymentId = validateDeploymentId(input.deploymentId);
  const declarations = decodeDeclarations(input.tables);
  const sortedDeclarations = [...declarations].sort(compareDeclarationsByName);

  if (await getDeploymentMetadata(db, deploymentId) === null) {
    throw new StableTableCatalogDeploymentNotFoundError(deploymentId);
  }

  const observedBindings = await readSchemaManifestAppTableBindings(
    db,
    deploymentId,
    sortedDeclarations.map((table) => table.logicalName),
  );
  const observedHighWater = await readStableTableCatalogHighWater(
    db,
    deploymentId,
  );
  const plannedTables = planTableBindings(
    deploymentId,
    sortedDeclarations,
    observedBindings,
    observedHighWater,
  );
  const section = detachAndFreezeSection(
    assembleSection(deploymentId, sortedDeclarations, plannedTables),
  );
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

/**
 * Revalidate and apply one prepared binding plan inside a caller-owned tx.
 *
 * This helper never commits. The later artifact slice must call it in the same
 * transaction as immutable artifact insertion. Stale optimistic plans fail
 * before any planned row is inserted and must be rebuilt outside SQL.
 */
export async function applySchemaManifestAppTableBindingsV1InTransaction(
  tx: StableTableCatalogTransaction,
  prepared: PreparedSchemaManifestAppTableBindingsV1,
): Promise<SchemaManifestTableDefinitionsV1> {
  const state = getPreparedSchemaManifestAppTableBindingsState(prepared);

  await lockSchemaManifestBindingDeployment(tx, state.deploymentId);
  const currentBindings = await readSchemaManifestAppTableBindings(
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
        throw bindingChanged(table, currentTableId);
      }
      continue;
    }
    if (currentTableId === table.tableId) {
      appliedNames.push(table.logicalName);
    } else if (currentTableId === null) {
      stillMissingNames.push(table.logicalName);
    } else {
      throw bindingChanged(table, currentTableId);
    }
  }

  if (missingAtPreparation.length === appliedNames.length) {
    return state.section;
  }
  if (appliedNames.length > 0) {
    throw new SchemaManifestTableBindingPlanStaleError({
      reason: "partiallyApplied",
      appliedLogicalNames: Object.freeze([...appliedNames]),
      missingLogicalNames: Object.freeze([...stillMissingNames]),
    });
  }

  const currentHighWater = await readStableTableCatalogHighWater(
    tx,
    state.deploymentId,
  );
  if (currentHighWater !== state.observedHighWater) {
    throw new SchemaManifestTableBindingPlanStaleError({
      reason: "catalogHighWaterChanged",
      observedTableId: state.observedHighWater,
      currentTableId: currentHighWater,
    });
  }

  await insertPlannedSchemaManifestAppTableBindings(
    tx,
    state,
    missingAtPreparation,
  );
  return state.section;
}

function validateDeploymentId(deploymentId: string): string {
  if (!isNonBlankString(deploymentId)) {
    throw new InvalidSchemaManifestTableBindingInputError({
      reason: "invalidDeploymentId",
    });
  }
  return deploymentId;
}

function decodeDeclarations(
  value: unknown,
): ReadonlyArray<SchemaManifestAppTableDeclarationV1> {
  try {
    return decodeSchemaManifestAppTableDeclarationsV1(value);
  } catch (cause) {
    throw new InvalidSchemaManifestTableBindingInputError(
      { reason: "invalidDeclarations" },
      { cause },
    );
  }
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

export async function lockSchemaManifestBindingDeployment(
  tx: StableTableCatalogTransaction,
  deploymentId: string,
): Promise<void> {
  const rows = await tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, deploymentId))
    .limit(1)
    .for("update");
  if (rows[0] === undefined) {
    throw new StableTableCatalogDeploymentNotFoundError(deploymentId);
  }
}

export async function readSchemaManifestAppTableBindings(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
): Promise<ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>> {
  const rows = await selectSchemaManifestAppTableBindingRows(
    db,
    deploymentId,
    logicalNames,
  );
  return decodeSchemaManifestAppTableBindingRows(
    deploymentId,
    logicalNames,
    rows,
  );
}

export type SchemaManifestAppTableBindingRow = Pick<
  typeof fxControlTables.$inferSelect,
  "deploymentId" | "tableId" | "logicalName"
>;

/** Package-internal raw row acquisition; callers own stored-row decoding. */
export async function selectSchemaManifestAppTableBindingRows(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
): Promise<ReadonlyArray<SchemaManifestAppTableBindingRow>> {
  if (logicalNames.length === 0) return [];
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

/** Package-internal decoder for rows acquired from the stable table catalog. */
export function decodeSchemaManifestAppTableBindingRows(
  deploymentId: string,
  logicalNames: ReadonlyArray<SchemaManifestAppTableName>,
  rows: ReadonlyArray<SchemaManifestAppTableBindingRow>,
): ReadonlyMap<SchemaManifestAppTableName, CatalogTableId> {
  // Temporary throwing projection for the Promise-based schema-planning
  // consumers in this module and schemaManifestAppSchemaBindings. Delete it
  // when those consumers own Result or Effect failure channels.
  return Result.getOrThrow(
    decodeSchemaManifestAppTableBindingRowsResult(
      deploymentId,
      logicalNames,
      rows,
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

function planTableBindings(
  deploymentId: string,
  declarations: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  observedBindings: ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
  observedHighWater: CatalogTableId | null,
): ReadonlyArray<PlannedAppTableBinding> {
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
    const tableId = nextStableTableCatalogId(deploymentId, nextTableId);
    nextTableId = tableId;
    planned.push({
      logicalName: declaration.logicalName,
      tableId,
      wasMissing: true,
    });
  }
  return Object.freeze(planned.map((table) => Object.freeze(table)));
}

function assembleSection(
  deploymentId: string,
  declarations: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  plannedTables: ReadonlyArray<PlannedAppTableBinding>,
): SchemaManifestTableDefinitionsV1 {
  const definitionsByName = new Map<
    SchemaManifestAppTableName,
    SchemaManifestAppDocumentDefinitionV1
  >(
    declarations.map((table) => [table.logicalName, table.definition]),
  );
  const tables = plannedTables
    .map((table) => {
      const definition = definitionsByName.get(table.logicalName);
      if (definition === undefined) {
        throw new SchemaManifestTableBindingCorruptionError(
          deploymentId,
          `planned table ${table.logicalName} lost its definition`,
        );
      }
      return {
        tableId: table.tableId,
        namespace: "app",
        logicalName: table.logicalName,
        definition,
      };
    })
    .sort((left, right) => left.tableId - right.tableId);
  try {
    return decodeSchemaManifestTableDefinitionsV1({
      kind: "tableDefinitions",
      sectionVersion: 1,
      tables,
    });
  } catch (cause) {
    throw new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      "planned bindings could not form a semantic table section",
      { cause },
    );
  }
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

export async function insertPlannedSchemaManifestAppTableBindings(
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppTableBindingsState,
  missingTables: ReadonlyArray<PlannedAppTableBinding>,
): Promise<void> {
  if (missingTables.length === 0) return;
  const rows = await tx
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
  const returned = new Map<SchemaManifestAppTableName, CatalogTableId>();
  for (const row of rows) {
    const logicalName = decodeStoredLogicalName(
      state.deploymentId,
      row.logicalName,
    );
    returned.set(
      logicalName,
      decodeStoredTableId(state.deploymentId, row.tableId),
    );
  }
  for (const table of missingTables) {
    if (returned.get(table.logicalName) !== table.tableId) {
      throw new SchemaManifestTableBindingCorruptionError(
        state.deploymentId,
        `insert did not return planned binding ${table.logicalName}/${table.tableId}`,
      );
    }
  }
  if (returned.size !== missingTables.length) {
    throw new SchemaManifestTableBindingCorruptionError(
      state.deploymentId,
      "insert returned an unexpected number of planned bindings",
    );
  }
}

function decodeStoredLogicalNameResult(
  deploymentId: string,
  value: unknown,
): Result.Result<
  SchemaManifestAppTableName,
  SchemaManifestTableBindingCorruptionError
> {
  return Result.try({
    try: () => decodeSchemaManifestAppTableName(value),
    catch: (cause) => new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      `invalid stored app table name: ${String(value)}`,
      { cause },
    ),
  });
}

function decodeStoredLogicalName(
  deploymentId: string,
  value: unknown,
): SchemaManifestAppTableName {
  // Temporary projection for insert-return verification in the still-Promise
  // writer. Delete it with that consumer's Result/Effect migration.
  return Result.getOrThrow(
    decodeStoredLogicalNameResult(deploymentId, value),
  );
}

function decodeStoredTableIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, SchemaManifestTableBindingCorruptionError> {
  return Result.try({
    try: () => decodeCatalogTableId(value),
    catch: (cause) => new SchemaManifestTableBindingCorruptionError(
      deploymentId,
      `invalid stored table ID: ${String(value)}`,
      { cause },
    ),
  });
}

function decodeStoredTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  // Same insert-return compatibility boundary as decodeStoredLogicalName.
  return Result.getOrThrow(decodeStoredTableIdResult(deploymentId, value));
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
