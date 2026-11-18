import { SessionJournalSealV1Error } from "./errors";
import type { SessionJournalStorageCorruptionV1Error } from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { and, asc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Result, Schema } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytes,
} from "flarex-protocol/app-document-id";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_OPERATION_CALLS_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  SESSION_JOURNAL_FORMAT,
  SessionJournalSchema,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  canonicalizeAdmittedSourceBundleResult,
  AdmittedParticipantWriteEventSchema,
} from "flarex-protocol/commit-protocol";
import type {
  CommitFinalSyscallSequenceV1,
  LogicalAppWriteV1,
  LogicalReadDependencyV1,
  SessionJournal,
  AdmittedParticipantLogicalEffectV1,
  AdmittedParticipantOperation,
} from "flarex-protocol/commit-protocol";
import {
  CommitSeqSchema,
  SnapshotTokenSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
} from "flarex-protocol/storage-authority";
import type {
  ScopeUuidV1,
  SnapshotToken,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
} from "flarex-protocol/transaction-session";
import type { TransactionAttemptFence } from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1Effect,
} from "flarex-protocol/value";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import {
  decodeScopeClockRecord,
  selectScopeClockRows,
} from "../../scope/scopeClock";
import { authenticatedGeneratedInsertionsResult } from "../../storage/documents/logicalDocuments/journalEvidence";
import { encodeAdmittedFrameworkOperationV1Result } from "flarex-protocol/internal/admitted-framework-operation-v1";
import {
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
} from "../../database/schema";
import { sha256 } from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredOutcome,
} from "./codecs";
import { decodeJournalCountersResult } from "./operationModel";
import type { SessionJournalCountersV1 } from "./operationModel";
import {
  decodeStoredRelationIncomingDependenciesEffect,
  decodeStoredIndexRangeRowsEffect,
  decodePointDependencyResult,
  decodeStoredEvidenceEffect,
  decodeAndVerifyReceiptRecordEffect,
  validateReceiptOutcomeMatchesJournalRootResult,
  verifyPointOverlayEvidenceEffect,
  logicalDependencyFromPoint,
  decodeAndVerifyLogicalWriteEventEffect,
} from "./receiptEvidence";
import { corruption } from "./journalFailures";

export interface SessionJournalSealCandidateV1 {
  readonly lastSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly counters: SessionJournalCountersV1;
  readonly rootUpdatedAtMilliseconds: number;
  readonly journal: SessionJournal;
}

export interface SessionJournalSealRowsV1 {
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
  readonly receipts: ReadonlyArray<
    typeof fxSystemTransactionJournalReceipts.$inferSelect
  >;
  readonly points: ReadonlyArray<
    typeof fxSystemTransactionJournalPoints.$inferSelect
  >;
  readonly indexRanges: ReadonlyArray<
    typeof fxSystemTransactionJournalIndexRanges.$inferSelect
  >;
  readonly relationDependencies: ReadonlyArray<
    typeof fxSystemTransactionJournalRelationIncomingDependencies.$inferSelect
  >;
  readonly events: ReadonlyArray<
    typeof fxSystemTransactionJournalWriteEvents.$inferSelect
  >;
}

const SealProjectionOrdinalsSchema = Schema.Array(
  Schema.Struct({
    ordinal: Schema.Int.check(Schema.isBetween({ minimum: -1, maximum: 127 })),
  }),
).check(Schema.isMaxLength(129));

const decodeSealProjectionOrdinals = Schema.decodeUnknownResult(
  SealProjectionOrdinalsSchema,
);

/** Compare every stored column using its existing driver encoder. Only bounded
 * integer verdicts cross the driver boundary, even if a trigger inflates bytes.
 * Canonical preparation and digest authority remain outside this SQL expression. */
