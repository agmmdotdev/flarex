import { Effect, Option, Result, Schema } from "effect";
import { eq, sql } from "drizzle-orm";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { logicalMetadataDependencyIdentity, type LogicalMetadataKey, type LogicalMetadataReadDependency, type MetadataSequence } from "flarex-protocol/commit-protocol";
import { compileAppOrderedIndexBoundsV1, InvalidOrderedIndexRangeV1Error,
  OrderedIndexCodecV1InputError, OrderedIndexKeyTooLargeError,
  type OrderedIndexRangeExpressionV1 } from
  "flarex-protocol/ordered-index";
import { FlarexValueCodecV1Error } from "flarex-protocol/value";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { relationalForeignKeyReverseColumns } from "flarex-protocol/internal/relational-schema";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { consumeBoundedAppRowsAtSnapshotInTransactionEffect, consumeCapturedAppRowsAtSnapshotEffect, prepareAppRowsSnapshotReadEffect, readAppRowAtSnapshotInTransactionEffect, readBoundedCurrentAppRowsInTransactionEffect, MAX_BOUNDED_APP_ROW_READ_IDENTITIES,
  MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES,
  InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type AppRowReadResultV1, type AppRowRevisionV1, type ReadAppRowError } from "../appRows";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result, type LoweredCanonicalAppUniqueConstraintV1 } from "../appUniqueConstraintCommitV1";
import { withCommittedAppUniqueKeyRowInTransactionEffect, AppUniqueKeyPersistenceError, AppUniqueKeyHashError } from "../appUniqueKeys";
import type { AppUniqueConstraintIdV1, AppUniqueKeyProjectionV1 } from "../appUniqueKeyContract";
import { capturePrivateJsonData } from "../privateJsonData";
import type { PointCommitDependencyV1 } from "../pointCommitTransaction";
import type { ApplicationDocumentObservation } from "../applicationDocumentMaterialization/model";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import { readLogicalIndexRange, readLogicalIndexPage, logicalIndexReadFailureReason, type LogicalIndexRead, type LogicalIndexPageRead } from "./indexReads";
import { readLogicalSearchRange, type LogicalSearchMember, type LogicalSearchRead } from "./searchReads";
import { readLogicalJsonContainsRange } from "./jsonContains";
import { selectLogicalJsonSearchDefinition } from "./searchEntries";
import { decodeCapturedAppIndexSnapshotPageEffect, MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, type AppIndexRangeCursorV1 } from "../appIndexEntries";
import { decodeLogicalFindQuery, isLogicalRange, selectLogicalIndex, selectLogicalUniqueConstraint, selectLogicalPageIndex, logicalQueryMatches, type LogicalWhere } from "./query";
import { prepareLogicalRelationalRead, type LogicalRelationalReadDemand } from "./relationalQuery";
import { decodeLogicalAggregate, sumLogicalRows } from "./aggregate";
import { relationalTextIdentity } from "./relationalRows";
import { prepareLogicalRelationalTableMechanics, hasPreparedLogicalRelationalTableMechanics,
  bindPreparedLogicalRelationalRows } from "./relationalRows";
import { prepareLogicalRelationalForeignKeys, type LogicalRelationalForeignKey } from "./relationalForeignKeys";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { fxSystemScopeClocks } from "../schema";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { BoundedRequestContext, PresentedTransactionId, BoundedRequestLifetime } from "../boundedRequestLifetime";
import type { LogicalDocumentWorkingSetInput, LogicalRelationalStore, LogicalStorageReadDemand } from "./model";
import { attachLogicalDocumentRootEvaluator, recordLogicalDocumentRootMetadataDependency } from "./rootEvaluator";
import { captureFiniteMetadataDependency, finiteMetadataTableKey, finiteMetadataAccessKey,
  finiteMetadataContractKey, matchesFiniteMetadataDependencyObservation, type PreparedFiniteMetadataProjection } from "../finiteMetadataDependencies";
import { detachLogicalDocumentChanges } from "./detachChanges";
import { captureHostPreparationLifetime, PreparedHostRuntimeError } from "../preparedHostRuntime";
import type { LogicalDocumentTable, PreparedLogicalDocumentReadMechanics, PreparedLogicalDocumentWriteMechanics,
  LogicalDocumentFailure } from "./model";
import { requirePreparedLogicalReadMetadata, type PreparedLogicalReadMetadata } from "../logicalReadMetadata";
const decodeRelationalChange = Schema.decodeUnknownResult(Schema.Literals(["insert", "upsert", "update", "delete", "softDelete", "restore"]));
const uniqueReadKey = (definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1) =>
  projected.kind === "claim"
    ? JSON.stringify([definition.uniqueConstraintDefinitionId, projected.localeKey, projected.encodedKey])
    : null;

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
export type LogicalDocumentChange = ApplicationDocumentObservation & (
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
export interface LogicalDocumentChanges {
  /** Present only for the attempt-fixed finite execution profile. */
  readonly metadataDependencies?: readonly LogicalMetadataReadDependency[];
  readonly metadataWatermark?: MetadataSequence;
  readonly changes: readonly LogicalDocumentChange[];
  readonly attempts: readonly LogicalDocumentAttempt[];
  readonly lifecycle: readonly LogicalRelationalLifecycleObservation[];
  readonly observedRows: readonly LogicalDocumentObservedRow[];
  readonly noFinalRows: readonly AppDocumentIdV1[];
  readonly dependencies: readonly ApplicationDocumentObservation[];
  readonly scans: readonly Readonly<{ tableId: CatalogTableId; frontier: CommitSeq | null }>[];
  readonly uniqueReads: readonly LogicalUniqueRead[];
  readonly indexReads: readonly LogicalIndexRead[];
  readonly pageReads: readonly LogicalIndexPageRead[];
  readonly searchReads: readonly LogicalSearchRead[];
  readonly setNull: readonly LogicalSetNullIntent[];
  readonly referenceReplacements: readonly LogicalReferenceReplacementIntent[];
}
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
  readonly lifetime: NonNullable<Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>>;
  readonly tablesByName: Map<string, LogicalDocumentTable>;
  readonly tablesById: Map<CatalogTableId, LogicalDocumentTable>;
  readonly metadata: PreparedLogicalReadMetadata;
}
const preparedReadMechanics = new WeakMap<object, PreparedReadMechanicsState>();

interface PreparedWriteMechanicsState {
  readonly metadataProjections: readonly PreparedFiniteMetadataProjection[];
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
const preparedWriteMechanics = new WeakMap<object, PreparedWriteMechanicsState>();
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
const issueWriteMechanics = Effect.fn("LogicalDocuments.issueWriteMechanics")(function* <Failure>(
  input: WriteMechanicsInput, lifetimes: PreparedWriteMechanicsState["lifetimes"], error: LogicalDocumentFailure<Failure>,
) {
  for (const lifetime of lifetimes) yield* Effect.fromResult(lifetime.checkOpen()).pipe(Effect.mapError(cause =>
    error(cause.reason === "closed" ? "closed" : "resourceFailure", cause)));
  const capabilities = input.relationalCapabilities === undefined ? undefined : Object.freeze([...input.relationalCapabilities]);
  const tables = Object.freeze(input.tables.map(table => {
    if (table.relational === undefined) return Object.freeze({ ...table });
    const relational = table.relationalMechanics === undefined ? structuredClone(table.relational) : table.relational;
    return Object.freeze({ ...table, relational, relationalMechanics: table.relationalMechanics ??
      prepareLogicalRelationalTableMechanics(relational, capabilities ?? []) });
  }));
  const tablesByName = new Map(tables.map(table => [table.logicalName, table]));
  const tablesById = new Map(tables.map(table => [table.tableId, table]));
  if (tablesByName.size !== tables.length || tablesById.size !== tables.length)
    return yield* Effect.fail(error("invalidAuthority"));
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
    scalarColumns: new Set<string>(relationalForeignKeyReverseColumns(table.relational).map(column => column.columnId)),
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
  })).pipe(Effect.mapError(cause => error("resourceFailure", cause)));
  // SAFETY: only the private registry authenticates this immutable capability.
  const prepared = Object.freeze({ tables, relationalCapabilities: capabilities, searchDefinitions, indexes, unique,
    tableName: (tableId: CatalogTableId) => tablesById.get(tableId)?.logicalName,
    tableId: (logicalName: string) => tablesByName.get(logicalName)?.tableId,
  }) as PreparedLogicalDocumentWriteMechanics;
  preparedWriteMechanics.set(prepared, { metadataProjections: input.metadataProjections ??
    (input.metadataProjection === undefined ? [] : [input.metadataProjection]),
    lifetimes, tablesByName, tablesById, indexesByTable, uniqueByTable, foreignKeys,
    indexCandidates, uniqueCandidates, searchCandidates, relationalAccess });
  return prepared;
});

/** Source preparation owns complete writable mechanics once. Request-owned
 * preparation is retained for full profiles; finite reuse requires a host lease. */
