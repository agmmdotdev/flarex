import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { ApplicationRevisionSyscallDocumentValidationV1Error } from "../../application/revision/applicationRevisionSyscallValidatorErrors";
import type { SessionJournalStorePersistence } from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  InvalidSessionJournalInputV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalIdentityGenerationV1Error,
} from "./errors";
import type { SessionJournalRunPointOperationV1Error } from "./errors";
import type { PinnedPointTableStateV1 } from "./state";
import { observeExecution } from "../diagnostics/operation";
import type { FiniteStorageCaptureError } from "../finiteStorageCapture";
import { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Option, Result } from "effect";
import { validateApplicationWriteOwnershipForCommit } from "../../application/ownership/Commit";
import { ApplicationTableWriteDeniedError } from "../../application/ownership/Model";
import {
  AppDocumentSystemFieldV1Error,
  decodeAppCreationTimeV1,
  canonicalizeAppDocumentV1,
} from "flarex-protocol/app-document";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
} from "flarex-protocol/app-document-id";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CommitDocumentSemanticBytesV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_OPERATION_CALLS_V1,
} from "flarex-protocol/commit-protocol";
import type {
  LogicalAppWriteV1,
  LogicalPatchFieldV1,
} from "flarex-protocol/commit-protocol";
import { isJsonObject } from "flarex-protocol/json";
import {
  FlarexValueCodecV1Error,
  canonicalizeFlarexValueJsonV1Effect,
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import type {
  CanonicalFlarexRuntimeObjectV1,
  CanonicalFlarexRuntimeValueV1,
  CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import {
  getAppRowAtSnapshotInTransactionEffect,
  consumeCapturedAppRowsAtSnapshotEffect,
  projectAppRowPointReadResult,
} from "../../storage/documents/appRows";
import type {
  AppRowPointDependencyV1,
  AppRowTransaction,
  AppRowReadResultV1,
} from "../../storage/documents/appRows";
import {
  validateApplicationRevisionSyscallDocumentInTransactionV1,
  validateSessionPinnedApplicationDocument,
} from "../../application/revision/applicationRevisionSyscallValidatorV1";
import type { ApplicationRevisionSyscallValidatorV1 } from "../../application/revision/applicationRevisionSyscallValidatorV1";
import { PinnedPointTableNotFoundV1Error } from "../../storage/documents/pinnedPointTableErrors";
import type { LogicalFiniteStorageCapture } from "../../storage/documents/logicalDocuments/model";
import {
  fxAppRowRevisions,
  fxSystemTransactionJournalPoints,
} from "../../database/schema";
import {
  ExactRunningAttemptTransactionV1Error,
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
} from "../transactionSessionAttemptKernel";
import type {
  ExactRunningAttemptKernelContextV1,
  FiniteEntryAttemptKernelContext,
} from "../transactionSessionAttemptKernel";
import {
  encodeLogicalAppWrite,
  decodeLogicalAppWriteResult,
  decodeCommitFinalSyscallSequenceResult,
  nextCommitSyscallSequence,
  decodeSchemaManifestAppTableNameEffect,
  canonicalizeStoredRequestEffect,
  canonicalizeStoredOutcomeEffect,
  requireJson,
} from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredPointRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { UUID_V4_PATTERN, captureStoredRequestResult } from "./inputCapture";
import {
  addFiniteCounters,
  ZERO_COUNTER_DELTAS,
  countersForPointRead,
  pointMutationForOverlay,
  firstExceededLimit,
  decodeJournalCountersResult,
} from "./operationModel";
import type {
  AppliedSessionJournalOperationV1,
  SessionJournalCounterDeltasV1,
  SessionJournalOperationPlanV1,
  PreparedLogicalWriteEventV1,
  LogicalPointReadV1,
} from "./operationModel";
import {
  decodePointDependencyResult,
  dependenciesEqual,
  validateReceiptCardinalityResult,
  decodeAndVerifyLatestReceiptEffect,
  validateReceiptOutcomeMatchesJournalRootResult,
  projectPointOperationResult,
  decodeLivePointOverlayEvidenceEffect,
} from "./receiptEvidence";
import {
  loadLatestReceipt,
  loadReceiptAtSequence,
  persistAcceptedOperationEffect,
  persistPointMutationEffect,
  persistLogicalWrite,
} from "./journalPersistence";
import {
  finiteApplicationCapture,
  discardFiniteRootEvidence,
  finiteRootState,
  finitePoint,
  readKnownFinitePoint,
  finitePointObservation,
  recordFiniteApplicationDemandMetadataEffect,
} from "./finiteRoot";
import type { FiniteRootAttemptState } from "./finiteRoot";
import {
  mapPointTableResolutionFailure,
  mapRunPointOperationFailure,
  fromPointOperationPromise,
  mapExactRunningAttemptTransactionFailure,
  kernelContextMatchesAttempt,
  corruption,
} from "./journalFailures";
import type { JournalAttemptOwner } from "./attemptOwner";
import { admitExactRunningAttemptEffect } from "./targetAdmission";
import type { JournalTargetResolver } from "./targetAdmission";

const prepareLogicalWriteEventEffect = Effect.fnUntraced(
  function* (
    write: LogicalAppWriteV1,
  ): Effect.fn.Return<
    PreparedLogicalWriteEventV1,
    SessionJournalRunPointOperationV1Error
  > {
    const encoded = requireJson(encodeLogicalAppWrite(write));
    if (!isJsonObject(encoded)) {
      return yield* Effect.die(
        new Error("Logical write encoder returned a non-object."),
      );
    }
    const evidence = yield* canonicalizeFlarexValueJsonV1Effect(encoded).pipe(
      Effect.mapError(mapRunPointOperationFailure),
    );
    if (!isJsonObject(evidence.valueJson)) {
      return yield* Effect.die(
        new Error("Canonical logical write evidence returned a non-object."),
      );
    }
    const strictWrite = yield* Effect.fromResult(
      decodeLogicalAppWriteResult(evidence.valueJson).pipe(
        Result.mapError(mapRunPointOperationFailure),
      ),
    );
    return Object.freeze({
      write: strictWrite,
      canonicalBytes: copyCanonicalFlarexValueBytesV1(evidence.canonicalBytes),
      sha256: copyFlarexValueSha256V1(evidence.sha256),
      evidenceBytes: evidence.canonicalBytes.byteLength,
    });
  },
  (work) =>
    observeExecution("SessionJournalStore.prepareLogicalWriteEvent", work),
);

const runPointOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.runPointOperationInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  requestEvidence: CanonicalFlarexValueV1,
  randomUuid: () => string,
  validator: ApplicationRevisionSyscallValidatorV1,
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunPointOperationV1Error
> {
  if (!kernelContextMatchesAttempt(context, table.attempt)) {
    return yield* Effect.fail(
      corruption(table.attempt, "exactAttemptPinsChanged"),
    );
  }
  if (request.tableId !== table.tableId) {
    return yield* Effect.fail(
      corruption(table.attempt, "requestTableCapabilityMismatch"),
    );
  }
  const root = context.journalRoot;
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(table.attempt, root),
  );
  const receipt = yield* Effect.tryPromise({
    try: () => loadLatestReceipt(tx, context),
    catch: mapRunPointOperationFailure,
  });
  yield* Effect.fromResult(
    validateReceiptCardinalityResult(
      table.attempt,
      root.lastSyscallSequence,
      receipt,
    ),
  );

  const last = yield* Effect.fromResult(
    decodeCommitFinalSyscallSequenceResult(root.lastSyscallSequence).pipe(
      Result.mapError(mapRunPointOperationFailure),
    ),
  );
  const actual = request.syscallSequence;
  if (root.state === "sealed") {
    return Object.freeze({
      kind: "stateRejected",
      reason: "journalSealed",
    });
  }
  if (actual < last) {
    const prior = yield* Effect.tryPromise({
      try: () => loadReceiptAtSequence(tx, context, actual),
      catch: mapRunPointOperationFailure,
    });
    if (prior === undefined) {
      return yield* Effect.fail(
        corruption(table.attempt, "latestReceiptMissing"),
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
      table.attempt,
      prior,
      request,
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "replayed",
      outcome: replayed,
    });
  }
  if (BigInt(actual) === BigInt(last)) {
    if (receipt === undefined) {
      return yield* Effect.fail(
        corruption(table.attempt, "latestReceiptMissing"),
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
        corruption(table.attempt, "latestReceiptRequestDigestMismatch"),
      );
    }
    const replayed = yield* decodeAndVerifyLatestReceiptEffect(
      table.attempt,
      receipt,
      request,
    );
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(
        table.attempt,
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
      issue: Object.freeze({
        reason: "sequenceExhausted",
        lastAccepted: last,
      }),
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
        corruption(table.attempt, "failedJournalEvidenceInvalid"),
      );
    }
    const sticky = yield* decodeAndVerifyLatestReceiptEffect(
      table.attempt,
      receipt,
      undefined,
    );
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(
        table.attempt,
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
    return yield* Effect.fail(corruption(table.attempt, "journalStateInvalid"));
  }

  if (request.kind !== "get") {
    // The resolved table capability supplies this identity before any write event,
    // overlay, counter or receipt is appended. Commit-generation admission remains separate.
    yield* validateApplicationWriteOwnershipForCommit(tx, {
      scopeId: context.anchor.scopeId,
      generation: "application_v1",
      authenticatedAttemptedTables: [table.tableId],
      materialTables: [],
    }).pipe(
      Effect.mapError((cause) =>
        cause.reason === "writeDenied"
          ? new ApplicationTableWriteDeniedError({
              operation: request.kind,
              tableName: table.tableName,
              message:
                "Ordinary Application mutations cannot write this managed table.",
            })
          : new SessionJournalPersistenceV1Error({
              operation: "runPointOperation",
              cause,
            }),
      ),
    );
  }
  const plan = yield* planFreshPointOperationEffect(
    tx,
    context,
    table,
    request,
    randomUuid,
  );
  const logicalWrite = plan.write;
  const preparedWriteEvent =
    logicalWrite === undefined
      ? undefined
      : yield* prepareLogicalWriteEventEffect(logicalWrite);
  const plannedOutcomeEvidence = yield* canonicalizeStoredOutcomeEffect(
    plan.outcome,
  ).pipe(Effect.mapError(mapRunPointOperationFailure));
  const counterDeltas = Object.freeze({
    ...plan.counters,
    materialWriteEventEvidenceBytes: preparedWriteEvent?.evidenceBytes ?? 0,
    receiptEvidenceBytes:
      requestEvidence.canonicalBytes.byteLength +
      plannedOutcomeEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limitIssue = firstExceededLimit(counters, counterDeltas);
  if (plan.documentValidation !== undefined) {
    yield* validateApplicationRevisionSyscallDocumentInTransactionV1(
      validator,
      tx,
      context,
      plan.documentValidation,
    );
  }

  if (limitIssue !== undefined) {
    const outcome = Object.freeze({
      kind: "error",
      reason: "limitExceeded",
      ...limitIssue,
    } satisfies SessionJournalStoredOutcome);
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      {
        ...ZERO_COUNTER_DELTAS,
      },
      {
        state: "failed",
        failureDimension: limitIssue.dimension,
        ...(plan.nextCreationTime === undefined
          ? {}
          : { nextCreationTime: plan.nextCreationTime }),
      },
      mapRunPointOperationFailure,
    );
    return Object.freeze({
      kind: "outcome",
      delivery: "executed",
      outcome,
    });
  }

  yield* Effect.gen(function* () {
    if (plan.pointMutation !== undefined) {
      yield* persistPointMutationEffect(
        tx,
        context,
        plan.pointMutation,
        mapRunPointOperationFailure,
      );
    }
    if (preparedWriteEvent !== undefined) {
      yield* runDrizzleStatementEffect(
        persistLogicalWrite(tx, context, preparedWriteEvent),
        mapRunPointOperationFailure,
      );
    }
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      plan.outcome,
      counters,
      counterDeltas,
      {
        state: "open",
        failureDimension: null,
        ...(plan.nextCreationTime === undefined
          ? {}
          : { nextCreationTime: plan.nextCreationTime }),
      },
      mapRunPointOperationFailure,
    );
  });
  return Object.freeze({
    kind: "outcome",
    delivery: "executed",
    outcome: plan.outcome,
  });
});

