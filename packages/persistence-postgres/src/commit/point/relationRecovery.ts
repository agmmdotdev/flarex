import {
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from "@flarex/utils/numbers";
import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  Effect,
  Result,
} from "effect";
import { appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import {
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import {
  decodeCanonicalFlarexValueEvidenceV1,
  FlarexValueCodecV1Error,
  FlarexValueEvidenceV1Error,
} from "flarex-protocol/value";
import {
  inspectCommittedOutcomeInTransaction,
  lockPointCommitClock,
  lockPointCommitLease,
  lockPointCommitSession,
  preliminaryAuthorityFailure,
  requireAttemptIsLiveResult,
  requireLockedClockAuthorityResult,
  resolvePointCommitAuthority,
  validateExpectedActiveRelationSelectionForPointCommit,
} from "./attemptAcceptance";
import {
  type RecoveredRunningRelationConflictEvidence,
  recoveredRunningRelationConflictEvidenceBrand,
} from "./capabilities";
import {
  captureRunningRelationConflictAttemptReplacementCommandResult,
  captureRunningRelationConflictRecoveryCommandResult,
  decodePointCommitSyscallSequenceResult,
  decodeRunningRelationConflictOutcomeEvidenceV1Result,
  decodeRunningRelationConflictRequestEvidenceV1Result,
  type RunningRelationConflictOutcomeEvidenceV1Schema,
  type RunningRelationConflictRequestV1Schema,
} from "./capture";
import {
  type PointCommitTransactionProofOptionsV1,
  type PointMutationAttemptReplacementOptionsV1,
} from "./constructionContracts";
import {
  type PointMutationAttemptReplacementObservationV1,
  type RunningRelationConflictAttemptReplacementPortV1,
  type RunningRelationConflictEvidenceV1,
  type RunningRelationConflictRecoveryPort,
  type RunningRelationConflictRequestEvidenceV1,
} from "./contracts";
import {
  corruption,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementConfigurationV1Error,
  type PointMutationAttemptReplacementV1Error,
} from "./errors";
import { type LockedPointCommitClockV1 } from "./lockedState";
import {
  type PreparedRunningRelationConflictAttemptReplacementCommandV1,
  type PreparedRunningRelationConflictRecoveryCommand,
} from "./preparedCommands";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
  runPointCommitPromiseEffect,
} from "./promiseBoundary";
import {
  observeReplacedPointMutationAttempt,
  replaceLockedPointMutationAttempt,
  requireDurableReplacementProfile,
  runReplacementTransactionEffect,
} from "./replacement";
import {
  emitReplacementStep,
  mapPointMutationAttemptReplacementSharedError,
  mapPointMutationAttemptReplacementTransactionFailure,
  observeReplacementQuery,
  PointCommitSqlFailureMarkerV1,
  replacementCorruption,
  replacementSqlCall,
} from "./sqlFailures";
import { readPointCommitDatabaseTime } from "../publication/pointCommitProjection";
import {
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournals,
} from "../../database/schema";
import {
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimOwnerV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import {
  lockExactTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
} from "../../execution/claims/transactionExecutionClaimPersistence";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import {
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import { type TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { type AppRowTransaction } from "../../storage/documents/appRows";
import { decodePointCommitCreationTimeResult } from "../../storage/materialization/headEvidence";
import {
  AppRelationEdgePersistenceError,
  readAppRelationEdgeAdjacencyVersionInTransactionEffect,
} from "../../storage/relations";

export interface RecoveredApplicationRelationActiveSelection {
  readonly activationSequence: bigint;
  readonly activeHeadSha256Hex: string;
}

export function runRunningRelationConflictAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
): Effect.Effect<PointMutationAttemptReplacementObservationV1, PointMutationAttemptReplacementV1Error> {
  return runReplacementTransactionEffect(target, tx => {
    return Effect.gen(function*() {
      const clock = yield* runPointCommitPromiseEffect(() => lockPointCommitClock(tx, command, sharedOptions), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "clockLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      const outcome = yield* runPointCommitPromiseEffect(() => inspectCommittedOutcomeInTransaction(
        tx,
        clock,
        command,
        sharedOptions,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "outcomeRechecked"), mapPointMutationAttemptReplacementTransactionFailure);
      if(outcome !== null) {
        return yield* Effect.fail(new PointMutationAttemptReplacementCommittedOutcomeV1Error({
          reason: outcome.state === "available"
            ? "committedOutcomeAvailable"
            : "committedOutcomeExpired",
          commitSeq: outcome.commitSeq,
        }));
      }
      yield* Effect.fromResult(requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));

      const session = yield* runPointCommitPromiseEffect(() => lockPointCommitSession(
        tx,
        command,
        sharedOptions,
        "replaceRunningRelationConflict",
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "sessionLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      if(session.attemptFence !== command.authorityPins.attemptFence) {
        return yield* runPointCommitPromiseEffect(() => observeReplacedPointMutationAttempt(
          tx,
          clock,
          command,
          session,
          options,
        ), mapPointMutationAttemptReplacementTransactionFailure);
      }

      const lease = yield* runPointCommitPromiseEffect(() => lockPointCommitLease(tx, command, sharedOptions), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "leaseLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      const conflictJournal = yield* runPointCommitPromiseEffect(() => lockRunningRelationConflictJournal(
        tx,
        command,
        options,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* Effect.fromResult(requireDurableReplacementProfile(conflictJournal.executionProfile, lease.row));
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "journalRootLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      const databaseNowMilliseconds = yield* runPointCommitPromiseEffect(() => readPointCommitDatabaseTime(
        tx,
        command.authorityPins.scopeId,
        sharedOptions,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* Effect.fromResult(requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      if(conflictJournal.updatedAtMilliseconds > databaseNowMilliseconds) {
        return yield* Effect.fail(replacementCorruption("journalRootInvalid"));
      }
      const executionClaim = yield* Effect.fromResult((yield* runPointCommitPromiseEffect(() => lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }), mapPointMutationAttemptReplacementTransactionFailure)).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      yield* Effect.fromResult(requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      const recoveredConflict = yield* runPointCommitPromiseEffect(() => recoverRunningRelationConflictEvidence(
        tx,
        clock,
        command,
        conflictJournal,
        options,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      if(
        !runningRelationConflictRecoveryMatchesCommand(
          recoveredConflict,
          command,
        )
      ) {
        return yield* Effect.fail(replacementCorruption("occEvidenceInvalid"));
      }
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(
        options,
        command,
        "activeRelationSelectionValidated",
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "dependenciesValidated"), mapPointMutationAttemptReplacementTransactionFailure);
      const mutationTimeMilliseconds = yield* runPointCommitPromiseEffect(() => readPointCommitDatabaseTime(
        tx,
        command.authorityPins.scopeId,
        sharedOptions,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* Effect.fromResult(requireAttemptIsLiveResult(session, lease, mutationTimeMilliseconds).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      yield* Effect.fromResult(requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(mutationTimeMilliseconds),
      ).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      yield* runPointCommitPromiseEffect(() => deleteRunningRelationConflictExecutionClaim(
        tx,
        clock,
        command,
        options,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "executionClaimDeleted"), mapPointMutationAttemptReplacementTransactionFailure);

      return yield* runPointCommitPromiseEffect(() => replaceLockedPointMutationAttempt(
        tx,
        clock,
        command,
        session,
        lease,
        options,
        sharedOptions,
        executionClaimOwner,
        executionClaimDurationMilliseconds,
        conflictJournal.executionProfile,
        mutationTimeMilliseconds,
      ), mapPointMutationAttemptReplacementTransactionFailure);
    }).pipe(
      Effect.tap(observation => observation.kind === "replaced" ? runPointCommitPromiseEffect(
        () => emitReplacementStep(options, command, "beforeCommit"), mapPointMutationAttemptReplacementTransactionFailure) : Effect.void),
    );
  });
}

export async function runRunningRelationConflictRecovery(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedRunningRelationConflictRecoveryCommand,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
): Promise<RecoveredRunningRelationConflictEvidence> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const clock = await lockPointCommitClock(tx, command, sharedOptions);
    projectPointCommitTransactionResult(
      requireLockedClockAuthorityResult(
        clock,
        preliminaryAuthority,
        command,
      ),
    );
    const session = await lockPointCommitSession(
      tx,
      command,
      sharedOptions,
      "recoverRunningRelationConflict",
    );
    const lease = await lockPointCommitLease(tx, command, sharedOptions);
    const conflictJournal = await lockRunningRelationConflictJournal(
      tx,
      command,
      options,
    );
    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );
    if(conflictJournal.updatedAtMilliseconds > databaseNowMilliseconds) {
      throw replacementCorruption("journalRootInvalid");
    }
    const executionClaim = projectPointCommitTransactionResult(
      await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }),
    );
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ),
    );
    const recovered = await recoverRunningRelationConflictEvidence(
      tx,
      clock,
      command,
      conflictJournal,
      options,
    );
    return Object.freeze({
      [recoveredRunningRelationConflictEvidenceBrand]: true as const,
      request: recovered.request,
      conflict: recovered.conflict,
    });
  });
}

