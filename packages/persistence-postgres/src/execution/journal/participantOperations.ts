import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type {
  SessionJournalAttempt,
  LogicalBorrowedParticipantOperation,
  SessionJournalStorePersistence,
  AdmittedCompletion,
} from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalPersistenceV1Error,
} from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import { observeExecution } from "../diagnostics/operation";
import {
  captureFiniteStorageEffect,
  FiniteStorageCaptureError,
} from "../finiteStorageCapture";
import type { FiniteStorageCaptureOperation } from "../finiteStorageCapture";
import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { commitEventLimits } from "../../commit/events/model";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
} from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_OPERATION_CALLS_V1,
  MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1,
  MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  SESSION_JOURNAL_FORMAT,
  canonicalizeAdmittedParticipantBindingV1Result,
  canonicalizeAdmittedSourceBundleResult,
  AdmittedParticipantWriteEventSchema,
} from "flarex-protocol/commit-protocol";
import type { SourceContribution } from "flarex-protocol/commit-protocol";
import { canonicalizeFlarexValueJsonV1Effect } from "flarex-protocol/value";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type {
  AppRowPointDependencyV1,
  AppRowTransaction,
} from "../../storage/documents/appRows";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { LogicalParticipantAdmissionError } from "../../storage/documents/logicalDocuments/participantErrors";
import {
  inspectLogicalParticipantAttemptAdmission,
  inspectLogicalParticipantAdmissionBundle,
  requireLogicalParticipantAttemptAdmissionInTransactionEffect,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { LogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import { withSharedLogicalSourceBindingChecks } from "../../storage/documents/logicalDocuments/sourceAdmission";
import { projectLogicalDocumentJournalContribution } from "../../storage/documents/logicalDocuments/journalContribution";
import {
  serializeLogicalParticipantDependencyEvidence,
  authenticatedGeneratedInsertionsResult,
} from "../../storage/documents/logicalDocuments/journalEvidence";
import type { LogicalPendingDocumentSeed } from "../../storage/documents/logicalDocuments/model";
import {
  encodeAdmittedFrameworkOperationV1Result,
  MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import type { AdmittedFrameworkOperationV1 } from "flarex-protocol/internal/admitted-framework-operation-v1";
import {
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
} from "../../database/schema";
import {
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
} from "../session/kernelContracts";
import type {
  ExactRunningAttemptKernelContextV1,
} from "../session/kernelContracts";
import {
  strictEventEnvelope,
  canonicalizeStoredRequestEffect,
  canonicalizeStoredOutcomeEffect,
  requireJson,
  sha256,
} from "./codecs";
import type { SessionJournalStoredRequest } from "./codecs";
import {
  addFiniteCounters,
  ZERO_COUNTER_DELTAS,
  firstExceededLimit,
  decodeJournalCountersResult,
} from "./operationModel";
import type {
  SessionJournalCounterDeltasV1,
  JournalPointOverlayV1,
  JournalPointMutationV1,
} from "./operationModel";
import {
  decodePointDependencyResult,
  dependenciesEqual,
  validateReceiptCardinalityResult,
  decodeAndVerifyReceiptRecordEffect,
  decodeAndVerifyLatestReceiptEffect,
  decodeLivePointOverlayEvidenceEffect,
  logicalDependencyFromPoint,
} from "./receiptEvidence";
import {
  loadLatestReceipt,
  loadReceiptAtSequence,
  persistAcceptedOperationEffect,
  persistPointMutationEffect,
} from "./journalPersistence";
import { discardFiniteRootEvidence } from "./finiteRoot";
import {
  captureSealProjectionRowsInTransaction,
  materializeSealCandidateEffect,
} from "./journalProjection";
import { mapAdmittedKernelFailure, corruption } from "./journalFailures";
import type { JournalAttemptOwner } from "./attemptOwner";
import type { JournalTargetResolver } from "./targetAdmission";

const captureAdmittedOperationRequestEffect = Effect.fnUntraced(
  function* (
    input: Readonly<{
      requestBytes: Uint8Array;
      requestSha256: Uint8Array;
    }>,
  ): Effect.fn.Return<
    Readonly<{ frame: AdmittedFrameworkOperationV1; sha256: Uint8Array }>,
    LogicalParticipantAdmissionError | SessionJournalPersistenceV1Error
  > {
    if (
      !(input.requestBytes instanceof Uint8Array) ||
      input.requestBytes.byteLength < 1 ||
      input.requestBytes.byteLength >
        MAX_ADMITTED_FRAMEWORK_OPERATION_BYTES_V1 ||
      !(input.requestSha256 instanceof Uint8Array) ||
      input.requestSha256.byteLength !== 32
    ) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidInput" }),
      );
    }
    const bytes = new Uint8Array(input.requestBytes);
    const suppliedDigest = new Uint8Array(input.requestSha256);
    const parsed = yield* Effect.try({
      try: (): unknown =>
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      catch: (cause) =>
        new LogicalParticipantAdmissionError({ reason: "invalidInput", cause }),
    });
    const encoded = yield* Effect.fromResult(
      encodeAdmittedFrameworkOperationV1Result(parsed).pipe(
        Result.mapError(
          (cause) =>
            new LogicalParticipantAdmissionError({
              reason: "invalidInput",
              cause,
            }),
        ),
      ),
    );
    if (!bytesEqual(bytes, encoded.bytes)) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidInput" }),
      );
    }
    const digest = yield* Effect.tryPromise({
      try: () => sha256(bytes),
      catch: (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
    });
    if (!bytesEqual(digest, suppliedDigest)) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidInput" }),
      );
    }
    return Object.freeze({ frame: encoded.operation, sha256: digest });
  },
  (work) =>
    observeExecution(
      "SessionJournalStore.captureAdmittedOperationRequest",
      work,
    ),
);

/** The caller owns the transaction-local sharing scope. Every source still
 * authenticates its own issuer, selected head and request pins. */
const requireAdmittedBundleSourcesInTransactionEffect = Effect.fnUntraced(
  function* (
    bundle: LogicalParticipantAdmissionBundle,
    attempt: SessionJournalAttempt,
    request: Extract<
      SessionJournalStoredRequest,
      { readonly kind: "admittedLogicalOperation" }
    >,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ) {
    const selected = inspectLogicalParticipantAdmissionBundle(
      bundle,
      attempt,
      request.participant,
      request.method,
      request.profileRevision,
    );
    if (
      selected === null ||
      selected.admissions.length !== request.sources.length
    ) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
      );
    }
    const states = [];
    for (const [ordinal, admission] of selected.admissions.entries()) {
      const methods = selected.sourceMethods[ordinal]!;
      const expected = request.sources[ordinal];
      const state =
        yield* requireLogicalParticipantAttemptAdmissionInTransactionEffect(
          admission,
          attempt,
          methods[0]!,
          tx,
          authority,
          clock,
        );
      if (
        expected === undefined ||
        expected.sourceKey !== state.sourceKey ||
        expected.sourceSha256Hex !== state.sourceSha256 ||
        expected.bindingHead.sequence !== state.head.sequence ||
        expected.bindingHead.sha256 !== state.head.sha256 ||
        expected.methods.length !== methods.length ||
        expected.methods.some(
          (method, position) => method !== methods[position],
        )
      ) {
        return yield* Effect.fail(
          new LogicalParticipantAdmissionError({
            reason: "invalidAuthority",
          }),
        );
      }
      states.push(state);
    }
    return Object.freeze(states);
  },
  (work) =>
    observeExecution("SessionJournalStore.requireAdmittedBundleSources", work),
);

