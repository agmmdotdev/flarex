import { copyBytes } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Data, Effect, Result } from "effect";

import type {
  StoredOccExecutionEvidenceAuthorityV1,
  StoredOccExecutionEvidenceLoaderV1,
  StoredOccExecutionEvidencePersistenceV1Error,
} from "@flarex/persistence-postgres/stored-occ-execution";
import type {
  TransactionExecutionClaimPinV1,
} from "@flarex/persistence-postgres/transaction-execution-claim";
import type {
  PointMutationSessionAnchorV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  type StoredTransactionSessionScalarsV1,
} from "flarex-protocol/transaction-session";

import type {
  PointMutationExecutionClaimAdmissionV1,
} from "../pointMutationExecutionClaim";
import type {
  PointMutationExecutionLivenessCoordinatorV1,
} from "../pointMutationExecutionClaimLiveness";
import {
  ActivatedPointMutationSessionBusyV1Error,
  InvalidActivatedPointMutationSessionV1Error,
  type ActivatedPointMutationSessionV1,
} from "../pointMutationSessionActivation";
import {
  getActivatedPointMutationSessionStateV1,
  type ActivatedPointMutationSessionStateV1,
} from "../pointMutationSessionActivationState";
import type {
  LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "../pointMutationSessionAttemptState";
import type {
  PointMutationInitialExecutionV1,
  PointMutationInitialExecutionV1Error,
  StoredAttemptSessionScalarsPortV1,
} from "../storedAttemptAuthentication";
import type {
  CommitAuthorityVerificationStateV1,
} from "./commitAuthorityVerification";
import {
  PointMutationOccExecutionAuthorityCorruptionV1Error,
  PointMutationOccExecutionEvidencePersistenceV1Error,
  type ExecuteExactPointMutationAttemptKernelV1,
  type PublicationResultFromCommittedOutcomeV1,
  type VerifyCommitAuthorityEvidenceForOccExecutionV1,
  requireOccExecutionEvidenceEffect,
} from "./occRerunExecutionOperations";

export class PointMutationInitialExecutionAuthorityV1Error
  extends Data.TaggedError("PointMutationInitialExecutionAuthorityV1Error")<{
    readonly reason:
      | "activatedStateChanged"
      | "alreadyCommitted"
      | "timestampInvalid";
  }> {}

export interface InitialPointMutationExecutionOperationDependenciesV1<
  VerificationError extends PointMutationInitialExecutionV1Error,
  KernelError extends PointMutationInitialExecutionV1Error,
> {
  readonly rerun: Pick<
    PointMutationInitialExecutionV1,
    | "authorizePointMutationOccRerun"
    | "executeAuthorizedPointMutationOccRerun"
  >;
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
  readonly verifyCommitAuthorityEvidence:
    VerifyCommitAuthorityEvidenceForOccExecutionV1<VerificationError>;
  readonly executeExactPointMutationAttempt:
    ExecuteExactPointMutationAttemptKernelV1<KernelError>;
  readonly publicationResultFromCommittedOutcome:
    PublicationResultFromCommittedOutcomeV1;
}

interface CreatedActivatedPointMutationSessionStateV1 {
  readonly inspection: Extract<
    ActivatedPointMutationSessionStateV1["inspection"],
    { readonly status: "created" }
  >;
  readonly prepared: ActivatedPointMutationSessionStateV1["prepared"];
  readonly executionClaim: NonNullable<
    ActivatedPointMutationSessionStateV1["executionClaim"]
  >;
}

export function makeInitialPointMutationExecutionOperationsV1<
  VerificationError extends PointMutationInitialExecutionV1Error,
  KernelError extends PointMutationInitialExecutionV1Error,
>(
  dependencies: InitialPointMutationExecutionOperationDependenciesV1<
    VerificationError,
    KernelError
  >,
): Pick<PointMutationInitialExecutionV1, "executeInitialPointMutationAttempt"> {
  const {
    rerun,
    executionClaimAdmission,
    executionLiveness,
    executionEvidence,
    verifyCommitAuthorityEvidence,
    executeExactPointMutationAttempt,
    publicationResultFromCommittedOutcome,
  } = dependencies;

  const executeInitialPointMutationAttempt:
    PointMutationInitialExecutionV1["executeInitialPointMutationAttempt"] =
      Effect.fn(
        "StoredAttemptAuthentication.executeInitialPointMutationAttempt",
      )(function* (activated) {
        // The activation's original process-local claim is consumed before the
        // first asynchronous yield. A serialized selector or stored row never
        // enters the initial execution boundary.
        const activatedState = yield* Effect.fromResult(
          inspectActivatedInitialState(activated),
        );
        const executionScope = yield* Effect.fromResult(
          executionClaimAdmission.admit(
            activatedState.executionClaim,
            "execute",
          ),
        );
        const claim = yield* Effect.fromResult(
          executionClaimAdmission.inspect(executionScope, "execute"),
        );
        const anchor = activatedState.inspection.anchor;
        yield* Effect.fromResult(
          validateActivationClaim(anchor, claim.selector),
        );

        const publication = yield* executionLiveness.run(
          executionScope,
          "execute",
          (liveness) =>
            Effect.gen(function* () {
              const executionAuthority = captureInitialExecutionAuthority(
                activatedState,
                claim.observation,
              );
              const loadResult = yield* executionEvidence
                .loadEffect(executionAuthority)
                .pipe(
                  Effect.mapError(
                    (
                      error: StoredOccExecutionEvidencePersistenceV1Error,
                    ) =>
                      new PointMutationOccExecutionEvidencePersistenceV1Error({
                        cause: error.cause,
                      }),
                  ),
                );
              if (loadResult.kind === "alreadyCommitted") {
                return yield* Effect.fail(
                  new PointMutationInitialExecutionAuthorityV1Error({
                    reason: "alreadyCommitted",
                  }),
                );
              }
              const loadedExecutionEvidence =
                yield* requireOccExecutionEvidenceEffect(loadResult);
              const verificationState = yield* Effect.fromResult(
                captureInitialVerificationState(activatedState),
              );
              const verifiedEvidence = yield* verifyCommitAuthorityEvidence(
                verificationState,
                loadedExecutionEvidence,
              );
              return yield* executeExactPointMutationAttempt({
                selector: Object.freeze({
                  deploymentId: anchor.deploymentId,
                  scopeId: anchor.scopeId,
                  sessionId: anchor.sessionId,
                  attemptFence: anchor.attemptFence,
                }),
                attemptFence: anchor.attemptFence,
                snapshotToken: Object.freeze({ ...anchor.snapshotToken }),
                executionScope,
                executionClaim: claim.observation,
                liveness,
                executionEvidence: loadedExecutionEvidence,
                verificationState,
                verifiedEvidence,
                expectedRequestSha256:
                  activatedState.prepared.evidence.requestSha256,
                currentInspectionUnavailable: () =>
                  new PointMutationOccExecutionAuthorityCorruptionV1Error({
                    reason: "loadedAttemptStateUnavailable",
                  }),
                validateCurrent: (current) =>
                  validateCurrentInitialAttempt(activatedState, current),
              });
            }),
        );

        if (publication.kind === "completed") return publication.result;
        const authorization = yield* rerun.authorizePointMutationOccRerun(
          publication.error,
        );
        switch (authorization.kind) {
          case "replayed":
          case "expired":
            return publicationResultFromCommittedOutcome(
              authorization.outcome,
            );
          case "authorized":
            return yield* rerun.executeAuthorizedPointMutationOccRerun(
              authorization.rerun,
            );
        }
      });

  return Object.freeze({ executeInitialPointMutationAttempt });
}

function inspectActivatedInitialState(
  value: ActivatedPointMutationSessionV1,
): Result.Result<
  CreatedActivatedPointMutationSessionStateV1,
  | InvalidActivatedPointMutationSessionV1Error
  | ActivatedPointMutationSessionBusyV1Error
> {
  if (typeof value !== "object" || value === null) {
    return Result.fail(new InvalidActivatedPointMutationSessionV1Error());
  }
  const state = getActivatedPointMutationSessionStateV1(value);
  if (state === undefined) {
    return Result.fail(new InvalidActivatedPointMutationSessionV1Error());
  }
  if (state.inspection.status !== "created" || state.executionClaim === undefined) {
    return Result.fail(new ActivatedPointMutationSessionBusyV1Error());
  }
  return Result.succeed(Object.freeze({
    inspection: state.inspection,
    prepared: state.prepared,
    executionClaim: state.executionClaim,
  }));
}

function validateActivationClaim(
  anchor: PointMutationSessionAnchorV1,
  selector: {
    readonly deploymentId: unknown;
    readonly scopeId: unknown;
    readonly sessionId: unknown;
    readonly attemptFence: unknown;
  },
): Result.Result<void, PointMutationInitialExecutionAuthorityV1Error> {
  return selector.deploymentId === anchor.deploymentId &&
      selector.scopeId === anchor.scopeId &&
      selector.sessionId === anchor.sessionId &&
      selector.attemptFence === anchor.attemptFence
    ? Result.succeed(undefined)
    : Result.fail(new PointMutationInitialExecutionAuthorityV1Error({
        reason: "activatedStateChanged",
      }));
}

function captureInitialExecutionAuthority(
  state: CreatedActivatedPointMutationSessionStateV1,
  executionClaim: TransactionExecutionClaimPinV1,
): StoredOccExecutionEvidenceAuthorityV1 {
  const anchor = state.inspection.anchor;
  return Object.freeze({
    kind: "claimedAttempt",
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    scopeUuid: projectScopeIdUuidV1(anchor.scopeId).scopeUuid,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: Object.freeze({ ...anchor.snapshotToken }),
    schemaVersionId: state.prepared.evidence.schemaVersionId,
    executionClaim: Object.freeze({
      claimOwner: executionClaim.claimOwner,
      claimFence: executionClaim.claimFence,
    }),
  });
}

function captureInitialVerificationState(
  state: CreatedActivatedPointMutationSessionStateV1,
): Result.Result<
  CommitAuthorityVerificationStateV1,
  PointMutationInitialExecutionAuthorityV1Error
> {
  const anchor = state.inspection.anchor;
  return captureInitialSessionScalars(anchor, state.prepared.evidence).pipe(
    Result.map((session) =>
      Object.freeze({
        authority: Object.freeze({
          deploymentId: anchor.deploymentId,
          scopeId: anchor.scopeId,
          sessionId: anchor.sessionId,
          attemptFence: anchor.attemptFence,
          storageGeneration: anchor.storageGeneration,
          storageGenerationFence: anchor.storageGenerationFence,
          snapshotToken: Object.freeze({ ...anchor.snapshotToken }),
          schemaVersionId: state.prepared.evidence.schemaVersionId,
        }),
        session,
      })
    ),
  );
}

function captureInitialSessionScalars(
  anchor: PointMutationSessionAnchorV1,
  evidence: ActivatedPointMutationSessionStateV1["prepared"]["evidence"],
): Result.Result<
  StoredAttemptSessionScalarsPortV1,
  PointMutationInitialExecutionAuthorityV1Error
> {
  const authorizationGrantExpiresAtMilliseconds =
    "grant" in evidence
      ? canonicalTimestampMilliseconds(
          evidence.grant.authorizationGrantExpiresAt,
        )
      : finiteDateMilliseconds(evidence.authorizationGrantExpiresAt);
  const hardExpiresAtMilliseconds = canonicalTimestampMilliseconds(
    anchor.hardExpiresAt,
  );
  const createdAtMilliseconds = canonicalTimestampMilliseconds(
    anchor.createdAt,
  );
  const updatedAtMilliseconds = canonicalTimestampMilliseconds(
    anchor.updatedAt,
  );
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    createdAtMilliseconds === undefined ||
    updatedAtMilliseconds === undefined
  ) {
    return Result.fail(
      new PointMutationInitialExecutionAuthorityV1Error({
        reason: "timestampInvalid",
      }),
    );
  }
  const common = Object.freeze({
    lifecycle: "running",
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    functionPath: evidence.functionPath,
    functionKind: evidence.functionKind,
    schemaVersionId: evidence.schemaVersionId,
    policyVersion: evidence.policyVersion,
    identityAccessPolicySha256: copyBytes(
      evidence.identityAccessPolicySha256,
    ),
    validatedArgsValueCodecVersion:
      evidence.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength:
      evidence.validatedArgsCanonicalBytes.byteLength,
    validatedArgsSha256: copyBytes(evidence.validatedArgsSha256),
    authorizationGrantId: "grant" in evidence
      ? evidence.grant.authorizationGrantId
      : evidence.authorizationGrantId,
    authorizationGrantValueCodecVersion: "grant" in evidence
      ? evidence.grant.authorizationGrantValueCodecVersion
      : evidence.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength: "grant" in evidence
      ? evidence.grant.authorizationGrantCanonicalBytes.byteLength
      : evidence.authorizationGrantCanonicalBytes.byteLength,
    authorizationGrantSha256: copyBytes(
      "grant" in evidence
        ? evidence.grant.authorizationGrantSha256
        : evidence.authorizationGrantSha256,
    ),
    authorizationRevocationEpoch: "grant" in evidence
      ? evidence.grant.authorizationRevocationEpoch
      : evidence.authorizationRevocationEpoch,
    authorizationGrantExpiresAtMilliseconds,
    requestKey: evidence.requestKey,
    requestSha256: copyBytes(evidence.requestSha256),
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    hardExpiresAtMilliseconds,
    createdAtMilliseconds,
    updatedAtMilliseconds,
  });
  return "executionAuthority" in evidence
    ? Result.succeed(Object.freeze({
        ...common,
        executionAuthorityGeneration: "application_v1" as const,
        applicationExecutionAuthorityJson:
          evidence.executionAuthority.authorityJson,
        applicationExecutionAuthorityCanonicalBytes: copyBytes(
          evidence.executionAuthority.canonicalBytes,
        ),
        applicationExecutionAuthoritySha256: copyBytes(
          evidence.executionAuthority.sha256,
        ),
      } satisfies StoredTransactionSessionScalarsV1))
    : Result.succeed(Object.freeze({
        ...common,
        executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
        packageId: evidence.packageId,
        artifactRuntime: evidence.artifactRuntime,
        artifactId: evidence.artifactId,
        sourcePackageHash: evidence.sourcePackageHash,
        executionModule: evidence.executionModule,
      } satisfies StoredTransactionSessionScalarsV1));
}

