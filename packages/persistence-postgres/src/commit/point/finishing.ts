import { finiteDateMilliseconds } from "@flarex/utils/dates";
import {
  and,
  eq,
} from "drizzle-orm";
import {
  Effect,
  Result,
} from "effect";
import {
  lockPointCommitClock,
  lockPointCommitJournalRoot,
  lockPointCommitLease,
  lockPointCommitSession,
  preliminaryAuthorityFailure,
  requireAttemptIsLiveResult,
  requireLockedClockAuthorityResult,
  resolvePointCommitAuthority,
} from "./attemptAcceptance";
import { capturePointCommitFinishingTransitionCommandResult } from "./capture";
import { type PointCommitTransactionProofOptionsV1 } from "./constructionContracts";
import {
  type PointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionResultV1,
} from "./contracts";
import {
  corruption,
  type PointCommitCorruptionV1Error,
} from "./errors";
import { type PreparedPointCommitFinishingTransitionCommandV1 } from "./preparedCommands";
import {
  projectPointCommitTransactionResult,
  runPointCommitPromiseEffect,
} from "./promiseBoundary";
import {
  mapFinishingTransitionFailure,
  observeDrizzleQuery,
  sqlCall,
} from "./sqlFailures";
import { readPointCommitDatabaseTime } from "../publication/pointCommitProjection";
import {
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionSessions,
} from "../../database/schema";
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
import { emitTransactionStep } from "../../storage/materialization/materialization";

export async function runPointCommitFinishingTransition(
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitFinishingTransitionCommandV1,
  options: PointCommitTransactionProofOptionsV1,
): Promise<PointCommitFinishingTransitionResultV1> {
  return target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const clock = await lockPointCommitClock(tx, command, options);
    await emitTransactionStep(options, command, "clockLocked");
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
      options,
      "enterFinishing",
    );
    await emitTransactionStep(options, command, "sessionLocked");
    const lease = await lockPointCommitLease(tx, command, options);
    await emitTransactionStep(options, command, "leaseLocked");
    await lockPointCommitJournalRoot(tx, command, options);
    await emitTransactionStep(options, command, "journalRootLocked");

    const databaseNowMilliseconds = await readPointCommitDatabaseTime(
      tx,
      command.authorityPins.scopeId,
      options,
    );
    projectPointCommitTransactionResult(
      requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
    );
    projectPointCommitTransactionResult(
      requireFinishingSessionTimeResult(
        session.updatedAtMilliseconds,
        databaseNowMilliseconds,
      ),
    );
    const priorSessionUpdatedAtMilliseconds =
      command.session.updatedAtMilliseconds;
    if (session.lifecycle === "finishing") {
      const claims = await tx.select({
        claimFence: fxSystemTransactionExecutionClaims.claimFence,
      }).from(fxSystemTransactionExecutionClaims).where(and(
        eq(
          fxSystemTransactionExecutionClaims.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
        eq(
          fxSystemTransactionExecutionClaims.sessionId,
          command.authorityPins.sessionId,
        ),
        eq(
          fxSystemTransactionExecutionClaims.attemptFence,
          command.authorityPins.attemptFence,
        ),
      )).limit(2).for("update");
      projectPointCommitTransactionResult(
        requireNoFinishingExecutionClaimResult(claims),
      );
      return finishingTransitionResult(
        "observed",
        command,
        priorSessionUpdatedAtMilliseconds,
        session.updatedAtMilliseconds,
      );
    }
    const executionClaim = projectPointCommitTransactionResult(
      await lockExactTransactionExecutionClaimV1Result(tx, {
        scopeId: command.authorityPins.scopeId,
        scopeUuid: command.sealIdentity.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
      }),
    );
    await emitTransactionStep(options, command, "executionClaimLocked");
    projectPointCommitTransactionResult(
      requireLiveTransactionExecutionClaimV1Result(
        command.authorityPins.scopeId,
        executionClaim,
        command.executionClaim,
        new Date(databaseNowMilliseconds),
      ),
    );
    const deleteClaim = tx.delete(fxSystemTransactionExecutionClaims).where(
      and(
        eq(
          fxSystemTransactionExecutionClaims.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
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
      ),
    ).returning({
      claimFence: fxSystemTransactionExecutionClaims.claimFence,
    });
    observeDrizzleQuery("deleteExecutionClaim", deleteClaim, options);
    const deletedClaims = await sqlCall(
      "deleteExecutionClaim",
      () => deleteClaim,
    );
    projectPointCommitTransactionResult(
      validateDeletedFinishingExecutionClaimResult(
        deletedClaims,
        command.executionClaim.claimFence,
      ),
    );
    await emitTransactionStep(options, command, "executionClaimDeleted");
    const finishingUpdatedAt = new Date(databaseNowMilliseconds);
    const query = tx
      .update(fxSystemTransactionSessions)
      .set({ lifecycle: "finishing", updatedAt: finishingUpdatedAt })
      .where(and(
        eq(
          fxSystemTransactionSessions.scopeUuid,
          command.sealIdentity.scopeUuid,
        ),
        eq(
          fxSystemTransactionSessions.sessionId,
          command.authorityPins.sessionId,
        ),
        eq(
          fxSystemTransactionSessions.attemptFence,
          command.authorityPins.attemptFence,
        ),
        eq(fxSystemTransactionSessions.lifecycle, "running"),
      ))
      .returning({
        lifecycle: fxSystemTransactionSessions.lifecycle,
        updatedAt: fxSystemTransactionSessions.updatedAt,
      });
    observeDrizzleQuery("enterFinishing", query, options);
    const rows = await sqlCall("enterFinishing", () => query);
    const updatedAtMilliseconds = projectPointCommitTransactionResult(
      materializeEnteredFinishingSessionResult(
        rows,
        databaseNowMilliseconds,
      ),
    );
    await emitTransactionStep(options, command, "sessionEnteredFinishing");
    return finishingTransitionResult(
      "transitioned",
      command,
      priorSessionUpdatedAtMilliseconds,
      updatedAtMilliseconds,
    );
  });
}

