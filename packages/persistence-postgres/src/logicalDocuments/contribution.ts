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
import { readLogicalIndexRange, sameLogicalIndexMembership } from "./indexReads";

/** Validate the complete command, including decisions that did not produce writes. */
export const validateLogicalDocumentChanges = Effect.fn(
  "LogicalDocuments.validateContribution",
)(function* <Failure>(input: Readonly<{
  tx: FlarexMetadataTransaction; scopeId: ScopeId; tables: ReadonlySet<CatalogTableId>;
  maximumIndexEntries: number; error: LogicalDocumentFailure<Failure>;
}>, closed: LogicalDocumentChanges) {
  const { tx, scopeId, tables: allowed, maximumIndexEntries, error } = input;
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
  // Materialization requires the actual final-change objects in its dependency
  // set. Preserve every other observation instead of equating reads with writes.
  const dependencies = Object.freeze(
    closed.dependencies.map((row) => changes.get(row.documentId) ?? row),
  );
  return Object.freeze({ changes: closed.changes, dependencies });
});
