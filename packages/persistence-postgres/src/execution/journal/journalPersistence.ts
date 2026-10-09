import { Effect } from "effect";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type { SessionJournalIncrementalLimitDimensionV1 } from "./contracts";
import { SessionJournalPersistenceV1Error } from "./errors";
import { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";
import { and, desc, eq } from "drizzle-orm";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import type { CommitSyscallSequenceV1 } from "flarex-protocol/commit-protocol";
import { isJsonObject } from "flarex-protocol/json";
import type { JsonObject } from "flarex-protocol/json";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import {
  copyCanonicalFlarexValueBytesV1,
  copyFlarexValueSha256V1,
} from "flarex-protocol/value";
import type {
  FLAREX_VALUE_CODEC_VERSION_V1,
  CanonicalFlarexValueBytesV1,
  CanonicalFlarexValueV1,
  FlarexValueSha256V1,
} from "flarex-protocol/value";
import type {
  AppRowPointDependencyV1,
  AppRowTransaction,
} from "../../storage/documents/appRows";
import {
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
} from "../../database/schema";
import type { ExactRunningAttemptKernelContextV1 } from "../transactionSessionAttemptKernel";
import { canonicalizeStoredOutcomeEffect } from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { cloneJsonObject } from "./inputCapture";
import type {
  SessionJournalCountersV1,
  SessionJournalCounterDeltasV1,
  JournalPointOverlayV1,
  JournalPointMutationV1,
  PreparedLogicalWriteEventV1,
} from "./operationModel";
import { isLimitOutcome } from "./receiptEvidence";
import { attemptFromContext, corruption } from "./journalFailures";

export async function loadLatestReceipt(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
): Promise<typeof fxSystemTransactionJournalReceipts.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(
      and(
        eq(fxSystemTransactionJournalReceipts.scopeUuid, context.scopeUuid),
        eq(
          fxSystemTransactionJournalReceipts.sessionId,
          context.anchor.sessionId,
        ),
        eq(
          fxSystemTransactionJournalReceipts.attemptFence,
          context.anchor.attemptFence,
        ),
      ),
    )
    .orderBy(desc(fxSystemTransactionJournalReceipts.lastSyscallSequence))
    .limit(1)
    .for("update");
  return rows[0];
}

export async function loadReceiptAtSequence(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  sequence: CommitSyscallSequenceV1,
): Promise<typeof fxSystemTransactionJournalReceipts.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(
      and(
        eq(fxSystemTransactionJournalReceipts.scopeUuid, context.scopeUuid),
        eq(
          fxSystemTransactionJournalReceipts.sessionId,
          context.anchor.sessionId,
        ),
        eq(
          fxSystemTransactionJournalReceipts.attemptFence,
          context.anchor.attemptFence,
        ),
        eq(fxSystemTransactionJournalReceipts.lastSyscallSequence, sequence),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0];
}

interface PersistAcceptedOperationRootStateV1 {
  readonly state:
    "open" | "failed" | "operation_failed" | "relation_conflicted";
  readonly failureDimension: SessionJournalIncrementalLimitDimensionV1 | null;
  readonly nextCreationTime?: AppCreationTimeV1;
  readonly participantWorkBytes?: number;
  readonly participantWorkCalls?: number;
}

