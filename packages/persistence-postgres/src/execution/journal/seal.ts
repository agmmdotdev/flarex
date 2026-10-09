import type { SessionJournalStorePersistence } from "./contracts";
import {
  InvalidSessionJournalCapabilityV1Error,
  SessionJournalAttemptUnavailableV1Error,
  SessionJournalPersistenceV1Error,
  SessionJournalLeasePromotionV1Error,
  SessionJournalSealV1Error,
} from "./errors";
import type {
  SessionJournalStorageCorruptionV1Error,
  SessionJournalCompleteSealV1Error,
} from "./errors";
import type { SessionJournalAttemptStateV1 } from "./state";
import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, eq, getTableColumns } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  verifySuccessfulResultEvidenceV1Effect,
} from "flarex-protocol/commit-protocol";
import type {
  CanonicalSessionJournal,
  CanonicalSuccessfulResultV1,
  CommitFinalSyscallSequenceV1,
  SessionJournal,
  StoredForSessionAttemptCommitEnvelopeV1,
} from "flarex-protocol/commit-protocol";
import { encodeCanonicalJson, jsonEqual } from "flarex-protocol/json";
import type { Json } from "flarex-protocol/json";
import { projectScopeEpochUuidV1 } from "flarex-protocol/storage-authority";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueCodecV1Error,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
} from "../../database/schema";
import { projectSealedAttemptLeasePromotionV1Result } from "../sealedAttemptLeasePromotion";
import type { SealedAttemptLeasePromotionIssueV1 } from "../sealedAttemptLeasePromotion";
import {
  ExactRunningAttemptTransactionV1Error,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
} from "../transactionSessionAttemptKernel";
import type { ExactRunningAttemptKernelContextV1 } from "../transactionSessionAttemptKernel";
import {
  TEXT_ENCODER,
  encodeSessionJournal,
  encodeSessionJournalResult,
  requireJson,
  sha256,
} from "./codecs";
import {
  sealProjectionOrdinal,
  exactSealProjectionOrdinalsResult,
  detachSealCandidate,
  captureSealRowsInTransaction,
  materializeSealCandidateEffect,
} from "./journalProjection";
import type { SessionJournalSealCandidateV1 } from "./journalProjection";
import {
  mapPrepareSealSnapshotFailure,
  mapCompleteSealTransactionFailure,
  mapExactRunningAttemptCompleteSealFailure,
  kernelContextMatchesAttempt,
  corruption,
} from "./journalFailures";
import type { JournalAttemptOwner } from "./attemptOwner";
import { admitExactRunningAttemptEffect } from "./targetAdmission";
import type { JournalTargetResolver } from "./targetAdmission";

export interface PreparedSessionJournalSealStateV1 {
  readonly attempt: SessionJournalAttemptStateV1;
  readonly candidate: SessionJournalSealCandidateV1;
}

interface ValidatedCanonicalSealEvidenceV1 {
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly journalBytes: Uint8Array;
  readonly journalSha256: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournal["sha256Hex"];
  readonly resultValueCodecVersion: typeof FLAREX_VALUE_CODEC_VERSION_V1;
  readonly resultSemanticBytes: number;
  readonly resultBytes: Uint8Array;
  readonly resultSha256: Uint8Array;
  readonly successfulResult: CanonicalSuccessfulResultV1["evidence"];
}

interface CanonicalSealInputsSnapshotV1 {
  readonly journal: SessionJournal;
  readonly journalCanonicalText: string;
  readonly journalBytes: Uint8Array;
  readonly journalSha256Hex: CanonicalSessionJournal["sha256Hex"];
  readonly resultValueJson: Json;
  readonly resultSemanticBytes: number;
  readonly resultCanonicalText: string;
  readonly resultBytes: Uint8Array;
  readonly resultEvidence: unknown;
}

