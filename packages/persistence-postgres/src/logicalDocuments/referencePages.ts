import { Clock, Effect, Option, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { ScopeId } from "flarex-protocol/storage-authority";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type LiveAppRowRevisionV1 } from "../appRows";
import { scanCurrentAppIndexInTransactionEffect, AppIndexEntryReadPersistenceError, AppIndexEntryHashError } from "../appIndexEntries";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { lockScopeClockForOrdinaryWriteInTransactionEffect, ScopeClockNotFoundError,
  ScopeAuthorizationRevocationEpochPersistenceError } from "../scopeClock";
import { readRequiredEnabledIndexBuildsInTransactionEffect, IndexBuildStatePersistenceError } from "../indexBuildStates";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { LogicalDocumentFailure } from "./model";
import { prepareLogicalRelationalForeignKeys } from "./relationalForeignKeys";
import { selectLogicalIndex } from "./query";

/** Fifteen update pages leave one materialization page for the root operation.
 * An extra scan page detects overflow without treating a full page as complete
 * membership. The outer transaction owns rollback. */
export const logicalReferenceTransitionBudget = Object.freeze({
  pageRows: 32, affectedRows: 480, totalReadBytes: 4_194_304, scanMilliseconds: 30_000,
});

/** Traverse a declared nullable reverse FK after acquiring publication
 * exclusion. The callback is trusted settlement code, never framework code.
 * It can lower a page; keyset progress is based on the captured index entry. */
export const forEachLogicalReferencePage = Effect.fn("LogicalReferences.forEachPage")(function* <Failure>(
  input: Readonly<{
    tx: FlarexMetadataTransaction;
    scopeId: ScopeId;
    tables: readonly Readonly<{ tableId: CatalogTableId; logicalName: string; relational?: RelationalTableDefinition }>[];
    indexes: readonly LocatedAppIndexDefinitionV1[];
    sourceTableId: CatalogTableId;
    sourceColumn: string;
    targetTableId: CatalogTableId;
    targetColumn: string;
    targetKey: string;
    requireAdmission: Effect.Effect<void, Failure>;
    error: LogicalDocumentFailure<Failure>;
  }>,
  onPage: (rows: readonly LiveAppRowRevisionV1[]) => Effect.Effect<void, Failure>,
) {
  const { tx, scopeId, error } = input;
  yield* input.requireAdmission;
  const foreignKeys = yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(input.tables, error));
  const declared = foreignKeys.find(key => key.source.tableId === input.sourceTableId &&
    key.source.column === input.sourceColumn && key.target.tableId === input.targetTableId &&
    key.target.column === input.targetColumn && key.source.nullable && key.onDelete === "noAction");
  if (declared === undefined)
    return yield* Effect.fail(error("invalidInput"));
  const selected = yield* Effect.fromResult(selectLogicalIndex(input.indexes, declared.source.tableId,
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
    yield* input.requireAdmission;
    if (++pages > Math.ceil(logicalReferenceTransitionBudget.affectedRows / logicalReferenceTransitionBudget.pageRows) + 1 ||
      (yield* Clock.currentTimeMillis) - started > logicalReferenceTransitionBudget.scanMilliseconds)
      return yield* Effect.fail(error("limitExceeded"));
    const page = yield* scanCurrentAppIndexInTransactionEffect(tx, {
      scopeId, definition: selected.value.definition, bounds: selected.value.bounds,
      limit: logicalReferenceTransitionBudget.pageRows, ...(after === undefined ? {} : { after }),
    }).pipe(Effect.mapError(cause => error(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
      cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
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
      yield* onPage(Object.freeze(ordered));
      affectedRows += ordered.length;
    }
    if (page.isDone) break;
    if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
    after = page.continueCursor;
  }
  return affectedRows;
});