type FinitePointOperationContext =
  | Readonly<{
      kind: "storage";
      capture: LogicalFiniteStorageCapture<FiniteStorageCaptureError>;
      context: FiniteEntryAttemptKernelContext;
    }>
  | Readonly<{ kind: "local"; context: FiniteEntryAttemptKernelContext }>;

/** One evaluator owns both fresh storage observations and already observed work.
 * No transaction or clock is manufactured for local tentative operations. */
// The public journal operation owns diagnostics and sticky failure. This finite
// evaluator is a repeated private stage; retain its lazy in-flight/finalizer fold.
const runFinitePointOperationEffect = Effect.fnUntraced(function* (
  frontier: FinitePointOperationContext,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  requestEvidence: CanonicalFlarexValueV1,
  randomUuid: () => string,
  validator: Parameters<typeof runPointOperationInTransactionEffect>[6],
  finite: FiniteRootAttemptState,
  onDocumentRejection: (
    error: ApplicationRevisionSyscallDocumentValidationV1Error,
  ) => void,
): Effect.fn.Return<
  AppliedSessionJournalOperationV1,
  SessionJournalRunPointOperationV1Error
> {
  const { context } = frontier;
  finite.inFlightOperations += 1;
  return yield* Effect.gen(function* () {
    if (
      !kernelContextMatchesAttempt(context, table.attempt) ||
      context.anchor.executionProfile !== "finiteRoot"
    )
      return yield* Effect.fail(
        corruption(table.attempt, "exactAttemptPinsChanged"),
      );
    if (request.tableId !== table.tableId)
      return yield* Effect.fail(
        corruption(table.attempt, "requestTableCapabilityMismatch"),
      );
    if (finite.status !== "open")
      return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
    const previous = finite.receipts.get(request.syscallSequence);
    if (previous !== undefined) {
      if (
        previous.kind !== "point" ||
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
    if (request.kind !== "get" && frontier.kind === "storage") {
      const ownership = yield* frontier
        .capture(
          { kind: "ownership", tableId: table.tableId },
          { kind: "rows", tableId: table.tableId },
        )
        .pipe(Effect.mapError(mapRunPointOperationFailure));
      if (ownership.denied)
        return yield* Effect.fail(
          new ApplicationTableWriteDeniedError({
            operation: request.kind,
            tableName: table.tableName,
            message:
              "Ordinary Application mutations cannot write this managed table.",
          }),
        );
      finite.writableTables.add(table.tableId);
    }
    // Planning may hydrate an uncached patch/replace target. Rejected documents
    // must not retain that read without accepting its dependency/counter charge.
    const hydratedRowId =
      request.kind === "patch" || request.kind === "replace"
        ? decodeAppDocumentIdentityV1(request.documentId).rowId
        : undefined;
    const hadHydratedRead =
      hydratedRowId !== undefined &&
      finitePoint(finite, table.tableId, hydratedRowId) !== undefined;
    const plan =
      frontier.kind === "storage"
        ? yield* planFinitePointOperationEffect(
            frontier.capture,
            frontier.context,
            table,
            request,
            randomUuid,
            finite,
          )
        : request.kind === "insert"
          ? yield* Effect.fail(
              corruption(table.attempt, "requestTableCapabilityMismatch"),
            )
          : yield* planReadPointOperationEffect(table, request, (rowId) => {
              const read = readKnownFinitePoint(finite, table.tableId, rowId);
              return read === undefined
                ? Effect.fail(
                    corruption(
                      table.attempt,
                      "pointDependencyChangedAtSnapshot",
                    ),
                  )
                : Effect.succeed(read);
            });
    const preparedWriteEvent =
      plan.write === undefined
        ? undefined
        : yield* prepareLogicalWriteEventEffect(plan.write);
    const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(
      plan.outcome,
    ).pipe(Effect.mapError(mapRunPointOperationFailure));
    const deltas = Object.freeze({
      ...plan.counters,
      materialWriteEventEvidenceBytes: preparedWriteEvent?.evidenceBytes ?? 0,
      receiptEvidenceBytes:
        requestEvidence.canonicalBytes.byteLength +
        outcomeEvidence.canonicalBytes.byteLength,
    } satisfies SessionJournalCounterDeltasV1);
    if (plan.documentValidation !== undefined)
      yield* validateSessionPinnedApplicationDocument(
        validator,
        context,
        plan.documentValidation,
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            if (
              error instanceof
              ApplicationRevisionSyscallDocumentValidationV1Error
            ) {
              if (hydratedRowId !== undefined && !hadHydratedRead)
                finite.evaluator.forgetUnwrittenPoint(
                  table.tableId,
                  hydratedRowId,
                );
              onDocumentRejection(error);
            }
          }),
        ),
      );
    const limitIssue = firstExceededLimit(finite.counters, deltas);
    if (limitIssue !== undefined) {
      finite.status = "aborted";
      return Object.freeze({
        kind: "outcome",
        delivery: "executed",
        outcome: Object.freeze({
          kind: "error",
          reason: "limitExceeded",
          ...limitIssue,
        }),
      });
    }
    if (finite.status !== "open")
      return Object.freeze({ kind: "stateRejected", reason: "journalFailed" });
    const point = plan.pointMutation;
    if (
      point !== undefined &&
      point.overlay.kind !== "none" &&
      plan.write !== undefined
    ) {
      const observation = finitePointObservation(finite, point);
      if (finitePoint(finite, point.tableId, point.rowId) === undefined) {
        yield* Effect.fromResult(
          finite.evaluator
            .observePoint(table.tableName, observation, { kind: "missing" })
            .pipe(
              Result.mapError((cause) =>
                corruption(
                  table.attempt,
                  "pointDependencyChangedAtSnapshot",
                  cause,
                ),
              ),
            ),
        );
      }
      const overlay =
        point.overlay.kind === "live"
          ? Object.freeze({
              kind: "live" as const,
              creationTime: point.overlay.creationTime,
              document: point.overlay.document,
            })
          : Object.freeze({ kind: "deleted" as const });
      yield* Effect.fromResult(
        finite.evaluator
          .writePoint(
            table.tableName,
            finiteRootState(finite)?.dependencies.get(observation.documentId) ??
              observation,
            overlay,
            request.kind === "get" ? "replace" : request.kind,
          )
          .pipe(
            Result.mapError((cause) =>
              corruption(
                table.attempt,
                "pointDependencyChangedAtSnapshot",
                cause,
              ),
            ),
          ),
      );
    }
    finite.counters = addFiniteCounters(finite.counters, deltas);
    if (plan.nextCreationTime !== undefined)
      finite.nextCreationTime = plan.nextCreationTime;
    finite.receipts.set(
      request.syscallSequence,
      Object.freeze({
        kind: "point",
        request,
        requestEvidence,
        outcome: plan.outcome,
        outcomeEvidence,
        plan,
        ...(preparedWriteEvent === undefined
          ? {}
          : { writeEvent: preparedWriteEvent }),
      }),
    );
    finite.lastSequence = request.syscallSequence;
    return Object.freeze({
      kind: "outcome",
      delivery: "executed",
      outcome: structuredClone(plan.outcome),
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        finite.inFlightOperations -= 1;
      }),
    ),
  );
});