function captureCanonicalSealInputsResult(
  journal: CanonicalSessionJournal,
  successfulResult: CanonicalSuccessfulResultV1,
): Result.Result<CanonicalSealInputsSnapshotV1, SessionJournalSealV1Error> {
  return Result.gen(function* () {
    const capturedJournal = yield* Result.try({
      try: () =>
        Object.freeze({
          journal: structuredClone(journal.journal),
          journalCanonicalText: journal.canonicalText,
          journalBytes: new Uint8Array(journal.canonicalBytes),
          journalSha256Hex: journal.sha256Hex,
        }),
      catch: () => sealMismatch("canonicalJournalMismatch"),
    });
    return yield* Result.try({
      try: () =>
        Object.freeze({
          ...capturedJournal,
          resultValueJson: structuredClone(successfulResult.valueJson),
          resultSemanticBytes: successfulResult.semanticSizeBytes,
          resultCanonicalText: successfulResult.canonicalText,
          resultBytes: new Uint8Array(successfulResult.canonicalBytes),
          resultEvidence: structuredClone(successfulResult.evidence),
        }),
      catch: () => sealMismatch("canonicalResultMismatch"),
    });
  });
}

const validateCanonicalSealEvidenceEffect = Effect.fn(
  "SessionJournalStore.validateCanonicalSealEvidence",
)(function* (
  candidate: SessionJournalSealCandidateV1,
  journal: CanonicalSessionJournal,
  successfulResult: CanonicalSuccessfulResultV1,
): Effect.fn.Return<
  ValidatedCanonicalSealEvidenceV1,
  SessionJournalPersistenceV1Error | SessionJournalSealV1Error
> {
  const supplied = yield* Effect.fromResult(
    captureCanonicalSealInputsResult(journal, successfulResult),
  );
  const expectedJournalJson = requireJson(
    encodeSessionJournal(candidate.journal),
  );
  const suppliedJournalEncoded = yield* Effect.fromResult(
    encodeSessionJournalResult(supplied.journal).pipe(
      Result.mapError(() => sealMismatch("canonicalJournalMismatch")),
    ),
  );
  const suppliedJournalJson = requireJson(suppliedJournalEncoded);
  const expectedJournalText = encodeCanonicalJson(expectedJournalJson, () => {
    throw new Error(
      "Materialized session journal violated canonical JSON invariants.",
    );
  });
  if (
    !jsonEqual(expectedJournalJson, suppliedJournalJson) ||
    supplied.journalCanonicalText !== expectedJournalText ||
    !bytesEqual(supplied.journalBytes, TEXT_ENCODER.encode(expectedJournalText))
  ) {
    return yield* Effect.fail(sealMismatch("canonicalJournalMismatch"));
  }
  const journalDigest = yield* Effect.tryPromise({
    try: () => sha256(supplied.journalBytes),
    catch: (cause) =>
      new SessionJournalPersistenceV1Error({
        operation: "hashSealJournal",
        cause,
      }),
  });
  if (
    encodeBytesToLowercaseHex(journalDigest) !== supplied.journalSha256Hex ||
    supplied.journal.finalSyscallSequence !== candidate.lastSyscallSequence
  ) {
    return yield* Effect.fail(sealMismatch("canonicalJournalMismatch"));
  }

  const normalizedResult = yield* Effect.fromResult(
    normalizeSealResultValueJsonCompatibilityResult(supplied.resultValueJson),
  );
  const expectedResultText = encodeCanonicalJson(
    {
      format: "flarex-value",
      value: normalizedResult.valueJson,
      valueCodecVersion: 1,
    },
    () => {
      throw new Error(
        "Normalized successful result violated canonical JSON invariants.",
      );
    },
  );
  const verifiedResult = yield* verifySuccessfulResultEvidenceV1Effect(
    supplied.resultEvidence,
  ).pipe(Effect.mapError(() => sealMismatch("canonicalResultMismatch")));
  const verifiedResultBytes = verifiedResult.canonicalBytes;
  if (
    supplied.resultSemanticBytes !== normalizedResult.semanticSizeBytes ||
    verifiedResult.semanticSizeBytes !== normalizedResult.semanticSizeBytes ||
    supplied.resultCanonicalText !== expectedResultText ||
    verifiedResult.canonicalText !== expectedResultText ||
    !jsonEqual(verifiedResult.valueJson, normalizedResult.valueJson) ||
    !bytesEqual(
      supplied.resultBytes,
      TEXT_ENCODER.encode(expectedResultText),
    ) ||
    !bytesEqual(verifiedResultBytes, supplied.resultBytes)
  ) {
    return yield* Effect.fail(sealMismatch("canonicalResultMismatch"));
  }
  const resultDigest = yield* Effect.fromResult(
    decodeLowercaseSha256HexResult(verifiedResult.evidence.sha256Hex),
  );
  return Object.freeze({
    finalSyscallSequence: candidate.lastSyscallSequence,
    journalBytes: new Uint8Array(supplied.journalBytes),
    journalSha256: journalDigest,
    journalSha256Hex: supplied.journalSha256Hex,
    resultValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    resultSemanticBytes: verifiedResult.semanticSizeBytes,
    resultBytes: new Uint8Array(verifiedResultBytes),
    resultSha256: resultDigest,
    successfulResult: Object.freeze({ ...verifiedResult.evidence }),
  });
});

