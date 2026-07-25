import { copyBytes } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";

import {
  PointCommitCorruptionV1Error,
  type CommittedPointOutcomeResolutionV1,
  type PointCommitOutcomeResolutionV1Error,
  type PointCommitPublicationResultV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type {
  StoredOccExecutionEvidenceAuthorityV1,
  StoredOccExecutionEvidenceLoaderV1,
  StoredOccExecutionEvidencePersistenceV1Error,
} from "@flarex/persistence-postgres/stored-occ-execution";
import {
  PointMutationExecutionClaimAcquisitionInputV1Error,
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  type PointMutationExecutionClaimAcquisitionV1Error,
  type PointMutationSessionAttemptSelectorV1,
} from
  "@flarex/persistence-postgres/transaction-session-activation";
import type {
  PointMutationExecutionClaimDispatchAcquisitionV1,
  PointMutationExecutionClaimDispatchAcquisitionResultV1,
} from "../pointMutationExecutionClaimAcquisition";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";

import {
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationAbortOnlyClaimStateV1,
  type PointMutationAbortOnlyScopeV1,
  type PointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
  type PointMutationExecutionWorkClaimStateV1,
} from "../pointMutationExecutionClaim";
import type {
  PointMutationExecutionLivenessCoordinatorV1,
} from "../pointMutationExecutionClaimLiveness";
import type {
  PointMutationSessionAttemptDispositionV1,
} from "../pointMutationSessionAttemptDisposition";
import {
  PointMutationSessionAttemptTerminalizationContractV1Error,
  type PointMutationSessionAttemptLoadingV1,
  type PointMutationSessionAttemptTerminalizationV1,
} from "../pointMutationSessionActivation";
import type {
  LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../pointMutationSessionAttemptState";
import {
  decodePointMutationSessionAttemptSelectorV1Result,
} from "../pointMutationSessionAttemptSelector";
import type {
  AuthenticatedStoredAttemptStateV1,
  PointMutationCrashRedispatchResultV1,
  PointMutationCrashRedispatchV1Error,
  PointMutationInitialExecutionV1,
  StoredAttemptAuthorityStateV1,
  StoredAttemptAuthenticationV1,
  StoredPointCommitExecutorV1,
  StoredPointCommitFinishingTransitionV1,
  StoredPointCommitPlanningV1,
  StoredPointMutationCrashRedispatchV1,
} from "../storedAttemptAuthentication";
import type {
  AuthenticatedStoredAttemptV1,
  TrustedStoredAttemptAuthorityV1,
} from "./authenticationOperations";
import { InvalidStoredAttemptAuthorityV1Error } from "./authenticationErrors";
import type {
  PointMutationOccRerunFreshAttemptMismatchV1,
} from "./attemptReplacementOperations";
import type {
  CommitAuthorityVerificationStateV1,
  VerifiedCommitAuthorityEvidenceV1,
} from "./commitAuthorityVerification";
import type {
  StoredCommitAuthorityEvidencePortV1,
  StoredCommitAuthoritySessionEvidencePortV1,
} from "./commitAuthorityModel";
import {
  PointMutationOccExecutionAuthorityCorruptionV1Error,
  PointMutationOccExecutionAuthorityMismatchV1Error,
  PointMutationOccExecutionEvidencePersistenceV1Error,
  requireOccExecutionEvidenceEffect,
  type ExecuteExactPointMutationAttemptKernelV1,
  type VerifyCommitAuthorityEvidenceForOccExecutionV1,
} from "./occRerunExecutionOperations";

type PointMutationRedispatchAcquisitionOrClosedV1 =
  | Readonly<{
      readonly kind: "acquisition";
      readonly acquisition:
        PointMutationExecutionClaimDispatchAcquisitionResultV1;
    }>
  | Readonly<{
      readonly kind: "closed";
      readonly result: Extract<
        PointMutationCrashRedispatchResultV1,
        Readonly<{
          readonly kind: "closed";
          readonly reason: "authorityExpired";
        }>
      >;
    }>;

export type ResolvePointCommitOutcomeFromStoredSessionV1 = (
  deploymentId: StoredAttemptAuthorityStateV1["deploymentId"],
  scopeUuid: ReturnType<typeof projectScopeIdUuidV1>["scopeUuid"],
  session: StoredCommitAuthoritySessionEvidencePortV1,
) => Effect.Effect<
  CommittedPointOutcomeResolutionV1,
  PointCommitOutcomeResolutionV1Error,
  never
>;

export type PublicationResultFromCommittedOutcomeV1 = (
  outcome: Exclude<
    CommittedPointOutcomeResolutionV1,
    { readonly kind: "missing" }
  >,
) => PointCommitPublicationResultV1;

export interface StoredPointMutationCrashRedispatchDependenciesV1<
  AuthorityCapability,
  StoredEvidenceError extends PointMutationCrashRedispatchV1Error =
    PointMutationCrashRedispatchV1Error,
  VerificationError extends PointMutationCrashRedispatchV1Error =
    PointMutationCrashRedispatchV1Error,
  KernelError extends PointMutationCrashRedispatchV1Error =
    PointMutationCrashRedispatchV1Error,
> {
  readonly base: PointMutationInitialExecutionV1;
  readonly acquisition: PointMutationExecutionClaimDispatchAcquisitionV1;
  readonly disposition: Pick<
    PointMutationSessionAttemptDispositionV1,
    "disposeAbortOnly"
  >;
  readonly executionClaims: Pick<
    PointMutationExecutionClaimVaultV1,
    "admission" | "abortOnlyAdmission"
  >;
  readonly attemptLoading: Pick<
    PointMutationSessionAttemptLoadingV1,
    "load"
  >;
  readonly terminalization: Pick<
    PointMutationSessionAttemptTerminalizationV1,
    "expire"
  >;
  readonly executionLiveness: Pick<
    PointMutationExecutionLivenessCoordinatorV1,
    "run"
  >;
  readonly executionEvidence: Pick<
    StoredOccExecutionEvidenceLoaderV1,
    "loadEffect"
  >;
  readonly deriveAuthority: StoredAttemptAuthenticationV1["deriveAuthority"];
  readonly lookupAuthority: (
    authority: TrustedStoredAttemptAuthorityV1,
  ) => AuthorityCapability | undefined;
  readonly loadAndVerifyStoredEvidence: (
    authority: AuthorityCapability,
  ) => Effect.Effect<
    Readonly<{ readonly verified: AuthenticatedStoredAttemptStateV1 }>,
    StoredEvidenceError,
    never
  >;
  readonly mintAuthenticatedStoredAttempt: (
    state: AuthenticatedStoredAttemptStateV1,
  ) => AuthenticatedStoredAttemptV1;
  readonly authenticateCommitAuthority:
    StoredPointCommitPlanningV1["authenticateCommitAuthority"];
  readonly verifyCommitInput:
    StoredPointCommitPlanningV1["verifyCommitInput"];
  readonly planPointCommit:
    StoredPointCommitPlanningV1["planPointCommit"];
  readonly enterPointCommitFinishing:
    StoredPointCommitFinishingTransitionV1["enterPointCommitFinishing"];
  readonly publishFinishingPointCommit:
    StoredPointCommitExecutorV1["publishPointCommit"];
  readonly resumePointCommit:
    StoredPointCommitExecutorV1["resumePointCommit"];
  readonly verifyCommitAuthorityEvidence:
    VerifyCommitAuthorityEvidenceForOccExecutionV1<VerificationError>;
  readonly executeExactPointMutationAttempt:
    ExecuteExactPointMutationAttemptKernelV1<KernelError>;
  readonly resolvePointCommitOutcomeFromStoredSession:
    ResolvePointCommitOutcomeFromStoredSessionV1;
  readonly publicationResultFromCommittedOutcome:
    PublicationResultFromCommittedOutcomeV1;
}

export function makeStoredPointMutationCrashRedispatchOperationsV1<
  AuthorityCapability extends Readonly<{
    readonly authority: StoredAttemptAuthorityStateV1;
  }>,
  StoredEvidenceError extends PointMutationCrashRedispatchV1Error,
  VerificationError extends PointMutationCrashRedispatchV1Error,
  KernelError extends PointMutationCrashRedispatchV1Error,
>(
  dependencies: StoredPointMutationCrashRedispatchDependenciesV1<
    AuthorityCapability,
    StoredEvidenceError,
    VerificationError,
    KernelError
  >,
): StoredPointMutationCrashRedispatchV1 {
  const {
    base,
    acquisition,
    disposition,
    executionClaims,
    attemptLoading,
    terminalization,
    executionLiveness,
    executionEvidence,
    deriveAuthority,
    lookupAuthority,
    loadAndVerifyStoredEvidence,
    mintAuthenticatedStoredAttempt,
    authenticateCommitAuthority,
    verifyCommitInput,
    planPointCommit,
    enterPointCommitFinishing,
    publishFinishingPointCommit,
    resumePointCommit,
    verifyCommitAuthorityEvidence,
    executeExactPointMutationAttempt,
    resolvePointCommitOutcomeFromStoredSession,
    publicationResultFromCommittedOutcome,
  } = dependencies;

  const admitRedispatchClaim = (
    claim: unknown,
    mode: "execute" | "finishOnly",
  ): Result.Result<
    Readonly<{
      readonly scope: PointMutationExecutionScopeV1;
      readonly state: PointMutationExecutionWorkClaimStateV1;
    }>,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    Result.gen(function* () {
      const scope = yield* executionClaims.admission.admit(claim, mode);
      const state = yield* executionClaims.admission.inspect(scope, mode);
      return Object.freeze({ scope, state });
    });

  const admitRedispatchAbortOnlyClaim = (
    claim: unknown,
  ): Result.Result<
    Readonly<{
      readonly scope: PointMutationAbortOnlyScopeV1;
      readonly state: PointMutationAbortOnlyClaimStateV1;
    }>,
    InvalidPointMutationExecutionClaimV1Error
  > =>
    Result.gen(function* () {
      const scope = yield* executionClaims.abortOnlyAdmission.admit(claim);
      const state = yield* executionClaims.abortOnlyAdmission.inspect(scope);
      return Object.freeze({ scope, state });
    });

  const loadRedispatchAttemptAuthority = Effect.fn(
    "StoredAttemptAuthentication.loadRedispatchAttemptAuthority",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    const loadedAttempt = yield* attemptLoading.load({
      ...selector,
      attemptFence: selector.attemptFence.toString(),
    });
    const authorityHandle = yield* deriveAuthority(
      loadedAttempt,
      executionScope,
    );
    const authorityCapability = lookupAuthority(authorityHandle);
    if (authorityCapability === undefined) {
      return yield* Effect.fail(new InvalidStoredAttemptAuthorityV1Error({
        reason: "notProcessLocal",
      }));
    }
    return Object.freeze({ loadedAttempt, authorityCapability });
  });

  const finishClaimedSealedAttempt = Effect.fn(
    "StoredAttemptAuthentication.finishClaimedSealedAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    return yield* executionLiveness.run(
      executionScope,
      "finishOnly",
      (liveness) => Effect.gen(function* () {
        const { authorityCapability } = yield*
          loadRedispatchAttemptAuthority(selector, executionScope);
        const { verified } = yield* loadAndVerifyStoredEvidence(
          authorityCapability,
        );
        const storedAttempt = mintAuthenticatedStoredAttempt(verified);
        const authenticatedAuthority = yield* authenticateCommitAuthority(
          storedAttempt,
        );
        const verifiedInput = yield* verifyCommitInput(authenticatedAuthority);
        const runningPlan = yield* planPointCommit(verifiedInput);
        const finishingPlan = yield* liveness.enterFinishing(
          enterPointCommitFinishing(runningPlan),
        );
        return yield* publishFinishingPointCommit(finishingPlan);
      }),
    );
  });

  const disposeClaimedAbortOnlyAttempt = Effect.fn(
    "StoredAttemptAuthentication.disposeClaimedAbortOnlyAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationAbortOnlyScopeV1,
    reason: "dirtyOpen" | "failedRoot",
  ) {
    const loadedAttempt = yield* attemptLoading.load({
      ...selector,
      attemptFence: selector.attemptFence.toString(),
    });
    const disposed = yield* disposition.disposeAbortOnly(
      loadedAttempt,
      executionScope,
    );
    return Object.freeze({
      kind: "closed" as const,
      reason,
      lifecycle: disposed.terminal.lifecycle,
      terminalizedAt: disposed.terminal.terminalizedAt,
    });
  });

  const closeExpiredRedispatchAttempt = Effect.fn(
    "StoredAttemptAuthentication.closeExpiredRedispatchAttempt",
  )(function* (selectorInput: unknown) {
    const expired = yield* terminalization.expire(selectorInput);
    if (expired.terminal.lifecycle !== "expired") {
      return yield* Effect.fail(
        new PointMutationSessionAttemptTerminalizationContractV1Error({
          reason: "invalidStatusOrLifecycle",
        }),
      );
    }
    return Object.freeze({
      kind: "closed" as const,
      reason: "authorityExpired" as const,
      lifecycle: "expired" as const,
      terminalizedAt: expired.terminal.terminalizedAt,
    });
  });

  const acquireRedispatchAttemptOrCloseExpired = Effect.fn(
    "StoredAttemptAuthentication.acquireRedispatchAttemptOrCloseExpired",
  )(function* (
    selectorInput: unknown,
  ): Effect.fn.Return<
    PointMutationRedispatchAcquisitionOrClosedV1,
    | PointMutationExecutionClaimAcquisitionV1Error
    | PointMutationCrashRedispatchV1Error
  > {
    return yield* acquisition.acquireEffect(selectorInput).pipe(
      Effect.map((result): PointMutationRedispatchAcquisitionOrClosedV1 =>
        Object.freeze({ kind: "acquisition" as const, acquisition: result })
      ),
      Effect.catch((error): Effect.Effect<
        PointMutationRedispatchAcquisitionOrClosedV1,
        | PointMutationExecutionClaimAcquisitionV1Error
        | PointMutationCrashRedispatchV1Error
      > =>
        error instanceof PointMutationExecutionClaimAcquisitionStaleV1Error &&
          (error.reason === "leaseExpired" ||
            error.reason === "authorizationExpired")
          ? closeExpiredRedispatchAttempt(selectorInput).pipe(
              Effect.map((result) => Object.freeze({
                kind: "closed" as const,
                result,
              })),
            )
          : Effect.fail(error)
      ),
    );
  });

  const executeClaimedPristineAttempt = Effect.fn(
    "StoredAttemptAuthentication.executeClaimedPristineAttempt",
  )(function* (
    selector: PointMutationSessionAttemptSelectorV1,
    executionScope: PointMutationExecutionScopeV1,
  ) {
    return yield* executionLiveness.run(
      executionScope,
      "execute",
      (liveness) => Effect.gen(function* () {
        const { authorityCapability } =
          yield* loadRedispatchAttemptAuthority(selector, executionScope);
        const authority = authorityCapability.authority;
        if (authority.executionClaim === undefined) {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "executionClaimInvalid",
            }),
          );
        }
        const executionAuthority: StoredOccExecutionEvidenceAuthorityV1 =
          Object.freeze({
            kind: "claimedAttempt",
            deploymentId: authority.deploymentId,
            scopeId: authority.scopeId,
            scopeUuid: projectScopeIdUuidV1(authority.scopeId).scopeUuid,
            sessionId: authority.sessionId,
            attemptFence: authority.attemptFence,
            storageGeneration: authority.storageGeneration,
            storageGenerationFence: authority.storageGenerationFence,
            snapshotToken: Object.freeze({ ...authority.snapshotToken }),
            schemaVersionId: authority.schemaVersionId,
            executionClaim: Object.freeze({ ...authority.executionClaim }),
          });
        const loadResult = yield* executionEvidence
          .loadEffect(executionAuthority)
          .pipe(
            Effect.mapError(
              (error: StoredOccExecutionEvidencePersistenceV1Error) =>
                new PointMutationOccExecutionEvidencePersistenceV1Error({
                  cause: error.cause,
                }),
            ),
          );
        if (loadResult.kind === "alreadyCommitted") {
          return yield* Effect.fail(
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "committedOutcomeMissing",
            }),
          );
        }
        const storedExecutionEvidence = yield*
          requireOccExecutionEvidenceEffect(loadResult);
        const verificationState = captureClaimedExecutionVerificationState(
          authority,
          storedExecutionEvidence.session,
        );
        const verifiedEvidence = yield* verifyCommitAuthorityEvidence(
          verificationState,
          storedExecutionEvidence,
        );

        // Acquisition was outcome-first. Recheck after CPU verification and
        // before the final O03 liveness reload so no stored success is rerun.
        const outcome = yield* resolvePointCommitOutcomeFromStoredSession(
          authority.deploymentId,
          executionAuthority.scopeUuid,
          storedExecutionEvidence.session,
        );
        if (outcome.kind !== "missing") {
          return publicationResultFromCommittedOutcome(outcome);
        }

        const publication = yield* executeExactPointMutationAttempt<
          PointMutationOccExecutionAuthorityCorruptionV1Error,
          PointMutationOccExecutionAuthorityMismatchV1Error
        >({
          selector,
          attemptFence: authority.attemptFence,
          snapshotToken: authority.snapshotToken,
          executionScope,
          liveness,
          executionEvidence: storedExecutionEvidence,
          verificationState,
          verifiedEvidence,
          currentInspectionUnavailable: () =>
            new PointMutationOccExecutionAuthorityCorruptionV1Error({
              reason: "loadedAttemptStateUnavailable",
            }),
          validateCurrent: (current) =>
            validateClaimedCurrentAttempt(
              authority,
              storedExecutionEvidence.session,
              current,
            ),
        });
        if (publication.kind === "conflict") {
          return yield* Effect.fail(publication.error);
        }
        return publication.result;
      }),
    );
  });

  const resumeRedispatchedFinishingAttempt = Effect.fn(
    "StoredAttemptAuthentication.resumeRedispatchedFinishingAttempt",
  )(function* (selectorInput: unknown) {
    return yield* resumePointCommit(selectorInput).pipe(
      Effect.catchTag("StoredAttemptAlreadyCommittedV1Error", () =>
        Effect.gen(function* () {
          const reacquired = yield* acquisition.acquireEffect(selectorInput);
          if (reacquired.kind === "replayed") {
            return publicationResultFromCommittedOutcome(reacquired.outcome);
          }
          return yield* Effect.fail(new PointCommitCorruptionV1Error({
            reason: "committedOutcomeMissing",
          }));
        })),
    );
  });

  const redispatchExactPointMutationAttempt:
    StoredPointMutationCrashRedispatchV1[
      "redispatchExactPointMutationAttempt"
    ] = Effect.fn(
      "StoredAttemptAuthentication.redispatchExactPointMutationAttempt",
    )(function* (selectorInput) {
      const selector = yield* Effect.fromResult(
        decodePointMutationSessionAttemptSelectorV1Result(selectorInput).pipe(
          Result.mapError((cause) =>
            new PointMutationExecutionClaimAcquisitionInputV1Error({
              reason: "invalidSelector",
              cause,
            })
          ),
        ),
      );
      const ownedSelectorInput = Object.freeze({
        deploymentId: selector.deploymentId,
        scopeId: selector.scopeId,
        sessionId: selector.sessionId,
        attemptFence: selector.attemptFence.toString(),
      });
      const acquisitionOrClosed = yield*
        acquireRedispatchAttemptOrCloseExpired(ownedSelectorInput);
      if (acquisitionOrClosed.kind === "closed") {
        return acquisitionOrClosed.result;
      }
      const acquired = acquisitionOrClosed.acquisition;
      switch (acquired.kind) {
        case "replayed":
          return publicationResultFromCommittedOutcome(acquired.outcome);
        case "busy":
          return Object.freeze({ kind: "busy" as const });
        case "finishing":
          // The acquisition result grants nothing. C05-B independently loads
          // finishing + sealed + no-claim evidence before minting authority.
          return yield* resumeRedispatchedFinishingAttempt(ownedSelectorInput);
        case "acquired": {
          switch (acquired.mode) {
            case "execute": {
              // Synchronously and irreversibly consume the same-factory claim
              // before the next asynchronous yield.
              const admitted = yield* Effect.fromResult(
                admitRedispatchClaim(acquired.executionClaim, "execute"),
              );
              return yield* executeClaimedPristineAttempt(
                admitted.state.selector,
                admitted.scope,
              );
            }
            case "finishOnly": {
              const admitted = yield* Effect.fromResult(
                admitRedispatchClaim(acquired.executionClaim, "finishOnly"),
              );
              return yield* finishClaimedSealedAttempt(
                admitted.state.selector,
                admitted.scope,
              );
            }
            case "abortOnly": {
              const admitted = yield* Effect.fromResult(
                admitRedispatchAbortOnlyClaim(acquired.executionClaim),
              );
              return yield* disposeClaimedAbortOnlyAttempt(
                admitted.state.selector,
                admitted.scope,
                admitted.state.reason,
              );
            }
          }
        }
      }
    });

  return Object.freeze({
    ...base,
    redispatchExactPointMutationAttempt,
  } satisfies StoredPointMutationCrashRedispatchV1);
}

