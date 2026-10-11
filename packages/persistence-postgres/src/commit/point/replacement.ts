import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  Cause,
  Effect,
  Exit,
  Result,
} from "effect";
import { SESSION_JOURNAL_FORMAT } from "flarex-protocol/commit-protocol";
import { SnapshotTokenSchema } from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_ATTEMPT_FENCE,
  type TransactionAttemptFence,
  TransactionAttemptFenceSchema,
} from "flarex-protocol/transaction-session";
import {
  type PreparedFiniteActiveApplication,
} from "../../application/activation/contracts";
import { type ApplicationMutationAdmissionError } from "../../application/applicationMutationAdmission";
import {
  inspectCommittedOutcomeInTransaction,
  lockPointCommitClock,
  lockPointCommitJournalRoot,
  lockPointCommitLease,
  lockPointCommitSession,
  preliminaryAuthorityFailure,
  readSealedPointCommitJournal,
  requireAttemptIsLiveResult,
  requireLockedClockAuthorityResult,
  resolvePointCommitAuthority,
  validateActiveRelationSelectionForPointCommit,
} from "./attemptAcceptance";
import { recordFiniteReplacementTerminalRefusal } from "./capabilities";
import { capturePointMutationAttemptReplacementCommandResult } from "./capture";
import {
  type PointCommitTransactionProofOptionsV1,
  type PointMutationAttemptReplacementFiniteEntryComposition,
  type PointMutationAttemptReplacementOptionsV1,
} from "./constructionContracts";
import {
  type PointFiniteAttemptReplacementPort,
  type PointMutationAttemptReplacementObservationV1,
  type PointMutationAttemptReplacementPortV1,
} from "./contracts";
import {
  corruption,
  type PointCommitConflictCauseV1,
  PointFiniteAttemptRetryBudgetExhaustedError,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementConfigurationV1Error,
  PointMutationAttemptReplacementFiniteEntryError,
  PointMutationAttemptReplacementResourceExhaustionV1Error,
  type PointMutationAttemptReplacementV1Error,
} from "./errors";
import {
  finiteCommitPromiseEffect,
  runFiniteCommitTransactionEffect,
} from "./finitePublication";
import {
  type LockedPointCommitClockV1,
  type LockedPointCommitLeaseV1,
  type LockedPointCommitSessionV1,
} from "./lockedState";
import { requireReproduciblePointCommitConflict } from "./occ";
import {
  authenticatedPublicationPointsResult,
  prepareFiniteAttemptResolutionCommand,
  requireFrozenFiniteAttemptOrigin,
} from "./preparation";
import {
  pointCommitCommandScopeUuid,
  type PreparedPointCommitAuthorityCommandV1,
  type PreparedPointMutationAttemptReplacementCommandV1,
} from "./preparedCommands";
import {
  projectPointCommitTransactionResult,
  runPointCommitPromiseEffect,
} from "./promiseBoundary";
import {
  decisionUncertain,
  emitReplacementStep,
  mapFiniteAnchorFailure,
  mapPointMutationAttemptReplacementSharedError,
  mapPointMutationAttemptReplacementTransactionFailure,
  observeReplacementQuery,
  PointCommitTransactionDecisionUncertainV1Error,
  replacementCorruption,
  replacementSqlCall,
  stale,
} from "./sqlFailures";
import { readPointCommitDatabaseTime } from "../publication/pointCommitProjection";
import { runEffectTransactionSettlement } from "../../database/effectTransaction";
import {
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournals,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionSessions,
} from "../../database/schema";
import {
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimOwnerV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import {
  deriveTransactionExecutionClaimV1,
  lockExactTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
} from "../../execution/claims/transactionExecutionClaimPersistence";
import {
  lockFiniteAttemptAnchorRowByIdentityInTransaction,
  MAX_FINITE_ATTEMPT_COUNT,
  readFiniteAttemptAnchorRow,
  readFiniteAttemptNonacceptanceProof,
  rejectFiniteAttemptNonacceptanceInTransaction,
  replaceFiniteAttemptAnchorInTransaction,
} from "../../execution/finiteAttemptAnchor";
import {
  confirmPreparedFiniteSessionJournalEntry,
  type PreparedFiniteSessionJournalEntry,
} from "../../execution/journal/finiteEntry";
import {
  runPreparedFiniteReplacementSessionJournalEntryEffect,
  type runPreparedFiniteSessionJournalEntryEffect,
} from "../../execution/journal/finiteEntryActivation";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import type {
  PointMutationSessionAuthorityResolutionPortsV1,
} from "../../execution/session/constructionContracts";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from "../../execution/transactionSessionAttemptFacet";
import {
  isLocatedExactRunningAttemptKernelV1,
  isLocatedPointCommitPublicationTargetV1,
} from "../../execution/session/kernelContracts";
import {
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import { type TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { type AppRowTransaction } from "../../storage/documents/appRows";
import { loadPointCommitHeads } from "../../storage/materialization/materialization";

export interface PreparedFiniteReplacementEntry {
  readonly preparation: PreparedFiniteSessionJournalEntry;
  readonly application: PreparedFiniteActiveApplication;
  capture?: Effect.Success<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;
}

export const prepareFiniteReplacementEntryEffect = Effect.fn("PointMutationAttemptReplacement.prepareFiniteEntry")(
  function*(composition: PointMutationAttemptReplacementFiniteEntryComposition) {
    const preparation = yield* composition.prepareEntry();
    const application = composition.application;
    return { preparation, application } satisfies PreparedFiniteReplacementEntry;
  },
);

export function confirmFiniteReplacementEntry(observation: PointMutationAttemptReplacementObservationV1,
  entry: PreparedFiniteReplacementEntry | undefined): PointMutationAttemptReplacementObservationV1 {
  if(observation.kind !== "replaced" || entry?.capture === undefined) return observation;
  return Object.freeze({
    ...observation, finiteEntry: Object.freeze({
      preparation: entry.preparation,
      capture: confirmPreparedFiniteSessionJournalEntry(entry.preparation, entry.capture)
    })
  });
}

export function runReplacementTransactionEffect<Value>(target: LocatedReadCommittedAttemptTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, PointMutationAttemptReplacementV1Error>) {
  return runEffectTransactionSettlement(callback => target[RUN_LOCATED_READ_COMMITTED_V1](callback).catch(cause => {
    // Only this runner's callback rollback contains the Effect bridge's private sentinel.
    if(cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack")
      throw cause.issue.callbackCause;
    throw cause;
  }), "Point mutation replacement callback rolled back", work, mapPointMutationAttemptReplacementTransactionFailure);
}

export function requireDurableReplacementProfile(profile: "durableOperations" | "finiteRoot",
  lease: typeof fxSystemSnapshotLeases.$inferSelect): Result.Result<void, ReturnType<typeof replacementCorruption>> {
  // Legacy replacement tickets only authorize the actual durable profile.
  // Finite replay is owned by stable-anchor nonacceptance and replaceFinite.
  if(profile !== "durableOperations" || lease.metadataWatermark !== null ||
    lease.finiteMetadataReservationBytes !== null || lease.finiteMetadataReservationSha256 !== null)
    return Result.fail(replacementCorruption("journalRootInvalid"));
  return Result.succeed(undefined);
}

export function runPointMutationAttemptReplacement(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointMutationAttemptReplacementCommandV1,
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
        "replaceAttempt",
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "sessionLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      if(session.attemptFence !== command.authorityPins.attemptFence) {
        return yield* runPointCommitPromiseEffect(() => observeReplacedPointMutationAttempt(
          tx,
          clock,
          command,
          session,
          options,
          command.expectedConflict.conflict.kind === "metadata" ? command.expectedConflict.conflict : undefined,
        ), mapPointMutationAttemptReplacementTransactionFailure);
      }
      yield* runPointCommitPromiseEffect(() => validateActiveRelationSelectionForPointCommit(tx, command), mapPointMutationAttemptReplacementTransactionFailure);
      if(command.relationDependencies.length > 0) {
        yield* runPointCommitPromiseEffect(() => emitReplacementStep(
          options,
          command,
          "activeRelationSelectionValidated",
        ), mapPointMutationAttemptReplacementTransactionFailure);
      }

      const lease = yield* runPointCommitPromiseEffect(() => lockPointCommitLease(tx, command, sharedOptions), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "leaseLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      const executionProfile = yield* runPointCommitPromiseEffect(() => lockPointCommitJournalRoot(tx, command, sharedOptions), mapPointMutationAttemptReplacementTransactionFailure);
      const sealedJournal = yield* runPointCommitPromiseEffect(() => readSealedPointCommitJournal(tx, command, sharedOptions), mapPointMutationAttemptReplacementTransactionFailure);
      yield* Effect.fromResult(authenticatedPublicationPointsResult(
        sealedJournal, command.dependencies, command.sealIdentity.pointDependencyCount).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));
      yield* Effect.fromResult(requireDurableReplacementProfile(executionProfile, lease.row));
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "journalRootLocked"), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => requireNoFinishingExecutionClaim(
        tx,
        clock,
        command,
        options,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      const databaseNowMilliseconds = yield* runPointCommitPromiseEffect(() => readPointCommitDatabaseTime(
        tx,
        command.authorityPins.scopeId,
        sharedOptions,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* Effect.fromResult(requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds).pipe(Result.mapError(mapPointMutationAttemptReplacementTransactionFailure)));

      const heads = yield* loadPointCommitHeads(
        tx,
        clock,
        command,
        sharedOptions,
      ).pipe(Effect.mapError(mapPointMutationAttemptReplacementTransactionFailure));
      yield* runPointCommitPromiseEffect(() => requireReproduciblePointCommitConflict(
        tx,
        clock,
        command,
        heads,
        sharedOptions,
        preliminaryAuthority,
        sealedJournal,
        null,
      ), mapPointMutationAttemptReplacementTransactionFailure);
      yield* runPointCommitPromiseEffect(() => emitReplacementStep(options, command, "dependenciesValidated"), mapPointMutationAttemptReplacementTransactionFailure);

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
        executionProfile,
      ), mapPointMutationAttemptReplacementTransactionFailure);
    }).pipe(
      Effect.tap(observation => observation.kind === "replaced" ? runPointCommitPromiseEffect(
        () => emitReplacementStep(options, command, "beforeCommit"), mapPointMutationAttemptReplacementTransactionFailure) : Effect.void),
    );
  });
}