/**
 * Temporary compatibility seam for the protocol's throwing JSON normalizer.
 * Delete this adapter when Value Codec V1 exposes its Result-native decoder.
 */
function normalizeSealResultValueJsonCompatibilityResult(
  valueJson: unknown,
): Result.Result<
  ReturnType<typeof normalizeFlarexValueJsonV1>,
  SessionJournalSealV1Error
> {
  return Result.try({
    try: () => normalizeFlarexValueJsonV1(valueJson),
    catch: (cause) => {
      if (cause instanceof FlarexValueCodecV1Error) {
        return sealMismatch("canonicalResultMismatch");
      }
      throw cause;
    },
  });
}

function sealMismatch(
  reason: "canonicalJournalMismatch" | "canonicalResultMismatch",
): SessionJournalSealV1Error {
  return new SessionJournalSealV1Error({ reason });
}

const completeSealInTransactionEffect = Effect.fn(
  "SessionJournalStore.completeSealInTransaction",
)(function* (
  tx: AppRowTransaction,
  context: ExactRunningAttemptKernelContextV1,
  prepared: PreparedSessionJournalSealStateV1,
  evidence: ValidatedCanonicalSealEvidenceV1,
  maximumLiveSnapshotRetentionMilliseconds: number,
): Effect.fn.Return<
  StoredForSessionAttemptCommitEnvelopeV1,
  SessionJournalCompleteSealV1Error
> {
  if (!kernelContextMatchesAttempt(context, prepared.attempt)) {
    return yield* Effect.fail(
      corruption(prepared.attempt, "exactAttemptPinsChanged"),
    );
  }
  const root = context.journalRoot;
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
  const databaseNowMilliseconds = finiteDateMilliseconds(context.databaseNow);
  const currentLeaseExpiresAt = new Date(context.anchor.leaseExpiresAt);
  const currentLeaseExpiresAtMilliseconds = finiteDateMilliseconds(
    currentLeaseExpiresAt,
  );
  const promotion = yield* Effect.fromResult(
    projectSealedAttemptLeasePromotionV1Result({
      authorizationGrantExpiresAtMilliseconds:
        context.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: context.hardExpiresAtMilliseconds,
      databaseNowMilliseconds: databaseNowMilliseconds ?? Number.NaN,
      currentLeaseExpiresAtMilliseconds:
        currentLeaseExpiresAtMilliseconds ?? Number.NaN,
      maximumLiveSnapshotRetentionMilliseconds,
    }),
  ).pipe(
    Effect.mapError((issue) =>
      mapLeasePromotionIssue(
        prepared.attempt,
        issue,
        maximumLiveSnapshotRetentionMilliseconds,
      ),
    ),
  );
  const targetLeaseExpiresAt = new Date(
    promotion.targetLeaseExpiresAtMilliseconds,
  );
  if (root.state === "sealed") {
    if (
      currentLeaseExpiresAtMilliseconds !==
      promotion.targetLeaseExpiresAtMilliseconds
    ) {
      return yield* Effect.fail(
        corruption(prepared.attempt, "snapshotLeaseInvalid"),
      );
    }
    yield* Effect.fromResult(
      validateStoredSealMatchesResult(prepared.attempt, root, evidence),
    );
    return storedSealEnvelope(context, evidence);
  }
  if (root.state !== "open") {
    return yield* Effect.fail(
      corruption(prepared.attempt, "journalStateInvalid"),
    );
  }
  yield* Effect.fromResult(
    validateSealCandidateStillCurrentResult(prepared.candidate, root),
  );

  const expectedSealedRoot = {
    ...root,
    state: "sealed",
    failureDimension: null,
    sealedJournalBytes: evidence.journalBytes,
    sealedJournalSha256: evidence.journalSha256,
    sealedResultValueCodecVersion: evidence.resultValueCodecVersion,
    sealedResultSemanticBytes: evidence.resultSemanticBytes,
    sealedResultBytes: evidence.resultBytes,
    sealedResultSha256: evidence.resultSha256,
    sealedAt: context.databaseNow,
    updatedAt: context.databaseNow,
  };
  const promotedLeaseRows = yield* Effect.tryPromise({
    try: () =>
      tx
        .update(fxSystemSnapshotLeases)
        .set({ leaseExpiresAt: targetLeaseExpiresAt })
        .where(
          and(
            eq(fxSystemSnapshotLeases.scopeUuid, context.scopeUuid),
            eq(fxSystemSnapshotLeases.sessionId, context.anchor.sessionId),
            eq(
              fxSystemSnapshotLeases.attemptFence,
              context.anchor.attemptFence,
            ),
            eq(
              fxSystemSnapshotLeases.snapshotEpochUuid,
              projectScopeEpochUuidV1(context.anchor.snapshotToken.epoch)
                .epochUuid,
            ),
            eq(
              fxSystemSnapshotLeases.snapshotCommitSeq,
              context.anchor.snapshotToken.commitSeq,
            ),
            eq(fxSystemSnapshotLeases.leaseExpiresAt, currentLeaseExpiresAt),
          ),
        )
        .returning({ leaseExpiresAt: fxSystemSnapshotLeases.leaseExpiresAt }),
    catch: mapCompleteSealTransactionFailure,
  });
  const promotedLeaseExpiresAtMilliseconds =
    promotedLeaseRows.length === 1
      ? finiteDateMilliseconds(promotedLeaseRows[0]?.leaseExpiresAt)
      : undefined;
  if (
    promotedLeaseExpiresAtMilliseconds !==
    promotion.targetLeaseExpiresAtMilliseconds
  ) {
    return yield* Effect.fail(
      corruption(prepared.attempt, "snapshotLeaseInvalid"),
    );
  }
  const updated = yield* Effect.tryPromise({
    try: () =>
      tx
        .update(fxSystemTransactionJournals)
        .set({
          state: "sealed",
          failureDimension: null,
          sealedJournalBytes: new Uint8Array(evidence.journalBytes),
          sealedJournalSha256: new Uint8Array(evidence.journalSha256),
          sealedResultValueCodecVersion: evidence.resultValueCodecVersion,
          sealedResultSemanticBytes: evidence.resultSemanticBytes,
          sealedResultBytes: new Uint8Array(evidence.resultBytes),
          sealedResultSha256: new Uint8Array(evidence.resultSha256),
          sealedAt: context.databaseNow,
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
              prepared.candidate.lastSyscallSequence,
            ),
            eq(
              fxSystemTransactionJournals.updatedAt,
              new Date(prepared.candidate.rootUpdatedAtMilliseconds),
            ),
          ),
        )
        .returning({
          state: fxSystemTransactionJournals.state,
          ordinal: sealProjectionOrdinal(
            getTableColumns(fxSystemTransactionJournals),
            [expectedSealedRoot],
          ),
        }),
    catch: mapCompleteSealTransactionFailure,
  });
  if (updated.length !== 1 || updated[0]?.state !== "sealed") {
    return yield* Effect.fail(
      new SessionJournalSealV1Error({ reason: "stalePreparation" }),
    );
  }
  yield* Effect.fromResult(
    exactSealProjectionOrdinalsResult(prepared.attempt, 1, updated, false),
  );
  // AFTER UPDATE triggers run after RETURNING's row image was formed. Recheck
  // the actual stored root with the same full expected columns before any seal
  // payload capture. This also protects ordinary Application seal completion.
  const storedRoot = yield* Effect.tryPromise({
    try: () =>
      tx
        .select({
          ordinal: sealProjectionOrdinal(
            getTableColumns(fxSystemTransactionJournals),
            [expectedSealedRoot],
          ),
        })
        .from(fxSystemTransactionJournals)
        .where(
          and(
            eq(fxSystemTransactionJournals.scopeUuid, context.scopeUuid),
            eq(fxSystemTransactionJournals.sessionId, context.anchor.sessionId),
            eq(
              fxSystemTransactionJournals.attemptFence,
              context.anchor.attemptFence,
            ),
          ),
        )
        .limit(2),
    catch: mapCompleteSealTransactionFailure,
  });
  yield* Effect.fromResult(
    exactSealProjectionOrdinalsResult(prepared.attempt, 1, storedRoot, false),
  );
  return storedSealEnvelope(context, evidence);
});