function captureClaimedExecutionVerificationState(
  authority: StoredAttemptAuthorityStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
): CommitAuthorityVerificationStateV1 {
  return Object.freeze({
    authority: Object.freeze({
      deploymentId: authority.deploymentId,
      scopeId: authority.scopeId,
      sessionId: authority.sessionId,
      attemptFence: authority.attemptFence,
      storageGeneration: authority.storageGeneration,
      storageGenerationFence: authority.storageGenerationFence,
      snapshotToken: Object.freeze({ ...authority.snapshotToken }),
      schemaVersionId: authority.schemaVersionId,
    }),
    session: Object.freeze({
      ...session,
      identityAccessPolicySha256: copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
  });
}

function validateClaimedCurrentAttempt(
  authority: StoredAttemptAuthorityStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
  current: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
): Effect.Effect<
  void,
  PointMutationOccExecutionAuthorityMismatchV1Error
> {
  let reason: PointMutationOccRerunFreshAttemptMismatchV1 | undefined;
  if (current.selector.deploymentId !== authority.deploymentId) {
    reason = "deployment";
  } else if (current.selector.scopeId !== authority.scopeId) {
    reason = "scope";
  } else if (current.selector.sessionId !== authority.sessionId) {
    reason = "session";
  } else if (current.selector.attemptFence !== authority.attemptFence) {
    reason = "attemptFence";
  } else if (current.storageGeneration !== authority.storageGeneration) {
    reason = "storageGeneration";
  } else if (
    current.storageGenerationFence !== authority.storageGenerationFence
  ) {
    reason = "storageGenerationFence";
  } else if (current.snapshotToken.epoch !== authority.snapshotToken.epoch) {
    reason = "epoch";
  } else if (current.schemaVersionId !== authority.schemaVersionId) {
    reason = "schema";
  } else if (current.requestKey !== session.requestKey) {
    reason = "requestKey";
  } else if (current.attemptFacet.kind !== "pristineOpen") {
    reason = "attemptNotPristine";
  }
  if (reason !== undefined) {
    return Effect.fail(
      new PointMutationOccExecutionAuthorityMismatchV1Error({ reason }),
    );
  }
  return current.snapshotToken.scopeId === authority.snapshotToken.scopeId &&
      current.snapshotToken.commitSeq === authority.snapshotToken.commitSeq
    ? Effect.void
    : Effect.fail(new PointMutationOccExecutionAuthorityMismatchV1Error({
        reason: "snapshotChanged",
      }));
}