export async function replaceLockedPointMutationAttempt(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  session: LockedPointCommitSessionV1,
  lease: LockedPointCommitLeaseV1,
  options: PointMutationAttemptReplacementOptionsV1,
  sharedOptions: PointCommitTransactionProofOptionsV1,
  executionClaimOwner: TransactionExecutionClaimOwnerV1,
  executionClaimDurationMilliseconds: number,
  executionProfile: "durableOperations" | "finiteRoot",
  knownMutationTimeMilliseconds?: number,
): Promise<PointMutationAttemptReplacementObservationV1> {
  const sourceLifecycle = "scopeUuid" in command ? "running" : "finishing";
  const mutationTimeMilliseconds = knownMutationTimeMilliseconds ??
    await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      sharedOptions,
    );
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(session, lease, mutationTimeMilliseconds),
  );
  if(
    command.authorityPins.attemptFence >= MAX_TRANSACTION_ATTEMPT_FENCE
  ) {
    throw new PointMutationAttemptReplacementResourceExhaustionV1Error({
      dimension: "attemptFence",
      maximum: MAX_TRANSACTION_ATTEMPT_FENCE,
    });
  }
  const replacementFence = TransactionAttemptFenceSchema.make(
    command.authorityPins.attemptFence + 1n,
  );
  const freshFacet = projectPointCommitTransactionResult(
    buildFreshTransactionAttemptFacetV1({
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: replacementFence,
      executionProfile,
      snapshotEpochUuid: clock.epochUuid,
      snapshotCommitSeq: clock.record.lastCommitSeq,
      databaseNowMilliseconds: mutationTimeMilliseconds,
      authorizationGrantExpiresAtMilliseconds:
        session.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: session.hardExpiresAtMilliseconds,
      leaseDurationMilliseconds: options.leaseDurationMilliseconds,
    }).pipe(Result.mapError((reason) =>
      reason === "authorityExpired"
        ? stale("expired")
        : replacementCorruption("freshLeaseInvalid")
    )),
  );
  const freshExecutionClaim = projectPointCommitTransactionResult(
    deriveTransactionExecutionClaimV1({
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: replacementFence,
      claimFence: 1n,
      claimOwner: executionClaimOwner,
      databaseNow: new Date(mutationTimeMilliseconds),
      durationMilliseconds: executionClaimDurationMilliseconds,
      leaseExpiresAt: freshFacet.leaseExpiresAt,
      authorizationGrantExpiresAt: new Date(
        session.authorizationGrantExpiresAtMilliseconds,
      ),
      hardExpiresAt: new Date(session.hardExpiresAtMilliseconds),
    }).pipe(Result.mapError((reason) =>
      reason === "authorityExpired"
        ? stale("expired")
        : replacementCorruption("freshLeaseInvalid")
    )),
  );

  const retrying = tx.update(fxSystemTransactionSessions).set({
    lifecycle: "retrying",
    updatedAt: freshFacet.sessionUpdatedAt,
  }).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionSessions.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionSessions.attemptFence,
      command.authorityPins.attemptFence,
    ),
    eq(fxSystemTransactionSessions.lifecycle, sourceLifecycle),
  )).returning({ lifecycle: fxSystemTransactionSessions.lifecycle });
  observeReplacementQuery("enterRetrying", retrying, options);
  const retryingRows = await replacementSqlCall(
    "enterRetrying",
    () => retrying,
  );
  if(retryingRows.length !== 1 || retryingRows[0]?.lifecycle !== "retrying") {
    throw replacementCorruption("replacementMutationInvalid");
  }
  await emitReplacementStep(options, command, "sessionEnteredRetrying");

  const journalDelete = tx.delete(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionJournals.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionJournals.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).returning({
    attemptFence: fxSystemTransactionJournals.attemptFence,
    executionProfile: fxSystemTransactionJournals.executionProfile
  });
  observeReplacementQuery("deleteRetryJournal", journalDelete, options);
  const deletedJournal = await replacementSqlCall(
    "deleteRetryJournal",
    () => journalDelete,
  );
  const deletedRoot = deletedJournal[0];
  if(
    deletedJournal.length !== 1 ||
    deletedRoot === undefined ||
    deletedRoot.attemptFence !== command.authorityPins.attemptFence
  ) {
    throw replacementCorruption("replacementMutationInvalid");
  }
  await emitReplacementStep(options, command, "journalDeleted");

  const leaseDelete = tx.delete(fxSystemSnapshotLeases).where(and(
    eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemSnapshotLeases.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemSnapshotLeases.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
  observeReplacementQuery("deleteRetryLease", leaseDelete, options);
  const deletedLease = await replacementSqlCall(
    "deleteRetryLease",
    () => leaseDelete,
  );
  if(
    deletedLease.length !== 1 ||
    deletedLease[0]?.attemptFence !== command.authorityPins.attemptFence
  ) {
    throw replacementCorruption("replacementMutationInvalid");
  }
  await emitReplacementStep(options, command, "leaseDeleted");

  const fenceUpdate = tx.update(fxSystemTransactionSessions).set({
    attemptFence: replacementFence,
  }).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionSessions.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionSessions.attemptFence,
      command.authorityPins.attemptFence,
    ),
    eq(fxSystemTransactionSessions.lifecycle, "retrying"),
    eq(
      fxSystemTransactionSessions.updatedAt,
      freshFacet.sessionUpdatedAt,
    ),
  )).returning({ attemptFence: fxSystemTransactionSessions.attemptFence });
  observeReplacementQuery("advanceAttemptFence", fenceUpdate, options);
  const advanced = await replacementSqlCall(
    "advanceAttemptFence",
    () => fenceUpdate,
  );
  if(advanced.length !== 1 || advanced[0]?.attemptFence !== replacementFence) {
    throw replacementCorruption("attemptFenceUpdateInvalid");
  }
  await emitReplacementStep(options, command, "attemptFenceAdvanced");

  const leaseInsert = tx.insert(fxSystemSnapshotLeases)
    .values(freshFacet.lease)
    .returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
  observeReplacementQuery("insertRetryLease", leaseInsert, options);
  const insertedLease = await replacementSqlCall(
    "insertRetryLease",
    () => leaseInsert,
  );
  if(
    insertedLease.length !== 1 ||
    insertedLease[0]?.attemptFence !== replacementFence
  ) {
    throw replacementCorruption("freshLeaseInvalid");
  }
  await emitReplacementStep(options, command, "leaseInserted");

  if(deletedRoot.executionProfile !== executionProfile) {
    throw replacementCorruption("replacementMutationInvalid");
  }
  const rootInsert = tx.insert(fxSystemTransactionJournals)
    .values({ ...freshFacet.journalRoot, journalFormat: SESSION_JOURNAL_FORMAT })
    .returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
  observeReplacementQuery("insertRetryJournalRoot", rootInsert, options);
  const insertedRoot = await replacementSqlCall(
    "insertRetryJournalRoot",
    () => rootInsert,
  );
  if(
    insertedRoot.length !== 1 ||
    insertedRoot[0]?.attemptFence !== replacementFence
  ) {
    throw replacementCorruption("freshJournalRootInvalid");
  }
  await emitReplacementStep(options, command, "journalRootInserted");

  const claimInsert = tx.insert(fxSystemTransactionExecutionClaims)
    .values(freshExecutionClaim)
    .returning({
      attemptFence: fxSystemTransactionExecutionClaims.attemptFence,
    });
  observeReplacementQuery("insertRetryExecutionClaim", claimInsert, options);
  const insertedClaim = await replacementSqlCall(
    "insertRetryExecutionClaim",
    () => claimInsert,
  );
  if(
    insertedClaim.length !== 1 ||
    insertedClaim[0]?.attemptFence !== replacementFence
  ) {
    throw replacementCorruption("replacementMutationInvalid");
  }
  await emitReplacementStep(options, command, "executionClaimInserted");

  const runningUpdate = tx.update(fxSystemTransactionSessions).set({
    lifecycle: "running",
  }).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionSessions.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(fxSystemTransactionSessions.attemptFence, replacementFence),
    eq(fxSystemTransactionSessions.lifecycle, "retrying"),
    eq(
      fxSystemTransactionSessions.updatedAt,
      freshFacet.sessionUpdatedAt,
    ),
  )).returning({ lifecycle: fxSystemTransactionSessions.lifecycle });
  observeReplacementQuery("enterRetryRunning", runningUpdate, options);
  const running = await replacementSqlCall(
    "enterRetryRunning",
    () => runningUpdate,
  );
  if(running.length !== 1 || running[0]?.lifecycle !== "running") {
    throw replacementCorruption("replacementMutationInvalid");
  }
  await emitReplacementStep(options, command, "sessionRunning");
  return replacementObservation(
    "replaced",
    command,
    replacementFence,
    Object.freeze({
      claimOwner: freshExecutionClaim.claimOwner,
      claimFence: freshExecutionClaim.claimFence,
      claimedAt: freshExecutionClaim.claimedAt.toISOString(),
      claimExpiresAt:
        freshExecutionClaim.claimExpiresAt.toISOString(),
    }),
  );

}