function mapLeasePromotionIssue(
  attempt: SessionJournalAttemptStateV1,
  issue: SealedAttemptLeasePromotionIssueV1,
  maximumLiveSnapshotRetentionMilliseconds: number,
):
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalLeasePromotionV1Error
  | SessionJournalStorageCorruptionV1Error {
  switch (issue.kind) {
    case "authorityExpiryInvalid":
      return corruption(attempt, "sessionRecordInvalid");
    case "databaseClockInvalid":
      return corruption(attempt, "databaseClockInvalid");
    case "retentionBudgetInvalid":
      return new SessionJournalLeasePromotionV1Error({
        issue: Object.freeze({
          kind: "retentionPolicyInvalid",
          maximumLiveSnapshotRetentionMilliseconds,
        }),
      });
    case "authorityExpired":
    case "currentLeaseExpired":
      return new SessionJournalAttemptUnavailableV1Error({
        issue: { reason: "activeAttemptExpired" },
      });
    case "retentionBudgetExceeded":
      return new SessionJournalLeasePromotionV1Error({
        issue: Object.freeze({
          kind: "retentionBudgetExceeded",
          remainingMilliseconds: issue.remainingMilliseconds,
          maximumLiveSnapshotRetentionMilliseconds:
            issue.maximumLiveSnapshotRetentionMilliseconds,
        }),
      });
    case "currentLeaseInvalid":
    case "currentLeaseAfterTarget":
      return corruption(attempt, "snapshotLeaseInvalid");
  }
}