const requireAdmittedBundleInTransactionEffect = Effect.fnUntraced(
  function* (
    bundle: LogicalParticipantAdmissionBundle,
    attempt: SessionJournalAttempt,
    request: Extract<
      SessionJournalStoredRequest,
      { readonly kind: "admittedLogicalOperation" }
    >,
    tx: FlarexMetadataTransaction,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ) {
    return yield* withSharedLogicalSourceBindingChecks(tx, () =>
      requireAdmittedBundleSourcesInTransactionEffect(
        bundle,
        attempt,
        request,
        tx,
        authority,
        clock,
      ),
    );
  },
  (work) => observeExecution("SessionJournalStore.requireAdmittedBundle", work),
);

const preflightAdmittedOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.preflightAdmittedOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attemptHandle: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "admittedLogicalOperation" }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
) {
  const root = context.journalRoot;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  const latest = yield* Effect.tryPromise({
    try: () => loadLatestReceipt(tx, context),
    catch: (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  });
  const last = CommitFinalSyscallSequenceV1Schema.make(
    root.lastSyscallSequence,
  );
  yield* Effect.fromResult(
    validateReceiptCardinalityResult(attempt, last, latest),
  );
  if (root.state === "operation_invoking") {
    if (latest === undefined) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptSequenceMismatch"),
      );
    }
    const marker = yield* decodeAndVerifyReceiptRecordEffect(
      attempt,
      latest,
      undefined,
    );
    if (
      marker.request.kind !== "admittedLogicalOperation" ||
      marker.outcome.kind !== "admittedLogicalInvoking" ||
      latest.participantBindingSha256 === null
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    return Object.freeze({
      kind: "resolved" as const,
      result: Object.freeze({
        kind: "stateRejected" as const,
        issue: Object.freeze({ reason: "operationPending" as const }),
      }),
    });
  }
  if (
    root.state === "sealed" ||
    root.state === "failed" ||
    root.state === "operation_failed" ||
    root.state === "relation_conflicted"
  ) {
    return Object.freeze({
      kind: "resolved" as const,
      result: Object.freeze({
        kind: "stateRejected" as const,
        issue: Object.freeze({
          reason:
            root.state === "sealed"
              ? ("journalSealed" as const)
              : root.state === "relation_conflicted"
                ? ("journalRelationConflicted" as const)
                : ("journalFailed" as const),
        }),
      }),
    });
  }
  if (request.syscallSequence <= last) {
    const retained = yield* Effect.tryPromise({
      try: () => loadReceiptAtSequence(tx, context, request.syscallSequence),
      catch: (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
    });
    if (retained === undefined) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptSequenceMismatch"),
      );
    }
    if (
      retained.participantBindingSha256 === null ||
      !bytesEqual(retained.participantBindingSha256, bindingDigest) ||
      !bytesEqual(retained.requestSha256, requestEvidence.sha256)
    ) {
      return Object.freeze({
        kind: "resolved" as const,
        result: Object.freeze({
          kind: "sequenceRejected" as const,
          issue: Object.freeze({
            reason: "requestMismatch" as const,
            syscallSequence: request.syscallSequence,
          }),
        }),
      });
    }
    const outcome = yield* decodeAndVerifyLatestReceiptEffect(
      attempt,
      retained,
      request,
    );
    if (outcome.kind === "admittedLogicalResult") {
      return Object.freeze({
        kind: "resolved" as const,
        result: Object.freeze({
          kind: "completed" as const,
          delivery: "replayed" as const,
          result: outcome.result,
        }),
      });
    }
    if (outcome.kind === "admittedLogicalError") {
      return Object.freeze({
        kind: "resolved" as const,
        result: Object.freeze({
          kind: "stateRejected" as const,
          issue: Object.freeze({ reason: "journalFailed" as const }),
        }),
      });
    }
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptEvidenceInvalid"),
    );
  }
  if (request.syscallSequence !== last + 1n) {
    return Object.freeze({
      kind: "resolved" as const,
      result: Object.freeze({
        kind: "sequenceRejected" as const,
        issue: Object.freeze({
          reason: "sequenceGap" as const,
          actual: request.syscallSequence,
          expectedNext: CommitSyscallSequenceV1Schema.make(last + 1n),
        }),
      }),
    });
  }
  if (last >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)) {
    return Object.freeze({
      kind: "resolved" as const,
      result: Object.freeze({
        kind: "sequenceRejected" as const,
        issue: Object.freeze({
          reason: "sequenceExhausted" as const,
          lastAccepted: last,
        }),
      }),
    });
  }
  const admittedStates = yield* requireAdmittedBundleInTransactionEffect(
    admission,
    attemptHandle,
    request,
    tx,
    authority,
    context.scopeClock,
  );
  const tableIds = admittedStates.flatMap((state) => [...state.tableIds]);
  if (tableIds.length === 0) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({
        reason: "unsupportedProfile",
      }),
    );
  }
  const rows = yield* Effect.tryPromise({
    try: () =>
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
            inArray(fxSystemTransactionJournalPoints.tableId, tableIds),
            ne(fxSystemTransactionJournalPoints.overlayKind, "none"),
          ),
        )
        .limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1),
    catch: (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  });
  if (rows.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(
      corruption(attempt, "pointDependencyCountMismatch"),
    );
  }
  const retainedInsertions = rows.some(
    (row) => row.dependencyKind === "generated_insertion",
  )
    ? yield* Effect.gen(function* () {
        const snapshot = yield* Effect.tryPromise({
          try: () =>
            captureSealProjectionRowsInTransaction(tx, attempt, {
              scopeUuid: context.scopeUuid,
              root: context.journalRoot,
            }),
          catch: (cause) =>
            new SessionJournalPersistenceV1Error({
              operation: "runAdmittedOperation",
              cause,
            }),
        });
        const candidate = yield* materializeSealCandidateEffect(attempt, {
          ...snapshot,
          root: context.journalRoot,
        });
        return yield* Effect.fromResult(
          authenticatedGeneratedInsertionsResult(
            candidate.journal.participantOperations,
          ).pipe(
            Result.mapError((cause) =>
              corruption(attempt, "logicalWriteEventInvalid", cause),
            ),
          ),
        );
      })
    : new Map<
        import("flarex-protocol/app-document-id").AppDocumentIdV1,
        import("flarex-protocol/commit-protocol").AuthenticatedGeneratedInsertion
      >();
  const pendingRows: LogicalPendingDocumentSeed[] = [];
  for (const row of rows) {
    const documentId = appDocumentIdV1FromRowIdentity({
      tableId: row.tableId,
      rowId: appRowIdHexV1FromBytes(row.rowId),
    });
    const intent = retainedInsertions.get(documentId);
    const evidence =
      row.dependencyKind === "generated_insertion"
        ? intent === undefined || row.dependencyRevisionCommitSeq !== null
          ? yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"))
          : {
              kind: "generatedInsertion" as const,
              effectOrdinal: intent.effectOrdinal,
              origin: intent.origin,
            }
        : logicalDependencyFromPoint(
            yield* Effect.fromResult(decodePointDependencyResult(attempt, row)),
          ).observed;
    if (row.overlayKind === "live" && row.overlayCreationTime === null) {
      return yield* Effect.fail(
        corruption(attempt, "liveOverlayEvidenceMissing"),
      );
    }
    const overlay =
      row.overlayKind === "live"
        ? Object.freeze({
            kind: "live" as const,
            creationTime: decodeAppCreationTimeV1(row.overlayCreationTime),
            document: yield* decodeLivePointOverlayEvidenceEffect(attempt, row),
          })
        : Object.freeze({ kind: "deleted" as const });
    pendingRows.push(
      Object.freeze({
        tableId: row.tableId,
        rowId: appRowIdHexV1FromBytes(row.rowId),
        evidence,
        overlay,
      }),
    );
  }
  return Object.freeze({
    kind: "ready" as const,
    pendingRows: Object.freeze(pendingRows),
  });
});

