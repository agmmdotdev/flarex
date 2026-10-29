import { decodeIndexedQueryOperationResult } from "./operationInput";
import type { makePointOperations } from "./pointOperations";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type { SessionJournalStorePersistence } from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  InvalidSessionJournalInputV1Error,
  SessionJournalTargetUnavailableV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalDeveloperIndexUnavailableV1Error,
} from "./errors";
import type { SessionJournalRunIndexedQueryV1Error } from "./errors";
import type {
  SessionJournalAttemptStateV1,
  PinnedDeveloperIndexStateV1,
} from "./state";
import type { inspectAppDeveloperIndexQueryPortV1 } from "./indexQueryPort";
import { observeExecution } from "../diagnostics/operation";
import type { FiniteStorageCaptureError } from "../finiteStorageCapture";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Cause, Effect, Option, Result, Schema } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_OPERATION_CALLS_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
} from "flarex-protocol/commit-protocol";
import type { LogicalIndexRangeReadDependencyV1 } from "flarex-protocol/commit-protocol";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
} from "flarex-protocol/ordered-index";
import type {
  OrderedIndexBoundsV1,
  OrderedIndexKeyBytesHexV1,
  OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
  SchemaManifestAppIndexDescriptorSchema,
} from "flarex-protocol/schema-manifest";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import {
  consumeCapturedAppRowsAtSnapshotEffect,
  readLiveAppRowsAtSnapshotInTransactionEffect,
} from "../../storage/documents/appRows";
import type {
  AppRowTransaction,
  LiveAppRowRevisionV1,
} from "../../storage/documents/appRows";
import {
  scanAppIndexAtSnapshotInTransactionEffect,
  decodeCapturedAppIndexSnapshotPageEffect,
} from "../../storage/indexes/appIndexEntries";
import type { AppIndexRangeCursorV1, AppIndexRangeEntryV1 } from "../../storage/indexes/appIndexEntries";
import { lowerAppDeveloperIndexKeyV1 } from "../../storage/indexes/appDeveloperIndexCommitV1";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  readFencedIndexBuildStateEffect,
} from "../../storage/indexes/indexBuildStates";
import type { LogicalFiniteStorageCapture } from "../../storage/documents/logicalDocuments/model";
import {
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
} from "../../database/schema";
import {
  ExactRunningAttemptTransactionV1Error,
} from "../session/errors";
import {
  RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1,
} from "../session/kernelContracts";
import type {
  ExactRunningAttemptKernelContextV1,
  FiniteEntryAttemptKernelContext,
} from "../session/kernelContracts";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1,
  isLocatedExactRunningAttemptReadSyscallKernelV1,
} from "../session/kernelContracts";
import {
  decodeCommitFinalSyscallSequenceResult,
  nextCommitSyscallSequence,
  canonicalizeStoredRequestEffect,
  canonicalizeStoredOutcomeEffect,
} from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { captureIndexedQueryRequestResult } from "./inputCapture";
import {
  addFiniteCounters,
  ZERO_COUNTER_DELTAS,
  firstExceededLimit,
  decodeJournalCountersResult,
} from "./operationModel";
import type {
  SessionJournalIncrementalLimitIssueV1,
  AppliedSessionJournalOperationV1,
  SessionJournalCountersV1,
  SessionJournalCounterDeltasV1,
  JournalPointMutationV1,
} from "./operationModel";
import {
  prepareStoredIndexRanges,
  decodeStoredIndexRangeRowsEffect,
  decodePointDependencyResult,
  validateReceiptCardinalityResult,
  decodeAndVerifyLatestReceiptEffect,
  isLimitOutcome,
  validateReceiptOutcomeMatchesJournalRootResult,
  projectIndexedQueryResult,
  decodeLivePointOverlayEvidenceEffect,
} from "./receiptEvidence";
import type { PreparedStoredIndexRangeV1 } from "./receiptEvidence";
import {
  loadLatestReceipt,
  loadReceiptAtSequence,
  persistAcceptedOperationEffect,
} from "./journalPersistence";
import {
  finiteApplicationCapture,
  discardFiniteRootEvidence,
  finitePoint,
  finiteRootState,
  finitePointObservation,
  recordFiniteApplicationDemandMetadataEffect,
  withFiniteApplicationOperation,
} from "./finiteRoot";
import type { FiniteRootAttemptState } from "./finiteRoot";
import { logicalDocumentRootWrittenCount, readLogicalDocumentRootPendingIndex,
  type LogicalDocumentRootPointFailure, type LogicalDocumentRootPendingPosition } from "../../storage/documents/logicalDocuments/rootEvaluator";
import {
  mapDeveloperIndexResolutionFailure,
  mapRunIndexedQueryFailure,
  mapLogicalDocumentRootFailure,
  fromIndexedQueryPromise,
  mapExactRunningIndexedQueryFailure,
  kernelContextMatchesAttempt,
  corruption,
} from "./journalFailures";
import type { SessionJournalStorePersistenceOptionsV1 } from "../sessionJournalStore";
import type { JournalAttemptOwner } from "./attemptOwner";
import type { JournalTargetResolver } from "./targetAdmission";

const decodeDeveloperIndexDescriptorEffect = Schema.decodeUnknownEffect(
  Schema.toType(SchemaManifestAppIndexDescriptorSchema),
);

/**
 * Keep duplicate JSONB/canonical-byte materialization below the attempt-wide
 * read budget while retaining a small, fixed number of set-based reads.
 */
const INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1 = 8;

type IndexedQueryStagedPositionV1 =
  | Readonly<{
      readonly kind: "deleted";
      readonly rowId: OrderedIndexRowIdHexV1;
    }>
  | Readonly<{
      readonly kind: "live";
      readonly rowId: OrderedIndexRowIdHexV1;
      readonly encodedKey: OrderedIndexKeyBytesHexV1;
      readonly document: CanonicalFlarexValueV1;
    }>;

type IndexedQueryMergedPositionV1 =
  | Extract<IndexedQueryStagedPositionV1, { readonly kind: "live" }>
  | Readonly<{
      readonly kind: "snapshot";
      readonly rowId: OrderedIndexRowIdHexV1;
      readonly encodedKey: OrderedIndexKeyBytesHexV1;
      readonly entry: AppIndexRangeEntryV1;
    }>;

/** Evaluate an indexed Application page against one root-wide point overlay.
 * Physical index facts remain snapshot facts; the final seal persists the
 * normalized negative/range evidence together with the root's writes. */
