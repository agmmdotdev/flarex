import {
  SessionJournalTargetUnavailableV1Error,
  SessionJournalPersistenceV1Error,
} from "./errors";
import type {
  SessionJournalAttemptStateV1,
  ResolvedJournalTargetV1,
} from "./state";
import type { StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../../commit/authority/postgresLoader";
import { Effect } from "effect";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityPortError,
} from "../../scope/scopeAuthorityResolution";
import { LogicalParticipantAdmissionError } from "../../storage/documents/logicalDocuments/participantErrors";
import type { LogicalParticipantAttemptReadTransaction } from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  ExactRunningAttemptTransactionV1Error,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  isLocatedExactRunningAttemptKernelV1,
} from "../transactionSessionAttemptKernel";
import { mapExactAdmissionFailure, corruption } from "./journalFailures";
import type { JournalAttemptOwner } from "./attemptOwner";

export function makeJournalTargetResolver(
  ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  owner: JournalAttemptOwner,
) {
  const resolveJournalTargetEffect = Effect.fn(
    "SessionJournalStore.resolveJournalTarget",
  )(function* (
    attempt: SessionJournalAttemptStateV1,
  ): Effect.fn.Return<
    ResolvedJournalTargetV1,
    SessionJournalPersistenceV1Error | SessionJournalTargetUnavailableV1Error
  > {
    if (attempt.executionProfile === "finiteRoot") {
      const finite = owner.readFiniteRoot(attempt);
      if (finite === undefined)
        return yield* Effect.fail(
          new SessionJournalTargetUnavailableV1Error({
            scopeId: attempt.selector.scopeId,
          }),
        );
      return finite.resolvedTarget;
    }
    const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
      {
        deploymentId: attempt.selector.deploymentId,
        scopeId: attempt.selector.scopeId,
      },
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SessionJournalPersistenceV1Error({
            operation: "resolveJournalTarget",
            cause:
              cause instanceof TrustedScopeAuthorityPortError
                ? cause.cause
                : cause,
          }),
      ),
    );
    if (
      located.authority.scopeId !== attempt.selector.scopeId ||
      !isLocatedExactRunningAttemptKernelV1(located.target)
    ) {
      return yield* Effect.fail(
        new SessionJournalTargetUnavailableV1Error({
          scopeId: attempt.selector.scopeId,
        }),
      );
    }
    return Object.freeze({
      target: located.target,
      authority: located.authority,
    });
  });
  return resolveJournalTargetEffect;
}

export type JournalTargetResolver = (
  attempt: SessionJournalAttemptStateV1,
) => Effect.Effect<
  ResolvedJournalTargetV1,
  SessionJournalPersistenceV1Error | SessionJournalTargetUnavailableV1Error
>;

export const admitExactRunningAttemptEffect = Effect.fn(
  "SessionJournalStore.admitExactRunningAttempt",
)(function* (
  resolved: ResolvedJournalTargetV1,
  attempt: SessionJournalAttemptStateV1,
  operation:
    | "openAttempt"
    | "resolvePinnedPointTable"
    | "resolveApplicationRelation"
    | "prepareSealSnapshot",
) {
  return yield* resolved.target[
    RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1
  ](
    {
      selector: attempt.selector,
      preliminaryAuthority: resolved.authority,
      executionClaim: attempt.executionClaim,
    },
    (_tx, context) =>
      context.journalRoot.executionProfile === attempt.executionProfile
        ? Effect.void
        : Effect.fail(corruption(attempt, "journalStateInvalid")),
  ).pipe(
    Effect.mapError((cause) =>
      cause instanceof ExactRunningAttemptTransactionV1Error
        ? mapExactAdmissionFailure(operation, cause)
        : cause,
    ),
  );
});

export const makeAttemptReadTransaction =
  (
    state: SessionJournalAttemptStateV1,
    resolved: ResolvedJournalTargetV1,
  ): LogicalParticipantAttemptReadTransaction =>
  (work) =>
    Effect.suspend(() =>
      state.executionProfile === "finiteRoot"
        ? Effect.fail(
            new LogicalParticipantAdmissionError({
              reason: "invalidAuthority",
            }),
          )
        : resolved.target[RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1](
            {
              selector: state.selector,
              preliminaryAuthority: resolved.authority,
              executionClaim: state.executionClaim,
            },
            (tx, context) => work(tx, resolved.authority, context.scopeClock),
          ).pipe(
            Effect.catchTag("ExactRunningAttemptTransactionV1Error", (cause) =>
              Effect.fail(
                new LogicalParticipantAdmissionError({
                  reason: "invalidAuthority",
                  cause,
                }),
              ),
            ),
          ),
    );
