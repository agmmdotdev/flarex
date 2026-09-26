import { Effect, Option } from "effect";
import {
  readAppTableWriteFrontierInTransactionEffect,
  AppRowReadPersistenceError,
} from "../appRows";
import {
  readAppUniqueKeySlotInTransactionEffect,
  AppUniqueKeyPersistenceError,
  AppUniqueKeyHashError,
} from "../appUniqueKeys";
import type { LogicalDocumentChanges } from "./workingSet";
import type { LogicalDocumentFailure } from "./model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { isJsonObject } from "flarex-protocol/json";
import { readLogicalIndexRange, readLogicalIndexPage, sameLogicalIndexMembership } from "./indexReads";
import { readLogicalSearchRange, sameLogicalSearchMembership } from "./searchReads";

/** Validate the complete command, including decisions that did not produce writes. */
export const validateLogicalDocumentChanges = Effect.fn(
  "LogicalDocuments.validateContribution",
)(function* <Failure>(input: Readonly<{
  tx: FlarexMetadataTransaction; scopeId: ScopeId; tables: ReadonlySet<CatalogTableId>;
  maximumIndexEntries: number; error: LogicalDocumentFailure<Failure>; allowSetNull?: true;
  allowReferenceReplacement?: true;
}>, closed: LogicalDocumentChanges) {
  const { tx, scopeId, tables: allowed, maximumIndexEntries, error } = input;
  if ((closed.setNull.length !== 0 && input.allowSetNull !== true) ||
    (closed.referenceReplacements.length !== 0 && input.allowReferenceReplacement !== true))
    return yield* Effect.fail(error("invalidAuthority"));
  const reads = new Map(
    closed.dependencies.map((row) => [row.documentId, row]),
  );
  const changes = new Map(closed.changes.map((row) => [row.documentId, row]));
  const attempted = new Set([...changes.keys(), ...closed.noFinalRows]);
  if (
    reads.size !== closed.dependencies.length ||
    changes.size !== closed.changes.length ||
    attempted.size !== closed.changes.length + closed.noFinalRows.length ||
    closed.dependencies.some((row) => !allowed.has(row.tableId)) ||
    closed.changes.some(
      (row) => reads.get(row.documentId)?.dependency !== row.dependency,
    ) ||
    closed.noFinalRows.some((id) => {
      const observed = reads.get(id)?.dependency.observed;
      return (
        observed?.kind !== "missing" ||
        observed.basis.kind !== "noVisibleRevision"
      );
    }) ||
    closed.setNull.some(intent => !allowed.has(intent.sourceTableId) || !allowed.has(intent.targetTableId) ||
      !closed.changes.some(change => change.kind === "deleted" && change.tableId === intent.targetTableId)) ||
    closed.referenceReplacements.length > 1 ||
    closed.referenceReplacements.some(intent => !allowed.has(intent.sourceTableId) ||
      !allowed.has(intent.targetTableId) || intent.desiredKeys.length > 256 ||
      new Set(intent.desiredKeys).size !== intent.desiredKeys.length ||
      closed.setNull.length !== 0 ||
      !closed.changes.some(change => change.kind === "live" && change.tableId === intent.targetTableId &&
        isJsonObject(change.document.valueJson) && change.document.valueJson[intent.targetColumn] === intent.targetKey)) ||
    new Set(closed.setNull.map(intent => JSON.stringify([intent.sourceTableId, intent.sourceColumn,
      intent.targetTableId, intent.targetColumn, intent.targetKey]))).size !== closed.setNull.length ||
    closed.attempts.some(
      (attempt, index) =>
        attempt.ordinal !== index || !attempted.has(attempt.documentId),
    ) ||
    [...attempted].some(
      (id) => !closed.attempts.some((attempt) => attempt.documentId === id),
    )
  ) {
    return yield* Effect.fail(error("invalidAuthority"));
  }
  // Broad/unindexed collection find reads the complete bounded table before filtering.
  // Its frontier includes tombstones, so empty results cannot lose insertions.
  for (const scan of closed.scans) {
    if (!allowed.has(scan.tableId))
      return yield* Effect.fail(error("invalidAuthority"));
    const current = yield* readAppTableWriteFrontierInTransactionEffect(
      tx,
      scopeId,
      scan.tableId,
    ).pipe(
      Effect.mapError((cause) =>
        error(
          cause instanceof AppRowReadPersistenceError
            ? "statementFailure"
            : "storedCorruption",
          cause,
        ),
      ),
    );
    if (current !== scan.frontier)
      return yield* Effect.fail(error("writeConflict"));
  }
  // Retain unique lookup and eager uniqueness decisions even if a later operation removes the
  // final claim or coalesces the entire document away.
  for (const read of closed.uniqueReads) {
    const slot = yield* readAppUniqueKeySlotInTransactionEffect(tx, {
      scopeId: scopeId,
      constraintId: read.constraintId,
      key: read.key,
    }).pipe(
      Effect.mapError((cause) =>
        error(
          cause instanceof AppUniqueKeyPersistenceError
            ? "statementFailure"
            : cause instanceof AppUniqueKeyHashError
              ? "resourceFailure"
              : "storedCorruption",
          cause,
        ),
      ),
    );
    if (
      Option.isNone(slot)
        ? read.owner !== null
        : read.owner === null ||
          slot.value.tableId !== read.owner.tableId ||
          slot.value.rowId !== read.owner.rowId
    ) {
      return yield* Effect.fail(error("writeConflict"));
    }
  }
  for (const read of closed.indexReads) {
    if (read.definition.access.kind !== "developer" || !allowed.has(read.definition.access.tableId)) {
      return yield* Effect.fail(error("invalidAuthority"));
    }
    const current = yield* readLogicalIndexRange(tx, scopeId, read, maximumIndexEntries, error);
    if (!sameLogicalIndexMembership(read.entries, current)) return yield* Effect.fail(error("writeConflict"));
  }
  for (const read of closed.searchReads) {
    if (!allowed.has(read.definition.tableId) || read.entries.length > 4096)
      return yield* Effect.fail(error("invalidAuthority"));
    const current = yield* readLogicalSearchRange(tx, scopeId, read.definition, read.patterns,
      maximumIndexEntries, error);
    if (!sameLogicalSearchMembership(read.entries, current)) return yield* Effect.fail(error("writeConflict"));
  }
  for (const read of closed.pageReads) {
    if (read.definition.access.kind !== "developer" || !allowed.has(read.definition.access.tableId) ||
      read.entries.length > maximumIndexEntries) return yield* Effect.fail(error("invalidAuthority"));
    const current = yield* readLogicalIndexPage(tx, scopeId, read, Math.max(1, read.entries.length), error);
    if (!sameLogicalIndexMembership(read.entries, current.entries) || read.isDone && !current.isDone)
      return yield* Effect.fail(error("writeConflict"));
  }
  // Materialization requires the actual final-change objects in its dependency
  // set. Preserve every other observation instead of equating reads with writes.
  const dependencies = Object.freeze(
    closed.dependencies.map((row) => changes.get(row.documentId) ?? row),
  );
  return Object.freeze({ changes: closed.changes, dependencies });
});