const runFiniteIndexedQueryEffect = Effect.fnUntraced(
  function* (
    capture: LogicalFiniteStorageCapture<FiniteStorageCaptureError>,
    context: FiniteEntryAttemptKernelContext,
    index: PinnedDeveloperIndexStateV1,
    request: Extract<
      SessionJournalStoredRequest,
      { readonly kind: "indexRange" }
    >,
    requestEvidence: CanonicalFlarexValueV1,
    finite: FiniteRootAttemptState,
  ): Effect.fn.Return<
    AppliedSessionJournalOperationV1,
    SessionJournalRunIndexedQueryV1Error
  > {
    return yield* Effect.gen(function* () {
      if (
        !kernelContextMatchesAttempt(context, index.attempt) ||
        context.anchor.executionProfile !== "finiteRoot"
      )
        return yield* Effect.fail(
          corruption(index.attempt, "exactAttemptPinsChanged"),
        );
      if (
        request.tableId !== index.tableId ||
        request.logicalIndexId !== index.logicalIndexId ||
        request.indexDefinitionId !== index.definition.indexDefinitionId
      )
        return yield* Effect.fail(
          corruption(index.attempt, "requestTableCapabilityMismatch"),
        );
      if (finite.status !== "open")
        return Object.freeze({
          kind: "stateRejected",
          reason: "journalFailed",
        });
      const previous = finite.receipts.get(request.syscallSequence);
      if (previous !== undefined) {
        if (
          previous.kind !== "index" ||
          !bytesEqual(previous.requestEvidence.sha256, requestEvidence.sha256)
        )
          return Object.freeze({
            kind: "sequenceRejected",
            issue: Object.freeze({
              reason: "requestMismatch",
              syscallSequence: request.syscallSequence,
            }),
          });
        return Object.freeze({
          kind: "outcome",
          delivery: "replayed",
          outcome: structuredClone(previous.outcome),
        });
      }
      if (request.syscallSequence !== finite.lastSequence + 1n)
        return Object.freeze({
          kind: "sequenceRejected",
          issue: Object.freeze({
            reason: "sequenceGap",
            actual: request.syscallSequence,
            expectedNext: CommitSyscallSequenceV1Schema.make(
              finite.lastSequence + 1n,
            ),
          }),
        });
      if (finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1))
        return Object.freeze({
          kind: "sequenceRejected",
          issue: Object.freeze({
            reason: "sequenceExhausted",
            lastAccepted: CommitFinalSyscallSequenceV1Schema.make(
              finite.lastSequence,
            ),
          }),
        });
      const root = finiteRootState(finite);
      if (root === null) return yield* Effect.fail(corruption(index.attempt, "pointDependencyCountMismatch"));
      const rootFailure = (cause: LogicalDocumentRootPointFailure) =>
        mapLogicalDocumentRootFailure(index.attempt, "pointDependencyCountMismatch", cause);
      const writtenCount = yield* Effect.fromResult(logicalDocumentRootWrittenCount(root, index.tableId).pipe(
        Result.mapError(rootFailure),
      ));
      if (writtenCount > MAX_POINT_COMMIT_MATERIAL_ROWS_V1)
        return yield* Effect.fail(corruption(index.attempt, "pointDependencyCountMismatch"));
      const bounds: OrderedIndexBoundsV1 = Object.freeze({
        ...(request.startInclusive === null
          ? {}
          : { startInclusive: request.startInclusive }),
        ...(request.endExclusive === null
          ? {}
          : { endExclusive: request.endExclusive }),
      });
      const pendingIndex = yield* Effect.fromResult(readLogicalDocumentRootPendingIndex<SessionJournalRunIndexedQueryV1Error>(root, index.definition, {
        order: "application", bounds, limit: request.limit + 1, error: rootFailure,
        lower: row => row.current === null ? Result.succeed(null)
          : lowerAppDeveloperIndexKeyV1(index.definition, row.current, row.creationTime),
        charge: () => Result.succeed(undefined),
      }));
      const membership = yield* capture(
        {
          kind: "indexPage",
          tableId: index.tableId,
          input: {
            scopeId: index.attempt.selector.scopeId,
            definition: index.definition,
            bounds,
            limit: request.limit + writtenCount,
            snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
          },
        },
        {
          kind: "index",
          tableId: index.tableId,
          indexDefinitionId: index.definition.indexDefinitionId,
        },
      ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapRunIndexedQueryFailure))));
      const snapshotPage = yield* decodeCapturedAppIndexSnapshotPageEffect(
        membership.prepared,
        membership.rawRows,
      ).pipe(Effect.mapError(mapRunIndexedQueryFailure));
      const merged: IndexedQueryMergedPositionV1[] = [];
      let pendingOffset = 0;
      let pendingPosition = pendingIndex.positions[pendingOffset];
      const appendPending = (position: LogicalDocumentRootPendingPosition) => {
        merged.push(Object.freeze({ kind: "live", rowId: position.rowId, encodedKey: position.encodedKey, document: position.document }));
      };
      for (const entry of snapshotPage.entries) {
        if (pendingIndex.hasWritten(entry.rowId)) continue;
        const position = Object.freeze({ kind: "snapshot" as const, rowId: entry.rowId, encodedKey: entry.encodedKey, entry });
        while (pendingPosition !== undefined && compareIndexedQueryMergedPositions(pendingPosition, position) <= 0) {
          appendPending(pendingPosition);
          pendingPosition = pendingIndex.positions[++pendingOffset];
        }
        merged.push(position);
      }
      while (pendingPosition !== undefined) {
        appendPending(pendingPosition);
        pendingPosition = pendingIndex.positions[++pendingOffset];
      }
      const page = Object.freeze(merged.slice(0, request.limit));
      const isDone = snapshotPage.isDone && merged.length <= request.limit;
      const snapshotLookahead = snapshotPage.lookahead;
      const lookahead = snapshotLookahead !== null && !pendingIndex.hasWritten(snapshotLookahead.rowId)
        ? snapshotLookahead : null;
      const documents: CanonicalFlarexValueV1[] = [];
      const newPoints: JournalPointMutationV1[] = [];
      const newPointReads = new Map<string, LiveAppRowRevisionV1>();
      let readSemanticBytes = 0;
      const documentLimitIssue = firstExceededLimit(finite.counters, {
        ...ZERO_COUNTER_DELTAS,
        readDocuments: page.length,
      });
      const limitOutcome = (
        issue: SessionJournalIncrementalLimitIssueV1,
      ): AppliedSessionJournalOperationV1 => {
        finite.status = "aborted";
        return Object.freeze({
          kind: "outcome",
          delivery: "executed",
          outcome: Object.freeze({
            kind: "error",
            reason: "limitExceeded",
            ...issue,
          }),
        });
      };
      if (documentLimitIssue !== undefined)
        return limitOutcome(documentLimitIssue);
      type MaterializationLimit = Readonly<{
        _tag: "FiniteIndexedReadLimit";
        issue: SessionJournalIncrementalLimitIssueV1;
      }>;
      const consumePosition = Effect.fnUntraced(
        function* (
          position: IndexedQueryMergedPositionV1,
          revision?: LiveAppRowRevisionV1,
        ): Effect.fn.Return<
          void,
          SessionJournalRunIndexedQueryV1Error | MaterializationLimit
        > {
          const document =
            position.kind === "live" ? position.document : revision?.document;
          if (document === undefined)
            return yield* Effect.fail(
              corruption(index.attempt, "indexedSnapshotPositionMismatch"),
            );
          if (revision !== undefined) {
            const lowered = yield* Effect.fromResult(
              lowerAppDeveloperIndexKeyV1(
                index.definition,
                revision.document,
                revision.creationTime,
              ),
            );
            if (
              position.kind !== "snapshot" ||
              position.entry.tableId !== index.tableId ||
              position.entry.rowId !== revision.rowId ||
              lowered !== position.entry.encodedKey
            )
              return yield* Effect.fail(
                corruption(index.attempt, "indexedSnapshotPositionMismatch"),
              );
          }
          const nextReadSemanticBytes =
            readSemanticBytes + document.semanticSizeBytes;
          const issue = firstExceededLimit(finite.counters, {
            ...ZERO_COUNTER_DELTAS,
            readSemanticBytes: nextReadSemanticBytes,
          });
          if (issue !== undefined)
            return yield* Effect.fail(
              Object.freeze({ _tag: "FiniteIndexedReadLimit", issue } as const),
            );
          if (revision !== undefined) {
            const key = `${index.tableId}/${revision.rowId}`;
            const existing = finitePoint(finite, index.tableId, revision.rowId);
            if (
              existing !== undefined &&
              (existing.dependency.kind !== "present" ||
                existing.dependency.revisionCommitSeq !== revision.commitSeq ||
                existing.overlay.kind !== "none")
            )
              return yield* Effect.fail(
                corruption(index.attempt, "pointDependencyChangedAtSnapshot"),
              );
            if (existing === undefined) {
              const dependency = Object.freeze({
                kind: "present" as const,
                identity: Object.freeze({
                  scopeId: index.attempt.selector.scopeId,
                  tableId: index.tableId,
                  rowId: revision.rowId,
                }),
                revisionCommitSeq: revision.commitSeq,
              });
              newPoints.push(
                Object.freeze({
                  mode: "insert",
                  tableId: index.tableId,
                  rowId: revision.rowId,
                  dependency,
                  overlay: Object.freeze({ kind: "none" }),
                }),
              );
              newPointReads.set(key, revision);
            }
          }
          documents.push(document);
          readSemanticBytes = nextReadSemanticBytes;
        },
        (work) =>
          observeExecution(
            "SessionJournalStore.consumeFiniteIndexedPosition",
            work,
          ),
      );
      return yield* Effect.gen(function* () {
        yield* Effect.gen(function* () {
          for (
            let offset = 0;
            offset < page.length;
            offset += INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1
          ) {
            const batch = page.slice(
              offset,
              offset + INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1,
            );
            const snapshotEntries = batch.flatMap((position) =>
              position.kind === "snapshot" ? [position.entry] : [],
            );
            let positionOffset = 0;
            let snapshotOffset = 0;
            while (batch[positionOffset]?.kind === "live") {
              yield* consumePosition(batch[positionOffset]!);
              positionOffset++;
            }
            while (snapshotOffset < snapshotEntries.length) {
              const remaining = snapshotEntries.slice(snapshotOffset);
              const captured = yield* capture(
                {
                  kind: "rows",
                  settlementWindow: true,
                  input: {
                    scopeId: index.attempt.selector.scopeId,
                    tableId: index.tableId,
                    rowIds: Object.freeze(
                      remaining.map((entry) => entry.rowId),
                    ),
                    snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
                  },
                },
                { kind: "rows", tableId: index.tableId },
              ).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapRunIndexedQueryFailure))));
              const consumed = yield* consumeCapturedAppRowsAtSnapshotEffect<
                SessionJournalRunIndexedQueryV1Error | MaterializationLimit,
                never
              >(
                captured.prepared,
                captured.rawRows,
                mapRunIndexedQueryFailure,
                (_rowId, revision) =>
                  Effect.gen(function* () {
                    const position = batch[positionOffset];
                    if (position === undefined || revision.kind !== "live")
                      return yield* Effect.fail(
                        corruption(
                          index.attempt,
                          "indexedSnapshotPositionMismatch",
                        ),
                      );
                    yield* consumePosition(position, revision);
                    positionOffset++;
                    while (batch[positionOffset]?.kind === "live") {
                      yield* consumePosition(batch[positionOffset]!);
                      positionOffset++;
                    }
                  }),
                true,
              );
              if (consumed === 0)
                return yield* Effect.fail(
                  corruption(index.attempt, "indexedSnapshotPositionMismatch"),
                );
              snapshotOffset += consumed;
            }
            for (; positionOffset < batch.length; positionOffset++)
              yield* consumePosition(batch[positionOffset]!);
          }
        });
        const dependency = indexRangeDependencyFromPage(
          index,
          request,
          merged,
          isDone,
          lookahead,
        );
        const ranges = yield* Effect.fromResult(
          normalizeLogicalIndexRangeReadDependenciesV1Result([
            ...finite.indexRanges,
            dependency,
          ]).pipe(
            Result.mapError((cause) =>
              corruption(index.attempt, "indexRangeDependencyInvalid", cause),
            ),
          ),
        );
        const evidenceBytes = prepareStoredIndexRanges(ranges).reduce(
          (sum, entry) => sum + entry.evidenceBytes,
          0,
        );
        const priorEvidenceBytes = prepareStoredIndexRanges(
          finite.indexRanges,
        ).reduce((sum, entry) => sum + entry.evidenceBytes, 0);
        const outcome = Object.freeze({
          kind: "indexRangePage",
          documentsValueJson: Object.freeze(
            documents.map((document) => structuredClone(document.valueJson)),
          ),
          isDone,
        } satisfies SessionJournalStoredOutcome);
        const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(
          outcome,
        ).pipe(Effect.mapError(mapRunIndexedQueryFailure));
        const deltas = Object.freeze({
          ...ZERO_COUNTER_DELTAS,
          readDocuments: documents.length,
          readSemanticBytes,
          pointDependencyCount: newPoints.length,
          indexedQuerySyscalls: 1,
          indexRangeDependencyCount: ranges.length - finite.indexRanges.length,
          indexRangeDependencyEvidenceBytes: evidenceBytes - priorEvidenceBytes,
          receiptEvidenceBytes:
            requestEvidence.canonicalBytes.byteLength +
            outcomeEvidence.canonicalBytes.byteLength,
        } satisfies SessionJournalCounterDeltasV1);
        const issue = firstExceededLimit(finite.counters, deltas);
        if (issue !== undefined) {
          finite.status = "aborted";
          return Object.freeze({
            kind: "outcome",
            delivery: "executed",
            outcome: Object.freeze({
              kind: "error",
              reason: "limitExceeded",
              ...issue,
            }),
          });
        }
        if (finite.status !== "open")
          return Object.freeze({
            kind: "stateRejected",
            reason: "journalFailed",
          });
        for (const point of newPoints) {
          const read = newPointReads.get(`${point.tableId}/${point.rowId}`);
          if (read === undefined)
            return yield* Effect.fail(
              corruption(index.attempt, "indexedSnapshotPositionMismatch"),
            );
          yield* Effect.fromResult(
            finite.evaluator
              .observePoint(
                index.tableName,
                finitePointObservation(finite, point),
                read,
              )
              .pipe(
                Result.mapError((cause) =>
                  mapLogicalDocumentRootFailure(
                    index.attempt,
                    "pointDependencyChangedAtSnapshot",
                    cause,
                  ),
                ),
              ),
          );
        }
        finite.indexRanges = [...ranges];
        finite.counters = addFiniteCounters(finite.counters, deltas);
        finite.receipts.set(
          request.syscallSequence,
          Object.freeze({
            kind: "index",
            request,
            requestEvidence,
            outcome,
            outcomeEvidence,
          }),
        );
        finite.lastSequence = request.syscallSequence;
        return Object.freeze({
          kind: "outcome",
          delivery: "executed",
          outcome: structuredClone(outcome),
        });
      }).pipe(
        Effect.catchTag("FiniteIndexedReadLimit", (failure) =>
          Effect.succeed(limitOutcome(failure.issue)),
        ),
      );
    });
  },
  (work) => observeExecution("SessionJournalStore.runFiniteIndexedQuery", work),
);