export interface LockedRunningRelationConflictJournalV1 {
  readonly executionProfile: "durableOperations" | "finiteRoot";
  readonly lastSyscallSequence: bigint;
  readonly relationDependencyCount: number;
  readonly createdAtMilliseconds: number;
  readonly updatedAtMilliseconds: number;
}

export async function lockRunningRelationConflictJournal(
  tx: AppRowTransaction,
  command: PreparedRunningRelationConflictRecoveryCommand,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<LockedRunningRelationConflictJournalV1> {
  const query = tx.select().from(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, command.scopeUuid),
    eq(
      fxSystemTransactionJournals.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionJournals.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("lockJournalRoot", query, options);
  const rows = await replacementSqlCall("lockJournalRoot", () => query);
  if(rows.length !== 1) {
    throw replacementCorruption("journalRootMissingOrDuplicate");
  }
  const row = rows[0];
  if(row === undefined) {
    throw replacementCorruption("journalRootMissingOrDuplicate");
  }
  const createdAtMilliseconds = finiteDateMilliseconds(row.createdAt);
  const updatedAtMilliseconds = finiteDateMilliseconds(row.updatedAt);
  const creationTimeSeed = projectPointCommitTransactionResult(
    decodePointCommitCreationTimeResult(row.creationTimeSeed).pipe(
      Result.mapError(() => corruption("journalRootInvalid")),
    ),
  );
  const nextCreationTime = projectPointCommitTransactionResult(
    decodePointCommitCreationTimeResult(row.nextCreationTime).pipe(
      Result.mapError(() => corruption("journalRootInvalid")),
    ),
  );
  if(
    row.scopeUuid !== command.scopeUuid ||
    row.sessionId !== command.authorityPins.sessionId ||
    row.attemptFence !== command.authorityPins.attemptFence ||
    row.state !== "relation_conflicted" ||
    row.lastSyscallSequence < 1n ||
    row.failureDimension !== null ||
    !isNonNegativeSafeInteger(row.readDocuments) ||
    row.readDocuments > MAX_COMMIT_READ_DOCUMENTS_V1 ||
    !isNonNegativeSafeInteger(row.readSemanticBytes) ||
    row.readSemanticBytes > MAX_COMMIT_READ_SEMANTIC_BYTES_V1 ||
    !isNonNegativeSafeInteger(row.pointDependencyCount) ||
    row.pointDependencyCount > MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.indexedQuerySyscalls) ||
    row.indexedQuerySyscalls > MAX_COMMIT_INDEXED_QUERY_SYSCALLS_V1 ||
    !isNonNegativeSafeInteger(row.indexRangeDependencyCount) ||
    row.indexRangeDependencyCount >
    MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.indexRangeDependencyEvidenceBytes) ||
    row.indexRangeDependencyEvidenceBytes >
    MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1 ||
    !isPositiveSafeInteger(row.relationReadSyscalls) ||
    row.relationReadSyscalls > MAX_COMMIT_RELATION_READ_SYSCALLS_V1 ||
    !isNonNegativeSafeInteger(row.relationDependencyCount) ||
    row.relationDependencyCount > MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 ||
    !isNonNegativeSafeInteger(row.relationBaseOccurrences) ||
    row.relationBaseOccurrences > MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1 ||
    !isNonNegativeSafeInteger(row.writeOperations) ||
    row.writeOperations > MAX_COMMIT_WRITE_OPERATIONS_V1 ||
    !isNonNegativeSafeInteger(row.writeSemanticBytes) ||
    row.writeSemanticBytes > MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1 ||
    !isNonNegativeSafeInteger(row.materialWriteEventEvidenceBytes) ||
    row.materialWriteEventEvidenceBytes >
    MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 ||
    row.sealedJournalBytes !== null ||
    row.sealedJournalSha256 !== null ||
    row.sealedResultValueCodecVersion !== null ||
    row.sealedResultSemanticBytes !== null ||
    row.sealedResultBytes !== null ||
    row.sealedResultSha256 !== null ||
    row.sealedAt !== null ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined ||
    createdAtMilliseconds !== command.session.updatedAtMilliseconds ||
    creationTimeSeed !== createdAtMilliseconds ||
    updatedAtMilliseconds < createdAtMilliseconds ||
    nextCreationTime < creationTimeSeed
  ) {
    throw replacementCorruption("journalRootInvalid");
  }
  return Object.freeze({
    executionProfile: row.executionProfile,
    lastSyscallSequence: row.lastSyscallSequence,
    relationDependencyCount: row.relationDependencyCount,
    createdAtMilliseconds,
    updatedAtMilliseconds,
  });
}