function validateSealCandidateStillCurrentResult(
  candidate: SessionJournalSealCandidateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Result.Result<void, SessionJournalSealV1Error> {
  const rootUpdatedAtMilliseconds = finiteDateMilliseconds(root.updatedAt);
  if (
    root.lastSyscallSequence !== candidate.lastSyscallSequence ||
    root.nextCreationTime !== candidate.nextCreationTime ||
    root.readDocuments !== candidate.counters.readDocuments ||
    root.readSemanticBytes !== candidate.counters.readSemanticBytes ||
    root.pointDependencyCount !== candidate.counters.pointDependencyCount ||
    root.indexedQuerySyscalls !== candidate.counters.indexedQuerySyscalls ||
    root.indexRangeDependencyCount !==
      candidate.counters.indexRangeDependencyCount ||
    root.indexRangeDependencyEvidenceBytes !==
      candidate.counters.indexRangeDependencyEvidenceBytes ||
    root.relationReadSyscalls !== candidate.counters.relationReadSyscalls ||
    root.relationDependencyCount !==
      candidate.counters.relationDependencyCount ||
    root.relationBaseOccurrences !==
      candidate.counters.relationBaseOccurrences ||
    root.writeOperations !== candidate.counters.writeOperations ||
    root.writeSemanticBytes !== candidate.counters.writeSemanticBytes ||
    root.materialWriteEventEvidenceBytes !==
      candidate.counters.materialWriteEventEvidenceBytes ||
    rootUpdatedAtMilliseconds !== candidate.rootUpdatedAtMilliseconds
  ) {
    return Result.fail(
      new SessionJournalSealV1Error({ reason: "stalePreparation" }),
    );
  }
  return Result.succeed(undefined);
}

function validateStoredSealMatchesResult(
  attempt: SessionJournalAttemptStateV1,
  root: typeof fxSystemTransactionJournals.$inferSelect,
  evidence: ValidatedCanonicalSealEvidenceV1,
): Result.Result<
  void,
  SessionJournalSealV1Error | SessionJournalStorageCorruptionV1Error
> {
  if (
    root.lastSyscallSequence !== evidence.finalSyscallSequence ||
    root.sealedJournalBytes === null ||
    root.sealedJournalSha256 === null ||
    root.sealedResultValueCodecVersion !== evidence.resultValueCodecVersion ||
    root.sealedResultSemanticBytes !== evidence.resultSemanticBytes ||
    root.sealedResultBytes === null ||
    root.sealedResultSha256 === null ||
    !bytesEqual(root.sealedJournalBytes, evidence.journalBytes) ||
    !bytesEqual(root.sealedJournalSha256, evidence.journalSha256) ||
    !bytesEqual(root.sealedResultBytes, evidence.resultBytes) ||
    !bytesEqual(root.sealedResultSha256, evidence.resultSha256)
  ) {
    return Result.fail(
      new SessionJournalSealV1Error({
        reason: "sealedEvidenceMismatch",
      }),
    );
  }
  if (root.failureDimension !== null || root.sealedAt === null) {
    return Result.fail(corruption(attempt, "sealedJournalStateInvalid"));
  }
  return Result.succeed(undefined);
}

function storedSealEnvelope(
  context: ExactRunningAttemptKernelContextV1,
  evidence: ValidatedCanonicalSealEvidenceV1,
): StoredForSessionAttemptCommitEnvelopeV1 {
  return Object.freeze({
    format: COMMIT_ENVELOPE_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    sessionId: context.anchor.sessionId,
    attemptFence: context.anchor.attemptFence,
    finalSyscallSequence: evidence.finalSyscallSequence,
    journal: Object.freeze({ kind: "storedForSessionAttempt" }),
    journalSha256Hex: evidence.journalSha256Hex,
    successfulResult: evidence.successfulResult,
  });
}

function decodeLowercaseSha256HexResult(
  value: string,
): Result.Result<Uint8Array, SessionJournalSealV1Error> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return Result.fail(sealMismatch("canonicalResultMismatch"));
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Result.succeed(bytes);
}