export function sealProjectionOrdinal(
  columns: Readonly<Record<string, PgColumn>>,
  expected: readonly object[],
): SQL<number> {
  if (expected.length === 0) return sql<number>`-1`;
  return sql<number>`case ${sql.join(
    expected.map(
      (row, ordinal) => sql`
    when ${sql.join(
      Object.entries(columns).map(
        ([key, column]) =>
          sql`${column} is not distinct from ${sql.param(Reflect.get(row, key), column)}`,
      ),
      sql` and `,
    )}
    then ${sql.raw(String(ordinal))}`,
    ),
    sql` `,
  )} else -1 end`;
}

export function exactSealProjectionOrdinalsResult(
  attempt: SessionJournalAttemptStateV1,
  expectedCount: number,
  returned: unknown,
  ordered: boolean,
): Result.Result<void, SessionJournalStorageCorruptionV1Error> {
  return decodeSealProjectionOrdinals(returned).pipe(
    Result.mapError(() =>
      corruption(attempt, "journalRootOperationUpdateMismatch"),
    ),
    Result.filterOrFail(
      (rows) => rows.length === expectedCount,
      () => corruption(attempt, "journalRootOperationUpdateMismatch"),
    ),
    Result.map((rows) => rows.map((row) => row.ordinal)),
    Result.filterOrFail(
      (ordinals) =>
        ordered
          ? ordinals.every((ordinal, index) => ordinal === index)
          : new Set(ordinals).size === expectedCount &&
            ordinals.every(
              (ordinal) => ordinal >= 0 && ordinal < expectedCount,
            ),
      () => corruption(attempt, "journalRootOperationUpdateMismatch"),
    ),
    Result.map(() => undefined),
  );
}

export function detachSealCandidate(
  candidate: SessionJournalSealCandidateV1,
): SessionJournalSealCandidateV1 {
  return Object.freeze({
    ...candidate,
    counters: Object.freeze({ ...candidate.counters }),
    journal: structuredClone(candidate.journal),
  });
}

/** Caller owns a coherent transaction: legacy preparation uses repeatable
 * read; finite seal holds the exact journal row lock through materialization. */
export async function captureSealRowsInTransaction(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  preliminaryAuthority: TrustedScopeAuthority,
): Promise<SessionJournalSealRowsV1> {
  const authority = await requireRepeatableReadAttemptAuthority(
    tx,
    attempt,
    preliminaryAuthority,
  );
  const projections = await captureSealProjectionRowsInTransaction(
    tx,
    attempt,
    authority,
  );
  return Object.freeze({
    root: structuredClone(authority.root),
    ...projections,
  });
}