type PointOperationPlanningContext =
  | Omit<ExactRunningAttemptKernelContextV1, "scopeClock">
  | FiniteEntryAttemptKernelContext;

type PointReadOperation = (
  rowId: AppRowIdHexV1,
) => Effect.Effect<LogicalPointReadV1, SessionJournalRunPointOperationV1Error>;

const planFreshPointOperationEffect = Effect.fn(
  "SessionJournalStore.planFreshPointOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  randomUuid: () => string,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  if (request.kind === "insert")
    return yield* planInsertEffect(
      context,
      table,
      request,
      randomUuid,
      (rowId) =>
        Effect.gen(function* () {
          const historical = yield* fromPointOperationPromise(() =>
            tx
              .select({ commitSeq: fxAppRowRevisions.commitSeq })
              .from(fxAppRowRevisions)
              .where(
                and(
                  eq(fxAppRowRevisions.scopeUuid, context.scopeUuid),
                  eq(fxAppRowRevisions.tableId, table.tableId),
                  eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(rowId)),
                ),
              )
              .limit(1),
          );
          const staged = yield* loadJournalPointRowEffect(
            tx,
            context,
            table.tableId,
            rowId,
          );
          return historical[0] !== undefined || staged !== undefined;
        }),
    );
  return yield* planReadPointOperationEffect(table, request, (rowId) =>
    readLogicalPointEffect(tx, context, table, rowId),
  );
});

