import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray } from "drizzle-orm";
import {
  decodeCatalogIndexId,
  decodeCatalogTableId,
  type CatalogIndexId,
  type CatalogTableId,
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

import type { FlarexMetadataDatabase } from "./deployments";
import {
  getPreparedSchemaManifestAppTableBindingsState,
  insertPlannedSchemaManifestAppTableBindings,
  lockSchemaManifestBindingDeployment,
  prepareSchemaManifestAppTableBindingsV1,
  readSchemaManifestAppTableBindings,
  type PlannedAppTableBinding,
  type PreparedSchemaManifestAppTableBindingsState,
} from "./schemaManifestTableBindings";
import { fxControlIndexes } from "./schema";
import {
  nextStableLogicalIndexCatalogId,
  readStableLogicalIndexCatalogHighWater,
  StableLogicalIndexCatalogCorruptionError,
} from "./stableLogicalIndexCatalogAllocation";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";
import { readStableTableCatalogHighWater } from "./stableTableCatalogAllocation";
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
  constructor(readonly stale: SchemaManifestAppSchemaBindingPlanStale) {
    super(stalePlanMessage(stale));
    this.name = "SchemaManifestAppSchemaBindingPlanStaleError";
  }
}

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
export async function applySchemaManifestAppSchemaBindingsV1InTransaction(
  tx: StableTableCatalogTransaction,
  prepared: PreparedSchemaManifestAppSchemaBindingsV1,
): Promise<SchemaManifestAppSchemaV1> {
  const state = preparedBindingStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedSchemaManifestAppSchemaBindingsError();
  }

  await lockSchemaManifestBindingDeployment(tx, state.deploymentId);
  const currentTables = await readSchemaManifestAppTableBindings(
    tx,
    state.deploymentId,
    state.tableState.tables.map((table) => table.logicalName),
  );
  const currentIndexes = await readAppIndexBindings(
    tx,
    state.deploymentId,
    state.indexes,
  );
  const applied: SchemaManifestAppSchemaBindingIdentity[] = [];
  const missing: SchemaManifestAppSchemaBindingIdentity[] = [];
  const missingTables = classifyTables(
    state.tableState.tables,
    currentTables,
    applied,
    missing,
  );
  const missingIndexes = classifyIndexes(
    state.indexes,
    currentIndexes,
    applied,
    missing,
  );
  if (missing.length === 0) {
    return state.manifest;
  }
  if (applied.length > 0) {
    throw new SchemaManifestAppSchemaBindingPlanStaleError({
      reason: "partiallyApplied",
      applied: freezeIdentities(applied),
      missing: freezeIdentities(missing),
    });
  }

  if (missingTables.length > 0) {
    const currentTableHighWater = await readStableTableCatalogHighWater(
      tx,
      state.deploymentId,
    );
    if (currentTableHighWater !== state.tableState.observedHighWater) {
      throw new SchemaManifestAppSchemaBindingPlanStaleError({
        reason: "tableCatalogHighWaterChanged",
        observedTableId: state.tableState.observedHighWater,
        currentTableId: currentTableHighWater,
      });
    }
  }
  if (missingIndexes.length > 0) {
    const currentIndexHighWater =
      await readStableLogicalIndexCatalogHighWater(tx, state.deploymentId);
    if (currentIndexHighWater !== state.observedIndexHighWater) {
      throw new SchemaManifestAppSchemaBindingPlanStaleError({
        reason: "indexCatalogHighWaterChanged",
        observedLogicalIndexId: state.observedIndexHighWater,
        currentLogicalIndexId: currentIndexHighWater,
      });
    }
  }

  await insertPlannedSchemaManifestAppTableBindings(
    tx,
    state.tableState,
    missingTables,
  );
  await insertPlannedAppIndexBindings(tx, state, missingIndexes);
  return state.manifest;
}

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

