import { copyBytes } from "@flarex/utils/bytes";
import { Data, Duration, Effect, Random, Result } from "effect";

import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  type CommittedPointOutcomeResolutionV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionResultV1,
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitOutcomeResolutionV1Error,
  type PointCommitPublicationCommandV1,
  type PointCommitPublicationResultV1,
  type PointCommitPublicationV1Error,
  type PointCommitPublisherPortV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";

import type { PointMutationExecutionClaimVaultV1 } from
  "../pointMutationExecutionClaim";
import {
  decodePointMutationSessionAttemptSelectorV1Result,
  type InvalidPointMutationSessionAttemptSelectorV1Error,
} from "../pointMutationSessionAttemptSelector";
import type {
  AuthenticatedStoredAttemptStateV1,
  PointCommitFinishingPublicationExecutionV1Error,
  PointCommitKnownSettledSqlRetryFailureV1,
  PointCommitUncertainOutcomeSecondaryV1,
  PointCommitFinishingRecoveryV1Error,
  StoredAttemptFinishingEvidenceLoaderPortV1,
  StoredPointCommitExecutorV1,
  StoredPointCommitFinishingTransitionV1,
  StoredPointCommitPlanningV1,
  StoredPointCommitPublisherV1,
} from "../storedAttemptAuthentication";
import type {
  ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import type {
  TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import {
  StoredAttemptPersistenceV1Error,
} from "./authenticationErrors";
import {
  requireLoadedStoredAttemptEvidenceEffect,
  type AuthenticatedStoredAttemptV1,
} from "./authenticationOperations";
import {
  captureRecoveredAuthorityEffect,
  verifyCanonicalStoredEvidenceEffect,
} from "./authenticationVerification";
import type {
  PreparedPointCommitCapabilityStateV1,
  PointCommitDecisionUncertainTicketStateV1,
  StoredPointMutationCapabilityVaultV1,
} from "./capabilityState";
import type {
  StoredCommitAuthoritySessionEvidencePortV1,
} from "./commitAuthorityModel";
import type {
  PointCommitOutcomeTicketCaptureOperationsV1,
} from "./occRerunAuthorizationOperations";
import {
  InvalidPreparedPointCommitV1Error,
  makeFinishingPreparedPointCommitHandleV1,
  type FinishingPreparedPointCommitV1,
  type PreparedPointCommitV1,
} from "./planningOperations";

const POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1 = 3;
const POINT_COMMIT_SQL_RETRY_INITIAL_BACKOFF_MILLISECONDS_V1 = 10;

export class PointCommitKnownSettledSqlRetryExhaustedV1Error
  extends Data.TaggedError(
    "PointCommitKnownSettledSqlRetryExhaustedV1Error",
  )<{
    readonly attempts: 3;
    readonly maximumAttempts: 3;
    readonly failures: readonly [
      PointCommitKnownSettledSqlRetryFailureV1,
      PointCommitKnownSettledSqlRetryFailureV1,
      PointCommitKnownSettledSqlRetryFailureV1,
    ];
  }> {}

/** Private O08-D terminal evidence. It carries no command or rerun authority. */
export class PointCommitUncertainOutcomeUnresolvedV1Error
  extends Data.TaggedError(
    "PointCommitUncertainOutcomeUnresolvedV1Error",
  )<{
    readonly stage:
      | "postSettlementOutcomeLookup"
      | "alreadyCommittedOutcomeLookup"
      | "guardedPublication";
    readonly primary: PointCommitDecisionUncertainV1Error;
    readonly secondary: PointCommitUncertainOutcomeSecondaryV1;
  }> {}

export class PointCommitUncertainOutcomeRecoveryCorruptionV1Error
  extends Data.TaggedError(
    "PointCommitUncertainOutcomeRecoveryCorruptionV1Error",
  )<{
    readonly reason: "reconstructedCommandMismatch";
  }> {}

type PointCommitOutcomeLookupSqlFailureV1 = Extract<
  PointCommitOutcomeResolutionV1Error,
  | { readonly _tag: "PointCommitSqlErrorV1" }
  | { readonly _tag: "CommittedPointOutcomeSqlErrorV1" }
>;

type PointCommitKnownSettledSqlPublicationV1Error =
  | Exclude<
      PointCommitPublicationV1Error,
      PointCommitConfirmedPreDecisionRollbackV1Error
    >
  | PointCommitKnownSettledSqlRetryExhaustedV1Error;

type PointCommitKnownSettledSqlRetryStateV1 =
  | Readonly<{
      readonly attempt: 1;
      readonly failures: readonly [];
    }>
  | Readonly<{
      readonly attempt: 2;
      readonly failures: readonly [
        PointCommitKnownSettledSqlRetryFailureV1,
      ];
    }>
  | Readonly<{
      readonly attempt: 3;
      readonly failures: readonly [
        PointCommitKnownSettledSqlRetryFailureV1,
        PointCommitKnownSettledSqlRetryFailureV1,
      ];
    }>;

export interface StoredPointCommitKnownSettledPublicationDependenciesV1 {
  readonly pointCommit: Pick<PointCommitPublisherPortV1, "publish">;
  readonly captureOccConflictTicket:
    PointCommitOutcomeTicketCaptureOperationsV1["captureOccConflictTicket"];
}

export interface StoredPointCommitKnownSettledPublicationOperationsV1 {
  readonly publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1;
}

export function makeStoredPointCommitKnownSettledPublicationOperationsV1(
  dependencies: StoredPointCommitKnownSettledPublicationDependenciesV1,
): StoredPointCommitKnownSettledPublicationOperationsV1 {
  const { pointCommit, captureOccConflictTicket } = dependencies;

  type PublishKnownSettledPointCommitV1 = (
    command: PointCommitPublicationCommandV1,
    state: PointCommitKnownSettledSqlRetryStateV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitKnownSettledSqlPublicationV1Error,
    never
  >;

  const publishKnownSettledPointCommit: PublishKnownSettledPointCommitV1 =
    Effect.fn(
      "StoredAttemptAuthentication.publishKnownSettledPointCommit",
    )(function (command, state) {
      return pointCommit.publish(command).pipe(
        Effect.catchTag(
          "PointCommitConfirmedPreDecisionRollbackV1Error",
          (failure) => {
            if (
              !(failure instanceof
                PointCommitConfirmedPreDecisionRollbackV1Error)
            ) {
              return Effect.die(failure);
            }
            const capturedFailure =
              capturePointCommitKnownSettledSqlRetryFailureV1(failure);
            if (state.attempt === POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1) {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = Object.freeze([
                state.failures[0],
                state.failures[1],
                capturedFailure,
              ]);
              return Effect.fail(
                new PointCommitKnownSettledSqlRetryExhaustedV1Error({
                  attempts: POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1,
                  maximumAttempts:
                    POINT_COMMIT_SQL_RETRY_MAXIMUM_ATTEMPTS_V1,
                  failures,
                }),
              );
            }
            let nextState: PointCommitKnownSettledSqlRetryStateV1;
            if (state.attempt === 1) {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = [capturedFailure];
              nextState = Object.freeze({
                attempt: 2,
                failures: Object.freeze(failures),
              });
            } else {
              const failures: readonly [
                PointCommitKnownSettledSqlRetryFailureV1,
                PointCommitKnownSettledSqlRetryFailureV1,
              ] = [state.failures[0], capturedFailure];
              nextState = Object.freeze({
                attempt: 3,
                failures: Object.freeze(failures),
              });
            }
            const backoffUpperBoundMilliseconds =
              POINT_COMMIT_SQL_RETRY_INITIAL_BACKOFF_MILLISECONDS_V1 *
              2 ** (state.attempt - 1);
            return Effect.gen(function* () {
              const random = yield* Random.next;
              yield* Effect.sleep(
                Duration.millis(random * backoffUpperBoundMilliseconds),
              );
              return yield* publishKnownSettledPointCommit(command, nextState);
            });
          },
        ),
      );
    });

  const publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1 = Effect.fn(
      "StoredAttemptAuthentication.publishCapturedFinishingPointCommit",
    )(function* (finishing, prepared, command) {
      const failures: readonly [] = [];
      return yield* publishKnownSettledPointCommit(
        command,
        Object.freeze({
          attempt: 1,
          failures: Object.freeze(failures),
        }),
      ).pipe(
        Effect.tapErrorTag(
          "PointCommitConflictV1Error",
          (error) => Effect.sync(() => {
            if (error instanceof PointCommitConflictV1Error) {
              captureOccConflictTicket(finishing, prepared, error);
            }
          }),
        ),
      );
    });

  return Object.freeze({ publishCapturedFinishingPointCommit });
}

export type ResolvePointCommitOutcomeFromStoredSessionV1 = (
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeUuid: ScopeUuidV1,
  session: Pick<
    StoredCommitAuthoritySessionEvidencePortV1,
    | "requestKey"
    | "identityAccessPolicySha256"
    | "functionPath"
    | "requestSha256"
  >,
) => Effect.Effect<
  CommittedPointOutcomeResolutionV1,
  PointCommitOutcomeResolutionV1Error,
  never
>;

export interface StoredPointCommitExecutionPublicationDependenciesV1 {
  readonly base: StoredPointCommitFinishingTransitionV1;
  readonly pointCommitOutcomeResolution:
    PointCommitOutcomeResolutionPortV1;
  readonly finishingEvidenceLoader: StoredAttemptFinishingEvidenceLoaderPortV1;
  readonly mintAuthenticatedStoredAttempt: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => AuthenticatedStoredAttemptV1;
  readonly authenticateCommitAuthority:
    StoredPointCommitPlanningV1["authenticateCommitAuthority"];
  readonly verifyCommitInput: StoredPointCommitPlanningV1["verifyCommitInput"];
  readonly planPointCommit: StoredPointCommitPlanningV1["planPointCommit"];
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
  readonly lookupFinishingPreparedPointCommit:
    StoredPointCommitFinishingTransitionOperationsV1[
      "lookupFinishingPreparedPointCommit"
    ];
  readonly publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1;
  readonly captureAndClaimDecisionUncertainTicket:
    PointCommitOutcomeTicketCaptureOperationsV1[
      "captureAndClaimDecisionUncertainTicket"
    ];
  readonly capturePublicationCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitPublicationCommandV1;
  readonly publicationCommandsEqual: (
    left: PointCommitPublicationCommandV1,
    right: PointCommitPublicationCommandV1,
  ) => boolean;
}

export interface StoredPointCommitExecutionPublicationOperationsV1 {
  readonly facade: StoredPointCommitExecutorV1;
  readonly resolvePointCommitOutcomeFromStoredSession:
    ResolvePointCommitOutcomeFromStoredSessionV1;
  readonly resolvePointCommitOutcomeObservation: (
    prepared: PreparedPointCommitCapabilityStateV1,
  ) => Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    PointCommitOutcomeResolutionV1Error,
    never
  >;
  readonly publishFinishingPointCommit:
    StoredPointCommitExecutorV1["publishPointCommit"];
  readonly publicationResultFromCommittedOutcome: (
    outcome: Exclude<
      CommittedPointOutcomeResolutionV1,
      { readonly kind: "missing" }
    >,
  ) => PointCommitPublicationResultV1;
}

function publicationResultFromCommittedOutcome(
  outcome: Exclude<
    CommittedPointOutcomeResolutionV1,
    { readonly kind: "missing" }
  >,
): PointCommitPublicationResultV1 {
  return outcome.kind === "expired"
    ? Object.freeze({ kind: "expired", token: outcome.token })
    : Object.freeze({
        kind: "replayed",
        token: outcome.token,
        successfulResult: outcome.successfulResult,
      });
}

export function makeStoredPointCommitExecutionPublicationOperationsV1(
  dependencies: StoredPointCommitExecutionPublicationDependenciesV1,
): StoredPointCommitExecutionPublicationOperationsV1 {
  const {
    base,
    pointCommitOutcomeResolution,
    finishingEvidenceLoader,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    lookupFinishingPreparedPointCommit,
    publishCapturedFinishingPointCommit,
    captureAndClaimDecisionUncertainTicket,
    capturePublicationCommand,
    publicationCommandsEqual,
  } = dependencies;

  const resolvePointCommitOutcomeFromStoredSession:
    ResolvePointCommitOutcomeFromStoredSessionV1 = Effect.fn(
      "StoredAttemptAuthentication.resolvePointCommitOutcomeFromStoredSession",
    )(function* (deploymentId, scopeUuid, session) {
      return yield* pointCommitOutcomeResolution[
        RESOLVE_POINT_COMMIT_OUTCOME_V1
      ](
        deploymentId,
        Object.freeze({
          scopeUuid,
          requestKey: TransactionRequestKeyV1Schema.make(session.requestKey),
          expectedIdentityAccessPolicySha256:
            TransactionIdentityAccessPolicySha256V1Schema.make(
              copyBytes(session.identityAccessPolicySha256),
            ),
          expectedFunctionPath: TransactionFunctionPathV1Schema.make(
            session.functionPath,
          ),
          expectedRequestSha256: TransactionRequestSha256V1Schema.make(
            copyBytes(session.requestSha256),
          ),
        }),
      );
    });

  const resolvePointCommitOutcomeObservation = Effect.fn(
    "StoredAttemptAuthentication.resolvePointCommitOutcomeObservation",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    const pins = prepared.plan.authorityPins;
    return yield* resolvePointCommitOutcomeFromStoredSession(
      pins.deploymentId,
      prepared.plan.sealIdentity.scopeUuid,
      prepared.provenance.session,
    );
  });

  const resolvePointCommitOutcomeForRecovery = Effect.fn(
    "StoredAttemptAuthentication.resolvePointCommitOutcomeForRecovery",
  )(function* (prepared: PreparedPointCommitCapabilityStateV1) {
    return yield* resolvePointCommitOutcomeObservation(prepared);
  });

  const {
    reconstructPointCommitFinishing,
    reconstructPointCommitFinishingFromSelector,
  } = makeStoredPointCommitFinishingRecoveryOperationsV1({
    finishingEvidenceLoader,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
  });

  const unresolvedFromOutcomeLookup = (
    primary: PointCommitDecisionUncertainV1Error,
    stage:
      | "postSettlementOutcomeLookup"
      | "alreadyCommittedOutcomeLookup",
    error: PointCommitOutcomeLookupSqlFailureV1,
  ): PointCommitUncertainOutcomeUnresolvedV1Error =>
    new PointCommitUncertainOutcomeUnresolvedV1Error({
      stage,
      primary,
      secondary: Object.freeze({
        kind: "outcomeLookupFailed",
        error,
      }),
    });

  const resolveAlreadyCommittedUncertainOutcome = Effect.fn(
    "StoredAttemptAuthentication.resolveAlreadyCommittedUncertainOutcome",
  )(function* (
    primary: PointCommitDecisionUncertainV1Error,
    ticket: PointCommitDecisionUncertainTicketStateV1,
  ) {
    const outcome = yield* resolvePointCommitOutcomeForRecovery(
      ticket.prepared,
    ).pipe(
      Effect.catchTags({
        PointCommitSqlErrorV1: (error) => Effect.fail(
          unresolvedFromOutcomeLookup(
            primary,
            "alreadyCommittedOutcomeLookup",
            error,
          ),
        ),
        CommittedPointOutcomeSqlErrorV1: (error) => Effect.fail(
          unresolvedFromOutcomeLookup(
            primary,
            "alreadyCommittedOutcomeLookup",
            error,
          ),
        ),
      }),
    );
    if (outcome.kind === "missing") {
      return yield* Effect.fail(new PointCommitCorruptionV1Error({
        reason: "committedOutcomeMissing",
      }));
    }
    return publicationResultFromCommittedOutcome(outcome);
  });

  const recoverPointCommitDecisionUncertain = Effect.fn(
    "StoredAttemptAuthentication.recoverPointCommitDecisionUncertain",
  )(function* (
    primary: PointCommitDecisionUncertainV1Error,
    ticket: PointCommitDecisionUncertainTicketStateV1,
  ) {
    if (primary.outcomeCheck.kind === "lookupFailed") {
      return yield* Effect.fail(unresolvedFromOutcomeLookup(
        primary,
        "postSettlementOutcomeLookup",
        primary.outcomeCheck.error,
      ));
    }

    const reconstructed = yield* reconstructPointCommitFinishingFromSelector(
      ticket.selector,
    ).pipe(
      Effect.catchTag(
        "StoredAttemptAlreadyCommittedV1Error",
        () => resolveAlreadyCommittedUncertainOutcome(primary, ticket),
      ),
    );
    if ("kind" in reconstructed) return reconstructed;

    const recoveredPrepared = preparedPointCommitStates.get(reconstructed);
    if (recoveredPrepared === undefined) {
      return yield* Effect.die(new Error(
        "Recovered finishing capability lost its factory-local state.",
      ));
    }
    const recoveredCommand = capturePublicationCommand(recoveredPrepared);
    if (!publicationCommandsEqual(ticket.command, recoveredCommand)) {
      return yield* Effect.fail(
        new PointCommitUncertainOutcomeRecoveryCorruptionV1Error({
          reason: "reconstructedCommandMismatch",
        }),
      );
    }

    return yield* publishCapturedFinishingPointCommit(
      reconstructed,
      recoveredPrepared,
      ticket.command,
    ).pipe(
      Effect.catchTag(
        "PointCommitDecisionUncertainV1Error",
        (secondary) => {
          if (!(secondary instanceof PointCommitDecisionUncertainV1Error)) {
            return Effect.die(secondary);
          }
          captureAndClaimDecisionUncertainTicket(
            secondary,
            reconstructed,
            recoveredPrepared,
            ticket.command,
          );
          return Effect.fail(
            new PointCommitUncertainOutcomeUnresolvedV1Error({
              stage: "guardedPublication",
              primary,
              secondary: Object.freeze({
                kind: "secondDecisionUncertain",
                error: secondary,
              }),
            }),
          );
        },
      ),
    );
  });

  const publishFinishingPointCommit:
    StoredPointCommitExecutorV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommit",
    )(function* (input) {
      const captured = yield* Effect.fromResult(
        lookupFinishingPreparedPointCommit(input),
      );
      const command = capturePublicationCommand(captured.prepared);
      return yield* publishCapturedFinishingPointCommit(
        captured.finishing,
        captured.prepared,
        command,
      ).pipe(
        Effect.catchTag(
          "PointCommitDecisionUncertainV1Error",
          (primary) => {
            if (!(primary instanceof PointCommitDecisionUncertainV1Error)) {
              return Effect.die(primary);
            }
            const ticket = captureAndClaimDecisionUncertainTicket(
              primary,
              captured.finishing,
              captured.prepared,
              command,
            );
            return recoverPointCommitDecisionUncertain(primary, ticket);
          },
        ),
      );
    });

  const facade = makeStoredPointCommitExecutorOperationsV1({
    base,
    publishPointCommit: publishFinishingPointCommit,
    reconstructPointCommitFinishing,
  });

  return Object.freeze({
    facade,
    resolvePointCommitOutcomeFromStoredSession,
    resolvePointCommitOutcomeObservation,
    publishFinishingPointCommit,
    publicationResultFromCommittedOutcome,
  });
}

export interface CapturedFinishingPreparedPointCommitV1 {
  readonly finishing: FinishingPreparedPointCommitV1;
  readonly prepared: PreparedPointCommitCapabilityStateV1;
}

export type PublishCapturedFinishingPointCommitV1 = (
  finishing: FinishingPreparedPointCommitV1,
  prepared: PreparedPointCommitCapabilityStateV1,
  command: PointCommitPublicationCommandV1,
) => Effect.Effect<
  PointCommitPublicationResultV1,
  PointCommitFinishingPublicationExecutionV1Error,
  never
>;

export interface StoredPointCommitFinishingTransitionOperationDependenciesV1 {
  readonly base: StoredPointCommitPublisherV1;
  readonly pointCommitFinishing: PointCommitFinishingTransitionPortV1;
  readonly executionClaims: Readonly<{
    readonly admission: Pick<
      PointMutationExecutionClaimVaultV1["admission"],
      "inspectStoredAttempt" | "consumeStoredAttempt"
    >;
  }>;
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
  readonly captureTransitionCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitFinishingTransitionCommandV1;
  readonly rebaseFinishingState: (
    state: PreparedPointCommitCapabilityStateV1,
    result: PointCommitFinishingTransitionResultV1,
  ) => Result.Result<
    PreparedPointCommitCapabilityStateV1,
    PointCommitCorruptionV1Error
  >;
  readonly capturePublicationCommand: (
    state: PreparedPointCommitCapabilityStateV1,
  ) => PointCommitPublicationCommandV1;
  readonly publishCapturedFinishingPointCommit:
    PublishCapturedFinishingPointCommitV1;
}

export interface StoredPointCommitFinishingTransitionOperationsV1 {
  readonly facade: StoredPointCommitFinishingTransitionV1;
  readonly lookupFinishingPreparedPointCommit: (
    input: unknown,
  ) => Result.Result<
    CapturedFinishingPreparedPointCommitV1,
    InvalidPreparedPointCommitV1Error
  >;
}

export function makeStoredPointCommitFinishingTransitionOperationsV1(
  dependencies: StoredPointCommitFinishingTransitionOperationDependenciesV1,
): StoredPointCommitFinishingTransitionOperationsV1 {
  const {
    base,
    pointCommitFinishing,
    executionClaims,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
    captureTransitionCommand,
    rebaseFinishingState,
    capturePublicationCommand,
    publishCapturedFinishingPointCommit,
  } = dependencies;

  const enterPointCommitFinishing:
    StoredPointCommitFinishingTransitionV1[
      "enterPointCommitFinishing"
    ] = Effect.fn(
      "StoredAttemptAuthentication.enterPointCommitFinishing",
    )(function* (input) {
      const state = lookupPreparedPointCommitState(
        preparedPointCommitStates,
        input,
      );
      if (state === undefined) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notSameFactory",
        }));
      }
      if (finishingPreparedPointCommitStates.has(input)) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "alreadyFinishing",
        }));
      }
      if (
        state.provenance.session.lifecycle !== "running" ||
        state.plan.sealIdentity.lifecycle !== "running"
      ) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "notRunning",
        }));
      }
      const executionClaim = state.provenance.executionClaim;
      if (executionClaim === null) {
        return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
          reason: "executionClaimUnavailable",
        }));
      }
      yield* Effect.fromResult(
        executionClaims.admission.inspectStoredAttempt(executionClaim).pipe(
          Result.mapError(() => new InvalidPreparedPointCommitV1Error({
            reason: "executionClaimUnavailable",
          })),
        ),
      );
      const result = yield* Effect.uninterruptible(
        pointCommitFinishing.enterFinishing(
          captureTransitionCommand(state),
        ).pipe(
          Effect.tap(() => Effect.fromResult(
            executionClaims.admission.consumeStoredAttempt(executionClaim).pipe(
              Result.mapError(() => new PointCommitCorruptionV1Error({
                reason: "finishingTransitionInvalid",
              })),
            ),
          )),
        ),
      );
      const continuedState = yield* Effect.fromResult(
        rebaseFinishingState(state, result),
      );
      return yield* Effect.fromResult(
        mintFinishingPreparedPointCommit(
          preparedPointCommitStates,
          finishingPreparedPointCommitStates,
          continuedState,
        ),
      );
    });

  const lookupFinishingPreparedPointCommit = (
    input: unknown,
  ): Result.Result<
    CapturedFinishingPreparedPointCommitV1,
    InvalidPreparedPointCommitV1Error
  > => {
    if (typeof input !== "object" || input === null) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    const prepared = preparedPointCommitStates.get(input);
    if (prepared === undefined) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    if (!finishingPreparedPointCommitStates.has(input)) {
      return Result.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notFinishing",
      }));
    }
    return Result.succeed(Object.freeze({
      // SAFETY: the membership check above proved input is a registered
      // finishing prepared-commit handle.
      finishing: input as FinishingPreparedPointCommitV1,
      prepared,
    }));
  };

  const publishPointCommit:
    StoredPointCommitFinishingTransitionV1["publishPointCommit"] = Effect.fn(
      "StoredAttemptAuthentication.publishFinishingPointCommitOnce",
    )(function* (input) {
      const captured = yield* Effect.fromResult(
        lookupFinishingPreparedPointCommit(input),
      );
      return yield* publishCapturedFinishingPointCommit(
        captured.finishing,
        captured.prepared,
        capturePublicationCommand(captured.prepared),
      );
    });

  return Object.freeze({
    facade: Object.freeze({
      ...base,
      enterPointCommitFinishing,
      publishPointCommit,
    } satisfies StoredPointCommitFinishingTransitionV1),
    lookupFinishingPreparedPointCommit,
  });
}