// Planning remains lazy beneath the named journal operation and genuine capture;
// each finite point does not need another caller stack or diagnostic span.
const planFinitePointOperationEffect = Effect.fnUntraced(function* (
  capture: LogicalFiniteStorageCapture<FiniteStorageCaptureError>,
  context: FiniteEntryAttemptKernelContext,
  table: PinnedPointTableStateV1,
  request: SessionJournalStoredPointRequest,
  randomUuid: () => string,
  finite: FiniteRootAttemptState,
): Effect.fn.Return<
  SessionJournalOperationPlanV1,
  SessionJournalRunPointOperationV1Error
> {
  if (request.kind === "insert")
    return yield* planInsertEffect(
      context,
      table,
      request,
      randomUuid,
      (rowId) =>
        capture(
          {
            kind: "historicalIdentity",
            tableId: table.tableId,
            rowId: appRowIdHexV1ToBytes(rowId),
          },
          { kind: "rows", tableId: table.tableId },
        ).pipe(
          Effect.mapError(mapRunPointOperationFailure),
          Effect.map(
            (value) =>
              value.exists ||
              finitePoint(finite, table.tableId, rowId) !== undefined,
          ),
        ),
      finite,
    );
  return yield* planReadPointOperationEffect(table, request, (rowId) =>
    Effect.gen(function* () {
      const known = readKnownFinitePoint(finite, table.tableId, rowId);
      if (known !== undefined) return known;
      const captured = yield* capture(
        {
          kind: "rows",
          input: {
            scopeId: table.attempt.selector.scopeId,
            tableId: table.tableId,
            rowIds: [rowId],
            snapshotCommitSeq: table.attempt.snapshotToken.commitSeq,
          },
        },
        { kind: "rows", tableId: table.tableId },
      ).pipe(Effect.mapError(mapRunPointOperationFailure));
      let result:
        | import("../../storage/documents/appRows").AppRowPointReadResultV1
        | undefined;
      let originalRevision: AppRowReadResultV1 | undefined;
      yield* consumeCapturedAppRowsAtSnapshotEffect(
        captured.prepared,
        captured.rawRows,
        mapRunPointOperationFailure,
        (selectedRowId, revision) =>
          Effect.sync(() => {
            originalRevision = revision;
            result = projectAppRowPointReadResult(
              {
                scopeId: table.attempt.selector.scopeId,
                tableId: table.tableId,
                rowId: selectedRowId,
              },
              revision,
            );
          }),
      );
      if (result === undefined || originalRevision === undefined)
        return yield* Effect.fail(
          corruption(table.attempt, "pointDependencyChangedAtSnapshot"),
        );
      const read = Object.freeze({
        result,
        dependencyIsNew: true,
        pointMutation: Object.freeze({
          mode: "insert" as const,
          tableId: table.tableId,
          rowId,
          dependency: result.dependency,
          overlay: Object.freeze({ kind: "none" as const }),
        }),
      });
      yield* Effect.fromResult(
        finite.evaluator
          .observePoint(
            table.tableName,
            finitePointObservation(finite, read.pointMutation),
            originalRevision,
          )
          .pipe(
            Result.mapError((cause) =>
              corruption(
                table.attempt,
                "pointDependencyChangedAtSnapshot",
                cause,
              ),
            ),
          ),
      );
      return read;
    }),
  );
});

