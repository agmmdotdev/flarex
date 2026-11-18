import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "../../commit/point/promiseBoundary";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import {
  TrustedScopeAuthorityPortError,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "../claims/transactionExecutionClaimErrors";
import {
  lockExactTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
} from "../claims/transactionExecutionClaimPersistence";
import { lockFiniteAttemptAnchorInTransaction } from "../finiteAttemptAnchor";
import {
  lockExactPointMutationSession,
  lockPointMutationSessionAttemptStructure,
  lockPointMutationSessionClockWithMode,
  readDatabaseNow,
  requireStablePointMutationSessionAttemptAuthority,
  type LockedPointMutationSessionClockV1,
  type PointMutationSessionAttemptAuthorityFailureFactoryV1,
  type PointMutationSessionExactSessionFailureFactoryV1,
  type PointMutationSessionStableAuthorityFailureFactoryV1,
} from "./attemptAuthority";
import {
  TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  requireAttemptTerminalizationTarget,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type LocatedPointMutationSessionAttemptTerminalizationInputV1,
  type PointMutationSessionAttemptLoadLockStepV1,
  type PointMutationSessionAttemptTerminalizationEventV1,
  type PointMutationSessionAttemptTerminalizationOperationV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
  type PreparedPointMutationSessionAttemptTerminalizationInputV1,
} from "./constructionContracts";
import type {
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationPersistenceV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionTerminalLifecycleV1,
  PointMutationSessionTerminalObservationV1,
} from "./contracts";
import {
  PointMutationSessionAttemptTerminalizationPersistenceV1Error,
  PointMutationSessionAttemptTerminalizationV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  attemptTerminalizationError,
  corruptionError,
  projectTransactionSessionActivationResult,
  type PointMutationSessionAttemptTerminalizationEffectErrorV1,
} from "./errors";
import { captureAttemptAbortInput, captureTerminalizationAttemptSelector } from "./inputCapture";
import { copyFiniteDate, finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";

export function createPointMutationSessionAttemptTerminalizationPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptTerminalizationPersistenceV1 {
  const terminalize = Effect.fn(function* (
    input: PreparedPointMutationSessionAttemptTerminalizationInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      { deploymentId: input.selector.deploymentId, scopeId: input.selector.scopeId },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapAttemptTerminalizationAuthorityError));
    if (located.authority.scopeId !== input.selector.scopeId) {
      return yield* Effect.fail(
        attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
      );
    }
    const target = yield* Effect.fromResult(
      requireAttemptTerminalizationTarget(
        located.target,
        input.selector.scopeId,
      ),
    );
    return yield* target[
      TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1
    ]({
      ...input,
      preliminaryAuthority: located.authority,
    });
  });

  const abortEffect = Effect.fn(function* (
    input: PointMutationSessionAttemptAbortInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const captured = yield* Effect.fromResult(captureAttemptAbortInput(input));
    return yield* terminalize({
      operation: "abort",
      selector: captured.selector,
      expectedSnapshotToken: captured.expectedSnapshotToken,
      executionClaim: captured.executionClaim,
    });
  });

  const expireEffect = Effect.fn(function* (
    input: PointMutationSessionAttemptSelectorV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const selector = yield* Effect.fromResult(
      captureTerminalizationAttemptSelector(input),
    );
    return yield* terminalize({
      operation: "expire",
      selector,
    });
  });

  return Object.freeze({ abortEffect, expireEffect });
}

