import { Clock, Effect, Option, Result } from "effect";
import { eq, sql } from "drizzle-orm";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity } from "flarex-protocol/app-document-id";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type LiveAppRowRevisionV1 } from "../appRows";
import { scanCurrentAppIndexInTransactionEffect, AppIndexEntryReadPersistenceError, AppIndexEntryHashError } from "../appIndexEntries";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import { lockScopeClockForOrdinaryWriteInTransactionEffect, ScopeClockNotFoundError,
  ScopeAuthorizationRevocationEpochPersistenceError, type ScopeClockRecord } from "../scopeClock";
import { readRequiredEnabledIndexBuildsInTransactionEffect, IndexBuildStatePersistenceError } from "../indexBuildStates";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { fxSystemScopeClocks } from "../schema";
import type { LogicalDocumentFailure } from "./model";
import type { LogicalDocumentChange } from "./workingSet";
import type { LogicalRelationalAdmissionState } from "./relationalAdmission";
import { prepareLogicalRelationalForeignKeys } from "./relationalForeignKeys";
import { prepareLogicalRelationalRows } from "./relationalRows";
import { selectLogicalIndex } from "./query";

/** Fifteen update pages leave one materialization page for the root operation.
 * An extra scan page detects overflow without treating a full page as complete
 * membership. The outer transaction owns rollback. */
export const logicalReferenceTransitionBudget = Object.freeze({
  pageRows: 32, affectedRows: 480, totalReadBytes: 4_194_304, scanMilliseconds: 30_000,
});

type LogicalReferenceAdmission = Pick<LogicalRelationalAdmissionState,
  "tx" | "authority" | "schema" | "tables" | "indexes">;

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

export const forEachLogicalReferencePage = Effect.fn("LogicalReferences.forEachPage")(function* <Failure>(
  input: Readonly<LogicalReferencePageInput<Failure>>,
  onPage: (rows: readonly LiveAppRowRevisionV1[], clock: ScopeClockRecord) => Effect.Effect<void, Failure>,
) {
  const { tx, error } = input;
  const admission = yield* input.requireAdmission;
  if (admission.tx !== tx || admission.tables.some(table => !admission.schema.tables.includes(table.definition)))
    return yield* Effect.fail(error("invalidAuthority"));
  const scopeId = admission.authority.scopeId;
  const foreignKeys = yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(admission.tables.map(table =>
    ({ tableId: table.tableId, logicalName: table.localName, relational: table.definition })), error));
  const declared = foreignKeys.find(key => key.source.tableId === input.sourceTableId &&
    key.source.column === input.sourceColumn && key.target.tableId === input.targetTableId &&
    key.target.column === input.targetColumn && key.source.nullable && key.onDelete === "noAction");
  if (declared === undefined)
    return yield* Effect.fail(error("invalidInput"));
  const selected = yield* Effect.fromResult(selectLogicalIndex(admission.indexes, declared.source.tableId,
    { [declared.source.column]: input.targetKey }, error));
  if (Option.isNone(selected) || selected.value.definition.physicalSpec.orderedFields[0]?.kind !== "documentPath" ||
    selected.value.definition.physicalSpec.orderedFields[0]?.path !== declared.source.column)
    return yield* Effect.fail(error("invalidAuthority"));
  const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId)
    .pipe(Effect.mapError(cause => error(cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? "statementFailure" : cause instanceof ScopeClockNotFoundError ? "invalidAuthority" : "storedCorruption", cause)));
  const build = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, clock,
    [selected.value.definition.indexDefinitionId], "share")
    .pipe(Effect.mapError(cause => error(cause instanceof IndexBuildStatePersistenceError
      ? "statementFailure" : "storedCorruption", cause)));
  if (build.status !== "ready") return yield* Effect.fail(error("invalidAuthority"));
  const state = build.rows[0];
  if (state === undefined || state.coveredThroughCommitSeq !== clock.lastCommitSeq ||
    state.firstReadableCommitSeq === null || state.firstReadableCommitSeq > clock.lastCommitSeq ||
    state.maintenanceActivationSequence !== null || state.maintenanceBytes !== null || state.maintenanceSha256 !== null)
    return yield* Effect.fail(error("invalidAuthority"));
  const started = yield* Clock.currentTimeMillis;
  let after: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[1]["after"];
  let affectedRows = 0;
  let totalReadBytes = 0;
  let pages = 0;
  while (true) {
    if ((yield* input.requireAdmission) !== admission) return yield* Effect.fail(error("invalidAuthority"));
    if (++pages > Math.ceil(logicalReferenceTransitionBudget.affectedRows / logicalReferenceTransitionBudget.pageRows) + 1 ||
      (yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(error("limitExceeded"));
    const page = yield* scanCurrentAppIndexInTransactionEffect(tx, {
      scopeId, definition: selected.value.definition, bounds: selected.value.bounds,
      limit: logicalReferenceTransitionBudget.pageRows, ...(after === undefined ? {} : { after }),
    }).pipe(Effect.mapError(cause => error(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
      cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
    if ((yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(error("limitExceeded"));
    if (affectedRows + page.entries.length > logicalReferenceTransitionBudget.affectedRows)
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
  if (source === undefined || !admission.schema.tables.includes(source.definition))
    return yield* Effect.fail(input.error("invalidAuthority"));
  const policy = yield* Effect.fromResult(prepareLogicalRelationalRows(source.definition,
    admission.schema.capabilities, input.error));
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