const planReadPointOperationEffect = Effect.fnUntraced(
  function* (
    table: PinnedPointTableStateV1,
    request: Exclude<
      SessionJournalStoredPointRequest,
      { readonly kind: "insert" }
    >,
    readPoint: PointReadOperation,
  ): Effect.fn.Return<
    SessionJournalOperationPlanV1,
    SessionJournalRunPointOperationV1Error
  > {
    switch (request.kind) {
      case "get": {
        const read = yield* readPoint(
          decodeAppDocumentIdentityV1(request.documentId).rowId,
        );
        return Object.freeze({
          outcome:
            read.result.kind === "present"
              ? Object.freeze({
                  kind: "present",
                  documentValueJson: read.result.document.valueJson,
                })
              : Object.freeze({ kind: "missing" }),
          counters: countersForPointRead(read),
          ...(read.pointMutation === undefined
            ? {}
            : { pointMutation: read.pointMutation }),
        });
      }
      case "patch":
        return yield* planPatchEffect(table, request, readPoint);
      case "replace":
        return yield* planReplaceEffect(table, request, readPoint);
      case "delete":
        return yield* planDeleteEffect(table, request, readPoint);
    }
  },
  (work) =>
    observeExecution("SessionJournalStore.planReadPointOperation", work),
);

const planInsertEffect = Effect.fnUntraced(
  function* (
    context: PointOperationPlanningContext,
    table: PinnedPointTableStateV1,
    request: Extract<SessionJournalStoredRequest, { readonly kind: "insert" }>,
    randomUuid: () => string,
    historicalCollision: (
      rowId: AppRowIdHexV1,
    ) => Effect.Effect<boolean, SessionJournalRunPointOperationV1Error>,
    finite?: FiniteRootAttemptState,
  ): Effect.fn.Return<
    SessionJournalOperationPlanV1,
    SessionJournalRunPointOperationV1Error
  > {
    const generatedUuid = randomUuid();
    if (
      typeof generatedUuid !== "string" ||
      !UUID_V4_PATTERN.test(generatedUuid)
    ) {
      return yield* Effect.fail(
        new SessionJournalIdentityGenerationV1Error({
          generatedValue: generatedUuid,
        }),
      );
    }
    const rowId = decodeAppDocumentIdentityV1(
      `${table.tableId}:${generatedUuid}`,
    ).rowId;
    const documentId = appDocumentIdV1FromRowIdentity({
      tableId: table.tableId,
      rowId,
    });
    let creationTimeInput;
    if (finite !== undefined) creationTimeInput = finite.nextCreationTime;
    else {
      if (
        !("journalRoot" in context) ||
        !("nextCreationTime" in context.journalRoot)
      )
        return yield* Effect.fail(
          corruption(table.attempt, "exactAttemptPinsChanged"),
        );
      creationTimeInput = context.journalRoot.nextCreationTime;
    }
    const creationTime = decodeAppCreationTimeV1(creationTimeInput);
    const nextCreationTime = nextAppCreationTime(creationTime);

    if (yield* historicalCollision(rowId)) {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "documentIdCollision",
          documentId,
        }),
        counters: ZERO_COUNTER_DELTAS,
        nextCreationTime,
      });
    }

    const fields = normalizeFlarexValueJsonV1(
      request.fieldsValueJson,
      "appDocument",
    ).value;
    const documentResult = yield* tryCanonicalizeDocumentEffect({
      tableId: table.tableId,
      rowId,
      creationTime,
      fields,
    });
    if (documentResult.kind === "invalid") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "invalidDocument",
          operation: "insert",
        }),
        counters: ZERO_COUNTER_DELTAS,
        nextCreationTime,
      });
    }
    const document = documentResult.document;
    const dependency = Object.freeze({
      kind: "missing",
      identity: Object.freeze({
        scopeId: table.attempt.selector.scopeId,
        tableId: table.tableId,
        rowId,
      }),
      basis: Object.freeze({ kind: "noVisibleRevision" }),
    } satisfies AppRowPointDependencyV1);
    const write = Object.freeze({
      kind: "insert",
      syscallSequence: request.syscallSequence,
      documentId,
      creationTime,
      fieldsValueJson: request.fieldsValueJson,
      resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema.make(
        document.semanticSizeBytes,
      ),
    } satisfies LogicalAppWriteV1);
    return Object.freeze({
      outcome: Object.freeze({
        kind: "inserted",
        documentId,
        documentValueJson: document.valueJson,
      }),
      counters: Object.freeze({
        ...ZERO_COUNTER_DELTAS,
        pointDependencyCount: 1,
        writeOperations: 1,
        writeSemanticBytes: document.semanticSizeBytes,
      }),
      pointMutation: Object.freeze({
        mode: "insert",
        tableId: table.tableId,
        rowId,
        dependency,
        overlay: Object.freeze({
          kind: "live",
          creationTime,
          document,
        }),
      }),
      write,
      documentValidation: Object.freeze({
        operation: "insert",
        tableName: table.tableName,
        tableId: table.tableId,
        documentId,
        creationTime,
        document,
      }),
      nextCreationTime,
    });
  },
  (work) => observeExecution("SessionJournalStore.planInsert", work),
);