export function requireFinishingSessionTimeResult(
  sessionUpdatedAtMilliseconds: number,
  databaseNowMilliseconds: number,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return sessionUpdatedAtMilliseconds <= databaseNowMilliseconds
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

export function requireNoFinishingExecutionClaimResult(
  claims: ReadonlyArray<unknown>,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return claims.length === 0
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

export function validateDeletedFinishingExecutionClaimResult(
  deletedClaims: ReadonlyArray<Readonly<{ readonly claimFence: bigint }>>,
  expectedClaimFence: bigint,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return deletedClaims.length === 1 &&
    deletedClaims[0]?.claimFence === expectedClaimFence
    ? Result.succeed(undefined)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

export function materializeEnteredFinishingSessionResult(
  rows: ReadonlyArray<Readonly<{
    readonly lifecycle: string;
    readonly updatedAt: Date;
  }>>,
  databaseNowMilliseconds: number,
): Result.Result<number, PointCommitCorruptionV1Error> {
  const updated = rows[0];
  const updatedAtMilliseconds = updated === undefined
    ? undefined
    : finiteDateMilliseconds(updated.updatedAt);
  return rows.length === 1 &&
    updated !== undefined &&
    updated.lifecycle === "finishing" &&
    updatedAtMilliseconds !== undefined &&
    updatedAtMilliseconds === databaseNowMilliseconds
    ? Result.succeed(updatedAtMilliseconds)
    : Result.fail(corruption("finishingTransitionInvalid"));
}

export function finishingTransitionResult(
  kind: PointCommitFinishingTransitionResultV1["kind"],
  command: PreparedPointCommitFinishingTransitionCommandV1,
  priorSessionUpdatedAtMilliseconds: number,
  finishingSessionUpdatedAtMilliseconds: number,
): PointCommitFinishingTransitionResultV1 {
  return Object.freeze({
    kind,
    scopeUuid: command.sealIdentity.scopeUuid,
    sessionId: command.authorityPins.sessionId,
    attemptFence: command.authorityPins.attemptFence,
    priorSessionUpdatedAtMilliseconds,
    finishingSessionUpdatedAtMilliseconds,
  });
}

export function bindPointCommitFinishingTransition(ports: PointMutationSessionAuthorityResolutionPortsV1, options: PointCommitTransactionProofOptionsV1): PointCommitFinishingTransitionPortV1["enterFinishing"] {
  const enterFinishing: PointCommitFinishingTransitionPortV1[
    "enterFinishing"
  ] = Effect.fn(
    "PointCommitTransaction.enterFinishing",
  )(function* (input) {
    const command = yield* Effect.fromResult(
      capturePointCommitFinishingTransitionCommandResult(input),
    );
    const located = yield* resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    );
    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }
    const target = isLocatedReadCommittedAttemptTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* Effect.uninterruptible(runPointCommitPromiseEffect(() => runPointCommitFinishingTransition(
      target,
      located.authority,
      command,
      options,
    ), mapFinishingTransitionFailure));
  });
  return enterFinishing;
}