export const persistAcceptedOperationEffect = Effect.fnUntraced(function* <
  Failure,
>(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  request: SessionJournalStoredRequest,
  requestEvidence: CanonicalFlarexValueV1,
  outcome: SessionJournalStoredOutcome,
  current: SessionJournalCountersV1,
  deltas: SessionJournalCounterDeltasV1,
  state: PersistAcceptedOperationRootStateV1,
  mapFailure: (cause: unknown) => Failure,
  participantBindingSha256: Uint8Array | null = null,
): Effect.fn.Return<void, Failure> {
  const outcomeEvidence = yield* canonicalizeStoredOutcomeEffect(outcome).pipe(
    Effect.mapError(mapFailure),
  );
  const replacingInvocation =
    request.kind === "admittedLogicalOperation" &&
    context.journalRoot.state === "operation_invoking";
  const marker = replacingInvocation
    ? yield* runDrizzleStatementEffect(
        loadReceiptAtSequence(tx, context, request.syscallSequence),
        mapFailure,
      )
    : undefined;
  if (
    replacingInvocation &&
    (marker === undefined ||
      marker.outcomeKind !== "admittedLogicalInvoking" ||
      marker.operationKind !== request.kind ||
      !bytesEqual(marker.requestSha256, requestEvidence.sha256) ||
      participantBindingSha256 === null ||
      marker.participantBindingSha256 === null ||
      !bytesEqual(marker.participantBindingSha256, participantBindingSha256))
  ) {
    return yield* Effect.fail(
      mapFailure(
        corruption(attemptFromContext(context), "latestReceiptEvidenceInvalid"),
      ),
    );
  }
  const receiptEvidenceDelta = replacingInvocation
    ? outcomeEvidence.canonicalBytes.byteLength -
      marker!.outcomeBytes.byteLength
    : requestEvidence.canonicalBytes.byteLength +
      outcomeEvidence.canonicalBytes.byteLength;
  const boundedTerminalLimitFailure =
    state.state === "failed" &&
    state.failureDimension !== null &&
    isLimitOutcome(outcome) &&
    outcome.dimension === state.failureDimension;
  const maximumReceiptEvidenceBytes = boundedTerminalLimitFailure
    ? MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1
    : MAX_COMMIT_RECEIPT_EVIDENCE_BYTES_V1;
  if (
    !Number.isSafeInteger(receiptEvidenceDelta) ||
    (boundedTerminalLimitFailure &&
      outcomeEvidence.canonicalBytes.byteLength > 1_024) ||
    current.receiptEvidenceBytes + receiptEvidenceDelta >
      maximumReceiptEvidenceBytes
  ) {
    return yield* Effect.fail(
      mapFailure(
        new SessionJournalPersistenceV1Error({
          operation: "runAdmittedOperation",
          cause:
            "receiptEvidenceBytes limit exceeded before durable acknowledgement",
        }),
      ),
    );
  }
  const receipt = {
    lastSyscallSequence: request.syscallSequence,
    operationKind: request.kind,
    participantBindingSha256,
    requestCodecVersion: 2,
    requestBytes: new Uint8Array(requestEvidence.canonicalBytes),
    requestSha256: new Uint8Array(requestEvidence.sha256),
    outcomeKind: outcome.kind,
    outcomeCodecVersion: 2,
    outcomeBytes: new Uint8Array(outcomeEvidence.canonicalBytes),
    outcomeSha256: new Uint8Array(outcomeEvidence.sha256),
    createdAt: context.databaseNow,
    updatedAt: context.databaseNow,
  } satisfies Omit<
    typeof fxSystemTransactionJournalReceipts.$inferInsert,
    "scopeUuid" | "sessionId" | "attemptFence"
  >;
  if (replacingInvocation) {
    const changedReceipt = yield* runDrizzleStatementEffect(
      tx
        .update(fxSystemTransactionJournalReceipts)
        .set({
          outcomeKind: receipt.outcomeKind,
          outcomeCodecVersion: receipt.outcomeCodecVersion,
          outcomeBytes: receipt.outcomeBytes,
          outcomeSha256: receipt.outcomeSha256,
          updatedAt: context.databaseNow,
        })
        .where(
          and(
            eq(fxSystemTransactionJournalReceipts.scopeUuid, context.scopeUuid),
            eq(
              fxSystemTransactionJournalReceipts.sessionId,
              context.anchor.sessionId,
            ),
            eq(
              fxSystemTransactionJournalReceipts.attemptFence,
              context.anchor.attemptFence,
            ),
            eq(
              fxSystemTransactionJournalReceipts.lastSyscallSequence,
              request.syscallSequence,
            ),
            eq(
              fxSystemTransactionJournalReceipts.outcomeKind,
              "admittedLogicalInvoking",
            ),
          ),
        )
        .returning({
          outcomeKind: fxSystemTransactionJournalReceipts.outcomeKind,
        }),
      mapFailure,
    );
    if (changedReceipt.length !== 1) {
      return yield* Effect.fail(
        mapFailure(
          corruption(
            attemptFromContext(context),
            "latestReceiptEvidenceInvalid",
          ),
        ),
      );
    }
  } else {
    yield* runDrizzleStatementEffect(
      tx.insert(fxSystemTransactionJournalReceipts).values({
        scopeUuid: context.scopeUuid,
        sessionId: context.anchor.sessionId,
        attemptFence: context.anchor.attemptFence,
        ...receipt,
      }),
      mapFailure,
    );
  }
  const updated = yield* runDrizzleStatementEffect(
    tx
      .update(fxSystemTransactionJournals)
      .set({
        state: state.state,
        lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(
          request.syscallSequence,
        ),
        readDocuments: current.readDocuments + deltas.readDocuments,
        readSemanticBytes: current.readSemanticBytes + deltas.readSemanticBytes,
        pointDependencyCount:
          current.pointDependencyCount + deltas.pointDependencyCount,
        indexedQuerySyscalls:
          current.indexedQuerySyscalls + deltas.indexedQuerySyscalls,
        indexRangeDependencyCount:
          current.indexRangeDependencyCount + deltas.indexRangeDependencyCount,
        indexRangeDependencyEvidenceBytes:
          current.indexRangeDependencyEvidenceBytes +
          deltas.indexRangeDependencyEvidenceBytes,
        relationReadSyscalls:
          current.relationReadSyscalls + deltas.relationReadSyscalls,
        relationDependencyCount:
          current.relationDependencyCount + deltas.relationDependencyCount,
        relationBaseOccurrences:
          current.relationBaseOccurrences + deltas.relationBaseOccurrences,
        writeOperations: current.writeOperations + deltas.writeOperations,
        writeSemanticBytes:
          current.writeSemanticBytes + deltas.writeSemanticBytes,
        materialWriteEventEvidenceBytes:
          CommitMaterialWriteEventEvidenceBytesV1Schema.make(
            current.materialWriteEventEvidenceBytes +
              deltas.materialWriteEventEvidenceBytes,
          ),
        receiptEvidenceBytes:
          current.receiptEvidenceBytes + receiptEvidenceDelta,
        participantWorkBytes:
          context.journalRoot.participantWorkBytes +
          (state.participantWorkBytes ?? 0),
        participantWorkCalls:
          context.journalRoot.participantWorkCalls +
          (state.participantWorkCalls ?? 0),
        failureDimension: state.failureDimension,
        ...(state.nextCreationTime === undefined
          ? {}
          : { nextCreationTime: state.nextCreationTime }),
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
          eq(
            fxSystemTransactionJournals.state,
            replacingInvocation ? "operation_invoking" : "open",
          ),
          eq(
            fxSystemTransactionJournals.lastSyscallSequence,
            context.journalRoot.lastSyscallSequence,
          ),
        ),
      )
      .returning({
        lastSyscallSequence: fxSystemTransactionJournals.lastSyscallSequence,
      }),
    mapFailure,
  );
  if (
    updated.length !== 1 ||
    BigInt(updated[0]?.lastSyscallSequence ?? -1n) !==
      BigInt(request.syscallSequence)
  ) {
    return yield* Effect.fail(
      mapFailure(
        corruption(
          attemptFromContext(context),
          "journalRootOperationUpdateMismatch",
        ),
      ),
    );
  }
});