const planPatchEffect = Effect.fnUntraced(
  function* (
    table: PinnedPointTableStateV1,
    request: Extract<SessionJournalStoredRequest, { readonly kind: "patch" }>,
    readPoint: PointReadOperation,
  ): Effect.fn.Return<
    SessionJournalOperationPlanV1,
    SessionJournalRunPointOperationV1Error
  > {
    const identity = decodeAppDocumentIdentityV1(request.documentId);
    const read = yield* readPoint(identity.rowId);
    const readCounters = countersForPointRead(read);
    if (read.result.kind === "missing") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "documentNotFound",
          operation: "patch",
          documentId: request.documentId,
        }),
        counters: readCounters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const current = read.result.document;
    const fields = developerFieldsFromDocument(current.value);
    applyPatchChanges(fields, request.changes);
    const creationTime = creationTimeFromDocument(current.value);
    const documentResult = yield* tryCanonicalizeDocumentEffect({
      tableId: table.tableId,
      rowId: identity.rowId,
      creationTime,
      fields,
    });
    if (documentResult.kind === "invalid") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "invalidDocument",
          operation: "patch",
        }),
        counters: readCounters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const next = documentResult.document;
    if (bytesEqual(current.canonicalBytes, next.canonicalBytes)) {
      return Object.freeze({
        outcome: Object.freeze({ kind: "unit", operation: "patch" }),
        counters: readCounters,
        documentValidation: Object.freeze({
          operation: "patch",
          tableName: table.tableName,
          tableId: table.tableId,
          documentId: request.documentId,
          creationTime,
          document: next,
        }),
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const write = Object.freeze({
      kind: "patch",
      syscallSequence: request.syscallSequence,
      documentId: request.documentId,
      changes: request.changes,
      resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema.make(
        next.semanticSizeBytes,
      ),
    } satisfies LogicalAppWriteV1);
    return Object.freeze({
      outcome: Object.freeze({ kind: "unit", operation: "patch" }),
      counters: Object.freeze({
        ...readCounters,
        writeOperations: 1,
        writeSemanticBytes: next.semanticSizeBytes,
      }),
      pointMutation: pointMutationForOverlay(
        read,
        table.tableId,
        identity.rowId,
        Object.freeze({ kind: "live", creationTime, document: next }),
      ),
      write,
      documentValidation: Object.freeze({
        operation: "patch",
        tableName: table.tableName,
        tableId: table.tableId,
        documentId: request.documentId,
        creationTime,
        document: next,
      }),
    });
  },
  (work) => observeExecution("SessionJournalStore.planPatch", work),
);

const planReplaceEffect = Effect.fnUntraced(
  function* (
    table: PinnedPointTableStateV1,
    request: Extract<SessionJournalStoredRequest, { readonly kind: "replace" }>,
    readPoint: PointReadOperation,
  ): Effect.fn.Return<
    SessionJournalOperationPlanV1,
    SessionJournalRunPointOperationV1Error
  > {
    const identity = decodeAppDocumentIdentityV1(request.documentId);
    const read = yield* readPoint(identity.rowId);
    const readCounters = countersForPointRead(read);
    if (read.result.kind === "missing") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "documentNotFound",
          operation: "replace",
          documentId: request.documentId,
        }),
        counters: readCounters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const current = read.result.document;
    const fields = normalizeFlarexValueJsonV1(
      request.fieldsValueJson,
      "appDocument",
    ).value;
    const creationTime = creationTimeFromDocument(current.value);
    const documentResult = yield* tryCanonicalizeDocumentEffect({
      tableId: table.tableId,
      rowId: identity.rowId,
      creationTime,
      fields,
    });
    if (documentResult.kind === "invalid") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "invalidDocument",
          operation: "replace",
        }),
        counters: readCounters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const next = documentResult.document;
    if (bytesEqual(current.canonicalBytes, next.canonicalBytes)) {
      return Object.freeze({
        outcome: Object.freeze({ kind: "unit", operation: "replace" }),
        counters: readCounters,
        documentValidation: Object.freeze({
          operation: "replace",
          tableName: table.tableName,
          tableId: table.tableId,
          documentId: request.documentId,
          creationTime,
          document: next,
        }),
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const write = Object.freeze({
      kind: "replace",
      syscallSequence: request.syscallSequence,
      documentId: request.documentId,
      fieldsValueJson: request.fieldsValueJson,
      resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema.make(
        next.semanticSizeBytes,
      ),
    } satisfies LogicalAppWriteV1);
    return Object.freeze({
      outcome: Object.freeze({ kind: "unit", operation: "replace" }),
      counters: Object.freeze({
        ...readCounters,
        writeOperations: 1,
        writeSemanticBytes: next.semanticSizeBytes,
      }),
      pointMutation: pointMutationForOverlay(
        read,
        table.tableId,
        identity.rowId,
        Object.freeze({ kind: "live", creationTime, document: next }),
      ),
      write,
      documentValidation: Object.freeze({
        operation: "replace",
        tableName: table.tableName,
        tableId: table.tableId,
        documentId: request.documentId,
        creationTime,
        document: next,
      }),
    });
  },
  (work) => observeExecution("SessionJournalStore.planReplace", work),
);

const planDeleteEffect = Effect.fnUntraced(
  function* (
    table: PinnedPointTableStateV1,
    request: Extract<SessionJournalStoredRequest, { readonly kind: "delete" }>,
    readPoint: PointReadOperation,
  ): Effect.fn.Return<
    SessionJournalOperationPlanV1,
    SessionJournalRunPointOperationV1Error
  > {
    const identity = decodeAppDocumentIdentityV1(request.documentId);
    const read = yield* readPoint(identity.rowId);
    const readCounters = countersForPointRead(read);
    if (read.result.kind === "missing") {
      return Object.freeze({
        outcome: Object.freeze({
          kind: "error",
          reason: "documentNotFound",
          operation: "delete",
          documentId: request.documentId,
        }),
        counters: readCounters,
        ...(read.pointMutation === undefined
          ? {}
          : { pointMutation: read.pointMutation }),
      });
    }
    const write = Object.freeze({
      kind: "delete",
      syscallSequence: request.syscallSequence,
      documentId: request.documentId,
    } satisfies LogicalAppWriteV1);
    return Object.freeze({
      outcome: Object.freeze({ kind: "unit", operation: "delete" }),
      counters: Object.freeze({
        ...readCounters,
        writeOperations: 1,
      }),
      pointMutation: pointMutationForOverlay(
        read,
        table.tableId,
        identity.rowId,
        Object.freeze({ kind: "deleted" }),
      ),
      write,
    });
  },
  (work) => observeExecution("SessionJournalStore.planDelete", work),
);

const readLogicalPointEffect = Effect.fnUntraced(
  function* (
    tx: AppRowTransaction,
    context: PointOperationPlanningContext,
    table: PinnedPointTableStateV1,
    rowId: AppRowIdHexV1,
  ): Effect.fn.Return<
    LogicalPointReadV1,
    SessionJournalRunPointOperationV1Error
  > {
    const point = yield* loadJournalPointRowEffect(
      tx,
      context,
      table.tableId,
      rowId,
    );
    if (point === undefined) {
      const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
        snapshotToken: table.attempt.snapshotToken,
        tableId: table.tableId,
        rowId,
      }).pipe(Effect.mapError(mapRunPointOperationFailure));
      return Object.freeze({
        result,
        dependencyIsNew: true,
        pointMutation: Object.freeze({
          mode: "insert",
          tableId: table.tableId,
          rowId,
          dependency: result.dependency,
          overlay: Object.freeze({ kind: "none" }),
        }),
      });
    }

    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(table.attempt, point),
    );
    switch (point.overlayKind) {
      case "live": {
        const document = yield* decodeLivePointOverlayEvidenceEffect(
          table.attempt,
          point,
        );
        return Object.freeze({
          dependencyIsNew: false,
          result: Object.freeze({
            kind: "present",
            document,
            dependency,
          }),
        });
      }
      case "deleted":
        return Object.freeze({
          dependencyIsNew: false,
          result: Object.freeze({
            kind: "missing",
            document: null,
            dependency,
          }),
        });
      case "none": {
        const result = yield* getAppRowAtSnapshotInTransactionEffect(tx, {
          snapshotToken: table.attempt.snapshotToken,
          tableId: table.tableId,
          rowId,
        }).pipe(Effect.mapError(mapRunPointOperationFailure));
        if (!dependenciesEqual(dependency, result.dependency)) {
          return yield* Effect.fail(
            corruption(table.attempt, "pointDependencyChangedAtSnapshot"),
          );
        }
        return Object.freeze({ result, dependencyIsNew: false });
      }
    }
  },
  (work) => observeExecution("SessionJournalStore.readLogicalPoint", work),
);