export function makeJournalSeal(
  owner: JournalAttemptOwner,
  resolveJournalTargetEffect: JournalTargetResolver,
  maximumLiveSnapshotRetentionMilliseconds: number,
) {
  const prepareSealEffect: SessionJournalStorePersistence["prepareSealEffect"] =
    Effect.fn("SessionJournalStore.prepareSeal")(function* (attempt) {
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
      if (attemptState.executionProfile === "finiteRoot") {
        return yield* Effect.fail(
          corruption(attemptState, "journalStateInvalid"),
        );
      }
      const resolved = yield* resolveJournalTargetEffect(attemptState);
      yield* admitExactRunningAttemptEffect(
        resolved,
        attemptState,
        "prepareSealSnapshot",
      );
      const snapshot = yield* Effect.uninterruptible(
        Effect.tryPromise({
          try: () =>
            resolved.target[RUN_LOCATED_REPEATABLE_READ_V1]((tx) =>
              captureSealRowsInTransaction(
                tx,
                attemptState,
                resolved.authority,
              ),
            ),
          catch: mapPrepareSealSnapshotFailure,
        }),
      );
      const candidate = detachSealCandidate(
        yield* materializeSealCandidateEffect(attemptState, snapshot),
      );
      const handle = owner.issueSealPreparation(
        Object.freeze({ attempt: attemptState, candidate }),
      );
      return Object.freeze({
        preparation: handle,
        journal: structuredClone(candidate.journal),
      });
    });

  const completeSealEffect: SessionJournalStorePersistence["completeSealEffect"] =
    Effect.fn("SessionJournalStore.completeSeal")(
      function* (preparation, journal, successfulResult) {
        const prepared =
          typeof preparation === "object" && preparation !== null
            ? owner.readSealPreparation(preparation)
            : undefined;
        if (prepared === undefined) {
          return yield* Effect.fail(
            new InvalidSessionJournalCapabilityV1Error({
              capability: "sealPreparation",
            }),
          );
        }
        if (prepared.attempt.executionProfile === "finiteRoot") {
          return yield* Effect.fail(
            corruption(prepared.attempt, "journalStateInvalid"),
          );
        }
        const sealedEvidence = yield* validateCanonicalSealEvidenceEffect(
          prepared.candidate,
          journal,
          successfulResult,
        );
        const resolved = yield* resolveJournalTargetEffect(prepared.attempt);
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const envelope = yield* resolved.target[
              RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
            ](
              {
                selector: prepared.attempt.selector,
                preliminaryAuthority: resolved.authority,
                executionClaim: prepared.attempt.executionClaim,
              },
              (tx, context) =>
                completeSealInTransactionEffect(
                  tx,
                  context,
                  prepared,
                  sealedEvidence,
                  maximumLiveSnapshotRetentionMilliseconds,
                ),
            ).pipe(
              Effect.mapError((error) =>
                error instanceof ExactRunningAttemptTransactionV1Error
                  ? mapExactRunningAttemptCompleteSealFailure(error)
                  : error,
              ),
            );
            owner.consumeSealPreparation(preparation);
            return envelope;
          }),
        );
      },
    );
  return Object.freeze({ prepareSealEffect, completeSealEffect });
}