export const persistPointMutationEffect = Effect.fnUntraced(function* <Failure>(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  mutation: JournalPointMutationV1,
  mapFailure: (cause: unknown) => Failure,
): Effect.fn.Return<void, Failure> {
  const dependencyColumns =
    mutation.generatedInsertion === true
      ? {
          dependencyKind: "generated_insertion" as const,
          dependencyRevisionCommitSeq: null,
        }
      : dependencyColumnsForPoint(mutation.dependency);
  const overlayColumns = yield* overlayColumnsForPointEffect(mutation.overlay);
  if (mutation.mode === "insert") {
    yield* runDrizzleStatementEffect(
      tx.insert(fxSystemTransactionJournalPoints).values({
        scopeUuid: context.scopeUuid,
        sessionId: context.anchor.sessionId,
        attemptFence: context.anchor.attemptFence,
        tableId: mutation.tableId,
        rowId: appRowIdHexV1ToBytes(mutation.rowId),
        ...dependencyColumns,
        ...overlayColumns,
        createdAt: context.databaseNow,
        updatedAt: context.databaseNow,
      }),
      mapFailure,
    );
    return;
  }
  const updated = yield* runDrizzleStatementEffect(
    tx
      .update(fxSystemTransactionJournalPoints)
      .set({
        ...overlayColumns,
        updatedAt: context.databaseNow,
      })
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
          eq(fxSystemTransactionJournalPoints.tableId, mutation.tableId),
          eq(
            fxSystemTransactionJournalPoints.rowId,
            appRowIdHexV1ToBytes(mutation.rowId),
          ),
        ),
      )
      .returning({ tableId: fxSystemTransactionJournalPoints.tableId }),
    mapFailure,
  );
  if (updated.length !== 1 || updated[0]?.tableId !== mutation.tableId) {
    return yield* Effect.fail(
      mapFailure(
        new Error("Journal point overlay update did not affect one row."),
      ),
    );
  }
});

