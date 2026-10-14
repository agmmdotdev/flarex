import { Clock, Data, Effect, Option, Result } from "effect";
import { eq, sql } from "drizzle-orm";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { CatalogIndexDefinitionId, CatalogTableId } from "flarex-protocol/catalog";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import {
  MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1,
  MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
} from "../../materialization/limits";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type LiveAppRowRevisionV1 } from "../appRows";
import {
  scanCurrentAppIndexInTransactionEffect,
  countCurrentAppIndexRangeUpToLimitInTransactionEffect,
} from "../../indexes/appIndexEntries";
import {
  AppIndexEntryReadPersistenceError,
  AppIndexEntryHashError,
} from "../../indexes/appIndexEntryErrors";
import { lowerAppDeveloperIndexKeyV1 } from "../../indexes/appDeveloperIndexCommitV1";
import {
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  ScopeAuthorizationRevocationEpochPersistenceError,
  type ScopeClockRecord,
} from "../../../scope/scopeClock";
import {
  ScopeClockNotFoundError,
} from "../../../scope/scopeClockErrors";
import { decodeIndexBuildStateRowResult, isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect, readRequiredEnabledIndexBuildsInTransactionEffect,
  IndexBuildStatePersistenceError } from "../../indexes/indexBuildStates";
import { IndexMaintenanceError } from "../../indexes/indexMaintenanceModel";
import type { AppIndexDefinitionRecord } from "../../indexes/appIndexDefinitions";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../../database/drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../../../database/databaseTimestamp";
import { fxSystemScopeClocks } from "../../../database/schema";
import type { LogicalDocumentFailure } from "./model";
import type { LogicalDocumentChange } from "./workingSet";
import { logicalMaterializationBatchBudget } from "./materialization";
import type { LogicalRelationalAdmissionState } from "./relationalAdmission";
import { prepareLogicalRelationalForeignKeys } from "./relationalForeignKeys";
import { logicalManagedUpdatedColumns, bindPreparedLogicalRelationalRows, hasPreparedLogicalRelationalTableMechanics } from "./relationalRows";
import { selectLogicalIndex, type LogicalWhere } from "./query";
import { readLogicalIndexRange } from "./indexReads";

/** Sixty-three update pages leave one materialization page for the root operation.
 * An extra scan page detects overflow without treating a full page as complete
 * membership. The outer transaction owns rollback. */
export const logicalReferenceTransitionBudget = Object.freeze({
  pageRows: 32, affectedRows: 2016, totalReadBytes: 4_194_304, scanMilliseconds: 30_000,
});
export class LogicalReferenceCapacityError extends Data.TaggedError("LogicalReferenceCapacityError")<{
  readonly resource: "affectedRows" | "readBytes" | "scanMilliseconds" | "pages";
  readonly maximum: number;
  readonly observedAtLeast: number;
}> {}
const compareReferenceKeys = (left: Readonly<{ key: string }>, right: Readonly<{ key: string }>) =>
  compareUtf16Strings(left.key, right.key);

type LogicalReferenceAdmission = Pick<LogicalRelationalAdmissionState,
  "tx" | "authority" | "schema" | "tables" | "indexes" | "unique">;

/** Admission authenticates the captured source references; execution owns the
 * issuer's detached table. Check issuance before inspecting foreign mechanics. */
function hasSourceBoundTable(admission: LogicalReferenceAdmission, source: LogicalReferenceAdmission["tables"][number]) {
  const original = admission.schema.tables.find(table => table.identity.tableId === source.localName);
  return original !== undefined && hasPreparedLogicalRelationalTableMechanics(source.mechanics, original, admission.schema.capabilities) &&
    source.definition === source.mechanics.table;
}

/** Count only indexes whose key or membership can change in a set-null update.
 * Unchanged keys produce no index revisions; the materializer checks the exact
 * action count before writing each page. */
