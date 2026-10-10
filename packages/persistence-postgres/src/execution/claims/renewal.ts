import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
  runPointCommitPromiseEffect,
} from "../../commit/point/promiseBoundary";
import type {
  RunLocatedReadCommittedTransactionV1,
} from "../../database/locatedTransactionIdentity";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionSessions,
} from "../../database/schema";
import type { PreparedInstalledAttemptScopeAuthority } from "../../scope/scopeAuthorityControlRead";
import type { TrustedScopeAuthorityResolutionError } from "../../scope/scopeAuthorityResolution";
import { ScopeClockNotFoundError } from "../../scope/scopeClockErrors";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { lockFiniteAttemptAnchorInTransaction } from "../finiteAttemptAnchor";
import { LocatedReadCommittedTransactionFailureV1 } from "../readCommittedTransactionFailure";
import {
  decodeLockedPointMutationSessionClock,
  lockExactPointMutationSession,
  lockPointMutationSessionAttemptStructure,
  lockPointMutationSessionClock,
  readDatabaseNow,
  requireExactPointMutationSessionJournalRoot,
  requireStablePointMutationSessionAttemptAuthority,
  type LockedPointMutationSessionClockV1,
  type PointMutationSessionAttemptAuthorityFailureFactoryV1,
  type PointMutationSessionExactSessionFailureFactoryV1,
  type PointMutationSessionStableAuthorityFailureFactoryV1,
} from "../session/attemptAuthority";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationExecutionClaimLivenessEventV1,
} from "../session/constructionContracts";
import {
  PointMutationSessionAuthorityCorruptionV1Error,
  projectTransactionSessionActivationResult,
} from "../session/errors";
import {
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
  executionClaimLivenessCorruption,
  mapExecutionClaimRenewalIssue,
} from "./transactionExecutionClaimErrors";
import {
  PointMutationExecutionClaimLivenessCorruptionV1Error,
  PointMutationExecutionClaimLivenessPersistenceV1Error,
  PointMutationExecutionClaimLivenessStaleV1Error,
  PointMutationExecutionClaimLivenessUncertainV1Error,
  type PointMutationExecutionClaimLivenessConfigurationV1Error,
  type PointMutationExecutionClaimLivenessInputV1Error,
} from "./transactionExecutionClaimErrors";
import { projectExecutionClaimRenewalV1Result } from "./renewalProjection";
import type {
  LocatedPointMutationExecutionClaimLivenessInputV1,
  PointMutationExecutionClaimLivenessResultV1,
  PointMutationExecutionClaimLivenessV1Error,
} from "./transactionExecutionClaimLiveness";
import {
  requireLiveTransactionExecutionClaimV1Result,
} from "./transactionExecutionClaimPersistence";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";

export const renewLocatedPointMutationExecutionClaimEffect = Effect.fn(function* (
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  input: LocatedPointMutationExecutionClaimLivenessInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
      "afterExecutionClaimLivenessEvent"
    ]
    | undefined,
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
): Effect.fn.Return<
  PointMutationExecutionClaimLivenessResultV1,
  Exclude<
    PointMutationExecutionClaimLivenessV1Error,
    | PointMutationExecutionClaimLivenessInputV1Error
    | PointMutationExecutionClaimLivenessConfigurationV1Error
    | TrustedScopeAuthorityResolutionError
  >
> {
  return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() =>
      runReadCommitted((tx) =>
        renewExecutionClaimLivenessInTransaction(tx, input, afterEvent, installedAuthority)), mapExecutionClaimLivenessTransactionError));
});

async function renewExecutionClaimLivenessInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationExecutionClaimLivenessInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
      "afterExecutionClaimLivenessEvent"
    ]
    | undefined,
  installedAuthority?: PreparedInstalledAttemptScopeAuthority,
): Promise<PointMutationExecutionClaimLivenessResultV1> {
  const emit = async (
    event: PointMutationExecutionClaimLivenessEventV1,
  ): Promise<void> => {
    await afterEvent?.(event);
  };
  if (input.installedFinite === true && installedAuthority === undefined)
    throw executionClaimLivenessCorruption("clockInvalid");
  const clock = input.installedFinite !== true ? await lockPointMutationSessionClock(tx, input.selector.scopeId) :
    decodeLockedPointMutationSessionClock((await projectPointCommitTransactionResult(
      await runPointCommitInTransactionEffect(installedAuthority!.lock(tx, input.selector, "attempt")))).row);
  await emit({ phase: "lock", step: "clockLocked" });
  projectTransactionSessionActivationResult(requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    executionClaimLivenessStableAuthorityFailures,
  ));
  if (input.installedFinite === true) {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      renewFiniteExecutionClaimInTransaction(tx, input, clock, () => emit({ phase: "lock", step: "sessionLocked" }))));
  }
  const session = await lockExactPointMutationSession(
    tx,
    input.selector,
    clock,
    executionClaimLivenessExactSessionFailures,
    async () => emit({ phase: "lock", step: "sessionLocked" }),
  );
  if (session.lifecycle !== "running" && session.lifecycle !== "finishing") {
    throw new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "lifecycleChanged",
    });
  }
  if (session.executionProfile === "finiteRoot") {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(renewFiniteExecutionClaimInTransaction(tx, input, clock)));
  }
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: input.selector.scopeId,
      authorityProfile: "liveExecution",
      failures: executionClaimLivenessAttemptAuthorityFailures,
      afterLeaseLock: async () =>
        emit({ phase: "lock", step: "leaseLocked" }),
    },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (locked.leaseState === "absent") {
    throw executionClaimLivenessCorruption("leaseInvalid");
  }
  const root = await requireExactPointMutationSessionJournalRoot(
    tx,
    input.selector.scopeId,
    clock.scopeUuid,
    locked.sessionId,
    locked.attemptFence,
    async () => emit({ phase: "lock", step: "journalRootLocked" }),
  );
  const claimRows = await tx.select().from(
    fxSystemTransactionExecutionClaims,
  ).where(and(
    eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
    eq(
      fxSystemTransactionExecutionClaims.attemptFence,
      locked.attemptFence,
    ),
  )).limit(2).for("update");
  await emit({ phase: "lock", step: "executionClaimLocked" });

  const grantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const databaseNow = await readDatabaseNow(tx, input.selector.scopeId);
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    grantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw executionClaimLivenessCorruption("sessionInvalid");
  }
  const authorityTargetMilliseconds = Math.min(
    grantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
  );

  if (session.lifecycle === "finishing") {
    if (
      root.state !== "sealed" ||
      claimRows.length !== 0 ||
      locked.leaseExpiresAtMilliseconds !== authorityTargetMilliseconds
    ) {
      throw executionClaimLivenessCorruption("claimInvalid");
    }
    return Object.freeze({ kind: "consumedByFinishing" });
  }
  if (session.lifecycle !== "running") {
    throw new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "lifecycleChanged",
    });
  }
  const claimRow = claimRows[0];
  if (claimRows.length !== 1 || claimRow === undefined) {
    throw executionClaimLivenessCorruption("claimInvalid");
  }
  const claim = projectExecutionClaimLivenessResult(
    requireLiveTransactionExecutionClaimV1Result(
      input.selector.scopeId,
      claimRow,
      input.executionClaim,
      databaseNow,
    ),
  );
  const phase = root.state === "sealed"
    ? "sealed"
    : root.state === "failed" || root.state === "operation_failed"
    ? "failed"
    : root.state === "relation_conflicted"
    ? "relationConflicted"
    : root.state === "open" || root.state === "operation_invoking"
    ? "open"
    : undefined;
  if (phase === undefined) {
    throw executionClaimLivenessCorruption("journalRootInvalid");
  }
  const projected = projectExecutionClaimLivenessResult(
    projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds,
      currentLeaseExpiresAtMilliseconds: locked.leaseExpiresAtMilliseconds,
      currentClaimExpiresAtMilliseconds: Date.parse(claim.claimExpiresAt),
      authorizationGrantExpiresAtMilliseconds: grantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
      claimDurationMilliseconds: input.claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds:
        input.leaseRenewalDurationMilliseconds,
      maximumLiveSnapshotRetentionMilliseconds:
        input.maximumLiveSnapshotRetentionMilliseconds,
      phase,
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)),
  );

  const targetLeaseExpiresAt = new Date(
    projected.targetLeaseExpiresAtMilliseconds,
  );
  if (
    projected.targetLeaseExpiresAtMilliseconds !==
      locked.leaseExpiresAtMilliseconds
  ) {
    const renewedLeases = await tx.update(fxSystemSnapshotLeases).set({
      leaseExpiresAt: targetLeaseExpiresAt,
    }).where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, locked.sessionId),
      eq(fxSystemSnapshotLeases.attemptFence, locked.attemptFence),
      eq(
        fxSystemSnapshotLeases.snapshotEpochUuid,
        locked.lease.snapshotEpochUuid,
      ),
      eq(
        fxSystemSnapshotLeases.snapshotCommitSeq,
        locked.lease.snapshotCommitSeq,
      ),
      eq(fxSystemSnapshotLeases.leaseExpiresAt, locked.lease.leaseExpiresAt),
    )).returning({ leaseExpiresAt: fxSystemSnapshotLeases.leaseExpiresAt });
    if (
      renewedLeases.length !== 1 ||
      finiteDateMilliseconds(renewedLeases[0]?.leaseExpiresAt) !==
        projected.targetLeaseExpiresAtMilliseconds
    ) {
      throw executionClaimLivenessCorruption("mutationInvalid");
    }
    await emit({ phase: "write", step: "leaseRenewed" });
  }

  const targetClaimExpiresAt = new Date(
    projected.targetClaimExpiresAtMilliseconds,
  );
  if (
    projected.targetClaimExpiresAtMilliseconds !==
      Date.parse(claim.claimExpiresAt)
  ) {
    const renewedClaims = await tx.update(
      fxSystemTransactionExecutionClaims,
    ).set({ claimExpiresAt: targetClaimExpiresAt }).where(and(
      eq(fxSystemTransactionExecutionClaims.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionExecutionClaims.sessionId, locked.sessionId),
      eq(
        fxSystemTransactionExecutionClaims.attemptFence,
        locked.attemptFence,
      ),
      eq(
        fxSystemTransactionExecutionClaims.claimOwner,
        input.executionClaim.claimOwner,
      ),
      eq(
        fxSystemTransactionExecutionClaims.claimFence,
        input.executionClaim.claimFence,
      ),
      eq(fxSystemTransactionExecutionClaims.claimedAt, claimRow.claimedAt),
      eq(
        fxSystemTransactionExecutionClaims.claimExpiresAt,
        claimRow.claimExpiresAt,
      ),
    )).returning({
      claimExpiresAt: fxSystemTransactionExecutionClaims.claimExpiresAt,
    });
    if (
      renewedClaims.length !== 1 ||
      finiteDateMilliseconds(renewedClaims[0]?.claimExpiresAt) !==
        projected.targetClaimExpiresAtMilliseconds
    ) {
      throw executionClaimLivenessCorruption("mutationInvalid");
    }
    await emit({ phase: "write", step: "executionClaimRenewed" });
  }

  const observation = Object.freeze({
    ...claim,
    claimExpiresAt: targetClaimExpiresAt.toISOString(),
  });
  const leaseExpiresAt = targetLeaseExpiresAt.toISOString();
  return phase === "failed"
    ? Object.freeze({
      kind: "terminalizationRequired",
      reason: "failedRoot",
      leaseExpiresAt,
      executionClaim: observation,
    })
    : Object.freeze({
      kind: "renewed",
      phase,
      leaseExpiresAt,
      executionClaim: observation,
    });
}

