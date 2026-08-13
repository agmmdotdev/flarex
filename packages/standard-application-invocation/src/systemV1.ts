import {
  createPointMutationExecutionClaimVaultV1,
} from "@flarex/executor/internal/point-mutation-execution-claim-v1";
import {
  makePointMutationExactRuntimeBindingRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "@flarex/executor/point-mutation-exact-runtime-binding";
import {
  createPointMutationInitialExecutionV1,
  type PointMutationInitialExecutionV1Error,
  type StoredPointMutationOccRerunExecutionConfigV1,
} from "@flarex/executor/point-mutation-initial-execution";
import { createPointMutationJournalV1 } from
  "@flarex/executor/point-mutation-journal";
import {
  createPointMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
  type PointMutationSessionActivationExecutionV1Error,
} from "@flarex/executor/point-mutation-session";
import {
  createExecutorPointMutationStartPreparationV1,
  ExecutorPointMutationScopeAuthorityV1Error,
  ExecutorPointMutationTargetMetadataV1Error,
  inspectExecutorPreparedPointMutationStartV1,
  InvalidExecutorPreparedPointMutationStartV1Error,
} from "@flarex/executor/point-mutation-start";
import {
  createPointMutationStartAdmissionV1,
  inspectVerifiedTransactionGrantV1,
  type CurrentEpochTransactionGrantAdmissionV1Error,
  TransactionGrantVerificationV1Error,
  type TransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import {
  type CurrentScopeAuthorizationEpochError,
  type CurrentScopeAuthorizationEpochResolutionPorts,
  resolveCurrentScopeAuthorizationEpochEffect,
} from "@flarex/persistence-postgres";
import {
  claimActiveApplicationRevisionInvocationBasisV1,
  type ActiveApplicationRevisionInvocationBasisV1,
  type AuthenticatedActiveApplicationRevisionSelectionV1,
  type InvalidActiveApplicationRevisionSelectionV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-activation-v1";
import { claimApplicationRevisionMutationInternalCallRuntimeTargetAuthorityV1 } from
  "@flarex/persistence-postgres/internal/application-revision-mutation-internal-call-runtime-target-v1";
import {
  deriveApplicationRevisionSyscallValidatorV1,
  type InvalidApplicationRevisionSyscallValidatorV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import type { IntrinsicCreationTimeIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/intrinsic-creation-time-index-build-v1";
import type { AppDeveloperIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/app-developer-index-commit-v1";
import { createStoredAttemptEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/internal/stored-attempt-evidence-v1";
import { createStoredCommitAuthorityEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/internal/stored-commit-authority-evidence-v1";
import {
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
  type PointCommitOutcomeResolutionV1Error,
  type PointCommitTransactionProofOptionsV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  createSessionJournalStorePersistenceV1,
  type AppDeveloperIndexQueryPortV1,
} from
  "@flarex/persistence-postgres/session-journal-store";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/stored-occ-execution";
import { createPointMutationExecutionClaimLivenessV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import {
  prepareCandidateBoundPointMutationInternalCallRuntimeTargetV1,
  type CandidateBoundPointMutationInternalCallRuntimeTargetV1,
  type CandidateBoundMutationInternalCallRuntimeTargetBudgetV1,
  type PreparedCandidateBoundPointMutationInternalCallRuntimeTargetV1,
  type PrepareCandidateBoundPointMutationInternalCallRuntimeTargetV1Error,
} from
  "flarex-backend/internal/candidate-bound-point-mutation-internal-call-runtime-target-v1";
import type {
  DeclarativeV2RuntimeArtifactR2StoreV1,
} from "flarex-backend/internal/declarative-v2-runtime-artifact-r2-v1";
import {
  createServerPreparedTransactionRequestKeyV1,
  InvalidServerPreparedTransactionRequestKeyV1Error,
  makeIssuerPointMutationGrantPreparationV1,
  type PrepareIssuerPointMutationStartV1Error,
} from "flarex-backend/internal/point-mutation-grant-preparation-v1";
import {
  type IssuePointMutationTransactionGrantV1Error,
  type PointMutationTransactionGrantIssuerV1,
} from "flarex-backend/internal/point-mutation-transaction-grant-issuer-v1";
import { Context, Data, Effect, Layer, Result, Schema, Scope } from "effect";
import {
  decodeActivePointMutationTargetMetadataV1,
  type ActivePointMutationTargetMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  transactionGrantRequestSha256BytesV1FromHex,
} from "flarex-protocol/transaction-grant";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";
import type { CommittedPointOutcomeResolutionV1 } from
  "@flarex/persistence-postgres/point-commit-transaction";

export interface ApplicationPointMutationRouteIndependentDispatcherV1 {
  readonly bind: (
    target: CandidateBoundPointMutationInternalCallRuntimeTargetV1,
  ) => Effect.Effect<
    PointMutationExactRuntimeArtifactHostBindingV1,
    ApplicationPointMutationRouteIndependentDispatcherV1Error,
    Scope.Scope
  >;
}

export class ApplicationPointMutationRouteIndependentDispatcherV1Error
  extends Data.TaggedError(
    "ApplicationPointMutationRouteIndependentDispatcherV1Error",
  )<{
    readonly reason: "unavailable" | "targetRejected";
    readonly cause?: unknown;
  }> {}

export class InvalidApplicationPointMutationInputV1Error
  extends Data.TaggedError("InvalidApplicationPointMutationInputV1Error")<{
    readonly field: "functionRef" | "requestKey";
  }> {}

export class ApplicationPointMutationTargetProjectionV1Error
  extends Data.TaggedError("ApplicationPointMutationTargetProjectionV1Error")<{
    readonly cause: unknown;
  }> {}

export class ApplicationPointMutationActiveSelectionMismatchV1Error
  extends Data.TaggedError(
    "ApplicationPointMutationActiveSelectionMismatchV1Error",
  )<{
    readonly reason: "deployment";
  }> {}

export class ApplicationPointMutationCommittedOutcomeUnavailableV1Error
  extends Data.TaggedError(
    "ApplicationPointMutationCommittedOutcomeUnavailableV1Error",
  )<{
    readonly reason: "expired";
  }> {}

type OccContextFactoryV1 = StoredPointMutationOccRerunExecutionConfigV1[
  "pointMutationOccRerun"
]["contextFactory"];

export interface LegacyApplicationPointMutationSystemLiveV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly intrinsicCreationTimeIndexes:
    IntrinsicCreationTimeIndexDefinitionPortV1;
  readonly developerIndexes: AppDeveloperIndexDefinitionPortV1;
  readonly indexedQueries: AppDeveloperIndexQueryPortV1;
  readonly sessionAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly currentEpochAuthority: CurrentScopeAuthorizationEpochResolutionPorts;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly grantIssuer: PointMutationTransactionGrantIssuerV1;
  readonly grantVerifier: TransactionGrantVerifierV1;
  readonly runtimeArtifacts: DeclarativeV2RuntimeArtifactR2StoreV1;
  readonly runtimeBudget: CandidateBoundMutationInternalCallRuntimeTargetBudgetV1;
  readonly compatibilityDate: string;
  readonly dispatcher: ApplicationPointMutationRouteIndependentDispatcherV1;
  readonly randomUuid: () => string;
  readonly executionContextFactory: OccContextFactoryV1;
  readonly leaseDurationMilliseconds: number;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly heartbeatIntervalMilliseconds: number;
  /** Existing persistence-owner proof seam; absent from live composition. */
  readonly pointCommitProofAfterTransactionStep?:
    PointCommitTransactionProofOptionsV1["afterTransactionStep"];
}

type RuntimeTargetErrorV1 = PrepareCandidateBoundPointMutationInternalCallRuntimeTargetV1Error<
  Effect.Error<ReturnType<
    typeof claimApplicationRevisionMutationInternalCallRuntimeTargetAuthorityV1
  >>
>;

/** Exact union of every preserved owner failure plus the FSV06 failures. */
export type InvokeLegacyApplicationPointMutationV1Error =
  | InvalidApplicationPointMutationInputV1Error
  | InvalidActiveApplicationRevisionSelectionV1Error
  | InvalidApplicationRevisionSyscallValidatorV1Error
  | InvalidServerPreparedTransactionRequestKeyV1Error
  | PrepareIssuerPointMutationStartV1Error
  | IssuePointMutationTransactionGrantV1Error
  | TransactionGrantVerificationV1Error
  | CurrentEpochTransactionGrantAdmissionV1Error
  | CurrentScopeAuthorizationEpochError
  | ExecutorPointMutationTargetMetadataV1Error
  | ExecutorPointMutationScopeAuthorityV1Error
  | InvalidExecutorPreparedPointMutationStartV1Error
  | PointMutationSessionActivationExecutionV1Error
  | PointMutationInitialExecutionV1Error
  | PointCommitOutcomeResolutionV1Error
  | RuntimeTargetErrorV1
  | ApplicationPointMutationRouteIndependentDispatcherV1Error
  | ApplicationPointMutationActiveSelectionMismatchV1Error
  | ApplicationPointMutationTargetProjectionV1Error
  | ApplicationPointMutationCommittedOutcomeUnavailableV1Error;

export interface LegacyAuthoritativeCommittedApplicationPointMutationOutcomeV1 {
  readonly status: "committed";
  readonly disposition: "published" | "replayed";
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly commitSeq: bigint;
  readonly value: Json;
}

export interface LegacyApplicationPointMutationSystemV1Api {
  readonly invoke: (
    activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    LegacyAuthoritativeCommittedApplicationPointMutationOutcomeV1,
    InvokeLegacyApplicationPointMutationV1Error,
    Scope.Scope
  >;
}

export class LegacyApplicationPointMutationSystemV1 extends Context.Service<
  LegacyApplicationPointMutationSystemV1,
  LegacyApplicationPointMutationSystemV1Api
>()("flarex/standard-application-invocation/LegacyApplicationPointMutationSystemV1") {}

/**
 * Private FSV06 System Application Data operation. The supplied active
 * selection, C03-V validator, and runtime target all remain owned by the
 * caller's Scope; success is projected only from the durable outcome owner.
 */
export const invokeLegacyApplicationPointMutationV1 = Effect.fn(
  "LegacyApplicationPointMutation.invokeV1",
)(function* (
  activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  LegacyAuthoritativeCommittedApplicationPointMutationOutcomeV1,
  InvokeLegacyApplicationPointMutationV1Error,
  LegacyApplicationPointMutationSystemV1 | Scope.Scope
> {
  const system = yield* LegacyApplicationPointMutationSystemV1;
  return yield* system.invoke(activeRevision, functionRef, args, requestKey);
});

export function makeLegacyApplicationPointMutationSystemV1Layer(
  live: LegacyApplicationPointMutationSystemLiveV1,
): Layer.Layer<LegacyApplicationPointMutationSystemV1> {
  return Layer.succeed(
    LegacyApplicationPointMutationSystemV1,
    LegacyApplicationPointMutationSystemV1.of({
      invoke: makeInvoke(live),
    }),
  );
}

function makeInvoke(
  live: LegacyApplicationPointMutationSystemLiveV1,
): LegacyApplicationPointMutationSystemV1Api["invoke"] {
  return Effect.fn("ApplicationPointMutationSystem.invoke")(function* (
    activeRevision: AuthenticatedActiveApplicationRevisionSelectionV1,
    functionRefInput: TransactionFunctionPathV1,
    args: unknown,
    requestKeyInput: TransactionRequestKeyV1,
  ) {
  const functionRef = yield* decodeInput(
    decodeFunctionPath,
    functionRefInput,
    "functionRef",
  );
  const requestKey = yield* decodeInput(
    decodeRequestKey,
    requestKeyInput,
    "requestKey",
  );
  const invocationBasis = yield* Effect.fromResult(
    claimActiveApplicationRevisionInvocationBasisV1(activeRevision),
  );
  if (invocationBasis.deploymentId !== live.deploymentId) {
    return yield* new ApplicationPointMutationActiveSelectionMismatchV1Error({
      reason: "deployment",
    });
  }
  const syscallValidator = yield* deriveApplicationRevisionSyscallValidatorV1(
    activeRevision,
  );
  const runtimeTarget = yield* prepareCandidateBoundPointMutationInternalCallRuntimeTargetV1(
    activeRevision,
    functionRef,
    Object.freeze({
      claim: claimApplicationRevisionMutationInternalCallRuntimeTargetAuthorityV1,
    }),
    live.runtimeArtifacts,
    live.runtimeBudget,
    live.compatibilityDate,
  );
  const binding = yield* live.dispatcher.bind(runtimeTarget.target);
  const currentAuthority = yield* resolveCurrentScopeAuthorizationEpochEffect(
    live.deploymentId,
    live.currentEpochAuthority,
  );
  const target = yield* projectTarget(
    live.deploymentId,
    invocationBasis,
    runtimeTarget,
  );
  const issuerPreparation = makeIssuerPointMutationGrantPreparationV1({
    loadActiveTargetMetadata: () => Effect.succeed(target),
    loadCurrentScopeAuthority: () => Effect.succeed(currentAuthority),
  });
  const serverRequestKey = yield* Effect.try({
    try: () => createServerPreparedTransactionRequestKeyV1(requestKey),
    catch: serverPreparedRequestKeyFailure,
  });
  const issuerPrepared = yield* issuerPreparation.prepare({
    deploymentId: target.deploymentId,
    functionPath: functionRef,
    args,
    requestKey: serverRequestKey,
  });
  const executorPreparation = createExecutorPointMutationStartPreparationV1({
    loadActiveTargetMetadata: async () => target,
    loadCurrentScopeAuthority: async () => currentAuthority,
  });
  const executorPrepared = yield* Effect.tryPromise({
    try: () => executorPreparation.prepare({
      deploymentId: target.deploymentId,
      functionPath: functionRef,
      args,
      requestKey,
    }),
    catch: executorPreparationFailure,
  });
  const grant = yield* live.grantIssuer.issue({
    authentication: ANONYMOUS_AUTHENTICATION,
    preparedStart: issuerPrepared,
  });
  const verified = yield* Effect.tryPromise({
    try: () => live.grantVerifier.verify({
      jws: grant.jws,
      expectedStart: executorPrepared,
    }),
    catch: (cause) => {
      if (cause instanceof TransactionGrantVerificationV1Error) return cause;
      throw cause;
    },
  });
  const verifiedInspection = inspectVerifiedTransactionGrantV1(verified);
  const pointCommit = createPointCommitPublisherPortV1(
    live.sessionAuthority,
    {
      intrinsicCreationTimeIndexes: live.intrinsicCreationTimeIndexes,
      developerIndexes: live.developerIndexes,
      ...(live.pointCommitProofAfterTransactionStep === undefined
        ? {}
        : {
            afterTransactionStep:
              live.pointCommitProofAfterTransactionStep,
          }),
    },
  );
  const lookup = outcomeLookup(verifiedInspection.evidence.payload);
  const existing = yield* pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
    target.deploymentId,
    lookup,
  );
  if (existing.kind !== "missing") {
    return yield* outcomeFromResolution(existing, "replayed");
  }
  const admitted = yield* createPointMutationStartAdmissionV1({
    resolveCurrent: (deploymentId) =>
      resolveCurrentScopeAuthorizationEpochEffect(
        deploymentId,
        live.currentEpochAuthority,
      ),
  }).admit(verified);
  const executionClaims = createPointMutationExecutionClaimVaultV1();
  const activated = yield* createPointMutationSessionActivationV1(
    createPointMutationSessionActivationPersistenceV1(
      live.sessionAuthority,
      {
        leaseDurationMilliseconds: live.leaseDurationMilliseconds,
        randomUuid: live.randomUuid,
      },
    ),
    executionClaims.issuer,
  ).activate(admitted);
  if (inspectActivatedPointMutationSessionV1(activated).status !== "created") {
    const replay = yield* pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
      target.deploymentId,
      lookup,
    );
    if (replay.kind !== "missing") {
      return yield* outcomeFromResolution(replay, "replayed");
    }
  }
  const store = createSessionJournalStorePersistenceV1(
    live.sessionAuthority,
    {
      grantRetentionPolicy: live.grantRetentionPolicy,
      indexedQueries: live.indexedQueries,
      randomUuid: live.randomUuid,
    },
  );
  const loading = createPointMutationSessionAttemptLoadingV1(
    createPointMutationSessionAttemptLoadPersistenceV1(live.sessionAuthority),
  );
  const terminalization = createPointMutationSessionAttemptTerminalizationV1(
    createPointMutationSessionAttemptTerminalizationPersistenceV1(
      live.sessionAuthority,
    ),
    executionClaims.admission,
  );
  const selectedFunction = target.functions[0];
  if (selectedFunction === undefined) {
    return yield* Effect.die(
      new Error("The composed active target omitted its selected function."),
    );
  }
  const execution = createPointMutationInitialExecutionV1(
    createStoredAttemptEvidenceLoaderV1(live.sessionAuthority),
    {
      evidenceLoader:
        createStoredCommitAuthorityEvidenceLoaderV1(live.sessionAuthority),
      transactionGrantVerifier: live.grantVerifier,
      functionMetadata: {
        load: () => Effect.succeed(Object.freeze({
          deploymentId: target.deploymentId,
          scopeId: target.scopeId,
          packageId: target.packageId,
          artifactRuntime: target.artifactRuntime,
          artifactId: target.artifactId,
          sourcePackageHash: target.sourcePackageHash,
          executionModule: selectedFunction.executionModule,
          functionPath: functionRef,
          functionKind: "mutation" as const,
          schemaVersionId: target.schemaVersionId,
          functionMetadata: structuredClone(selectedFunction),
        })),
      },
      pointCommit,
      pointCommitFinishing:
        createPointCommitFinishingTransitionPortV1(live.sessionAuthority),
      pointMutationAttemptReplacement:
        createPointMutationAttemptReplacementPortV1(live.sessionAuthority, {
          leaseDurationMilliseconds: live.leaseDurationMilliseconds,
        }),
      pointMutationOccRerun: {
        attemptLoading: loading,
        executionEvidence:
          createStoredOccExecutionEvidenceLoaderV1(live.sessionAuthority),
        journal: createPointMutationJournalV1(
          store,
          executionClaims.admission,
          syscallValidator,
        ),
        terminalization,
        contextFactory: live.executionContextFactory,
        runner: makePointMutationExactRuntimeBindingRunnerV1(binding),
        liveness: createPointMutationExecutionClaimLivenessV1(
          live.sessionAuthority,
          {
            claimDurationMilliseconds: live.claimDurationMilliseconds,
            leaseRenewalDurationMilliseconds:
              live.leaseRenewalDurationMilliseconds,
            grantRetentionPolicy: live.grantRetentionPolicy,
          },
        ),
        heartbeatIntervalMilliseconds: live.heartbeatIntervalMilliseconds,
      },
    },
    executionClaims,
  );
  const result = yield* execution.executeInitialPointMutationAttempt(activated);
  if (result.kind === "expired") {
    return yield* new ApplicationPointMutationCommittedOutcomeUnavailableV1Error({
      reason: "expired",
    });
  }
  const authoritative = yield* pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
    target.deploymentId,
    lookup,
  );
  return yield* outcomeFromResolution(authoritative, result.kind);
});
}

const ANONYMOUS_AUTHENTICATION = Object.freeze({
  kind: "anonymous" as const,
  executionIdentity: Object.freeze({ kind: "anonymous" as const }),
});

function decodeInput<A, I>(
  decode: (input: I) => Result.Result<A, unknown>,
  input: I,
  field: InvalidApplicationPointMutationInputV1Error["field"],
): Effect.Effect<A, InvalidApplicationPointMutationInputV1Error> {
  return Effect.fromResult(decode(input)).pipe(
    Effect.mapError(() => new InvalidApplicationPointMutationInputV1Error({
      field,
    })),
  );
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeRequestKey = Schema.decodeUnknownResult(TransactionRequestKeyV1Schema);

const projectTarget = Effect.fn(
  "ApplicationPointMutation.projectTarget",
)(function* (
  deploymentId: TransactionGrantDeploymentIdV1,
  basis: ActiveApplicationRevisionInvocationBasisV1,
  runtimeTarget: PreparedCandidateBoundPointMutationInternalCallRuntimeTargetV1,
) {
  const packageSha256Hex = encodeBytesToLowercaseHex(
    basis.metadata.packageSha256,
  );
  return yield* Effect.try({
    try: () => decodeActivePointMutationTargetMetadataV1({
      format: "flarex.point-mutation-target-metadata",
      version: 1,
      deploymentId,
      scopeId: basis.metadata.scopeId,
      packageId: `package_${packageSha256Hex.slice(0, 32)}`,
      artifactRuntime: runtimeTarget.artifact.runtime,
      artifactId: runtimeTarget.artifact.artifactId,
      sourcePackageHash: runtimeTarget.artifact.sourcePackageHash,
      schemaVersionId: basis.metadata.schemaVersionId,
      functions: [{
        path: runtimeTarget.function.path,
        executionModule: runtimeTarget.function.executionModule,
        kind: runtimeTarget.function.kind,
        visibility: runtimeTarget.function.visibility,
        argsValidator: runtimeTarget.function.argsValidator,
        returnsValidator: runtimeTarget.function.returnsValidator,
      }],
      schemaManifest: basis.schemaManifest,
    }),
    catch: (cause) => new ApplicationPointMutationTargetProjectionV1Error({
      cause,
    }),
  });
});

function executorPreparationFailure(
  cause: unknown,
): ExecutorPointMutationTargetMetadataV1Error |
  ExecutorPointMutationScopeAuthorityV1Error |
  InvalidExecutorPreparedPointMutationStartV1Error {
  if (
    cause instanceof ExecutorPointMutationTargetMetadataV1Error ||
    cause instanceof ExecutorPointMutationScopeAuthorityV1Error ||
    cause instanceof InvalidExecutorPreparedPointMutationStartV1Error
  ) return cause;
  throw cause;
}

function serverPreparedRequestKeyFailure(
  cause: unknown,
): InvalidServerPreparedTransactionRequestKeyV1Error {
  if (cause instanceof InvalidServerPreparedTransactionRequestKeyV1Error) {
    return cause;
  }
  throw cause;
}

function outcomeLookup(
  payload: ReturnType<typeof inspectVerifiedTransactionGrantV1>["evidence"]["payload"],
) {
  return Object.freeze({
    scopeUuid: projectScopeIdUuidV1(payload.scopeId).scopeUuid,
    requestKey: payload.requestKey,
    expectedIdentityAccessPolicySha256:
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
        payload.identityAccessPolicySha256,
      ),
    expectedFunctionPath: payload.functionPath,
    expectedRequestSha256: transactionGrantRequestSha256BytesV1FromHex(
      payload.requestSha256,
    ),
  });
}

const outcomeFromResolution = Effect.fn(
  "ApplicationPointMutation.outcomeFromResolution",
)(function* (
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
): Effect.fn.Return<
  LegacyAuthoritativeCommittedApplicationPointMutationOutcomeV1,
  ApplicationPointMutationCommittedOutcomeUnavailableV1Error
> {
  if (outcome.kind === "expired") {
    return yield* new ApplicationPointMutationCommittedOutcomeUnavailableV1Error({
      reason: "expired",
    });
  }
  if (outcome.kind === "missing") {
    return yield* Effect.die(
      new Error("A committed point mutation had no durable outcome."),
    );
  }
  return Object.freeze({
    status: "committed" as const,
    disposition,
    scopeUuid: outcome.token.scopeUuid,
    epochUuid: outcome.token.epochUuid,
    commitSeq: outcome.token.commitSeq,
    value: structuredClone(outcome.successfulResult.valueJson),
  });
});