const runIndexedQueryInTransactionEffect = Effect.fn(
  "SessionJournalStore.runIndexedQueryInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  index: PinnedDeveloperIndexStateV1,
  request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "indexRange";
    }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunIndexedQueryV1Error
> {
  if (!kernelContextMatchesAttempt(context, index.attempt)) {
    return yield* Effect.fail(
      corruption(index.attempt, "exactAttemptPinsChanged"),
    );
  }
  if (
    request.tableId !== index.tableId ||
    request.logicalIndexId !== index.logicalIndexId ||
    request.indexDefinitionId !== index.definition.indexDefinitionId
  ) {
    return yield* Effect.fail(
      corruption(index.attempt, "requestTableCapabilityMismatch"),
    );
  }
  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(index.attempt, root),
  );
  const receipt = yield* fromIndexedQueryPromise(() =>
    loadLatestReceipt(tx, context),
  );
  yield* Effect.fromResult(
    validateReceiptCardinalityResult(
      index.attempt,
      root.lastSyscallSequence,
      receipt,
    ),
  );
  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunIndexedQueryFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalSealed" });
  }
  if (actual < last) {
    const prior = yield* fromIndexedQueryPromise(() =>
      loadReceiptAtSequence(tx, context, actual),
    );
    if (prior === undefined) {
      return yield* Effect.fail(
        corruption(index.attempt, "latestReceiptMissing"),
      );
    }
    if (!bytesEqual(prior.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      prior,
      request,
    );
    if (replayed.kind !== "indexRangePage" && !isLimitOutcome(replayed)) {
      return yield* Effect.fail(
        corruption(index.attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(
        corruption(index.attempt, "latestReceiptMissing"),
      );
    }
    if (!bytesEqual(receipt.requestBytes, requestEvidence.canonicalBytes)) {
      return Object.freeze({
        kind: "sequenceRejected",
        issue: Object.freeze({
          reason: "requestMismatch",
          syscallSequence: actual,
        }),
      });
    }
    if (!bytesEqual(receipt.requestSha256, requestEvidence.sha256)) {
      return yield* Effect.fail(
        corruption(index.attempt, "latestReceiptRequestDigestMismatch"),
      );
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      receipt,
      request,
    );
    if (replayed.kind !== "indexRangePage" && !isLimitOutcome(replayed)) {
      return yield* Effect.fail(
        corruption(index.attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(
        index.attempt,
        root,
        replayed,
      ),
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  const nextSequence = nextCommitSyscallSequence(last);
  if (Option.isNone(nextSequence)) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({ reason: "sequenceExhausted", lastAccepted: last }),
    });
  }
  const expectedNext = nextSequence.value;
  if (actual !== expectedNext) {
    return Object.freeze({
      kind: "sequenceRejected",
      issue: Object.freeze({
        reason: "sequenceGap",
        actual,
        expectedNext,
      }),
    });
  }
  if (root.state === "relation_conflicted") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalRelationConflicted",
    });
  }
  if (root.state === "operation_failed") {
    return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
  }
  if (root.state === "failed") {
    if (receipt === undefined) {
      return yield* Effect.fail(
        corruption(index.attempt, "failedJournalEvidenceInvalid"),
      );
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      index.attempt,
      receipt,
      undefined,
    );
    if (!isLimitOutcome(sticky)) {
      return yield* Effect.fail(
        corruption(index.attempt, "failedJournalReceiptInvalid"),
      );
    }
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(
        index.attempt,
        root,
        sticky,
      ),
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "sticky",
      outcome: sticky,
    });
  }
  if (root.state !== "open") {
    return yield* Effect.fail(corruption(index.attempt, "journalStateInvalid"));
  }
  const currentRanges = yield* loadIndexRangeDependenciesForUpdateEffect(
    tx,
    context,
    index.attempt,
  );
  const currentPreparedRanges = prepareStoredIndexRanges(currentRanges);
  if (currentRanges.length !== counters.indexRangeDependencyCount) {
    return yield* Effect.fail(
      corruption(index.attempt, "indexRangeDependencyCountMismatch"),
    );
  }
  const currentRangeEvidenceBytes = currentPreparedRanges.reduce(
    (total, range) => total + range.evidenceBytes,
    0,
  );
  if (
    currentRangeEvidenceBytes !== counters.indexRangeDependencyEvidenceBytes
  ) {
    return yield* Effect.fail(
      corruption(index.attempt, "indexRangeDependencyEvidenceBytesMismatch"),
    );
  }
  if (counters.indexedQuerySyscalls >= MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1) {
    const outcome = Object.freeze({
      kind: "error",
      reason: "limitExceeded",
      dimension: "indexedQuerySyscalls",
      observed: counters.indexedQuerySyscalls + 1,
      maximum: MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
    } satisfies SessionJournalStoredOutcome);
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      ZERO_COUNTER_DELTAS,
      { state: "failed", failureDimension: "indexedQuerySyscalls" },
      mapRunIndexedQueryFailure,
    );
    return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
  }

  const stagedRows = yield* fromIndexedQueryPromise(() =>
    tx
      .select()
      .from(fxSystemTransactionJournalPoints)
      .where(
        and(
          eq(fxSystemTransactionJournalPoints.scopeUuid, context.scopeUuid),
          eq(
            fxSystemTransactionJournalPoints.sessionId,
            context.anchor.sessionId,
          ),
          eq(
            fxSystemTransactionJournalPoints.attemptFence,
            context.anchor.attemptFence,
          ),
          eq(fxSystemTransactionJournalPoints.tableId, index.tableId),
          ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
        ),
      )
      .orderBy(asc(fxSystemTransactionJournalPoints.rowId))
      .limit(MAX_POINT_COMMIT_MATERIAL_ROWS_V1 + 1)
      .for("update"),
  );
  if (stagedRows.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
    return yield* Effect.fail(
      corruption(index.attempt, "pointDependencyCountMismatch"),
    );
  }

  const build = yield* readFencedIndexBuildStateEffect(tx, {
    scopeId: index.attempt.selector.scopeId,
    indexDefinitionId: index.definition.indexDefinitionId,
  });
  if (
    build.status !== "current" ||
    !(yield* isIndexBuildSnapshotCoveredInTransactionEffect(
      tx,
      build.buildState,
      { ...index.definition, tableId: index.tableId },
      index.attempt.snapshotToken.commitSeq,
      yield* readIndexCoverageContextInTransactionEffect(
        tx,
        context.scopeClock,
      ).pipe(
        Effect.catchCause(fullCause => Effect.failCause(Cause.map(fullCause, cause =>
          cause.reason === "resourceFailure"
            ? new SessionJournalPersistenceV1Error({
                operation: "runIndexedQuery",
                cause,
              })
            : corruption(index.attempt, "indexMaintenanceInvalid", cause),
        ))),
      ),
    ).pipe(
      Effect.catchTag("IndexMaintenanceError", (cause) =>
        Effect.fail(
          cause.reason === "resourceFailure"
            ? new SessionJournalPersistenceV1Error({
                operation: "runIndexedQuery",
                cause,
              })
            : corruption(index.attempt, "indexMaintenanceInvalid", cause),
        ),
      ),
    ))
  ) {
    return yield* Effect.fail(
      new SessionJournalDeveloperIndexUnavailableV1Error({
        reason: "buildNotEnabled",
      }),
    );
  }
  const bounds: OrderedIndexBoundsV1 = Object.freeze({
    ...(request.startInclusive === null
      ? {}
      : { startInclusive: request.startInclusive }),
    ...(request.endExclusive === null
      ? {}
      : { endExclusive: request.endExclusive }),
  });
  const stagedByRowId = new Map<
    OrderedIndexRowIdHexV1,
    IndexedQueryStagedPositionV1
  >();
  for (const stagedRow of stagedRows) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(stagedRow.rowId).pipe(
        Result.mapError((cause) =>
          corruption(index.attempt, "pointDependencyCountMismatch", cause),
        ),
      ),
    );
    yield* Effect.fromResult(
      decodePointDependencyResult(index.attempt, stagedRow),
    );
    if (stagedRow.overlayKind === "deleted") {
      stagedByRowId.set(rowId, Object.freeze({ kind: "deleted", rowId }));
      continue;
    }
    if (stagedRow.overlayKind !== "live") {
      return yield* Effect.fail(
        corruption(index.attempt, "liveOverlayEvidenceMissing"),
      );
    }
    const document = yield* decodeLivePointOverlayEvidenceEffect(
      index.attempt,
      stagedRow,
    );
    const creationTime = stagedRow.overlayCreationTime;
    if (creationTime === null) {
      return yield* Effect.fail(
        corruption(index.attempt, "liveOverlayEvidenceMissing"),
      );
    }
    const encodedKey = yield* Effect.fromResult(
      lowerAppDeveloperIndexKeyV1(index.definition, document, creationTime),
    );
    if (encodedKey === null) {
      // Remove the old index position when a live overlay leaves its predicate.
      stagedByRowId.set(rowId, Object.freeze({ kind: "deleted", rowId }));
      continue;
    }
    stagedByRowId.set(
      rowId,
      Object.freeze({
        kind: "live",
        rowId,
        encodedKey,
        document,
      }),
    );
  }

  const snapshotPage = yield* scanAppIndexAtSnapshotInTransactionEffect(tx, {
    scopeId: index.attempt.selector.scopeId,
    definition: index.definition,
    bounds,
    limit: request.limit + stagedRows.length,
    snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
  });
  const mergedPositions: IndexedQueryMergedPositionV1[] = [];
  for (const entry of snapshotPage.entries) {
    if (!stagedByRowId.has(entry.rowId)) {
      mergedPositions.push(
        Object.freeze({
          kind: "snapshot",
          rowId: entry.rowId,
          encodedKey: entry.encodedKey,
          entry,
        }),
      );
    }
  }
  for (const staged of stagedByRowId.values()) {
    if (
      staged.kind === "live" &&
      encodedIndexKeyIsWithinBounds(staged.encodedKey, request)
    ) {
      mergedPositions.push(staged);
    }
  }
  mergedPositions.sort(compareIndexedQueryMergedPositions);
  const pagePositions = Object.freeze(mergedPositions.slice(0, request.limit));
  const pageIsDone =
    snapshotPage.isDone && mergedPositions.length <= request.limit;
  const snapshotLookahead = snapshotPage.lookahead;
  const lookahead = snapshotLookahead !== null && !stagedByRowId.has(snapshotLookahead.rowId)
    ? snapshotLookahead : null;
  const readDocumentLimitIssue = firstExceededLimit(counters, {
    ...ZERO_COUNTER_DELTAS,
    readDocuments: pagePositions.length,
  });
  if (readDocumentLimitIssue !== undefined) {
    return yield* persistIndexedQueryLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      readDocumentLimitIssue,
    );
  }
  const resultDocuments: CanonicalFlarexValueV1[] = [];
  const snapshotResultEntries: AppIndexRangeEntryV1[] = [];
  const snapshotResultRevisions: LiveAppRowRevisionV1[] = [];
  let readSemanticBytes = 0;
  for (
    let batchStart = 0;
    batchStart < pagePositions.length;
    batchStart += INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1
  ) {
    const batchPositions = pagePositions.slice(
      batchStart,
      batchStart + INDEXED_QUERY_DOCUMENT_MATERIALIZATION_BATCH_SIZE_V1,
    );
    const batchSnapshotEntries = batchPositions.flatMap((position) =>
      position.kind === "snapshot" ? [position.entry] : [],
    );
    const batchSnapshotRevisions =
      batchSnapshotEntries.length === 0
        ? []
        : yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
            scopeId: index.attempt.selector.scopeId,
            tableId: index.tableId,
            rowIds: Object.freeze(
              batchSnapshotEntries.map((entry) => entry.rowId),
            ),
            snapshotCommitSeq: index.attempt.snapshotToken.commitSeq,
          });
    let snapshotOffset = 0;
    for (const position of batchPositions) {
      const document =
        position.kind === "live"
          ? position.document
          : batchSnapshotRevisions[snapshotOffset]?.document;
      if (document === undefined) {
        return yield* Effect.fail(
          corruption(index.attempt, "indexedSnapshotPositionMismatch"),
        );
      }
      if (position.kind === "snapshot") {
        const entry = position.entry;
        const revision = batchSnapshotRevisions[snapshotOffset]!;
        snapshotOffset += 1;
        const lowered = yield* Effect.fromResult(
          lowerAppDeveloperIndexKeyV1(
            index.definition,
            revision.document,
            revision.creationTime,
          ),
        );
        if (
          entry.tableId !== index.tableId ||
          lowered !== entry.encodedKey ||
          revision.rowId !== entry.rowId
        ) {
          return yield* Effect.fail(
            corruption(index.attempt, "indexedSnapshotPositionMismatch"),
          );
        }
        snapshotResultEntries.push(entry);
        snapshotResultRevisions.push(revision);
      }
      const nextReadSemanticBytes =
        readSemanticBytes + document.semanticSizeBytes;
      const readSemanticLimitIssue = firstExceededLimit(counters, {
        ...ZERO_COUNTER_DELTAS,
        readSemanticBytes: nextReadSemanticBytes,
      });
      if (readSemanticLimitIssue !== undefined) {
        return yield* persistIndexedQueryLimitOutcomeEffect(
          tx,
          context,
          request,
          requestEvidence,
          counters,
          readSemanticLimitIssue,
        );
      }
      resultDocuments.push(document);
      readSemanticBytes = nextReadSemanticBytes;
    }
  }

  const pointRows =
    snapshotResultEntries.length === 0
      ? []
      : yield* fromIndexedQueryPromise(() =>
          tx
            .select()
            .from(fxSystemTransactionJournalPoints)
            .where(
              and(
                eq(
                  fxSystemTransactionJournalPoints.scopeUuid,
                  context.scopeUuid,
                ),
                eq(
                  fxSystemTransactionJournalPoints.sessionId,
                  context.anchor.sessionId,
                ),
                eq(
                  fxSystemTransactionJournalPoints.attemptFence,
                  context.anchor.attemptFence,
                ),
                eq(fxSystemTransactionJournalPoints.tableId, index.tableId),
                inArray(
                  fxSystemTransactionJournalPoints.rowId,
                  snapshotResultEntries.map((entry) =>
                    orderedIndexRowIdHexV1ToBytes(entry.rowId),
                  ),
                ),
              ),
            )
            .for("update"),
        );
  const existingByRowId = new Map<
    OrderedIndexRowIdHexV1,
    typeof fxSystemTransactionJournalPoints.$inferSelect
  >();
  for (const row of pointRows) {
    const rowId = yield* Effect.fromResult(
      orderedIndexRowIdHexV1FromBytesResult(row.rowId).pipe(
        Result.mapError((cause) =>
          corruption(index.attempt, "pointDependencyCountMismatch", cause),
        ),
      ),
    );
    existingByRowId.set(rowId, row);
  }
  const newPointRows: Array<
    typeof fxSystemTransactionJournalPoints.$inferInsert
  > = [];
  for (const revision of snapshotResultRevisions) {
    const existing = existingByRowId.get(revision.rowId);
    if (existing !== undefined) {
      const dependency = yield* Effect.fromResult(
        decodePointDependencyResult(index.attempt, existing),
      );
      if (
        dependency.kind !== "present" ||
        dependency.revisionCommitSeq !== revision.commitSeq ||
        existing.overlayKind !== "none"
      ) {
        return yield* Effect.fail(
          corruption(index.attempt, "pointDependencyChangedAtSnapshot"),
        );
      }
      continue;
    }
    newPointRows.push({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      tableId: index.tableId,
      rowId: orderedIndexRowIdHexV1ToBytes(revision.rowId),
      dependencyKind: "present",
      dependencyRevisionCommitSeq: revision.commitSeq,
      overlayKind: "none",
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    });
  }

  const dependency = indexRangeDependencyFromPage(
    index,
    request,
    mergedPositions,
    pageIsDone,
    lookahead,
  );
  const nextRanges = yield* Effect.fromResult(
    normalizeLogicalIndexRangeReadDependenciesV1Result([
      ...currentRanges,
      dependency,
    ]).pipe(
      Result.mapError((cause) =>
        corruption(index.attempt, "indexRangeDependencyInvalid", cause),
      ),
    ),
  );
  const preparedRanges = prepareStoredIndexRanges(nextRanges);
  const evidenceBytes = preparedRanges.reduce(
    (total, range) => total + range.evidenceBytes,
    0,
  );
  const outcome = Object.freeze({
    kind: "indexRangePage",
    documentsValueJson: Object.freeze(
      resultDocuments.map((document) => structuredClone(document.valueJson)),
    ),
    isDone: pageIsDone,
  } satisfies SessionJournalStoredOutcome);
  const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(outcome).pipe(
    Effect.mapError(mapRunIndexedQueryFailure),
  );
  const deltas = Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    readDocuments: resultDocuments.length,
    readSemanticBytes,
    pointDependencyCount: newPointRows.length,
    indexedQuerySyscalls: 1,
    indexRangeDependencyCount:
      nextRanges.length - counters.indexRangeDependencyCount,
    indexRangeDependencyEvidenceBytes:
      evidenceBytes - counters.indexRangeDependencyEvidenceBytes,
    receiptEvidenceBytes:
      requestEvidence.canonicalBytes.byteLength +
      outcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limitIssue = firstExceededLimit(counters, deltas);
  if (limitIssue !== undefined) {
    return yield* persistIndexedQueryLimitOutcomeEffect(
      tx,
      context,
      request,
      requestEvidence,
      counters,
      limitIssue,
    );
  }
  yield* Effect.gen(function* () {
    if (newPointRows.length > 0) {
      yield* runDrizzleStatementEffect(
        tx.insert(fxSystemTransactionJournalPoints).values(newPointRows),
        mapRunIndexedQueryFailure,
      );
    }
    yield* replaceStoredIndexRangesEffect(tx, context, preparedRanges);
    yield* Effect.tryPromise({
      try: async () => faultAfter?.("indexedQueryEvidenceWritten"),
      catch: mapRunIndexedQueryFailure,
    });
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      deltas,
      { state: "open", failureDimension: null },
      mapRunIndexedQueryFailure,
    );
  });
  return Object.freeze({ kind: "outcome", delivery: "executed", outcome });
});