function referencePageRows(admission: LogicalReferenceAdmission, tableId: CatalogTableId,
  sourceColumn: string): number {
  const source = admission.tables.find(table => table.tableId === tableId);
  if (source === undefined) return 0;
  const changed = [sourceColumn, ...logicalManagedUpdatedColumns(source.definition, admission.schema.capabilities)];
  const affected = (path: string) => changed.some(column => path === column ||
    path.startsWith(`${column}.`) || column.startsWith(`${path}.`));
  const indexes = admission.indexes.filter(index => {
    if (index.access.kind !== "developer" || index.access.tableId !== tableId) return false;
    const spec = index.physicalSpec;
    if (spec.orderedFields.some(field => field.kind === "documentPath" && affected(field.path))) return true;
    const predicate = spec.predicate;
    if (predicate === undefined) return false;
    switch (predicate.kind) {
      case "fieldIsNull": return affected(predicate.field);
      case "fieldIsNullAndTextEquals": return affected(predicate.nullField) || affected(predicate.textField);
      default: return true;
    }
  }).length;
  const unique = admission.unique.filter(definition => definition.tableId === tableId).length;
  return Math.min(logicalReferenceTransitionBudget.pageRows,
    // An updated indexed key may emit both a tombstone and a live revision.
    indexes === 0 ? logicalReferenceTransitionBudget.pageRows : Math.floor(MAX_POINT_COMMIT_DEVELOPER_INDEX_ENTRY_REVISIONS_V1 / (2 * indexes)),
    unique === 0 ? logicalReferenceTransitionBudget.pageRows : Math.floor(MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1 / unique));
}

/** Traverse a declared nullable reverse FK after acquiring publication
 * exclusion. The callback is trusted settlement code, never framework code.
 * It can lower a page; keyset progress is based on the captured index entry. */
export interface LogicalReferencePageInput<Failure> {
    tx: FlarexMetadataTransaction;
    sourceTableId: CatalogTableId;
    sourceColumn: string;
    targetTableId: CatalogTableId;
    targetColumn: string;
    targetKey: string;
    requireAdmission: Effect.Effect<LogicalReferenceAdmission, Failure>;
    error: LogicalDocumentFailure<Failure>;
}

const requireSourceBoundIndexCoverage = Effect.fn("LogicalReferences.requireIndexCoverage")(function* <Failure>(
  tx: FlarexMetadataTransaction, clock: ScopeClockRecord, definition: AppIndexDefinitionRecord,
  error: LogicalDocumentFailure<Failure>,
) {
  const build = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, clock,
    [definition.indexDefinitionId], "share")
    .pipe(Effect.mapError(cause => error(cause instanceof IndexBuildStatePersistenceError
      ? "statementFailure" : "storedCorruption", cause)));
  if (build.status !== "ready") return yield* Effect.fail(error("invalidAuthority"));
  const row = build.rows[0];
  if (row === undefined) return yield* Effect.fail(error("storedCorruption"));
  const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(row, clock.scopeId,
    definition.indexDefinitionId, row.maintenanceObligation)).pipe(Effect.mapError(cause => error("storedCorruption", cause)));
  // Logical binding maintenance belongs to the same source publisher. The
  // coverage owner below authenticates its current head, table and physical
  // definition. Application maintenance belongs to a different writer.
  if (state.maintenance !== null && state.maintenance.authorityKind !== "binding")
    return yield* Effect.fail(error("invalidAuthority"));
  const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock).pipe(
    Effect.mapError(cause => error(cause.reason === "resourceFailure" ? "statementFailure" : "storedCorruption", cause)));
  const covered = yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, state,
    { ...definition, tableId: definition.access.tableId }, clock.lastCommitSeq, context).pipe(
    Effect.mapError(cause => error(cause instanceof AppRowReadPersistenceError ||
      cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure"
      ? "statementFailure" : "storedCorruption", cause)));
  if (!covered) return yield* Effect.fail(error("invalidAuthority"));
});

