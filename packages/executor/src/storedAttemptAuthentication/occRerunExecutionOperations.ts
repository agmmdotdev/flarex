import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";

import type {
  CommittedPointOutcomeResolutionV1,
  PointCommitConflictV1Error,
  PointCommitPublicationResultV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type {
  StoredOccExecutionEvidenceAuthorityV1,
  StoredOccExecutionEvidenceLoaderV1,
  StoredOccExecutionEvidenceLoadResultV1,
  StoredOccExecutionEvidencePersistenceV1Error,
  StoredOccExecutionEvidenceV1,
} from "@flarex/persistence-postgres/stored-occ-execution";
import type { TransactionExecutionClaimPinV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";
import type { SnapshotToken } from "flarex-protocol/storage-authority";
import type {
  TransactionAttemptFence,
  TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

import type {
  InvalidPointMutationExecutionClaimV1Error,
  PointMutationExecutionClaimAdmissionV1,
  PointMutationExecutionScopeV1,
} from "../pointMutationExecutionClaim";
import type {
  PointMutationExecutionLivenessControlV1,
  PointMutationExecutionLivenessCoordinatorV1,
} from "../pointMutationExecutionClaimLiveness";
import type {
  LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../pointMutationSessionAttemptState";
import type {
  PointMutationOccRerunExecutionV1Error,
  StoredPointMutationOccRerunAuthorizationV1,
  StoredPointMutationOccRerunExecutionV1,
} from "../storedAttemptAuthentication";
import {
  PointMutationOccRerunAuthorityCorruptionV1Error,
  PointMutationOccRerunFreshAttemptV1Error,
  pointMutationOccFreshAttemptMismatch,
  type PointMutationOccRerunFreshAttemptMismatchV1,
} from "./attemptReplacementOperations";
import type {
  AuthorizedPointMutationOccRerunStateV1,
  PreparedPointCommitCapabilityStateV1,
} from "./capabilityState";
import type {
  CommitAuthorityVerificationStateV1,
  VerifiedCommitAuthorityEvidenceV1,
} from "./commitAuthorityVerification";
import type {
  StoredCommitAuthorityEvidencePortV1,
  StoredCommitAuthoritySessionEvidencePortV1,
} from "./commitAuthorityModel";
import type {
  ClaimAuthorizedPointMutationOccRerunV1,
  InvalidAuthorizedPointMutationOccRerunV1Error,
  ResolvePointMutationOccOutcomeV1,
} from "./occRerunAuthorizationOperations";

export class PointMutationOccExecutionEvidencePersistenceV1Error extends Data.TaggedError(
  "PointMutationOccExecutionEvidencePersistenceV1Error",
)<{
  readonly cause: unknown;
}> {}

export class PointMutationOccExecutionNotRunnableV1Error extends Data.TaggedError(
  "PointMutationOccExecutionNotRunnableV1Error",
)<{
  readonly reason: Extract<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "notExecutable" }
  >["reason"];
  readonly lifecycle?: TransactionSessionLifecycleV1;
}> {}

export class PointMutationOccExecutionAuthorityMismatchV1Error extends Data.TaggedError(
  "PointMutationOccExecutionAuthorityMismatchV1Error",
)<{
  readonly reason:
    | Extract<
        StoredOccExecutionEvidenceLoadResultV1,
        { readonly kind: "authorityMismatch" }
      >["reason"]
    | PointMutationOccRerunFreshAttemptMismatchV1;
}> {}

export class PointMutationOccExecutionAuthorityCorruptionV1Error extends Data.TaggedError(
  "PointMutationOccExecutionAuthorityCorruptionV1Error",
)<{
  readonly reason:
    | Extract<
        StoredOccExecutionEvidenceLoadResultV1,
        { readonly kind: "corrupt" }
      >["reason"]
    | "committedOutcomeMissing"
    | "loadedAttemptStateUnavailable"
    | "requestEvidenceInvalid"
    | "runtimePinInvalid";
  readonly cause?: unknown;
}> {}

export type PointMutationOccAttemptPublicationV1 =
  | Readonly<{
      readonly kind: "completed";
      readonly result: PointCommitPublicationResultV1;
    }>
  | Readonly<{
      readonly kind: "conflict";
      readonly error: PointCommitConflictV1Error;
    }>;

export interface ExecuteExactPointMutationAttemptInputV1<
  InspectionUnavailableError,
  CurrentValidationError,
> {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotToken: SnapshotToken;
  readonly executionScope: PointMutationExecutionScopeV1;
  readonly liveness: PointMutationExecutionLivenessControlV1;
  readonly executionEvidence: StoredOccExecutionEvidenceV1;
  readonly verificationState: CommitAuthorityVerificationStateV1;
  readonly verifiedEvidence: VerifiedCommitAuthorityEvidenceV1;
  readonly expectedRequestSha256?: Uint8Array;
  readonly currentInspectionUnavailable: () => InspectionUnavailableError;
  readonly validateCurrent: (
    current: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
  ) => Effect.Effect<void, CurrentValidationError>;
}

export type ExecuteExactPointMutationAttemptKernelV1<KernelError> = <
  InspectionUnavailableError,
  CurrentValidationError,
>(
  input: Readonly<
    ExecuteExactPointMutationAttemptInputV1<
      InspectionUnavailableError,
      CurrentValidationError
    >
  >,
) => Effect.Effect<
  PointMutationOccAttemptPublicationV1,
  KernelError | InspectionUnavailableError | CurrentValidationError,
  never
>;

export type VerifyCommitAuthorityEvidenceForOccExecutionV1<
  VerificationError,
> = (
  state: CommitAuthorityVerificationStateV1,
  evidence: StoredCommitAuthorityEvidencePortV1,
) => Effect.Effect<
  VerifiedCommitAuthorityEvidenceV1,
  VerificationError,
  never
>;

export type PublicationResultFromCommittedOutcomeV1 = (
  outcome: Exclude<
    CommittedPointOutcomeResolutionV1,
    { readonly kind: "missing" }
  >,
) => PointCommitPublicationResultV1;

export interface StoredPointMutationOccRerunExecutionDependenciesV1<
  VerificationError extends PointMutationOccRerunExecutionV1Error =
    PointMutationOccRerunExecutionV1Error,
  KernelError extends PointMutationOccRerunExecutionV1Error =
    PointMutationOccRerunExecutionV1Error,
> {
  readonly base: StoredPointMutationOccRerunAuthorizationV1;
  readonly claimAuthorizedPointMutationOccRerun:
    ClaimAuthorizedPointMutationOccRerunV1;
  readonly executionClaimAdmission: Pick<
    PointMutationExecutionClaimAdmissionV1,
    "admit" | "inspect"
  >;
  readonly executionLiveness: Pick<
    PointMutationExecutionLivenessCoordinatorV1,
    "run"
  >;
  readonly executionEvidence: Pick<
    StoredOccExecutionEvidenceLoaderV1,
    "loadEffect"
  >;
  readonly resolvePointMutationOccOutcome:
    ResolvePointMutationOccOutcomeV1;
  readonly verifyCommitAuthorityEvidence:
    VerifyCommitAuthorityEvidenceForOccExecutionV1<VerificationError>;
  readonly executeExactPointMutationAttempt:
    ExecuteExactPointMutationAttemptKernelV1<KernelError>;
  readonly publicationResultFromCommittedOutcome:
    PublicationResultFromCommittedOutcomeV1;
}

export function makeStoredPointMutationOccRerunExecutionOperationsV1<
  VerificationError extends PointMutationOccRerunExecutionV1Error,
  KernelError extends PointMutationOccRerunExecutionV1Error,
>(
  dependencies: StoredPointMutationOccRerunExecutionDependenciesV1<
    VerificationError,
    KernelError
  >,
): StoredPointMutationOccRerunExecutionV1 {
  const {
    base,
    claimAuthorizedPointMutationOccRerun,
    executionClaimAdmission,
    executionLiveness,
    executionEvidence,
    resolvePointMutationOccOutcome,
    verifyCommitAuthorityEvidence,
    executeExactPointMutationAttempt,
    publicationResultFromCommittedOutcome,
  } = dependencies;

  const claimAuthorizedPointMutationOccRerunForExecution = (
    input: unknown,
  ): Result.Result<
    Readonly<{
      readonly state: AuthorizedPointMutationOccRerunStateV1;
      readonly executionScope: PointMutationExecutionScopeV1;
    }>,
    | InvalidPointMutationExecutionClaimV1Error
    | InvalidAuthorizedPointMutationOccRerunV1Error
  > =>
    Result.gen(function* () {
      const state = yield* claimAuthorizedPointMutationOccRerun(input);
      const executionScope = yield* executionClaimAdmission.admit(
        state.executionClaim,
        "execute",
      );
      return Object.freeze({ state, executionScope });
    });

  const executeAuthorizedPointMutationOccRerun:
    StoredPointMutationOccRerunExecutionV1[
      "executeAuthorizedPointMutationOccRerun"
    ] = Effect.fn(
      "StoredAttemptAuthentication.executeAuthorizedPointMutationOccRerun",
    )(function* (input) {
      // The process-local B1 capability is irreversibly claimed before the
      // first asynchronous yield. Durable running/pristine state alone never
      // enters this operation.
      let claimedRerun = yield* Effect.fromResult(
        claimAuthorizedPointMutationOccRerunForExecution(input),
      );
      let rerunState = claimedRerun.state;
      let executionScope = claimedRerun.executionScope;

      while (true) {
        const initialOutcome = yield* resolvePointMutationOccOutcome(
          rerunState.prepared,
        );
        if (initialOutcome.kind !== "missing") {
          return publicationResultFromCommittedOutcome(initialOutcome);
        }

        const publication = yield* executionLiveness.run(
          executionScope,
          "execute",
          (liveness) => Effect.gen(function* () {
            const admittedClaim = yield* Effect.fromResult(
              executionClaimAdmission.inspect(executionScope, "execute"),
            );
            const executionAuthority = captureStoredOccExecutionAuthorityV1(
              rerunState,
              admittedClaim.observation,
            );
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
              const committedOutcome = yield* resolvePointMutationOccOutcome(
                rerunState.prepared,
              );
              if (committedOutcome.kind === "missing") {
                return yield* Effect.fail(
                  new PointMutationOccExecutionAuthorityCorruptionV1Error({
                    reason: "committedOutcomeMissing",
                  }),
                );
              }
              return Object.freeze({
                kind: "completed" as const,
                result: publicationResultFromCommittedOutcome(
                  committedOutcome,
                ),
              });
            }
            const loadedExecutionEvidence =
              yield* requireOccExecutionEvidenceEffect(loadResult);
            const verificationState = captureOccExecutionVerificationState(
              rerunState,
              loadedExecutionEvidence.session,
            );
            const verifiedEvidence = yield* verifyCommitAuthorityEvidence(
              verificationState,
              loadedExecutionEvidence,
            );
            return yield* executeExactPointMutationAttempt<
              PointMutationOccRerunAuthorityCorruptionV1Error,
              | PointMutationOccRerunFreshAttemptV1Error
              | PointMutationOccExecutionAuthorityMismatchV1Error
            >({
              selector: Object.freeze({
                deploymentId: rerunState.inspection.deploymentId,
                scopeId: rerunState.inspection.scopeId,
                sessionId: rerunState.inspection.sessionId,
                attemptFence: rerunState.inspection.attemptFence,
              }),
              attemptFence: rerunState.inspection.attemptFence,
              snapshotToken: rerunState.inspection.snapshotToken,
              executionScope,
              liveness,
              executionEvidence: loadedExecutionEvidence,
              verificationState,
              verifiedEvidence,
              expectedRequestSha256:
                rerunState.prepared.provenance.session.requestSha256,
              currentInspectionUnavailable: () =>
                new PointMutationOccRerunAuthorityCorruptionV1Error({
                  reason: "loadedAttemptStateUnavailable",
                }),
              validateCurrent: (currentInspection) => {
                const mismatch = pointMutationOccFreshAttemptMismatch(
                  rerunState.prepared,
                  rerunState.conflict,
                  rerunState.inspection.attemptFence,
                  currentInspection,
                );
                if (mismatch !== undefined) {
                  return Effect.fail(
                    new PointMutationOccRerunFreshAttemptV1Error({
                      reason: mismatch,
                    }),
                  );
                }
                return currentInspection.snapshotToken.scopeId ===
                      rerunState.inspection.snapshotToken.scopeId &&
                    currentInspection.snapshotToken.epoch ===
                      rerunState.inspection.snapshotToken.epoch &&
                    currentInspection.snapshotToken.commitSeq ===
                      rerunState.inspection.snapshotToken.commitSeq
                  ? Effect.void
                  : Effect.fail(
                      new PointMutationOccExecutionAuthorityMismatchV1Error({
                        reason: "snapshotChanged",
                      }),
                    );
              },
            });
          }),
        );
        if (publication.kind === "completed") return publication.result;

        const authorizationResult =
          yield* base.authorizePointMutationOccRerun(publication.error);
        if (authorizationResult.kind === "replayed") {
          return publicationResultFromCommittedOutcome(
            authorizationResult.outcome,
          );
        }
        if (authorizationResult.kind === "expired") {
          return publicationResultFromCommittedOutcome(
            authorizationResult.outcome,
          );
        }
        claimedRerun = yield* Effect.fromResult(
          claimAuthorizedPointMutationOccRerunForExecution(
            authorizationResult.rerun,
          ),
        );
        rerunState = claimedRerun.state;
        executionScope = claimedRerun.executionScope;
      }
    });

  return Object.freeze({
    ...base,
    executeAuthorizedPointMutationOccRerun,
  } satisfies StoredPointMutationOccRerunExecutionV1);
}

export const requireOccExecutionEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireOccExecutionEvidence",
)(function* (
  result: Exclude<
    StoredOccExecutionEvidenceLoadResultV1,
    { readonly kind: "alreadyCommitted" }
  >,
) {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "notExecutable":
      return yield* Effect.fail(
        new PointMutationOccExecutionNotRunnableV1Error({
          reason: result.reason,
          ...(result.lifecycle === undefined
            ? {}
            : { lifecycle: result.lifecycle }),
        }),
      );
    case "authorityMismatch":
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityMismatchV1Error({
          reason: result.reason,
        }),
      );
    case "corrupt":
      return yield* Effect.fail(
        new PointMutationOccExecutionAuthorityCorruptionV1Error({
          reason: result.reason,
          ...(result.cause === undefined ? {} : { cause: result.cause }),
        }),
      );
  }
});