const persistAdmittedFailureInTransactionEffect = Effect.fn(
  "SessionJournalStore.persistAdmittedFailure",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attempt: SessionJournalAttemptStateV1,
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "admittedLogicalOperation" }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
  reason: string,
  usage: Readonly<{ workBytes: number; workCalls: number }>,
) {
  if (
    context.journalRoot.state !== "operation_invoking" ||
    BigInt(context.journalRoot.lastSyscallSequence) !==
      BigInt(request.syscallSequence)
  ) {
    return yield* Effect.fail(
      corruption(attempt, "journalRootOperationUpdateMismatch"),
    );
  }
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, context.journalRoot),
  );
  if (
    !Number.isSafeInteger(usage.workBytes) ||
    usage.workBytes < 0 ||
    !Number.isSafeInteger(usage.workCalls) ||
    usage.workCalls < 0
  ) {
    return yield* Effect.fail(corruption(attempt, "journalCountersInvalid"));
  }
  const outcome = Object.freeze({
    kind: "admittedLogicalError" as const,
    reason,
    workBytes: usage.workBytes,
    workCalls: usage.workCalls,
  });
  yield* persistAcceptedOperationEffect(
    tx,
    context,
    request,
    requestEvidence,
    outcome,
    counters,
    ZERO_COUNTER_DELTAS,
    {
      state: "operation_failed",
      failureDimension: null,
      participantWorkBytes: usage.workBytes,
      participantWorkCalls: usage.workCalls,
    },
    (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
    bindingDigest,
  );
});

const persistAdmittedInvocationMarkerInTransactionEffect = Effect.fn(
  "SessionJournalStore.markAdmittedInvocation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attemptState: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attempt: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "admittedLogicalOperation" }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
) {
  const root = context.journalRoot;
  if (
    root.journalFormat !== SESSION_JOURNAL_FORMAT ||
    root.state !== "open" ||
    root.lastSyscallSequence + 1n !== request.syscallSequence
  ) {
    return yield* Effect.fail(
      corruption(attemptState, "journalRootOperationUpdateMismatch"),
    );
  }
  yield* requireAdmittedBundleInTransactionEffect(
    admission,
    attempt,
    request,
    tx,
    authority,
    context.scopeClock,
  );
  const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect({
    kind: "admittedLogicalInvoking",
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
    ),
  );
  const evidenceBytes =
    requestEvidence.canonicalBytes.byteLength +
    outcomeEvidence.canonicalBytes.byteLength;
  // Reserve room for the bounded terminal error receipt before calling the
  // native service; a full result can then fail closed without losing poison.
  if (
    root.receiptEvidenceBytes + evidenceBytes + 1_024 >
    MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1
  ) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({
        reason: "unsupportedProfile",
      }),
    );
  }
  yield* runDrizzleStatementEffect(
    tx.insert(fxSystemTransactionJournalReceipts).values({
      scopeUuid: context.scopeUuid,
      sessionId: context.anchor.sessionId,
      attemptFence: context.anchor.attemptFence,
      lastSyscallSequence: request.syscallSequence,
      operationKind: request.kind,
      participantBindingSha256: new Uint8Array(bindingDigest),
      requestCodecVersion: 2,
      requestBytes: new Uint8Array(requestEvidence.canonicalBytes),
      requestSha256: new Uint8Array(requestEvidence.sha256),
      outcomeKind: "admittedLogicalInvoking",
      outcomeCodecVersion: 2,
      outcomeBytes: new Uint8Array(outcomeEvidence.canonicalBytes),
      outcomeSha256: new Uint8Array(outcomeEvidence.sha256),
      createdAt: context.databaseNow,
      updatedAt: context.databaseNow,
    }),
    (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  );
  const changed = yield* runDrizzleStatementEffect(
    tx
      .update(fxSystemTransactionJournals)
      .set({
        state: "operation_invoking",
        lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(
          request.syscallSequence,
        ),
        receiptEvidenceBytes: root.receiptEvidenceBytes + evidenceBytes,
        updatedAt: context.databaseNow,
      })
      .where(
        and(
          eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
          eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
          eq(
            fxSystemTransactionJournals.attemptFence,
            context.anchor.attemptFence,
          ),
          eq(fxSystemTransactionJournals.state, "open"),
          eq(
            fxSystemTransactionJournals.lastSyscallSequence,
            root.lastSyscallSequence,
          ),
        ),
      )
      .returning({ state: fxSystemTransactionJournals.state }),
    (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  );
  if (changed.length !== 1) {
    return yield* Effect.fail(
      corruption(attemptState, "journalRootOperationUpdateMismatch"),
    );
  }
});