export const prepareLogicalWriteMechanics = Effect.fn("LogicalDocuments.prepareWriteMechanics")(function* <Failure>(
  input: WriteMechanicsInput, error: LogicalDocumentFailure<Failure>,
) {
  const lifetime = yield* captureHostPreparationLifetime();
  return yield* issueWriteMechanics(input, lifetime === undefined ? [] : [lifetime], error);
});
const writeCombinations = new WeakMap<PreparedLogicalDocumentWriteMechanics,
  WeakMap<PreparedLogicalDocumentWriteMechanics, { pair?: PreparedLogicalDocumentWriteMechanics;
    triples: WeakMap<PreparedLogicalDocumentWriteMechanics, PreparedLogicalDocumentWriteMechanics> }>>();
/** A bounded native source graph reuses the exact ordered source combination;
 * no attempt-local state or mutable map escapes into this retained catalog. */
export const combineLogicalWriteMechanics = Effect.fn("LogicalDocuments.combineWriteMechanics")(function* <Failure>(
  inputs: readonly PreparedLogicalDocumentWriteMechanics[], error: LogicalDocumentFailure<Failure>,
) {
  if (inputs.length < 1 || inputs.length > 3 || new Set(inputs).size !== inputs.length)
    return yield* Effect.fail(error("invalidAuthority"));
  const lifetimes: PreparedWriteMechanicsState["lifetimes"][number][] = [];
  for (const input of inputs) {
    const state = preparedWriteMechanics.get(input);
    if (state === undefined) return yield* Effect.fail(error("invalidAuthority"));
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
    metadataProjections: [...new Set(inputs.flatMap(input => preparedWriteMechanics.get(input)?.metadataProjections ?? []))],
    ...(capabilities === undefined ? {} : { relationalCapabilities: capabilities }),
    indexes: inputs.flatMap(input => input.indexes), unique: inputs.flatMap(input => input.unique),
    searchDefinitions: inputs.flatMap(input => input.searchDefinitions) }, Object.freeze(lifetimes), error);
  if (third === undefined) combined.pair = prepared; else combined.triples.set(third, prepared);
  return prepared;
});

/** Compact read hosts retain row mechanics only after an actual table access.
 * The existing working set and compiler remain the native execution owner. */
export const prepareLogicalReadMechanics = Effect.fn("LogicalDocuments.prepareLazyReadMechanics")(function* (
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
  return prepared;
});

/** One pending document/index/constraint working set for a trusted relational
 * profile. Native execution, schema validation and settlement stay with their owners. */