function indexRangeDependencyFromPage(
  index: PinnedDeveloperIndexStateV1,
  request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "indexRange";
    }
  >,
  mergedPositions: readonly AppIndexRangeCursorV1[],
  isDone: boolean,
  lookahead: AppIndexRangeCursorV1 | null,
): LogicalIndexRangeReadDependencyV1 {
  // N+S compensation keeps the raw membership lookahead beyond every returned
  // document. Compare it only with the merged N+1 evidence position, never
  // materialize or charge its body.
  const mergedLookahead = mergedPositions[request.limit];
  const frontier = lookahead !== null && (mergedLookahead === undefined ||
      compareIndexedQueryMergedPositions(lookahead, mergedLookahead) < 0)
    ? lookahead : mergedLookahead;
  let upper: LogicalIndexRangeReadDependencyV1["upper"];
  if (isDone) {
    upper = request.endExclusive === null
      ? null
      : Object.freeze({ kind: "key", encodedKey: request.endExclusive, inclusive: false });
  } else {
    if (frontier === undefined) {
      // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - N+S compensation and retained N-plus-one membership require an extra position for every non-final page
      throw new Error("A non-final indexed page must retain its extra evidence position.");
    }
    upper = Object.freeze({ kind: "position", encodedKey: frontier.encodedKey,
      rowId: frontier.rowId, inclusive: true });
  }
  return Object.freeze({
    kind: "appIndexRange",
    tableId: index.tableId,
    indexDefinitionId: index.definition.indexDefinitionId,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    physicalSpecSha256Hex: index.definition.physicalSpecSha256Hex,
    direction: "asc",
    lower:
      request.startInclusive === null
        ? null
        : Object.freeze({
            kind: "key",
            encodedKey: request.startInclusive,
            inclusive: true,
          }),
    upper,
  });
}