export interface StoredPointCommitFinishingRecoveryOperationDependenciesV1 {
  readonly finishingEvidenceLoader: StoredAttemptFinishingEvidenceLoaderPortV1;
  readonly mintAuthenticatedStoredAttempt: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => AuthenticatedStoredAttemptV1;
  readonly authenticateCommitAuthority:
    StoredPointCommitPlanningV1["authenticateCommitAuthority"];
  readonly verifyCommitInput: StoredPointCommitPlanningV1["verifyCommitInput"];
  readonly planPointCommit: StoredPointCommitPlanningV1["planPointCommit"];
  readonly preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ];
  readonly finishingPreparedPointCommitStates:
    StoredPointMutationCapabilityVaultV1[
      "finishingPreparedPointCommitStates"
    ];
}

export interface StoredPointCommitFinishingRecoveryOperationsV1 {
  readonly reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"];
  readonly reconstructPointCommitFinishingFromSelector: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    FinishingPreparedPointCommitV1,
    Exclude<
      PointCommitFinishingRecoveryV1Error,
      InvalidPointMutationSessionAttemptSelectorV1Error
    >,
    never
  >;
}

export function makeStoredPointCommitFinishingRecoveryOperationsV1(
  dependencies: StoredPointCommitFinishingRecoveryOperationDependenciesV1,
): StoredPointCommitFinishingRecoveryOperationsV1 {
  const {
    finishingEvidenceLoader,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    preparedPointCommitStates,
    finishingPreparedPointCommitStates,
  } = dependencies;

  const reconstructPointCommitFinishingFromSelector = Effect.fn(
    "StoredAttemptAuthentication.reconstructPointCommitFinishingFromSelector",
  )(function* (selector: PointMutationSessionAttemptSelectorV1) {
    const loadResult = yield* finishingEvidenceLoader.loadFinishingEffect(
      selector,
    ).pipe(Effect.mapError((error) =>
      new StoredAttemptPersistenceV1Error({ cause: error.cause })
    ));
    const evidence = yield*
      requireLoadedStoredAttemptEvidenceEffect(loadResult);
    const authority = yield* captureRecoveredAuthorityEffect(
      selector,
      evidence,
    );
    const storedAttemptState = yield* verifyCanonicalStoredEvidenceEffect(
      authority,
      evidence,
    );
    const storedAttempt = mintAuthenticatedStoredAttempt(storedAttemptState);
    const authenticatedAuthority = yield* authenticateCommitAuthority(
      storedAttempt,
    );
    const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
    const prepared = yield* planPointCommit(verifiedInput);
    const preparedState = lookupPreparedPointCommitState(
      preparedPointCommitStates,
      prepared,
    );
    if (preparedState === undefined) {
      return yield* Effect.fail(new InvalidPreparedPointCommitV1Error({
        reason: "notSameFactory",
      }));
    }
    return yield* Effect.fromResult(
      mintFinishingPreparedPointCommit(
        preparedPointCommitStates,
        finishingPreparedPointCommitStates,
        preparedState,
      ),
    );
  });

  const reconstructPointCommitFinishing:
    StoredPointCommitExecutorV1["reconstructPointCommitFinishing"] = Effect.fn(
      "StoredAttemptAuthentication.reconstructPointCommitFinishing",
    )(function* (input) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(input),
      );
      return yield* reconstructPointCommitFinishingFromSelector(selector);
    });

  return Object.freeze({
    reconstructPointCommitFinishing,
    reconstructPointCommitFinishingFromSelector,
  });
}