const prepareAdmittedContributionsEffect = Effect.fn(
  "SessionJournalStore.prepareAdmittedContributions",
)(function* (
  attempt: SessionJournalAttempt,
  bundle: LogicalParticipantAdmissionBundle,
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "admittedLogicalOperation" }
  >,
  completed: AdmittedCompletion,
  contribution: Effect.Success<
    ReturnType<typeof projectLogicalDocumentJournalContribution>
  >,
) {
  const selected = inspectLogicalParticipantAdmissionBundle(
    bundle,
    attempt,
    request.participant,
    request.method,
    request.profileRevision,
  );
  if (
    selected === null ||
    selected.admissions.length !== request.sources.length
  ) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  }
  // The aggregate checked working set owns global attempt order. Every
  // projected point, effect and indexed dependency has exactly one source.
  for (const [ordinal, effect] of contribution.effects.entries()) {
    if (effect.effectOrdinal !== ordinal) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidInput" }),
      );
    }
  }
  yield* serializeLogicalParticipantDependencyEvidence(completed.changes);
  const states = selected.admissions.map((admission, ordinal) =>
    inspectLogicalParticipantAttemptAdmission(
      admission,
      attempt,
      selected.sourceMethods[ordinal]![0]!,
    ),
  );
  if (states.some((state) => state === null)) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  }
  const owners = states.map((state) => state!);
  const ownerOfTable = (tableId: CatalogTableId) =>
    owners.findIndex((state) => state.tableIds.has(tableId));
  if (
    contribution.points.some(
      (point) => ownerOfTable(point.observation.tableId) < 0,
    ) ||
    contribution.effects.some((effect) => ownerOfTable(effect.tableId) < 0) ||
    completed.changes.indexReads.some(
      (read) =>
        owners.filter((state) =>
          state.indexes.some(
            (index) =>
              index.indexDefinitionId === read.definition.indexDefinitionId,
          ),
        ).length !== 1,
    ) ||
    completed.changes.pageReads.some(
      (read) =>
        owners.filter((state) =>
          state.indexes.some(
            (index) =>
              index.indexDefinitionId === read.definition.indexDefinitionId,
          ),
        ).length !== 1,
    ) ||
    completed.changes.uniqueReads.some(
      (read) =>
        owners.filter((state) =>
          state.unique.some(
            (constraint) =>
              constraint.uniqueConstraintDefinitionId === read.constraintId,
          ),
        ).length !== 1,
    ) ||
    completed.eventIntents.some(
      (event) =>
        event.sourceKey !== null &&
        !request.sources.some((source) => source.sourceKey === event.sourceKey),
    )
  ) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
    );
  }
  const sources: SourceContribution[] = [];
  for (const [ordinal, source] of request.sources.entries()) {
    const owner = owners[ordinal]!;
    const dependency = yield* serializeLogicalParticipantDependencyEvidence({
      ...completed.changes,
      dependencies: completed.changes.dependencies.filter((point) =>
        owner.tableIds.has(point.tableId),
      ),
      indexReads: completed.changes.indexReads.filter((read) =>
        owner.indexes.some(
          (index) =>
            index.indexDefinitionId === read.definition.indexDefinitionId,
        ),
      ),
      pageReads: completed.changes.pageReads.filter((read) =>
        owner.indexes.some(
          (index) =>
            index.indexDefinitionId === read.definition.indexDefinitionId,
        ),
      ),
      uniqueReads: completed.changes.uniqueReads.filter((read) =>
        owner.unique.some(
          (constraint) =>
            constraint.uniqueConstraintDefinitionId === read.constraintId,
        ),
      ),
      ...(completed.changes.metadataDependencies === undefined
        ? {}
        : {
            metadataDependencies: completed.changes.metadataDependencies.filter(
              (metadataDependency) =>
                metadataDependency.ownerKey === owner.sourceKey,
            ),
          }),
    });
    sources.push(
      Object.freeze({
        ...source,
        effects: Object.freeze(
          contribution.effects.filter((effect) =>
            owner.tableIds.has(effect.tableId),
          ),
        ),
        dependencyEvidence: dependency.evidence,
      }),
    );
  }
  return Object.freeze(sources);
});

/** Framework callbacks remain outside SQL; both durable-operation and finite
 * roots use the same validation and contribution projection. */
const prepareAdmittedCompletionEffect = Effect.fn(
  "SessionJournalStore.prepareAdmittedCompletion",
)(function* (
  attempt: SessionJournalAttempt,
  admission: LogicalParticipantAdmissionBundle,
  request: Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "admittedLogicalOperation";
    }
  >,
  frame: AdmittedFrameworkOperationV1,
  borrowed: LogicalBorrowedParticipantOperation,
) {
  const completed = yield* borrowed.invoke(frame.operation, frame.args);
  if (completed.payloadPreferenceCleanups?.length) return yield* Effect.fail(
    new LogicalParticipantAdmissionError({ reason: "unsupportedProfile" }));
  if (completed.eventIntents.length > commitEventLimits.messages) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({
        reason: "invalidInput",
      }),
    );
  }
  for (const event of completed.eventIntents) {
    yield* Effect.fromResult(
      strictEventEnvelope(event.intent).pipe(
        Result.mapError(
          (cause) =>
            new LogicalParticipantAdmissionError({
              reason: "invalidInput",
              cause,
            }),
        ),
      ),
    );
  }
  const contribution = yield* projectLogicalDocumentJournalContribution(
    completed.changes,
  );
  const sources = yield* prepareAdmittedContributionsEffect(
    attempt,
    admission,
    request,
    completed,
    contribution,
  );
  return Object.freeze({ completed, contribution, sources });
});