export const makeLogicalDocumentWorkingSet = Effect.fn("LogicalDocuments.make")(function* <Failure>(
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
  const writeMechanics = finiteProfile === undefined ? undefined : preparedWriteMechanics.get(finiteProfile.mechanics);
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
      configuration.tables !== finiteProfile.mechanics.tables ||
      configuration.relationalCapabilities !== finiteProfile.mechanics.relationalCapabilities ||
      configuration.searchDefinitions !== finiteProfile.mechanics.searchDefinitions ||
      indexInput !== finiteProfile.mechanics.indexes || uniqueInput !== finiteProfile.mechanics.unique)
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
    relationalCapabilities: finiteProfile?.mechanics.relationalCapabilities ?? readProfile?.mechanics.relationalCapabilities ?? (configuration.relationalCapabilities === undefined ? undefined : Object.freeze(structuredClone(configuration.relationalCapabilities))),
    tables: finiteProfile?.mechanics.tables ?? readProfile?.mechanics.tables ?? Object.freeze(configuration.tables.map(table => {
      if (table.relational === undefined) return Object.freeze(table);
      const relational = table.relationalMechanics === undefined ? structuredClone(table.relational) : table.relational;
      const relationalMechanics = table.relationalMechanics ??
        prepareLogicalRelationalTableMechanics(relational, configuration.relationalCapabilities ?? []);
      return Object.freeze({ ...table, relational, relationalMechanics });
    })) });
  // Borrowed readTransaction authenticates inside its storage transaction;
  // only a directly supplied native transaction needs this separate guard.
  const requireReadAdmission = state.tx === undefined ? Effect.void : state.requireAdmission;
  const requireReadDemand = Effect.fn("LogicalDocuments.requireReadDemand")(function* (tx: FlarexMetadataTransaction, demand: LogicalStorageReadDemand) {
    if (demand.kind !== "clock") {
      yield* Effect.fromResult(consumeTableMetadataResult(demand.tableId, "table"));
      if (demand.kind === "index") yield* Effect.fromResult(consumeDefinitionMetadataResult(demand.tableId, "index", demand.indexDefinitionId));
      if (demand.kind === "unique") yield* Effect.fromResult(consumeDefinitionMetadataResult(demand.tableId, "unique", demand.uniqueConstraintDefinitionId));
    }
    if (state.readReadiness?.kind === "queryRequired") yield* state.readReadiness.requireDemand(tx, demand);
  });
  const uniqueDefinitions = finiteProfile?.mechanics.unique ?? Object.freeze([...uniqueInput]);
  const indexDefinitions = finiteProfile?.mechanics.indexes ?? Object.freeze([...indexInput]);
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
  const consumedMetadata = new Map<string, Readonly<{ projection: PreparedFiniteMetadataProjection;
    dependency: LogicalMetadataReadDependency }>>();
  const projectionForTable = (tableId: CatalogTableId) => writeMechanics?.metadataProjections.find(projection =>
    finiteMetadataTableKey(projection, tableId, "table") !== null);
  const consumeMetadataResult = (projection: PreparedFiniteMetadataProjection, key: LogicalMetadataKey): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    const identity = logicalMetadataDependencyIdentity(key), previous = consumedMetadata.get(identity);
    if (previous?.projection === projection && matchesFiniteMetadataDependencyObservation(projection, key,
      root.pins.metadataWatermark, previous.dependency)) {
      // Reuse only this working set's first decoded observation from the exact
      // immutable issuer. The root still owns closure, correlation and charge.
      return recordLogicalDocumentRootMetadataDependency(root, previous.dependency)
        ? Result.succeed(undefined) : Result.fail(error("invalidAuthority"));
    }
    return captureFiniteMetadataDependency(projection, key, root.pins.metadataWatermark).pipe(
      Result.mapError(cause => error("invalidAuthority", cause)), Result.flatMap(dependency => {
        if (!recordLogicalDocumentRootMetadataDependency(root, dependency)) return Result.fail(error("invalidAuthority"));
        consumedMetadata.set(identity, Object.freeze({ projection, dependency }));
        return Result.succeed(undefined);
      }));
  };
  const consumeTableMetadataResult = (tableId: CatalogTableId, kind: "table" | "writeClosure"): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    const projection = projectionForTable(tableId), key = projection === undefined ? null : finiteMetadataTableKey(projection, tableId, kind);
    if (projection === undefined || key === null) return Result.fail(error("invalidAuthority"));
    return Result.gen(function* () {
      yield* consumeMetadataResult(projection, key);
      yield* consumeMetadataResult(projection, { namespace: key.namespace, ownerKey: key.ownerKey,
        contractKey: finiteMetadataContractKey("sourcePolicy") });
    });
  };
  const consumeDefinitionMetadataResult = (tableId: CatalogTableId, kind: "index" | "unique", definitionId: number): Result.Result<void, Failure> => {
    if (root?.pins.metadataWatermark === undefined) return Result.succeed(undefined);
    const projection = projectionForTable(tableId), tableKey = projection === undefined ? null : finiteMetadataTableKey(projection, tableId, "table");
    return projection === undefined || tableKey === null ? Result.fail(error("invalidAuthority")) :
      consumeMetadataResult(projection, { namespace: tableKey.namespace, ownerKey: tableKey.ownerKey,
        contractKey: finiteMetadataContractKey(kind, definitionId) });
  };
  const consumeAccessMetadata = Effect.fn("LogicalDocuments.consumeAccessMetadata")(function* (tableId: CatalogTableId,
    families: readonly string[], fields: readonly string[]) {
    if (root?.pins.metadataWatermark === undefined) return;
    const projection = projectionForTable(tableId);
    if (projection === undefined) return yield* Effect.fail(error("invalidAuthority"));
    for (const family of families) for (const field of new Set(fields)) {
      const key = finiteMetadataAccessKey(projection, tableId, family, field);
      if (key === null) return yield* Effect.fail(error("invalidAuthority"));
      yield* Effect.fromResult(consumeMetadataResult(projection, key));
    }
  });
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
  const transactionTime = yield* Effect.cached(Effect.gen(function* () {
    if (finiteProfile !== undefined) {
      const captured = yield* finiteProfile.captureStorage({ kind: "transactionTime" }, { kind: "clock" });
      const value = databaseTimestampFromUnknown(captured.timestamp);
      if (value === null) return yield* Effect.fail(error("storedCorruption"));
      transactionTimeLoaded = true;
      return value.toISOString();
    }
    const result = yield* runStorageRead({ kind: "clock" }, undefined, tx => runDrizzleStatementEffect(tx.select({ timestamp: sql<unknown>`current_timestamp` })
      .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, state.scopeId)), cause => error("statementFailure", cause)));
    const value = databaseTimestampFromUnknown(result[0]?.timestamp);
    if (value === null) return yield* Effect.fail(error("storedCorruption"));
    transactionTimeLoaded = true;
    return value.toISOString();
  }));
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
  const requirePendingDeletion = Effect.fn("LogicalDocuments.requirePendingDeletion")(function* (documentId: string) {
    yield* state.requireAdmission;
    if (closed || root?.closed) return yield* Effect.fail(error("closed"));
    if (setNull.length > 0 || referenceReplacements.length > 0) return yield* Effect.fail(error("invalidAuthority"));
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    const row = rows.get(identity.id);
    if (row === undefined || row.current !== null || row.attempts.length === 0) return yield* Effect.fail(error("invalidAuthority"));
    return Object.freeze({ documentId: row.documentId, tableName: row.tableName });
  });
  const scanned = root?.scanned ?? new Map<CatalogTableId, CommitSeq>();
  const dependencies = root?.dependencies ?? new Map<AppDocumentIdV1, ApplicationDocumentObservation>();
  const scans = root?.scans ?? new Map<CatalogTableId, CommitSeq | null>();
  const uniqueReads = root?.uniqueReads ?? new Map<string, LogicalUniqueRead>();
  const indexReads = root?.indexReads ?? new Map<string, LogicalIndexRead>();
  const pageReads: LogicalIndexPageRead[] = root?.pageReads ?? [];
  const searchReads: LogicalSearchRead[] = root?.searchReads ?? [];
  const attempts: LogicalDocumentAttempt[] = root?.attempts ?? [];
  const lifecycle: LogicalRelationalLifecycleObservation[] = root?.lifecycle ?? [];
  const localCursor = Object.freeze({ attempts: attempts.length, lifecycle: lifecycle.length,
    dependencies: dependencies.size, scans: scans.size, uniqueReads: uniqueReads.size,
    indexReads: indexReads.size, pageReads: pageReads.length, searchReads: searchReads.length,
    setNull: setNull.length, referenceReplacements: referenceReplacements.length });
  let inserted = 0;
  const nextCreationTime = () => creationTime + (root === undefined ? inserted++ : root.inserted++);
  let closed = false;
  const loadReadTable = Effect.fn("LogicalDocuments.loadReadTable")(function* (name: string | CatalogTableId) {
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
  });
  const tablesByName = writeMechanics?.tablesByName ?? readMechanics?.tablesByName;
  const tablesById = writeMechanics?.tablesById ?? readMechanics?.tablesById;
  const ownedTable = (id: CatalogTableId) => tablesById === undefined ? tables.find(table => table.tableId === id) : tablesById.get(id);
  const tableForName = (name: string) => {
    const table = tablesByName === undefined ? tables.find(candidate => candidate.logicalName === name) : tablesByName.get(name);
    return (table !== undefined ? Effect.succeed(table) : readMechanics?.metadata !== undefined ? loadReadTable(name) : Effect.fail(error("invalidAuthority")))
      .pipe(Effect.tap(selected => Effect.fromResult(consumeTableMetadataResult(selected.tableId, "table"))));
  };
  const tableForId = (id: CatalogTableId) => {
    const table = ownedTable(id);
    return (table !== undefined ? Effect.succeed(table) : readMechanics?.metadata !== undefined ? loadReadTable(id) : Effect.fail(error("invalidAuthority")))
      .pipe(Effect.tap(selected => Effect.fromResult(consumeTableMetadataResult(selected.tableId, "table"))));
  };
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
  const nativeIndexesFor = (table: LogicalDocumentTable, demand: LogicalRelationalReadDemand) => writeMechanics !== undefined ?
    consumeAccessMetadata(table.tableId, ["nativeIndex", "nativeKey", "reverse"], demand.fields).pipe(
      Effect.as(writeMechanics.relationalAccess(table.tableId, demand.fields))) : readMechanics?.metadata === undefined ? Effect.succeed(undefined) :
    readMechanics.metadata.queryAccess(table.logicalName, demand).pipe(Effect.mapError(cause => error("invalidInput", cause)));
  const compileRelationalRead = Effect.fn("LogicalDocuments.compileRelationalRead")(function* (
    table: LogicalDocumentTable, input: unknown,
  ) {
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const prepared = yield* Effect.fromResult(prepareLogicalRelationalRead(table.relational, state.relationalCapabilities,
      input, limits.pageRows, error, table.relationalMechanics));
    const access = yield* nativeIndexesFor(table, prepared.demand);
    return yield* Effect.fromResult(prepared.compile(access));
  });
  const localTableName = (tableId: CatalogTableId) => ownedTable(tableId)?.logicalName;
  const chargeResult = (bytes: number): Result.Result<void, Failure> => {
    if (root !== undefined && (root.closed || root.workingBytes + bytes > root.limits.workingBytes))
      return Result.fail(error(root.closed ? "closed" : "limitExceeded"));
    const charged = lifetime.charge(bytes);
    if (Result.isSuccess(charged) && root !== undefined) root.workingBytes += bytes;
    return charged;
  };
  const charge = (bytes: number) => Effect.fromResult(chargeResult(bytes));
  const observe = Effect.fn("LogicalDocuments.observe")(function* (
    tableId: CatalogTableId, rowId: AppRowIdHexV1, base: AppRowRevisionV1 | null,
    readAt = scanned.get(tableId) ?? state.snapshotCommitSeq ?? state.clock.lastCommitSeq,
  ) {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    if (dependencies.has(documentId)) return;
    if (dependencies.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
    yield* charge(128);
    const observed: PointCommitDependencyV1["dependency"]["observed"] = base?.kind === "live"
      ? Object.freeze({ kind: "present", revisionCommitSeq: base.commitSeq })
      : Object.freeze({ kind: "missing", basis: base === null
        ? Object.freeze({ kind: "noVisibleRevision" })
        : Object.freeze({ kind: "tombstone", revisionCommitSeq: base.commitSeq }) });
    dependencies.set(documentId, Object.freeze({ documentId, tableId, rowId, readAt,
      dependency: Object.freeze({ kind: "appRowPoint", documentId, observed }) }));
  });
  const captureFields = (input: unknown) => Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, Math.min(limits.documentBytes, lifetime.remainingBytes()), error);
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) {
      return yield* Result.fail(error("documentInvalid"));
    }
    yield* chargeResult(captured.bytes);
    return captured.value;
  });
  const output = (document: CanonicalFlarexValueV1, returned = false): Result.Result<JsonObject, Failure> =>
    capturePrivateJsonData(document.value, limits.documentBytes, error).pipe(
      Result.flatMap(captured => Result.gen(function* () {
        if (!isJsonObject(captured.value)) return yield* Result.fail(error("storedCorruption"));
        if (returned) yield* chargeResult(captured.bytes);
        return captured.value;
      })),
    );
  const currentRowFailure = (cause: ReadAppRowError) => error(cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
    ? "limitExceeded" : cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause);
  const hydrateCurrentBase = Effect.fn("LogicalDocuments.hydrateCurrentBase")(function* (
    table: LogicalDocumentTable, base: AppRowRevisionV1, readAt: CommitSeq,
  ) {
    const tableId = table.tableId, documentId = appDocumentIdV1FromRowIdentity(base);
    const alreadyObserved = dependencies.has(documentId);
    yield* observe(tableId, base.rowId, base, readAt);
    // A later scan must not replace a cached absence with a newly committed
    // row. Settlement detects the conflicting dependency; reads stay repeatable.
    if (alreadyObserved || rows.has(documentId)) return;
    if (rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
    yield* charge(128 + (base.kind === "live" ? base.document.canonicalBytes.byteLength : 0));
    rows.set(documentId, { tableId, tableName: table.logicalName, rowId: base.rowId, documentId, base,
      creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [] });
  });
  const hydrateSnapshotBase = Effect.fn("LogicalDocuments.hydrateSnapshotBase")(function* (
    table: LogicalDocumentTable, selectedRowId: AppRowIdHexV1, base: AppRowReadResultV1,
    loadedBytes?: { value: number },
  ) {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId: selectedRowId });
    yield* observe(table.tableId, selectedRowId, base.kind === "missing" ? null : base, state.snapshotCommitSeq);
    if (base.kind === "missing" || dependencies.has(documentId) && rows.has(documentId)) return;
    const bytes = base.kind === "live" ? base.document.canonicalBytes.byteLength : 0;
    if (loadedBytes !== undefined) loadedBytes.value += bytes;
    if ((loadedBytes?.value ?? bytes) > Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()) ||
      bytes > limits.documentBytes) return yield* Effect.fail(error("limitExceeded"));
    // The existing row envelope charge includes the retained revision scalars;
    // finite originals/base/current share this already charged document.
    yield* charge(128 + bytes);
    rows.set(documentId, { tableId: table.tableId, tableName: table.logicalName, rowId: selectedRowId, documentId, base,
      creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [],
      ...(root !== undefined && base.kind === "live" ? { originalRevision: base } : {}) });
  });
  const readBaseInTransaction = Effect.fn("LogicalDocuments.readBaseInTransaction")(function* (
    tx: FlarexMetadataTransaction, tableId: CatalogTableId, rowId?: AppRowIdHexV1,
    rowIds?: readonly AppRowIdHexV1[],
  ): Effect.fn.Return<void, Failure> {
    if (rowIds !== undefined && rowIds.length > MAX_BOUNDED_APP_ROW_READ_IDENTITIES) {
      for (let offset = 0; offset < rowIds.length; offset += MAX_BOUNDED_APP_ROW_READ_IDENTITIES)
        yield* readBaseInTransaction(tx, tableId, undefined, rowIds.slice(offset, offset + MAX_BOUNDED_APP_ROW_READ_IDENTITIES));
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
  });
  const readFiniteBase = Effect.fn("LogicalDocuments.readFiniteBase")(function* (tableId: CatalogTableId,
    selected: readonly AppRowIdHexV1[]): Effect.fn.Return<void, Failure> {
    if (finiteProfile === undefined || state.snapshotCommitSeq === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    if (selected.length > MAX_BOUNDED_APP_ROW_READ_IDENTITIES) {
      for (let offset = 0; offset < selected.length; offset += MAX_BOUNDED_APP_ROW_READ_IDENTITIES)
        yield* readFiniteBase(tableId, selected.slice(offset, offset + MAX_BOUNDED_APP_ROW_READ_IDENTITIES));
      return;
    }
    if (closed) return yield* Effect.fail(error("closed"));
    const table = yield* tableForId(tableId);
    const uncached = selected.filter(rowId => !dependencies.has(appDocumentIdV1FromRowIdentity({ tableId, rowId })));
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
  const readFiniteIndexPage = Effect.fn("LogicalDocuments.readFiniteIndexPage")(function* (
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
  const readFiniteIndexRows = Effect.fn("LogicalDocuments.readFiniteIndexRows")(function* (
    selection: Pick<LogicalIndexRead, "definition" | "bounds">, tableId: CatalogTableId, limit: number, maximumHydratedOwners?: 1,
  ) {
    if (finiteProfile === undefined || state.snapshotCommitSeq === undefined)
      return yield* Effect.fail(error("invalidAuthority"));
    const table = yield* tableForId(tableId);
    yield* Effect.fromResult(consumeTableMetadataResult(tableId, "table"));
    yield* Effect.fromResult(consumeDefinitionMetadataResult(tableId, "index", selection.definition.indexDefinitionId));
    const excludeRowIds = [...dependencies.keys()].flatMap(documentId => {
      const identity = decodeAppDocumentIdentityV1Result(documentId);
      return Result.isSuccess(identity) && identity.success.tableId === tableId ? [identity.success.rowId] : [];
    });
    const captured = yield* finiteProfile.captureStorage({ kind: "indexRows", tableId, input: {
      scopeId: state.scopeId, definition: selection.definition, bounds: selection.bounds,
      limit, snapshotCommitSeq: state.snapshotCommitSeq,
    }, excludeRowIds, ...(maximumHydratedOwners === undefined ? {} : { maximumHydratedOwners }),
      maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()) },
    { kind: "index", tableId, indexDefinitionId: selection.definition.indexDefinitionId });
    // Authenticate all membership, including lookahead, before any body decoder.
    const page = yield* decodeCapturedAppIndexSnapshotPageEffect(captured.prepared, captured.rawIndexRows).pipe(
      Effect.mapError(cause => error(logicalIndexReadFailureReason(cause), cause)));
    if (!page.isDone) return yield* Effect.fail(error("limitExceeded"));
    const entries = page.entries;
    if (maximumHydratedOwners !== undefined && (entries.length > maximumHydratedOwners || entries.some(entry => entry.tableId !== tableId)))
      return yield* Effect.fail(error("storedCorruption"));
    yield* charge(128 + entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
    if (entries.some(entry => entry.tableId !== tableId) || new Set(entries.map(entry => entry.rowId)).size !== entries.length)
      return yield* Effect.fail(error("storedCorruption"));
    const missing = entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
    if (missing.length > callIdentityLimit || missing.length > Math.min(MAX_BOUNDED_APP_ROW_READ_IDENTITIES, limits.identities - dependencies.size))
      return yield* Effect.fail(error("limitExceeded"));
    if (missing.some(entry => rows.has(appDocumentIdV1FromRowIdentity(entry))))
      return yield* Effect.fail(error("storedCorruption"));
    if (missing.length > 0) {
      if (maximumHydratedOwners !== undefined && testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("point");
      const prepared = yield* prepareAppRowsSnapshotReadEffect({ scopeId: state.scopeId, tableId,
        rowIds: missing.map(entry => entry.rowId), snapshotCommitSeq: state.snapshotCommitSeq })
        .pipe(Effect.mapError(cause => error("invalidInput", cause)));
      const loadedBytes = { value: 0 };
      yield* consumeCapturedAppRowsAtSnapshotEffect(prepared, captured.rawRows, cause => error("storedCorruption", cause),
        (rowId, base) => hydrateSnapshotBase(table, rowId, base, loadedBytes));
    }
    return entries;
  });
  const readBase = Effect.fn("LogicalDocuments.readBase")(function* (tableId: CatalogTableId,
    rowId?: AppRowIdHexV1, rowIds?: readonly AppRowIdHexV1[], checkedTx?: FlarexMetadataTransaction) {
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
    });
  let hydratedLocalSeeds = false;
  type PendingSelection = Readonly<{ tableId: CatalogTableId; rowIds?: readonly AppRowIdHexV1[] }>;
  const pendingSeeds = (selection?: PendingSelection) => {
    void selection;
    return root !== undefined || hydratedLocalSeeds ? [] : state.pendingRows ?? [];
  };
  const hydratePendingSeeds = Effect.fn("LogicalDocuments.hydratePendingSeeds")(function* (tx: FlarexMetadataTransaction, selection?: PendingSelection) {
    const pendingRows = pendingSeeds(selection);
    if (pendingRows.length === 0) return;
    if (state.snapshotCommitSeq === undefined || pendingRows.length > limits.identities)
      return yield* Effect.fail(error("invalidAuthority"));
    const seen = new Set<string>();
    const applySeed = Effect.fn("LogicalDocuments.applyPendingSeed")(function* (seed: import("./model").LogicalPendingDocumentSeed) {
      const documentId = appDocumentIdV1FromRowIdentity(seed);
      if (seen.has(documentId)) return yield* Effect.fail(error("storedCorruption"));
      seen.add(documentId);
      const observation = dependencies.get(documentId)?.dependency.observed;
      const expected = seed.observed;
      const sameObservation = observation?.kind === expected.kind &&
        (observation.kind === "present" && expected.kind === "present"
          ? observation.revisionCommitSeq === expected.revisionCommitSeq
          : observation.kind === "missing" && expected.kind === "missing" &&
            observation.basis.kind === expected.basis.kind &&
            (observation.basis.kind === "tombstone" && expected.basis.kind === "tombstone"
              ? observation.basis.revisionCommitSeq === expected.basis.revisionCommitSeq : true));
      if (!sameObservation) return yield* Effect.fail(error("storedCorruption"));
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
      if (seedCreationTime === undefined && seed.overlay.kind === "deleted" && expected.kind === "missing") {
        return;
      }
      if (seedCreationTime === undefined) return yield* Effect.fail(error("storedCorruption"));
      rows.set(documentId, { tableId: seed.tableId, tableName: table.logicalName, rowId: seed.rowId,
        documentId, base: existing?.base ?? null, creationTime: seedCreationTime,
        current: seed.overlay.kind === "live" ? seed.overlay.document : null, attempts: [], borrowedOverlay: true });
    });
    // Ordered batches preserve the original observation/base/overlay charge
    // sequence. A cached base ends a batch so its overlay is checked before
    // the next canonical body is decoded.
    for (let offset = 0; offset < pendingRows.length;) {
      const first = pendingRows[offset]!;
      if (dependencies.has(appDocumentIdV1FromRowIdentity(first))) {
        yield* applySeed(first); offset++; continue;
      }
      const table = yield* tableForId(first.tableId);
      let end = offset + 1;
      while (end < pendingRows.length && end - offset < MAX_BOUNDED_APP_ROW_READ_IDENTITIES &&
        pendingRows[end]?.tableId === first.tableId &&
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
  });
  // The finite root already owns original preimages and pending rows.
  // Independent durable/native overlays keep their checked hydration path.
  if (root === undefined && pendingSeeds().length > 0) {
    yield* requireReadAdmission;
    yield* runConstructionRead(hydratePendingSeeds);
  }
  const runStorageRead = <A, E>(demand: LogicalStorageReadDemand, selection: PendingSelection | undefined,
    work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
    runRead(tx => requireReadDemand(tx, demand).pipe(Effect.andThen(() =>
      hydratePendingSeeds(tx, selection)), Effect.andThen(() => work(tx))), demand);
  const withStorageFrontier = <A>(demand: LogicalStorageReadDemand, selection: PendingSelection,
    work: Effect.Effect<A, Failure>): Effect.Effect<A, Failure> =>
    Effect.suspend(() => finiteProfile !== undefined ? work : frontierTx !== undefined ? runStorageRead(demand, selection, () => work) : runStorageRead(demand, selection, tx =>
      Effect.acquireUseRelease(Effect.sync(() => { frontierTx = tx; }), () => work,
        () => Effect.sync(() => { frontierTx = undefined; }))));
  const locate = Effect.fn("LogicalDocuments.locate")(function* (inputId: string, tableName?: string,
    checkedTx?: FlarexMetadataTransaction) {
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(inputId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    yield* tableForId(identity.tableId);
    if (tableName !== undefined && (yield* tableForName(tableName)).tableId !== identity.tableId) {
      return yield* Effect.fail(error("invalidInput"));
    }
    const read = Effect.gen(function* () {
      if (!dependencies.has(identity.id) && !scanned.has(identity.tableId)) yield* readBase(identity.tableId, identity.rowId, undefined, checkedTx);
      if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
      return { identity, pending: rows.get(identity.id) };
    });
    const selection = { tableId: identity.tableId, rowIds: [identity.rowId] };
    return yield* (pendingSeeds(selection).length > 0 && checkedTx === undefined
      ? withStorageFrontier({ kind: "rows", tableId: identity.tableId }, selection, read) : read);
  });
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
  const locateUnique = Effect.fn("LogicalDocuments.locateUnique")(function* (
    definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1,
    prepareSelection: Effect.Effect<UniqueStorageSelection, Failure>,
  ) {
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
          const base = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, owned.base.document)
            .pipe(Result.mapError(cause => error("storedCorruption", cause))));
          if (base.kind !== "claim" || base.localeKey !== projected.localeKey ||
            base.encodedKey !== projected.encodedKey) return yield* Effect.fail(error("storedCorruption"));
        }
        yield* charge(128 + projected.canonicalKeyBytes.byteLength);
        uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
          key: projected.projection, owner: entry === undefined ? null :
            Object.freeze({ tableId: entry.tableId, rowId: entry.rowId }) }));
        return entry === undefined ? null : appDocumentIdV1FromRowIdentity(entry);
      }
      const slot = yield* runRead(tx => requireReadDemand(tx, { kind: "unique", tableId: definition.tableId,
        uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId }).pipe(Effect.andThen(() =>
        withCommittedAppUniqueKeyRowInTransactionEffect(tx, { scopeId: state.scopeId,
          constraintId: definition.uniqueConstraintDefinitionId, key: projected.projection,
          minimumCommitSeq: state.clock.lastCommitSeq,
          maximumIdentities: Math.min(MAX_BOUNDED_APP_ROW_READ_IDENTITIES, limits.identities - dependencies.size),
          maximumDocumentBytes: limits.documentBytes,
          maximumTotalValueBytes: Math.min(MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, lifetime.remainingBytes()),
        }, cause => error(cause instanceof AppUniqueKeyPersistenceError ? "statementFailure" :
          cause instanceof AppUniqueKeyHashError ? "resourceFailure" : "storedCorruption", cause), currentRowFailure,
        capture => Effect.gen(function* () {
          if (Option.isNone(capture.owner)) return capture.owner;
          const owner = capture.owner.value;
          if (owner.tableId !== definition.tableId) return yield* Effect.fail(error("storedCorruption"));
          const documentId = appDocumentIdV1FromRowIdentity(owner);
          if (!dependencies.has(documentId) && !scanned.has(owner.tableId)) {
            if (closed) return yield* Effect.fail(error("closed"));
            const table = yield* tableForId(owner.tableId);
            if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("point");
            yield* requireReadDemand(tx, { kind: "rows", tableId: owner.tableId });
            const captured = yield* capture.readOwner;
            yield* hydrateCurrentBase(table, captured.row, captured.readAt);
          }
          const { pending: owned } = yield* locate(documentId, undefined, tx);
          // A prior dependency or scan keeps its original observation. Newly
          // decoded owners share the slot's statement cut and revision.
          if (owned?.base?.commitSeq !== owner.ownerCommitSeq) return yield* Effect.fail(error("writeConflict"));
          if (owned.base.kind !== "live") return yield* Effect.fail(error("storedCorruption"));
          const base = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, owned.base.document)
            .pipe(Result.mapError(cause => error("storedCorruption", cause))));
          if (base.kind !== "claim" || base.localeKey !== projected.localeKey ||
            base.encodedKey !== projected.encodedKey) return yield* Effect.fail(error("storedCorruption"));
          return capture.owner;
        }), testHooks?.observeQuery))));
      const ownerId = Option.isNone(slot) ? null : appDocumentIdV1FromRowIdentity(slot.value);
      yield* charge(128 + projected.canonicalKeyBytes.byteLength);
      uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
        key: projected.projection, owner: Option.isNone(slot) ? null : Object.freeze({ tableId: slot.value.tableId, rowId: slot.value.rowId }) }));
      return ownerId;
    });
    return yield* (pendingSeeds(selection).length > 0 || !uniqueReads.has(readKey) ? withStorageFrontier(demand, selection, read) : read);
  });
  const withUniqueValidation = Effect.fn("LogicalDocuments.validateUnique")(function* <Value>(
    pending: PendingDocument, document: CanonicalFlarexValueV1, consume: Effect.Effect<Value, Failure>,
  ): Effect.fn.Return<Value, Failure> {
    const validateNext = Effect.fn("LogicalDocuments.validateNextUnique")(function* (position: number): Effect.fn.Return<Value, Failure> {
      const definition = uniqueForTable(pending.tableId)[position];
      if (definition === undefined) return yield* consume;
      if (definition.tableId !== pending.tableId) return yield* validateNext(position + 1);
      const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => error("documentInvalid", cause))));
      if (projected.kind !== "claim") return yield* validateNext(position + 1);
      const validate = (prepareSelection: Effect.Effect<UniqueStorageSelection, Failure>) => Effect.gen(function* () {
        yield* locateUnique(definition, projected, prepareSelection);
        for (const other of rows.values()) {
          if (other.tableId !== pending.tableId || other.documentId === pending.documentId || other.current === null) continue;
          const existing = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, other.current)
            .pipe(Result.mapError(cause => error("storedCorruption", cause))));
          if (existing.kind === "claim" && existing.localeKey === projected.localeKey &&
            existing.encodedKey === projected.encodedKey) return yield* Effect.fail(state.uniqueConflict(Object.freeze({ tableName: localTableName(pending.tableId) ?? pending.tableName,
              orderedFields: Object.freeze([...definition.physicalSpec.orderedFields]) })));
        }
        return yield* validateNext(position + 1);
      });
      const key = uniqueReadKey(definition, projected);
      const selection = { tableId: pending.tableId };
      if (pendingSeeds(selection).length > 0 || key !== null && !uniqueReads.has(key)) {
        const prepared = yield* prepareUniqueStorageSelection(definition, projected);
        return yield* withStorageFrontier(prepared.demand, selection, validate(Effect.succeed(prepared)));
      }
      return yield* validate(prepareUniqueStorageSelection(definition, projected));
    });
    return yield* validateNext(0);
  });
  const recordAttempt = (pending: PendingDocument, operation: LogicalDocumentAttempt["operation"],
    after: CanonicalFlarexValueV1 | null) => {
    const attempt = Object.freeze({ ordinal: attempts.length, documentId: pending.documentId, operation,
      tableId: pending.tableId, tableName: localTableName(pending.tableId) ?? pending.tableName, before: pending.current, after });
    return consumeTableMetadataResult(pending.tableId, "writeClosure").pipe(Result.flatMap(() => chargeResult(128)), Result.map(() => {
      pending.attempts.push(attempt.ordinal);
      attempts.push(attempt);
    }));
  };
  const withWrittenDocument = Effect.fn("LogicalDocuments.validateWrite")(function* <Value>(pending: PendingDocument, fields: JsonObject,
    operation: "insert" | "patch" | "replace", consume: (written: JsonObject) => Effect.Effect<Value, Failure>,
  ): Effect.fn.Return<Value, Failure> {
    const document = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: pending.documentId, _creationTime: pending.creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => error("documentInvalid", cause)));
    if (document.canonicalBytes.byteLength > limits.documentBytes) return yield* Effect.fail(error("limitExceeded"));
    const table = yield* tableForId(pending.tableId);
    yield* state.validateDocument({ operation, tableName: table.logicalName, tableId: pending.tableId, documentId: pending.documentId,
      creationTime: pending.creationTime, document });
    return yield* withUniqueValidation(pending, document, Effect.gen(function* () {
      if (!rows.has(pending.documentId) && rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(document.canonicalBytes.byteLength);
      yield* Effect.fromResult(recordAttempt(pending, operation, document));
      pending.current = document;
      rows.set(pending.documentId, pending);
      const written = yield* Effect.fromResult(output(document, true));
      return yield* consume(written);
    }));
  });
  const write = (pending: PendingDocument, fields: JsonObject, operation: "insert" | "patch" | "replace") =>
    withWrittenDocument(pending, fields, operation, Effect.succeed);
  const get: LogicalDocuments<Failure>["get"] = Effect.fn("LogicalDocuments.get")((context, id, documentId, tableName) =>
    state.tx !== undefined || root !== undefined ? runOperation(context, id, "read", Effect.gen(function* () {
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
      })));
  const getMany: LogicalDocuments<Failure>["getMany"] = Effect.fn("LogicalDocuments.getMany")((context, id, tableName, input) =>
    runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
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
          return pending?.current == null ? Effect.succeed(null) : Effect.fromResult(output(pending.current, true));
        }));
      });
      const selection = { tableId: table.tableId, rowIds: identities.map(identity => identity.rowId) };
      return yield* (pendingSeeds(selection).length > 0 ? withStorageFrontier({ kind: "rows", tableId: table.tableId }, selection, read) : read);
    })));
  const withInsertedRecord = Effect.fn("LogicalDocuments.insertRecord")(function* <Value>(tableName: string, input: unknown,
    consume: (written: JsonObject) => Effect.Effect<Value, Failure>,
  ): Effect.fn.Return<Value, Failure> {
      const table = yield* tableForName(tableName);
      const fields = yield* Effect.fromResult(captureFields(input));
      const insertOwned = Effect.gen(function* () {
        if (rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
        yield* charge(128);
        const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16)))
          .pipe(Result.mapError(cause => error("resourceFailure", cause))));
        const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
        if (rows.has(documentId) || dependencies.has(documentId)) return yield* Effect.fail(error("uniqueConflict"));
        // This ID was generated inside the trusted working set. Record a missing
        // point dependency and let settlement prove it remains absent; a separate
        // current-row query for every new ID would serialize large graph writes.
        yield* observe(table.tableId, rowId, null);
        const time = AppCreationTimeV1Schema.make(nextCreationTime());
        return yield* withWrittenDocument({ tableId: table.tableId, tableName, rowId, documentId, base: null,
          creationTime: time, current: null, attempts: [] }, fields, "insert", consume);
      });
      const selection = { tableId: table.tableId };
      return yield* (pendingSeeds(selection).length > 0 ? withStorageFrontier({ kind: "rows", tableId: table.tableId }, selection, insertOwned) : insertOwned);
    });
  const insertRecord = (tableName: string, input: unknown) => withInsertedRecord(tableName, input, Effect.succeed);
  const insert: LogicalDocuments<Failure>["insert"] = Effect.fn("LogicalDocuments.insert")((context, id, tableName, input) =>
    runOperation(context, id, "write", insertRecord(tableName, input)));
  const edit = Effect.fn("LogicalDocuments.edit")((context: BoundedRequestContext, id: PresentedTransactionId,
    documentId: string, input: unknown, operation: "patch" | "replace", tableName?: string) => runOperation(context, id, "write", Effect.gen(function* () {
      const fields = yield* Effect.fromResult(captureFields(input));
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      const previous = yield* Effect.fromResult(output(pending.current));
      const { _id: _documentId, _creationTime: _created, ...developerFields } = previous;
      return yield* write(pending, operation === "patch" ? { ...developerFields, ...fields } : fields, operation);
    })));
  const remove: LogicalDocuments<Failure>["delete"] = Effect.fn("LogicalDocuments.delete")((context, id, documentId, tableName) =>
    runOperation(context, id, "write", Effect.gen(function* () {
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      yield* Effect.fromResult(recordAttempt(pending, "delete", null));
      pending.deletedValue = pending.current;
      pending.current = null;
    })));
  const withCandidateSelection = Effect.fn("LogicalDocuments.withCandidateSelection")(function* <Value>(
    tableName: string, where: LogicalWhere, indexedOnly: boolean,
    exactPoint: Readonly<{ columns: readonly string[]; nullColumn?: string }> | undefined,
    consume: (candidates: Iterable<PendingDocument>) => Effect.Effect<Value, Failure>,
  ): Effect.fn.Return<Value, Failure> {
    const table = yield* tableForName(tableName);
    const continueSelection = (needsStorage: boolean, selection: Effect.Effect<Iterable<PendingDocument>, Failure>,
      demand: LogicalStorageReadDemand, pendingSelection: PendingSelection = { tableId: table.tableId }) => {
      const work = selection.pipe(Effect.flatMap(consume));
      return needsStorage || pendingSeeds(pendingSelection).length > 0 ? withStorageFrontier(demand, pendingSelection, work) : work;
    };
    if (where._id !== undefined) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(where._id).pipe(
        Result.mapError(cause => error("invalidInput", cause))));
      if (identity.tableId !== table.tableId) return yield* Effect.fail(error("invalidInput"));
      return yield* continueSelection(!dependencies.has(identity.id) && !scanned.has(table.tableId),
        locate(identity.id, tableName).pipe(Effect.map(({ pending }) => pending === undefined ? [] : [pending])),
        { kind: "rows", tableId: table.tableId }, { tableId: table.tableId, rowIds: [identity.rowId] });
    }
    const definition = selectLogicalUniqueConstraint(yield* selectedUniqueFor(table, where), table.tableId, where);
    if (definition !== undefined) {
      const document = yield* canonicalizeFlarexValueV1Effect(where, "appDocument")
        .pipe(Effect.mapError(cause => error("invalidInput", cause)));
      const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => error("invalidInput", cause))));
      const readKey = uniqueReadKey(definition, projected);
      if (readKey === null) return yield* Effect.fail(error("invalidInput"));
      // Earlier key observations survive scans; local edits apply to both.
      const usesKey = !scanned.has(table.tableId) || uniqueReads.has(readKey);
      const prepared = yield* prepareUniqueStorageSelection(definition, projected);
      return yield* continueSelection(usesKey && !uniqueReads.has(readKey), Effect.gen(function* () {
        if (!usesKey) return rows.values();
        const ownerId = yield* locateUnique(definition, projected, Effect.succeed(prepared));
        return [...rows.values()].filter(row => row.tableId === table.tableId &&
          (row.documentId === ownerId || row.borrowedOverlay === true || row.attempts.length > 0));
      }), prepared.demand);
    }
    const selected = yield* Effect.fromResult(selectLogicalIndex(yield* selectedIndexesFor(table, where, exactPoint), table.tableId, where, error, exactPoint));
    if (Option.isNone(selected)) {
      if (indexedOnly || Object.values(where).some(isLogicalRange)) return yield* Effect.fail(error("invalidInput"));
      return yield* continueSelection(!scanned.has(table.tableId), Effect.gen(function* () {
        if (!scanned.has(table.tableId)) yield* readBase(table.tableId);
        return rows.values();
      }), { kind: "rows", tableId: table.tableId });
    }
    const selection = selected.value;
    const usesIndex = !scanned.has(table.tableId) || indexReads.has(selection.identity);
    return yield* continueSelection(usesIndex && !indexReads.has(selection.identity), Effect.gen(function* () {
      if (!usesIndex) return rows.values();
      let read = indexReads.get(selection.identity);
      if (read === undefined) {
        if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
        yield* requireReadAdmission;
        const entries = yield* (finiteProfile !== undefined ? readFiniteIndexRows(selection, table.tableId,
          Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, callIdentityLimit)) : runRead(tx => Effect.gen(function* () {
          yield* requireReadDemand(tx, { kind: "index", tableId: table.tableId,
            indexDefinitionId: selection.definition.indexDefinitionId });
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
          const encoded = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, pending.base.document, pending.base.creationTime)
            .pipe(Result.mapError(cause => error("storedCorruption", cause))));
          if (encoded !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
        }
        read = Object.freeze({ definition: selection.definition, bounds: selection.bounds, entries });
        indexReads.set(selection.identity, read);
      }
      const members = new Set(read.entries.map(entry => appDocumentIdV1FromRowIdentity(entry)));
      return [...rows.values()].filter(row => row.tableId === table.tableId &&
        (members.has(row.documentId) || row.borrowedOverlay === true || row.attempts.length > 0));
    }), { kind: "index", tableId: table.tableId, indexDefinitionId: selection.definition.indexDefinitionId });
  });
  const selectCandidates = Effect.fn("LogicalDocuments.selectCandidates")(function* (tableName: string, where: LogicalWhere,
    indexedOnly = false, exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) {
    return yield* withCandidateSelection(tableName, where, indexedOnly, exactPoint, Effect.succeed);
  });
  const find: LogicalDocuments<Failure>["find"] = Effect.fn("LogicalDocuments.find")((context, id, tableName, input) =>
    runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      const query = yield* Effect.fromResult(decodeLogicalFindQuery(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause))));
      if (query.limit > limits.pageRows) return yield* Effect.fail(error("invalidInput"));
      const table = yield* tableForName(tableName);
      const candidates = yield* selectCandidates(tableName, query.where);
      const matched: { id: AppDocumentIdV1; document: CanonicalFlarexValueV1 }[] = [];
      for (const row of candidates) {
        if (row.tableId !== table.tableId || row.current === null) continue;
        const document = row.current.value;
        if (!isNonArrayRecord(document)) return yield* Effect.fail(error("storedCorruption"));
        if (yield* Effect.fromResult(logicalQueryMatches(document, query.where, error))) matched.push({ id: row.documentId, document: row.current });
      }
      matched.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const docs = yield* Effect.forEach(matched.slice(query.offset, query.offset + query.limit), row => Effect.fromResult(output(row.document, true)));
      return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
    })));
  const readRelationalSelection = Effect.fn("LogicalDocuments.readRelationalSelection")(function* (tableName: string, input: unknown, complete = false) {
    const table = yield* tableForName(tableName);
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* compileRelationalRead(table, captured.value);
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
    let usedSearchCandidates = false;
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
        usedSearchCandidates = true;
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
    if (!usedSearchCandidates) {
      const selections = query.selections === null ? [{ where: completeSelection }] :
        query.selections.map(selection => selection.kind !== "point" ? { where: { [selection.column]: selection.value,
          ...(selection.nullColumn === undefined ? {} : { [selection.nullColumn]: null }) } } : {
          where: { ...Object.fromEntries(selection.columns.map((column, offset) => [column, selection.values[offset]!])),
            ...(selection.nullColumn === undefined ? {} : { [selection.nullColumn]: null }) },
          exactPoint: { columns: selection.columns, ...(selection.nullColumn === undefined ? {} : { nullColumn: selection.nullColumn }) },
        });
      const collectSelections = Effect.fn("LogicalDocuments.collectSelections")(function* (position: number): Effect.fn.Return<void, Failure> {
        const selection = selections[position];
        if (selection === undefined) return;
        return yield* withCandidateSelection(tableName, selection.where, true,
          "exactPoint" in selection ? selection.exactPoint : undefined, candidates => Effect.gen(function* () {
            for (const row of candidates)
              if (row.tableId === table.tableId && row.current !== null) selected.set(row.documentId, row);
            yield* collectSelections(position + 1);
          }));
      });
      yield* collectSelections(0);
    }
    const matched: { document: JsonObject; order: Uint8Array; documentId: AppDocumentIdV1 }[] = [];
    for (const row of selected.values()) {
      if (row.current === null) continue;
      const document = yield* Effect.fromResult(output(row.current, true));
      const inspected = yield* Effect.fromResult(query.inspect(document));
      if (inspected.matches) matched.push({ document, order: inspected.order, documentId: row.documentId });
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
        if (value === undefined) return yield* Effect.fail(error("storedCorruption"));
        projected[field] = value;
      }
      const capturedOutput = yield* Effect.fromResult(capturePrivateJsonData(projected, limits.documentBytes, error));
      yield* charge(capturedOutput.bytes);
      docs.push(projected);
    }
    return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
  });
  const relationalFind = Effect.fn("LogicalDocuments.relationalFind")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", readRelationalSelection(tableName, input)));

  const relationalPage = Effect.fn("LogicalDocuments.relationalPage")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", Effect.gen(function* () {
    const table = yield* tableForName(tableName);
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* compileRelationalRead(table, captured.value);
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
    const pageDefinitions = writeMechanics !== undefined ? writeMechanics.indexCandidates(table.tableId,
      [pageEquality?.column ?? query.orderColumn]) : readMechanics?.metadata === undefined ? indexesForTable(table.tableId) :
      yield* readMechanics.metadata.selectPage(table.logicalName, query.orderColumn, pageEquality, query.requiredNulls)
        .pipe(Effect.map(definition => definition === null ? [] : [definition]), Effect.mapError(cause => error("invalidAuthority", cause)));
    const selected = yield* Effect.fromResult(selectLogicalPageIndex(pageDefinitions, table.tableId,
      query.orderColumn, pageEquality, query.requiredNulls, error));
    if (Option.isNone(selected)) return yield* Effect.fail(error("invalidInput"));
    const selection = selected.value;
    type Member = { row: PendingDocument; key: string; document: JsonObject };
    const matched = new Map<AppDocumentIdV1, Member>();

    const add = Effect.fn("LogicalDocuments.pageMember")(function* (row: PendingDocument) {
      if (row.current === null) return;
      const key = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, row.current, row.creationTime)
        .pipe(Result.mapError(cause => error("storedCorruption", cause))));
      if (key === null || selection.bounds.startInclusive !== undefined && String(key) < String(selection.bounds.startInclusive) ||
        selection.bounds.endExclusive !== undefined && String(key) >= String(selection.bounds.endExclusive)) return;
      const document = yield* Effect.fromResult(output(row.current, true));
      const inspected = yield* Effect.fromResult(query.inspect(document));
      if (inspected.matches) matched.set(row.documentId, { row, key, document });
    });
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
          const baseKey = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, pending.base.document, pending.base.creationTime)
            .pipe(Result.mapError(cause => error("storedCorruption", cause))));
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
        const capturedRow = yield* Effect.fromResult(capturePrivateJsonData(row, limits.documentBytes, error));
        yield* charge(capturedRow.bytes);
        projected.push(row);
      }
      return Object.freeze({ rows: Object.freeze(projected), hasMore: result.length > query.offset + query.limit });
    }));
  })));
  const relationalAggregate = Effect.fn("LogicalDocuments.relationalAggregate")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", Effect.gen(function* () {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
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
  })));
  const relationalChange = Effect.fn("LogicalDocuments.relationalChange")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, operation: "insert" | "upsert" | "update" | "delete" | "softDelete" | "restore", input: unknown) =>
    runOperation(context, id, "write", Effect.gen(function* () {
      yield* Effect.fromResult(decodeRelationalChange(operation).pipe(Result.mapError(cause => error("invalidInput", cause))));
      const table = yield* tableForName(tableName);
      if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      if (table.relationalMechanics === undefined || !hasPreparedLogicalRelationalTableMechanics(table.relationalMechanics, table.relational))
        return yield* Effect.fail(error("invalidAuthority"));
      const policy = yield* Effect.fromResult(bindPreparedLogicalRelationalRows(table.relationalMechanics, error));
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      if (!Array.isArray(captured.value)) return yield* Effect.fail(error("invalidInput"));
      if (captured.value.length > callIdentityLimit) return yield* Effect.fail(error("limitExceeded"));
      const rowsByKey = new Map<string, Readonly<{ identity: Record<string, string>; row: JsonObject }>>();
      for (const item of captured.value) {
        const singleKey = policy.keyColumns.length === 1 ? policy.keyColumns[0] : undefined;
        const row = operation === "delete" || operation === "softDelete" || operation === "restore" ?
          typeof item === "string" && singleKey !== undefined ? { [singleKey]: item } : item : item;
        if (!isJsonObject(row)) return yield* Effect.fail(error("invalidInput"));
        yield* Effect.fromResult(policy.validateInput(row));
        if ((operation === "delete" || operation === "softDelete" || operation === "restore") &&
          (Object.keys(row).length !== policy.keyColumns.length || Object.keys(row).some(name => !policy.keyColumns.some(column => column === name))))
          return yield* Effect.fail(error("invalidInput"));
        const identity: Record<string, string> = {};
        for (const column of policy.keyColumns) {
          const value = row[column];
          if (typeof value !== "string" || value.length === 0) return yield* Effect.fail(error("invalidInput"));
          identity[column] = value;
        }
        const key = JSON.stringify(policy.keyColumns.map(column => identity[column]));
        if (rowsByKey.has(key)) return yield* Effect.fail(error("invalidInput"));
        rowsByKey.set(key, { identity, row });
      }
      const result: JsonObject[] = [];
      const observeLifecycle = Effect.fn("LogicalDocuments.observeLifecycle")(function* (
        key: Record<string, string>, lifecycleOperation: "softDelete" | "restore", before: JsonObject, after: JsonObject,
        attemptOrdinal: number | null,
      ) {
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
      });
      const capturedRows = [...rowsByKey.values()];
      const changeRows = Effect.fn("LogicalDocuments.changeRows")(function* (position: number): Effect.fn.Return<void, Failure> {
        const selectedRow = capturedRows[position];
        if (selectedRow === undefined) return;
        const { identity, row: inputRow } = selectedRow;
        return yield* withCandidateSelection(tableName, identity, true, undefined, candidates => Effect.gen(function* () {
          let pending: PendingDocument | undefined;
          for (const candidate of candidates) {
            const current = candidate.current?.value;
            if (candidate.tableId !== table.tableId || !isNonArrayRecord(current) ||
              !policy.keyColumns.every(column => current[column] === identity[column])) continue;
            if (pending !== undefined) return yield* Effect.fail(error("storedCorruption"));
            pending = candidate;
          }
          if (pending === undefined && (operation === "update" || operation === "delete" || operation === "softDelete" || operation === "restore")) return yield* changeRows(position + 1);
          if (pending !== undefined && operation === "insert") return yield* Effect.fail(error("uniqueConflict"));
          const prior = pending?.current == null ? null : yield* Effect.fromResult(output(pending.current));
          const previous = prior === null ? null : Object.fromEntries(Object.entries(prior).filter(([name]) => name !== "_id" && name !== "_creationTime"));
          if (previous !== null) yield* Effect.fromResult(policy.validate(previous, "storedCorruption"));
          if (operation === "delete") {
            if (pending === undefined || previous === null || pending.current === null) return yield* Effect.fail(error("storedCorruption"));
            yield* Effect.fromResult(recordAttempt(pending, "delete", null));
            pending.deletedValue = pending.current;
            pending.current = null;
            result.push(previous);
            return yield* changeRows(position + 1);
          }
          if (operation === "restore" && policy.deletedAt !== undefined && previous?.[policy.deletedAt] === null) {
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
            // A native upsert conflict writes supplied fields and reactivates the
            // row without advancing a managed update timestamp. Ordinary updates
            // and lifecycle transitions still advance it.
            const fields = yield* Effect.fromResult(policy.normalize(supplied, previous,
              yield* transactionTime, operation === "upsert" ? "preserve" : "advance"));
            const afterWrite = (written: JsonObject) => Effect.gen(function* () {
              const { _id: _internalId, _creationTime: _internalTime, ...native } = written;
              if ((operation === "softDelete" || operation === "restore") && previous !== null)
                yield* observeLifecycle(identity, operation, previous, native, attempts.length - 1);
              result.push(native);
              yield* changeRows(position + 1);
            });
            return yield* (pending === undefined ? withInsertedRecord(tableName, fields, afterWrite) :
              withWrittenDocument(pending, fields, "patch", afterWrite));
          });
          return yield* (transactionTimeLoaded ? applyChange : withStorageFrontier({ kind: "rows", tableId: table.tableId },
            { tableId: table.tableId }, applyChange));
        }));
      });
      yield* changeRows(0);
      const returned = yield* Effect.fromResult(capturePrivateJsonData(result, lifetime.remainingBytes(), error));
      yield* charge(returned.bytes);
      return Object.freeze(result);
    })));
  const validateRelationalReferences = Effect.fn("LogicalDocuments.validateRelationalReferences")(function* () {
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
    const checkRemoved = Effect.fn("LogicalDocuments.checkRemovedRelationalKeys")(function* (cascade: boolean) {
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
            child.current = null;
            if (child.base?.kind === "live") yield* Effect.fromResult(appendKeys(child, child.base.document.value));
            yield* Effect.fromResult(appendKeys(child, value));
          }
        }
      }
    });
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
  });
  const planSetNull = Effect.fn("LogicalDocuments.planSetNull")((context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalSetNullIntent) => lifetime.operation(context, id, "write", Effect.gen(function* () {
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
    })));
  const planReferenceReplacement = Effect.fn("LogicalDocuments.planReferenceReplacement")((context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalReferenceReplacementIntent) => lifetime.operation(context, id, "write", Effect.gen(function* () {
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
    })));
  // Borrowed row values remain lexical to this working set. Each actual reader
  // detaches its complete result once before those values leave the owner.
  type Activity = Pick<LogicalDocumentChanges, "attempts" | "lifecycle" | "observedRows" | "setNull" | "referenceReplacements">;
  let preparedActivity: Readonly<{ key: string; activity: Activity }> | undefined;
  const activityData = Effect.gen(function* () {
    if (closed || root?.closed) return yield* Effect.fail(error("closed"));
    // Close-time reference checks can hydrate rows without opening another
    // operation. Include their observation counts as well as the generation.
    const key = `${root?.activityGeneration ?? activityGeneration}/${rows.size}/${dependencies.size}/${attempts.length}/${lifecycle.length}/${setNull.length}/${referenceReplacements.length}`;
    if (preparedActivity?.key === key) return preparedActivity.activity;
    const observedRows: LogicalDocumentObservedRow[] = [];
    for (const row of rows.values()) {
      if (ownedTable(row.tableId) === undefined) continue;
      if (row.current === null) continue;
      const value = row.current.valueJson;
      if (!isJsonObject(value) || !dependencies.has(row.documentId)) return yield* Effect.fail(error("storedCorruption"));
      observedRows.push(Object.freeze({ documentId: row.documentId, tableId: row.tableId,
        tableName: localTableName(row.tableId) ?? row.tableName, value }));
    }
    observedRows.sort((left, right) => left.tableId - right.tableId || left.documentId.localeCompare(right.documentId));
    const activity = Object.freeze({
      attempts: Object.freeze(attempts.slice(localCursor.attempts).map(attempt =>
        Object.freeze({ ...attempt, ordinal: attempt.ordinal - localCursor.attempts }))),
      lifecycle: Object.freeze(lifecycle.slice(localCursor.lifecycle).map(observation => Object.freeze({ ...observation,
        attemptOrdinal: observation.attemptOrdinal === null ? null : observation.attemptOrdinal - localCursor.attempts }))),
      observedRows: Object.freeze(observedRows), setNull: Object.freeze(setNull.slice(localCursor.setNull)),
      referenceReplacements: Object.freeze(referenceReplacements.slice(localCursor.referenceReplacements)),
    });
    preparedActivity = Object.freeze({ key, activity });
    return activity;
  });
  const activitySnapshot = Effect.fn("LogicalDocuments.activitySnapshot")(() => activityData.pipe(Effect.map(activity => structuredClone(activity))));
  const close = Effect.fn("LogicalDocuments.close")(function* (): Effect.fn.Return<LogicalDocumentChanges, Failure> {
    if (closed || root?.closed || !lifetime.isClosing()) return yield* Effect.fail(error("invalidAuthority"));
    yield* state.requireAdmission;
    yield* validateRelationalReferences();
    const activity = yield* activityData;
    closed = true;
    preparedActivity = undefined;
    const localAttempts = activity.attempts;
    const localLifecycle = activity.lifecycle;
    if (root !== undefined) {
      // The root retains all pending values and dependency witnesses. Child
      // completion carries only the native lifecycle/activity receipt.
      const changed = new Set(localAttempts.map(attempt => attempt.documentId));
      return detachLogicalDocumentChanges(Object.freeze({ attempts: Object.freeze(localAttempts),
        lifecycle: Object.freeze(localLifecycle), observedRows: Object.freeze(activity.observedRows.filter(row => changed.has(row.documentId))),
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
  });
  const documents = Object.freeze({ get, getMany, find, insert, delete: remove,
    patch: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "patch", tableName),
    replace: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "replace", tableName) } satisfies LogicalDocuments<Failure>);
  const relationalTable = Effect.fn("LogicalDocuments.relationalTable")((manager: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string) => runOperation(manager, id, "read", Effect.gen(function* () {
      if (readMechanics?.metadata === undefined) {
        const table = yield* tableForName(tableName);
        if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      } else if (state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      return Object.freeze({
        find: (context, query) => relationalFind(context, id, tableName, query).pipe(Effect.map(result => result.docs)),
        findPage: (context, query) => relationalPage(context, id, tableName, query),
        count: (context, query) => relationalFind(context, id, tableName, query).pipe(Effect.map(result => result.total)),
        aggregate: (context, query) => relationalAggregate(context, id, tableName, query),
        write: (context, mode, inputRows) => relationalChange(context, id, tableName, mode, inputRows),
        delete: (context, keys) => relationalChange(context, id, tableName, "delete", keys),
        lifecycle: (context, operation, keys) => relationalChange(context, id, tableName, operation, keys),
      } satisfies LogicalRelationalStore<Failure>);
    })));
  return Object.freeze({ documents, relationalFind, relationalPage, relationalAggregate, relationalChange, relationalTable, planSetNull, planReferenceReplacement, close, requirePendingDeletion, activitySnapshot,
    readTransactionTime: (context: BoundedRequestContext, id: PresentedTransactionId) =>
      runOperation(context, id, "read", transactionTime),
    activityCursor: () => Object.freeze({ attempts: attempts.length - localCursor.attempts,
      lifecycle: lifecycle.length - localCursor.lifecycle,
      setNull: setNull.length - localCursor.setNull,
      referenceReplacements: referenceReplacements.length - localCursor.referenceReplacements }),
    attemptCount: () => attempts.length - localCursor.attempts,
    lifecycleCount: () => lifecycle.length - localCursor.lifecycle });
});

const comparePagePosition = (left: Readonly<{ key: string; rowId: string }>, right: Readonly<{ key: string; rowId: string }>) =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;