export interface StoredPointCommitExecutorOperationDependenciesV1 {
  readonly base: StoredPointCommitFinishingTransitionV1;
  readonly publishPointCommit: StoredPointCommitExecutorV1[
    "publishPointCommit"
  ];
  readonly reconstructPointCommitFinishing: StoredPointCommitExecutorV1[
    "reconstructPointCommitFinishing"
  ];
}

export function makeStoredPointCommitExecutorOperationsV1(
  dependencies: StoredPointCommitExecutorOperationDependenciesV1,
): StoredPointCommitExecutorV1 {
  const {
    base,
    publishPointCommit,
    reconstructPointCommitFinishing,
  } = dependencies;

  const finishPointCommit: StoredPointCommitExecutorV1["finishPointCommit"] =
    Effect.fn("StoredAttemptAuthentication.finishPointCommit")(
      function* (input) {
        const finishing = yield* base.enterPointCommitFinishing(input);
        return yield* publishPointCommit(finishing);
      },
    );

  const resumePointCommit: StoredPointCommitExecutorV1["resumePointCommit"] =
    Effect.fn("StoredAttemptAuthentication.resumePointCommit")(
      function* (selector) {
        const finishing = yield* reconstructPointCommitFinishing(selector);
        return yield* publishPointCommit(finishing);
      },
    );

  return Object.freeze({
    ...base,
    publishPointCommit,
    reconstructPointCommitFinishing,
    finishPointCommit,
    resumePointCommit,
  } satisfies StoredPointCommitExecutorV1);
}