export const forEachLogicalReferencePage = Effect.fn("LogicalReferences.forEachPage")(function* <Failure>(
  input: Readonly<LogicalReferencePageInput<Failure>>,
  onPage: (rows: readonly LiveAppRowRevisionV1[], clock: ScopeClockRecord) => Effect.Effect<void, Failure>,
) {
  const { tx, error } = input;
  const admission = yield* input.requireAdmission;
  if (admission.tx !== tx || admission.tables.some(table => !hasSourceBoundTable(admission, table)))
    return yield* Effect.fail(error("invalidAuthority"));
  const scopeId = admission.authority.scopeId;
  const foreignKeys = yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(admission.tables.map(table =>
    ({ tableId: table.tableId, logicalName: table.localName, relational: table.definition })), error));
  const declared = foreignKeys.find(key => key.source.tableId === input.sourceTableId &&
    key.source.column === input.sourceColumn && key.target.tableId === input.targetTableId &&
    key.target.column === input.targetColumn && key.source.nullable && key.onDelete === "noAction");
  if (declared === undefined)
    return yield* Effect.fail(error("invalidInput"));
  const pageRows = referencePageRows(admission, declared.source.tableId, declared.source.column);
  if (pageRows < 1) return yield* Effect.fail(error("limitExceeded"));
  const affectedLimit = Math.min(logicalReferenceTransitionBudget.affectedRows,
    pageRows * (logicalMaterializationBatchBudget.pages - 1));
  const selected = yield* Effect.fromResult(selectLogicalIndex(admission.indexes, declared.source.tableId,
    { [declared.source.column]: input.targetKey }, error));
  if (Option.isNone(selected) || selected.value.definition.physicalSpec.orderedFields[0]?.kind !== "documentPath" ||
    selected.value.definition.physicalSpec.orderedFields[0]?.path !== declared.source.column)
    return yield* Effect.fail(error("invalidAuthority"));
  const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId)
    .pipe(Effect.mapError(cause => error(cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? "statementFailure" : cause instanceof ScopeClockNotFoundError ? "invalidAuthority" : "storedCorruption", cause)));
  yield* requireSourceBoundIndexCoverage(tx, clock, selected.value.definition, error);
  // A range exceeding the atomic budget must not spend most of that budget
  // lowering pages before it can report the inevitable capacity refusal.
  const rangeCount = yield* countCurrentAppIndexRangeUpToLimitInTransactionEffect(tx, {
    scopeId, definition: selected.value.definition, bounds: selected.value.bounds,
    maximumEntries: affectedLimit,
  }).pipe(Effect.mapError(cause => error(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
    cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
  if (rangeCount > affectedLimit) return yield* Effect.fail(error("limitExceeded",
    new LogicalReferenceCapacityError({ resource: "affectedRows", maximum: affectedLimit,
      observedAtLeast: rangeCount })));
  const started = yield* Clock.currentTimeMillis;
  let after: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[1]["after"];
  let affectedRows = 0;
  let totalReadBytes = 0;
  let pages = 0;
  while (true) {
    if ((yield* input.requireAdmission) !== admission) return yield* Effect.fail(error("invalidAuthority"));
    if (++pages > logicalMaterializationBatchBudget.pages ||
      (yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(error("limitExceeded"));
    const page = yield* scanCurrentAppIndexInTransactionEffect(tx, {
      scopeId, definition: selected.value.definition, bounds: selected.value.bounds,
      limit: pageRows, ...(after === undefined ? {} : { after }),
    }).pipe(Effect.mapError(cause => error(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
      cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
    if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(error("limitExceeded"));
    if (affectedRows + page.entries.length > affectedLimit)
      return yield* Effect.fail(error("limitExceeded"));
    if (page.entries.some(entry => entry.tableId !== declared.source.tableId) ||
      new Set(page.entries.map(entry => entry.rowId)).size !== page.entries.length)
      return yield* Effect.fail(error("storedCorruption"));
    if (page.entries.length > 0) {
      const indexBytes = page.entries.reduce((sum, entry) => sum + 128 + entry.encodedKey.length / 2, 0);
      const remaining = logicalReferenceTransitionBudget.totalReadBytes - totalReadBytes - indexBytes;
      if (remaining < 0) return yield* Effect.fail(error("limitExceeded"));
      const captured = yield* readBoundedCurrentAppRowsInTransactionEffect(tx, {
        scopeId, tableId: declared.source.tableId, minimumCommitSeq: clock.lastCommitSeq,
        maximumIdentities: page.entries.length, maximumDocumentBytes: 65_536,
        maximumTotalValueBytes: Math.min(1_048_576, remaining), rowIds: page.entries.map(entry => entry.rowId),
      }).pipe(Effect.mapError(cause => error(cause instanceof AppRowReadPersistenceError ? "statementFailure" :
        cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
          ? "limitExceeded" : "storedCorruption", cause)));
      if (captured.commitSeq !== clock.lastCommitSeq || captured.rows.length !== page.entries.length)
        return yield* Effect.fail(error("writeConflict"));
      const byId = new Map(captured.rows.map(row => [row.rowId, row]));
      const ordered: LiveAppRowRevisionV1[] = [];
      for (const entry of page.entries) {
        const row = byId.get(entry.rowId);
        if (row?.kind !== "live" || row.commitSeq > clock.lastCommitSeq || row.commitSeq < entry.commitSeq ||
          !isJsonObject(row.document.valueJson) || row.document.valueJson[declared.source.column] !== input.targetKey)
          return yield* Effect.fail(error("writeConflict"));
        const key = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selected.value.definition, row.document, row.creationTime)
          .pipe(Result.mapError(cause => error("storedCorruption", cause))));
        if (key !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
        ordered.push(row);
      }
      totalReadBytes += indexBytes + ordered.reduce((sum, row) => sum + row.document.canonicalBytes.byteLength, 0);
      if (totalReadBytes > logicalReferenceTransitionBudget.totalReadBytes)
        return yield* Effect.fail(error("limitExceeded"));
      yield* onPage(Object.freeze(ordered), clock);
      if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
        return yield* Effect.fail(error("limitExceeded"));
      affectedRows += ordered.length;
    }
    if (page.isDone) break;
    if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
    after = page.continueCursor;
  }
  return affectedRows;
});

/** A trusted owner converts each selected page into ordinary logical row
 * intents. The callback lowers it in the same transaction; it never receives
 * storage authority or a framework-supplied affected-row list. */
export const forEachLogicalSetNullPage = Effect.fn("LogicalReferences.forEachSetNullPage")(function* <Failure>(
  input: Readonly<LogicalReferencePageInput<Failure>>,
  onPage: (changes: readonly LogicalDocumentChange[]) => Effect.Effect<void, Failure>,
) {
  const admission = yield* input.requireAdmission;
  if (admission.tx !== input.tx) return yield* Effect.fail(input.error("invalidAuthority"));
  const stableInput = { ...input, requireAdmission: input.requireAdmission.pipe(Effect.flatMap(current =>
    current === admission ? Effect.succeed(current) : Effect.fail(input.error("invalidAuthority")))) };
  const source = admission.tables.find(table => table.tableId === input.sourceTableId);
  if (source === undefined || !hasSourceBoundTable(admission, source))
    return yield* Effect.fail(input.error("invalidAuthority"));
  const policy = yield* Effect.fromResult(bindPreparedLogicalRelationalRows(source.mechanics, input.error));
  const transactionTime = yield* Effect.cached(Effect.gen(function* () {
    const time = yield* runDrizzleStatementEffect(input.tx.select({ timestamp: sql<unknown>`current_timestamp` })
      .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, admission.authority.scopeId)),
    cause => input.error("statementFailure", cause));
    const parsed = databaseTimestampFromUnknown(time[0]?.timestamp);
    if (parsed === null) return yield* Effect.fail(input.error("storedCorruption"));
    return parsed.toISOString();
  }));
  const started = yield* Clock.currentTimeMillis;
  const changed = yield* forEachLogicalReferencePage(stableInput, (rows, clock) => Effect.gen(function* () {
    const changes: LogicalDocumentChange[] = [];
    for (const row of rows) {
      const previous = row.document.valueJson;
      const documentId = appDocumentIdV1FromRowIdentity(row);
      if (!isJsonObject(previous) || previous._id !== documentId || previous._creationTime !== row.creationTime)
        return yield* Effect.fail(input.error("storedCorruption"));
      const native = Object.fromEntries(Object.entries(previous).filter(([name]) => name !== "_id" && name !== "_creationTime"));
      yield* Effect.fromResult(policy.validate(native, "storedCorruption"));
      const updated = yield* Effect.fromResult(policy.normalize({ [input.sourceColumn]: null }, native,
        yield* transactionTime).pipe(Result.mapError(cause => input.error("storedCorruption", cause))));
      const document = yield* canonicalizeFlarexValueV1Effect({ ...updated, _id: documentId,
        _creationTime: row.creationTime }, "appDocument").pipe(Effect.mapError(cause => input.error("storedCorruption", cause)));
      changes.push(Object.freeze({ documentId, tableId: row.tableId, rowId: row.rowId, readAt: clock.lastCommitSeq,
        dependency: Object.freeze({ kind: "appRowPoint" as const, documentId,
          observed: Object.freeze({ kind: "present" as const, revisionCommitSeq: row.commitSeq }) }),
        kind: "live" as const, creationTime: row.creationTime, document }));
    }
    yield* onPage(Object.freeze(changes));
  }));
  if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
    return yield* Effect.fail(input.error("limitExceeded"));
  const remaining = yield* forEachLogicalReferencePage(stableInput, () => Effect.void);
  if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
    return yield* Effect.fail(input.error("limitExceeded"));
  if (remaining !== 0) return yield* Effect.fail(input.error("invalidAuthority"));
  return changed;
});

export interface LogicalReferenceReplacementSelection {
  readonly detach: readonly Readonly<{ key: string; rowId: AppRowIdHexV1; commitSeq: CommitSeq | null }>[];
  readonly associate: readonly Readonly<{ key: string; rowId: AppRowIdHexV1; commitSeq: CommitSeq | null }>[];
  /** Coalesced pending afterimages, lowered once with the complete native root. */
  readonly pendingChanges: readonly LogicalDocumentChange[];
}
const replacementSelections = new WeakMap<object, Readonly<{
  tx: FlarexMetadataTransaction; scopeId: string; sourceTableId: CatalogTableId; sourceColumn: string;
  targetTableId: CatalogTableId; targetColumn: string; targetKey: string;
  clock: ScopeClockRecord; readBytes: number;
  pendingIds: ReadonlySet<AppRowIdHexV1>;
}>>();

/** Select exactly the active rows a native nullable-reference replacement
 * would update. The caller holds one publication transaction and never gives
 * these row identities to framework code. Materialization must recheck every
 * selected revision before lowering and must account for all rows and events. */
export const selectLogicalReferenceReplacement = Effect.fn("LogicalReferences.selectReplacement")(function* <Failure>(
  input: Readonly<LogicalReferencePageInput<Failure> & { readonly desiredKeys: readonly string[];
    readonly pendingChanges: readonly LogicalDocumentChange[] }>,
) {
  const admission = yield* input.requireAdmission;
  if (admission.tx !== input.tx) return yield* Effect.fail(input.error("invalidAuthority"));
  const source = admission.tables.find(table => table.tableId === input.sourceTableId);
  if (source === undefined || !hasSourceBoundTable(admission, source))
    return yield* Effect.fail(input.error("invalidAuthority"));
  const policy = yield* Effect.fromResult(bindPreparedLogicalRelationalRows(source.mechanics, input.error));
  const identity = policy.keyColumns.length === 1 ? policy.keyColumns[0] : undefined;
  if (identity === undefined || input.desiredKeys.length > 256 ||
    new Set(input.desiredKeys).size !== input.desiredKeys.length)
    return yield* Effect.fail(input.error("invalidInput"));
  const desired = new Set(input.desiredKeys);
  const pending = new Map(input.pendingChanges.filter(change => change.tableId === input.sourceTableId).map(change => [change.rowId, change]));
  const pendingKeys = new Set<string>();
  const pendingChanges: LogicalDocumentChange[] = [];
  const detach: LogicalReferenceReplacementSelection["detach"][number][] = [];
  const associate: LogicalReferenceReplacementSelection["associate"][number][] = [];
  let selectedBytes = 0;
  const started = yield* Clock.currentTimeMillis;
  const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(input.tx, admission.authority.scopeId)
    .pipe(Effect.mapError(cause => input.error(cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? "statementFailure" : cause instanceof ScopeClockNotFoundError ? "invalidAuthority" : "storedCorruption", cause)));
  const time = yield* runDrizzleStatementEffect(input.tx.select({ timestamp: sql<unknown>`current_timestamp` })
    .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, admission.authority.scopeId)), cause => input.error("statementFailure", cause));
  const timestamp = databaseTimestampFromUnknown(time[0]?.timestamp);
  if (timestamp === null) return yield* Effect.fail(input.error("storedCorruption"));
  for (const change of pending.values()) {
    if (change.kind !== "live") continue;
    const value = change.document.valueJson;
    if (!isJsonObject(value) || value._id !== change.documentId || value._creationTime !== change.creationTime)
      return yield* Effect.fail(input.error("storedCorruption"));
    const native = Object.fromEntries(Object.entries(value).filter(([name]) => name !== "_id" && name !== "_creationTime"));
    yield* Effect.fromResult(policy.validate(native, "storedCorruption"));
    const key = native[identity];
    if (typeof key !== "string" || pendingKeys.has(key)) return yield* Effect.fail(input.error("invalidAuthority"));
    pendingKeys.add(key);
    selectedBytes += 256 + change.document.canonicalBytes.byteLength;
    if (selectedBytes > logicalReferenceTransitionBudget.totalReadBytes) return yield* Effect.fail(input.error("limitExceeded"));
    if (policy.deletedAt !== undefined && native[policy.deletedAt] !== null) continue;
    const associateRow = desired.has(key);
    if (!associateRow && native[input.sourceColumn] !== input.targetKey) continue;
    const selectedRow = Object.freeze({ key, rowId: change.rowId,
      commitSeq: change.dependency.kind === "appRowPoint" && change.dependency.observed.kind === "present" ? change.dependency.observed.revisionCommitSeq : null });
    (associateRow ? associate : detach).push(selectedRow);
    const updated = yield* Effect.fromResult(policy.normalize({ [input.sourceColumn]: associateRow ? input.targetKey : null }, native,
      timestamp.toISOString()).pipe(Result.mapError(cause => input.error("storedCorruption", cause))));
    const document = yield* canonicalizeFlarexValueV1Effect({ ...updated, _id: change.documentId, _creationTime: change.creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => input.error("storedCorruption", cause)));
    pendingChanges.push(Object.freeze({ ...change, document }));
  }
  const oldCount = yield* forEachLogicalReferencePage(input, (rows, current) => Effect.gen(function* () {
    if (clock.scopeId !== current.scopeId || clock.epoch !== current.epoch ||
      clock.storageGeneration !== current.storageGeneration || clock.lastCommitSeq !== current.lastCommitSeq)
      return yield* Effect.fail(input.error("invalidAuthority"));
    for (const row of rows) {
      if (pending.has(row.rowId)) continue;
      const value = row.document.valueJson;
      selectedBytes += 256 + row.document.canonicalBytes.byteLength;
      if (selectedBytes > logicalReferenceTransitionBudget.totalReadBytes)
        return yield* Effect.fail(input.error("limitExceeded"));
      if (!isJsonObject(value) || value._id !== appDocumentIdV1FromRowIdentity(row) ||
        value._creationTime !== row.creationTime)
        return yield* Effect.fail(input.error("storedCorruption"));
      const native = Object.fromEntries(Object.entries(value).filter(([name]) =>
        name !== "_id" && name !== "_creationTime"));
      yield* Effect.fromResult(policy.validate(native, "storedCorruption"));
      if (!isJsonObject(value) || typeof value[identity] !== "string" ||
        (policy.deletedAt !== undefined && value[policy.deletedAt] !== null)) {
        if (!isJsonObject(value) || typeof value[identity] !== "string")
          return yield* Effect.fail(input.error("storedCorruption"));
        continue;
      }
      if (!desired.has(value[identity])) detach.push(Object.freeze({ key: value[identity],
        rowId: row.rowId, commitSeq: row.commitSeq }));
      if (detach.length + associate.length > 255) return yield* Effect.fail(input.error("limitExceeded"));
    }
  }));
  if (oldCount > logicalReferenceTransitionBudget.affectedRows)
    return yield* Effect.fail(input.error("invalidAuthority"));
  const ready = new Set<CatalogIndexDefinitionId>();
  for (const key of desired) {
    if (pendingKeys.has(key)) continue;
    if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(input.error("limitExceeded"));
    const where: LogicalWhere = { [identity]: key,
      ...(policy.deletedAt === undefined ? {} : { [policy.deletedAt]: null }) };
    const selectedResult = selectLogicalIndex(admission.indexes, input.sourceTableId, where, input.error);
    const selectedIndex = yield* Effect.fromResult(selectedResult);
    if (Option.isNone(selectedIndex) || selectedIndex.value.definition.physicalSpec.orderedFields[0]?.kind !== "documentPath" ||
      selectedIndex.value.definition.physicalSpec.orderedFields[0].path !== String(identity))
      return yield* Effect.fail(input.error("invalidAuthority"));
    const definition = selectedIndex.value.definition;
    if (!ready.has(definition.indexDefinitionId)) {
      yield* requireSourceBoundIndexCoverage(input.tx, clock, definition, input.error);
      ready.add(definition.indexDefinitionId);
    }
    const entries = yield* readLogicalIndexRange(input.tx, admission.authority.scopeId,
      { definition, bounds: selectedIndex.value.bounds }, 2, input.error);
    if (entries.length > 1) return yield* Effect.fail(input.error("storedCorruption"));
    const entry = entries[0];
    if (entry === undefined) continue;
    if (pending.has(entry.rowId)) continue;
    if (entry.tableId !== input.sourceTableId) return yield* Effect.fail(input.error("storedCorruption"));
    const captured = yield* readBoundedCurrentAppRowsInTransactionEffect(input.tx, {
      scopeId: admission.authority.scopeId, tableId: input.sourceTableId,
      minimumCommitSeq: clock.lastCommitSeq, maximumIdentities: 1,
      maximumDocumentBytes: 65_536, maximumTotalValueBytes: 65_536, rowIds: [entry.rowId],
    }).pipe(Effect.mapError(cause => input.error(cause instanceof AppRowReadPersistenceError ? "statementFailure" :
      cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
        ? "limitExceeded" : "storedCorruption", cause)));
    const row = captured.rows[0];
    if (captured.commitSeq !== clock.lastCommitSeq || captured.rows.length !== 1 || row?.kind !== "live" ||
      row.commitSeq > clock.lastCommitSeq || row.commitSeq < entry.commitSeq ||
      !isJsonObject(row.document.valueJson) || row.document.valueJson[identity] !== key ||
      (policy.deletedAt !== undefined && row.document.valueJson[policy.deletedAt] !== null))
      return yield* Effect.fail(input.error("writeConflict"));
    if (row.document.valueJson._id !== appDocumentIdV1FromRowIdentity(row) ||
      row.document.valueJson._creationTime !== row.creationTime)
      return yield* Effect.fail(input.error("storedCorruption"));
    const native = Object.fromEntries(Object.entries(row.document.valueJson).filter(([name]) =>
      name !== "_id" && name !== "_creationTime"));
    yield* Effect.fromResult(policy.validate(native, "storedCorruption"));
    const indexKey = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(definition, row.document, row.creationTime)
      .pipe(Result.mapError(cause => input.error("storedCorruption", cause))));
    if (indexKey !== entry.encodedKey) return yield* Effect.fail(input.error("writeConflict"));
    selectedBytes += 128 + entry.encodedKey.length / 2 + row.document.canonicalBytes.byteLength;
    if (selectedBytes > logicalReferenceTransitionBudget.totalReadBytes || detach.length + associate.length + 1 > 255)
      return yield* Effect.fail(input.error("limitExceeded"));
    if (associate.some(previous => previous.rowId === row.rowId) ||
      detach.some(previous => previous.rowId === row.rowId))
      return yield* Effect.fail(input.error("storedCorruption"));
    associate.push(Object.freeze({ key, rowId: row.rowId, commitSeq: row.commitSeq }));
  }
  // The native selector updates each phase in ascending Product ID order.
  if (detach.length + associate.length > 255) return yield* Effect.fail(input.error("limitExceeded"));
  const selection = Object.freeze({ detach: Object.freeze(detach.toSorted(compareReferenceKeys)),
    associate: Object.freeze(associate.toSorted(compareReferenceKeys)), pendingChanges: Object.freeze(pendingChanges) }) satisfies LogicalReferenceReplacementSelection;
  replacementSelections.set(selection, Object.freeze({ tx: input.tx, scopeId: admission.authority.scopeId,
    sourceTableId: input.sourceTableId, sourceColumn: input.sourceColumn,
    targetTableId: input.targetTableId, targetColumn: input.targetColumn, targetKey: input.targetKey,
    clock, readBytes: selectedBytes, pendingIds: new Set(pending.keys()) }));
  return selection;
});