export async function requireNoFinishingExecutionClaim(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointMutationAttemptReplacementCommandV1,
  options: PointMutationAttemptReplacementOptionsV1,
): Promise<void> {
  const query = tx.select({
    claimFence: fxSystemTransactionExecutionClaims.claimFence,
  }).from(fxSystemTransactionExecutionClaims).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionExecutionClaims.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      command.authorityPins.attemptFence,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("validateFinishingClaimAbsence", query, options);
  const rows = await replacementSqlCall(
    "validateFinishingClaimAbsence",
    () => query,
  );
  if(rows.length !== 0) {
    throw replacementCorruption("finishingExecutionClaimPresent");
  }
}

export async function observeReplacedPointMutationAttempt(
  tx: AppRowTransaction,
  clock: LockedPointCommitClockV1,
  command: PreparedPointCommitAuthorityCommandV1,
  session: LockedPointCommitSessionV1,
  options: PointMutationAttemptReplacementOptionsV1,
  metadataConflict?: Extract<PointCommitConflictCauseV1, { readonly kind: "metadata" }>,
): Promise<PointMutationAttemptReplacementObservationV1> {
  const expectedFence = command.authorityPins.attemptFence <
    MAX_TRANSACTION_ATTEMPT_FENCE
    ? TransactionAttemptFenceSchema.make(
      command.authorityPins.attemptFence + 1n,
    )
    : null;
  if(
    expectedFence === null ||
    session.attemptFence !== expectedFence ||
    session.lifecycle !== "running"
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const leaseQuery = tx.select().from(fxSystemSnapshotLeases).where(and(
    eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemSnapshotLeases.sessionId,
      command.authorityPins.sessionId,
    ),
  )).limit(2).for("update");
  observeReplacementQuery("validatePristineAttempt", leaseQuery, options);
  const leaseRows = await replacementSqlCall(
    "validatePristineAttempt",
    () => leaseQuery,
  );
  const lease = leaseRows[0];
  const leaseExpiresAtMilliseconds = lease === undefined
    ? undefined
    : finiteDateMilliseconds(lease.leaseExpiresAt);
  if(
    leaseRows.length !== 1 ||
    lease === undefined ||
    lease.scopeUuid !== clock.scopeUuid ||
    lease.sessionId !== command.authorityPins.sessionId ||
    lease.attemptFence !== expectedFence ||
    lease.snapshotEpochUuid !== clock.epochUuid ||
    lease.snapshotCommitSeq < command.authorityPins.snapshotToken.commitSeq ||
    lease.snapshotCommitSeq === command.authorityPins.snapshotToken.commitSeq && metadataConflict === undefined ||
    metadataConflict !== undefined && (clock.record.lastMetadataSequence <= metadataConflict.capturedMetadataWatermark ||
      clock.record.lastMetadataSequence < metadataConflict.lastChangedMetadataSequence) ||
    lease.snapshotCommitSeq > clock.record.lastCommitSeq ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= session.updatedAtMilliseconds ||
    leaseExpiresAtMilliseconds >
    session.authorizationGrantExpiresAtMilliseconds ||
    leaseExpiresAtMilliseconds > session.hardExpiresAtMilliseconds
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  await emitReplacementStep(options, command, "leaseLocked");

  const rootQuery = tx.select().from(fxSystemTransactionJournals).where(and(
    eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
    eq(
      fxSystemTransactionJournals.sessionId,
      command.authorityPins.sessionId,
    ),
    eq(fxSystemTransactionJournals.attemptFence, expectedFence),
  )).limit(2).for("update");
  observeReplacementQuery("validatePristineAttempt", rootQuery, options);
  const rootRows = await replacementSqlCall(
    "validatePristineAttempt",
    () => rootQuery,
  );
  const root = rootRows[0];
  if(rootRows.length !== 1 || root === undefined) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  const expectedFacet = projectPointCommitTransactionResult(
    buildFreshTransactionAttemptFacetV1({
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: expectedFence,
      executionProfile: root.executionProfile,
      snapshotEpochUuid: lease.snapshotEpochUuid,
      snapshotCommitSeq: lease.snapshotCommitSeq,
      databaseNowMilliseconds: session.updatedAtMilliseconds,
      authorizationGrantExpiresAtMilliseconds:
        session.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: session.hardExpiresAtMilliseconds,
      leaseDurationMilliseconds:
        leaseExpiresAtMilliseconds - session.updatedAtMilliseconds,
    }).pipe(Result.mapError(() =>
      replacementCorruption("replacementConvergenceInvalid")
    )),
  );
  if(
    leaseExpiresAtMilliseconds !==
    finiteDateMilliseconds(expectedFacet.leaseExpiresAt)
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  if(
    !isPristineFreshTransactionAttemptJournalRootV1(root, expectedFacet.journalRoot)
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  await emitReplacementStep(options, command, "journalRootLocked");

  const executionClaim = projectPointCommitTransactionResult(
    await lockExactTransactionExecutionClaimV1Result(tx, {
      scopeId: command.authorityPins.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: command.authorityPins.sessionId,
      attemptFence: expectedFence,
    }),
  );

  const childrenQuery = tx.select({
    receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalReceipts}
      where ${fxSystemTransactionJournalReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalReceipts.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalReceipts.attemptFence} =
          ${expectedFence}
    )`,
    pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} =
          ${expectedFence}
    )`,
    indexRangeExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalIndexRanges}
      where ${fxSystemTransactionJournalIndexRanges.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalIndexRanges.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalIndexRanges.attemptFence} =
          ${expectedFence}
    )`,
    relationExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies}
      where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} =
          ${clock.scopeUuid}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} =
          ${expectedFence}
    )`,
    eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} =
          ${command.authorityPins.sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${expectedFence}
    )`,
  }).from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeId,
    command.authorityPins.scopeId,
  )).limit(1);
  observeReplacementQuery("validatePristineAttempt", childrenQuery, options);
  const children = await replacementSqlCall(
    "validatePristineAttempt",
    () => childrenQuery,
  );
  if(
    children.length !== 1 ||
    children[0]?.receiptExists !== false ||
    children[0]?.pointExists !== false ||
    children[0]?.indexRangeExists !== false ||
    children[0]?.relationExists !== false ||
    children[0]?.eventExists !== false
  ) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }

  const databaseNowMilliseconds = await readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    Object.freeze(
      options.observeQuery === undefined
        ? {}
        : { observeQuery: options.observeQuery },
    ),
  );
  if(session.updatedAtMilliseconds > databaseNowMilliseconds) {
    throw replacementCorruption("replacementConvergenceInvalid");
  }
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(
      session,
      Object.freeze({
        expiresAtMilliseconds:
          finiteDateMilliseconds(expectedFacet.leaseExpiresAt) ?? 0,
      }),
      databaseNowMilliseconds,
    ),
  );
  projectPointCommitTransactionResult(
    requireLiveTransactionExecutionClaimV1Result(
      command.authorityPins.scopeId,
      executionClaim,
      undefined,
      new Date(databaseNowMilliseconds),
    ),
  );
  return replacementObservation("alreadyReplaced", command, expectedFence);
}

export function replacementObservation(
  kind: PointMutationAttemptReplacementObservationV1["kind"],
  command: PreparedPointCommitAuthorityCommandV1,
  attemptFence: TransactionAttemptFence,
  executionClaim?: TransactionExecutionClaimObservationV1,
): PointMutationAttemptReplacementObservationV1 {
  const common = {
    scopeUuid: pointCommitCommandScopeUuid(command),
    sessionId: command.authorityPins.sessionId,
    previousAttemptFence: command.authorityPins.attemptFence,
    attemptFence,
  } as const;
  if(kind === "replaced") {
    if(executionClaim === undefined) {
      throw replacementCorruption("replacementMutationInvalid");
    }
    return Object.freeze({
      kind: "replaced",
      ...common,
      executionClaim: Object.freeze({ ...executionClaim }),
    });
  }
  return Object.freeze({ kind: "alreadyReplaced", ...common });
}

export function bindPointMutationAttemptReplacement(ports: PointMutationSessionAuthorityResolutionPortsV1, options: PointMutationAttemptReplacementOptionsV1, proofOptions: PointCommitTransactionProofOptionsV1, randomExecutionClaimOwner: () => string, executionClaimDurationMilliseconds: number): PointMutationAttemptReplacementPortV1 & PointFiniteAttemptReplacementPort {
  const replace: PointMutationAttemptReplacementPortV1["replace"] = Effect.fn(
    "PointMutationAttemptReplacement.replace",
  )(function*(input) {
    const command = yield* Effect.fromResult(
      capturePointMutationAttemptReplacementCommandResult(input),
    ).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    const generatedOwner = yield* Effect.try({
      try: randomExecutionClaimOwner,
      catch: () => new PointMutationAttemptReplacementConfigurationV1Error(
        "executionClaimOwnerGenerationFailed",
      ),
    });
    const decodedOwner = yield* Effect.fromResult(
      decodeTransactionExecutionClaimOwnerV1(generatedOwner),
    ).pipe(
      Effect.mapError(() =>
        new PointMutationAttemptReplacementConfigurationV1Error(
          "executionClaimOwnerInvalid",
        )
      ),
    );
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
    return yield* Effect.uninterruptible(runPointMutationAttemptReplacement(
      target,
      located.authority,
      command,
      options,
      proofOptions,
      decodedOwner,
      executionClaimDurationMilliseconds,
    ));
  });

  const replaceFiniteOwned = Effect.fn("PointMutationAttemptReplacement.replaceFinite")(function*(
    request: Readonly<{ kind: "frozen"; input: Parameters<PointFiniteAttemptReplacementPort["replaceFinite"]>[0] }>
      | Readonly<{ kind: "recovered"; input: Parameters<PointFiniteAttemptReplacementPort["replaceRecoveredFinite"]>[0] }>) {
    const input = request.input;
    const command = yield* prepareFiniteAttemptResolutionCommand(input).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    if(request.kind === "recovered" && "frozenAttempt" in input) return yield* Effect.fail(replacementCorruption("replacementMutationInvalid"));
    const origin = request.kind === "frozen"
      ? Object.freeze({
        kind: "frozen" as const, originalEntry: (yield* requireFrozenFiniteAttemptOrigin(request.input, command)
          .pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError))).originalEntry
      })
      : Object.freeze({ kind: "recovered" as const });
    const proof = yield* Effect.fromResult(readFiniteAttemptNonacceptanceProof(input.proof)).pipe(Effect.mapError(cause =>
      new PointMutationAttemptReplacementFiniteEntryError({ cause })));
    if(proof.selector.scopeId !== command.authorityPins.scopeId || proof.selector.deploymentId !== command.authorityPins.deploymentId ||
      proof.selector.sessionId !== command.authorityPins.sessionId || proof.selector.attemptFence !== command.authorityPins.attemptFence ||
      proof.executionClaim.claimOwner !== command.executionClaim.claimOwner || proof.executionClaim.claimFence !== command.executionClaim.claimFence)
      return yield* Effect.fail(replacementCorruption("replacementMutationInvalid"));
    if(options.finiteEntry === undefined) return yield* Effect.fail(new PointMutationAttemptReplacementFiniteEntryError({ cause: "finiteEntryCompositionMissing" }));
    const generatedOwner = yield* Effect.try({
      try: randomExecutionClaimOwner,
      catch: () => new PointMutationAttemptReplacementConfigurationV1Error("executionClaimOwnerGenerationFailed")
    });
    const owner = yield* Effect.fromResult(decodeTransactionExecutionClaimOwnerV1(generatedOwner)).pipe(Effect.mapError(() =>
      new PointMutationAttemptReplacementConfigurationV1Error("executionClaimOwnerInvalid")));
    const located = yield* resolvePointCommitAuthority(command.authorityPins, ports).pipe(Effect.mapError(mapPointMutationAttemptReplacementSharedError));
    if(!isLocatedPointCommitPublicationTargetV1(located.target) || !isLocatedExactRunningAttemptKernelV1(located.target))
      return yield* Effect.fail(replacementCorruption("readCommittedCapabilityMissing"));
    const target = located.target;
    const composition = yield* options.finiteEntry();
    let admissionRefusal: ApplicationMutationAdmissionError | undefined;
    return yield* Effect.scoped(Effect.gen(function*() {
      const entry: PreparedFiniteReplacementEntry = yield* prepareFiniteReplacementEntryEffect(composition);
      const transaction = runFiniteCommitTransactionEffect(target, tx => Effect.gen(function*() {
        const clock = yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, proofOptions));
        yield* finiteCommitPromiseEffect(() => emitReplacementStep(options, command, "clockLocked"));
        const anchorRow = yield* lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, proof.selector).pipe(Effect.mapError(mapFiniteAnchorFailure));
        const outcome = yield* finiteCommitPromiseEffect(() => inspectCommittedOutcomeInTransaction(tx, clock, command, proofOptions));
        if(outcome !== null) return yield* Effect.fail(new PointMutationAttemptReplacementCommittedOutcomeV1Error({
          reason: outcome.state === "available"
            ? "committedOutcomeAvailable" : "committedOutcomeExpired", commitSeq: outcome.commitSeq
        }));
        const current = yield* readFiniteAttemptAnchorRow(anchorRow).pipe(Effect.mapError(mapFiniteAnchorFailure));
        if(current.reservation === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
        yield* Effect.fromResult(requireLockedClockAuthorityResult(clock, located.authority, command));
        if(current.session.lifecycle !== "retrying" || current.session.attemptFence !== proof.selector.attemptFence ||
          current.executionClaim.claimOwner !== proof.fencedClaim.claimOwner || current.executionClaim.claimFence !== proof.fencedClaim.claimFence)
          return yield* Effect.fail(replacementCorruption("replacementMutationInvalid"));
        const databaseNow = new Date(yield* finiteCommitPromiseEffect(() => readPointCommitDatabaseTime(tx, command.authorityPins.scopeId, proofOptions)));
        if(current.session.attemptFence >= MAX_FINITE_ATTEMPT_COUNT) {
          yield* rejectFiniteAttemptNonacceptanceInTransaction(tx, current, "aborted").pipe(Effect.mapError(mapFiniteAnchorFailure));
          return Object.freeze({
            kind: "refused" as const, error: new PointFiniteAttemptRetryBudgetExhaustedError({
              attemptFence: current.session.attemptFence, maximumAttempts: MAX_FINITE_ATTEMPT_COUNT,
            })
          });
        }
        const leaseExpiresAt = new Date(Math.min(databaseNow.getTime() + options.leaseDurationMilliseconds,
          current.session.authorizationGrantExpiresAt.getTime(), current.session.hardExpiresAt.getTime()));
        const claimExpiresAt = new Date(Math.min(databaseNow.getTime() + executionClaimDurationMilliseconds, leaseExpiresAt.getTime()));
        const fresh = yield* replaceFiniteAttemptAnchorInTransaction(tx, input.proof,
          {
            snapshotToken: SnapshotTokenSchema.make({ scopeId: command.authorityPins.scopeId, epoch: clock.record.epoch, commitSeq: clock.record.lastCommitSeq }),
            claimOwner: owner, claimedAt: databaseNow, claimExpiresAt, leaseExpiresAt
          }).pipe(Effect.mapError(mapFiniteAnchorFailure));
        entry.capture = yield* runPreparedFiniteReplacementSessionJournalEntryEffect(entry.preparation, entry.application, tx,
          {
            selector: { ...proof.selector, attemptFence: fresh.context.session.attemptFence }, preliminaryAuthority: located.authority,
            executionClaim: fresh.context.executionClaim
          }, { authority: located.authority, target },
          origin, failure => { admissionRefusal = failure; }).pipe(Effect.mapError(cause =>
            new PointMutationAttemptReplacementFiniteEntryError({ cause })));
        const observation = Object.freeze({
          kind: "replaced" as const, scopeUuid: current.session.scopeUuid, sessionId: proof.selector.sessionId,
          previousAttemptFence: proof.selector.attemptFence, attemptFence: fresh.context.session.attemptFence, executionClaim: entry.capture.context.executionClaim
        });
        yield* finiteCommitPromiseEffect(() => emitReplacementStep(options, command, "beforeCommit"));
        return observation;
      }));
      const result = yield* transaction.pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
          error => error instanceof PointCommitTransactionDecisionUncertainV1Error
            ? decisionUncertain(error.cause, { kind: "missing" }) : mapPointMutationAttemptReplacementTransactionFailure(error)))));
      if(result.kind === "refused") return yield* Effect.fail(result.error);
      return confirmFiniteReplacementEntry(result, entry);
    })).pipe(
      // The transaction and its local entry cleanup have both settled. Only the
      // exact guard-emitted single failure confers terminal authority; combined
      // rollback/resource failures, defects and interruption retain full Cause.
      Effect.onExit(exit => Effect.sync(() => {
        const reason = Exit.isFailure(exit) && exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined;
        if(reason !== undefined && Cause.isFailReason(reason) &&
          reason.error instanceof PointMutationAttemptReplacementFiniteEntryError &&
          admissionRefusal !== undefined && reason.error.cause === admissionRefusal && !admissionRefusal.retryable &&
          (admissionRefusal.reason === "invalidExecutionAuthority" || admissionRefusal.reason === "functionMissing" ||
            admissionRefusal.reason === "functionUnsupported"))
          recordFiniteReplacementTerminalRefusal(reason.error, input, input.proof);
      })),
    );
  });
  return { replace, replaceFinite: (input: Parameters<PointFiniteAttemptReplacementPort["replaceFinite"]>[0]) => replaceFiniteOwned({ kind: "frozen", input }), replaceRecoveredFinite: (input: Parameters<PointFiniteAttemptReplacementPort["replaceRecoveredFinite"]>[0]) => replaceFiniteOwned({ kind: "recovered", input }) };
}
