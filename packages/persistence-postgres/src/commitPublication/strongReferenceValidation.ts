import { Clock, Effect, Option, Result, Schema } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { isJsonObject } from "flarex-protocol/json";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, decodeAppDocumentIdentityV1Result,
  type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { AppIndexPhysicalSpecSha256HexV1Schema } from "flarex-protocol/index-definition";
import { compileAppOrderedIndexBoundsV1, orderedIndexRowIdHexV1FromBytesResult, orderedIndexValueForAppFieldV1,
  orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { StrongReferenceActivationProjection } from "../frameworkSchema/binding/strongReferenceProjection";
import { readAppRowAtSnapshotInTransactionEffect, readBoundedPublicationAppRowsInTransactionEffect,
  AppRowReadPersistenceError, type AppRowRevisionV1 } from "../appRows";
import { appendPublicationIndexEntryRevisionsInTransactionEffect,
  AppIndexEntryReadPersistenceError, AppIndexEntryWritePersistenceError,
  readCurrentAppIndexEntriesForRowInTransactionEffect,
  scanCurrentPublicationIndexInTransactionEffect,
  type AppendPublicationIndexEntryRevisionInput } from "../appIndexEntries";
import { lowerAppOrderedIndexPhysicalKeyV1 } from "../appDeveloperIndexCommitV1";
import { AppUniqueKeyPersistenceError, readAppUniqueKeySlotForPublicationInTransactionEffect } from "../appUniqueKeys";
import { decodeIndexBuildStateRowResult, isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect, readRequiredEnabledIndexBuildsInTransactionEffect,
  IndexBuildStatePersistenceError } from "../indexBuildStates";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import { IndexMaintenanceError } from "../indexMaintenanceEvidence";
import { fxSystemIndexBuildStates } from "../schema";
import { ScopePublicationCorruptionError, ScopePublicationReferenceCapacityError,
  ScopePublicationReferenceConstraintError, ScopePublicationSqlFailure } from "./scopePublicationModel";

const PAGE_ROWS = 32;
const MAX_REFERENCE_ROWS = 2016;
const MAX_REFERENCE_READ_BYTES = 4_194_304;
const MAX_REFERENCE_SCAN_MILLISECONDS = 30_000;
const decodeDigest = Schema.decodeUnknownResult(Schema.toType(AppIndexPhysicalSpecSha256HexV1Schema));
type ChangedRow = Readonly<{ tableId: CatalogTableId; rowId: AppRowIdHexV1 }>;
type Failure = ScopePublicationCorruptionError | ScopePublicationReferenceCapacityError |
  ScopePublicationReferenceConstraintError | ScopePublicationSqlFailure;
const corruption = (cause?: unknown) => new ScopePublicationCorruptionError({
  reason: "publicationInvariantInvalid", ...(cause === undefined ? {} : { cause }),
});
const capacity = (dimension: ScopePublicationReferenceCapacityError["dimension"], observedAtLeast: number) =>
  new ScopePublicationReferenceCapacityError({ dimension, maximum: dimension === "readBytes"
    ? MAX_REFERENCE_READ_BYTES : dimension === "scanMilliseconds"
      ? MAX_REFERENCE_SCAN_MILLISECONDS : MAX_REFERENCE_ROWS, observedAtLeast });
const persistence = (operation: "readStrongReferenceFacts" | "readStrongReferenceProjection", cause: unknown) =>
  new ScopePublicationSqlFailure({ operation, cause });
const classify = (cause: unknown) => cause instanceof AppRowReadPersistenceError ||
  cause instanceof AppUniqueKeyPersistenceError || cause instanceof AppIndexEntryReadPersistenceError ||
  cause instanceof AppIndexEntryWritePersistenceError || cause instanceof IndexBuildStatePersistenceError ||
  (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure")
  ? persistence("readStrongReferenceProjection", cause) : corruption(cause);
const rowKey = (tableId: CatalogTableId, rowId: AppRowIdHexV1) => `${tableId}/${rowId}`;
const live = (row: AppRowRevisionV1 | null, policy: StrongReferenceActivationProjection["sourceLiveness"]): boolean => {
  if (row?.kind !== "live") return false;
  if (policy.kind === "current") return true;
  return isJsonObject(row.document.valueJson) && row.document.valueJson[policy.field] === null;
};
const fieldValue = (row: AppRowRevisionV1, field: string): unknown =>
  row.kind === "live" && isJsonObject(row.document.valueJson) ? row.document.valueJson[field] : undefined;
const targetValue = (reference: StrongReferenceActivationProjection, rowId: AppRowIdHexV1,
  row: AppRowRevisionV1): unknown => reference.targetIdentity.kind === "documentId"
  ? appDocumentIdV1FromRowIdentity({ tableId: reference.targetTableId, rowId })
  : fieldValue(row, reference.targetField);

/** Runs only after the entire row/index/unique publication prefix is lowered,
 * while the caller holds the ordinary scope-write lock. No adapter input is
 * trusted here: reference definitions came from the active binding. */
export const validateStrongReferenceFinalState = Effect.fn("ScopePublication.validateStrongReferences")(
  function* (tx: FlarexMetadataTransaction, clock: ScopeClockRecord, pendingCommitSeq: CommitSeq,
    references: readonly StrongReferenceActivationProjection[], changes: readonly ChangedRow[]): Effect.fn.Return<void, Failure> {
    const started = yield* Clock.monotonicTimeNanos;
    const cache = new Map<string, AppRowRevisionV1 | null>();
    const validatedTargets = new Set<string>();
    let readBytes = 0;
    let scanned = 0;
    const charge = (bytes: number) => {
      readBytes += bytes;
      return readBytes > MAX_REFERENCE_READ_BYTES ? capacity("readBytes", readBytes) : null;
    };
    const requireTime = Effect.fn("ScopePublication.requireReferenceTime")(function* () {
      const elapsed = ((yield* Clock.monotonicTimeNanos) - started) / 1_000_000n;
      if (elapsed > BigInt(MAX_REFERENCE_SCAN_MILLISECONDS))
        return yield* Effect.fail(capacity("scanMilliseconds", Number(elapsed)));
    });
    const finalRows = Effect.fn("ScopePublication.readFinalReferenceRows")(function* (
      tableId: CatalogTableId, rowIds: readonly AppRowIdHexV1[], changed: boolean,
    ) {
      yield* requireTime();
      const missing = rowIds.filter(rowId => !cache.has(rowKey(tableId, rowId)));
      for (let offset = 0; offset < missing.length; offset += PAGE_ROWS) {
        yield* requireTime();
        const batch = missing.slice(offset, offset + PAGE_ROWS);
        const result = yield* readBoundedPublicationAppRowsInTransactionEffect(tx, {
          scopeId: clock.scopeId, tableId, minimumCommitSeq: clock.lastCommitSeq, pendingCommitSeq,
          maximumIdentities: batch.length, maximumDocumentBytes: 65_536,
          maximumTotalValueBytes: 1_048_576, rowIds: batch,
        }).pipe(Effect.mapError(classify));
        if (result.commitSeq !== clock.lastCommitSeq) return yield* Effect.fail(corruption());
        const found = new Map(result.rows.map(row => [row.rowId, row]));
        for (const rowId of batch) {
          const row = found.get(rowId) ?? null;
          if (row !== null) {
            const excess = charge(row.kind === "live" ? row.document.canonicalBytes.byteLength : 64);
            if (excess !== null) return yield* Effect.fail(excess);
          }
          cache.set(rowKey(tableId, rowId), row);
        }
      }
      const selected = rowIds.map(rowId => cache.get(rowKey(tableId, rowId)) ?? null);
      if (changed && selected.some(row => row === null || row.commitSeq !== pendingCommitSeq))
        return yield* Effect.fail(corruption("changed row has no pending current revision"));
      return selected;
    });
    const requireTarget = Effect.fn("ScopePublication.requireReferenceTarget")(function* (
      reference: StrongReferenceActivationProjection, value: string,
    ) {
      const targetKey = JSON.stringify([reference.name, value]);
      if (validatedTargets.has(targetKey)) return;
      let rowId: AppRowIdHexV1 | null = null;
      if (reference.targetIdentity.kind === "documentId") {
        const identity = decodeAppDocumentIdentityV1Result(value);
        if (Result.isSuccess(identity) && identity.success.tableId === reference.targetTableId)
          rowId = identity.success.rowId;
      } else {
        const key = { sparse: false, localeKey: null,
          values: [orderedIndexValueFromFlarexValueV1(value)] } as const;
        const slot = yield* readAppUniqueKeySlotForPublicationInTransactionEffect(tx, {
          scopeId: clock.scopeId, constraintId: reference.targetIdentity.uniqueConstraintDefinitionId,
          key, pendingCommitSeq,
        }).pipe(Effect.mapError(classify));
        if (Option.isSome(slot)) {
          if (slot.value.tableId !== reference.targetTableId) return yield* Effect.fail(corruption());
          rowId = slot.value.rowId;
        }
      }
      if (rowId === null) return yield* Effect.fail(new ScopePublicationReferenceConstraintError({
        reason: "targetNotLive", reference: reference.name, value,
      }));
      const target = (yield* finalRows(reference.targetTableId, [rowId], false))[0] ?? null;
      if (!live(target, reference.targetLiveness) || target === null ||
        targetValue(reference, rowId, target) !== value)
        return yield* Effect.fail(new ScopePublicationReferenceConstraintError({
          reason: "targetNotLive", reference: reference.name, value,
        }));
      validatedTargets.add(targetKey);
    });
    const coverage = Effect.fn("ScopePublication.requireReferenceIndexCoverage")(function* (
      reference: StrongReferenceActivationProjection,
    ) {
      const indexId = reference.reverseIndex.indexDefinitionId;
      const build = yield* readRequiredEnabledIndexBuildsInTransactionEffect(tx, clock, [indexId], "share")
        .pipe(Effect.mapError(classify));
      if (build.status !== "ready" || build.rows.length !== 1) return yield* Effect.fail(corruption("reference index is not enabled"));
      const buildRow = build.rows[0];
      if (buildRow === undefined) return yield* Effect.fail(corruption("reference index build row is missing"));
      const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(buildRow, clock.scopeId, indexId))
        .pipe(Effect.mapError(cause => corruption(cause)));
      const digest = yield* Effect.fromResult(decodeDigest(reference.reverseIndex.physicalSpecSha256Hex))
        .pipe(Effect.mapError(cause => corruption(cause)));
      if (state.coveredThroughCommitSeq !== pendingCommitSeq) {
        const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock)
          .pipe(Effect.mapError(classify));
        const covered = yield* isIndexBuildSnapshotCoveredInTransactionEffect(tx, state, {
          indexDefinitionId: indexId, tableId: reference.sourceTableId, physicalSpecSha256Hex: digest,
        }, clock.lastCommitSeq, context, pendingCommitSeq).pipe(Effect.mapError(classify));
        if (!covered) return yield* Effect.fail(corruption("reference reverse index is not covered"));
      }
      return state;
    });
    const maintainReverseIndex = Effect.fn("ScopePublication.maintainReferenceIndex")(function* (
      reference: StrongReferenceActivationProjection, sourceIds: readonly AppRowIdHexV1[],
    ) {
      if (sourceIds.length === 0) return;
      const build = yield* coverage(reference);
      if (build.coveredThroughCommitSeq !== pendingCommitSeq && build.coveredThroughCommitSeq === null)
        return yield* Effect.fail(corruption("reference index has no coverage frontier"));
      for (let offset = 0; offset < sourceIds.length; offset += PAGE_ROWS) {
        yield* requireTime();
        const batch = sourceIds.slice(offset, offset + PAGE_ROWS);
        const current = yield* finalRows(reference.sourceTableId, batch, true);
        const actions: AppendPublicationIndexEntryRevisionInput[] = [];
        for (let index = 0; index < batch.length; index++) {
          const rowId = batch[index];
          if (rowId === undefined) return yield* Effect.fail(corruption());
          const previous = yield* readAppRowAtSnapshotInTransactionEffect(tx, {
            scopeId: clock.scopeId, tableId: reference.sourceTableId, rowId,
            snapshotCommitSeq: clock.lastCommitSeq,
          }).pipe(Effect.mapError(classify));
          if (previous.kind === "live") {
            const excess = charge(previous.document.canonicalBytes.byteLength);
            if (excess !== null) return yield* Effect.fail(excess);
          }
          const next = current[index] ?? null;
          const lower = (row: AppRowRevisionV1 | null) => row?.kind === "live"
            ? lowerAppOrderedIndexPhysicalKeyV1(reference.reverseIndex.physicalSpec,
              row.document, row.creationTime) : Result.succeed(null);
          const priorKey = yield* Effect.fromResult(lower(previous.kind === "missing" ? null : previous)
            .pipe(Result.mapError(() => new ScopePublicationReferenceConstraintError({
              reason: "sourceIndexValueInvalid", reference: reference.name, value: rowId,
            }))));
          const finalKey = yield* Effect.fromResult(lower(next).pipe(Result.mapError(() =>
            new ScopePublicationReferenceConstraintError({
              reason: "sourceIndexValueInvalid", reference: reference.name, value: rowId,
            }))));
          const orderedRowId = yield* Effect.fromResult(orderedIndexRowIdHexV1FromBytesResult(
            appRowIdHexV1ToBytes(rowId)).pipe(Result.mapError(cause => corruption(cause))));
          const entries = yield* readCurrentAppIndexEntriesForRowInTransactionEffect(tx, {
            scopeId: clock.scopeId, publicationIndex: reference.reverseIndex, rowId: orderedRowId,
          }).pipe(Effect.mapError(classify));
          if (entries.length > 1) return yield* Effect.fail(corruption("reference index has multiple current keys for one row"));
          const observed = entries[0]?.encodedKey ?? null;
          if (build.maintenance !== null && observed !== finalKey)
            return yield* Effect.fail(corruption("maintained reference index disagrees with final row key"));
          if (observed === finalKey) {
            if (observed !== null && priorKey !== finalKey && entries[0]?.commitSeq !== pendingCommitSeq)
              return yield* Effect.fail(corruption("new reference index key has no pending revision"));
            continue;
          }
          if (observed !== priorKey || (observed === null && priorKey !== null && finalKey !== null))
            return yield* Effect.fail(corruption("reference index disagrees with prior and final row keys"));
          if (priorKey !== null) actions.push({ kind: "tombstone", scopeId: clock.scopeId,
            reference, encodedKey: priorKey, rowId: orderedRowId, writeEpoch: clock.epoch,
            commitSeq: pendingCommitSeq });
          if (finalKey !== null) actions.push({ kind: "live", scopeId: clock.scopeId,
            reference, encodedKey: finalKey, rowId: orderedRowId, writeEpoch: clock.epoch,
            commitSeq: pendingCommitSeq });
        }
        if (actions.length > 0) yield* appendPublicationIndexEntryRevisionsInTransactionEffect(tx, actions)
          .pipe(Effect.mapError(classify));
      }
      // An activated Application index may also serve as the reverse index.
      // Its pending entries were already lowered by the document materializer;
      // the checks above still require those entries to match the final rows.
      if (build.maintenance !== null || build.coveredThroughCommitSeq === pendingCommitSeq) return;
      const baseline = build.coveredThroughCommitSeq;
      if (baseline === null) return yield* Effect.fail(corruption("reference index lost its coverage frontier"));
      const updated = yield* Effect.tryPromise({ try: () => tx.update(fxSystemIndexBuildStates)
        .set({ coveredThroughCommitSeq: pendingCommitSeq, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(fxSystemIndexBuildStates.scopeId, clock.scopeId),
          eq(fxSystemIndexBuildStates.indexDefinitionId, build.indexDefinitionId),
          eq(fxSystemIndexBuildStates.storageGenerationFence, build.storageGenerationFence),
          eq(fxSystemIndexBuildStates.epoch, build.epoch),
          eq(fxSystemIndexBuildStates.attemptFence, build.attemptFence),
          eq(fxSystemIndexBuildStates.coveredThroughCommitSeq, baseline),
          eq(fxSystemIndexBuildStates.lifecycle, "enabled")))
        .returning({ indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId }),
      catch: cause => persistence("readStrongReferenceProjection", cause) });
      if (updated.length !== 1) return yield* Effect.fail(corruption("reference index coverage failed to advance"));
    });
    const requireNoSources = Effect.fn("ScopePublication.requireNoReferenceSources")(function* (
      reference: StrongReferenceActivationProjection, value: string,
    ) {
      yield* coverage(reference);
      const first = reference.reverseIndex.physicalSpec.orderedFields[0];
      if (first?.kind !== "documentPath" || first.path !== reference.sourceField)
        return yield* Effect.fail(corruption("reference reverse index has the wrong first field"));
      const bounds = yield* Effect.try({ try: () => compileAppOrderedIndexBoundsV1({
        spec: reference.reverseIndex.physicalSpec,
        expressions: [{ op: "eq", field: first,
          value: orderedIndexValueForAppFieldV1(first, value) }],
      }), catch: cause => corruption(cause) });
      let after: Parameters<typeof scanCurrentPublicationIndexInTransactionEffect>[1]["after"];
      while (true) {
        yield* requireTime();
        const page = yield* scanCurrentPublicationIndexInTransactionEffect(tx, {
          scopeId: clock.scopeId, publicationIndex: reference.reverseIndex, bounds,
          limit: PAGE_ROWS, ...(after === undefined ? {} : { after }),
        }).pipe(Effect.mapError(classify));
        scanned += page.entries.length;
        if (scanned > MAX_REFERENCE_ROWS) return yield* Effect.fail(capacity("reverseRows", scanned));
        if (page.entries.some(entry => entry.tableId !== reference.sourceTableId))
          return yield* Effect.fail(corruption("reference index points to another table"));
        const sources = yield* finalRows(reference.sourceTableId, page.entries.map(entry => entry.rowId), false);
        for (let index = 0; index < page.entries.length; index++) {
          const source = sources[index] ?? null;
          if (source === null || source.kind !== "live" ||
            fieldValue(source, reference.sourceField) !== value)
            return yield* Effect.fail(corruption("reference index disagrees with its current source"));
          if (live(source, reference.sourceLiveness))
            return yield* Effect.fail(new ScopePublicationReferenceConstraintError({
              reason: "targetDeleteRestricted", reference: reference.name, value,
            }));
        }
        if (page.isDone) return;
        if (page.continueCursor === null) return yield* Effect.fail(corruption("reference index lost its cursor"));
        after = page.continueCursor;
      }
    });
    for (const reference of references) {
      const sourceIds = changes.filter(change => change.tableId === reference.sourceTableId).map(change => change.rowId);
      const targetIds = changes.filter(change => change.tableId === reference.targetTableId).map(change => change.rowId);
      if (sourceIds.length + targetIds.length > MAX_REFERENCE_ROWS)
        return yield* Effect.fail(capacity("changedRows", sourceIds.length + targetIds.length));
      yield* maintainReverseIndex(reference, sourceIds);
      for (let offset = 0; offset < sourceIds.length; offset += PAGE_ROWS) {
        const rows = yield* finalRows(reference.sourceTableId, sourceIds.slice(offset, offset + PAGE_ROWS), true);
        for (const source of rows) {
          if (!live(source, reference.sourceLiveness) || source === null) continue;
          const value = fieldValue(source, reference.sourceField);
          if (value === null || value === undefined) continue;
          if (typeof value !== "string") return yield* Effect.fail(corruption("reference source value is not text"));
          yield* requireTarget(reference, value);
        }
      }
      for (let offset = 0; offset < targetIds.length; offset += PAGE_ROWS) {
        const batch = targetIds.slice(offset, offset + PAGE_ROWS);
        const current = yield* finalRows(reference.targetTableId, batch, true);
        for (let index = 0; index < batch.length; index++) {
          const rowId = batch[index];
          if (rowId === undefined) return yield* Effect.fail(corruption());
          const previous = yield* readAppRowAtSnapshotInTransactionEffect(tx, {
            scopeId: clock.scopeId, tableId: reference.targetTableId, rowId,
            snapshotCommitSeq: clock.lastCommitSeq,
          }).pipe(Effect.mapError(classify));
          if (previous.kind === "live") {
            const excess = charge(previous.document.canonicalBytes.byteLength);
            if (excess !== null) return yield* Effect.fail(excess);
          }
          if (previous.kind !== "live" || !live(previous, reference.targetLiveness)) continue;
          const oldValue = targetValue(reference, rowId, previous);
          if (typeof oldValue !== "string") return yield* Effect.fail(corruption("reference target key is not text"));
          const next = current[index] ?? null;
          if (live(next, reference.targetLiveness) && next !== null &&
            targetValue(reference, rowId, next) === oldValue) continue;
          yield* requireNoSources(reference, oldValue);
        }
      }
    }
  },
);