const loadJournalPointRowEffect = Effect.fn(
  "SessionJournalStore.loadJournalPointRow",
)(function* (
  tx: AppRowTransaction,
  context: PointOperationPlanningContext,
  tableId: CatalogTableId,
  rowId: AppRowIdHexV1,
): Effect.fn.Return<
  typeof fxSystemTransactionJournalPoints.$inferSelect | undefined,
  SessionJournalRunPointOperationV1Error
> {
  const rows = yield* fromPointOperationPromise(() =>
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
          eq(fxSystemTransactionJournalPoints.tableId, tableId),
          eq(
            fxSystemTransactionJournalPoints.rowId,
            appRowIdHexV1ToBytes(rowId),
          ),
        ),
      )
      .limit(2),
  );
  if (rows.length > 1) {
    return yield* Effect.fail(
      mapRunPointOperationFailure(
        new Error("Journal point primary key returned duplicate rows."),
      ),
    );
  }
  return rows[0];
});

function developerFieldsFromDocument(
  document: CanonicalFlarexRuntimeValueV1,
): CanonicalFlarexRuntimeObjectV1 {
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - authenticated snapshot/live-overlay evidence establishes an app-document object before developer-field projection.
    throw new Error("Canonical app document is not an object.");
  }
  const fields: CanonicalFlarexRuntimeObjectV1 = {};
  for (const [field, value] of Object.entries(document)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return fields;
}

function creationTimeFromDocument(
  document: CanonicalFlarexRuntimeValueV1,
): AppCreationTimeV1 {
  if (!isCanonicalFlarexRuntimeObjectV1(document)) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - authenticated snapshot/live-overlay evidence establishes an app-document object before creation-time projection.
    throw new Error("Canonical app document is not an object.");
  }
  return decodeAppCreationTimeV1(document._creationTime);
}