/** Lower a previously selected replacement in native detach-then-associate
 * order. Each row is reread at its selected revision while the caller holds
 * publication exclusion. Only one decoded page reaches the trusted callback. */
export const forEachLogicalReferenceReplacementPage = Effect.fn("LogicalReferences.forEachReplacementPage")(function* <Failure>(
  input: Readonly<LogicalReferencePageInput<Failure> & { readonly selection: LogicalReferenceReplacementSelection }>,
  onPage: (changes: readonly LogicalDocumentChange[], keys: readonly string[]) => Effect.Effect<void, Failure>,
) {
  const admission = yield* input.requireAdmission;
  if (admission.tx !== input.tx) return yield* Effect.fail(input.error("invalidAuthority"));
  const sealed = replacementSelections.get(input.selection);
  if (sealed === undefined || sealed.tx !== input.tx || sealed.scopeId !== admission.authority.scopeId ||
    sealed.sourceTableId !== input.sourceTableId || sealed.sourceColumn !== input.sourceColumn ||
    sealed.targetTableId !== input.targetTableId || sealed.targetColumn !== input.targetColumn ||
    sealed.targetKey !== input.targetKey)
    return yield* Effect.fail(input.error("invalidAuthority"));
  replacementSelections.delete(input.selection);
  const source = admission.tables.find(table => table.tableId === input.sourceTableId);
  if (source === undefined || !hasSourceBoundTable(admission, source))
    return yield* Effect.fail(input.error("invalidAuthority"));
  const policy = yield* Effect.fromResult(bindPreparedLogicalRelationalRows(source.mechanics, input.error));
  const identity = policy.keyColumns.length === 1 ? policy.keyColumns[0] : undefined;
  if (identity === undefined) return yield* Effect.fail(input.error("invalidAuthority"));
  const selected = [...input.selection.detach, ...input.selection.associate];
  if (selected.length > 255 || new Set(selected.map(row => row.rowId)).size !== selected.length)
    return yield* Effect.fail(input.error("invalidAuthority"));
  const pageRows = referencePageRows(admission, input.sourceTableId, input.sourceColumn);
  if (pageRows < 1) return yield* Effect.fail(input.error("limitExceeded"));
  const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(input.tx, admission.authority.scopeId)
    .pipe(Effect.mapError(cause => input.error(cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? "statementFailure" : cause instanceof ScopeClockNotFoundError ? "invalidAuthority" : "storedCorruption", cause)));
  if (clock.scopeId !== sealed.clock.scopeId || clock.epoch !== sealed.clock.epoch ||
    clock.storageGeneration !== sealed.clock.storageGeneration || clock.lastCommitSeq !== sealed.clock.lastCommitSeq)
    return yield* Effect.fail(input.error("invalidAuthority"));
  const time = yield* runDrizzleStatementEffect(input.tx.select({ timestamp: sql<unknown>`current_timestamp` })
    .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, admission.authority.scopeId)),
  cause => input.error("statementFailure", cause));
  const timestamp = databaseTimestampFromUnknown(time[0]?.timestamp);
  if (timestamp === null) return yield* Effect.fail(input.error("storedCorruption"));
  const started = yield* Clock.currentTimeMillis;
  let readBytes = sealed.readBytes;
  let processed = 0;
  for (const [selectedRows, replacement] of [
    [input.selection.detach, null], [input.selection.associate, input.targetKey],
  ] as const) {
    const rows = selectedRows.filter(row => !sealed.pendingIds.has(row.rowId));
    for (let offset = 0; offset < rows.length; offset += pageRows) {
      if ((yield* input.requireAdmission) !== admission)
        return yield* Effect.fail(input.error("invalidAuthority"));
      if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
        return yield* Effect.fail(input.error("limitExceeded"));
      const page = rows.slice(offset, offset + pageRows);
      const captured = yield* readBoundedCurrentAppRowsInTransactionEffect(input.tx, {
        scopeId: admission.authority.scopeId, tableId: input.sourceTableId,
        minimumCommitSeq: clock.lastCommitSeq, maximumIdentities: page.length,
        maximumDocumentBytes: 65_536, maximumTotalValueBytes: 1_048_576,
        rowIds: page.map(row => row.rowId),
      }).pipe(Effect.mapError(cause => input.error(cause instanceof AppRowReadPersistenceError ? "statementFailure" :
        cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
          ? "limitExceeded" : "storedCorruption", cause)));
      if (captured.commitSeq !== clock.lastCommitSeq || captured.rows.length !== page.length)
        return yield* Effect.fail(input.error("writeConflict"));
      const byId = new Map(captured.rows.map(row => [row.rowId, row]));
      const changes: LogicalDocumentChange[] = [];
      for (const selectedRow of page) {
        const row = byId.get(selectedRow.rowId);
        if (row?.kind !== "live" || row.commitSeq !== selectedRow.commitSeq ||
          !isJsonObject(row.document.valueJson) || row.document.valueJson[identity] !== selectedRow.key ||
          (policy.deletedAt !== undefined && row.document.valueJson[policy.deletedAt] !== null) ||
          (replacement === null && row.document.valueJson[input.sourceColumn] !== input.targetKey))
          return yield* Effect.fail(input.error("writeConflict"));
        const previous = row.document.valueJson;
        const documentId = appDocumentIdV1FromRowIdentity(row);
        if (previous._id !== documentId || previous._creationTime !== row.creationTime)
          return yield* Effect.fail(input.error("storedCorruption"));
        const native = Object.fromEntries(Object.entries(previous).filter(([name]) =>
          name !== "_id" && name !== "_creationTime"));
        yield* Effect.fromResult(policy.validate(native, "storedCorruption"));
        readBytes += 256 + row.document.canonicalBytes.byteLength;
        if (readBytes > logicalReferenceTransitionBudget.totalReadBytes)
          return yield* Effect.fail(input.error("limitExceeded"));
        const updated = yield* Effect.fromResult(policy.normalize({ [input.sourceColumn]: replacement }, native,
          timestamp.toISOString()).pipe(Result.mapError(cause => input.error("storedCorruption", cause))));
        const document = yield* canonicalizeFlarexValueV1Effect({ ...updated, _id: documentId,
          _creationTime: row.creationTime }, "appDocument").pipe(Effect.mapError(cause => input.error("storedCorruption", cause)));
        changes.push(Object.freeze({ documentId, tableId: row.tableId, rowId: row.rowId,
          readAt: clock.lastCommitSeq, dependency: Object.freeze({ kind: "appRowPoint" as const, documentId,
            observed: Object.freeze({ kind: "present" as const, revisionCommitSeq: row.commitSeq }) }),
          kind: "live" as const, creationTime: row.creationTime, document }));
      }
      yield* onPage(Object.freeze(changes), Object.freeze(page.map(row => row.key)));
      processed += page.length;
      if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
        return yield* Effect.fail(input.error("limitExceeded"));
    }
  }
  return processed;
});