const appendAdmittedOperationInTransactionEffect = Effect.fn(
  "SessionJournalStore.appendAdmittedOperation",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  attemptState: SessionJournalAttemptStateV1,
  admission: LogicalParticipantAdmissionBundle,
  attempt: SessionJournalAttempt,
  authority: TrustedScopeAuthority,
  request: Extract<
    SessionJournalStoredRequest,
    { readonly kind: "admittedLogicalOperation" }
  >,
  requestEvidence: CanonicalFlarexValueV1,
  bindingDigest: Uint8Array,
  completed: AdmittedCompletion,
  contribution: Effect.Success<
    ReturnType<typeof projectLogicalDocumentJournalContribution>
  >,
  sources: readonly SourceContribution[],
) {
  const root = context.journalRoot;
  if (
    root.journalFormat !== SESSION_JOURNAL_FORMAT ||
    root.state !== "operation_invoking" ||
    BigInt(root.lastSyscallSequence) !== BigInt(request.syscallSequence)
  ) {
    return yield* Effect.fail(
      corruption(attemptState, "journalRootOperationUpdateMismatch"),
    );
  }
  yield* requireAdmittedBundleInTransactionEffect(
    admission,
    attempt,
    request,
    tx,
    authority,
    context.scopeClock,
  );
  const principalRows = yield* Effect.tryPromise({
    try: () =>
      tx
        .select({
          digest: fxSystemTransactionSessions.identityAccessPolicySha256,
        })
        .from(fxSystemTransactionSessions)
        .where(
          and(
            eq(fxSystemTransactionSessions.scopeUuid, context.scopeUuid),
            eq(fxSystemTransactionSessions.sessionId, context.anchor.sessionId),
            eq(
              fxSystemTransactionSessions.attemptFence,
              context.anchor.attemptFence,
            ),
          ),
        )
        .limit(2),
    catch: (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  });
  const admissionEvidence = inspectLogicalParticipantAdmissionBundle(
    admission,
    attempt,
    request.participant,
    request.method,
    request.profileRevision,
  );
  const firstSource =
    admissionEvidence === null
      ? null
      : inspectLogicalParticipantAttemptAdmission(
          admissionEvidence.admissions[0]!,
          attempt,
          admissionEvidence.sourceMethods[0]![0]!,
        );
  if (
    firstSource === null ||
    principalRows.length !== 1 ||
    encodeBytesToLowercaseHex(principalRows[0]!.digest) !==
      firstSource.root.principalDigest
  ) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({
        reason: "invalidAuthority",
      }),
    );
  }
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attemptState, root),
  );
  const existingPoints = yield* Effect.tryPromise({
    try: () =>
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
          ),
        )
        .limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1),
    catch: (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "runAdmittedOperation",
        cause,
      }),
  });
  if (existingPoints.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(
      corruption(attemptState, "pointDependencyCountMismatch"),
    );
  }
  const existingByIdentity = new Map<string, (typeof existingPoints)[number]>(
    existingPoints.map(
      (row) =>
        [`${row.tableId}/${appRowIdHexV1FromBytes(row.rowId)}`, row] as const,
    ),
  );
  const mutations: JournalPointMutationV1[] = [];
  let newPoints = 0;
  for (const point of contribution.points) {
    const observation = point.observation;
    const key = `${observation.tableId}/${observation.rowId}`;
    const existing = existingByIdentity.get(key);
    const identity = Object.freeze({
      scopeId: attemptState.selector.scopeId,
      tableId: observation.tableId,
      rowId: observation.rowId,
    });
    const generated = observation.dependency.kind === "generatedInsertion";
    const observed =
      observation.dependency.kind === "appRowPoint"
        ? observation.dependency.observed
        : {
            kind: "missing" as const,
            basis: { kind: "noVisibleRevision" as const },
          };
    const dependency: AppRowPointDependencyV1 =
      observed.kind === "present"
        ? Object.freeze({
            kind: "present" as const,
            identity,
            revisionCommitSeq: observed.revisionCommitSeq,
          })
        : Object.freeze({
            kind: "missing" as const,
            identity,
            basis: observed.basis,
          });
    if (existing !== undefined) {
      if (existing.dependencyKind === "generated_insertion") {
        if (
          !generated ||
          observation.dependency.kind !== "generatedInsertion" ||
          observation.dependency.origin === undefined ||
          existing.dependencyRevisionCommitSeq !== null
        )
          return yield* Effect.fail(
            corruption(attemptState, "pointDependencyCountMismatch"),
          );
      } else {
        const prior = yield* Effect.fromResult(
          decodePointDependencyResult(attemptState, existing),
        );
        if (
          !(
            generated &&
            prior.kind === "missing" &&
            prior.basis.kind === "noVisibleRevision"
          ) &&
          !dependenciesEqual(prior, dependency)
        ) {
          return yield* Effect.fail(
            corruption(attemptState, "pointDependencyCountMismatch"),
          );
        }
      }
    } else {
      newPoints += 1;
    }
    if (point.overlay.kind === "retain" && existing !== undefined) continue;
    const overlay: JournalPointOverlayV1 =
      point.overlay.kind === "retain"
        ? Object.freeze({ kind: "none" as const })
        : point.overlay.kind === "deleted"
          ? Object.freeze({ kind: "deleted" as const })
          : Object.freeze({
              kind: "live" as const,
              creationTime: point.overlay.creationTime,
              document: point.overlay.document,
            });
    mutations.push(
      Object.freeze({
        mode:
          existing === undefined ? ("insert" as const) : ("update" as const),
        tableId: observation.tableId,
        rowId: observation.rowId,
        dependency,
        overlay,
        ...(generated && existing === undefined
          ? { generatedInsertion: true as const }
          : {}),
      }),
    );
  }
  const preparedEvents: Array<
    Readonly<{
      effectOrdinal: number;
      bytes: Uint8Array;
      sha256: Uint8Array;
    }>
  > = [];
  let writeSemanticBytes = 0;
  let eventEvidenceBytes = 0;
  for (const effect of contribution.effects) {
    const source = sources.find((member) =>
      member.effects.some(
        (candidate) => candidate.effectOrdinal === effect.effectOrdinal,
      ),
    );
    if (source === undefined) {
      return yield* Effect.fail(
        new LogicalParticipantAdmissionError({ reason: "invalidAuthority" }),
      );
    }
    const encoded = Schema.encodeSync(AdmittedParticipantWriteEventSchema)({
      kind: "logicalDocument",
      syscallSequence: request.syscallSequence,
      sourceBindingSha256Hex: source.sourceBindingSha256Hex,
      effect,
    });
    const json = requireJson(encoded);
    const evidence = yield* canonicalizeFlarexValueJsonV1Effect(json).pipe(
      Effect.mapError(
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "runAdmittedOperation",
            cause,
          }),
      ),
    );
    preparedEvents.push(
      Object.freeze({
        effectOrdinal: effect.effectOrdinal,
        bytes: new Uint8Array(evidence.canonicalBytes),
        sha256: new Uint8Array(evidence.sha256),
      }),
    );
    eventEvidenceBytes += evidence.canonicalBytes.byteLength;
    if (effect.after !== null) {
      const after = yield* canonicalizeFlarexValueJsonV1Effect(
        effect.after,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new SessionJournalPersistenceV1Error({
              operation: "runAdmittedOperation",
              cause,
            }),
        ),
      );
      writeSemanticBytes += after.semanticSizeBytes;
    }
  }
  if (
    !Number.isSafeInteger(completed.workBytes) ||
    completed.workBytes < 0 ||
    !Number.isSafeInteger(completed.workCalls) ||
    completed.workCalls < 0
  ) {
    return yield* Effect.fail(
      corruption(attemptState, "journalCountersInvalid"),
    );
  }
  const outcome = Object.freeze({
    kind: "admittedLogicalResult" as const,
    result: completed.result,
    events: completed.eventIntents,
    sourceDependencies: sources.map((source) => ({
      sourceKey: source.sourceKey,
      evidence: source.dependencyEvidence,
    })),
    workBytes: completed.workBytes,
    workCalls: completed.workCalls,
  });
  const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(outcome).pipe(
    Effect.mapError(
      (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
    ),
  );
  const invokingEvidence = yield* canonicalizeStoredOutcomeEffect({
    kind: "admittedLogicalInvoking",
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
    ),
  );
  const deltas = Object.freeze({
    ...ZERO_COUNTER_DELTAS,
    operationCalls: 0,
    pointDependencyCount: newPoints,
    writeOperations: contribution.effects.length,
    writeSemanticBytes,
    materialWriteEventEvidenceBytes: eventEvidenceBytes,
    receiptEvidenceBytes:
      outcomeEvidence.canonicalBytes.byteLength -
      invokingEvidence.canonicalBytes.byteLength,
  } satisfies SessionJournalCounterDeltasV1);
  const limit = firstExceededLimit(counters, deltas);
  if (
    limit !== undefined ||
    root.participantWorkBytes + completed.workBytes >
      MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1 ||
    root.participantWorkCalls + completed.workCalls >
      MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1
  ) {
    return yield* Effect.fail(
      new LogicalParticipantAdmissionError({
        reason: "unsupportedProfile",
      }),
    );
  }
  yield* Effect.gen(function* () {
    for (const mutation of mutations)
      yield* persistPointMutationEffect(
        tx,
        context,
        mutation,
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "runAdmittedOperation",
            cause,
          }),
      );
    for (const event of preparedEvents) {
      yield* runDrizzleStatementEffect(
        tx.insert(fxSystemTransactionJournalWriteEvents).values({
          scopeUuid: context.scopeUuid,
          sessionId: context.anchor.sessionId,
          attemptFence: context.anchor.attemptFence,
          syscallSequence: request.syscallSequence,
          effectOrdinal: event.effectOrdinal,
          writeKind: "logicalDocument",
          eventCodecVersion: 2,
          eventBytes: event.bytes,
          eventSha256: event.sha256,
          createdAt: context.databaseNow,
        }),
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "runAdmittedOperation",
            cause,
          }),
      );
    }
    yield* persistAcceptedOperationEffect(
      tx,
      context,
      request,
      requestEvidence,
      outcome,
      counters,
      deltas,
      {
        state: "open",
        failureDimension: null,
        participantWorkBytes: completed.workBytes,
        participantWorkCalls: completed.workCalls,
      },
      (cause) =>
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause,
        }),
      bindingDigest,
    );
  });
  return Object.freeze({
    kind: "completed" as const,
    delivery: "executed" as const,
    result: completed.result,
  });
});