function encodedIndexKeyIsWithinBounds(
  encodedKey: OrderedIndexKeyBytesHexV1,
  request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "indexRange";
    }
  >,
): boolean {
  return (
    (request.startInclusive === null ||
      compareUtf16Strings(encodedKey, request.startInclusive) >= 0) &&
    (request.endExclusive === null ||
      compareUtf16Strings(encodedKey, request.endExclusive) < 0)
  );
}

function compareIndexedQueryMergedPositions(
  left: AppIndexRangeCursorV1,
  right: AppIndexRangeCursorV1,
): number {
  const keyOrder = compareUtf16Strings(left.encodedKey, right.encodedKey);
  return keyOrder !== 0
    ? keyOrder
    : compareUtf16Strings(left.rowId, right.rowId);
}

const loadIndexRangeDependenciesForUpdateEffect = Effect.fn(
  "SessionJournalStore.loadIndexRangeDependenciesForUpdate",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
): Effect.fn.Return<
  ReadonlyArray<LogicalIndexRangeReadDependencyV1>,
  SessionJournalRunIndexedQueryV1Error
> {
  const rows = yield* fromIndexedQueryPromise(() =>
    tx
      .select()
      .from(fxSystemTransactionJournalIndexRanges)
      .where(
        and(
          eq(
            fxSystemTransactionJournalIndexRanges.scopeUuid,
            context.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalIndexRanges.sessionId,
            context.anchor.sessionId,
          ),
          eq(
            fxSystemTransactionJournalIndexRanges.attemptFence,
            context.anchor.attemptFence,
          ),
        ),
      )
      .orderBy(asc(fxSystemTransactionJournalIndexRanges.ordinal))
      .limit(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1)
      .for("update"),
  );
  return yield* decodeStoredIndexRangeRowsEffect(attempt, rows);
});

const replaceStoredIndexRangesEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  ranges: ReadonlyArray<PreparedStoredIndexRangeV1>,
) {
  yield* runDrizzleStatementEffect(
    tx
      .delete(fxSystemTransactionJournalIndexRanges)
      .where(
        and(
          eq(
            fxSystemTransactionJournalIndexRanges.scopeUuid,
            context.scopeUuid,
          ),
          eq(
            fxSystemTransactionJournalIndexRanges.sessionId,
            context.anchor.sessionId,
          ),
          eq(
            fxSystemTransactionJournalIndexRanges.attemptFence,
            context.anchor.attemptFence,
          ),
        ),
      ),
    mapRunIndexedQueryFailure,
  );
  if (ranges.length === 0) return;
  yield* runDrizzleStatementEffect(
    tx.insert(fxSystemTransactionJournalIndexRanges).values(
      ranges.map((range, ordinal) => {
        const dependency = range.dependency;
        return {
          scopeUuid: context.scopeUuid,
          sessionId: context.anchor.sessionId,
          attemptFence: context.anchor.attemptFence,
          ordinal,
          tableId: dependency.tableId,
          indexDefinitionId: dependency.indexDefinitionId,
          keyCodecVersion: dependency.keyCodecVersion,
          physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
            dependency.physicalSpecSha256Hex,
          ),
          direction: dependency.direction,
          lowerKind:
            dependency.lower === null
              ? ("unbounded" as const)
              : ("key_inclusive" as const),
          lowerEncodedKey:
            dependency.lower === null
              ? null
              : orderedIndexBoundHexV1ToBytes(dependency.lower.encodedKey),
          upperKind:
            dependency.upper === null
              ? ("unbounded" as const)
              : dependency.upper.kind === "key"
                ? ("key_exclusive" as const)
                : ("position_inclusive" as const),
          upperEncodedKey:
            dependency.upper === null
              ? null
              : dependency.upper.kind === "key"
                ? orderedIndexBoundHexV1ToBytes(dependency.upper.encodedKey)
                : orderedIndexKeyBytesHexV1ToBytes(dependency.upper.encodedKey),
          upperRowId:
            dependency.upper?.kind === "position"
              ? orderedIndexRowIdHexV1ToBytes(dependency.upper.rowId)
              : null,
          evidenceBytes: range.evidenceBytes,
          createdAt: context.databaseNow,
          updatedAt: context.databaseNow,
        };
      }),
    ),
    mapRunIndexedQueryFailure,
  );
});