function canonicalTimestampMilliseconds(value: string): number | undefined {
  return isCanonicalIsoTimestamp(value) ? Date.parse(value) : undefined;
}

function validateCurrentInitialAttempt(
  state: CreatedActivatedPointMutationSessionStateV1,
  current: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
): Effect.Effect<void, PointMutationInitialExecutionAuthorityV1Error> {
  const anchor = state.inspection.anchor;
  return current.selector.deploymentId === anchor.deploymentId &&
      current.selector.scopeId === anchor.scopeId &&
      current.selector.sessionId === anchor.sessionId &&
      current.selector.attemptFence === anchor.attemptFence &&
      current.storageGeneration === anchor.storageGeneration &&
      current.storageGenerationFence === anchor.storageGenerationFence &&
      current.snapshotToken.scopeId === anchor.snapshotToken.scopeId &&
      current.snapshotToken.epoch === anchor.snapshotToken.epoch &&
      current.snapshotToken.commitSeq === anchor.snapshotToken.commitSeq &&
      current.schemaVersionId === state.prepared.evidence.schemaVersionId &&
      current.requestKey === state.prepared.evidence.requestKey
    ? Effect.void
    : Effect.fail(new PointMutationInitialExecutionAuthorityV1Error({
        reason: "activatedStateChanged",
      }));
}