function dependencyColumnsForPoint(
  dependency: AppRowPointDependencyV1,
): Readonly<{
  dependencyKind:
    "present" | "missing_no_visible_revision" | "missing_tombstone";
  dependencyRevisionCommitSeq: CommitSeq | null;
}> {
  switch (dependency.kind) {
    case "present":
      return Object.freeze({
        dependencyKind: "present",
        dependencyRevisionCommitSeq: dependency.revisionCommitSeq,
      });
    case "missing":
      return dependency.basis.kind === "noVisibleRevision"
        ? Object.freeze({
            dependencyKind: "missing_no_visible_revision",
            dependencyRevisionCommitSeq: null,
          })
        : Object.freeze({
            dependencyKind: "missing_tombstone",
            dependencyRevisionCommitSeq: dependency.basis.revisionCommitSeq,
          });
  }
}

const overlayColumnsForPointEffect = Effect.fnUntraced(function* (
  overlay: JournalPointOverlayV1,
): Effect.fn.Return<
  Readonly<{
    overlayKind: "none" | "live" | "deleted";
    overlayCreationTime: AppCreationTimeV1 | null;
    overlayValueCodecVersion: typeof FLAREX_VALUE_CODEC_VERSION_V1 | null;
    overlayValueJson: JsonObject | null;
    overlayValueBytes: CanonicalFlarexValueBytesV1 | null;
    overlayValueSha256: FlarexValueSha256V1 | null;
    overlaySemanticBytes: number | null;
  }>
> {
  if (overlay.kind !== "live") {
    return Object.freeze({
      overlayKind: overlay.kind,
      overlayCreationTime: null,
      overlayValueCodecVersion: null,
      overlayValueJson: null,
      overlayValueBytes: null,
      overlayValueSha256: null,
      overlaySemanticBytes: null,
    });
  }
  if (!isJsonObject(overlay.document.valueJson)) {
    return yield* Effect.die(
      new Error("Canonical app document JSON is not an object."),
    );
  }
  return Object.freeze({
    overlayKind: "live",
    overlayCreationTime: overlay.creationTime,
    overlayValueCodecVersion: overlay.document.codecVersion,
    overlayValueJson: cloneJsonObject(overlay.document.valueJson),
    overlayValueBytes: copyCanonicalFlarexValueBytesV1(
      overlay.document.canonicalBytes,
    ),
    overlayValueSha256: copyFlarexValueSha256V1(overlay.document.sha256),
    overlaySemanticBytes: overlay.document.semanticSizeBytes,
  });
});

export async function persistLogicalWrite(
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  event: PreparedLogicalWriteEventV1,
): Promise<void> {
  await tx.insert(fxSystemTransactionJournalWriteEvents).values({
    scopeUuid: context.scopeUuid,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    syscallSequence: event.write.syscallSequence,
    writeKind: event.write.kind,
    eventCodecVersion: 2,
    eventBytes: new Uint8Array(event.canonicalBytes),
    eventSha256: new Uint8Array(event.sha256),
    createdAt: context.databaseNow,
  });
}