export async function terminalizeAttemptInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
        "afterTerminalizationEvent"
      ]
    | undefined,
): Promise<PointMutationSessionAttemptTerminalizationResultV1> {
  const selector = input.selector;
  const emitLock = async (
    step: PointMutationSessionAttemptLoadLockStepV1,
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "lock",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };
  const emitWrite = async (
    step: Extract<
      PointMutationSessionAttemptTerminalizationEventV1,
      { readonly phase: "write" }
    >["step"],
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "write",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };

  // Terminal cleanup releases durable attempt ownership; it does not admit
  // execution under the revoked grant. Serialize lifecycle changes first.
  const clock = await lockPointMutationSessionClockWithMode(tx, selector.scopeId, "terminalCleanup");
  await emitLock("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptTerminalizationAuthority(clock, input));
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptTerminalizationExactSessionFailures,
    emitLock,
  );
  if (session.executionProfile === "finiteRoot") {
    return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(terminalizeFiniteAttemptInTransaction(tx, input, clock)));
  }
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: selector.scopeId,
      authorityProfile: "terminalCleanup",
      failures: attemptTerminalizationAuthorityFailures,
      afterLeaseLock: emitLock,
    },
    clock,
    session,
    input.operation === "expire"
      ? "allowExpiredTerminalization"
      : "requireRetainedSnapshot",
  );
  const journalRoots = await tx
    .select({ attemptFence: fxSystemTransactionJournals.attemptFence })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .limit(2)
    .for("update");
  if (journalRoots.length > 1) {
    throw corruptionError(selector.scopeId, "journalRootInvalid");
  }
  if (journalRoots[0] !== undefined) {
    await emitLock("journalRootLocked");
  }

  switch (session.lifecycle) {
    case "committed":
    case "aborted":
    case "expired": {
      if (locked.leaseState === "present") {
        throw corruptionError(
          selector.scopeId,
          "terminalSnapshotLeasePresent",
        );
      }
      if (journalRoots[0] !== undefined) {
        throw corruptionError(selector.scopeId, "terminalJournalRootPresent");
      }
      return projectTransactionSessionActivationResult(attemptTerminalizationResult(
        "observed",
        selector,
        session.lifecycle,
        session.updatedAt,
      ));
    }
    case "created":
    case "committing":
    case "retrying":
      throw attemptTerminalizationError({
        reason: "attemptNotTerminalizable",
        lifecycle: session.lifecycle,
      });
    case "running":
      break;
    case "finishing":
      if (input.operation === "abort") {
        throw attemptTerminalizationError({
          reason: "attemptNotTerminalizable",
          lifecycle: "finishing",
        });
      }
      break;
    default: {
      const unexpectedLifecycle: never = session.lifecycle;
      throw corruptionError(
        selector.scopeId,
        "sessionRecordInvalid",
        unexpectedLifecycle,
      );
    }
  }

  if (locked.leaseState === "absent") {
    throw corruptionError(selector.scopeId, "snapshotLeaseMissing");
  }
  if (journalRoots[0] === undefined) {
    throw corruptionError(selector.scopeId, "activeJournalRootMissing");
  }
  if (
    input.operation === "abort" &&
    (
      input.expectedSnapshotToken.scopeId !== selector.scopeId ||
      input.expectedSnapshotToken.epoch !== locked.snapshotEpoch ||
      input.expectedSnapshotToken.commitSeq !== locked.snapshotCommitSeq
    )
  ) {
    throw corruptionError(selector.scopeId, "attemptSnapshotChanged");
  }
  // Clock-independent refusals and idempotent terminal observations precede
  // the later claim gate. A live abort still samples time after every lock wait.
  const executionClaimResult = input.operation === "abort"
    ? await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: selector.scopeId,
        scopeUuid: clock.scopeUuid,
        sessionId: locked.sessionId,
        attemptFence: locked.attemptFence,
      })
    : undefined;
  const databaseNow = await readDatabaseNow(tx, selector.scopeId);
  if (input.operation === "abort") {
    if (executionClaimResult === undefined)
      throw corruptionError(selector.scopeId, "executionClaimInvalid");
    const executionClaim = projectTransactionSessionActivationResult(
      executionClaimResult,
    );
    await emitLock("executionClaimLocked");
    projectTransactionSessionActivationResult(
      requireLiveTransactionExecutionClaimV1Result(
        selector.scopeId,
        executionClaim,
        input.executionClaim,
        databaseNow,
      ),
    );
  }

  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    hardExpiresAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  const effectiveExpiryMilliseconds = Math.min(
    locked.leaseExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
  );
  const effectiveExpiresAt = new Date(effectiveExpiryMilliseconds);
  if (finiteDateMilliseconds(effectiveExpiresAt) === undefined) {
    throw corruptionError(selector.scopeId, "snapshotLeaseInvalid");
  }
  const isExpired = effectiveExpiryMilliseconds <= databaseNowMilliseconds;
  if (input.operation === "expire" && !isExpired) {
    throw attemptTerminalizationError({
      reason: "attemptStillLive",
      effectiveExpiresAt: effectiveExpiresAt.toISOString(),
    });
  }
  const lifecycle = isExpired ? "expired" : "aborted";

  const deletedJournal = await tx
    .delete(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
  if (
    deletedJournal.length !== 1 ||
    deletedJournal[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("journalDeleted");

  const deleted = await tx
    .delete(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, locked.sessionId),
      eq(fxSystemSnapshotLeases.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
  if (
    deleted.length !== 1 ||
    deleted[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("leaseDeleted");

  const updated = await tx
    .update(fxSystemTransactionSessions)
    .set({
      validatedArgsJson: null,
      validatedArgsCanonicalBytes: null,
      authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      lifecycle,
      updatedAt: databaseNow,
    })
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, locked.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, locked.attemptFence),
      eq(fxSystemTransactionSessions.lifecycle, session.lifecycle),
    ))
    .returning({
      lifecycle: fxSystemTransactionSessions.lifecycle,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    });
  const terminal = updated[0];
  const terminalUpdatedAt = copyFiniteDate(terminal?.updatedAt);
  if (
    updated.length !== 1 ||
    terminal === undefined ||
    terminal.lifecycle !== lifecycle ||
    terminalUpdatedAt === undefined
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("sessionTerminalized");

  return projectTransactionSessionActivationResult(attemptTerminalizationResult(
    "terminalized",
    selector,
    lifecycle,
    terminalUpdatedAt,
  ));
}

const terminalizeFiniteAttemptInTransaction = Effect.fn(
  function* (tx: AppRowTransaction, input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
    clock: LockedPointMutationSessionClockV1) {
    const context = yield* lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)));
    const session = context.session;
    if (session.lifecycle === "committed" || session.lifecycle === "aborted" || session.lifecycle === "expired")
      return yield* Effect.fromResult(attemptTerminalizationResult("observed", input.selector, session.lifecycle, session.updatedAt));
    if (session.lifecycle !== "running") return yield* Effect.fail(attemptTerminalizationError({
      reason: "attemptNotTerminalizable", lifecycle: session.lifecycle }));
    if (session.storageGenerationFence !== clock.record.storageGenerationFence || context.snapshotToken.epoch !== clock.record.epoch)
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "attemptSnapshotChanged"));
    if (session.authorizationRevocationEpoch > clock.authorizationRevocationEpoch)
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "sessionRecordInvalid"));
    if (input.operation === "abort" && (input.expectedSnapshotToken.scopeId !== context.snapshotToken.scopeId ||
      input.expectedSnapshotToken.epoch !== context.snapshotToken.epoch || input.expectedSnapshotToken.commitSeq !== context.snapshotToken.commitSeq))
      return yield* Effect.fail(corruptionError(input.selector.scopeId, "attemptSnapshotChanged"));
    const databaseNow = yield* Effect.tryPromise({ try: () => readDatabaseNow(tx, input.selector.scopeId),
      catch: cause => mapAttemptTerminalizationTransactionError(input.operation, cause) });
    if (input.operation === "abort" && (context.executionClaim.claimOwner !== input.executionClaim.claimOwner ||
      context.executionClaim.claimFence !== input.executionClaim.claimFence || Date.parse(context.executionClaim.claimExpiresAt) <= databaseNow.getTime()))
      return yield* Effect.fail(attemptTerminalizationError({ reason: "executionClaimUnavailable" }));
    const effectiveExpiry = Math.min(context.leaseExpiresAt.getTime(), session.authorizationGrantExpiresAt.getTime(), session.hardExpiresAt.getTime());
    const expired = effectiveExpiry <= databaseNow.getTime();
    if (input.operation === "expire" && !expired) return yield* Effect.fail(attemptTerminalizationError({
      reason: "attemptStillLive", effectiveExpiresAt: new Date(effectiveExpiry).toISOString() }));
    const lifecycle = expired ? "expired" as const : "aborted" as const;
    const rows = yield* Effect.tryPromise({ try: () => tx.update(fxSystemTransactionSessions).set({ lifecycle, updatedAt: databaseNow,
      validatedArgsJson: null, validatedArgsCanonicalBytes: null, authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null, applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null }).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, session.scopeUuid), eq(fxSystemTransactionSessions.sessionId, session.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, session.attemptFence), eq(fxSystemTransactionSessions.lifecycle, "running")))
      .returning({ sessionId: fxSystemTransactionSessions.sessionId }), catch: cause => mapAttemptTerminalizationTransactionError(input.operation, cause) });
    if (rows.length !== 1) return yield* Effect.fail(corruptionError(input.selector.scopeId, "terminalizationWriteMismatch"));
    return yield* Effect.fromResult(attemptTerminalizationResult("terminalized", input.selector, lifecycle, databaseNow));
  });

const attemptTerminalizationAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptTerminalizationError({
      reason: "authorizationRevocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

const attemptTerminalizationExactSessionFailures = Object.freeze({
  sessionMissing: () =>
    attemptTerminalizationError({ reason: "sessionMissing" }),
  staleAttemptFence: () =>
    attemptTerminalizationError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const attemptTerminalizationStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

function requireStableAttemptTerminalizationAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
) {
  return requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptTerminalizationStableAuthorityFailures,
  );
}

function mapAttemptTerminalizationAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

export function mapAttemptTerminalizationTransactionError(
  operation: PointMutationSessionAttemptTerminalizationOperationV1,
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionAttemptTerminalizationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return attemptTerminalizationError({
      reason: "executionClaimUnavailable",
    });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
    operation: operation === "abort"
      ? "attemptAbortTransaction"
      : "attemptExpireTransaction",
    cause,
  });
}

function attemptTerminalizationResult(
  status: PointMutationSessionAttemptTerminalizationResultV1["status"],
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: PointMutationSessionTerminalLifecycleV1,
  terminalizedAt: Date,
): Result.Result<
  PointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionAuthorityCorruptionV1Error
> {
  switch (status) {
    case "terminalized": {
      if (lifecycle === "committed") {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - terminalized callers supply only aborted or expired; committed would violate the internal result-construction contract
        throw corruptionError(selector.scopeId, "sessionRecordInvalid");
      }
      return createTerminalObservation(selector, lifecycle, terminalizedAt).pipe(
        Result.map((terminal) => Object.freeze({ status: "terminalized" as const, terminal })),
      );
    }
    case "observed":
      return createTerminalObservation(selector, lifecycle, terminalizedAt).pipe(
        Result.map((terminal) => Object.freeze({ status: "observed" as const, terminal })),
      );
  }
}

function createTerminalObservation<
  Lifecycle extends PointMutationSessionTerminalLifecycleV1,
>(
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: Lifecycle,
  terminalizedAt: Date,
): Result.Result<
  PointMutationSessionTerminalObservationV1<Lifecycle>,
  PointMutationSessionAuthorityCorruptionV1Error
> {
  const identity = { ...selector, lifecycle };
  const scopeId = selector.scopeId;
  const cloned = copyFiniteDate(terminalizedAt);
  if (cloned === undefined) {
    return Result.fail(corruptionError(scopeId, "sessionRecordInvalid"));
  }
  return Result.succeed(Object.freeze({
    ...identity,
    terminalizedAt: cloned.toISOString(),
  }));
}