/** Bounded durable recovery projection reader. The caller supplies its checked root. */
export async function captureSealProjectionRowsInTransaction(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  authority: RepeatableReadAttemptAuthorityV1,
): Promise<Omit<SessionJournalSealRowsV1, "root">> {
  const receipts = await loadReceiptsReadOnly(tx, authority);
  const points = await tx
    .select()
    .from(fxSystemTransactionJournalPoints)
    .where(
      and(
        eq(fxSystemTransactionJournalPoints.scopeUuid, authority.scopeUuid),
        eq(
          fxSystemTransactionJournalPoints.sessionId,
          attempt.selector.sessionId,
        ),
        eq(
          fxSystemTransactionJournalPoints.attemptFence,
          attempt.selector.attemptFence,
        ),
      ),
    )
    .orderBy(
      asc(fxSystemTransactionJournalPoints.tableId),
      asc(fxSystemTransactionJournalPoints.rowId),
    )
    .limit(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1);
  const indexRanges = await tx
    .select()
    .from(fxSystemTransactionJournalIndexRanges)
    .where(
      and(
        eq(
          fxSystemTransactionJournalIndexRanges.scopeUuid,
          authority.scopeUuid,
        ),
        eq(
          fxSystemTransactionJournalIndexRanges.sessionId,
          attempt.selector.sessionId,
        ),
        eq(
          fxSystemTransactionJournalIndexRanges.attemptFence,
          attempt.selector.attemptFence,
        ),
      ),
    )
    .orderBy(asc(fxSystemTransactionJournalIndexRanges.ordinal))
    .limit(MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1);
  const relationDependencies = await tx
    .select()
    .from(fxSystemTransactionJournalRelationIncomingDependencies)
    .where(
      and(
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
          authority.scopeUuid,
        ),
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
          attempt.selector.sessionId,
        ),
        eq(
          fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
          attempt.selector.attemptFence,
        ),
      ),
    )
    .orderBy(
      asc(
        fxSystemTransactionJournalRelationIncomingDependencies.edgeDefinitionId,
      ),
      asc(fxSystemTransactionJournalRelationIncomingDependencies.targetRowId),
    )
    .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1);
  const events = await tx
    .select()
    .from(fxSystemTransactionJournalWriteEvents)
    .where(
      and(
        eq(
          fxSystemTransactionJournalWriteEvents.scopeUuid,
          authority.scopeUuid,
        ),
        eq(
          fxSystemTransactionJournalWriteEvents.sessionId,
          attempt.selector.sessionId,
        ),
        eq(
          fxSystemTransactionJournalWriteEvents.attemptFence,
          attempt.selector.attemptFence,
        ),
      ),
    )
    .orderBy(
      asc(fxSystemTransactionJournalWriteEvents.syscallSequence),
      asc(fxSystemTransactionJournalWriteEvents.effectOrdinal),
    )
    .limit(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1);
  return Object.freeze({
    receipts: Object.freeze(structuredClone(receipts)),
    points: Object.freeze(structuredClone(points)),
    indexRanges: Object.freeze(structuredClone(indexRanges)),
    relationDependencies: Object.freeze(structuredClone(relationDependencies)),
    events: Object.freeze(structuredClone(events)),
  });
}