async function readAppIndexBindings(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexes: ReadonlyArray<ResolvedAppIndexDeclaration>,
): Promise<ReadonlyMap<string, CatalogIndexId>> {
  if (indexes.length === 0) return new Map();
  const tableIds = [...new Set(indexes.map((index) => index.tableId))];
  const requested = new Set(indexes.map(indexIdentityKey));
  const rows = await db
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
  const bindings = new Map<string, CatalogIndexId>();
  for (const row of rows) {
    if (row.deploymentId !== deploymentId) {
      throw new StableLogicalIndexCatalogCorruptionError(
        deploymentId,
        `cross-deployment row returned for ${row.deploymentId}`,
      );
    }
    const tableId = decodeStoredTableId(deploymentId, row.tableId);
    const key = indexIdentityKey({
      tableId,
      descriptor: row.descriptor,
    });
    if (!requested.has(key)) continue;
    if (bindings.has(key)) {
      throw new StableLogicalIndexCatalogCorruptionError(
        deploymentId,
        `duplicate logical identity for table ${tableId} descriptor ${row.descriptor}`,
      );
    }
    bindings.set(
      key,
      decodeStoredIndexId(deploymentId, row.logicalIndexId),
    );
  }
  return bindings;
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

function classifyTables(
  planned: ReadonlyArray<PlannedAppTableBinding>,
  current: ReadonlyMap<SchemaManifestAppTableName, CatalogTableId>,
  applied: SchemaManifestAppSchemaBindingIdentity[],
  missing: SchemaManifestAppSchemaBindingIdentity[],
): ReadonlyArray<PlannedAppTableBinding> {
  const stillMissing: PlannedAppTableBinding[] = [];
  for (const table of planned) {
    const currentTableId = current.get(table.logicalName) ?? null;
    if (!table.wasMissing) {
      if (currentTableId !== table.tableId) {
        throw new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "tableBindingChanged",
          logicalName: table.logicalName,
          plannedTableId: table.tableId,
          currentTableId,
        });
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
      throw new SchemaManifestAppSchemaBindingPlanStaleError({
        reason: "tableBindingChanged",
        logicalName: table.logicalName,
        plannedTableId: table.tableId,
        currentTableId,
      });
    }
  }
  return stillMissing;
}

function classifyIndexes(
  planned: ReadonlyArray<PlannedAppIndexBinding>,
  current: ReadonlyMap<string, CatalogIndexId>,
  applied: SchemaManifestAppSchemaBindingIdentity[],
  missing: SchemaManifestAppSchemaBindingIdentity[],
): ReadonlyArray<PlannedAppIndexBinding> {
  const stillMissing: PlannedAppIndexBinding[] = [];
  for (const index of planned) {
    const currentLogicalIndexId = current.get(indexIdentityKey(index)) ?? null;
    if (!index.wasMissing) {
      if (currentLogicalIndexId !== index.logicalIndexId) {
        throw indexBindingChanged(index, currentLogicalIndexId);
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
      throw indexBindingChanged(index, currentLogicalIndexId);
    }
  }
  return stillMissing;
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

async function insertPlannedAppIndexBindings(
  tx: StableTableCatalogTransaction,
  state: PreparedSchemaManifestAppSchemaBindingsState,
  indexes: ReadonlyArray<PlannedAppIndexBinding>,
): Promise<void> {
  if (indexes.length === 0) return;
  const rows = await tx
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
  const returned = new Map<string, CatalogIndexId>();
  for (const row of rows) {
    if (row.deploymentId !== state.deploymentId) {
      throw new StableLogicalIndexCatalogCorruptionError(
        state.deploymentId,
        `insert returned cross-deployment row for ${row.deploymentId}`,
      );
    }
    const tableId = decodeStoredTableId(state.deploymentId, row.tableId);
    const key = indexIdentityKey({
      tableId,
      descriptor: row.descriptor,
    });
    if (returned.has(key)) {
      throw new StableLogicalIndexCatalogCorruptionError(
        state.deploymentId,
        `insert returned duplicate logical identity for table ${tableId} descriptor ${row.descriptor}`,
      );
    }
    returned.set(
      key,
      decodeStoredIndexId(state.deploymentId, row.logicalIndexId),
    );
  }
  for (const index of indexes) {
    if (returned.get(indexIdentityKey(index)) !== index.logicalIndexId) {
      throw new StableLogicalIndexCatalogCorruptionError(
        state.deploymentId,
        `insert did not return planned binding ${index.tableId}/${index.descriptor}/${index.logicalIndexId}`,
      );
    }
  }
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

function decodeStoredIndexId(
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

function decodeStoredTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    );
  }
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