/** The Promise transaction callback above owns this one bounded runtime bridge. */
const renewFiniteExecutionClaimInTransaction = Effect.fn(
  function* (tx: AppRowTransaction, input: LocatedPointMutationExecutionClaimLivenessInputV1,
    clock: LockedPointMutationSessionClockV1, afterSessionLock?: () => Promise<void>) {
    const context = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(Effect.mapError(cause => executionClaimLivenessCorruption("sessionInvalid", cause)));
    const session = context.session;
    if (afterSessionLock !== undefined) yield* Effect.tryPromise({ try: afterSessionLock, catch: mapExecutionClaimLivenessTransactionError });
    if (session.lifecycle !== "running") return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "lifecycleChanged" }));
    if (session.storageGeneration !== clock.record.storageGeneration || session.storageGenerationFence !== clock.record.storageGenerationFence)
      return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "generationChanged" }));
    if (session.authorizationRevocationEpoch !== clock.authorizationRevocationEpoch)
      return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "revocationEpochChanged" }));
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId), catch: mapExecutionClaimLivenessTransactionError });
    if (context.snapshotToken.epoch !== clock.record.epoch) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "epochChanged" }));
    if (context.snapshotToken.commitSeq < clock.record.oldestAvailableCommitSeq)
      return yield* Effect.fail(executionClaimLivenessCorruption("leaseInvalid"));
    const claim = context.executionClaim;
    if (claim.claimOwner !== input.executionClaim.claimOwner) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "claimOwnerChanged" }));
    if (claim.claimFence !== input.executionClaim.claimFence) return yield* Effect.fail(new PointMutationExecutionClaimLivenessStaleV1Error({ reason: "claimFenceChanged" }));
    const projected = yield* Effect.fromResult(projectExecutionClaimRenewalV1Result({
      databaseNowMilliseconds: databaseNow.getTime(), currentLeaseExpiresAtMilliseconds: context.leaseExpiresAt.getTime(),
      currentClaimExpiresAtMilliseconds: Date.parse(claim.claimExpiresAt), authorizationGrantExpiresAtMilliseconds: session.authorizationGrantExpiresAt.getTime(),
      hardExpiresAtMilliseconds: session.hardExpiresAt.getTime(), claimDurationMilliseconds: input.claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds: input.leaseRenewalDurationMilliseconds,
      maximumLiveSnapshotRetentionMilliseconds: input.maximumLiveSnapshotRetentionMilliseconds, phase: "open",
    }).pipe(Result.mapError(mapExecutionClaimRenewalIssue)));
    const rows = yield* Effect.tryPromise({ try: () => tx.update(fxSystemTransactionSessions).set({
      finiteLeaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds), finiteClaimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds),
    }).where(and(eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, session.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, session.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "running"),
      eq(fxSystemTransactionSessions.finiteClaimOwner, claim.claimOwner), eq(fxSystemTransactionSessions.finiteClaimFence, claim.claimFence)))
      .returning({ sessionId: fxSystemTransactionSessions.sessionId }), catch: mapExecutionClaimLivenessTransactionError });
    if (rows.length !== 1) return yield* Effect.fail(executionClaimLivenessCorruption("mutationInvalid"));
    return Object.freeze({ kind: "renewed" as const, phase: "open" as const,
      leaseExpiresAt: new Date(projected.targetLeaseExpiresAtMilliseconds).toISOString(),
      executionClaim: Object.freeze({ ...claim, claimExpiresAt: new Date(projected.targetClaimExpiresAtMilliseconds).toISOString() }) });
  });

