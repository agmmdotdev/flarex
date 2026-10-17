import type { LogicalDocumentPointEvidence } from "./pointEvidence";
import { observeExecution } from "../../../execution/diagnostics/operation";
// Named execution diagnostics belong to explicit SDK composition. Local operations
// retain their lazy Effect body without rebuilding traced function definitions.
import { Effect, Option, Result, Schema } from "effect";
import { eq, sql } from "drizzle-orm";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { type LogicalMetadataKey, type LogicalMetadataReadDependency, type MetadataSequence } from "flarex-protocol/commit-protocol";
import { compileAppOrderedIndexBoundsV1, InvalidOrderedIndexRangeV1Error,
  OrderedIndexCodecV1InputError, OrderedIndexKeyTooLargeError,
  type OrderedIndexRangeExpressionV1 } from
  "flarex-protocol/ordered-index";
import { FlarexValueCodecV1Error } from "flarex-protocol/value";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import { isJsonArray, isJsonObject, jsonEqual, type Json, type JsonObject } from "flarex-protocol/json";
import { relationalReverseIndexes } from "flarex-protocol/internal/relational-schema";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { consumeBoundedAppRowsAtSnapshotInTransactionEffect, consumeCapturedAppRowsAtSnapshotEffect, readAppRowAtSnapshotInTransactionEffect, readBoundedCurrentAppRowsInTransactionEffect, MAX_BOUNDED_APP_ROW_READ_IDENTITIES,
  MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES,
  InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type AppRowReadResultV1, type AppRowRevisionV1, type ReadAppRowError } from "../appRows";
import { AppRowStorageCorruptionError } from "../appRowErrors";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../../unique/appUniqueConstraintDefinitions";
import type { LoweredCanonicalAppUniqueConstraintV1 } from "../../unique/appUniqueConstraintCommitV1";
import {
  readAppUniqueKeySlotInTransactionEffect,
} from "../../unique/appUniqueKeys";
import {
  AppUniqueKeyPersistenceError,
  AppUniqueKeyHashError,
} from "../../unique/appUniqueKeyErrors";
import type { AppUniqueConstraintIdV1, AppUniqueKeyProjectionV1 } from "../../unique/appUniqueKeyContract";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "../../../values/privateJsonData";
import {
  type PointCommitDependencyV1,
} from "../../materialization/model";
import type { LocatedAppIndexDefinitionV1 } from "../../indexes/appIndexDefinitions";

import { readLogicalIndexRange, readLogicalIndexPage, logicalIndexReadFailureReason, type LogicalIndexRead, type LogicalIndexPageRead } from "./indexReads";
import { readLogicalSearchRange, type LogicalSearchMember, type LogicalSearchRead } from "./searchReads";
import { readLogicalJsonContainsRange } from "./jsonContains";
import { selectLogicalJsonSearchDefinition, type LogicalSearchDefinition } from "./searchEntries";
import { decodeCapturedAppIndexSnapshotPageEffect,
  MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, type AppIndexRangeCursorV1, type AppIndexRangePageV1 } from "../../indexes/appIndexEntries";
import { decodeLogicalFindQuery, isLogicalRange, selectLogicalIndex, selectLogicalPageIndex, prepareLogicalQueryPredicate, logicalWhereValues, logicalSelectionWhere, selectLogicalUniqueValues, selectLogicalIndexValues, type LogicalSelectionValues, type LogicalWhere } from "./query";
import { prepareLogicalRelationalRead, logicalRelationalSelectionValues, type LogicalRelationalReadDemand } from "./relationalQuery";
import { decodeLogicalAggregate, sumLogicalRows } from "./aggregate";
import { relationalTextIdentity } from "./relationalRows";
import { prepareLogicalRelationalTableMechanics, hasPreparedLogicalRelationalTableMechanics,
  bindPreparedLogicalRelationalRows, canonicalizeLogicalRelationalRow, captureLogicalRelationalCanonicalRow,
  nativeLogicalRelationalCanonicalRow, captureLogicalRelationalActivityJson, lowerLogicalCanonicalUniqueKey, lowerLogicalCanonicalIndexKey,
  forgetLogicalCanonicalDerivedKeys, logicalUniqueKeyRetentionBytes } from "./relationalRows";
import { prepareLogicalRelationalForeignKeys, type LogicalRelationalForeignKey } from "./relationalForeignKeys";
import { runDrizzleStatementEffect } from "../../../database/drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../../../database/databaseTimestamp";
import { fxSystemScopeClocks } from "../../../database/schema";
import { hasProtectedScopeTransactionTimestampIssuer, protectedScopeTransactionTimestampObservationIdentity, readProtectedScopeTransactionTimestamp } from "../../../scope/scopeClock";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import type { BoundedRequestContext, PresentedTransactionId, BoundedRequestLifetime } from "../../../execution/preparation/boundedRequestLifetime";
import type { LogicalDocumentWorkingSetInput, LogicalRelationalStore, LogicalRelationalReadProgram, LogicalStorageReadDemand } from "./model";
import { attachLogicalDocumentRootEvaluator, consumeLogicalDocumentRootMetadataDependency } from "./rootEvaluator";
import { finiteMetadataTableKey, finiteMetadataAccessKey,
  finiteMetadataDefinitionKey, type PreparedFiniteMetadataProjection } from "../../../execution/finiteMetadataDependencies";
import { detachLogicalDocumentChanges } from "./detachChanges";
import { captureHostPreparationLifetime, PreparedHostRuntimeError } from "../../../execution/preparation/preparedHostRuntime";
import type { LogicalDocumentTable, PreparedLogicalDocumentReadMechanics, PreparedLogicalDocumentWriteMechanics,
  LogicalDocumentFailure } from "./model";
import { requirePreparedLogicalReadMetadata, type PreparedLogicalReadMetadata } from "../logicalReadMetadata";
const decodeRelationalChange = Schema.decodeUnknownResult(Schema.Literals(["insert", "upsert", "update", "upsertPreservingDeletion", "delete", "softDelete", "restore", "reconstitute"]));
const uniqueReadKey = (definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1) =>
  projected.kind === "claim"
    ? JSON.stringify([definition.uniqueConstraintDefinitionId, projected.localeKey, projected.encodedKey])
    : null;
const indexKeyWithinBounds = (key: string, bounds: LogicalIndexRead["bounds"]) =>
  (bounds.startInclusive === undefined || key >= String(bounds.startInclusive)) &&
  (bounds.endExclusive === undefined || key < String(bounds.endExclusive));

export interface PendingDocument {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly rowId: AppRowIdHexV1;
  readonly documentId: AppDocumentIdV1;
  readonly base: Readonly<{ kind: "live"; commitSeq: CommitSeq; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }> |
    Readonly<{ kind: "tombstone"; commitSeq: CommitSeq }> | null;
  readonly creationTime: AppCreationTimeV1;
  current: CanonicalFlarexValueV1 | null;
  deletedValue?: CanonicalFlarexValueV1;
  readonly attempts: number[];
  /** Only independently durable borrowed journals hydrate an overlay. */
  borrowedOverlay?: true;
}
export type LogicalDocumentChange = LogicalDocumentPointEvidence & (
  | Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }>
  | Readonly<{ kind: "deleted" }>
);
export interface LogicalDocumentAttempt {
  readonly ordinal: number;
  readonly documentId: AppDocumentIdV1;
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly before: CanonicalFlarexValueV1 | null;
  readonly after: CanonicalFlarexValueV1 | null;
}
export interface LogicalRelationalLifecycleObservation {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly key: Readonly<Record<string, string>>;
  readonly operation: "softDelete" | "restore";
  readonly beforeDeletedAt: string | null;
  readonly afterDeletedAt: string | null;
  readonly attemptOrdinal: number | null;
  /** Captured at an unchanged restore, before a later call can change the row. */
  readonly rowAtOperation: JsonObject | null;
}
/** Final pending rows already observed within this working set. Canonical
 * values are immutable; their point/index dependencies settle with changes. */
export interface LogicalDocumentObservedRow {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly value: JsonObject;
}
/** A successful executed relational selection, including genuine empty sets.
 * Its charged query and complete count remain owned by the original source. */
export interface LogicalRelationalReadObservation {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly query: Json;
  readonly total: number;
  readonly returned: number;
}
export interface LogicalDocumentChanges {
  /** Present only for the attempt-fixed finite execution profile. */
  readonly metadataDependencies?: readonly LogicalMetadataReadDependency[];
  readonly metadataWatermark?: MetadataSequence;
  readonly changes: readonly LogicalDocumentChange[];
  readonly attempts: readonly LogicalDocumentAttempt[];
  readonly lifecycle: readonly LogicalRelationalLifecycleObservation[];
  readonly observedRows: readonly LogicalDocumentObservedRow[];
  readonly relationalReads: readonly LogicalRelationalReadObservation[];
  readonly noFinalRows: readonly AppDocumentIdV1[];
  readonly dependencies: readonly LogicalDocumentPointEvidence[];
  readonly scans: readonly Readonly<{ tableId: CatalogTableId; frontier: CommitSeq | null }>[];
  readonly uniqueReads: readonly LogicalUniqueRead[];
  readonly indexReads: readonly LogicalIndexRead[];
  readonly pageReads: readonly LogicalIndexPageRead[];
  readonly searchReads: readonly LogicalSearchRead[];
  readonly setNull: readonly LogicalSetNullIntent[];
  readonly referenceReplacements: readonly LogicalReferenceReplacementIntent[];
}
export type LogicalDocumentActivity = Pick<LogicalDocumentChanges,
  "attempts" | "lifecycle" | "observedRows" | "relationalReads" | "setNull" | "referenceReplacements">;
export interface LogicalDocumentActivityCursor {
  /** Last row-use ordinal issued by this exact working-set owner. */
  readonly observations: number;
  readonly attempts: number;
  readonly lifecycle: number;
  readonly relationalReads: number;
  readonly setNull: number;
  readonly referenceReplacements: number;
}
declare const activityContributionBrand: unique symbol;
/** Only its original working-set owner can read this native contribution. */
export interface LogicalDocumentActivityContribution { readonly [activityContributionBrand]: true }
/** A sealed command decision; affected rows are selected only by the trusted
 * settlement owner after publication exclusion. */
export interface LogicalSetNullIntent {
  readonly sourceTableId: CatalogTableId;
  readonly sourceColumn: string;
  readonly targetTableId: CatalogTableId;
  readonly targetColumn: string;
  readonly targetKey: string;
}
/** The framework chooses one root and desired keys. Core selects and lowers
 * the complete affected set after publication exclusion. */
export interface LogicalReferenceReplacementIntent extends LogicalSetNullIntent {
  readonly desiredKeys: readonly string[];
}
export interface LogicalUniqueRead {
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly key: AppUniqueKeyProjectionV1;
  readonly owner: Readonly<{ tableId: CatalogTableId; rowId: AppRowIdHexV1 }> | null;
}
export interface LogicalDocuments<Failure> {
  readonly get: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<JsonObject | null, Failure>;
  readonly getMany: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    documentIds: readonly string[]) => Effect.Effect<readonly (JsonObject | null)[], Failure>;
  readonly find: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    query: Readonly<{ where: JsonObject; offset: number; limit: number }>) => Effect.Effect<Readonly<{ docs: readonly JsonObject[]; total: number }>, Failure>;
  readonly insert: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string, fields: unknown) => Effect.Effect<JsonObject, Failure>;
  readonly patch: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly replace: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly delete: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<void, Failure>;
}

export interface LogicalDocumentReadTestHooks<Failure> {
  /** Fault injection owned by tests; production frontiers invoke no foreign hook. */
  readonly beforeRead?: (selection: "point" | "batch" | "scan" | "index") => Effect.Effect<void, Failure>;
  readonly observeQuery?: (query: Readonly<{ readonly name: "currentCapture" | "snapshotRevision";
    readonly sql: string; readonly params: ReadonlyArray<unknown> }>) => void;
  readonly observeIndexQuery?: Parameters<typeof readLogicalIndexRange>[5];
}

interface PreparedReadMechanicsState {
  readonly closed?: never;
  readonly lifetime: NonNullable<Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>>;
  readonly tablesByName: Map<string, LogicalDocumentTable>;
  readonly tablesById: Map<CatalogTableId, LogicalDocumentTable>;
  readonly metadata: PreparedLogicalReadMetadata;
}
type ClosedReadMechanicsState = Readonly<{ closed: true; lifetime: PreparedReadMechanicsState["lifetime"] }>;
const preparedReadMechanics = new WeakMap<object, PreparedReadMechanicsState | ClosedReadMechanicsState>();
const readMechanicsDisposal = (prepared: PreparedLogicalDocumentReadMechanics) => () => {
  const state = preparedReadMechanics.get(prepared);
  if (state !== undefined && state.closed !== true)
    preparedReadMechanics.set(prepared, Object.freeze({ closed: true, lifetime: state.lifetime }));
};

interface PreparedWriteMechanicsState {
  readonly closed?: never;
  readonly projection: Pick<PreparedLogicalDocumentWriteMechanics,
    "tables" | "relationalCapabilities" | "searchDefinitions" | "indexes" | "unique">;
  readonly metadataProjections: readonly PreparedFiniteMetadataProjection[];
  readonly metadataByTable: ReadonlyMap<CatalogTableId, PreparedFiniteMetadataProjection>;
  readonly lifetimes: readonly NonNullable<Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>>[];
  readonly tablesByName: ReadonlyMap<string, LogicalDocumentTable>;
  readonly tablesById: ReadonlyMap<CatalogTableId, LogicalDocumentTable>;
  readonly indexesByTable: ReadonlyMap<CatalogTableId, readonly LocatedAppIndexDefinitionV1[]>;
  readonly uniqueByTable: ReadonlyMap<CatalogTableId, readonly LocatedAppUniqueConstraintDefinitionV1[]>;
  readonly indexCandidates: (tableId: CatalogTableId, fields: readonly string[]) => readonly LocatedAppIndexDefinitionV1[];
  readonly uniqueCandidates: (tableId: CatalogTableId, fields: readonly string[]) => readonly LocatedAppUniqueConstraintDefinitionV1[];
  readonly relationalAccess: (tableId: CatalogTableId, fields: readonly string[]) => import("./relationalQuery").LogicalRelationalReadAccess;
  readonly searchCandidates: (tableId: CatalogTableId, fields: readonly string[]) => readonly import("./searchEntries").LogicalSearchDefinition[];
  readonly foreignKeys: readonly LogicalRelationalForeignKey[];
}
type ClosedWriteMechanicsState = Readonly<{ closed: true; lifetimes: PreparedWriteMechanicsState["lifetimes"] }>;
const preparedWriteMechanics = new WeakMap<object, PreparedWriteMechanicsState | ClosedWriteMechanicsState>();
const emptyMechanicsTables: readonly LogicalDocumentTable[] = Object.freeze([]);
const emptyMechanicsIndexes: readonly LocatedAppIndexDefinitionV1[] = Object.freeze([]);
const emptyMechanicsUnique: readonly LocatedAppUniqueConstraintDefinitionV1[] = Object.freeze([]);
const emptyMechanicsSearch: PreparedLogicalDocumentWriteMechanics["searchDefinitions"] = Object.freeze([]);
// This closure holds only its inert issuer key. Actual disposal can release the
// payload even when a caller retains the capability or its scalar accessors.
function makeWriteMechanicsToken() {
  const live = () => {
    const state = preparedWriteMechanics.get(prepared);
    return state?.closed === true ? undefined : state;
  };
  // SAFETY: only the private registry authenticates this immutable capability.
  const prepared = Object.freeze({
    get tables() { return live()?.projection.tables ?? emptyMechanicsTables; },
    get relationalCapabilities() { return live()?.projection.relationalCapabilities; },
    get searchDefinitions() { return live()?.projection.searchDefinitions ?? emptyMechanicsSearch; },
    get indexes() { return live()?.projection.indexes ?? emptyMechanicsIndexes; },
    get unique() { return live()?.projection.unique ?? emptyMechanicsUnique; },
    tableName: (tableId: CatalogTableId) => live()?.tablesById.get(tableId)?.logicalName,
    tableId: (logicalName: string) => live()?.tablesByName.get(logicalName)?.tableId,
  }) as PreparedLogicalDocumentWriteMechanics;
  return prepared;
}
const retireWriteMechanics = (prepared: PreparedLogicalDocumentWriteMechanics): void => {
  const state = preparedWriteMechanics.get(prepared);
  if (state === undefined || state.closed === true) return;
  preparedWriteMechanics.set(prepared, Object.freeze({ closed: true, lifetimes: state.lifetimes }));
  writeCombinations.delete(prepared);
  writeSources.delete(prepared);
};
const writeMechanicsDisposal = (prepared: PreparedLogicalDocumentWriteMechanics) => () => retireWriteMechanics(prepared);
const closedMechanicsFailure = <Failure>(state: ClosedWriteMechanicsState, error: LogicalDocumentFailure<Failure>): Failure => {
  for (const lifetime of state.lifetimes) {
    const checked = lifetime.checkOpen();
    if (Result.isFailure(checked)) return error(checked.failure.reason === "closed" ? "closed" : "resourceFailure", checked.failure);
  }
  return error("closed");
};
type WriteMechanicsInput = Readonly<{ tables: readonly LogicalDocumentTable[];
  metadataProjection?: PreparedFiniteMetadataProjection;
  metadataProjections?: readonly PreparedFiniteMetadataProjection[];
  relationalCapabilities?: readonly import("flarex-protocol/internal/relational-schema").RelationalPersistenceCapability[];
  searchDefinitions?: readonly import("./searchEntries").LogicalSearchDefinition[];
  indexes: readonly LocatedAppIndexDefinitionV1[]; unique: readonly LocatedAppUniqueConstraintDefinitionV1[] }>;
const groupedMechanics = <Value>(values: readonly Value[], tableFor: (value: Value) => CatalogTableId) => {
  const groups = new Map<CatalogTableId, Value[]>();
  for (const value of values) {
    const tableId = tableFor(value), group = groups.get(tableId);
    if (group === undefined) groups.set(tableId, [value]); else group.push(value);
  }
  return new Map([...groups].map(([tableId, group]) => [tableId, Object.freeze(group)]));
};
/** Prefix lookups narrow existing planner inputs; original catalog ordinals
 * preserve first-eligible and tie behavior in the query owner. */