function captureStoredOccExecutionAuthorityV1(
  state: AuthorizedPointMutationOccRerunStateV1,
  executionClaim: TransactionExecutionClaimPinV1,
): StoredOccExecutionEvidenceAuthorityV1 {
  const pins = state.prepared.plan.authorityPins;
  const previousSession = state.prepared.provenance.session;
  return Object.freeze({
    kind: "occRerun",
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    scopeUuid: state.prepared.plan.sealIdentity.scopeUuid,
    sessionId: pins.sessionId,
    attemptFence: state.inspection.attemptFence,
    storageGeneration: pins.storageGeneration,
    storageGenerationFence: pins.storageGenerationFence,
    snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
    schemaVersionId: pins.schemaVersionId,
    executionClaim: Object.freeze({
      claimOwner: executionClaim.claimOwner,
      claimFence: executionClaim.claimFence,
    }),
    previousSession: Object.freeze({
      ...previousSession,
      identityAccessPolicySha256: copyBytes(
        previousSession.identityAccessPolicySha256,
      ),
      validatedArgsSha256: copyBytes(previousSession.validatedArgsSha256),
      authorizationGrantSha256: copyBytes(
        previousSession.authorizationGrantSha256,
      ),
      requestSha256: copyBytes(previousSession.requestSha256),
    }),
  });
}

function captureOccExecutionVerificationState(
  state: AuthorizedPointMutationOccRerunStateV1,
  session: StoredCommitAuthoritySessionEvidencePortV1,
): CommitAuthorityVerificationStateV1 {
  const pins = state.prepared.plan.authorityPins;
  return Object.freeze({
    authority: Object.freeze({
      deploymentId: pins.deploymentId,
      scopeId: pins.scopeId,
      sessionId: pins.sessionId,
      attemptFence: state.inspection.attemptFence,
      storageGeneration: pins.storageGeneration,
      storageGenerationFence: pins.storageGenerationFence,
      snapshotToken: Object.freeze({ ...state.inspection.snapshotToken }),
      schemaVersionId: pins.schemaVersionId,
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