function applyPatchChanges(
  fields: Record<string, CanonicalFlarexRuntimeValueV1>,
  changes: ReadonlyArray<LogicalPatchFieldV1>,
): void {
  for (const change of changes) {
    switch (change.kind) {
      case "remove":
        Reflect.deleteProperty(fields, change.field);
        break;
      case "set": {
        const value = normalizeFlarexValueJsonV1(change.valueJson).value;
        Object.defineProperty(fields, change.field, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        break;
      }
    }
  }
}

type CanonicalizePlannedDocumentResultV1 =
  | Readonly<{
      readonly kind: "valid";
      readonly document: CanonicalFlarexValueV1;
    }>
  | Readonly<{ readonly kind: "invalid" }>;

const tryCanonicalizeDocumentEffect = Effect.fnUntraced(
  function* (input: {
    readonly tableId: CatalogTableId;
    readonly rowId: AppRowIdHexV1;
    readonly creationTime: AppCreationTimeV1;
    readonly fields: unknown;
  }): Effect.fn.Return<CanonicalizePlannedDocumentResultV1> {
    return yield* Effect.tryPromise({
      try: () => canonicalizeAppDocumentV1(input),
      catch: (cause): unknown => cause,
    }).pipe(
      Effect.map((document) =>
        Object.freeze({ kind: "valid", document } as const),
      ),
      // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: protocol - classify the canonicalizeAppDocumentV1 Promise once; only codec/system-field errors mean invalid and unexpected failures remain defects.
      Effect.catch((cause) =>
        cause instanceof FlarexValueCodecV1Error ||
        cause instanceof AppDocumentSystemFieldV1Error
          ? Effect.succeed(Object.freeze({ kind: "invalid" } as const))
          : Effect.die(cause),
      ),
    );
  },
  (work) =>
    observeExecution("SessionJournalStore.tryCanonicalizeDocument", work),
);

function nextAppCreationTime(value: AppCreationTimeV1): AppCreationTimeV1 {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  if (low === 0xffff_ffff) {
    view.setUint32(0, high + 1, false);
    view.setUint32(4, 0, false);
  } else {
    view.setUint32(4, low + 1, false);
  }
  return decodeAppCreationTimeV1(view.getFloat64(0, false));
}

export function makePointOperations(
  owner: JournalAttemptOwner,
  resolveJournalTargetEffect: JournalTargetResolver,
  randomUuid: () => string,
) {
  const resolvePointTableEffect: SessionJournalStorePersistence["resolvePointTableEffect"] =
    Effect.fnUntraced(
      function* (attempt, tableNameInput) {
        const attemptState =
          typeof attempt === "object" && attempt !== null
            ? owner.readAttempt(attempt)
            : undefined;
        if (attemptState === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "attempt",
            }),
          );
        }
        const tableName = yield* decodeSchemaManifestAppTableNameEffect(
          tableNameInput,
        ).pipe(
          Effect.mapError(
            (cause) =>
              new InvalidSessionJournalInputV1Error({
                operation: "resolvePointTable",
                reason: "invalidTableName",
                cause,
              }),
          ),
        );
        const finite = owner.readFiniteRoot(attemptState);
        let tableId: CatalogTableId;
        if (finite !== undefined) {
          if (
            finite.status !== "open" ||
            !kernelContextMatchesAttempt(finite.initialContext, attemptState)
          )
            return yield* Effect.fail(
              corruption(attemptState, "journalStateInvalid"),
            );
          const declared =
            finite.applicationSchema.tableDefinitions.tables.find(
              (member) => member.logicalName === tableName,
            );
          if (declared === undefined)
            return yield* Effect.fail(
              new PinnedPointTableNotFoundV1Error({
                deploymentId: attemptState.selector.deploymentId,
                schemaVersionId: attemptState.schemaVersionId,
                tableName,
              }),
            );
          tableId = declared.tableId;
        } else {
          const resolved = yield* resolveJournalTargetEffect(attemptState);
          yield* admitExactRunningAttemptEffect(
            resolved,
            attemptState,
            "resolvePinnedPointTable",
          );
          tableId = yield* resolved.target[
            RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1
          ]({
            deploymentId: attemptState.selector.deploymentId,
            schemaVersionId: attemptState.schemaVersionId,
            tableName,
          }).pipe(Effect.mapError(mapPointTableResolutionFailure));
        }
        const state = Object.freeze({
          attempt: attemptState,
          tableName,
          tableId,
        } satisfies PinnedPointTableStateV1);
        return owner.issuePointTable(state);
      },
      (work) => observeExecution("SessionJournalStore.resolvePointTable", work),
    );

  const runPointOperationEffect: SessionJournalStorePersistence["runPointOperationEffect"] =
    Effect.fnUntraced(
      function* (table, operation, validator) {
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
        const request = yield* Effect.fromResult(
          captureStoredRequestResult(tableState, operation),
        );
        const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
        let documentRejection:
          ApplicationRevisionSyscallDocumentValidationV1Error | undefined;
        const finite = owner.readFiniteRoot(tableState.attempt);
        const localRead =
          finite !== undefined && request.kind !== "insert"
            ? readKnownFinitePoint(
                finite,
                tableState.tableId,
                decodeAppDocumentIdentityV1(request.documentId).rowId,
              )
            : undefined;
        const local =
          finite !== undefined &&
          (finite.status !== "open" ||
            finite.receipts.has(request.syscallSequence) ||
            (localRead !== undefined &&
              (request.kind === "get" ||
                finite.writableTables.has(tableState.tableId))));
        const checked = local
          ? Effect.gen(function* () {
              if (finite.status === "open")
                yield* recordFiniteApplicationDemandMetadataEffect(
                  tableState.attempt,
                  finite,
                  tableState.tableId,
                  request.kind !== "get",
                );
              return yield* runFinitePointOperationEffect(
                { kind: "local", context: finite.initialContext },
                tableState,
                request,
                requestEvidence,
                randomUuid,
                validator,
                finite,
                (error) => {
                  documentRejection = error;
                },
              );
            })
          : Effect.gen(function* () {
              const resolved = yield* resolveJournalTargetEffect(
                tableState.attempt,
              );
              if (finite === undefined)
                return yield* resolved.target[
                  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                ](
                  {
                    selector: tableState.attempt.selector,
                    preliminaryAuthority: resolved.authority,
                    executionClaim: tableState.attempt.executionClaim,
                  },
                  (tx, context) =>
                    runPointOperationInTransactionEffect(
                      tx,
                      context,
                      tableState,
                      request,
                      requestEvidence,
                      randomUuid,
                      validator,
                    ),
                );
              yield* recordFiniteApplicationDemandMetadataEffect(
                tableState.attempt,
                finite,
                tableState.tableId,
                request.kind !== "get",
              );
              return yield* runFinitePointOperationEffect(
                {
                  kind: "storage",
                  capture: finiteApplicationCapture(finite, tableState.attempt),
                  context: finite.initialContext,
                },
                tableState,
                request,
                requestEvidence,
                randomUuid,
                validator,
                finite,
                (error) => {
                  documentRejection = error;
                },
              );
            });
        const applied = yield* checked.pipe(
          Effect.onError((cause) =>
            Effect.sync(() => {
              const reason =
                cause.reasons.length === 1 ? cause.reasons[0] : undefined;
              // Only this call's pre-stage validator refusal is catchable. A failed
              // transaction/tail, defect, interruption or combined Cause still poisons
              // the finite root even if it contains a document validation failure.
              if (
                documentRejection !== undefined &&
                reason !== undefined &&
                Cause.isFailReason(reason) &&
                reason.error === documentRejection
              )
                return;
              const currentFinite = owner.readFiniteRoot(tableState.attempt);
              if (currentFinite !== undefined) {
                currentFinite.status = "aborted";
                discardFiniteRootEvidence(currentFinite);
              }
            }),
          ),
          Effect.mapError((error) =>
            error instanceof ExactRunningAttemptTransactionV1Error
              ? mapExactRunningAttemptTransactionFailure(error)
              : error,
          ),
        );
        if (finite?.status === "aborted") discardFiniteRootEvidence(finite);
        return projectPointOperationResult(applied);
      },
      (work) => observeExecution("SessionJournalStore.runPointOperation", work),
    );
  return Object.freeze({ resolvePointTableEffect, runPointOperationEffect });
}