const fieldCandidates = <Value>(values: readonly Value[], fieldFor: (value: Value) => string | readonly string[] | undefined,
  retainedEntries: Array<Readonly<{ field: string; ordinals: readonly number[] }>>) => {
  const byField = new Map<string, readonly Readonly<{ value: Value; ordinal: number }>[]>();
  const groups = new Map<string, Array<Readonly<{ value: Value; ordinal: number }>>>();
  for (const [ordinal, value] of values.entries()) {
    const field = fieldFor(value);
    if (field === undefined) continue;
    for (const name of typeof field === "string" ? [field] : field) {
      const group = groups.get(name), member = { value, ordinal };
      if (group === undefined) groups.set(name, [member]); else group.push(member);
    }
  }
  for (const [field, members] of groups) {
    byField.set(field, Object.freeze(members));
    retainedEntries.push({ field, ordinals: members.map(member => member.ordinal) });
  }
  return (fields: readonly string[]) => {
    const candidates = new Map<number, Value>();
    for (const field of fields) for (const member of byField.get(field) ?? []) candidates.set(member.ordinal, member.value);
    return [...candidates].toSorted(([left], [right]) => left - right).map(([, value]) => value);
  };
};
const issueWriteMechanics = Effect.fnUntraced(function* <Failure>(
  input: WriteMechanicsInput, lifetimes: PreparedWriteMechanicsState["lifetimes"], error: LogicalDocumentFailure<Failure>,
) {
  for (const lifetime of lifetimes) yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
    error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  const capabilities = input.relationalCapabilities === undefined ? undefined : Object.freeze([...input.relationalCapabilities]);
  const tables = Object.freeze(input.tables.map(table => {
    if (table.relational === undefined) return Object.freeze({ ...table });
    const relationalMechanics = table.relationalMechanics ?? prepareLogicalRelationalTableMechanics(table.relational, capabilities ?? []);
    return Object.freeze({ ...table, relational: relationalMechanics.table, relationalMechanics });
  }));
  const tablesByName = new Map(tables.map(table => [table.logicalName, table]));
  const tablesById = new Map(tables.map(table => [table.tableId, table]));
  if (tablesByName.size !== tables.length || tablesById.size !== tables.length)
    return yield* Effect.fail(error("invalidAuthority"));
  const metadataProjections = Object.freeze([...(input.metadataProjections ??
    (input.metadataProjection === undefined ? [] : [input.metadataProjection]))]);
  // Retain the original first matching issuer, never an accepting verdict.
  const metadataByTable = new Map<CatalogTableId, PreparedFiniteMetadataProjection>();
  const metadataRouting: { tableId: CatalogTableId; projectionOrdinal: number }[] = [];
  for (const table of tables) {
    const projectionOrdinal = metadataProjections.findIndex(projection =>
      finiteMetadataTableKey(projection, table.tableId, "table") !== null);
    const projection = metadataProjections[projectionOrdinal];
    if (projection !== undefined) {
      metadataByTable.set(table.tableId, projection);
      metadataRouting.push({ tableId: table.tableId, projectionOrdinal });
    }
  }
  const indexes = Object.freeze([...input.indexes]), unique = Object.freeze([...input.unique]);
  const searchDefinitions = Object.freeze([...(input.searchDefinitions ?? [])]);
  const indexesByTable = groupedMechanics(indexes, index => index.access.tableId);
  const uniqueByTable = groupedMechanics(unique, definition => definition.tableId);
  const searchByTable = groupedMechanics(searchDefinitions, definition => definition.tableId);
  const candidateEntries: Array<Readonly<{ field: string; ordinals: readonly number[] }>> = [];
  const indexFields = new Map([...indexesByTable].map(([tableId, definitions]) => [tableId,
    fieldCandidates(definitions, definition => {
      const first = definition.physicalSpec.orderedFields[0];
      return definition.access.kind === "developer" && first?.kind === "documentPath" ? first.path : undefined;
    }, candidateEntries)]));
  const uniqueFields = new Map([...uniqueByTable].map(([tableId, definitions]) => [tableId,
    fieldCandidates(definitions, definition => definition.physicalSpec.orderedFields[0], candidateEntries)]));
  const searchFields = new Map([...searchByTable].map(([tableId, definitions]) => [tableId,
    fieldCandidates(definitions, definition => definition.columns, candidateEntries)]));
  const relationalFields = new Map(tables.flatMap(table => table.relational === undefined ? [] : [[table.tableId, {
    indexes: fieldCandidates(table.relational.indexes, index => index.columns[0]?.columnId, candidateEntries),
    keys: fieldCandidates(table.relational.keys, key => key.columns[0]?.columnId, candidateEntries),
    scalarColumns: new Set<string>(relationalReverseIndexes(table.relational).map(index => index.column.columnId)),
  }] as const]));
  const indexCandidates = (tableId: CatalogTableId, fields: readonly string[]) => indexFields.get(tableId)?.(fields) ?? [];
  const uniqueCandidates = (tableId: CatalogTableId, fields: readonly string[]) => uniqueFields.get(tableId)?.(fields) ?? [];
  const searchCandidates = (tableId: CatalogTableId, fields: readonly string[]) => searchFields.get(tableId)?.(fields) ?? [];
  const relationalAccess = (tableId: CatalogTableId, fields: readonly string[]) => {
    const access = relationalFields.get(tableId);
    return { indexes: access?.indexes(fields) ?? [], keys: access?.keys(fields) ?? [],
      scalarColumns: fields.filter(field => access?.scalarColumns.has(field)) };
  };
  const foreignKeys = yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(tables, error));
  for (const foreignKey of foreignKeys) {
    const reverse = yield* Effect.fromResult(selectLogicalIndex(indexesByTable.get(foreignKey.source.tableId) ?? [],
      foreignKey.source.tableId, { [foreignKey.source.column]: "" }, error));
    const target = yield* Effect.fromResult(selectLogicalIndex(indexesByTable.get(foreignKey.target.tableId) ?? [],
      foreignKey.target.tableId, { [foreignKey.target.column]: "" }, error));
    if (Option.isNone(reverse) || Option.isNone(target)) return yield* Effect.fail(error("invalidInput"));
  }
  // Charge newly retained wrappers, grouped lookup entries and FK bindings. The
  // authenticated schema/index bodies remain owned by their source catalog.
  const lifetime = lifetimes[0];
  if (lifetime !== undefined) yield* Effect.fromResult(lifetime.charge({
    tables: tables.map(table => ({ tableId: table.tableId, logicalName: table.logicalName })), foreignKeys,
    indexes: indexes.map(index => index.indexDefinitionId), unique: unique.map(definition => definition.uniqueConstraintDefinitionId),
    search: searchDefinitions.map(definition => definition.logicalIndexId), capabilities: capabilities ?? [],
    candidates: candidateEntries,
    relationalFields: [...relationalFields].map(([tableId, fields]) => ({ tableId, scalarColumns: [...fields.scalarColumns] })),
    groupedIndexes: [...indexesByTable].map(([tableId, definitions]) => ({ tableId, count: definitions.length })),
    groupedUnique: [...uniqueByTable].map(([tableId, definitions]) => ({ tableId, count: definitions.length })),
    groupedSearch: [...searchByTable].map(([tableId, definitions]) => ({ tableId, count: definitions.length })),
    metadataRouting,
  })).pipe(Effect.mapError(cause => error("resourceFailure", cause)));
  const prepared = makeWriteMechanicsToken();
  preparedWriteMechanics.set(prepared, { projection: Object.freeze({ tables, relationalCapabilities: capabilities,
    searchDefinitions, indexes, unique }), metadataProjections, metadataByTable,
    lifetimes, tablesByName, tablesById, indexesByTable, uniqueByTable, foreignKeys,
    indexCandidates, uniqueCandidates, searchCandidates, relationalAccess });
  for (const owner of lifetimes) {
    const registered = owner.onDispose(writeMechanicsDisposal(prepared));
    if (Result.isFailure(registered)) retireWriteMechanics(prepared);
    yield* Effect.fromResult(registered).pipe(Effect.mapError(cause =>
      error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  }
  return prepared;
}, work => observeExecution("LogicalDocuments.issueWriteMechanics", work));

/** Source preparation owns complete writable mechanics once. Request-owned
 * preparation is retained for full profiles; finite reuse requires a host lease. */
export const prepareLogicalWriteMechanics = Effect.fnUntraced(function* <Failure>(
  input: WriteMechanicsInput, error: LogicalDocumentFailure<Failure>,
) {
  const lifetime = yield* captureHostPreparationLifetime();
  return yield* issueWriteMechanics(input, lifetime === undefined ? [] : [lifetime], error);
}, work => observeExecution("LogicalDocuments.prepareWriteMechanics", work));
interface WriteMechanicsCombination {
  pair?: PreparedLogicalDocumentWriteMechanics;
  readonly triples: WeakMap<PreparedLogicalDocumentWriteMechanics, PreparedLogicalDocumentWriteMechanics>;
}
const writeCombinations = new WeakMap<PreparedLogicalDocumentWriteMechanics,
  WeakMap<PreparedLogicalDocumentWriteMechanics, WriteMechanicsCombination>>();
const writeSources = new WeakMap<PreparedLogicalDocumentWriteMechanics, ReadonlySet<PreparedLogicalDocumentWriteMechanics>>();
const writeCombinationEviction = (cache: WriteMechanicsCombination,
  prepared: PreparedLogicalDocumentWriteMechanics, third: PreparedLogicalDocumentWriteMechanics | undefined) => () => {
  if (third === undefined) { if (cache.pair === prepared) delete cache.pair; }
  else cache.triples.delete(third);
};
/** A bounded native source graph reuses the exact ordered source combination;
 * no attempt-local state or mutable map escapes into this retained catalog. */
export const combineLogicalWriteMechanics = Effect.fnUntraced(function* <Failure>(
  inputs: readonly PreparedLogicalDocumentWriteMechanics[], error: LogicalDocumentFailure<Failure>,
) {
  if (inputs.length < 1 || inputs.length > 3 || new Set(inputs).size !== inputs.length)
    return yield* Effect.fail(error("invalidAuthority"));
  const lifetimes: PreparedWriteMechanicsState["lifetimes"][number][] = [];
  const states: PreparedWriteMechanicsState[] = [];
  for (const input of inputs) {
    const state = preparedWriteMechanics.get(input);
    if (state === undefined) return yield* Effect.fail(error("invalidAuthority"));
    if (state.closed === true) return yield* Effect.fail(closedMechanicsFailure(state, error));
    states.push(state);
    for (const lifetime of state.lifetimes) {
      yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause => error("closed", cause)));
      if (!lifetimes.includes(lifetime)) lifetimes.push(lifetime);
    }
  }
  const first = inputs[0]!;
  if (inputs.length === 1) return first;
  const second = inputs[1]!, third = inputs[2];
  let secondMap = writeCombinations.get(first);
  if (secondMap === undefined) { secondMap = new WeakMap(); writeCombinations.set(first, secondMap); }
  let combined = secondMap.get(second);
  if (combined === undefined) { combined = { triples: new WeakMap() }; secondMap.set(second, combined); }
  const cached = third === undefined ? combined.pair : combined.triples.get(third);
  if (cached !== undefined) return cached;
  const capabilities = inputs.some(input => input.relationalCapabilities !== undefined)
    ? inputs.flatMap(input => input.relationalCapabilities ?? []) : undefined;
  const prepared = yield* issueWriteMechanics({ tables: inputs.flatMap(input => input.tables),
    metadataProjections: [...new Set(states.flatMap(state => state.metadataProjections))],
    ...(capabilities === undefined ? {} : { relationalCapabilities: capabilities }),
    indexes: inputs.flatMap(input => input.indexes), unique: inputs.flatMap(input => input.unique),
    searchDefinitions: inputs.flatMap(input => input.searchDefinitions) }, Object.freeze(lifetimes), error);
  writeSources.set(prepared, new Set(inputs));
  const cache = combined;
  const evict = writeCombinationEviction(cache, prepared, third);
  for (const owner of lifetimes) {
    const registered = owner.onDispose(evict);
    if (Result.isFailure(registered)) { retireWriteMechanics(prepared); evict(); }
    yield* Effect.fromResult(registered).pipe(Effect.mapError(cause =>
      error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  }
  if (third === undefined) cache.pair = prepared; else cache.triples.set(third, prepared);
  return prepared;
}, work => observeExecution("LogicalDocuments.combineWriteMechanics", work));

/** Compact read hosts retain row mechanics only after an actual table access.
 * The existing working set and compiler remain the native execution owner. */
export const prepareLogicalReadMechanics = Effect.fnUntraced(function* (
  metadata: PreparedLogicalReadMetadata,
) {
  yield* requirePreparedLogicalReadMetadata(metadata);
  const lifetime = yield* captureHostPreparationLifetime();
  if (lifetime === undefined) return yield* Effect.fail(new PreparedHostRuntimeError({ reason: "invalidPayload" }));
  const tables: readonly LogicalDocumentTable[] = Object.freeze([]);
  const searchDefinitions: readonly import("./searchEntries").LogicalSearchDefinition[] = Object.freeze([]);
  // SAFETY: the private registry authenticates the issued lazy mechanics.
  const prepared = Object.freeze({ tables, searchDefinitions,
    relationalCapabilities: metadata.root.kind === "relational" ? Object.freeze([]) : undefined,
  }) as PreparedLogicalDocumentReadMechanics;
  preparedReadMechanics.set(prepared, { lifetime, metadata, tablesByName: new Map(), tablesById: new Map() });
  const dispose = readMechanicsDisposal(prepared);
  const registered = lifetime.onDispose(dispose);
  if (Result.isFailure(registered)) dispose();
  yield* Effect.fromResult(registered);
  return prepared;
}, work => observeExecution("LogicalDocuments.prepareLazyReadMechanics", work));

/** One pending document/index/constraint working set for a trusted relational
 * profile. Native execution, schema validation and settlement stay with their owners. */
export const makeLogicalDocumentWorkingSet = Effect.fnUntraced(function* <Failure>(
  configuration: LogicalDocumentWorkingSetInput<Failure>,
  creationTime: AppCreationTimeV1,
  uniqueInput: readonly LocatedAppUniqueConstraintDefinitionV1[],
  indexInput: readonly LocatedAppIndexDefinitionV1[],
  testHooks?: LogicalDocumentReadTestHooks<Failure>,
  constructionTx?: FlarexMetadataTransaction,
) {
  const readProfile = configuration.readReadiness?.kind === "queryRequired" ? configuration.readReadiness : undefined;
  const finiteProfile = configuration.readReadiness?.kind === "finiteQueryRequired" ? configuration.readReadiness : undefined;
  const readMechanics = readProfile === undefined ? undefined : preparedReadMechanics.get(readProfile.mechanics);
  const selectedWriteMechanics = configuration.writeMechanics ?? finiteProfile?.mechanics;
  const writeMechanics = selectedWriteMechanics === undefined ? undefined : preparedWriteMechanics.get(selectedWriteMechanics);
  if (readMechanics?.closed === true) {
    yield* Effect.fromResult(readMechanics.lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      configuration.error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
    return yield* Effect.fail(configuration.error("closed"));
  }
  if (writeMechanics?.closed === true) return yield* Effect.fail(closedMechanicsFailure(writeMechanics, configuration.error));
  if (readProfile !== undefined) {
    if (configuration.lifetime.mode !== "read" || readMechanics === undefined ||
      configuration.tables !== readProfile.mechanics.tables ||
      configuration.relationalCapabilities !== readProfile.mechanics.relationalCapabilities)
      return yield* Effect.fail(configuration.error("invalidAuthority"));
    yield* Effect.fromResult(readMechanics.lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      configuration.error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  }
  if (finiteProfile !== undefined) {
    if (configuration.lifetime.mode !== "write" || writeMechanics === undefined || writeMechanics.lifetimes.length === 0 ||
      configuration.rootEvaluator === undefined || configuration.snapshotCommitSeq === undefined ||
      selectedWriteMechanics !== finiteProfile.mechanics)
      return yield* Effect.fail(configuration.error("invalidAuthority"));
  }
  if (selectedWriteMechanics !== undefined) {
    if (readProfile !== undefined || writeMechanics === undefined ||
      configuration.tables !== selectedWriteMechanics.tables ||
      configuration.relationalCapabilities !== selectedWriteMechanics.relationalCapabilities ||
      configuration.searchDefinitions !== selectedWriteMechanics.searchDefinitions ||
      indexInput !== selectedWriteMechanics.indexes || uniqueInput !== selectedWriteMechanics.unique)
      return yield* Effect.fail(configuration.error("invalidAuthority"));
    for (const lifetime of writeMechanics.lifetimes) yield* Effect.fromResult(lifetime.checkOpen()).pipe(
      Effect.mapError(cause => configuration.error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  }
  // Only this working set's captured storage mechanics may enter a frontier.
  // Its request lifetime rejects overlapping operations before they reach it.
  let frontierTx: FlarexMetadataTransaction | undefined;
  const runRead = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
    frontierTx !== undefined ? work(frontierTx) :
      configuration.tx === undefined ? configuration.readTransaction(work, demand) : work(configuration.tx);
  const runConstructionRead = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
    constructionTx === undefined ? runRead(work) : work(constructionTx);
  const state = Object.freeze({ ...configuration, limits: Object.freeze({ ...configuration.limits }),
    relationalCapabilities: selectedWriteMechanics?.relationalCapabilities ?? readProfile?.mechanics.relationalCapabilities ?? (configuration.relationalCapabilities === undefined ? undefined : Object.freeze(structuredClone(configuration.relationalCapabilities))),
    tables: selectedWriteMechanics?.tables ?? readProfile?.mechanics.tables ?? Object.freeze(configuration.tables.map(table => {
      if (table.relational === undefined) return Object.freeze(table);
      const relational = table.relationalMechanics === undefined ? structuredClone(table.relational) : table.relational;
      const relationalMechanics = table.relationalMechanics ??
        prepareLogicalRelationalTableMechanics(relational, configuration.relationalCapabilities ?? []);
      return Object.freeze({ ...table, relational, relationalMechanics });
    })) });
  // Borrowed readTransaction authenticates inside its storage transaction;
  // only a directly supplied native transaction needs this separate guard.
  const requireReadAdmission = state.tx === undefined ? Effect.void : state.requireAdmission;
  const requireReadDemand = (tx: FlarexMetadataTransaction, demand: LogicalStorageReadDemand) => observeExecution("LogicalDocuments.requireReadDemand", Effect.gen(function* () {
    if (demand.kind !== "clock") {
      yield* Effect.fromResult(consumeTableMetadataResult(demand.tableId, "table"));
      if (demand.kind === "index") yield* Effect.fromResult(consumeDefinitionMetadataResult(demand.tableId, "index", demand.indexDefinitionId));
      if (demand.kind === "unique") yield* Effect.fromResult(consumeDefinitionMetadataResult(demand.tableId, "unique", demand.uniqueConstraintDefinitionId));
    }
    if (state.readReadiness?.kind === "queryRequired") yield* state.readReadiness.requireDemand(tx, demand);
  }));
  const uniqueDefinitions = selectedWriteMechanics?.unique ?? Object.freeze([...uniqueInput]);
  const indexDefinitions = selectedWriteMechanics?.indexes ?? Object.freeze([...indexInput]);
  const indexesForTable = (tableId: CatalogTableId) => writeMechanics?.indexesByTable.get(tableId) ?? (writeMechanics === undefined ? indexDefinitions : []);
  const uniqueForTable = (tableId: CatalogTableId) => writeMechanics?.uniqueByTable.get(tableId) ?? (writeMechanics === undefined ? uniqueDefinitions : []);
  const searchForTable = (tableId: CatalogTableId, fields: readonly string[]) =>
    writeMechanics?.searchCandidates(tableId, fields) ?? state.searchDefinitions ?? [];
  // A borrowed caller may construct inside its already checked short transaction.
  // The transaction is used only for construction and pending-row hydration;
  // returned operations always use the ordinary checked readTransaction.
  if (constructionTx === undefined) yield* state.requireAdmission;
  else if (state.tx !== undefined) return yield* Effect.fail(state.error("invalidAuthority"));
  const root = state.rootEvaluator === undefined ? undefined : state.rootAttempt === undefined ||
    state.rootAttemptFence === undefined || state.snapshotCommitSeq === undefined ? null :
      attachLogicalDocumentRootEvaluator(state.rootEvaluator, { attempt: state.rootAttempt,
        scopeId: state.scopeId, snapshotCommitSeq: state.snapshotCommitSeq, attemptFence: state.rootAttemptFence });
  if (root === null || root !== undefined && state.pendingRows !== undefined)
    return yield* Effect.fail(state.error("invalidAuthority"));
  if (root?.pins.metadataWatermark !== undefined && (writeMechanics?.metadataProjections.length ?? 0) === 0)
    return yield* Effect.fail(state.error("invalidAuthority"));
  const projectionForTable = (tableId: CatalogTableId) => writeMechanics?.metadataByTable.get(tableId);
  const consumeMetadataResult = (projection: PreparedFiniteMetadataProjection, key: LogicalMetadataKey): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    return consumeLogicalDocumentRootMetadataDependency(root, projection, key).pipe(
      Result.mapError(cause => error("invalidAuthority", typeof cause === "string" ? undefined : cause)));
  };
  const consumeTableMetadataResult = (tableId: CatalogTableId, kind: "table" | "writeClosure"): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    const projection = projectionForTable(tableId), key = projection === undefined ? null : finiteMetadataTableKey(projection, tableId, kind);
    if (projection === undefined || key === null) return Result.fail(error("invalidAuthority"));
    return Result.flatMap(consumeMetadataResult(projection, key), () => {
      const policy = finiteMetadataTableKey(projection, tableId, "sourcePolicy");
      return policy === null ? Result.fail(error("invalidAuthority")) : consumeMetadataResult(projection, policy);
    });
  };
  const consumeDefinitionMetadataResult = (tableId: CatalogTableId, kind: "index" | "unique", definitionId: number): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    const projection = projectionForTable(tableId), key = projection === undefined ? null : finiteMetadataDefinitionKey(projection, tableId, kind, definitionId);
    return projection === undefined || key === null ? Result.fail(error("invalidAuthority")) : consumeMetadataResult(projection, key);
  };
  const consumeAccessMetadataResult = (tableId: CatalogTableId, families: readonly string[], fields: readonly string[]) => Result.gen(function* () {
    if (root?.pins.metadataWatermark === undefined) return;
    const projection = projectionForTable(tableId);
    if (projection === undefined) { yield Result.fail(error("invalidAuthority")); return; }
    const selectedFields = new Set(fields);
    for (const family of families) for (const field of selectedFields) {
      const key = finiteMetadataAccessKey(projection, tableId, family, field);
      if (key === null) { yield Result.fail(error("invalidAuthority")); return; }
      // No success value is needed: yield the Result directly to the owning
      // interpreter, preserving its immediate refusal and iterator behavior.
      yield consumeMetadataResult(projection, key);
    }
  });
  const consumeAccessMetadata = (tableId: CatalogTableId, families: readonly string[], fields: readonly string[]) =>
    observeExecution("LogicalDocuments.consumeAccessMetadata", Effect.suspend(() =>
      Effect.fromResult(consumeAccessMetadataResult(tableId, families, fields))));
  const foreignKeys = writeMechanics?.foreignKeys ?? (readProfile === undefined ? yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(state.tables, state.error)) : []);
  for (const foreignKey of writeMechanics === undefined ? foreignKeys : []) {
    const reverse = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, foreignKey.source.tableId,
      { [foreignKey.source.column]: "" }, state.error));
    const target = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, foreignKey.target.tableId,
      { [foreignKey.target.column]: "" }, state.error));
    if (Option.isNone(reverse) || Option.isNone(target)) return yield* Effect.fail(state.error("invalidInput"));
  }
  const { lifetime, tables, error } = state;
  const callIdentityLimit = state.limits.identities;
  const limits = Object.freeze({ ...state.limits, identities: root?.limits.identities ?? state.limits.identities });
  let transactionTimeLoaded = false;
  type NativeTimestampObservation = Readonly<{ tx: FlarexMetadataTransaction; identity: symbol }>;
  let nativeTimestampObservation: NativeTimestampObservation | undefined;
  const cachedTransactionTime = yield* Effect.cached(Effect.gen(function* () {
    if (finiteProfile !== undefined) {
      const captured = yield* finiteProfile.captureStorage({ kind: "transactionTime" }, { kind: "clock" });
      const value = databaseTimestampFromUnknown(captured.timestamp);
      if (value === null) return yield* Effect.fail(error("storedCorruption"));
      transactionTimeLoaded = true;
      return value.toISOString();
    }
    // Native snapshot and write entries lend only their original transaction
    // time. Unissued ordinary transactions retain their own SQL observation;
    // known revoked native issuers never fall back to it.
    const captured = yield* runStorageRead<Readonly<{ timestamp: unknown; observation: NativeTimestampObservation | undefined }>, Failure>(
      { kind: "clock" }, undefined, tx => readProfile !== undefined || hasProtectedScopeTransactionTimestampIssuer(tx)
      ? Effect.gen(function* () {
        const identity = yield* Effect.fromResult(protectedScopeTransactionTimestampObservationIdentity(tx, state.scopeId))
          .pipe(Effect.mapError(cause => error("invalidAuthority", cause)));
        const timestamp = yield* Effect.fromResult(readProtectedScopeTransactionTimestamp(tx, state.scopeId, identity))
          .pipe(Effect.mapError(cause => error("invalidAuthority", cause)));
        return { timestamp, observation: { tx, identity } };
      })
      : runDrizzleStatementEffect(tx.select({ timestamp: sql<unknown>`current_timestamp` })
        .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, state.scopeId)), cause => error("statementFailure", cause))
        .pipe(Effect.map(result => ({ timestamp: result[0]?.timestamp, observation: undefined }))));
    const value = databaseTimestampFromUnknown(captured.timestamp);
    if (value === null) return yield* Effect.fail(error("storedCorruption"));
    nativeTimestampObservation = captured.observation;
    transactionTimeLoaded = true;
    return value.toISOString();
  }));
  // The cached value does not outlive its original native issuer. The request
  // operation already checks admission; this pure owner check adds no SQL demand.
  const transactionTime = Effect.suspend(() => nativeTimestampObservation === undefined ? cachedTransactionTime
    : Effect.fromResult(readProtectedScopeTransactionTimestamp(nativeTimestampObservation.tx, state.scopeId, nativeTimestampObservation.identity))
      .pipe(Effect.mapError(cause => error("invalidAuthority", cause)), Effect.andThen(cachedTransactionTime)));
  const rows = root?.rows ?? new Map<AppDocumentIdV1, PendingDocument>();
  const setNull: LogicalSetNullIntent[] = root?.setNull ?? [];
  const referenceReplacements: LogicalReferenceReplacementIntent[] = root?.referenceReplacements ?? [];
  let activityGeneration = 0;
  const runOperation: BoundedRequestLifetime<Failure>["operation"] = (context, id, mode, work) =>
    lifetime.operation(context, id, mode, state.requireAdmission.pipe(Effect.flatMap(() =>
      closed || root?.closed ? Effect.fail(error("closed")) : setNull.length > 0 || referenceReplacements.length > 0
        ? Effect.fail(error("invalidAuthority")) : Effect.suspend(() => {
          // A read can hydrate another row, and a sibling can write through the
          // same root. Invalidate before every admitted operation, including a
          // failed one that may already have produced tentative activity.
          if (root === undefined) activityGeneration++;
          else root.activityGeneration++;
          return work;
        }))));
  const requirePendingDeletion = (documentId: string) => observeExecution("LogicalDocuments.requirePendingDeletion", Effect.gen(function* () {
    yield* state.requireAdmission;
    if (closed || root?.closed) return yield* Effect.fail(error("closed"));
    if (setNull.length > 0 || referenceReplacements.length > 0) return yield* Effect.fail(error("invalidAuthority"));
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    const row = rows.get(identity.id);
    if (row === undefined || row.current !== null || row.attempts.length === 0) return yield* Effect.fail(error("invalidAuthority"));
    return Object.freeze({ documentId: row.documentId, tableName: row.tableName });
  }));
  const scanned = root?.scanned ?? new Map<CatalogTableId, CommitSeq>();
  const dependencies = root?.dependencies ?? new Map<AppDocumentIdV1, LogicalDocumentPointEvidence>();
  const scans = root?.scans ?? new Map<CatalogTableId, CommitSeq | null>();
  const uniqueReads = root?.uniqueReads ?? new Map<string, LogicalUniqueRead>();
  const indexReads = root?.indexReads ?? new Map<string, LogicalIndexRead>();
  const pageReads: LogicalIndexPageRead[] = root?.pageReads ?? [];
  const searchReads: LogicalSearchRead[] = root?.searchReads ?? [];
  const attempts: LogicalDocumentAttempt[] = root?.attempts ?? [];
  const lifecycle: LogicalRelationalLifecycleObservation[] = root?.lifecycle ?? [];
  const relationalReads: LogicalRelationalReadObservation[] = root?.relationalReads ?? [];
  const localCursor = Object.freeze({ attempts: attempts.length, lifecycle: lifecycle.length, relationalReads: relationalReads.length,
    dependencies: dependencies.size, scans: scans.size, uniqueReads: uniqueReads.size,
    indexReads: indexReads.size, pageReads: pageReads.length, searchReads: searchReads.length,
    setNull: setNull.length, referenceReplacements: referenceReplacements.length });
  let inserted = 0;
  const nextCreationTime = () => creationTime + (root === undefined ? inserted++ : root.inserted++);
  let closed = false;
  const loadReadTable = (name: string | CatalogTableId) => observeExecution("LogicalDocuments.loadReadTable", Effect.gen(function* () {
    const metadata = readMechanics?.metadata;
    if (metadata === undefined || readMechanics === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const frame = yield* (typeof name === "string" ? metadata.table(name) : metadata.tableById(name)).pipe(
      Effect.mapError(cause => error(cause.reason === "closed" ? "closed" : "invalidAuthority", cause)));
    const existing = readMechanics.tablesById.get(frame.tableId);
    if (existing !== undefined) return existing;
    const relational = frame.kind === "relational" ? frame.readSchema.tables[0] : undefined;
    if (frame.kind === "relational" && relational === undefined) return yield* Effect.fail(error("storedCorruption"));
    const table: LogicalDocumentTable = Object.freeze({ tableId: frame.tableId, logicalName: frame.localName,
      ...(relational === undefined ? {} : { relational, relationalMechanics: prepareLogicalRelationalTableMechanics(relational,
        frame.kind === "relational" ? frame.readSchema.capabilities : []) }) });
    yield* Effect.fromResult(readMechanics.lifetime.charge({ tableId: table.tableId, localName: table.logicalName })).pipe(
      Effect.mapError(cause => error("resourceFailure", cause)));
    readMechanics.tablesByName.set(table.logicalName, table); readMechanics.tablesById.set(table.tableId, table);
    return table;
  }));
  const tablesByName = writeMechanics?.tablesByName ?? readMechanics?.tablesByName;
  const tablesById = writeMechanics?.tablesById ?? readMechanics?.tablesById;
  const ownedTable = (id: CatalogTableId) => tablesById === undefined ? tables.find(table => table.tableId === id) : tablesById.get(id);
  const tableForName = (name: string) => Effect.suspend(() => {
    const table = tablesByName === undefined ? tables.find(candidate => candidate.logicalName === name) : tablesByName.get(name);
    return table !== undefined ? Effect.fromResult(consumeTableMetadataResult(table.tableId, "table").pipe(Result.map(() => table))) :
      (readMechanics?.metadata !== undefined ? loadReadTable(name) : Effect.fail(error("invalidAuthority")))
        .pipe(Effect.tap(selected => Effect.fromResult(consumeTableMetadataResult(selected.tableId, "table"))));
  });
  const tableForId = (id: CatalogTableId) => Effect.suspend(() => {
    const table = ownedTable(id);
    return table !== undefined ? Effect.fromResult(consumeTableMetadataResult(table.tableId, "table").pipe(Result.map(() => table))) :
      (readMechanics?.metadata !== undefined ? loadReadTable(id) : Effect.fail(error("invalidAuthority")))
        .pipe(Effect.tap(selected => Effect.fromResult(consumeTableMetadataResult(selected.tableId, "table"))));
  });
  const selectedIndexesFor = (table: LogicalDocumentTable, where: LogicalWhere, exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) =>
    writeMechanics !== undefined ? consumeAccessMetadata(table.tableId, ["ordered"], Object.keys(where)).pipe(
      Effect.as(writeMechanics.indexCandidates(table.tableId, Object.keys(where)))) :
    readMechanics?.metadata === undefined ? Effect.succeed(indexesForTable(table.tableId)) :
      readMechanics.metadata.selectIndex(table.logicalName, where, exactPoint).pipe(Effect.map(definition => definition === null ? [] : [definition]),
        Effect.mapError(cause => error("invalidAuthority", cause)));
  const selectedUniqueFor = (table: LogicalDocumentTable, where: LogicalWhere) => readMechanics?.metadata === undefined ?
    consumeAccessMetadata(table.tableId, ["unique"], Object.keys(where)).pipe(Effect.as(
      writeMechanics?.uniqueCandidates(table.tableId, Object.keys(where)) ?? uniqueForTable(table.tableId))) : readMechanics.metadata.selectUnique(table.logicalName, where).pipe(
      Effect.map(definition => definition === null ? [] : [definition]), Effect.mapError(cause => error("invalidAuthority", cause)));
  const selectedIndexValuesFor = (table: LogicalDocumentTable, values: LogicalSelectionValues,
    exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) => writeMechanics !== undefined
      ? consumeAccessMetadata(table.tableId, ["ordered"], values.fields).pipe(Effect.as(writeMechanics.indexCandidates(table.tableId, values.fields)))
      : selectedIndexesFor(table, logicalSelectionWhere(values), exactPoint);
  const selectedUniqueValuesFor = (table: LogicalDocumentTable, values: LogicalSelectionValues) => writeMechanics !== undefined
    ? consumeAccessMetadata(table.tableId, ["unique"], values.fields).pipe(Effect.as(writeMechanics.uniqueCandidates(table.tableId, values.fields)))
    : selectedUniqueFor(table, logicalSelectionWhere(values));
  const nativeIndexesFor = (table: LogicalDocumentTable, demand: LogicalRelationalReadDemand) => writeMechanics !== undefined ?
    consumeAccessMetadata(table.tableId, ["nativeIndex", "nativeKey", "reverse"], demand.fields).pipe(
      Effect.as(writeMechanics.relationalAccess(table.tableId, demand.fields))) : readMechanics?.metadata === undefined ? Effect.succeed(undefined) :
    readMechanics.metadata.queryAccess(table.logicalName, demand).pipe(Effect.mapError(cause => error("invalidInput", cause)));
  type ReadCompiler = Result.Result.Success<ReturnType<typeof prepareLogicalRelationalRead<Failure>>>;
  type ReadQuery = Result.Result.Success<ReturnType<ReadCompiler["compile"]>>;
  type SelectedIndex = Result.Result.Success<ReturnType<typeof selectLogicalIndex<Failure>>>;
  interface CandidatePreparation {
    access?: Readonly<{ kind: "unique"; definition: LocatedAppUniqueConstraintDefinitionV1;
      projected?: LoweredCanonicalAppUniqueConstraintV1; protectedBytes?: Uint8Array }>
      | Readonly<{ kind: "index"; definition: LocatedAppIndexDefinitionV1; selection?: SelectedIndex }>;
  }
  interface ReadPreparation {
    retained?: Readonly<{ table: LogicalDocumentTable; captured: Readonly<{ value: Json; bytes: number }>; prepared: ReadCompiler }>;
    compiled?: ReadQuery;
    readonly candidates?: Map<number, CandidatePreparation>;
    page?: Result.Result.Success<ReturnType<typeof selectLogicalPageIndex<Failure>>>;
  }
  const compileRelationalRead = (table: LogicalDocumentTable, input: unknown, preparation?: ReadPreparation,
    captured?: Readonly<{ value: Json; bytes: number }>) => observeExecution("LogicalDocuments.compileRelationalRead", Effect.gen(function* () {
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const retained = preparation?.retained;
    const prepared = retained?.table === table ? retained.prepared : yield* Effect.fromResult(prepareLogicalRelationalRead(table.relational, state.relationalCapabilities,
      input, limits.pageRows, error, table.relationalMechanics));
    let access = yield* nativeIndexesFor(table, prepared.demand);
    const pointDemand = prepared.pointDemand(access);
    if (pointDemand !== prepared.demand) access = yield* nativeIndexesFor(table, pointDemand);
    // Access consumption stays per execution. Only the exact immutable source
    // mechanics may retain the selection compiler's interpretation.
    if ((writeMechanics !== undefined || readMechanics !== undefined) && retained?.table === table && preparation?.compiled !== undefined) return preparation.compiled;
    const compiled = yield* Effect.fromResult(prepared.compile(access));
    if (preparation !== undefined && captured !== undefined) {
      preparation.retained = Object.freeze({ table, captured, prepared });
      if (writeMechanics !== undefined || readMechanics !== undefined) preparation.compiled = compiled;
    }
    return compiled;
  }));
  const localTableName = (tableId: CatalogTableId) => ownedTable(tableId)?.logicalName;
  const chargeResult = (bytes: number): Result.Result<void, Failure> => {
    if (root !== undefined && (root.closed || root.workingBytes + bytes > root.limits.workingBytes))
      return Result.fail(error(root.closed ? "closed" : "limitExceeded"));
    const charged = lifetime.charge(bytes);
    if (Result.isSuccess(charged) && root !== undefined) root.workingBytes += bytes;
    return charged;
  };
  const charge = (bytes: number) => Effect.fromResult(chargeResult(bytes));
  // Root dependencies and aggregate rows remain complete. A call cursor only
  // selects identities actually used since that cursor, including cached reads.
  // One charged entry per identity avoids a journal growing with repeated calls.
  const rowUses = new Map<AppDocumentIdV1, number>();
  let observationOrdinal = 0;
  const markRowUse = (documentId: AppDocumentIdV1): Result.Result<void, Failure> => Result.gen(function* () {
    if (observationOrdinal >= Number.MAX_SAFE_INTEGER) return yield* Result.fail(error("limitExceeded"));
    if (!rowUses.has(documentId)) {
      if (rowUses.size >= limits.identities) return yield* Result.fail(error("limitExceeded"));
      yield* chargeResult(32);
    }
    rowUses.set(documentId, ++observationOrdinal);
  });
  const markPendingUse = (pending: PendingDocument | undefined) => pending?.current == null
    ? Result.succeed(undefined) : markRowUse(pending.documentId);
  const derivedKeyDocuments = root?.derivedKeyDocuments ?? new Set<CanonicalFlarexValueV1>();
  const keyOwner = { identity: derivedKeyDocuments, error,
    retain: (document: CanonicalFlarexValueV1, bytes: number) => chargeResult(bytes).pipe(Result.map(() => { derivedKeyDocuments.add(document); })) };
  const lowerUnique = (definition: LocatedAppUniqueConstraintDefinitionV1, document: CanonicalFlarexValueV1,
    reason: "documentInvalid" | "storedCorruption" | "invalidInput") => lowerLogicalCanonicalUniqueKey(definition, document, keyOwner, reason);
  const lowerIndex = (definition: LocatedAppIndexDefinitionV1, document: CanonicalFlarexValueV1, rowCreationTime: AppCreationTimeV1,
    reason: "documentInvalid" | "storedCorruption" | "invalidInput") => lowerLogicalCanonicalIndexKey(definition, document, rowCreationTime, keyOwner, reason);
  const releaseDerivedKeys = (document: CanonicalFlarexValueV1) => {
    forgetLogicalCanonicalDerivedKeys(document, keyOwner.identity);
    derivedKeyDocuments.delete(document);
  };
  const replaceCurrent = (pending: PendingDocument, document: CanonicalFlarexValueV1 | null) => {
    if (pending.current !== null && pending.current !== document &&
        (pending.base?.kind !== "live" || pending.current !== pending.base.document)) releaseDerivedKeys(pending.current);
    pending.current = document;
  };
  // Owned observation and hydration are synchronous Result folds. Their lazy
  // consumers remain Effect boundaries; per-row diagnostic stacks add no owner.
  const observeResult = (
    tableId: CatalogTableId, rowId: AppRowIdHexV1, base: AppRowRevisionV1 | null,
    readAt = scanned.get(tableId) ?? state.snapshotCommitSeq ?? state.clock.lastCommitSeq,
  ): Result.Result<void, Failure> => Result.gen(function* () {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    if (dependencies.has(documentId)) {
      if (base?.kind === "live") yield* markRowUse(documentId);
      return;
    }
    if (dependencies.size >= limits.identities) return yield* Result.fail(error("limitExceeded"));
    yield* chargeResult(128);
    const observed: PointCommitDependencyV1["dependency"]["observed"] = base?.kind === "live"
      ? Object.freeze({ kind: "present", revisionCommitSeq: base.commitSeq })
      : Object.freeze({ kind: "missing", basis: base === null
        ? Object.freeze({ kind: "noVisibleRevision" })
        : Object.freeze({ kind: "tombstone", revisionCommitSeq: base.commitSeq }) });
    dependencies.set(documentId, Object.freeze({ documentId, tableId, rowId, readAt,
      dependency: Object.freeze({ kind: "appRowPoint", documentId, observed }) }));
    if (base?.kind === "live") yield* markRowUse(documentId);
  });
  const observe = (...input: Parameters<typeof observeResult>) =>
    Effect.suspend(() => Effect.fromResult(observeResult(...input)));
  const captureFields = (input: unknown) => Result.gen(function* () {
    const captured = yield* useCapturedPrivateJsonData(input, Math.min(limits.documentBytes, lifetime.remainingBytes()), error);
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) {
      return yield* Result.fail(error("documentInvalid"));
    }
    yield* chargeResult(captured.bytes);
    return captured.value;
  });
  const output = (document: CanonicalFlarexValueV1, returned = false): Result.Result<JsonObject, Failure> =>
    captureLogicalRelationalCanonicalRow(document, limits.documentBytes, error).pipe(
      Result.flatMap(captured => Result.gen(function* () {
        if (!isJsonObject(captured.value)) return yield* Result.fail(error("storedCorruption"));
        if (returned) yield* chargeResult(captured.bytes);
        return captured.value;
      })),
    );
  // Only fields from an already captured complete row enter this projection.
  // Its own wrapper cannot deepen that bounded tree or expose foreign accessors.
  const projectedOutput = (value: Record<string, Json>) => Result.gen(function* () {
    const captured = yield* useCapturedPrivateJsonData(value, limits.documentBytes, error);
    if (!isJsonObject(captured.value)) return yield* Result.fail(error("storedCorruption"));
    yield* chargeResult(captured.bytes);
    return captured.value;
  });
  const currentRowFailure = (cause: ReadAppRowError) => error(cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
    ? "limitExceeded" : cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause);
  const hydrateCurrentBaseResult = (
    table: LogicalDocumentTable, base: AppRowRevisionV1, readAt: CommitSeq,
  ): Result.Result<void, Failure> => Result.gen(function* () {
    const tableId = table.tableId, documentId = appDocumentIdV1FromRowIdentity(base);
    const alreadyObserved = dependencies.has(documentId);
    yield* observeResult(tableId, base.rowId, base, readAt);
    // A later scan must not replace a cached absence with a newly committed
    // row. Settlement detects the conflicting dependency; reads stay repeatable.
    if (alreadyObserved || rows.has(documentId)) return;
    if (rows.size >= limits.identities) return yield* Result.fail(error("limitExceeded"));
    yield* chargeResult(128 + (base.kind === "live" ? base.document.canonicalBytes.byteLength : 0));
    rows.set(documentId, { tableId, tableName: table.logicalName, rowId: base.rowId, documentId, base,
      creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [] });
  });
  const hydrateCurrentBase = (...input: Parameters<typeof hydrateCurrentBaseResult>) =>
    Effect.suspend(() => Effect.fromResult(hydrateCurrentBaseResult(...input)));
  const hydrateSnapshotBaseResult = (
    table: LogicalDocumentTable, selectedRowId: AppRowIdHexV1, base: AppRowReadResultV1,
    loadedBytes?: { value: number },
  ): Result.Result<void, Failure> => Result.gen(function* () {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: selectedRowId });
    yield* observeResult(table.tableId, selectedRowId, base.kind === "missing" ? null : base, state.snapshotCommitSeq);
    if (base.kind === "missing" || dependencies.has(documentId) && rows.has(documentId)) return;
    const bytes = base.kind === "live" ? base.document.canonicalBytes.byteLength : 0;
    if (loadedBytes !== undefined) loadedBytes.value += bytes;
    if ((loadedBytes?.value ?? bytes) > Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()) ||
      bytes > limits.documentBytes) return yield* Result.fail(error("limitExceeded"));
    // The existing row envelope charge includes the retained revision scalars;
    // finite originals/base/current share this already charged document.
    yield* chargeResult(128 + bytes);
    rows.set(documentId, { tableId: table.tableId, tableName: table.logicalName, rowId: selectedRowId, documentId, base,
      creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [],
      ...(root !== undefined && base.kind === "live" ? { originalRevision: base } : {}) });
  });
  const hydrateSnapshotBase = (...input: Parameters<typeof hydrateSnapshotBaseResult>) =>
    Effect.suspend(() => Effect.fromResult(hydrateSnapshotBaseResult(...input)));
  const readCurrentIndexSelection = Effect.fnUntraced(function* (
    tx: FlarexMetadataTransaction, table: LogicalDocumentTable,
    selection: Pick<LogicalIndexPageRead, "definition" | "bounds" | "after">,
    limit: number, complete: boolean,
    acceptMembership: (page: AppIndexRangePageV1) => Effect.Effect<void, Failure>,
  ) {
    // Membership and its lookahead are authenticated before the accepting
    // owner charges them. No body crosses this query's native result boundary.
    const page: AppIndexRangePageV1 = complete ? {
      entries: yield* readLogicalIndexRange(tx, state.scopeId, selection, limit, error, testHooks?.observeIndexQuery),
      isDone: true, continueCursor: null,
    } : yield* readLogicalIndexPage(tx, state.scopeId, selection, limit, error, testHooks?.observeIndexQuery);
    yield* acceptMembership(page);
    if (page.entries.some(entry => entry.tableId !== table.tableId) ||
      new Set(page.entries.map(entry => entry.rowId)).size !== page.entries.length)
      return yield* Effect.fail(error("storedCorruption"));
    if (!scanned.has(table.tableId)) {
      // Exclude every owned observation, including cached absence and removal,
      // before dense packet slicing. Each AppRows packet takes fresh limits
      // after prior real charges and completes decoding before hydration.
      const missing = page.entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
      if (missing.length > 0) yield* readBaseInTransaction(tx, table.tableId, undefined, missing.map(entry => entry.rowId), true);
    }
    return page;
  });
  const readBaseInTransaction = (tx: FlarexMetadataTransaction, tableId: CatalogTableId, rowId?: AppRowIdHexV1, rowIds?: readonly AppRowIdHexV1[], requiredCurrentRows = false) => observeExecution("LogicalDocuments.readBaseInTransaction", Effect.gen(function* (): Effect.fn.Return<void, Failure> {
    if (rowIds !== undefined && rowIds.length > MAX_BOUNDED_APP_ROW_READ_IDENTITIES) {
      for (let offset = 0; offset < rowIds.length; offset += MAX_BOUNDED_APP_ROW_READ_IDENTITIES)
        yield* readBaseInTransaction(tx, tableId, undefined, rowIds.slice(offset, offset + MAX_BOUNDED_APP_ROW_READ_IDENTITIES), requiredCurrentRows);
      return;
    }
    if (closed) return yield* Effect.fail(error("closed"));
    const table = yield* tableForId(tableId);
    if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead(rowIds !== undefined ? "batch" : rowId !== undefined ? "point" : "scan");
    if (state.snapshotCommitSeq !== undefined) {
      const snapshotCommitSeq = state.snapshotCommitSeq;
      // A historical full-table scan requires a retained candidate source. An
      // indexed or exact point selection can use the retained row revisions.
      const selected = rowIds ?? (rowId === undefined ? undefined : [rowId]);
      if (selected === undefined) return yield* Effect.fail(error("invalidInput"));
      const uncached = selected.filter(selectedRowId => !dependencies.has(appDocumentIdV1FromRowIdentity({ tableId, rowId: selectedRowId })));
      if (selected.length > callIdentityLimit || uncached.length > Math.min(MAX_BOUNDED_APP_ROW_READ_IDENTITIES,
        limits.identities - dependencies.size))
        return yield* Effect.fail(error("limitExceeded"));
      if (rowIds !== undefined && uncached.some(selectedRowId => rows.has(appDocumentIdV1FromRowIdentity({ tableId, rowId: selectedRowId }))))
        return yield* Effect.fail(error("storedCorruption"));
      if (uncached.length > 0) yield* requireReadDemand(tx, { kind: "rows", tableId });
      const loadedBytes = { value: 0 };
      const consume = (selectedRowId: AppRowIdHexV1, base: AppRowReadResultV1) => hydrateSnapshotBase(table, selectedRowId, base, loadedBytes);
      // These identities were decoded and deduplicated by the point/index planner.
      // Keep point reads unchanged; only requested batches share one snapshot query.
      if (rowIds === undefined) {
        for (const selectedRowId of uncached) {
          const base = yield* readAppRowAtSnapshotInTransactionEffect(tx, {
            scopeId: state.scopeId, tableId, rowId: selectedRowId, snapshotCommitSeq,
          }, testHooks?.observeQuery).pipe(Effect.mapError(cause => error(cause instanceof AppRowReadPersistenceError
            ? "statementFailure" : "storedCorruption", cause)));
          yield* consume(selectedRowId, base);
        }
      } else yield* consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, {
        scopeId: state.scopeId, tableId, rowIds: uncached, snapshotCommitSeq,
        maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()),
      }, cause => error(cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause),
        consume, testHooks?.observeQuery);
      return;
    }
    yield* requireReadDemand(tx, { kind: "rows", tableId });
    const capture = yield* readBoundedCurrentAppRowsInTransactionEffect(tx, {
      scopeId: state.scopeId, tableId, minimumCommitSeq: state.clock.lastCommitSeq,
      maximumIdentities: Math.min(MAX_BOUNDED_APP_ROW_READ_IDENTITIES,
        rowIds === undefined ? limits.identities : limits.identities - dependencies.size), maximumDocumentBytes: limits.documentBytes,
      maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()),
      ...(rowId === undefined ? {} : { rowId }),
      ...(rowIds === undefined ? {} : { rowIds }),
    }, testHooks?.observeQuery).pipe(Effect.mapError(currentRowFailure));
    const loaded = capture.rows;
    if (requiredCurrentRows && rowIds !== undefined) {
      const accepted = new Set(loaded.map(row => row.rowId));
      const missing = rowIds.find(selected => !accepted.has(selected));
      if (missing !== undefined) return yield* Effect.fail(currentRowFailure(new AppRowStorageCorruptionError(
        { scopeId: state.scopeId, tableId, rowId: missing }, "current index membership has no stored row")));
    }
    for (const base of loaded) {
      yield* hydrateCurrentBase(table, base, capture.commitSeq);
    }
    for (const selected of rowIds ?? (rowId === undefined ? [] : [rowId])) {
      if (!dependencies.has(appDocumentIdV1FromRowIdentity({ tableId, rowId: selected }))) {
        yield* observe(tableId, selected, null, capture.commitSeq);
      }
    }
    if (rowId === undefined && rowIds === undefined) {
      let frontier: CommitSeq | null = null;
      for (const base of loaded) if (frontier === null || base.commitSeq > frontier) frontier = base.commitSeq;
      yield* charge(64);
      scans.set(tableId, frontier);
      scanned.set(tableId, capture.commitSeq);
    }
  }));
  // Finite read mechanics stay lazy beneath the public document operation and
  // named capture; nested helper stacks/spans repeat that ownership per batch.
  const readFiniteBase = Effect.fnUntraced(function* (tableId: CatalogTableId,
    selected: readonly AppRowIdHexV1[]): Effect.fn.Return<void, Failure> {
    if (finiteProfile === undefined || state.snapshotCommitSeq === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    // Dense packets contain only genuine unseen observations. A previous
    // packet's real charges precede the next packet's fresh body allowance.
    const uncached = selected.filter(rowId => !dependencies.has(appDocumentIdV1FromRowIdentity({ tableId, rowId })));
    if (uncached.length > MAX_BOUNDED_APP_ROW_READ_IDENTITIES) {
      for (let offset = 0; offset < uncached.length; offset += MAX_BOUNDED_APP_ROW_READ_IDENTITIES)
        yield* readFiniteBase(tableId, uncached.slice(offset, offset + MAX_BOUNDED_APP_ROW_READ_IDENTITIES));
      return;
    }
    if (closed) return yield* Effect.fail(error("closed"));
    const table = yield* tableForId(tableId);
    if (selected.length > callIdentityLimit || uncached.length > Math.min(MAX_BOUNDED_APP_ROW_READ_IDENTITIES, limits.identities - dependencies.size))
      return yield* Effect.fail(error("limitExceeded"));
    if (uncached.some(rowId => rows.has(appDocumentIdV1FromRowIdentity({ tableId, rowId }))))
      return yield* Effect.fail(error("storedCorruption"));
    if (uncached.length === 0) return;
    if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead(selected.length === 1 ? "point" : "batch");
    yield* Effect.fromResult(consumeTableMetadataResult(tableId, "table"));
    const captured = yield* finiteProfile.captureStorage({ kind: "rows", input: {
      scopeId: state.scopeId, tableId, rowIds: uncached, snapshotCommitSeq: state.snapshotCommitSeq,
    }, maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()) }, { kind: "rows", tableId });
    const loadedBytes = { value: 0 };
    yield* consumeCapturedAppRowsAtSnapshotEffect(captured.prepared, captured.rawRows,
      cause => error(cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause),
      (rowId, base) => hydrateSnapshotBase(table, rowId, base, loadedBytes));
  });
  const readFiniteIndexPage = Effect.fnUntraced(function* (
    selection: Pick<LogicalIndexPageRead, "definition" | "bounds" | "after">, limit: number,
  ) {
    if (finiteProfile === undefined || state.snapshotCommitSeq === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    const tableId = selection.definition.access.tableId;
    if (tableId === undefined) return yield* Effect.fail(error("invalidAuthority"));
    yield* Effect.fromResult(consumeTableMetadataResult(tableId, "table"));
    yield* Effect.fromResult(consumeDefinitionMetadataResult(tableId, "index", selection.definition.indexDefinitionId));
    const captured = yield* finiteProfile.captureStorage({ kind: "indexPage", tableId, input: {
      scopeId: state.scopeId, ...selection, limit, snapshotCommitSeq: state.snapshotCommitSeq,
    } }, { kind: "index", tableId, indexDefinitionId: selection.definition.indexDefinitionId });
    return yield* decodeCapturedAppIndexSnapshotPageEffect(captured.prepared, captured.rawRows).pipe(
      Effect.mapError(cause => error(logicalIndexReadFailureReason(cause), cause)));
  });
  const readFiniteIndexRows = Effect.fnUntraced(function* (
    selection: Pick<LogicalIndexRead, "definition" | "bounds">, tableId: CatalogTableId, limit: number, maximumHydratedOwners?: 1,
  ) {
    if (finiteProfile === undefined || state.snapshotCommitSeq === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    yield* tableForId(tableId);
    // The finite snapshot pins history, not the mutable root budget. Accept
    // every membership and its lookahead before granting any row permission.
    const page = yield* readFiniteIndexPage(selection, limit);
    if (!page.isDone) return yield* Effect.fail(error("limitExceeded"));
    const entries = page.entries;
    if (maximumHydratedOwners !== undefined && (entries.length > maximumHydratedOwners || entries.some(entry => entry.tableId !== tableId)))
      return yield* Effect.fail(error("storedCorruption"));
    yield* charge(128 + entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
    if (entries.some(entry => entry.tableId !== tableId) || new Set(entries.map(entry => entry.rowId)).size !== entries.length)
      return yield* Effect.fail(error("storedCorruption"));
    const missing = entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
    if (missing.length > callIdentityLimit || missing.length > limits.identities - dependencies.size)
      return yield* Effect.fail(error("limitExceeded"));
    if (missing.some(entry => rows.has(appDocumentIdV1FromRowIdentity(entry))))
      return yield* Effect.fail(error("storedCorruption"));
    if (missing.length > 0) yield* readFiniteBase(tableId, missing.map(entry => entry.rowId));
    return entries;
  });
  const readBase = (tableId: CatalogTableId, rowId?: AppRowIdHexV1, rowIds?: readonly AppRowIdHexV1[], checkedTx?: FlarexMetadataTransaction) => observeExecution("LogicalDocuments.readBase", Effect.gen(function* () {
      if (state.snapshotCommitSeq !== undefined && rowId === undefined && rowIds === undefined) {
        yield* state.requireAdmission;
        if (closed) return yield* Effect.fail(error("closed"));
        yield* tableForId(tableId);
        if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("scan");
        return yield* Effect.fail(error("invalidInput"));
      }
      yield* requireReadAdmission;
      if (finiteProfile !== undefined) return yield* readFiniteBase(tableId, rowIds ?? (rowId === undefined ? [] : [rowId]));
      return yield* (checkedTx === undefined ? runStorageRead({ kind: "rows", tableId },
        { tableId, ...(rowIds === undefined ? rowId === undefined ? {} : { rowIds: [rowId] } : { rowIds }) },
        tx => readBaseInTransaction(tx, tableId, rowId, rowIds)) :
        readBaseInTransaction(checkedTx, tableId, rowId, rowIds));
    }));
  let hydratedLocalSeeds = false;
  type PendingSelection = Readonly<{ tableId: CatalogTableId; rowIds?: readonly AppRowIdHexV1[] }>;
  const pendingSeeds = (selection?: PendingSelection) => {
    void selection;
    return root !== undefined || hydratedLocalSeeds ? [] : state.pendingRows ?? [];
  };
  const hydratePendingSeeds = (tx: FlarexMetadataTransaction, selection?: PendingSelection) => observeExecution("LogicalDocuments.hydratePendingSeeds", Effect.gen(function* () {
    const pendingRows = pendingSeeds(selection);
    if (pendingRows.length === 0) return;
    if (state.snapshotCommitSeq === undefined || pendingRows.length > limits.identities)
      return yield* Effect.fail(error("invalidAuthority"));
    const seen = new Set<string>();
    const applySeed = (seed: import("./model").LogicalPendingDocumentSeed) => observeExecution("LogicalDocuments.applyPendingSeed", Effect.gen(function* () {
      const documentId = appDocumentIdV1FromRowIdentity(seed);
      if (seen.has(documentId)) return yield* Effect.fail(error("storedCorruption"));
      seen.add(documentId);
      const existingEvidence = dependencies.get(documentId);
      const observation = existingEvidence?.dependency.kind === "appRowPoint" ? existingEvidence.dependency.observed : undefined;
      const expected = seed.evidence;
      if (expected.kind === "generatedInsertion") {
        if (existingEvidence !== undefined) return yield* Effect.fail(error("storedCorruption"));
        dependencies.set(documentId, { documentId, tableId: seed.tableId, rowId: seed.rowId,
          readAt: state.snapshotCommitSeq!, dependency: { kind: "generatedInsertion", documentId,
            effectOrdinal: expected.effectOrdinal, origin: expected.origin } });
      }
      const sameObservation = observation?.kind === expected.kind &&
        (observation.kind === "present" && expected.kind === "present"
          ? observation.revisionCommitSeq === expected.revisionCommitSeq
          : observation.kind === "missing" && expected.kind === "missing" &&
            observation.basis.kind === expected.basis.kind &&
            (observation.basis.kind === "tombstone" && expected.basis.kind === "tombstone"
              ? observation.basis.revisionCommitSeq === expected.basis.revisionCommitSeq : true));
      if (expected.kind !== "generatedInsertion" && !sameObservation) return yield* Effect.fail(error("storedCorruption"));
      const table = yield* tableForId(seed.tableId);
      const existing = rows.get(documentId);
      if (seed.overlay.kind === "live") {
        if (!isJsonObject(seed.overlay.document.valueJson) ||
          seed.overlay.document.valueJson._id !== documentId ||
          seed.overlay.document.valueJson._creationTime !== seed.overlay.creationTime)
          return yield* Effect.fail(error("storedCorruption"));
        yield* charge(128 + seed.overlay.document.canonicalBytes.byteLength);
      } else yield* charge(128);
      const seedCreationTime = seed.overlay.kind === "live" ? seed.overlay.creationTime : existing?.creationTime;
      // An insert followed by delete has a missing snapshot dependency and no
      // current row. Retain its absence witness without inventing row time.
      if (seedCreationTime === undefined && seed.overlay.kind === "deleted" && (expected.kind === "missing" || expected.kind === "generatedInsertion")) {
        return;
      }
      if (seedCreationTime === undefined) return yield* Effect.fail(error("storedCorruption"));
      rows.set(documentId, { tableId: seed.tableId, tableName: table.logicalName, rowId: seed.rowId,
        documentId, base: existing?.base ?? null, creationTime: seedCreationTime,
        current: seed.overlay.kind === "live" ? seed.overlay.document : null, attempts: [], borrowedOverlay: true });
    }));
    // Ordered batches preserve the original observation/base/overlay charge
    // sequence. A cached base ends a batch so its overlay is checked before
    // the next canonical body is decoded.
    for (let offset = 0; offset < pendingRows.length;) {
      const first = pendingRows[offset]!;
      if (first.evidence.kind === "generatedInsertion" || dependencies.has(appDocumentIdV1FromRowIdentity(first))) {
        yield* applySeed(first); offset++; continue;
      }
      const table = yield* tableForId(first.tableId);
      let end = offset + 1;
      while (end < pendingRows.length && end - offset < MAX_BOUNDED_APP_ROW_READ_IDENTITIES &&
        pendingRows[end]?.tableId === first.tableId && pendingRows[end]?.evidence.kind !== "generatedInsertion" &&
        !dependencies.has(appDocumentIdV1FromRowIdentity(pendingRows[end]!))) end++;
      const group = pendingRows.slice(offset, end);
      let position = 0;
      yield* requireReadDemand(tx, { kind: "rows", tableId: table.tableId });
      if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("batch");
      yield* consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, {
        scopeId: state.scopeId, tableId: table.tableId, rowIds: group.map(seed => seed.rowId),
        snapshotCommitSeq: state.snapshotCommitSeq,
        maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()),
      }, cause => error(cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause),
      (rowId, base) => Effect.gen(function* () {
        yield* hydrateSnapshotBase(table, rowId, base);
        yield* applySeed(group[position]!); position++;
      }), testHooks?.observeQuery);
      offset = end;
    }
    hydratedLocalSeeds = true;
  }));
  // The finite root already owns original preimages and pending rows.
  // Independent durable/native overlays keep their checked hydration path.
  if (root === undefined && pendingSeeds().length > 0) {
    yield* requireReadAdmission;
    yield* runConstructionRead(hydratePendingSeeds);
  }
  const checkedRootOverlayGenerations = new Map<CatalogTableId, number>();
  const hasUncheckedRootMembership = (tableId: CatalogTableId) => finiteProfile === undefined && state.tx === undefined && root !== undefined &&
    (root.overlayWriteGenerations.get(tableId) ?? 0) !== (checkedRootOverlayGenerations.get(tableId) ?? 0);
  const runStorageRead = <A, E>(demand: LogicalStorageReadDemand, selection: PendingSelection | undefined,
    work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) => Effect.suspend(() => {
    const settlesBoundary = frontierTx === undefined && state.tx === undefined && finiteProfile === undefined;
    let checkedGeneration: number | undefined;
    return runRead(tx => {
      if (root !== undefined && demand.kind !== "clock") checkedGeneration = root.overlayWriteGenerations.get(demand.tableId) ?? 0;
      return requireReadDemand(tx, demand).pipe(Effect.andThen(() =>
        hydratePendingSeeds(tx, selection)), Effect.andThen(() => work(tx)));
    }, demand).pipe(Effect.tap(() => Effect.sync(() => {
      // Inner callbacks complete before the borrowed transaction's tail. Only
      // its successfully settled outer boundary can consume this table's duty.
      if (settlesBoundary && checkedGeneration !== undefined && demand.kind !== "clock")
        checkedRootOverlayGenerations.set(demand.tableId, checkedGeneration);
    })));
  });
  const withStorageFrontier = <A>(demand: LogicalStorageReadDemand, selection: PendingSelection,
    work: Effect.Effect<A, Failure>): Effect.Effect<A, Failure> =>
    Effect.suspend(() => finiteProfile !== undefined ? work : frontierTx !== undefined ? runStorageRead(demand, selection, () => work) : runStorageRead(demand, selection, tx =>
      Effect.acquireUseRelease(Effect.sync(() => { frontierTx = tx; }), () => work,
        () => Effect.sync(() => { frontierTx = undefined; }))));
  const locate = (inputId: string, tableName?: string, checkedTx?: FlarexMetadataTransaction) => observeExecution("LogicalDocuments.locate", Effect.gen(function* () {
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(inputId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    yield* tableForId(identity.tableId);
    if (tableName !== undefined && (yield* tableForName(tableName)).tableId !== identity.tableId) {
      return yield* Effect.fail(error("invalidInput"));
    }
    const read = Effect.gen(function* () {
      if (!dependencies.has(identity.id) && !scanned.has(identity.tableId)) yield* readBase(identity.tableId, identity.rowId, undefined, checkedTx);
      if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
      const pending = rows.get(identity.id);
      yield* Effect.fromResult(markPendingUse(pending));
      return { identity, pending };
    });
    const selection = { tableId: identity.tableId, rowIds: [identity.rowId] };
    return yield* (pendingSeeds(selection).length > 0 && checkedTx === undefined
      ? withStorageFrontier({ kind: "rows", tableId: identity.tableId }, selection, read) : read);
  }));
  // Selection preparation stays beneath the named read/write operation. Avoid
  // capturing another caller stack and span for this immutable local derivation.
  const historicalUniqueSelection = Effect.fnUntraced(function* (
    definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1,
  ) {
    const fields = definition.physicalSpec.orderedFields, predicate = definition.physicalSpec.predicate;
    yield* consumeAccessMetadata(definition.tableId, ["ordered"], fields.slice(0, 1));
    const definitions = writeMechanics?.indexCandidates(definition.tableId, fields.slice(0, 1)) ?? indexesForTable(definition.tableId);
    const index = definitions.find(candidate => candidate.access.kind === "developer" &&
      candidate.access.tableId === definition.tableId && candidate.physicalSpec.orderedFields.length >= fields.length &&
      fields.every((field, position) => {
        const member = candidate.physicalSpec.orderedFields[position];
        return member?.kind === "documentPath" && member.path === field && member.valueFormat === undefined;
      }) && (predicate === undefined ? candidate.physicalSpec.predicate === undefined :
        candidate.physicalSpec.predicate?.kind === "fieldIsNull" && candidate.physicalSpec.predicate.field === predicate.field));
    if (projected.kind !== "claim" || fields.length === 0 || projected.projection.values.length !== fields.length || index === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    const expressions: OrderedIndexRangeExpressionV1[] = fields.map((_, position) => ({
      op: "eq", field: index.physicalSpec.orderedFields[position]!, value: projected.projection.values[position]!,
    }));
    const bounds = yield* Effect.fromResult(Result.try({
      try: () => compileAppOrderedIndexBoundsV1({ spec: index.physicalSpec, expressions }),
      catch: cause => {
        if (cause instanceof InvalidOrderedIndexRangeV1Error || cause instanceof OrderedIndexCodecV1InputError ||
          cause instanceof OrderedIndexKeyTooLargeError || cause instanceof FlarexValueCodecV1Error) return error("invalidAuthority", cause);
        throw cause;
      },
    }));
    return Object.freeze({ definition: index, bounds,
      identity: JSON.stringify([index.indexDefinitionId, bounds.startInclusive ?? null, bounds.endExclusive ?? null]) });
  });
  type UniqueStorageSelection =
    | Readonly<{ kind: "current"; demand: LogicalStorageReadDemand }>
    | Readonly<{ kind: "historical"; demand: LogicalStorageReadDemand;
        selection: Effect.Success<ReturnType<typeof historicalUniqueSelection>> }>;
  // The first demand owns metadata consumption; its result is passed through
  // this call, rather than deriving the same bounds again inside the frontier.
  const prepareUniqueStorageSelection = Effect.fnUntraced(function* (
    definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1,
  ): Effect.fn.Return<UniqueStorageSelection, Failure> {
    yield* Effect.fromResult(consumeDefinitionMetadataResult(definition.tableId, "unique", definition.uniqueConstraintDefinitionId));
    if (state.snapshotCommitSeq === undefined) return Object.freeze({ kind: "current",
      demand: Object.freeze({ kind: "unique", tableId: definition.tableId,
        uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId }) });
    const selected = yield* historicalUniqueSelection(definition, projected);
    return Object.freeze({ kind: "historical", selection: selected,
      demand: Object.freeze({ kind: "index", tableId: definition.tableId, indexDefinitionId: selected.definition.indexDefinitionId }) });
  });
  const locateUnique = (definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1, prepareSelection: Effect.Effect<UniqueStorageSelection, Failure>) => observeExecution("LogicalDocuments.locateUnique", Effect.gen(function* () {
    const readKey = uniqueReadKey(definition, projected);
    if (projected.kind !== "claim" || readKey === null) return null;
    const selection = { tableId: definition.tableId };
    const storageSelection = uniqueReads.has(readKey) ? undefined : yield* prepareSelection;
    const demand = storageSelection === undefined ? { kind: "rows" as const, tableId: definition.tableId } : storageSelection.demand;
    const read = Effect.gen(function* () {
      const cached = uniqueReads.get(readKey);
      if (cached !== undefined) return cached.owner === null ? null : appDocumentIdV1FromRowIdentity(cached.owner);
      if (storageSelection === undefined) return yield* Effect.fail(error("invalidAuthority"));
      if (storageSelection.kind === "historical") {
        // Unique slots are current-only. A matching retained ordered index gives
        // the historical owner and the negative membership witness. The final
        // unique slot is still checked under publication exclusion at settlement.
        const selected = storageSelection.selection;
        const index = selected.definition;
        const entries = yield* (finiteProfile !== undefined ? readFiniteIndexRows(selected, definition.tableId, 2, 1) : runRead(tx => requireReadDemand(tx, { kind: "index", tableId: definition.tableId,
          indexDefinitionId: index.indexDefinitionId }).pipe(Effect.andThen(() =>
          readLogicalIndexRange(tx, state.scopeId, selected, 2, error,
            testHooks?.observeIndexQuery, state.snapshotCommitSeq)))));
        if (entries.length > 1 || entries.some(entry => entry.tableId !== definition.tableId))
          return yield* Effect.fail(error("storedCorruption"));
        if (finiteProfile === undefined) yield* charge(128 + entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
        indexReads.set(selected.identity, Object.freeze({ definition: index, bounds: selected.bounds, entries }));
        const entry = entries[0];
        if (entry !== undefined) {
          const { pending: owned } = yield* locate(appDocumentIdV1FromRowIdentity(entry));
          if (owned?.base?.kind !== "live" || owned.base.commitSeq < entry.commitSeq)
            return yield* Effect.fail(error("writeConflict"));
          const base = yield* Effect.fromResult(lowerUnique(definition, owned.base.document, "storedCorruption"));
          if (base.kind !== "claim" || base.localeKey !== projected.localeKey ||
            base.encodedKey !== projected.encodedKey) return yield* Effect.fail(error("storedCorruption"));
        }
        yield* charge(128 + projected.canonicalKeyBytes.byteLength);
        uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
          key: projected.projection, owner: entry === undefined ? null :
            Object.freeze({ tableId: entry.tableId, rowId: entry.rowId }) }));
        return entry === undefined ? null : appDocumentIdV1FromRowIdentity(entry);
      }
      const slot = yield* runRead(tx => Effect.gen(function* () {
        yield* requireReadDemand(tx, { kind: "unique", tableId: definition.tableId,
          uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId });
        const ownerSlot = yield* readAppUniqueKeySlotInTransactionEffect(tx, { scopeId: state.scopeId,
          constraintId: definition.uniqueConstraintDefinitionId, key: projected.projection,
        }).pipe(Effect.mapError(cause => error(cause instanceof AppUniqueKeyPersistenceError ? "statementFailure" :
          cause instanceof AppUniqueKeyHashError ? "resourceFailure" : "storedCorruption", cause)));
        if (Option.isSome(ownerSlot)) {
          const owner = ownerSlot.value;
          if (owner.tableId !== definition.tableId) return yield* Effect.fail(error("storedCorruption"));
          const documentId = appDocumentIdV1FromRowIdentity(owner);
          // Slot authentication grants no body allowance. The existing point
          // owner samples fresh limits after its callback and readiness checks;
          // retained observations require no additional body transfer.
          const { pending: owned } = yield* locate(documentId, undefined, tx);
          // A cached or later point capture can differ under concurrent
          // publication. Preserve the exact revision agreement requirement.
          if (owned?.base?.commitSeq !== owner.ownerCommitSeq) return yield* Effect.fail(error("writeConflict"));
          if (owned.base.kind !== "live") return yield* Effect.fail(error("storedCorruption"));
          const base = yield* Effect.fromResult(lowerUnique(definition, owned.base.document, "storedCorruption"));
          if (base.kind !== "claim" || base.localeKey !== projected.localeKey ||
            base.encodedKey !== projected.encodedKey) return yield* Effect.fail(error("storedCorruption"));
        }
        return ownerSlot;
      }));
      const ownerId = Option.isNone(slot) ? null : appDocumentIdV1FromRowIdentity(slot.value);
      yield* charge(128 + projected.canonicalKeyBytes.byteLength);
      uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
        key: projected.projection, owner: Option.isNone(slot) ? null : Object.freeze({ tableId: slot.value.tableId, rowId: slot.value.rowId }) }));
      return ownerId;
    });
    return yield* (pendingSeeds(selection).length > 0 || hasUncheckedRootMembership(definition.tableId) || !uniqueReads.has(readKey)
      ? withStorageFrontier(demand, selection, read) : read);
  }));
  const withUniqueValidation = <Value>(pending: PendingDocument, document: CanonicalFlarexValueV1, consume: Effect.Effect<Value, Failure>) => observeExecution("LogicalDocuments.validateUnique", Effect.gen(function* (): Effect.fn.Return<Value, Failure> {
    // Recursion retains each borrowed frontier until its continuation settles;
    // the named validateUnique operation already owns this repeated local fold.
    const validateNext = Effect.fnUntraced(function* (position: number): Effect.fn.Return<Value, Failure> {
      const definition = uniqueForTable(pending.tableId)[position];
      if (definition === undefined) return yield* consume;
      if (definition.tableId !== pending.tableId) return yield* validateNext(position + 1);
      const projected = yield* Effect.fromResult(lowerUnique(definition, document, "documentInvalid"));
      if (projected.kind !== "claim") return yield* validateNext(position + 1);
      const validate = (prepareSelection: Effect.Effect<UniqueStorageSelection, Failure>) => Effect.gen(function* () {
        yield* locateUnique(definition, projected, prepareSelection);
        // One ordered local interpreter owns this definition's current-key
        // membership. It visits the original row order lazily, so an earlier
        // conflict still precedes a later malformed row or encoder failure.
        yield* Effect.fromResult(Result.gen(function* () {
          for (const other of rows.values()) {
            if (other.tableId !== pending.tableId || other.documentId === pending.documentId || other.current === null) continue;
            const existing = yield* lowerUnique(definition, other.current, "storedCorruption");
            if (existing.kind === "claim" && existing.localeKey === projected.localeKey && existing.encodedKey === projected.encodedKey)
              return yield* Result.fail(state.uniqueConflict(Object.freeze({ tableName: localTableName(pending.tableId) ?? pending.tableName,
              orderedFields: Object.freeze([...definition.physicalSpec.orderedFields]) })));
          }
        }));
        return yield* validateNext(position + 1);
      });
      const key = uniqueReadKey(definition, projected);
      const selection = { tableId: pending.tableId };
      if (pendingSeeds(selection).length > 0 || hasUncheckedRootMembership(pending.tableId) || key !== null && !uniqueReads.has(key)) {
        const prepared = yield* prepareUniqueStorageSelection(definition, projected);
        return yield* withStorageFrontier(prepared.demand, selection, validate(Effect.succeed(prepared)));
      }
      return yield* validate(prepareUniqueStorageSelection(definition, projected));
    });
    return yield* validateNext(0);
  }));
  const recordAttempt = (pending: PendingDocument, operation: LogicalDocumentAttempt["operation"],
    after: CanonicalFlarexValueV1 | null) => {
    const attempt = Object.freeze({ ordinal: attempts.length, documentId: pending.documentId, operation,
      tableId: pending.tableId, tableName: localTableName(pending.tableId) ?? pending.tableName, before: pending.current, after });
    return consumeTableMetadataResult(pending.tableId, "writeClosure").pipe(Result.flatMap(() => chargeResult(128)),
      Result.flatMap(() => markRowUse(pending.documentId)), Result.map(() => {
      pending.attempts.push(attempt.ordinal);
      attempts.push(attempt);
    }));
  };
  const withWrittenDocument = <Value>(pending: PendingDocument, fields: JsonObject, operation: "insert" | "patch" | "replace", consume: (written: JsonObject) => Effect.Effect<Value, Failure>,
    prepareDocument?: (pending: PendingDocument) => Effect.Effect<CanonicalFlarexValueV1, Failure>) => observeExecution("LogicalDocuments.validateWrite", Effect.gen(function* (): Effect.fn.Return<Value, Failure> {
    const document = yield* (prepareDocument === undefined ? canonicalizeFlarexValueV1Effect({ ...fields, _id: pending.documentId, _creationTime: pending.creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => error("documentInvalid", cause))) : prepareDocument(pending));
    if (document.canonicalBytes.byteLength > limits.documentBytes) return yield* Effect.fail(error("limitExceeded"));
    const table = yield* tableForId(pending.tableId);
    yield* state.validateDocument({ operation, tableName: table.logicalName, tableId: pending.tableId, documentId: pending.documentId,
      creationTime: pending.creationTime, document });
    return yield* withUniqueValidation(pending, document, Effect.gen(function* () {
      if (!rows.has(pending.documentId) && rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(document.canonicalBytes.byteLength);
      yield* Effect.fromResult(recordAttempt(pending, operation, document));
      replaceCurrent(pending, document);
      rows.set(pending.documentId, pending);
      const written = yield* Effect.fromResult(output(document, true));
      return yield* consume(written);
    })).pipe(Effect.ensuring(Effect.sync(() => {
      if (pending.current !== document && (pending.base?.kind !== "live" || pending.base.document !== document)) releaseDerivedKeys(document);
    })));
  }));
  const write = (pending: PendingDocument, fields: JsonObject, operation: "insert" | "patch" | "replace") =>
    withWrittenDocument(pending, fields, operation, Effect.succeed);
  const get: LogicalDocuments<Failure>["get"] = (context, id, documentId, tableName) => observeExecution("LogicalDocuments.get", Effect.suspend(() => state.tx !== undefined || root !== undefined ? runOperation(context, id, "read", Effect.gen(function* () {
      if (typeof documentId !== "string" || tableName !== undefined && typeof tableName !== "string")
        return yield* Effect.fail(error("invalidInput"));
      const { pending } = yield* locate(documentId, tableName);
      return pending?.current == null ? null : yield* Effect.fromResult(output(pending.current, true));
    })) :
      lifetime.operation(context, id, "read", Effect.gen(function* () {
        // The borrowed readTransaction performs live admission before any
        // identity inspection. Only primitive input enters this SQL callback;
        // a proxy cannot execute getters while the checked transaction is open.
        const pending = yield* state.readTransaction(tx => Effect.gen(function* () {
          if (closed) return yield* Effect.fail(error("closed"));
          if (setNull.length > 0 || referenceReplacements.length > 0)
            return yield* Effect.fail(error("invalidAuthority"));
          if (typeof documentId !== "string" || tableName !== undefined && typeof tableName !== "string")
            return yield* Effect.fail(error("invalidInput"));
          return (yield* locate(documentId, tableName, tx)).pending;
        }));
        return pending?.current == null ? null : yield* Effect.fromResult(output(pending.current, true));
      }))));
  const getMany: LogicalDocuments<Failure>["getMany"] = (context, id, tableName, input) => observeExecution("LogicalDocuments.getMany", Effect.suspend(() => runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      if (!Array.isArray(captured.value) || captured.value.length > Math.min(limits.pageRows, callIdentityLimit))
        return yield* Effect.fail(error("limitExceeded"));
      const table = yield* tableForName(tableName);
      const identities = yield* Effect.forEach(captured.value, value => Effect.fromResult(decodeAppDocumentIdentityV1Result(value)
        .pipe(Result.mapError(cause => error("invalidInput", cause)))));
      if (identities.some(identity => identity.tableId !== table.tableId) || new Set(identities.map(identity => identity.id)).size !== identities.length) {
        return yield* Effect.fail(error("invalidInput"));
      }
      const read = Effect.gen(function* () {
        const missing = identities.filter(identity => !dependencies.has(identity.id));
        if (!scanned.has(table.tableId) && dependencies.size + missing.length > limits.identities) return yield* Effect.fail(error("limitExceeded"));
        if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(identity => identity.rowId));
        for (const identity of missing) if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
        return Object.freeze(yield* Effect.forEach(identities, identity => {
          const pending = rows.get(identity.id);
          if (pending?.current == null) return Effect.succeed(null);
          const document = pending.current;
          return Effect.fromResult(markRowUse(pending.documentId).pipe(Result.flatMap(() => output(document, true))));
        }));
      });
      const selection = { tableId: table.tableId, rowIds: identities.map(identity => identity.rowId) };
      return yield* (pendingSeeds(selection).length > 0 ? withStorageFrontier({ kind: "rows", tableId: table.tableId }, selection, read) : read);
    }))));
  const withInsertedRecord = <Value>(tableName: string, input: unknown, consume: (written: JsonObject) => Effect.Effect<Value, Failure>,
    prepareDocument?: (pending: PendingDocument) => Effect.Effect<CanonicalFlarexValueV1, Failure>) => observeExecution("LogicalDocuments.insertRecord", Effect.gen(function* (): Effect.fn.Return<Value, Failure> {
      const table = yield* tableForName(tableName);
      const fields = yield* Effect.fromResult(captureFields(input));
      const insertOwned = Effect.gen(function* () {
        if (rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
        yield* charge(128);
        const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16)))
          .pipe(Result.mapError(cause => error("resourceFailure", cause))));
        const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
        if (rows.has(documentId) || dependencies.has(documentId)) return yield* Effect.fail(error("uniqueConflict"));
        // Generation records insertion intent, without claiming a database read.
        if (dependencies.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
        yield* charge(128);
        dependencies.set(documentId, { documentId, tableId: table.tableId, rowId,
          readAt: state.snapshotCommitSeq ?? state.clock.lastCommitSeq,
          dependency: { kind: "generatedInsertion", documentId, effectOrdinal: attempts.length } });
        const time = AppCreationTimeV1Schema.make(nextCreationTime());
        return yield* withWrittenDocument({ tableId: table.tableId, tableName, rowId, documentId, base: null,
          creationTime: time, current: null, attempts: [] }, fields, "insert", consume, prepareDocument);
      });
      const selection = { tableId: table.tableId };
      return yield* (pendingSeeds(selection).length > 0 ? withStorageFrontier({ kind: "rows", tableId: table.tableId }, selection, insertOwned) : insertOwned);
    }));
  const insertRecord = (tableName: string, input: unknown) => withInsertedRecord(tableName, input, Effect.succeed);
  const insert: LogicalDocuments<Failure>["insert"] = (context, id, tableName, input) => observeExecution("LogicalDocuments.insert", Effect.suspend(() => runOperation(context, id, "write", insertRecord(tableName, input))));
  const edit = (context: BoundedRequestContext, id: PresentedTransactionId,
    documentId: string, input: unknown, operation: "patch" | "replace", tableName?: string) => observeExecution("LogicalDocuments.edit", Effect.suspend(() => runOperation(context, id, "write", Effect.gen(function* () {
      const fields = yield* Effect.fromResult(captureFields(input));
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      const previous = yield* Effect.fromResult(output(pending.current));
      const { _id: _documentId, _creationTime: _created, ...developerFields } = previous;
      return yield* write(pending, operation === "patch" ? { ...developerFields, ...fields } : fields, operation);
    }))));
  const remove: LogicalDocuments<Failure>["delete"] = (context, id, documentId, tableName) => observeExecution("LogicalDocuments.delete", Effect.suspend(() => runOperation(context, id, "write", Effect.gen(function* () {
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      yield* Effect.fromResult(recordAttempt(pending, "delete", null));
      pending.deletedValue = pending.current;
      replaceCurrent(pending, null);
    }))));
  const withAccessCandidates = <Value>(tableName: string, values: LogicalSelectionValues, indexedOnly: boolean, exactPoint: Readonly<{ columns: readonly string[]; nullColumn?: string }> | undefined, consume: (candidates: Iterable<PendingDocument>) => Effect.Effect<Value, Failure>, preparation?: CandidatePreparation, reuseValues = true) => observeExecution("LogicalDocuments.withCandidateSelection", Effect.gen(function* (): Effect.fn.Return<Value, Failure> {
    const table = yield* tableForName(tableName);
    const continueSelection = (needsStorage: boolean, selection: Effect.Effect<Iterable<PendingDocument>, Failure>,
      demand: LogicalStorageReadDemand, pendingSelection: PendingSelection = { tableId: table.tableId }) => {
      const work = selection.pipe(Effect.flatMap(consume));
      return needsStorage || pendingSeeds(pendingSelection).length > 0 || values.value("_id") === undefined && hasUncheckedRootMembership(table.tableId)
        ? withStorageFrontier(demand, pendingSelection, work) : work;
    };
    if (values.value("_id") !== undefined) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(values.value("_id")).pipe(
        Result.mapError(cause => error("invalidInput", cause))));
      if (identity.tableId !== table.tableId) return yield* Effect.fail(error("invalidInput"));
      return yield* continueSelection(!dependencies.has(identity.id) && !scanned.has(table.tableId),
        locate(identity.id, tableName).pipe(Effect.map(({ pending }) => pending === undefined ? [] : [pending])),
        { kind: "rows", tableId: table.tableId }, { tableId: table.tableId, rowIds: [identity.rowId] });
    }
    const retained = writeMechanics === undefined && readMechanics === undefined ? undefined : preparation?.access;
    // Query-required metadata owns its live generation and retains its own
    // successful definition loans. Consume that owner on every execution;
    // finite write mechanics keep their original metadata dependency path.
    const definition = retained === undefined || writeMechanics === undefined ? selectLogicalUniqueValues(yield* selectedUniqueValuesFor(table, values), table.tableId, values)
      : yield* consumeAccessMetadata(table.tableId, ["unique"], values.fields).pipe(Effect.as(retained.kind === "unique" ? retained.definition : undefined));
    if (definition !== undefined) {
      const retainedUnique = retained?.kind === "unique" && retained.definition === definition ? retained : undefined;
      const projected = reuseValues && retainedUnique?.projected !== undefined ? retainedUnique.projected : yield* Effect.gen(function* () {
        const document = yield* canonicalizeFlarexValueV1Effect(Object.fromEntries(values.fields.map(field => [field, values.value(field)])), "appDocument")
          .pipe(Effect.mapError(cause => error("invalidInput", cause)));
        return yield* Effect.fromResult(lowerUnique(definition, document, "invalidInput"));
      });
      const readKey = uniqueReadKey(definition, projected);
      if (readKey === null) return yield* Effect.fail(error("invalidInput"));
      if (reuseValues && retainedUnique?.projected?.kind === "claim" &&
          (retainedUnique.protectedBytes === undefined || compareBytesLexicographically(retainedUnique.projected.canonicalKeyBytes, retainedUnique.protectedBytes) !== 0))
        return yield* Effect.fail(error("storedCorruption"));
      if ((writeMechanics !== undefined || readMechanics !== undefined) && preparation !== undefined && retainedUnique === undefined) {
        if (reuseValues && projected.kind === "claim") {
          yield* charge(logicalUniqueKeyRetentionBytes(projected));
          preparation.access = Object.freeze({ kind: "unique", definition, projected, protectedBytes: projected.canonicalKeyBytes.slice() });
        } else preparation.access = Object.freeze({ kind: "unique", definition });
      }
      // Earlier key observations survive scans; local edits apply to both.
      const usesKey = !scanned.has(table.tableId) || uniqueReads.has(readKey);
      const prepared = yield* prepareUniqueStorageSelection(definition, projected);
      return yield* continueSelection(usesKey && !uniqueReads.has(readKey), Effect.gen(function* () {
        // Pending rows contribute current key membership before residual
        // evaluation, independently of their original storage membership.
        for (const row of rows.values()) {
          if (row.tableId !== table.tableId || row.current === null ||
            row.borrowedOverlay !== true && row.attempts.length === 0) continue;
          const currentKey = yield* Effect.fromResult(lowerUnique(definition, row.current, "storedCorruption"));
          if (uniqueReadKey(definition, currentKey) === readKey) yield* Effect.fromResult(markPendingUse(row));
        }
        if (!usesKey) {
          // The complete scan replaces storage access, not the requested key's
          // membership. Original bases retain that access before local edits.
          for (const row of rows.values()) {
            if (row.tableId !== table.tableId || row.base?.kind !== "live") continue;
            const baseKey = yield* Effect.fromResult(lowerUnique(definition, row.base.document, "storedCorruption"));
            if (uniqueReadKey(definition, baseKey) === readKey) yield* Effect.fromResult(markPendingUse(row));
          }
          return rows.values();
        }
        const ownerId = yield* locateUnique(definition, projected, Effect.succeed(prepared));
        if (ownerId !== null) yield* Effect.fromResult(markPendingUse(rows.get(ownerId)));
        return [...rows.values()].filter(row => row.tableId === table.tableId &&
          (row.documentId === ownerId || row.borrowedOverlay === true || row.attempts.length > 0));
      }), prepared.demand);
    }
    const selected = retained?.kind === "index" && writeMechanics !== undefined ? yield* consumeAccessMetadata(table.tableId, ["ordered"], values.fields).pipe(Effect.flatMap(() => reuseValues && retained.selection !== undefined
      ? Effect.succeed(retained.selection) : Effect.fromResult(selectLogicalIndexValues([retained.definition], table.tableId, values, error, exactPoint))))
      : yield* selectedIndexValuesFor(table, values, exactPoint).pipe(Effect.flatMap(definitions =>
        reuseValues && retained?.kind === "index" && retained.selection !== undefined && definitions.includes(retained.definition)
          ? Effect.succeed(retained.selection) : Effect.fromResult(selectLogicalIndexValues(definitions, table.tableId, values, error, exactPoint))));
    if (Option.isNone(selected)) {
      if (indexedOnly || values.fields.some(field => isLogicalRange(values.value(field)))) return yield* Effect.fail(error("invalidInput"));
      return yield* continueSelection(!scanned.has(table.tableId), Effect.gen(function* () {
        if (!scanned.has(table.tableId)) yield* readBase(table.tableId);
        // An unindexed read requests every current table row, including
        // pending insertions later excluded by the residual predicate.
        for (const row of rows.values()) if (row.tableId === table.tableId && row.current !== null)
          yield* Effect.fromResult(markPendingUse(row));
        return rows.values();
      }), { kind: "rows", tableId: table.tableId });
    }
    const selection = selected.value;
    if ((writeMechanics !== undefined || readMechanics !== undefined) && preparation !== undefined &&
        (retained?.kind !== "index" || retained.definition !== selection.definition)) {
      if (reuseValues) {
        yield* charge(128 + 2 * (selection.identity.length + (selection.bounds.startInclusive?.length ?? 0) + (selection.bounds.endExclusive?.length ?? 0)));
        preparation.access = Object.freeze({ kind: "index", definition: selection.definition, selection: selected });
      } else preparation.access = Object.freeze({ kind: "index", definition: selection.definition });
    }
    const usesIndex = !scanned.has(table.tableId) || indexReads.has(selection.identity);
    return yield* continueSelection(usesIndex && !indexReads.has(selection.identity), Effect.gen(function* () {
      for (const row of rows.values()) {
        if (row.tableId !== table.tableId || row.current === null ||
          row.borrowedOverlay !== true && row.attempts.length === 0) continue;
        const currentKey = yield* Effect.fromResult(lowerIndex(selection.definition, row.current, row.creationTime, "storedCorruption"));
        if (currentKey !== null && indexKeyWithinBounds(currentKey, selection.bounds)) yield* Effect.fromResult(markPendingUse(row));
      }
      if (!usesIndex) {
        for (const row of rows.values()) {
          if (row.tableId !== table.tableId || row.base?.kind !== "live") continue;
          const baseKey = yield* Effect.fromResult(lowerIndex(selection.definition, row.base.document, row.base.creationTime, "storedCorruption"));
          if (baseKey !== null && indexKeyWithinBounds(baseKey, selection.bounds)) yield* Effect.fromResult(markPendingUse(row));
        }
        return rows.values();
      }
      let read = indexReads.get(selection.identity);
      if (read === undefined) {
        if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
        yield* requireReadAdmission;
        const entries = yield* (finiteProfile !== undefined ? readFiniteIndexRows(selection, table.tableId,
          Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, callIdentityLimit)) : runRead(tx => Effect.gen(function* () {
          yield* requireReadDemand(tx, { kind: "index", tableId: table.tableId,
            indexDefinitionId: selection.definition.indexDefinitionId });
          if (state.snapshotCommitSeq === undefined) {
            const page = yield* readCurrentIndexSelection(tx, table, selection, callIdentityLimit, true, window =>
              charge(128 + window.entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0)));
            return page.entries;
          }
          const rangeEntries = yield* readLogicalIndexRange(tx, state.scopeId, selection, callIdentityLimit, error,
            testHooks?.observeIndexQuery, state.snapshotCommitSeq);
          yield* charge(128 + rangeEntries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
          if (rangeEntries.some(entry => entry.tableId !== table.tableId) || new Set(rangeEntries.map(entry => entry.rowId)).size !== rangeEntries.length)
            return yield* Effect.fail(error("storedCorruption"));
          if (!scanned.has(table.tableId)) {
            const missing = rangeEntries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
            if (missing.length > 0) yield* readBaseInTransaction(tx, table.tableId, undefined, missing.map(entry => entry.rowId));
          }
          return rangeEntries;
        })));
        for (const entry of entries) {
          const { pending } = yield* locate(appDocumentIdV1FromRowIdentity(entry));
          if (pending?.base?.kind !== "live" || pending.base.commitSeq < entry.commitSeq) return yield* Effect.fail(error("writeConflict"));
          const encoded = yield* Effect.fromResult(lowerIndex(selection.definition, pending.base.document, pending.base.creationTime, "storedCorruption"));
          if (encoded !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
        }
        read = Object.freeze({ definition: selection.definition, bounds: selection.bounds, entries });
        indexReads.set(selection.identity, read);
      }
      const members = new Set(read.entries.map(entry => appDocumentIdV1FromRowIdentity(entry)));
      // Retained index membership is still a real scoped read on a cache hit.
      // Unrelated pending overlays are inspected below without acquiring use
      // provenance merely because they reside in the shared row map.
      for (const documentId of members) yield* Effect.fromResult(markPendingUse(rows.get(documentId)));
      return [...rows.values()].filter(row => row.tableId === table.tableId &&
        (members.has(row.documentId) || row.borrowedOverlay === true || row.attempts.length > 0));
    }), { kind: "index", tableId: table.tableId, indexDefinitionId: selection.definition.indexDefinitionId });
  }));
  const selectCandidates = (tableName: string, where: LogicalWhere, indexedOnly = false, exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) => observeExecution("LogicalDocuments.selectCandidates", Effect.gen(function* () {
    return yield* withAccessCandidates(tableName, logicalWhereValues(where), indexedOnly, exactPoint, Effect.succeed);
  }));
  const find: LogicalDocuments<Failure>["find"] = (context, id, tableName, input) => observeExecution("LogicalDocuments.find", Effect.suspend(() => runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      const query = yield* Effect.fromResult(decodeLogicalFindQuery(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause))));
      if (query.limit > limits.pageRows) return yield* Effect.fail(error("invalidInput"));
      const table = yield* tableForName(tableName);
      const candidates = yield* selectCandidates(tableName, query.where);
      const matches = prepareLogicalQueryPredicate(query.where, error);
      const matched: { id: AppDocumentIdV1; document: CanonicalFlarexValueV1 }[] = [];
      for (const row of candidates) {
        if (row.tableId !== table.tableId || row.current === null) continue;
        const document = row.current.value;
        if (!isNonArrayRecord(document)) return yield* Effect.fail(error("storedCorruption"));
        if (yield* Effect.fromResult(matches(document))) {
          yield* Effect.fromResult(markRowUse(row.documentId));
          matched.push({ id: row.documentId, document: row.current });
        }
      }
      matched.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const docs = yield* Effect.forEach(matched.slice(query.offset, query.offset + query.limit), row => Effect.fromResult(output(row.document, true)));
      return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
    }))));
  const readRelationalSelection = (tableName: string, input: unknown, complete = false, preparation?: ReadPreparation) => observeExecution("LogicalDocuments.readRelationalSelection", Effect.gen(function* () {
    const table = yield* tableForName(tableName);
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(preparation?.retained?.captured.value ?? input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* compileRelationalRead(table, captured.value, preparation, captured);
    if (state.snapshotCommitSeq !== undefined && (query.search !== null || query.json !== null))
      return yield* Effect.fail(error("invalidInput"));
    if (complete && query.selections === null && query.search === null && query.json === null)
      return yield* Effect.fail(error("invalidInput"));
    const selected = new Map<AppDocumentIdV1, PendingDocument>();
    // A null predicate required by every Boolean branch may use an admitted
    // active-row index. Otherwise the first text identity member's range is the
    // bounded complete-set path; a page limit never turns into a table scan.
    let completeSelection: LogicalWhere = { [query.key]: { gte: "" } };
    let indexedNullAnchor = false;
    if (query.selections === null && query.search === null && query.json === null) for (const field of query.requiredNulls) {
      const candidate: LogicalWhere = { [field]: null };
      const index = yield* Effect.fromResult(selectLogicalIndex(yield* selectedIndexesFor(table, candidate), table.tableId, candidate, error));
      if (Option.isSome(index)) { completeSelection = candidate; indexedNullAnchor = true; break; }
    }
    if (query.requiresIndexedNullAnchor && !indexedNullAnchor) return yield* Effect.fail(error("invalidInput"));
    let usedSearchDefinition: LogicalSearchDefinition | undefined;
    if (query.json !== null || query.search !== null && query.selections === null) {
      const searchPatterns = query.search;
      const jsonPattern = query.json;
      const searchDefinitions = readMechanics?.metadata === undefined ? searchForTable(table.tableId,
        jsonPattern !== null ? [jsonPattern.column] : searchPatterns?.map(pattern => pattern.column) ?? []) :
        yield* readMechanics.metadata.selectSearch(table.logicalName, jsonPattern !== null ? [jsonPattern.column] :
          searchPatterns?.map(pattern => pattern.column) ?? [], query.requiredNulls, jsonPattern !== null ? "jsonContainment" : "text").pipe(Effect.mapError(cause => error("invalidAuthority", cause)));
      const definition = jsonPattern !== null
        ? selectLogicalJsonSearchDefinition(searchDefinitions, table.tableId,
          jsonPattern.column, new Set(query.requiredNulls))
        : searchDefinitions.find(candidate => candidate.tableId === table.tableId &&
          candidate.kind === "text" && searchPatterns !== null &&
          searchPatterns.every(pattern => candidate.columns.includes(pattern.column)));
      if (definition === undefined)
        return yield* Effect.fail(error("invalidInput"));
      if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
      yield* requireReadAdmission;
      // Candidate evidence and its previously unseen row revisions share one
      // checked read. A later operation obtains a fresh authority check.
      const entries = yield* runStorageRead({ kind: "search", tableId: table.tableId,
        logicalIndexId: definition.logicalIndexId }, { tableId: table.tableId }, tx => Effect.gen(function* () {
        yield* requireReadDemand(tx, { kind: "search", tableId: table.tableId,
          logicalIndexId: definition.logicalIndexId });
        let matches: readonly LogicalSearchMember[] | undefined;
        if (jsonPattern !== null) {
          // The JSON path may be broad while a scalar equality path is small.
          // Probe one extra member before charging or recording a read; only a
          // complete candidate path can become a transaction dependency.
          matches = yield* readLogicalJsonContainsRange(tx, state.scopeId,
            definition, jsonPattern.column, jsonPattern.value, callIdentityLimit,
            (reason, cause) => reason === "limitExceeded"
              ? { kind: "overflow" as const } : { kind: "failure" as const, value: error(reason, cause) })
            .pipe(Effect.matchEffect({
              onSuccess: found => Effect.succeed(found),
              onFailure: failure => failure.kind === "failure" ? Effect.fail(failure.value)
                : query.selections === null ? Effect.fail(error("limitExceeded")) : Effect.succeed(undefined),
            }));
        } else if (searchPatterns !== null) {
          matches = yield* readLogicalSearchRange(tx, state.scopeId, definition,
            searchPatterns, callIdentityLimit, error);
        }
        if (matches !== undefined) {
          yield* charge(128 + matches.length * 96);
          if (jsonPattern !== null) searchReads.push(Object.freeze({ kind: "jsonContainment", definition,
            column: jsonPattern.column, value: jsonPattern.value, entries: matches }));
          else if (searchPatterns !== null) searchReads.push(Object.freeze({ kind: "text", definition,
            patterns: searchPatterns, entries: matches }));
          const members = new Set(matches.map(entry => entry.rowId));
          const missing = [...members].filter(rowId => !dependencies.has(appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId })));
          if (missing.length > 0) yield* readBaseInTransaction(tx, table.tableId, undefined, missing);
        }
        return matches;
      }));
      if (entries !== undefined) {
        usedSearchDefinition = definition;
        const members = new Set(entries.map(entry => entry.rowId));
        for (const entry of entries) {
          const { pending } = yield* locate(appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: entry.rowId }));
          if (pending?.base?.kind !== "live" || pending.base.commitSeq !== entry.commitSeq)
            return yield* Effect.fail(error("writeConflict"));
        }
        for (const row of rows.values()) if (row.tableId === table.tableId && row.current !== null &&
          (members.has(row.rowId) || row.borrowedOverlay === true || row.attempts.length > 0)) selected.set(row.documentId, row);
      }
    }
    if (usedSearchDefinition === undefined) {
      // Retain the declared anchor: a membership-null field must not win a
      // physical-index tie against the scalar selection it qualifies.
      const selections = query.selections === null ? [{ values: logicalWhereValues(completeSelection) }] :
        query.selections.map(selection => ({ values: logicalRelationalSelectionValues(selection),
          exactPoint: { columns: selection.kind === "point" ? selection.columns : [selection.column],
            ...(selection.nullColumn === undefined ? {} : { nullColumn: selection.nullColumn }) } }));
      // Keep recursive selection consumption inside the borrowed frontier. A
      // caller stack/span for every selection repeats relational read ownership.
      const collectSelections = Effect.fnUntraced(function* (position: number): Effect.fn.Return<void, Failure> {
        const selection = selections[position];
        if (selection === undefined) return;
        let candidate = preparation?.candidates?.get(position);
        if (candidate === undefined && preparation?.candidates !== undefined) {
          candidate = {};
          preparation.candidates.set(position, candidate);
        }
        return yield* withAccessCandidates(tableName, selection.values, true,
          "exactPoint" in selection ? selection.exactPoint : undefined, candidates => Effect.gen(function* () {
            for (const row of candidates)
              if (row.tableId === table.tableId && row.current !== null) selected.set(row.documentId, row);
            yield* collectSelections(position + 1);
          }), candidate);
      });
      yield* collectSelections(0);
    }
    // Selection has settled. Inspection, ordering and projection are bounded
    // synchronous owner work; retain lazy row order inside one Result fold.
    const result = yield* Effect.fromResult(Result.gen(function* () {
      const matched: { document: JsonObject; order: Uint8Array; documentId: AppDocumentIdV1 }[] = [];
      for (const row of selected.values()) {
        if (row.current === null) continue;
        const current = row.current;
        const document = yield* output(current, true);
        const inspected = yield* query.inspect(document, current);
        // A selected pending search member is observed before residuals just
        // like its committed counterpart. An unrelated overlay is not a member.
        if (usedSearchDefinition !== undefined && (row.borrowedOverlay === true || row.attempts.length > 0) &&
          (usedSearchDefinition.nullPredicateField === null || document[usedSearchDefinition.nullPredicateField] === null) &&
          query.matchesSearchAnchor(document)) yield* markRowUse(row.documentId);
        if (inspected.matches) {
          yield* markRowUse(row.documentId);
          matched.push({ document, order: inspected.order, documentId: row.documentId });
        }
      }
      matched.sort((left, right) => {
        const ordered = compareBytesLexicographically(left.order, right.order) * (query.direction === "asc" ? 1 : -1);
        return ordered || left.documentId.localeCompare(right.documentId);
      });
      const docs: JsonObject[] = [];
      for (const row of complete ? matched : matched.slice(query.offset, query.offset + query.limit)) {
        const projected: Record<string, Json> = {};
        for (const field of query.fields) {
          const value = row.document[field];
          if (value === undefined) return yield* Result.fail(error("storedCorruption"));
          projected[field] = value;
        }
        docs.push(yield* projectedOutput(projected));
      }
      return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
    }));
    relationalReads.push(Object.freeze({ tableId: table.tableId, tableName: table.logicalName,
      query: captured.value, total: result.total, returned: result.docs.length }));
    return result;
  }));
  const executeRelationalFind = (context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown, preparation?: ReadPreparation) => observeExecution("LogicalDocuments.relationalFind", Effect.suspend(() => runOperation(context, id, "read", readRelationalSelection(tableName, input, false, preparation))));

  const executeRelationalPage = (context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown, preparation?: ReadPreparation) => observeExecution("LogicalDocuments.relationalPage", Effect.suspend(() => runOperation(context, id, "read", Effect.gen(function* () {
    const table = yield* tableForName(tableName);
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(preparation?.retained?.captured.value ?? input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* compileRelationalRead(table, captured.value, preparation, captured);
    if (query.search !== null || query.direction !== "asc" || query.selections !== null && query.selections.length > 1)
      return yield* Effect.fail(error("invalidInput"));
    if (query.offset >= callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
    if (query.selections?.length === 0) return Object.freeze({ rows: Object.freeze([]), hasMore: false });
    const pageSelection = query.selections?.[0];
    const pageEquality = pageSelection === undefined || pageSelection.kind === "point" || typeof pageSelection.value === "object"
      ? undefined : { column: pageSelection.column, value: pageSelection.value };
    if (pageSelection !== undefined && pageEquality === undefined)
      return yield* Effect.fail(error("invalidInput"));
    yield* consumeAccessMetadata(table.tableId, ["ordered"], [pageEquality?.column ?? query.orderColumn]);
    const selected = writeMechanics !== undefined && preparation?.page !== undefined ? preparation.page : yield* Effect.gen(function* () {
      const pageDefinitions = writeMechanics !== undefined ? writeMechanics.indexCandidates(table.tableId,
        [pageEquality?.column ?? query.orderColumn]) : readMechanics?.metadata === undefined ? indexesForTable(table.tableId) :
        yield* readMechanics.metadata.selectPage(table.logicalName, query.orderColumn, pageEquality, query.requiredNulls)
          .pipe(Effect.map(definition => definition === null ? [] : [definition]), Effect.mapError(cause => error("invalidAuthority", cause)));
      if (preparation?.page !== undefined && Option.isSome(preparation.page) && pageDefinitions.includes(preparation.page.value.definition))
        return preparation.page;
      return yield* Effect.fromResult(selectLogicalPageIndex(pageDefinitions, table.tableId,
        query.orderColumn, pageEquality, query.requiredNulls, error));
    });
    if (Option.isNone(selected)) return yield* Effect.fail(error("invalidInput"));
    if ((writeMechanics !== undefined || readMechanics !== undefined) && preparation !== undefined && preparation.page !== selected) {
      yield* charge(128 + 2 * ((selected.value.bounds.startInclusive?.length ?? 0) + (selected.value.bounds.endExclusive?.length ?? 0)));
      preparation.page = selected;
    }
    const selection = selected.value;
    type Member = { row: PendingDocument; key: string; document: JsonObject };
    const matched = new Map<AppDocumentIdV1, Member>();

    const add = (row: PendingDocument) => observeExecution("LogicalDocuments.pageMember", Effect.gen(function* () {
      if (row.current === null) return;
      const key = yield* Effect.fromResult(lowerIndex(selection.definition, row.current, row.creationTime, "storedCorruption"));
      if (key === null || !indexKeyWithinBounds(key, selection.bounds)) return;
      yield* Effect.fromResult(markRowUse(row.documentId));
      const document = row.current;
      const inspected = yield* Effect.fromResult(Result.gen(function* () {
        const runtime = yield* output(document, true);
        const verdict = yield* query.inspect(runtime, document);
        return { document: runtime, ...verdict };
      }));
      if (inspected.matches) matched.set(row.documentId, { row, key, document: inspected.document });
    }));
    return yield* withStorageFrontier({ kind: "index", tableId: table.tableId,
      indexDefinitionId: selection.definition.indexDefinitionId }, { tableId: table.tableId }, Effect.gen(function* () {
      let examined = 0;
      for (const row of rows.values()) if (row.tableId === table.tableId && (row.borrowedOverlay === true || row.attempts.length > 0)) {
        if (++examined > callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
        yield* charge(64);
        yield* add(row);
      }
      const needed = query.offset + query.limit + 1;
      let after: AppIndexRangeCursorV1 | undefined;
      let result: Member[] = [];
      while (true) {
        const remaining = callIdentityLimit - examined;
        if (remaining < 1) return yield* Effect.fail(error("limitExceeded"));
        // Batch residual filtering while charging the actual hidden lookahead.
        const limit = Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, Math.max(16, needed - matched.size), remaining);
        if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
        yield* requireReadAdmission;
        const page = yield* (finiteProfile !== undefined ? Effect.gen(function* () {
          const window = yield* readFiniteIndexPage({ ...selection, ...(after === undefined ? {} : { after }) }, limit);
          examined += window.entries.length + (window.isDone ? 0 : 1);
          if (examined > callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
          yield* charge(128 + window.entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
          pageReads.push(Object.freeze({ ...selection, ...(after === undefined ? {} : { after: Object.freeze({ ...after }) }),
            entries: window.entries, isDone: window.isDone }));
          if (window.entries.some(entry => entry.tableId !== table.tableId)) return yield* Effect.fail(error("storedCorruption"));
          const missing = window.entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
          if (missing.length > 0) yield* readFiniteBase(table.tableId, missing.map(entry => entry.rowId));
          return window;
        }) : runRead(tx => Effect.gen(function* () {
          yield* requireReadDemand(tx, { kind: "index", tableId: table.tableId,
            indexDefinitionId: selection.definition.indexDefinitionId });
          if (state.snapshotCommitSeq === undefined) return yield* readCurrentIndexSelection(tx, table,
            { ...selection, ...(after === undefined ? {} : { after }) }, limit, false, window => Effect.gen(function* () {
              examined += window.entries.length + (window.isDone ? 0 : 1);
              if (examined > callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
              yield* charge(128 + window.entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
              pageReads.push(Object.freeze({ ...selection, ...(after === undefined ? {} : { after: Object.freeze({ ...after }) }),
                entries: window.entries, isDone: window.isDone }));
            }));
          const window = yield* readLogicalIndexPage(tx, state.scopeId, { ...selection, ...(after === undefined ? {} : { after }) },
            limit, error, testHooks?.observeIndexQuery, state.snapshotCommitSeq);
          examined += window.entries.length + (window.isDone ? 0 : 1);
          if (examined > callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
          yield* charge(128 + window.entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
          const read = Object.freeze({ ...selection, ...(after === undefined ? {} : { after: Object.freeze({ ...after }) }),
            entries: window.entries, isDone: window.isDone });
          pageReads.push(read);
          if (window.entries.some(entry => entry.tableId !== table.tableId)) return yield* Effect.fail(error("storedCorruption"));
          const missing = window.entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
          if (missing.length > 0) yield* readBaseInTransaction(tx, table.tableId, undefined, missing.map(entry => entry.rowId));
          return window;
        })));
        for (const entry of page.entries) {
          const { pending } = yield* locate(appDocumentIdV1FromRowIdentity(entry), tableName);
          if (pending?.base?.kind !== "live" || pending.base.commitSeq < entry.commitSeq) return yield* Effect.fail(error("writeConflict"));
          const baseKey = yield* Effect.fromResult(lowerIndex(selection.definition, pending.base.document, pending.base.creationTime, "storedCorruption"));
          if (baseKey !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
          if (pending.attempts.length === 0) yield* add(pending);
        }
        result = [...matched.values()].toSorted((left, right) => comparePagePosition({ key: left.key, rowId: left.row.rowId }, { key: right.key, rowId: right.row.rowId }));
        const frontier = result[needed - 1], witness = page.entries[page.entries.length - 1];
        // A pending-only frontier still requires a committed successor or EOF.
        // Each captured window includes that witness, protecting its negative gap.
        if (page.isDone || frontier !== undefined && witness !== undefined &&
          comparePagePosition({ key: frontier.key, rowId: frontier.row.rowId }, { key: witness.encodedKey, rowId: witness.rowId }) <= 0) break;
        if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
        after = page.continueCursor;
      }
      const projected: JsonObject[] = [];
      for (const member of result.slice(query.offset, query.offset + query.limit)) {
        const row: Record<string, Json> = {};
        for (const field of query.fields) {
          const value = member.document[field];
          if (value === undefined) return yield* Effect.fail(error("storedCorruption"));
          row[field] = value;
        }
        projected.push(yield* Effect.fromResult(projectedOutput(row)));
      }
      return Object.freeze({ rows: Object.freeze(projected), hasMore: result.length > query.offset + query.limit });
    }));
  }))));
  const relationalAggregate = (context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => observeExecution("LogicalDocuments.relationalAggregate", Effect.suspend(() => runOperation(context, id, "read", Effect.gen(function* () {
    const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* Effect.fromResult(decodeLogicalAggregate(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause))));
    const table = yield* tableForName(tableName);
    if (table.relational === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const key = (yield* Effect.fromResult(relationalTextIdentity(table.relational, error)))[0];
    if (key === undefined) return yield* Effect.fail(error("invalidInput"));
    if (query.sum !== undefined) {
      const column = table.relational.columns.find(candidate => candidate.identity.columnId === query.sum);
      if (column?.type !== "numeric" && column?.type !== "integer") return yield* Effect.fail(error("invalidInput"));
    }
    const result = yield* readRelationalSelection(tableName, { predicate: query.predicate, order: { column: key, direction: "asc" } }, true);
    return Object.freeze({ count: result.total, ...(query.sum === undefined ? {} : {
      sum: yield* Effect.fromResult(sumLogicalRows(result.docs, query.sum, error)),
    }) });
  }))));
  const relationalChange = (context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, operation: "insert" | "upsert" | "update" | "upsertPreservingDeletion" | "delete" | "softDelete" | "restore" | "reconstitute", input: unknown) => observeExecution("LogicalDocuments.relationalChange", Effect.suspend(() => runOperation(context, id, "write", Effect.gen(function* () {
      yield* Effect.fromResult(decodeRelationalChange(operation).pipe(Result.mapError(cause => error("invalidInput", cause))));
      if (operation === "reconstitute" && state.allowReconstitution !== true)
        return yield* Effect.fail(error("invalidAuthority"));
      if (operation === "upsertPreservingDeletion" && state.allowPreservingDeletionUpsert !== true)
        return yield* Effect.fail(error("invalidAuthority"));
      const table = yield* tableForName(tableName);
      if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      if (table.relationalMechanics === undefined || !hasPreparedLogicalRelationalTableMechanics(table.relationalMechanics, table.relational))
        return yield* Effect.fail(error("invalidAuthority"));
      const relationalMechanics = table.relationalMechanics;
      const policy = yield* Effect.fromResult(bindPreparedLogicalRelationalRows(relationalMechanics, error));
      const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      const capturedRows = yield* Effect.fromResult(Result.gen(function* () {
        if (!Array.isArray(captured.value)) return yield* Result.fail(error("invalidInput"));
        if (captured.value.length > callIdentityLimit) return yield* Result.fail(error("limitExceeded"));
        const rowsByKey = new Map<string, Readonly<{ identity: Record<string, string>; row: JsonObject }>>();
        for (const item of captured.value) {
          const singleKey = policy.keyColumns.length === 1 ? policy.keyColumns[0] : undefined;
          const row = operation === "delete" || operation === "softDelete" || operation === "restore" ?
            typeof item === "string" && singleKey !== undefined ? { [singleKey]: item } : item : item;
          if (!isJsonObject(row)) return yield* Result.fail(error("invalidInput"));
          yield* policy.validateInput(row);
          if ((operation === "delete" || operation === "softDelete" || operation === "restore") &&
            (Object.keys(row).length !== policy.keyColumns.length || Object.keys(row).some(name => !policy.keyColumns.some(column => column === name))))
            return yield* Result.fail(error("invalidInput"));
          const identity: Record<string, string> = {};
          for (const column of policy.keyColumns) {
            const value = row[column];
            if (typeof value !== "string" || value.length === 0) return yield* Result.fail(error("invalidInput"));
            identity[column] = value;
          }
          const key = JSON.stringify(policy.keyColumns.map(column => identity[column]));
          if (rowsByKey.has(key)) return yield* Result.fail(error("invalidInput"));
          rowsByKey.set(key, { identity, row });
        }
        return [...rowsByKey.values()];
      }));
      const result: JsonObject[] = [];
      const observeLifecycle = (key: Record<string, string>, lifecycleOperation: "softDelete" | "restore", before: JsonObject, after: JsonObject, attemptOrdinal: number | null) => observeExecution("LogicalDocuments.observeLifecycle", Effect.gen(function* () {
        const deletedAt = policy.deletedAt;
        if (deletedAt === undefined) return yield* Effect.fail(error("invalidAuthority"));
        const previous = before[deletedAt], next = after[deletedAt];
        if ((previous !== null && typeof previous !== "string") || (next !== null && typeof next !== "string") ||
          (lifecycleOperation === "restore" ? next !== null : next === null)) return yield* Effect.fail(error("storedCorruption"));
        const capturedRow = attemptOrdinal === null
          ? yield* Effect.fromResult(capturePrivateJsonData(after, lifetime.remainingBytes(), error)) : null;
        const rowAtOperation = capturedRow?.value ?? null;
        if (rowAtOperation !== null && !isJsonObject(rowAtOperation)) return yield* Effect.fail(error("storedCorruption"));
        yield* charge(128 + tableName.length + JSON.stringify(key).length + (previous?.length ?? 0) + (next?.length ?? 0)
          + (capturedRow?.bytes ?? 0));
        lifecycle.push(Object.freeze({ tableId: table.tableId, tableName, key: Object.freeze({ ...key }), operation: lifecycleOperation,
          beforeDeletedAt: previous, afterDeletedAt: next, attemptOrdinal, rowAtOperation }));
      }));
      // Every identity uses this source's same validated, non-null text key
      // columns. Retain the chosen definition; each row still encodes its own
      // values at its original ordinal, after earlier rows have settled.
      const identityPreparation: CandidatePreparation = {};
      const changeRows = (position: number) => observeExecution("LogicalDocuments.changeRows", Effect.gen(function* (): Effect.fn.Return<void, Failure> {
        const selectedRow = capturedRows[position];
        if (selectedRow === undefined) return;
        const { identity, row: inputRow } = selectedRow;
        return yield* withAccessCandidates(tableName, logicalWhereValues(identity), true, undefined, candidates => Effect.gen(function* () {
          let pending: PendingDocument | undefined;
          for (const candidate of candidates) {
            const current = candidate.current?.value;
            if (candidate.tableId !== table.tableId || !isNonArrayRecord(current) ||
              !policy.keyColumns.every(column => current[column] === identity[column])) continue;
            if (pending !== undefined) return yield* Effect.fail(error("storedCorruption"));
            pending = candidate;
          }
          let deletedPreimage: JsonObject | undefined;
          if (operation === "reconstitute") {
            if (pending !== undefined) return yield* Effect.fail(error("uniqueConflict"));
            // Only this root's authenticated pending deletions can grant reuse
            // of an existing logical identity. Never look up committed history.
            for (const candidate of rows.values()) {
              if (candidate.tableId !== table.tableId || candidate.current !== null || candidate.deletedValue === undefined) continue;
              const lastOrdinal = candidate.attempts.at(-1);
              const last = lastOrdinal === undefined ? undefined : attempts[lastOrdinal];
              if (last?.operation !== "delete" || last.documentId !== candidate.documentId || last.before !== candidate.deletedValue) continue;
              const native = yield* Effect.fromResult(nativeLogicalRelationalCanonicalRow(
                relationalMechanics, candidate.deletedValue, limits.documentBytes, error));
              if (!policy.keyColumns.every(column => native[column] === identity[column])) continue;
              if (pending !== undefined) return yield* Effect.fail(error("invalidInput"));
              pending = candidate;
              deletedPreimage = native;
            }
            if (pending === undefined || deletedPreimage === undefined || !jsonEqual(inputRow, deletedPreimage) ||
              policy.deletedAt !== undefined && deletedPreimage[policy.deletedAt] !== null)
              return yield* Effect.fail(error("invalidInput"));
          }
          if (pending === undefined && (operation === "update" || operation === "delete" || operation === "softDelete" || operation === "restore")) return yield* changeRows(position + 1);
          if (pending !== undefined && operation === "insert") return yield* Effect.fail(error("uniqueConflict"));
          // Unchanged lifecycle operations still use their selected row, even
          // when a complete scan supplied it without a keyed storage probe.
          yield* Effect.fromResult(markPendingUse(pending));
          const previous = deletedPreimage ?? (pending?.current == null ? null : yield* Effect.fromResult(
            nativeLogicalRelationalCanonicalRow(relationalMechanics, pending.current, limits.documentBytes, error)));
          if (operation === "delete") {
            if (pending === undefined || previous === null || pending.current === null) return yield* Effect.fail(error("storedCorruption"));
            yield* Effect.fromResult(recordAttempt(pending, "delete", null));
            pending.deletedValue = pending.current;
            replaceCurrent(pending, null);
            result.push(previous);
            return yield* changeRows(position + 1);
          }
          if (operation === "restore" && state.allowActiveRestoreUpdate !== true &&
            policy.deletedAt !== undefined && previous?.[policy.deletedAt] === null) {
            yield* observeLifecycle(identity, operation, previous, previous, null);
            result.push(previous);
            return yield* changeRows(position + 1);
          }
          const applyChange = Effect.gen(function* () {
            let supplied = inputRow;
            // Native relational upsert reactivates a soft-deleted row on key
            // conflict. Keep that behavior with the shared logical row owner.
            if (operation === "upsert" && previous !== null && policy.deletedAt !== undefined)
              supplied = { ...inputRow, [policy.deletedAt]: null };
            if (operation === "softDelete" || operation === "restore") {
              if (policy.deletedAt === undefined || previous === null) return yield* Effect.fail(error("invalidInput"));
              supplied = { ...inputRow, [policy.deletedAt]: operation === "restore" ? null : yield* transactionTime };
            }
            // The existing upsert contract reactivates without advancing time.
            // The explicitly admitted preserving-deletion merge instead keeps
            // omitted deletion fields and advances time, even for an ID alone.
            // Ordinary updates and lifecycle transitions also advance it.
            const fields = yield* Effect.fromResult(policy.normalize(supplied, previous,
              yield* transactionTime, operation === "upsert" ? "preserve" : "advance"));
            const afterWrite = (written: JsonObject) => Effect.gen(function* () {
              const { _id: _internalId, _creationTime: _internalTime, ...native } = written;
              const capturedNative = yield* Effect.fromResult(useCapturedPrivateJsonData(native, Number.MAX_SAFE_INTEGER, error));
              if (!isJsonObject(capturedNative.value)) return yield* Effect.fail(error("storedCorruption"));
              if ((operation === "softDelete" || operation === "restore") && previous !== null)
                yield* observeLifecycle(identity, operation, previous, capturedNative.value, attempts.length - 1);
              result.push(capturedNative.value);
              yield* changeRows(position + 1);
            });
            const prepareDocument = (selected: PendingDocument) => canonicalizeLogicalRelationalRow(relationalMechanics, fields,
              selected.documentId, selected.creationTime).pipe(Effect.mapError(cause => error(cause.reason, cause.cause)));
            return yield* (pending === undefined ? withInsertedRecord(tableName, fields, afterWrite, prepareDocument) :
              withWrittenDocument(pending, fields, operation === "reconstitute" ? "insert" : "patch", afterWrite, prepareDocument));
          });
          return yield* (transactionTimeLoaded ? applyChange : withStorageFrontier({ kind: "rows", tableId: table.tableId },
            { tableId: table.tableId }, applyChange));
        }), identityPreparation, false);
      }));
      yield* changeRows(0);
      const returned = yield* Effect.fromResult(useCapturedPrivateJsonData(result, lifetime.remainingBytes(), error));
      yield* charge(returned.bytes);
      if (!isJsonArray(returned.value) || !returned.value.every(isJsonObject))
        return yield* Effect.fail(error("storedCorruption"));
      return returned.value;
    }))));
  const validateRelationalReferences = () => observeExecution("LogicalDocuments.validateRelationalReferences", Effect.gen(function* () {
    if (foreignKeys.length === 0) return;
    // A deleted or rekeyed parent may expose untouched children. A replacement
    // parent with the same key satisfies the final reference and must not
    // cascade those children. Every reverse observation is indexed and bounded.
    const removed: { tableId: CatalogTableId; column: string; key: string }[] = [];
    const appendKeys = (row: PendingDocument, value: unknown) => Result.gen(function* () {
      if (!isNonArrayRecord(value)) return yield* Result.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.target.tableId !== row.tableId) continue;
        const key = value[foreignKey.target.column];
        if (typeof key !== "string") return yield* Result.fail(error("storedCorruption"));
        removed.push({ tableId: row.tableId, column: foreignKey.target.column, key });
      }
    });
    for (const row of rows.values()) {
      if (ownedTable(row.tableId) === undefined) continue;
      if (row.attempts.length === 0 || row.current !== null) continue;
      if (row.base?.kind === "live") yield* Effect.fromResult(appendKeys(row, row.base.document.value));
      if (row.deletedValue !== undefined) yield* Effect.fromResult(appendKeys(row, row.deletedValue.value));
    }
    const checkRemoved = (cascade: boolean) => observeExecution("LogicalDocuments.checkRemovedRelationalKeys", Effect.gen(function* () {
      const checked = new Set<string>();
      for (let position = 0; position < removed.length; position++) {
        const entry = removed[position];
        if (entry === undefined) continue;
        const key = JSON.stringify([entry.tableId, entry.column, entry.key]);
        if (checked.has(key)) continue;
        checked.add(key);
        for (const foreignKey of foreignKeys) {
          if (foreignKey.target.tableId !== entry.tableId || foreignKey.target.column !== entry.column) continue;
          let replacement = false;
          for (const target of yield* selectCandidates(foreignKey.target.name,
            { [foreignKey.target.column]: entry.key }, true)) {
            if (target.tableId !== foreignKey.target.tableId || target.current === null) continue;
            const value = target.current.value;
            if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
            if (value[foreignKey.target.column] === entry.key) replacement = true;
          }
          if (replacement) continue;
          if (setNull.some(intent => intent.sourceTableId === foreignKey.source.tableId &&
            intent.sourceColumn === foreignKey.source.column && intent.targetTableId === entry.tableId &&
            intent.targetColumn === entry.column && intent.targetKey === entry.key)) continue;
          for (const child of yield* selectCandidates(foreignKey.source.name,
            { [foreignKey.source.column]: entry.key }, true)) {
            if (child.tableId !== foreignKey.source.tableId || child.current === null) continue;
            const value = child.current.value;
            if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
            if (value[foreignKey.source.column] !== entry.key) continue;
            if (!cascade || foreignKey.onDelete !== "cascade") return yield* Effect.fail(error("documentInvalid"));
            yield* Effect.fromResult(recordAttempt(child, "delete", null));
            child.deletedValue = child.current;
            replaceCurrent(child, null);
            if (child.base?.kind === "live") yield* Effect.fromResult(appendKeys(child, child.base.document.value));
            yield* Effect.fromResult(appendKeys(child, value));
          }
        }
      }
    }));
    yield* checkRemoved(true);
    // Native onUpdate is restrict/noAction: only surviving rekeys are checked.
    // A row deleted by a cascade above has already followed onDelete policy.
    removed.length = 0;
    for (const row of rows.values()) {
      if (ownedTable(row.tableId) === undefined) continue;
      if (row.attempts.length === 0 || row.base?.kind !== "live" || row.current === null) continue;
      const before = row.base.document.value;
      const after = row.current.value;
      if (!isNonArrayRecord(before) || !isNonArrayRecord(after)) return yield* Effect.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.target.tableId !== row.tableId || before[foreignKey.target.column] === after[foreignKey.target.column]) continue;
        const key = before[foreignKey.target.column];
        if (typeof key !== "string") return yield* Effect.fail(error("storedCorruption"));
        removed.push({ tableId: row.tableId, column: foreignKey.target.column, key });
      }
    }
    yield* checkRemoved(false);
    // Resolve against final pending rows, so parent and child inserts may be
    // issued in either order. A unique-slot or indexed observation is retained
    // for revalidation under the publication exclusion.
    for (const child of rows.values()) {
      if (ownedTable(child.tableId) === undefined) continue;
      if (child.attempts.length === 0 || child.current === null) continue;
      const value = child.current.value;
      if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.source.tableId !== child.tableId) continue;
        const reference = value[foreignKey.source.column];
        if (reference === null) continue;
        if (typeof reference !== "string") return yield* Effect.fail(error("storedCorruption"));
        let found = false;
        for (const target of yield* selectCandidates(foreignKey.target.name, { [foreignKey.target.column]: reference }, true)) {
          if (target.tableId !== foreignKey.target.tableId || target.current === null) continue;
          const targetValue = target.current.value;
          if (!isNonArrayRecord(targetValue)) return yield* Effect.fail(error("storedCorruption"));
          if (targetValue[foreignKey.target.column] === reference) found = true;
        }
        if (!found) return yield* Effect.fail(error("documentInvalid"));
      }
    }
  }));
  const planSetNull = (context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalSetNullIntent) => observeExecution("LogicalDocuments.planSetNull", Effect.suspend(() => lifetime.operation(context, id, "write", Effect.gen(function* () {
      yield* state.requireAdmission;
      if (closed || root?.closed || setNull.length >= 16 || referenceReplacements.length !== 0)
        return yield* Effect.fail(error(closed || root?.closed ? "closed" : setNull.length >= 16 ? "limitExceeded" : "invalidAuthority"));
      const foreignKey = foreignKeys.find(key => key.source.tableId === intent.sourceTableId &&
        key.source.column === intent.sourceColumn && key.target.tableId === intent.targetTableId &&
        key.target.column === intent.targetColumn && key.source.nullable && key.onDelete === "noAction");
      if (foreignKey === undefined || typeof intent.targetKey !== "string" ||
        setNull.some(prior => prior.sourceTableId === intent.sourceTableId && prior.sourceColumn === intent.sourceColumn &&
          prior.targetTableId === intent.targetTableId && prior.targetColumn === intent.targetColumn &&
          prior.targetKey === intent.targetKey)) return yield* Effect.fail(error("invalidAuthority"));
      const roots = [...rows.values()].filter(row => row.tableId === intent.targetTableId && row.base?.kind === "live" &&
        row.current === null && row.deletedValue !== undefined && isJsonObject(row.deletedValue.valueJson) &&
        row.deletedValue.valueJson[intent.targetColumn] === intent.targetKey);
      if (roots.length !== 1 || [...rows.values()].some(row => row.tableId === intent.sourceTableId &&
        ((row.base?.kind === "live" && isJsonObject(row.base.document.valueJson) &&
          row.base.document.valueJson[intent.sourceColumn] === intent.targetKey) ||
          (row.current !== null && isJsonObject(row.current.valueJson) &&
            row.current.valueJson[intent.sourceColumn] === intent.targetKey))))
        return yield* Effect.fail(error("invalidAuthority"));
      yield* charge(128 + intent.targetKey.length * 2);
      setNull.push(Object.freeze({ sourceTableId: intent.sourceTableId, sourceColumn: intent.sourceColumn,
        targetTableId: intent.targetTableId, targetColumn: intent.targetColumn, targetKey: intent.targetKey }));
    }))));
  const planReferenceReplacement = (context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalReferenceReplacementIntent) => observeExecution("LogicalDocuments.planReferenceReplacement", Effect.suspend(() => lifetime.operation(context, id, "write", Effect.gen(function* () {
      yield* state.requireAdmission;
      if (closed || root?.closed || setNull.length !== 0 || referenceReplacements.length !== 0)
        return yield* Effect.fail(error(closed || root?.closed ? "closed" : "invalidAuthority"));
      const foreignKey = foreignKeys.find(key => key.source.tableId === intent.sourceTableId &&
        key.source.column === intent.sourceColumn && key.target.tableId === intent.targetTableId &&
        key.target.column === intent.targetColumn && key.source.nullable && key.onDelete === "noAction");
      if (foreignKey === undefined || typeof intent.targetKey !== "string" || !Array.isArray(intent.desiredKeys) ||
        intent.desiredKeys.length > 256 || intent.desiredKeys.some(key => typeof key !== "string" || key.length === 0))
        return yield* Effect.fail(error("invalidInput"));
      const roots = [...rows.values()].filter(row => row.tableId === intent.targetTableId && row.base?.kind === "live" && row.current !== null &&
        row.attempts.length > 0 && isJsonObject(row.current.valueJson) &&
        row.current.valueJson[intent.targetColumn] === intent.targetKey);
      const source = yield* tableForId(intent.sourceTableId);
      if (roots.length !== 1 || source.relational === undefined || source.relational.keys.some(key =>
        key.columns.some(column => column.columnId === intent.sourceColumn)))
        return yield* Effect.fail(error("invalidAuthority"));
      const desiredKeys = Object.freeze([...new Set(intent.desiredKeys)]);
      yield* charge(128 + intent.targetKey.length * 2 +
        desiredKeys.reduce((bytes, key) => bytes + 32 + key.length * 2, 0));
      referenceReplacements.push(Object.freeze({ sourceTableId: intent.sourceTableId,
        sourceColumn: intent.sourceColumn, targetTableId: intent.targetTableId,
        targetColumn: intent.targetColumn, targetKey: intent.targetKey, desiredKeys }));
    }))));
  // Borrowed row values remain lexical to this working set. Each actual reader
  // detaches its complete result once before those values leave the owner.
  const activityCursors = new WeakSet<LogicalDocumentActivityCursor>();
  const observedProjections = new WeakMap<CanonicalFlarexValueV1,
    Readonly<{ original: JsonObject; row: LogicalDocumentObservedRow }>>();
  let observedOrder: readonly AppDocumentIdV1[] = [];
  let observedOrderSet = new Set<AppDocumentIdV1>();
  let preparedActivity: Readonly<{ key: string; observedRows: readonly LogicalDocumentObservedRow[];
    contribution: LogicalDocumentActivityContribution }> | undefined;
  let aggregateActivity: Readonly<{ key: string; activity: LogicalDocumentActivity }> | undefined;
  const activityKey = () => `${root?.activityGeneration ?? activityGeneration}/${observationOrdinal}/${rows.size}/${dependencies.size}/${attempts.length}/${lifecycle.length}/${relationalReads.length}/${setNull.length}/${referenceReplacements.length}`;
  const prepareActivity = Effect.gen(function* () {
    if (closed || root?.closed) return yield* Effect.fail(error("closed"));
    // Close-time reference checks can hydrate rows without opening another
    // operation. Include their observation counts as well as the generation.
    const key = activityKey();
    if (preparedActivity?.key === key) return preparedActivity;
    const observedById = new Map<AppDocumentIdV1, LogicalDocumentObservedRow>();
    for (const row of rows.values()) {
      if (ownedTable(row.tableId) === undefined) continue;
      if (row.current === null) continue;
      const value = row.current.valueJson;
      if (!isJsonObject(value) || !dependencies.has(row.documentId)) return yield* Effect.fail(error("storedCorruption"));
      const tableName = localTableName(row.tableId) ?? row.tableName;
      let projection = observedProjections.get(row.current);
      if (projection === undefined) {
        // The authoritative reader or original root owns this exact canonical
        // identity. Capture its policy JSON once without charging again; the
        // existing observation and result charges keep their original order.
        // The accepting read/root already bounded and charged this row. A
        // finite representation ceiling adds no request/document policy here.
        const captured = yield* Effect.fromResult(captureLogicalRelationalActivityJson(row.current, error));
        if (!isJsonObject(captured.value)) return yield* Effect.fail(error("storedCorruption"));
        projection = Object.freeze({ original: value, row: Object.freeze({ documentId: row.documentId,
          tableId: row.tableId, tableName, value: captured.value }) });
        observedProjections.set(row.current, projection);
      } else if (projection.row.documentId !== row.documentId || projection.row.tableId !== row.tableId ||
        projection.row.tableName !== tableName || projection.original !== value)
        return yield* Effect.fail(error("storedCorruption"));
      observedById.set(row.documentId, projection.row);
    }
    if (observedById.size !== observedOrderSet.size || [...observedById.keys()].some(documentId => !observedOrderSet.has(documentId))) {
      observedOrder = Object.freeze([...observedById.values()].toSorted((left, right) =>
        left.tableId - right.tableId || left.documentId.localeCompare(right.documentId)).map(row => row.documentId));
      observedOrderSet = new Set(observedOrder);
    }
    const observedRows = observedOrder.flatMap(documentId => {
      const row = observedById.get(documentId);
      return row === undefined ? [] : [row];
    });
    // SAFETY: exact equality with this owner's prepared contribution authenticates
    // its root/attempt/source/lifetime and generation; structure grants nothing.
    const contribution = Object.freeze({}) as LogicalDocumentActivityContribution;
    preparedActivity = Object.freeze({ key, observedRows: Object.freeze(observedRows), contribution });
    return preparedActivity;
  });
  const projectActivityData = (prepared: NonNullable<typeof preparedActivity>, cursor?: LogicalDocumentActivityCursor,
    source?: PreparedWriteMechanicsState): LogicalDocumentActivity => {
    const attemptOffset = localCursor.attempts + (cursor?.attempts ?? 0);
    return Object.freeze({
      attempts: Object.freeze(attempts.slice(attemptOffset).map(attempt =>
        Object.freeze({ ...attempt, ordinal: attempt.ordinal - attemptOffset }))),
      lifecycle: Object.freeze(lifecycle.slice(localCursor.lifecycle + (cursor?.lifecycle ?? 0)).map(observation => Object.freeze({ ...observation,
        attemptOrdinal: observation.attemptOrdinal === null ? null : observation.attemptOrdinal - attemptOffset }))),
      observedRows: cursor === undefined && source === undefined ? prepared.observedRows :
        Object.freeze(prepared.observedRows.filter(row => (cursor === undefined || (rowUses.get(row.documentId) ?? 0) > cursor.observations) &&
          (source === undefined || source.tablesById.has(row.tableId)))),
      relationalReads: Object.freeze(relationalReads.slice(localCursor.relationalReads + (cursor?.relationalReads ?? 0))
        .filter(read => source === undefined || source.tablesById.has(read.tableId))),
      setNull: Object.freeze(setNull.slice(localCursor.setNull + (cursor?.setNull ?? 0))),
      referenceReplacements: Object.freeze(referenceReplacements.slice(localCursor.referenceReplacements + (cursor?.referenceReplacements ?? 0))),
    });
  };
  const activityData = prepareActivity.pipe(Effect.map(prepared => {
    if (aggregateActivity?.key === prepared.key) return aggregateActivity.activity;
    const activity = projectActivityData(prepared);
    aggregateActivity = Object.freeze({ key: prepared.key, activity });
    return activity;
  }));
  const activityContribution = prepareActivity.pipe(Effect.map(prepared => prepared.contribution));
  const closedActivityContribution = Effect.suspend(() => closed && lifetime.isClosing() && preparedActivity !== undefined
    ? Effect.succeed(preparedActivity.contribution) : Effect.fail(error("invalidAuthority")));
  const readActivityContribution = (contribution: LogicalDocumentActivityContribution,
    cursor?: LogicalDocumentActivityCursor, observedSource?: PreparedLogicalDocumentWriteMechanics) => Effect.suspend(() => {
    const prepared = preparedActivity;
    if (root?.closed || prepared?.contribution !== contribution || prepared.key !== activityKey() ||
      cursor !== undefined && !activityCursors.has(cursor)) return Effect.fail(error("invalidAuthority"));
    const source = observedSource === undefined ? undefined : preparedWriteMechanics.get(observedSource);
    if (observedSource !== undefined && (selectedWriteMechanics === undefined ||
      observedSource !== selectedWriteMechanics && !writeSources.get(selectedWriteMechanics)?.has(observedSource) ||
      source === undefined || source.closed === true || source.projection.tables.some(table => {
      const owned = ownedTable(table.tableId);
      return owned === undefined || owned.logicalName !== table.logicalName || owned.relationalMechanics !== table.relationalMechanics;
    }))) return Effect.fail(error("invalidAuthority"));
    return Effect.gen(function* () {
      yield* Effect.fromResult(lifetime.charge(0));
      if (source !== undefined && source.closed !== true) for (const owner of source.lifetimes)
        yield* Effect.fromResult(owner.checkOpen()).pipe(Effect.mapError(cause => error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
      if (source === undefined && cursor === undefined && aggregateActivity?.key === prepared.key) return aggregateActivity.activity;
      return projectActivityData(prepared, cursor, source?.closed === true ? undefined : source);
    });
  });
  const activitySnapshot = (cursor?: LogicalDocumentActivityCursor) => observeExecution("LogicalDocuments.activitySnapshot", Effect.suspend(() =>
    activityContribution.pipe(Effect.flatMap(contribution => readActivityContribution(contribution, cursor)), Effect.map(activity => structuredClone(activity)))));
  const close = () => observeExecution("LogicalDocuments.close", Effect.gen(function* (): Effect.fn.Return<LogicalDocumentChanges, Failure> {
    if (closed || root?.closed || !lifetime.isClosing()) return yield* Effect.fail(error("invalidAuthority"));
    yield* state.requireAdmission;
    yield* validateRelationalReferences();
    const activity = yield* activityData;
    closed = true;
    if (root === undefined) {
      for (const document of derivedKeyDocuments) forgetLogicalCanonicalDerivedKeys(document, keyOwner.identity);
      derivedKeyDocuments.clear();
    }
    const localAttempts = activity.attempts;
    const localLifecycle = activity.lifecycle;
    if (root !== undefined) {
      // The root retains all pending values and dependency witnesses. Child
      // completion carries only the native lifecycle/activity receipt.
      const changed = new Set(localAttempts.map(attempt => attempt.documentId));
      return detachLogicalDocumentChanges(Object.freeze({ attempts: Object.freeze(localAttempts),
        lifecycle: Object.freeze(localLifecycle), observedRows: Object.freeze(activity.observedRows.filter(row => changed.has(row.documentId))),
        relationalReads: activity.relationalReads,
        changes: Object.freeze([]), noFinalRows: Object.freeze([]), dependencies: Object.freeze([]), scans: Object.freeze([]),
        uniqueReads: Object.freeze([]), indexReads: Object.freeze([]), pageReads: Object.freeze([]), searchReads: Object.freeze([]),
        setNull: activity.setNull, referenceReplacements: activity.referenceReplacements }));
    }
    const changes: LogicalDocumentChange[] = [];
    const noFinalRows: AppDocumentIdV1[] = [];
    for (const row of rows.values()) {
      if (!row.attempts.some(ordinal => ordinal >= localCursor.attempts)) continue;
      if (row.base === null && row.current === null) { noFinalRows.push(row.documentId); continue; }
      const dependency = dependencies.get(row.documentId);
      if (dependency === undefined) return yield* Effect.fail(error("storedCorruption"));
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted" } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    noFinalRows.sort();
    const freshDependencies = new Set([...dependencies.keys()].slice(localCursor.dependencies));
    const changedIds = new Set<AppDocumentIdV1>([...changes.map(change => change.documentId), ...noFinalRows]);
    return detachLogicalDocumentChanges(Object.freeze({ ...activity, attempts: Object.freeze(localAttempts), lifecycle: Object.freeze(localLifecycle),
      observedRows: Object.freeze(root === undefined ? activity.observedRows : activity.observedRows.filter(row =>
        freshDependencies.has(row.documentId) ||
        rows.get(row.documentId)?.attempts.some(ordinal => ordinal >= localCursor.attempts))),
      changes: Object.freeze(changes),
      noFinalRows: Object.freeze(noFinalRows),
      dependencies: Object.freeze([...dependencies.values()].filter(dependency => root === undefined ||
        freshDependencies.has(dependency.documentId) || changedIds.has(dependency.documentId))
        .toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      scans: Object.freeze([...scans].slice(root === undefined ? 0 : localCursor.scans)
        .map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...uniqueReads.values()].slice(root === undefined ? 0 : localCursor.uniqueReads)),
      indexReads: Object.freeze([...indexReads.values()].slice(root === undefined ? 0 : localCursor.indexReads)),
      pageReads: Object.freeze(pageReads.slice(root === undefined ? 0 : localCursor.pageReads)),
      searchReads: Object.freeze(searchReads.slice(root === undefined ? 0 : localCursor.searchReads)),
      setNull: Object.freeze(setNull.slice(root === undefined ? 0 : localCursor.setNull)),
      referenceReplacements: Object.freeze(referenceReplacements.slice(root === undefined ? 0 : localCursor.referenceReplacements)) }));
  }));
  const documents = Object.freeze({ get, getMany, find, insert, delete: remove,
    patch: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "patch", tableName),
    replace: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "replace", tableName) } satisfies LogicalDocuments<Failure>);
  const relationalTable = (manager: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string) => observeExecution("LogicalDocuments.relationalTable", Effect.suspend(() => runOperation(manager, id, "read", Effect.gen(function* () {
      if (readMechanics?.metadata === undefined) {
        const table = yield* tableForName(tableName);
        if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      } else if (state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      return Object.freeze({
        prepareRead: (input): LogicalRelationalReadProgram<Failure> => {
          const preparation: ReadPreparation = { candidates: new Map() };
          return Object.freeze({
            find: context => executeRelationalFind(context, id, tableName, input, preparation).pipe(Effect.map(result => result.docs)),
            findPage: context => executeRelationalPage(context, id, tableName, input, preparation),
            count: context => executeRelationalFind(context, id, tableName, input, preparation).pipe(Effect.map(result => result.total)),
          } satisfies LogicalRelationalReadProgram<Failure>);
        },
        find: (context, query) => executeRelationalFind(context, id, tableName, query).pipe(Effect.map(result => result.docs)),
        findPage: (context, query) => executeRelationalPage(context, id, tableName, query),
        count: (context, query) => executeRelationalFind(context, id, tableName, query).pipe(Effect.map(result => result.total)),
        aggregate: (context, query) => relationalAggregate(context, id, tableName, query),
        write: (context, mode, inputRows) => relationalChange(context, id, tableName, mode, inputRows),
        delete: (context, keys) => relationalChange(context, id, tableName, "delete", keys),
        lifecycle: (context, operation, keys) => relationalChange(context, id, tableName, operation, keys),
        ...(state.allowReconstitution === true ? {
          reconstitute: (context: BoundedRequestContext, inputRows: unknown) => relationalChange(context, id, tableName, "reconstitute", inputRows),
        } : {}),
      } satisfies LogicalRelationalStore<Failure>);
    }))));
  return Object.freeze({ documents,
    relationalFind: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string, input: unknown) =>
      executeRelationalFind(context, id, tableName, input),
    relationalPage: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string, input: unknown) =>
      executeRelationalPage(context, id, tableName, input),
    relationalAggregate, relationalChange, relationalTable, planSetNull, planReferenceReplacement, close, requirePendingDeletion, activitySnapshot,
    activityContribution, closedActivityContribution, readActivityContribution,
    readTransactionTime: (context: BoundedRequestContext, id: PresentedTransactionId) =>
      runOperation(context, id, "read", transactionTime),
    activityCursor: () => {
      const cursor = Object.freeze({ observations: observationOrdinal, attempts: attempts.length - localCursor.attempts,
        lifecycle: lifecycle.length - localCursor.lifecycle, relationalReads: relationalReads.length - localCursor.relationalReads,
        setNull: setNull.length - localCursor.setNull,
        referenceReplacements: referenceReplacements.length - localCursor.referenceReplacements });
      activityCursors.add(cursor);
      return cursor;
    },
    attemptCount: () => attempts.length - localCursor.attempts,
    lifecycleCount: () => lifecycle.length - localCursor.lifecycle });
}, work => observeExecution("LogicalDocuments.make", work));

const comparePagePosition = (left: Readonly<{ key: string; rowId: string }>, right: Readonly<{ key: string; rowId: string }>) =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;