function mintFinishingPreparedPointCommit(
  preparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "preparedPointCommitStates"
  ],
  finishingPreparedPointCommitStates: StoredPointMutationCapabilityVaultV1[
    "finishingPreparedPointCommitStates"
  ],
  state: PreparedPointCommitCapabilityStateV1,
): Result.Result<
  FinishingPreparedPointCommitV1,
  InvalidPreparedPointCommitV1Error
> {
  if (
    state.provenance.session.lifecycle !== "finishing" ||
    state.plan.sealIdentity.lifecycle !== "finishing"
  ) {
    return Result.fail(new InvalidPreparedPointCommitV1Error({
      reason: "notFinishing",
    }));
  }
  const handle = makeFinishingPreparedPointCommitHandleV1();
  preparedPointCommitStates.set(handle, state);
  finishingPreparedPointCommitStates.add(handle);
  return Result.succeed(handle);
}

function lookupPreparedPointCommitState(
  states: WeakMap<object, PreparedPointCommitCapabilityStateV1>,
  value: PreparedPointCommitV1,
): PreparedPointCommitCapabilityStateV1 | undefined {
  return typeof value === "object" && value !== null
    ? states.get(value)
    : undefined;
}

function capturePointCommitKnownSettledSqlRetryFailureV1(
  failure: PointCommitConfirmedPreDecisionRollbackV1Error,
): PointCommitKnownSettledSqlRetryFailureV1 {
  return Object.freeze({
    operation: failure.operation,
    sqlState: failure.sqlState,
    cause: failure.cause,
  });
}