export const materializeSealCandidateEffect = Effect.fn(
  "SessionJournalStore.materializeSealCandidate",
)(function* (
  attempt: SessionJournalAttemptStateV1,
  snapshot: SessionJournalSealRowsV1,
): Effect.fn.Return<
  SessionJournalSealCandidateV1,
  SessionJournalSealV1Error | SessionJournalStorageCorruptionV1Error
> {
  const root = snapshot.root;
  if (root.journalFormat !== SESSION_JOURNAL_FORMAT) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  if (root.state === "failed" || root.state === "operation_failed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "journalFailed" }),
    );
  }
  if (root.state === "relation_conflicted") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({
        reason: "journalRelationConflicted",
      }),
    );
  }
  if (root.state !== "open" && root.state !== "sealed") {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  if (snapshot.points.length > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1) {
    return yield* Effect.fail(
      corruption(attempt, "pointDependencyCountMismatch"),
    );
  }
  if (snapshot.events.length > MAX_COMMIT_WRITE_OPERATIONS_V1) {
    return yield* Effect.fail(
      corruption(attempt, "writeOperationCountMismatch"),
    );
  }
  if (
    snapshot.indexRanges.length > MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1
  ) {
    return yield* Effect.fail(
      corruption(attempt, "indexRangeDependencyCountMismatch"),
    );
  }
  if (
    snapshot.relationDependencies.length >
    MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1
  ) {
    return yield* Effect.fail(
      corruption(attempt, "relationDependencyCountMismatch"),
    );
  }
  const counters = yield* Effect.fromResult(
    decodeJournalCountersResult(attempt, root),
  );
  const lastSyscallSequence = CommitFinalSyscallSequenceV1Schema.make(
    root.lastSyscallSequence,
  );
  if (
    snapshot.receipts.length !== Number(lastSyscallSequence) ||
    snapshot.receipts.length > MAX_COMMIT_OPERATION_CALLS_V1
  ) {
    return yield* Effect.fail(
      corruption(attempt, "latestReceiptSequenceMismatch"),
    );
  }
  const receiptRecords: Array<
    Readonly<{
      request: SessionJournalStoredRequest;
      outcome: SessionJournalStoredOutcome;
    }>
  > = [];
  let receiptEvidenceBytes = 0;
  let participantWorkBytes = 0;
  let participantWorkCalls = 0;
  for (const [ordinal, receipt] of snapshot.receipts.entries()) {
    if (receipt.lastSyscallSequence !== BigInt(ordinal + 1)) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptSequenceMismatch"),
      );
    }
    const decoded = yield* decodeAndVerifyReceiptRecordEffect(
      attempt,
      receipt,
      undefined,
    );
    receiptRecords.push(decoded);
    receiptEvidenceBytes +=
      receipt.requestBytes.byteLength + receipt.outcomeBytes.byteLength;
    if (
      decoded.outcome.kind === "admittedLogicalResult" ||
      decoded.outcome.kind === "admittedLogicalError"
    ) {
      participantWorkBytes += decoded.outcome.workBytes;
      participantWorkCalls += decoded.outcome.workCalls;
    }
  }
  if (
    receiptEvidenceBytes !== root.receiptEvidenceBytes ||
    participantWorkBytes !== root.participantWorkBytes ||
    participantWorkCalls !== root.participantWorkCalls
  ) {
    return yield* Effect.fail(corruption(attempt, "journalCountersInvalid"));
  }
  const lastRecord = receiptRecords.at(-1);
  if (lastRecord !== undefined) {
    yield* Effect.fromResult(
      validateReceiptOutcomeMatchesJournalRootResult(
        attempt,
        root,
        lastRecord.outcome,
      ),
    );
  }

  const pointRows = snapshot.points;
  if (pointRows.length !== counters.pointDependencyCount) {
    return yield* Effect.fail(
      corruption(attempt, "pointDependencyCountMismatch"),
    );
  }
  const pointDependencies: Array<
    Extract<LogicalReadDependencyV1, { readonly kind: "appRowPoint" }>
  > = [];
  for (const point of pointRows) {
    if (point.dependencyKind === "generated_insertion") {
      if (point.dependencyRevisionCommitSeq !== null)
        return yield* Effect.fail(
          corruption(attempt, "pointDependencyCountMismatch"),
        );
      yield* verifyPointOverlayEvidenceEffect(attempt, point);
      continue;
    }
    const dependency = yield* Effect.fromResult(
      decodePointDependencyResult(attempt, point),
    );
    yield* verifyPointOverlayEvidenceEffect(attempt, point);
    pointDependencies.push(logicalDependencyFromPoint(dependency));
  }
  pointDependencies.sort((left, right) =>
    compareUtf16Strings(left.documentId, right.documentId),
  );
  const indexRangeDependencies = yield* decodeStoredIndexRangeRowsEffect(
    attempt,
    snapshot.indexRanges,
  );
  if (indexRangeDependencies.length !== counters.indexRangeDependencyCount) {
    return yield* Effect.fail(
      corruption(attempt, "indexRangeDependencyCountMismatch"),
    );
  }
  const computedIndexRangeEvidenceBytes = snapshot.indexRanges.reduce(
    (total, row) => total + row.evidenceBytes,
    0,
  );
  if (
    computedIndexRangeEvidenceBytes !==
    counters.indexRangeDependencyEvidenceBytes
  ) {
    return yield* Effect.fail(
      corruption(attempt, "indexRangeDependencyEvidenceBytesMismatch"),
    );
  }
  const relationDependencies =
    yield* decodeStoredRelationIncomingDependenciesEffect(
      attempt,
      snapshot.relationDependencies,
    );
  if (relationDependencies.length !== counters.relationDependencyCount) {
    return yield* Effect.fail(
      corruption(attempt, "relationDependencyCountMismatch"),
    );
  }
  const dependencies: LogicalReadDependencyV1[] = [
    ...pointDependencies,
    ...indexRangeDependencies,
    ...relationDependencies,
  ];

  const eventRows = snapshot.events;
  if (eventRows.length !== counters.writeOperations) {
    return yield* Effect.fail(
      corruption(attempt, "writeOperationCountMismatch"),
    );
  }
  const writes: LogicalAppWriteV1[] = [];
  const participantEffects = new Map<
    bigint,
    Array<
      Readonly<{
        sourceBindingSha256Hex: string;
        effect: AdmittedParticipantLogicalEffectV1;
      }>
    >
  >();
  let computedWriteSemanticBytes = 0;
  let computedMaterialWriteEventEvidenceBytes = 0;
  for (const event of eventRows) {
    computedMaterialWriteEventEvidenceBytes += event.eventBytes.byteLength;
    if (
      !Number.isSafeInteger(computedMaterialWriteEventEvidenceBytes) ||
      computedMaterialWriteEventEvidenceBytes >
        MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1
    ) {
      return yield* Effect.fail(
        corruption(attempt, "materialWriteEventEvidenceBytesMismatch"),
      );
    }
    if (event.syscallSequence > lastSyscallSequence) {
      return yield* Effect.fail(
        corruption(attempt, "writeSequenceBeyondJournalFinalSequence"),
      );
    }
    if (event.writeKind === "logicalDocument") {
      const evidence = yield* decodeStoredEvidenceEffect(
        attempt,
        "logicalWriteEventInvalid",
        event.eventBytes,
        event.eventSha256,
      );
      const decoded = yield* Effect.fromResult(
        Schema.decodeUnknownResult(AdmittedParticipantWriteEventSchema, {
          onExcessProperty: "error",
        })(evidence.valueJson).pipe(
          Result.mapError((cause) =>
            corruption(attempt, "logicalWriteEventInvalid", cause),
          ),
        ),
      );
      const matching = receiptRecords[Number(event.syscallSequence) - 1];
      if (
        matching?.request.kind !== "admittedLogicalOperation" ||
        matching.outcome.kind !== "admittedLogicalResult" ||
        decoded.syscallSequence !== event.syscallSequence ||
        decoded.effect.effectOrdinal !== event.effectOrdinal ||
        !matching.request.sources.some(
          (source) =>
            source.sourceBindingSha256Hex === decoded.sourceBindingSha256Hex,
        )
      ) {
        return yield* Effect.fail(
          corruption(attempt, "logicalWriteEventInvalid"),
        );
      }
      const effects = participantEffects.get(event.syscallSequence) ?? [];
      if (event.effectOrdinal !== effects.length) {
        return yield* Effect.fail(
          corruption(attempt, "logicalWriteEventInvalid"),
        );
      }
      effects.push(
        Object.freeze({
          sourceBindingSha256Hex: decoded.sourceBindingSha256Hex,
          effect: decoded.effect,
        }),
      );
      participantEffects.set(event.syscallSequence, effects);
      if (decoded.effect.after !== null) {
        const after = yield* canonicalizeFlarexValueJsonV1Effect(
          decoded.effect.after,
        ).pipe(
          Effect.mapError((cause) =>
            corruption(attempt, "logicalWriteEventInvalid", cause),
          ),
        );
        computedWriteSemanticBytes += after.semanticSizeBytes;
      }
    } else {
      if (event.effectOrdinal !== 0) {
        return yield* Effect.fail(
          corruption(attempt, "logicalWriteEventInvalid"),
        );
      }
      const write = yield* decodeAndVerifyLogicalWriteEventEffect(
        attempt,
        event,
      );
      computedWriteSemanticBytes +=
        write.kind === "delete" ? 0 : write.resultingDocumentSemanticBytes;
      writes.push(write);
    }
  }
  if (computedWriteSemanticBytes !== counters.writeSemanticBytes) {
    return yield* Effect.fail(
      corruption(attempt, "writeSemanticBytesMismatch"),
    );
  }
  if (
    computedMaterialWriteEventEvidenceBytes !==
    counters.materialWriteEventEvidenceBytes
  ) {
    return yield* Effect.fail(
      corruption(attempt, "materialWriteEventEvidenceBytesMismatch"),
    );
  }

  const participantOperations: AdmittedParticipantOperation[] = [];
  for (const record of receiptRecords) {
    if (record.request.kind !== "admittedLogicalOperation") continue;
    const admittedRequest = record.request;
    const outcome = record.outcome;
    if (outcome.kind !== "admittedLogicalResult") {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    const frame = yield* Effect.fromResult(
      encodeAdmittedFrameworkOperationV1Result(record.request.frame).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "latestReceiptEvidenceInvalid", cause),
        ),
      ),
    );
    const frameDigest = yield* Effect.tryPromise({
      try: () => sha256(frame.bytes),
      catch: (cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (
      frame.operation.participant !== record.request.participant ||
      frame.operation.operation !== record.request.method ||
      encodeBytesToLowercaseHex(frameDigest) !== record.request.requestSha256Hex
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    const resultEvidence = yield* canonicalizeFlarexValueJsonV1Effect(
      outcome.result,
    ).pipe(
      Effect.mapError((cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
      ),
    );
    if (
      outcome.sourceDependencies.length !== admittedRequest.sources.length ||
      outcome.sourceDependencies.some(
        (source, ordinal) =>
          source.sourceKey !== admittedRequest.sources[ordinal]?.sourceKey,
      )
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    const binding = yield* Effect.fromResult(
      canonicalizeAdmittedSourceBundleResult({
        participant: record.request.participant,
        method: record.request.method,
        profileRevision: record.request.profileRevision,
        sources: record.request.sources,
      }).pipe(
        Result.mapError((cause) =>
          corruption(attempt, "latestReceiptEvidenceInvalid", cause),
        ),
      ),
    );
    const bindingDigest = yield* Effect.tryPromise({
      try: () => sha256(binding.bytes),
      catch: (cause) =>
        corruption(attempt, "latestReceiptEvidenceInvalid", cause),
    });
    if (
      encodeBytesToLowercaseHex(bindingDigest) !==
      record.request.admissionBundleSha256Hex
    ) {
      return yield* Effect.fail(
        corruption(attempt, "latestReceiptEvidenceInvalid"),
      );
    }
    const sourceContributions = record.request.sources.map((source, ordinal) =>
      Object.freeze({
        ...source,
        effects: Object.freeze(
          (participantEffects.get(record.request.syscallSequence) ?? [])
            .filter(
              (item) =>
                item.sourceBindingSha256Hex === source.sourceBindingSha256Hex,
            )
            .map((item) => item.effect),
        ),
        dependencyEvidence: outcome.sourceDependencies[ordinal]!.evidence,
      }),
    );
    participantOperations.push(
      Object.freeze({
        syscallSequence: record.request.syscallSequence,
        participant: record.request.participant,
        method: record.request.method,
        profileRevision: record.request.profileRevision,
        admissionBundleSha256Hex: record.request.admissionBundleSha256Hex,
        requestSha256Hex: record.request.requestSha256Hex,
        resultSha256Hex: encodeBytesToLowercaseHex(resultEvidence.sha256),
        sourceContributions: Object.freeze(sourceContributions),
        eventIntents: Object.freeze(outcome.events),
      }),
    );
  }
  if (
    [...participantEffects.keys()].some(
      (sequence) =>
        !participantOperations.some(
          (operation) => operation.syscallSequence === sequence,
        ),
    )
  ) {
    return yield* Effect.fail(corruption(attempt, "logicalWriteEventInvalid"));
  }

  const insertionIntents = yield* Effect.fromResult(
    authenticatedGeneratedInsertionsResult(participantOperations).pipe(
      Result.mapError((cause) =>
        corruption(attempt, "logicalWriteEventInvalid", cause),
      ),
    ),
  );
  for (const point of pointRows)
    if (
      point.dependencyKind === "generated_insertion" &&
      !insertionIntents.has(
        appDocumentIdV1FromRowIdentity({
          tableId: point.tableId,
          rowId: appRowIdHexV1FromBytes(point.rowId),
        }),
      )
    )
      return yield* Effect.fail(
        corruption(attempt, "logicalWriteEventInvalid"),
      );
  for (const intent of insertionIntents.values())
    if (
      !pointRows.some(
        (point) =>
          point.tableId === intent.tableId &&
          appRowIdHexV1FromBytes(point.rowId) === intent.rowId &&
          (point.dependencyKind === "generated_insertion" ||
            point.dependencyKind === "missing_no_visible_revision"),
      )
    )
      return yield* Effect.fail(
        corruption(attempt, "logicalWriteEventInvalid"),
      );

  const journal = Object.freeze(
    SessionJournalSchema.make({
      format: SESSION_JOURNAL_FORMAT,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      finalSyscallSequence: lastSyscallSequence,
      readDependencies: Object.freeze(dependencies),
      readUsage: Object.freeze({
        documentsRead: CommitReadDocumentsV1Schema.make(counters.readDocuments),
        semanticBytesRead: CommitReadSemanticBytesV1Schema.make(
          counters.readSemanticBytes,
        ),
      }),
      writes: Object.freeze(writes),
      operationUsage: Object.freeze({
        receiptEvidenceBytes,
        participantWorkBytes,
        participantWorkCalls,
      }),
      participantOperations: Object.freeze(participantOperations),
    }),
  );
  const rootUpdatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  if (rootUpdatedAtMilliseconds === undefined) {
    return yield* Effect.fail(corruption(attempt, "journalStateInvalid"));
  }
  return Object.freeze({
    lastSyscallSequence,
    nextCreationTime: decodeAppCreationTimeV1(root.nextCreationTime),
    counters,
    rootUpdatedAtMilliseconds,
    journal,
  });
});

interface RepeatableReadAttemptAuthorityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly root: typeof fxSystemTransactionJournals.$inferSelect;
}

async function requireRepeatableReadAttemptAuthority(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
  preliminary: TrustedScopeAuthority,
): Promise<RepeatableReadAttemptAuthorityV1> {
  const clockRows = await selectScopeClockRows(tx)
    .where(eq(fxSystemScopeClocks.scopeId, attempt.selector.scopeId))
    .limit(2);
  const clockRow = clockRows[0];
  if (clockRow === undefined || clockRows.length !== 1) {
    throw corruption(attempt, "scopeClockMissingOrDuplicate");
  }
  const clock = decodeScopeClockRecord(clockRow);
  const scopeUuid = decodeScopeUuidV1(clockRow.scopeUuid);
  const epochUuid = decodeScopeEpochUuidV1(clockRow.epochUuid);
  if (
    scopeUuid !== projectScopeIdUuidV1(clock.scopeId).scopeUuid ||
    epochUuid !== projectScopeEpochUuidV1(clock.epoch).epochUuid ||
    preliminary.scopeId !== attempt.selector.scopeId ||
    preliminary.deploymentId !== attempt.selector.deploymentId ||
    preliminary.storageGeneration !== "flarexdb_v1" ||
    clock.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGenerationFence !== clock.storageGenerationFence ||
    preliminary.epoch !== clock.epoch
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const sessionRows = await tx
    .select()
    .from(fxSystemTransactionSessions)
    .where(
      and(
        eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
        eq(fxSystemTransactionSessions.sessionId, attempt.selector.sessionId),
      ),
    )
    .limit(2);
  const session = sessionRows[0];
  if (session === undefined || sessionRows.length !== 1) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  let sessionAttemptFence: TransactionAttemptFence;
  let authorizationRevocationEpoch: ReturnType<
    typeof TransactionAuthorizationRevocationEpochSchema.make
  >;
  try {
    sessionAttemptFence = TransactionAttemptFenceSchema.make(
      session.attemptFence,
    );
    authorizationRevocationEpoch =
      TransactionAuthorizationRevocationEpochSchema.make(
        clockRow.authorizationRevocationEpoch,
      );
  } catch (cause) {
    throw corruption(attempt, "sessionRecordInvalid", cause);
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1 ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    finiteDateMilliseconds(session.createdAt) === undefined ||
    finiteDateMilliseconds(session.updatedAt) === undefined ||
    hardExpiresAtMilliseconds > authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruption(attempt, "sessionRecordInvalid");
  }
  if (
    sessionAttemptFence !== attempt.selector.attemptFence ||
    session.lifecycle !== "running" ||
    session.storageGeneration !== "flarexdb_v1" ||
    session.storageGenerationFence !== clock.storageGenerationFence ||
    session.authorizationRevocationEpoch !== authorizationRevocationEpoch ||
    session.schemaVersionId !== attempt.schemaVersionId
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const leaseRows = await tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(
      and(
        eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
        eq(fxSystemSnapshotLeases.sessionId, attempt.selector.sessionId),
      ),
    )
    .limit(2);
  const lease = leaseRows[0];
  if (lease === undefined || leaseRows.length !== 1) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  let leaseSnapshot: SnapshotToken;
  try {
    leaseSnapshot = SnapshotTokenSchema.make({
      scopeId: attempt.selector.scopeId,
      epoch: replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid),
      commitSeq: CommitSeqSchema.make(lease.snapshotCommitSeq),
    });
  } catch (cause) {
    throw corruption(attempt, "snapshotLeaseInvalid", cause);
  }
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds
  ) {
    throw corruption(attempt, "snapshotLeaseInvalid");
  }
  if (
    lease.attemptFence !== attempt.selector.attemptFence ||
    leaseSnapshot.epoch !== attempt.snapshotToken.epoch ||
    leaseSnapshot.epoch !== clock.epoch ||
    leaseSnapshot.commitSeq !== attempt.snapshotToken.commitSeq ||
    leaseSnapshot.commitSeq > clock.lastCommitSeq
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }
  const databaseNow = await readDatabaseNowForSeal(tx, attempt);
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (databaseNowMilliseconds === undefined) {
    throw corruption(attempt, "databaseClockInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw new SessionJournalSealV1Error({ reason: "stalePreparation" });
  }

  const rootRows = await tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(
      and(
        eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
        eq(fxSystemTransactionJournals.sessionId, attempt.selector.sessionId),
        eq(
          fxSystemTransactionJournals.attemptFence,
          attempt.selector.attemptFence,
        ),
      ),
    )
    .limit(2);
  const root = rootRows[0];
  if (root === undefined || rootRows.length !== 1) {
    throw corruption(attempt, "journalRootMissingOrDuplicate");
  }
  return Object.freeze({ scopeUuid, root });
}

async function readDatabaseNowForSeal(
  tx: AppRowTransaction,
  attempt: SessionJournalAttemptStateV1,
): Promise<Date> {
  const rows = await tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, attempt.selector.scopeId))
    .limit(1);
  const text = rows[0]?.milliseconds;
  if (typeof text !== "string") {
    throw corruption(attempt, "databaseClockInvalid");
  }
  const milliseconds = Number(text);
  const date = new Date(milliseconds);
  if (
    !isPositiveSafeInteger(milliseconds) ||
    finiteDateMilliseconds(date) === undefined
  ) {
    throw corruption(attempt, "databaseClockInvalid");
  }
  return date;
}

async function loadReceiptsReadOnly(
  tx: AppRowTransaction,
  authority: RepeatableReadAttemptAuthorityV1,
): Promise<
  ReadonlyArray<typeof fxSystemTransactionJournalReceipts.$inferSelect>
> {
  const rows = await tx
    .select()
    .from(fxSystemTransactionJournalReceipts)
    .where(
      and(
        eq(fxSystemTransactionJournalReceipts.scopeUuid, authority.scopeUuid),
        eq(
          fxSystemTransactionJournalReceipts.sessionId,
          authority.root.sessionId,
        ),
        eq(
          fxSystemTransactionJournalReceipts.attemptFence,
          authority.root.attemptFence,
        ),
      ),
    )
    .orderBy(asc(fxSystemTransactionJournalReceipts.lastSyscallSequence))
    .limit(MAX_COMMIT_OPERATION_CALLS_V1 + 1);
  return rows;
}