const persistIndexedQueryLimitOutcomeEffect = Effect.fn(
  "SessionJournalStore.persistIndexedQueryLimitOutcome",
)(function (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "indexRange";
    }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  counters: SessionJournalCountersV1,
  issue: SessionJournalIncrementalLimitIssueV1,
) {
  const outcome = Object.freeze({
    kind: "error",
    reason: "limitExceeded",
    ...issue,
  } satisfies SessionJournalStoredOutcome);
  return persistAcceptedOperationEffect(
    tx,
    context,
    request,
    requestEvidence,
    outcome,
    counters,
    ZERO_COUNTER_DELTAS,
    { state: "failed", failureDimension: issue.dimension },
    mapRunIndexedQueryFailure,
  ).pipe(
    Effect.map(() =>
      Object.freeze({
        kind: "outcome",
        delivery: "executed",
        outcome,
      } as const),
    ),
  );
});

export function makeIndexedQueries(
  owner: JournalAttemptOwner,
  resolveJournalTargetEffect: JournalTargetResolver,
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  indexedQueryPortState: ReturnType<typeof inspectAppDeveloperIndexQueryPortV1>,
  faultAfter: SessionJournalStorePersistenceOptionsV1["faultAfter"],
  pointOperations: Pick<ReturnType<typeof makePointOperations>, "capturePointTableInput" | "resolvePointTableAdmittedEffect">,
) {
  const captureDeveloperIndexInput = Effect.fn("SessionJournalStore.captureDeveloperIndexInput")(function* (
    table: Parameters<SessionJournalStorePersistence["resolveDeveloperIndexEffect"]>[0], indexDescriptorInput: unknown) {
    const tableState =
      typeof table === "object" && table !== null
        ? owner.readPointTable(table)
        : undefined;
    if (tableState === undefined) {
      return yield* Effect.fail(
        new InvalidSessionJournalCapabilityV1Error({
          capability: "pointTable",
        }),
      );
    }
    const descriptor = yield* decodeDeveloperIndexDescriptorEffect(indexDescriptorInput).pipe(
      Effect.mapError(
        (cause) =>
          new InvalidSessionJournalInputV1Error({
            operation: "resolveDeveloperIndex",
            reason: "invalidIndexDescriptor",
            cause,
          }),
      ),
    );
    if (
      indexedQueryPortState === undefined ||
      indexedQueryPortState.authority !== ports
    ) {
      return yield* Effect.fail(
        new SessionJournalDeveloperIndexUnavailableV1Error({
          reason: "invalidComposition",
        }),
      );
    }
    return { tableState, descriptor, queryPort: indexedQueryPortState };
  });
  const resolveDeveloperIndexAdmittedEffect = Effect.fn("SessionJournalStore.resolveDeveloperIndexAdmitted")(function* (
    tableState: NonNullable<ReturnType<JournalAttemptOwner["readPointTable"]>>,
    descriptor: Effect.Success<ReturnType<typeof captureDeveloperIndexInput>>["descriptor"],
    queryPort: NonNullable<typeof indexedQueryPortState>) {
    const finite = owner.readFiniteRoot(tableState.attempt);
    if (finite !== undefined && finite.status !== "open")
      return yield* Effect.fail(corruption(tableState.attempt, "journalStateInvalid"));
    const resolved = yield* resolveJournalTargetEffect(tableState.attempt);
    const logicalIndexId = yield* resolved.target[
      RESOLVE_PINNED_DEVELOPER_INDEX_ID_EFFECT_V1
    ]({
      deploymentId: tableState.attempt.selector.deploymentId,
      schemaVersionId: tableState.attempt.schemaVersionId,
      tableId: tableState.tableId,
      descriptor,
    }).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapDeveloperIndexResolutionFailure))));
    const definitions = yield* queryPort.definitions.locate({
      deploymentId: tableState.attempt.selector.deploymentId,
      scopeId: tableState.attempt.selector.scopeId,
      schemaVersionId: tableState.attempt.schemaVersionId,
      tableIds: Object.freeze([tableState.tableId]),
      maximumDefinitions: MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
    });
    const matches =
      definitions?.filter(
        (definition) =>
          definition.access.kind === "developer" &&
          definition.access.logicalIndexId === logicalIndexId &&
          definition.access.tableId === tableState.tableId,
      ) ?? [];
    if (matches.length !== 1) {
      return yield* Effect.fail(
        new SessionJournalDeveloperIndexUnavailableV1Error({
          reason:
            matches.length === 0
              ? "definitionNotFound"
              : "definitionMismatch",
        }),
      );
    }
    const state = Object.freeze({
      attempt: tableState.attempt,
      tableId: tableState.tableId,
      tableName: tableState.tableName,
      logicalIndexId,
      definition: matches[0]!,
    } satisfies PinnedDeveloperIndexStateV1);
    if (finite !== undefined && finite.status !== "open")
      return yield* Effect.fail(corruption(tableState.attempt, "journalStateInvalid"));
    return owner.issueDeveloperIndex(state);
  });
  const resolveDeveloperIndexEffect: SessionJournalStorePersistence["resolveDeveloperIndexEffect"] =
    Effect.fn("SessionJournalStore.resolveDeveloperIndex")(function* (table, indexDescriptorInput) {
      const { tableState, descriptor, queryPort } = yield* captureDeveloperIndexInput(table, indexDescriptorInput);
      const work = resolveDeveloperIndexAdmittedEffect(tableState, descriptor, queryPort);
      const finite = owner.readFiniteRoot(tableState.attempt);
      return yield* finite === undefined ? work :
        withFiniteApplicationOperation(finite, tableState.attempt, work, "resolveDeveloperIndex");
    });

  const runIndexedQuery =
    Effect.fnUntraced(
      function* (index: Parameters<SessionJournalStorePersistence["runIndexedQueryEffect"]>[0],
        operation: Parameters<SessionJournalStorePersistence["runIndexedQueryEffect"]>[1], admitted = false) {
        const state =
          typeof index === "object" && index !== null
            ? owner.readDeveloperIndex(index)
            : undefined;
        if (state === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "developerIndex",
            }),
          );
        }
        const request = yield* Effect.fromResult(
          captureIndexedQueryRequestResult(state, operation),
        );
        const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
        const finite = owner.readFiniteRoot(state.attempt);
        const evaluate = Effect.gen(function* () {
          // Preserve the finite evaluator's closed-root verdict before metadata or storage work.
          if (finite !== undefined && finite.status !== "open") {
            return projectIndexedQueryResult(yield* runFiniteIndexedQueryEffect(
              finiteApplicationCapture(finite, state.attempt), finite.initialContext,
              state, request, requestEvidence, finite));
          }
          const resolved = yield* resolveJournalTargetEffect(state.attempt);
          if (!isLocatedExactRunningAttemptReadSyscallKernelV1(resolved.target)) {
            return yield* Effect.fail(
              new SessionJournalTargetUnavailableV1Error({
                scopeId: state.attempt.selector.scopeId,
              }),
            );
          }
          const checked =
            finite === undefined
              ? resolved.target[
                  RUN_EXACT_RUNNING_POINT_MUTATION_READ_SYSCALL_EFFECT_V1
                ](
                  {
                    selector: state.attempt.selector,
                    preliminaryAuthority: resolved.authority,
                    executionClaim: state.attempt.executionClaim,
                  },
                  (tx, context) =>
                    runIndexedQueryInTransactionEffect(
                      tx,
                      context,
                      state,
                      request,
                      requestEvidence,
                      faultAfter,
                    ),
                )
              : Effect.gen(function* () {
                  yield* recordFiniteApplicationDemandMetadataEffect(
                    state.attempt,
                    finite,
                    state.tableId,
                    false,
                    state.definition.indexDefinitionId,
                  );
                  return yield* runFiniteIndexedQueryEffect(
                    finiteApplicationCapture(finite, state.attempt),
                    finite.initialContext,
                    state,
                    request,
                    requestEvidence,
                    finite,
                  );
                });
          const applied = yield* checked.pipe(
            Effect.catchCause(cause => Effect.failCause(Cause.map(cause, error =>
              error instanceof ExactRunningAttemptTransactionV1Error
                ? mapExactRunningIndexedQueryFailure(error)
                : error))),
          );
          if (finite?.status === "aborted") discardFiniteRootEvidence(finite);
          return projectIndexedQueryResult(applied);
        });
        return yield* finite === undefined || admitted || finite.status !== "open" ? evaluate :
          withFiniteApplicationOperation(finite, state.attempt, evaluate, "runIndexedQuery");
      },
      (work) => observeExecution("SessionJournalStore.runIndexedQuery", work),
    );
  const runIndexedQueryEffect: SessionJournalStorePersistence["runIndexedQueryEffect"] =
    (index, operation) => runIndexedQuery(index, operation);
  const runApplicationIndexedQueryEffect: SessionJournalStorePersistence["runApplicationIndexedQueryEffect"] =
    Effect.fn("SessionJournalStore.runApplicationIndexedQuery")(function* (attempt, tableNameInput, indexDescriptorInput, input) {
      const { attemptState, tableName } = yield* pointOperations.capturePointTableInput(attempt, tableNameInput);
      const work = Effect.gen(function* () {
        const table = yield* pointOperations.resolvePointTableAdmittedEffect(attemptState, tableName);
        const { tableState, descriptor, queryPort } = yield* captureDeveloperIndexInput(table, indexDescriptorInput);
        const index = yield* resolveDeveloperIndexAdmittedEffect(tableState, descriptor, queryPort);
        const operation = yield* Effect.fromResult(decodeIndexedQueryOperationResult(input));
        return yield* runIndexedQuery(index, operation, true);
      });
      const finite = owner.readFiniteRoot(attemptState);
      return yield* finite === undefined ? work : withFiniteApplicationOperation(finite, attemptState, work, "runIndexedQuery");
    });
  return Object.freeze({ resolveDeveloperIndexEffect, runIndexedQueryEffect, runApplicationIndexedQueryEffect });
}
