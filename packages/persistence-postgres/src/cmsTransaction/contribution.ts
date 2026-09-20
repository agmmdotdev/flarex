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
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import type { CmsClosedDocuments } from "./documents";
import { cmsError } from "./model";

/** Validate the complete command, including decisions that did not produce writes. */
export const validateCmsDocumentContribution = Effect.fn(
  "CmsCommit.validateContribution",
)(function* (admission: CmsAdmission, closed: CmsClosedDocuments) {
  const state = yield* requireCmsAdmission(admission);
  const allowed = new Set(
    state.frame.payloadContent?.tables.map((table) => table.tableId),
  );
  const reads = new Map(
    closed.dependencies.map((row) => [row.documentId, row]),
  );
  const changes = new Map(closed.changes.map((row) => [row.documentId, row]));
  const attempted = new Set([...changes.keys(), ...closed.noFinalRows]);
  if (
    reads.size !== closed.dependencies.length ||
    changes.size !== closed.changes.length ||
    attempted.size !== closed.changes.length + closed.noFinalRows.length ||
    closed.dependencies.some((row) => !allowed.has(row.tableId.toString())) ||
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
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  // Broad/unindexed collection find reads the complete bounded table before filtering.
  // Its frontier includes tombstones, so empty results cannot lose insertions.
  for (const scan of closed.scans) {
    if (!allowed.has(scan.tableId.toString()))
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const current = yield* readAppTableWriteFrontierInTransactionEffect(
      state.tx,
      state.authority.scopeId,
      scan.tableId,
    ).pipe(
      Effect.mapError((cause) =>
        cmsError(
          cause instanceof AppRowReadPersistenceError
            ? "statementFailure"
            : "storedCorruption",
          cause,
        ),
      ),
    );
    if (current !== scan.frontier)
      return yield* Effect.fail(cmsError("writeConflict"));
  }
  // Retain unique lookup and eager uniqueness decisions even if a later operation removes the
  // final claim or coalesces the entire document away.
  for (const read of closed.uniqueReads) {
    const slot = yield* readAppUniqueKeySlotInTransactionEffect(state.tx, {
      scopeId: state.authority.scopeId,
      constraintId: read.constraintId,
      key: read.key,
    }).pipe(
      Effect.mapError((cause) =>
        cmsError(
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
      return yield* Effect.fail(cmsError("writeConflict"));
    }
  }
  // Materialization requires the actual final-change objects in its dependency
  // set. Preserve every other observation instead of equating reads with writes.
  const dependencies = Object.freeze(
    closed.dependencies.map((row) => changes.get(row.documentId) ?? row),
  );
  return Object.freeze({ changes: closed.changes, dependencies });
});