function projectExecutionClaimLivenessResult<Success>(
  result: Result.Result<
    Success,
    | PointMutationExecutionClaimLivenessV1Error
    | TransactionExecutionClaimCorruptionV1Error
    | TransactionExecutionClaimStaleV1Error
  >,
): Success {
  return Result.match(result, {
    onSuccess: (value) => value,
    onFailure: (failure) => {
      if (failure instanceof TransactionExecutionClaimStaleV1Error) {
        const reason = failure.reason === "claimOwnerMismatch"
          ? "claimOwnerChanged"
          : failure.reason === "claimFenceMismatch"
          ? "claimFenceChanged"
          : "claimExpired";
        throw new PointMutationExecutionClaimLivenessStaleV1Error({ reason });
      }
      if (failure instanceof TransactionExecutionClaimCorruptionV1Error) {
        throw executionClaimLivenessCorruption("claimInvalid", failure);
      }
      throw failure;
    },
  });
}

function mapExecutionClaimLivenessTransactionError(
  cause: unknown,
): Exclude<
  PointMutationExecutionClaimLivenessV1Error,
  | PointMutationExecutionClaimLivenessInputV1Error
  | PointMutationExecutionClaimLivenessConfigurationV1Error
  | TrustedScopeAuthorityResolutionError
> {
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    switch (cause.issue.kind) {
      case "callbackRolledBack":
        return mapExecutionClaimLivenessTransactionError(
          cause.issue.callbackCause,
        );
      case "decisionUncertain":
        return new PointMutationExecutionClaimLivenessUncertainV1Error({
          cause,
        });
      case "callbackCleanupFailed":
      case "infrastructureFailure":
        return new PointMutationExecutionClaimLivenessPersistenceV1Error({
          operation: "transaction",
          cause,
        });
    }
  }
  if (
    cause instanceof PointMutationExecutionClaimLivenessStaleV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessCorruptionV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessPersistenceV1Error ||
    cause instanceof PointMutationExecutionClaimLivenessUncertainV1Error
  ) {
    return cause;
  }
  if (cause instanceof PointMutationSessionAuthorityCorruptionV1Error) {
    return executionClaimLivenessCorruption(
      cause.issue === "snapshotLeaseInvalid"
        ? "leaseInvalid"
        : cause.issue === "journalRootInvalid" ||
            cause.issue === "activeJournalRootMissing"
        ? "journalRootInvalid"
        : "sessionInvalid",
      cause,
    );
  }
  if (cause instanceof ScopeClockNotFoundError) {
    return new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "scopeChanged",
    });
  }
  return new PointMutationExecutionClaimLivenessPersistenceV1Error({
    operation: "transaction",
    cause,
  });
}

const executionClaimLivenessStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "scopeChanged",
    }),
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

const executionClaimLivenessExactSessionFailures = Object.freeze({
  sessionMissing: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "attemptMissing",
    }),
  staleAttemptFence: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "attemptReplaced",
    }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const executionClaimLivenessAttemptAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  storageGenerationFenceChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "generationChanged",
    }),
  authorizationRevocationEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "revocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    new PointMutationExecutionClaimLivenessStaleV1Error({
      reason: "epochChanged",
    }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);