export async function recoverRunningRelationConflictEvidence(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedRunningRelationConflictRecoveryCommand,
  journal: LockedRunningRelationConflictJournalV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<Readonly<{
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
  readonly activeSelection: RecoveredApplicationRelationActiveSelection;
}>> {
  const receiptSequence = projectPointCommitTransactionResult(
    decodePointCommitSyscallSequenceResult(
      journal.lastSyscallSequence,
    ).pipe(Result.mapError(() => replacementCorruption("occEvidenceInvalid"))),
  );
  const receiptQuery = tx.select()
    .from(fxSystemTransactionJournalReceipts)
    .where(and(
      eq(fxSystemTransactionJournalReceipts.scopeUuid, command.scopeUuid),
      eq(
        fxSystemTransactionJournalReceipts.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournalReceipts.attemptFence,
        command.authorityPins.attemptFence,
      ),
      eq(
        fxSystemTransactionJournalReceipts.lastSyscallSequence,
        receiptSequence,
      ),
    )).limit(2).for("update");
  observeReplacementQuery("validateRelationDependencies", receiptQuery, options);
  const receipts = await replacementSqlCall(
    "validateRelationDependencies",
    () => receiptQuery,
  );
  if(receipts.length !== 1) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  const receipt = receipts[0];
  const receiptCreatedAt = receipt === undefined
    ? undefined
    : finiteDateMilliseconds(receipt.createdAt);
  const receiptUpdatedAt = receipt === undefined
    ? undefined
    : finiteDateMilliseconds(receipt.updatedAt);
  if(
    receipt === undefined ||
    receipt.scopeUuid !== command.scopeUuid ||
    receipt.sessionId !== command.authorityPins.sessionId ||
    receipt.attemptFence !== command.authorityPins.attemptFence ||
    receipt.lastSyscallSequence !== journal.lastSyscallSequence ||
    receipt.operationKind !== "relationIncoming" ||
    receipt.participantBindingSha256 !== null ||
    receipt.outcomeKind !== "relationConflict" ||
    receipt.requestCodecVersion !== 2 ||
    receipt.outcomeCodecVersion !== 2 ||
    receiptCreatedAt === undefined ||
    receiptUpdatedAt === undefined ||
    receiptCreatedAt !== journal.updatedAtMilliseconds ||
    receiptUpdatedAt !== journal.updatedAtMilliseconds
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  const request = await decodeRunningRelationConflictRequestEvidence(
    receipt.requestBytes,
    receipt.requestSha256,
  );
  const outcome = await decodeRunningRelationConflictOutcomeEvidence(
    receipt.outcomeBytes,
    receipt.outcomeSha256,
  );
  if(
    request.syscallSequence !== journal.lastSyscallSequence ||
    request.limit < 1 ||
    request.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 ||
    outcome.edgeDefinitionId !== request.edgeDefinitionId ||
    outcome.targetRowId !== request.targetRowId ||
    outcome.snapshotCommitSeq !== command.authorityPins.snapshotToken.commitSeq ||
    outcome.expectedAdjacencyVersion > outcome.snapshotCommitSeq ||
    outcome.actualAdjacencyVersion <= outcome.snapshotCommitSeq
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }

  const dependencyQuery = tx.select()
    .from(fxSystemTransactionJournalRelationIncomingDependencies)
    .where(and(
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid,
        command.scopeUuid,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournalRelationIncomingDependencies.attemptFence,
        command.authorityPins.attemptFence,
      ),
    ))
    .orderBy(
      fxSystemTransactionJournalRelationIncomingDependencies.edgeDefinitionId,
      fxSystemTransactionJournalRelationIncomingDependencies.targetRowId,
    )
    .limit(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1)
    .for("update");
  observeReplacementQuery(
    "validateRelationDependencies",
    dependencyQuery,
    options,
  );
  const dependencies = await replacementSqlCall(
    "validateRelationDependencies",
    () => dependencyQuery,
  );
  if(dependencies.length !== journal.relationDependencyCount) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  let matchingDependencyCount = 0;
  let activeSelection: Readonly<{
    readonly activationSequence: bigint;
    readonly activeHeadSha256Hex: string;
  }> | undefined;
  for(const dependency of dependencies) {
    const targetRowId = projectPointCommitTransactionResult(
      appRowIdHexV1FromBytesResult(dependency.targetRowId).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
    const dependencyCreatedAt = finiteDateMilliseconds(dependency.createdAt);
    const dependencyUpdatedAt = finiteDateMilliseconds(dependency.updatedAt);
    if(
      dependency.observedAdjacencyVersion > outcome.snapshotCommitSeq ||
      dependency.activationSequence < 1n ||
      !isUint8ArrayWithByteLength(dependency.activeHeadSha256, 32) ||
      (activeSelection !== undefined &&
        (dependency.activationSequence !==
          activeSelection.activationSequence ||
          encodeBytesToLowercaseHex(dependency.activeHeadSha256) !==
          activeSelection.activeHeadSha256Hex)) ||
      dependencyCreatedAt === undefined ||
      dependencyUpdatedAt === undefined ||
      dependencyCreatedAt < journal.createdAtMilliseconds ||
      dependencyUpdatedAt < dependencyCreatedAt ||
      dependencyUpdatedAt > journal.updatedAtMilliseconds
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    activeSelection ??= Object.freeze({
      activationSequence: dependency.activationSequence,
      activeHeadSha256Hex:
        encodeBytesToLowercaseHex(dependency.activeHeadSha256),
    });
    if(
      dependency.edgeDefinitionId === outcome.edgeDefinitionId &&
      targetRowId === outcome.targetRowId
    ) {
      matchingDependencyCount += 1;
      if(
        dependency.observedAdjacencyVersion !==
        outcome.expectedAdjacencyVersion
      ) {
        throw replacementCorruption("occEvidenceInvalid");
      }
    }
  }
  if(matchingDependencyCount !== 1 || activeSelection === undefined) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  await validateExpectedActiveRelationSelectionForPointCommit(
    tx,
    command.authorityPins.scopeId,
    [activeSelection],
  );

  const settled = await runPointCommitInTransactionEffect(
    readAppRelationEdgeAdjacencyVersionInTransactionEffect(tx, {
      scopeId: command.authorityPins.scopeId,
      edgeDefinitionId: outcome.edgeDefinitionId,
      direction: "incoming",
      endpointRowId: outcome.targetRowId,
    }),
  );
  const current = projectPointCommitTransactionResult(
    settled.pipe(Result.mapError((failure) =>
      failure instanceof AppRelationEdgePersistenceError
        ? new PointCommitSqlFailureMarkerV1(
          "validateRelationDependencies",
          failure.cause,
        )
        : corruption("occEvidenceInvalid")
    )),
  );
  if(
    current < outcome.actualAdjacencyVersion ||
    current <= outcome.snapshotCommitSeq ||
    current > clock.record.lastCommitSeq
  ) {
    throw replacementCorruption("occEvidenceInvalid");
  }
  return Object.freeze({
    request: Object.freeze({ ...request }),
    conflict: Object.freeze({ ...outcome }),
    activeSelection,
  });
}

export function runningRelationConflictRecoveryMatchesCommand(
  recovered: Readonly<{
    readonly request: RunningRelationConflictRequestEvidenceV1;
    readonly conflict: RunningRelationConflictEvidenceV1;
  }>,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
): boolean {
  const request = recovered.request;
  const expectedRequest = command.request;
  const conflict = recovered.conflict;
  const expectedConflict = command.conflict;
  return request.syscallSequence === expectedRequest.syscallSequence &&
    request.relationId === expectedRequest.relationId &&
    request.edgeDefinitionId === expectedRequest.edgeDefinitionId &&
    request.sourceTableId === expectedRequest.sourceTableId &&
    request.targetTableId === expectedRequest.targetTableId &&
    request.targetRowId === expectedRequest.targetRowId &&
    request.limit === expectedRequest.limit &&
    conflict.edgeDefinitionId === expectedConflict.edgeDefinitionId &&
    conflict.targetRowId === expectedConflict.targetRowId &&
    conflict.expectedAdjacencyVersion ===
    expectedConflict.expectedAdjacencyVersion &&
    conflict.actualAdjacencyVersion ===
    expectedConflict.actualAdjacencyVersion &&
    conflict.snapshotCommitSeq === expectedConflict.snapshotCommitSeq;
}

export async function decodeRunningRelationConflictRequestEvidence(
  canonicalBytes: unknown,
  sha256: unknown,
): Promise<typeof RunningRelationConflictRequestV1Schema.Type> {
  try {
    const evidence = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
    });
    return projectPointCommitTransactionResult(
      decodeRunningRelationConflictRequestEvidenceV1Result(evidence.value).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
  } catch(cause) {
    if(
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    throw cause;
  }
}

export async function decodeRunningRelationConflictOutcomeEvidence(
  canonicalBytes: unknown,
  sha256: unknown,
): Promise<typeof RunningRelationConflictOutcomeEvidenceV1Schema.Type> {
  try {
    const evidence = await decodeCanonicalFlarexValueEvidenceV1({
      canonicalBytes,
      sha256,
    });
    return projectPointCommitTransactionResult(
      decodeRunningRelationConflictOutcomeEvidenceV1Result(evidence.value).pipe(
        Result.mapError(() => corruption("occEvidenceInvalid")),
      ),
    );
  } catch(cause) {
    if(
      cause instanceof FlarexValueCodecV1Error ||
      cause instanceof FlarexValueEvidenceV1Error
    ) {
      throw replacementCorruption("occEvidenceInvalid");
    }
    throw cause;
  }
}

export async function deleteRunningRelationConflictExecutionClaim(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedRunningRelationConflictAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<void> {
  const query = tx.delete(fxSystemTransactionExecutionClaims).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionExecutionClaims.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      command.authorityPins.attemptFence,
    ),
    eq(
      fxSystemTransactionExecutionClaims.claimOwner,
      command.executionClaim.claimOwner,
    ),
    eq(
      fxSystemTransactionExecutionClaims.claimFence,
      command.executionClaim.claimFence,
    ),
    sql`${fxSystemTransactionExecutionClaims.claimExpiresAt} > clock_timestamp()`,
  )).returning({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
  });
  observeReplacementQuery("deleteExecutionClaim", query, options);
  const rows = await replacementSqlCall("deleteExecutionClaim", () => query);
  if(
    rows.length !== 1 ||
    rows[0]?.claimFence !== command.executionClaim.claimFence
  ) {
    throw replacementCorruption("replacementMutationInvalid");
  }
}

export function bindRunningRelationConflictReplacementAndRecovery(ports: PointMutationSessionAuthorityResolutionPortsV1, options: PointMutationAttemptReplacementOptionsV1, proofOptions: PointCommitTransactionProofOptionsV1, randomExecutionClaimOwner: () => string, executionClaimDurationMilliseconds: number): RunningRelationConflictAttemptReplacementPortV1 & RunningRelationConflictRecoveryPort {
  const replaceRunningRelationConflict:
    RunningRelationConflictAttemptReplacementPortV1[
    "replaceRunningRelationConflict"
    ] = Effect.fn(
      "PointMutationAttemptReplacement.replaceRunningRelationConflict",
    )(function*(input) {
      const command = yield* Effect.fromResult(
        captureRunningRelationConflictAttemptReplacementCommandResult(input),
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const generatedOwner = yield* Effect.try({
        try: randomExecutionClaimOwner,
        catch: () => new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerGenerationFailed",
        ),
      });
      const decodedOwner = yield* Effect.fromResult(
        decodeTransactionExecutionClaimOwnerV1(generatedOwner),
      ).pipe(Effect.mapError(() =>
        new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerInvalid",
        )
      ));
      const located = yield* resolvePointCommitAuthority(
        command.authorityPins,
        ports,
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const preliminaryFailure = preliminaryAuthorityFailure(
        command,
        located.authority,
      );
      if(preliminaryFailure !== null) {
        return yield* Effect.fail(
          mapPointMutationAttemptReplacementSharedError(preliminaryFailure),
        );
      }
      const target = isLocatedReadCommittedAttemptTargetV1(located.target)
        ? located.target
        : null;
      if(target === null) {
        return yield* Effect.fail(replacementCorruption(
          "readCommittedCapabilityMissing",
        ));
      }
      return yield* Effect.uninterruptible(runRunningRelationConflictAttemptReplacement(
        target,
        located.authority,
        command,
        options,
        proofOptions,
        decodedOwner,
        executionClaimDurationMilliseconds,
      ));
    });

  const recoverRunningRelationConflict:
    RunningRelationConflictRecoveryPort["recoverRunningRelationConflict"] =
    Effect.fn(
      "PointMutationAttemptReplacement.recoverRunningRelationConflict",
    )(function*(input) {
      const command = yield* Effect.fromResult(
        captureRunningRelationConflictRecoveryCommandResult(input),
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const located = yield* resolvePointCommitAuthority(
        command.authorityPins,
        ports,
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
      const preliminaryFailure = preliminaryAuthorityFailure(
        command,
        located.authority,
      );
      if(preliminaryFailure !== null) {
        return yield* Effect.fail(
          mapPointMutationAttemptReplacementSharedError(preliminaryFailure),
        );
      }
      const target = isLocatedReadCommittedAttemptTargetV1(located.target)
        ? located.target
        : null;
      if(target === null) {
        return yield* Effect.fail(replacementCorruption(
          "readCommittedCapabilityMissing",
        ));
      }
      return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() => runRunningRelationConflictRecovery(
        target,
        located.authority,
        command,
        options,
        proofOptions,
      ), mapPointMutationAttemptReplacementTransactionFailure));
    });
  return { replaceRunningRelationConflict, recoverRunningRelationConflict };
}