export function makeParticipantOperationRunner(
  owner: JournalAttemptOwner,
  resolveJournalTargetEffect: JournalTargetResolver,
) {
  const runAdmittedOperationEffect: SessionJournalStorePersistence["runAdmittedOperationEffect"] =
    Effect.fnUntraced(
      function* (attempt, admission, input, borrow) {
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
        const admitted = inspectLogicalParticipantAdmissionBundle(
          admission,
          attempt,
          input.participant,
          input.method,
          input.profileRevision,
        );
        if (admitted === null) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "attempt",
            }),
          );
        }
        if (
          attemptState.executionProfile === "finiteRoot" &&
          owner.readFiniteRoot(attemptState)?.status !== "open"
        )
          return Object.freeze({
            kind: "stateRejected",
            issue: Object.freeze({ reason: "journalFailed" }),
          });
        const sources = [];
        for (const [ordinal, source] of admitted.admissions.entries()) {
          const state = inspectLogicalParticipantAttemptAdmission(
            source,
            attempt,
            admitted.sourceMethods[ordinal]![0]!,
          );
          if (
            state === null ||
            state.root.scopeId !== attemptState.selector.scopeId ||
            state.root.sessionId !== attemptState.selector.sessionId ||
            state.root.attemptFence !== attemptState.selector.attemptFence ||
            state.root.snapshotCommitSeq !==
              attemptState.snapshotToken.commitSeq ||
            state.root.schemaVersionId !== attemptState.schemaVersionId ||
            state.root.executionProfile !== attemptState.executionProfile
          ) {
            return yield* Effect.fail(
              new InvalidSessionJournalCapabilityV1Error({
                capability: "attempt",
              }),
            );
          }
          const binding = yield* Effect.fromResult(
            canonicalizeAdmittedParticipantBindingV1Result({
              scopeId: state.root.scopeId,
              sessionId: state.root.sessionId,
              attemptFence: state.root.attemptFence,
              snapshotCommitSeq: state.root.snapshotCommitSeq,
              schemaVersionId: state.root.schemaVersionId,
              principalDigest: state.root.principalDigest,
              participant: input.participant,
              method: input.method,
              sourceKey: state.sourceKey,
              sourceSha256Hex: state.sourceSha256,
              bindingHead: state.bindingHead,
            }).pipe(
              Result.mapError(
                (cause) =>
                  new LogicalParticipantAdmissionError({
                    reason: "invalidAuthority",
                    cause,
                  }),
              ),
            ),
          );
          const sourceBindingDigest = yield* Effect.tryPromise({
            try: () => sha256(binding.bytes),
            catch: (cause) =>
              new SessionJournalPersistenceV1Error({
                operation: "runAdmittedOperation",
                cause,
              }),
          });
          sources.push(
            Object.freeze({
              sourceKey: state.sourceKey,
              sourceSha256Hex: state.sourceSha256,
              bindingHead: state.bindingHead,
              sourceBindingSha256Hex:
                encodeBytesToLowercaseHex(sourceBindingDigest),
              methods: admitted.sourceMethods[ordinal]!,
            }),
          );
        }
        const bundle = yield* Effect.fromResult(
          canonicalizeAdmittedSourceBundleResult({
            participant: input.participant,
            method: input.method,
            profileRevision: input.profileRevision,
            sources,
          }).pipe(
            Result.mapError(
              (cause) =>
                new LogicalParticipantAdmissionError({
                  reason: "invalidAuthority",
                  cause,
                }),
            ),
          ),
        );
        const bindingDigest = yield* Effect.tryPromise({
          try: () => sha256(bundle.bytes),
          catch: (cause) =>
            new SessionJournalPersistenceV1Error({
              operation: "runAdmittedOperation",
              cause,
            }),
        });
        const captured = yield* captureAdmittedOperationRequestEffect(input);
        if (
          captured.frame.participant !== input.participant ||
          captured.frame.operation !== input.method
        ) {
          return yield* Effect.fail(
            new LogicalParticipantAdmissionError({ reason: "invalidInput" }),
          );
        }
        const request = Object.freeze({
          format: "flarex.session-journal-syscall" as const,
          codecVersion: 2 as const,
          kind: "admittedLogicalOperation" as const,
          syscallSequence: input.syscallSequence,
          participant: input.participant,
          method: input.method,
          profileRevision: input.profileRevision,
          sources,
          admissionBundleSha256Hex: encodeBytesToLowercaseHex(bindingDigest),
          requestSha256Hex: encodeBytesToLowercaseHex(captured.sha256),
          frame: captured.frame,
        } satisfies Extract<
          SessionJournalStoredRequest,
          {
            readonly kind: "admittedLogicalOperation";
          }
        >);
        const requestEvidence = yield* canonicalizeStoredRequestEffect(request);
        const inFlightKey = `${attemptState.selector.scopeId}/${attemptState.selector.sessionId}/${attemptState.selector.attemptFence}`;
        if (owner.isAdmittedOperationInFlight(inFlightKey)) {
          return Object.freeze({
            kind: "stateRejected",
            issue: Object.freeze({
              reason: "operationPending",
            }),
          });
        }
        owner.startAdmittedOperation(inFlightKey);
        return yield* Effect.gen(function* () {
          const finite = owner.readFiniteRoot(attemptState);
          if (attemptState.executionProfile === "finiteRoot") {
            if (finite === undefined) {
              return yield* Effect.fail(
                corruption(attemptState, "journalStateInvalid"),
              );
            }
            return yield* Effect.gen(function* () {
              // The root and its complete source set were authenticated together.
              // Invocation is tentative; actual storage frontiers and seal retain
              // fresh database authority checks.
              if (finite.status !== "open") {
                return Object.freeze({
                  kind: "stateRejected" as const,
                  issue: Object.freeze({ reason: "journalFailed" as const }),
                });
              }
              const previous = finite.receipts.get(request.syscallSequence);
              if (previous !== undefined) {
                if (
                  previous.kind !== "admitted" ||
                  !bytesEqual(
                    previous.requestEvidence.sha256,
                    requestEvidence.sha256,
                  ) ||
                  !bytesEqual(previous.bindingDigest, bindingDigest)
                ) {
                  return Object.freeze({
                    kind: "sequenceRejected" as const,
                    issue: Object.freeze({
                      reason: "requestMismatch" as const,
                      syscallSequence: request.syscallSequence,
                    }),
                  });
                }
                return Object.freeze({
                  kind: "completed" as const,
                  delivery: "replayed" as const,
                  result: structuredClone(previous.outcome.result),
                });
              }
              if (request.syscallSequence !== finite.lastSequence + 1n) {
                return Object.freeze({
                  kind: "sequenceRejected" as const,
                  issue: Object.freeze({
                    reason: "sequenceGap" as const,
                    actual: request.syscallSequence,
                    expectedNext: CommitSyscallSequenceV1Schema.make(
                      finite.lastSequence + 1n,
                    ),
                  }),
                });
              }
              if (
                finite.lastSequence >= BigInt(MAX_COMMIT_OPERATION_CALLS_V1)
              ) {
                return Object.freeze({
                  kind: "sequenceRejected" as const,
                  issue: Object.freeze({
                    reason: "sequenceExhausted" as const,
                    lastAccepted: CommitFinalSyscallSequenceV1Schema.make(
                      finite.lastSequence,
                    ),
                  }),
                });
              }
              const borrowedExit = yield* Effect.exit(
                borrow({
                  admissions: admitted.admissions,
                  bundle: admission,
                  attempt,
                  method: input.method,
                  rootEvaluator: finite.evaluator,
                  rootAttemptFence: String(attemptState.selector.attemptFence),
                  captureStorage: <
                    K extends FiniteStorageCaptureOperation["kind"],
                  >(
                    operation: Extract<
                      FiniteStorageCaptureOperation,
                      { kind: K }
                    >,
                    demand: import("../../storage/documents/logicalDocuments/model").LogicalStorageReadDemand,
                  ) =>
                    Effect.suspend(() => {
                      if (finite.status !== "open")
                        return Effect.fail(
                          new FiniteStorageCaptureError({
                            reason: "invalidAuthority",
                          }),
                        );
                      const ordinal = admitted.admissions.findIndex(
                        (member, position) => {
                          const inspected =
                            inspectLogicalParticipantAttemptAdmission(
                              member,
                              attempt,
                              admitted.sourceMethods[position]![0]!,
                            );
                          return (
                            inspected !== null &&
                            (demand.kind === "clock" ||
                              inspected.tableIds.has(demand.tableId))
                          );
                        },
                      );
                      if (ordinal < 0)
                        return Effect.fail(
                          new FiniteStorageCaptureError({
                            reason: "invalidAuthority",
                          }),
                        );
                      return captureFiniteStorageEffect(
                        finite.resolvedTarget.target,
                        {
                          selector: attemptState.selector,
                          preliminaryAuthority: finite.resolvedTarget.authority,
                          executionClaim: attemptState.executionClaim,
                          finiteAnchor: finite.anchorCapture,
                          finiteReadDemand: {
                            admission: admitted.admissions[ordinal]!,
                            attempt,
                            method: admitted.sourceMethods[ordinal]![0]!,
                            demand,
                          },
                        },
                        operation,
                      ).pipe(
                        Effect.onError(() =>
                          Effect.sync(() => {
                            finite.status = "aborted";
                            discardFiniteRootEvidence(finite);
                          }),
                        ),
                      );
                    }),
                }),
              );
              if (Exit.isFailure(borrowedExit)) {
                return yield* Effect.failCause(borrowedExit.cause);
              }
              const borrowed = borrowedExit.value;
              const attemptStart = finite.evaluator.attemptCount();
              const completed = yield* borrowed
                .invoke(captured.frame.operation, captured.frame.args)
                .pipe(Effect.ensuring(borrowed.abort));
              if (
                completed.changes.setNull.length > 0 ||
                completed.changes.referenceReplacements.length > 0
              )
                return yield* Effect.fail(
                  new LogicalParticipantAdmissionError({
                    reason: "unsupportedProfile",
                  }),
                );
              const selectedSources = request.sources.map((source, ordinal) =>
                inspectLogicalParticipantAttemptAdmission(
                  admitted.admissions[ordinal]!,
                  attempt,
                  admitted.sourceMethods[ordinal]![0]!,
                ),
              );
              if (
                selectedSources.some((source) => source === null) ||
                completed.changes.attempts.some(
                  (change) =>
                    selectedSources.filter((source) =>
                      source?.tableIds.has(change.tableId),
                    ).length !== 1,
                ) ||
                completed.eventIntents.length > commitEventLimits.messages ||
                completed.eventIntents.some(
                  (event) =>
                    event.sourceKey !== null &&
                    !request.sources.some(
                      (source) => source.sourceKey === event.sourceKey,
                    ),
                )
              )
                return yield* Effect.fail(
                  new LogicalParticipantAdmissionError({
                    reason: "invalidAuthority",
                  }),
                );
              for (const event of completed.eventIntents)
                yield* Effect.fromResult(
                  strictEventEnvelope(event.intent).pipe(
                    Result.mapError(
                      (cause) =>
                        new LogicalParticipantAdmissionError({
                          reason: "invalidInput",
                          cause,
                        }),
                    ),
                  ),
                );
              if (finite.status !== "open")
                return Object.freeze({
                  kind: "stateRejected" as const,
                  issue: Object.freeze({ reason: "journalFailed" as const }),
                });
              const outcome = Object.freeze({
                kind: "admittedLogicalResult" as const,
                result: completed.result,
                events: completed.eventIntents,
                sourceDependencies: completed.payloadPreferenceCleanups?.length ? [{ sourceKey: "payload", evidence: {
                  format: "flarex.payload-preference-cleanup", version: 1,
                  intents: completed.payloadPreferenceCleanups.map(intent => ({ ...intent })),
                } }] : [],
                workBytes: completed.workBytes,
                workCalls: completed.workCalls,
              });
              const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(
                outcome,
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new SessionJournalPersistenceV1Error({
                      operation: "runAdmittedOperation",
                      cause,
                    }),
                ),
              );
              const writeSemanticBytes = completed.changes.attempts.reduce(
                (sum, change) => sum + (change.after?.semanticSizeBytes ?? 0),
                0,
              );
              const deltas = Object.freeze({
                ...ZERO_COUNTER_DELTAS,
                writeOperations: completed.changes.attempts.length,
                writeSemanticBytes,
                receiptEvidenceBytes:
                  requestEvidence.canonicalBytes.byteLength +
                  outcomeEvidence.canonicalBytes.byteLength,
              } satisfies SessionJournalCounterDeltasV1);
              if (
                firstExceededLimit(finite.counters, deltas) !== undefined ||
                finite.participantWorkBytes + completed.workBytes >
                  MAX_COMMIT_PARTICIPANT_WORK_BYTES_V1 ||
                finite.participantWorkCalls + completed.workCalls >
                  MAX_COMMIT_PARTICIPANT_WORK_CALLS_V1
              )
                return yield* Effect.fail(
                  new LogicalParticipantAdmissionError({
                    reason: "unsupportedProfile",
                  }),
                );
              if (finite.status !== "open")
                return Object.freeze({
                  kind: "stateRejected" as const,
                  issue: Object.freeze({ reason: "journalFailed" as const }),
                });
              finite.receipts.set(
                request.syscallSequence,
                Object.freeze({
                  admission,
                  request,
                  kind: "admitted" as const,
                  requestEvidence,
                  bindingDigest,
                  completed: Object.freeze(
                    structuredClone({
                      result: completed.result,
                      ...(completed.payloadPreferenceCleanups === undefined ? {} : { payloadPreferenceCleanups: completed.payloadPreferenceCleanups }),
                      eventIntents: completed.eventIntents,
                      workBytes: completed.workBytes,
                      workCalls: completed.workCalls,
                    }),
                  ),
                  outcome,
                  outcomeEvidence,
                  attemptStart,
                  attemptEnd: attemptStart + completed.changes.attempts.length,
                }),
              );
              finite.lastSequence = request.syscallSequence;
              finite.counters = addFiniteCounters(finite.counters, deltas);
              finite.participantWorkBytes += completed.workBytes;
              finite.participantWorkCalls += completed.workCalls;
              return Object.freeze({
                kind: "completed" as const,
                delivery: "executed" as const,
                result: structuredClone(completed.result),
              });
            }).pipe(
              Effect.onError(() =>
                Effect.sync(() => {
                  finite.status = "aborted";
                  discardFiniteRootEvidence(finite);
                }),
              ),
            );
          }
          const resolved = yield* resolveJournalTargetEffect(attemptState);
          const pins = {
            selector: attemptState.selector,
            preliminaryAuthority: resolved.authority,
            executionClaim: attemptState.executionClaim,
          } as const;
          const preflight = yield* resolved.target[
            RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
          ](pins, (tx, context) =>
            preflightAdmittedOperationInTransactionEffect(
              tx,
              context,
              attemptState,
              admission,
              attempt,
              resolved.authority,
              request,
              requestEvidence,
              bindingDigest,
            ),
          ).pipe(Effect.mapError(mapAdmittedKernelFailure));
          if (preflight.kind !== "ready") return preflight.result;
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              yield* resolved.target[
                RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
              ](pins, (tx, context) =>
                persistAdmittedInvocationMarkerInTransactionEffect(
                  tx,
                  context,
                  attemptState,
                  admission,
                  attempt,
                  resolved.authority,
                  request,
                  requestEvidence,
                  bindingDigest,
                ),
              ).pipe(Effect.mapError(mapAdmittedKernelFailure));
              const borrowedExit = yield* Effect.exit(
                restore(
                  borrow({
                    admissions: admitted.admissions,
                    bundle: admission,
                    attempt,
                    method: input.method,
                    pendingRows: preflight.pendingRows,
                  }),
                ),
              );
              if (Exit.isFailure(borrowedExit)) {
                const poison = yield* Effect.exit(
                  resolved.target[
                    RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                  ](pins, (tx, context) =>
                    persistAdmittedFailureInTransactionEffect(
                      tx,
                      context,
                      attemptState,
                      request,
                      requestEvidence,
                      bindingDigest,
                      "participantPreparationFailed",
                      Object.freeze({ workBytes: 0, workCalls: 0 }),
                    ),
                  ).pipe(Effect.mapError(mapAdmittedKernelFailure)),
                );
                return yield* Effect.failCause(
                  Exit.isFailure(poison)
                    ? Cause.combine(borrowedExit.cause, poison.cause)
                    : borrowedExit.cause,
                );
              }
              const borrowed = borrowedExit.value;
              return yield* Effect.gen(function* () {
                // A native method may already have staged work when any subsequent
                // projection or evidence check fails. Keep the entire preparation in
                // the failure bracket and durably poison the exact root before exit.
                const prepared = yield* Effect.exit(
                  restore(
                    prepareAdmittedCompletionEffect(
                      attempt,
                      admission,
                      request,
                      captured.frame,
                      borrowed,
                    ),
                  ),
                );
                if (Exit.isFailure(prepared)) {
                  const usage = borrowed.currentUsage();
                  yield* borrowed.abort;
                  const poison = yield* Effect.exit(
                    resolved.target[
                      RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                    ](pins, (tx, context) =>
                      persistAdmittedFailureInTransactionEffect(
                        tx,
                        context,
                        attemptState,
                        request,
                        requestEvidence,
                        bindingDigest,
                        "participantFailed",
                        usage,
                      ),
                    ).pipe(Effect.mapError(mapAdmittedKernelFailure)),
                  );
                  if (Exit.isFailure(poison)) {
                    return yield* Effect.failCause(
                      Cause.combine(prepared.cause, poison.cause),
                    );
                  }
                  return yield* Effect.failCause(prepared.cause);
                }
                const {
                  completed,
                  contribution,
                  sources: preparedSources,
                } = prepared.value;
                const acceptance = yield* Effect.exit(
                  resolved.target[
                    RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                  ](pins, (tx, context) =>
                    appendAdmittedOperationInTransactionEffect(
                      tx,
                      context,
                      attemptState,
                      admission,
                      attempt,
                      resolved.authority,
                      request,
                      requestEvidence,
                      bindingDigest,
                      completed,
                      contribution,
                      preparedSources,
                    ),
                  ).pipe(Effect.mapError(mapAdmittedKernelFailure)),
                );
                if (Exit.isSuccess(acceptance)) return acceptance.value;
                // The write may have committed even if its acknowledgement was lost.
                // Resolve that exact sequence under the same fenced root before any
                // failure receipt, and never invoke the native participant again here.
                const resolution = yield* Effect.exit(
                  resolved.target[
                    RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                  ](pins, (tx, context) =>
                    preflightAdmittedOperationInTransactionEffect(
                      tx,
                      context,
                      attemptState,
                      admission,
                      attempt,
                      resolved.authority,
                      request,
                      requestEvidence,
                      bindingDigest,
                    ),
                  ).pipe(Effect.mapError(mapAdmittedKernelFailure)),
                );
                if (Exit.isFailure(resolution)) {
                  return yield* Effect.failCause(
                    Cause.combine(acceptance.cause, resolution.cause),
                  );
                }
                if (
                  resolution.value.kind === "resolved" &&
                  !(
                    resolution.value.result.kind === "stateRejected" &&
                    resolution.value.result.issue.reason === "operationPending"
                  )
                ) {
                  return resolution.value.result;
                }
                const poison = yield* Effect.exit(
                  resolved.target[
                    RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
                  ](pins, (tx, context) =>
                    persistAdmittedFailureInTransactionEffect(
                      tx,
                      context,
                      attemptState,
                      request,
                      requestEvidence,
                      bindingDigest,
                      "acceptanceFailed",
                      borrowed.currentUsage(),
                    ),
                  ).pipe(Effect.mapError(mapAdmittedKernelFailure)),
                );
                if (Exit.isFailure(poison)) {
                  return yield* Effect.failCause(
                    Cause.combine(acceptance.cause, poison.cause),
                  );
                }
                return yield* Effect.failCause(acceptance.cause);
              }).pipe(Effect.ensuring(borrowed.abort));
            }),
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => owner.finishAdmittedOperation(inFlightKey)),
          ),
        );
      },
      (work) =>
        observeExecution("SessionJournalStore.runAdmittedOperation", work),
    );
  return Object.freeze({ runAdmittedOperationEffect });
}
