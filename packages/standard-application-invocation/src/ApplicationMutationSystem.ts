import {
  createPointMutationExecutionClaimVaultV1,
} from "@flarex/executor/internal/point-mutation-execution-claim-v1";
import {
  createPointMutationInitialExecutionV1,
  validatePointMutationExecutionLivenessConfigurationV1Result,
  type PointMutationInitialExecutionV1Error,
  type StoredPointMutationOccRerunExecutionConfigV1,
} from "@flarex/executor/point-mutation-initial-execution";
import { createPointMutationJournalV1 } from
  "@flarex/executor/point-mutation-journal";
import {
  createApplicationPointMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
  type ApplicationPointMutationSessionActivationExecutionV1Error,
} from "@flarex/executor/point-mutation-session";
import type {
  ApplicationMutationGrantVerificationKernelV1,
} from "@flarex/executor/internal/application-mutation-grant-verification-kernel";
import {
  isRegisteredTransactionGrantVerifierV1,
  type TransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import {
  type CurrentScopeAuthorizationEpochError,
  type CurrentScopeAuthorizationEpochResolutionPorts,
  resolveCurrentScopeAuthorizationEpochEffect,
} from "@flarex/persistence-postgres";
import type {
  ApplicationActivationRepository,
  ApplicationActiveSelection,
  ApplicationRelationActivationRepository,
} from
  "@flarex/persistence-postgres/internal/application-activation";
import {
  selectApplicationMutationAdmission,
  selectApplicationMutationCallbackAdmission,
  type ApplicationMutationAdmissionContext,
  type SelectApplicationMutationAdmissionError,
} from "@flarex/persistence-postgres/internal/application-mutation-admission";
import {
  deriveApplicationSyscallValidator,
} from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import type { AppDeveloperIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/app-developer-index-commit-v1";
import type { IntrinsicCreationTimeIndexDefinitionPortV1 } from
  "@flarex/persistence-postgres/internal/intrinsic-creation-time-index-build-v1";
import {
  hasAppSchemaCandidateWriteGuardComposition,
  type AppSchemaCandidateWriteGuardPort,
} from "@flarex/persistence-postgres/internal/app-schema-candidate-validation";
import { createStoredAttemptEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/internal/stored-attempt-evidence-v1";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  type StoredCommitAuthorityEvidenceLoaderPortsV1,
} from
  "@flarex/persistence-postgres/internal/stored-commit-authority-evidence-v1";
import {
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
  type CommittedPointOutcomeResolutionV1,
  type PointCommitOutcomeResolutionV1Error,
  type PointCommitTransactionProofOptionsV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  createSessionJournalStorePersistenceV1,
  type AppDeveloperIndexQueryPortV1,
} from "@flarex/persistence-postgres/session-journal-store";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/stored-occ-execution";
import { createPointMutationExecutionClaimLivenessV1 } from
  "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import {
  createApplicationMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  makeApplicationPointMutationRunner,
  type ApplicationPointMutationRunnerConfig,
} from "flarex-backend/internal/application-point-mutation-runner";
import type { ApplicationMutationGrantIssuer } from
  "flarex-backend/internal/application-mutation-grant-issuer";
import { Context, Data, Effect, Layer, Result, Schema, Scope } from "effect";
import {
  decodeExecutionIdentityEffect,
  type ExecutionIdentity,
} from "flarex-protocol/auth";
import { requireAppDocumentIdentityV1ForTable } from
  "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  inspectVerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizePointMutationArgumentsV1,
  canonicalizePointMutationRequestV1,
  PointMutationTargetSelectionV1Error,
  ValidatorValueErrorV1,
} from "flarex-protocol/point-mutation-start";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  TransactionGrantIdentityAccessPolicySha256HexV1Schema,
  TransactionGrantRequestSha256HexV1Schema,
  transactionGrantRequestSha256BytesV1FromHex,
  type CanonicalTransactionGrantIdentityAccessPolicyV1,
  type TransactionGrantInertAuthV1,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import { decodeReplacementScopeIdV1, projectScopeIdUuidV1 } from
  "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";
import { FlarexValueCodecVersionSchema } from "flarex-protocol/value";
import type { TransactionGrantIdentityAccessPolicyV1Error } from
  "flarex-protocol/transaction-grant";
import { ObjectValidatorJsonV1 } from "flarex-protocol/validator-json";

import {
  captureApplicationTaskLaunchEvidence,
  correlateApplicationTaskQuerySelection,
  type ApplicationTaskQueryLaunchEvidence,
} from "./ApplicationTaskQueryAuthority";

type OccContextFactory = StoredPointMutationOccRerunExecutionConfigV1[
  "pointMutationOccRerun"
]["contextFactory"];

type ApplicationStoredCommitAuthorityPorts =
  StoredCommitAuthorityEvidenceLoaderPortsV1 &
  Required<Pick<
    StoredCommitAuthorityEvidenceLoaderPortsV1,
    "applicationControlDb"
  >>;

export interface ApplicationMutationSystemLive {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly activation: Pick<
    ApplicationActivationRepository<unknown, unknown>,
    "readActive"
  > | Pick<
    ApplicationRelationActivationRepository<unknown, unknown>,
    "readActive"
  >;
  readonly admission: ApplicationMutationAdmissionContext;
  readonly currentEpochAuthority: CurrentScopeAuthorizationEpochResolutionPorts;
  readonly grantIssuer: ApplicationMutationGrantIssuer;
  readonly applicationGrantVerifier:
    ApplicationMutationGrantVerificationKernelV1;
  /** Required only while the stored authority union retains legacy rows. */
  readonly legacyGrantVerifier: TransactionGrantVerifierV1;
  /** Required only while the stored authority union retains legacy rows. */
  readonly legacyFunctionMetadata:
    StoredPointMutationOccRerunExecutionConfigV1["functionMetadata"];
  readonly sessionAuthority: ApplicationStoredCommitAuthorityPorts;
  readonly candidateSchemaWriteGuard: AppSchemaCandidateWriteGuardPort;
  readonly intrinsicCreationTimeIndexes:
    IntrinsicCreationTimeIndexDefinitionPortV1;
  readonly developerIndexes: AppDeveloperIndexDefinitionPortV1;
  readonly applicationRelations?:
    PointCommitTransactionProofOptionsV1["applicationRelations"];
  readonly indexedQueries: AppDeveloperIndexQueryPortV1;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly applicationRunner: ApplicationPointMutationRunnerConfig;
  readonly randomUuid: () => string;
  readonly executionContextFactory: OccContextFactory;
  readonly leaseDurationMilliseconds: number;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly heartbeatIntervalMilliseconds: number;
  readonly pointCommitProofAfterTransactionStep?:
    PointCommitTransactionProofOptionsV1["afterTransactionStep"];
}

export class ApplicationMutationInputError extends Data.TaggedError(
  "ApplicationMutationInputError",
)<{
  readonly field: "functionRef" | "requestKey" | "arguments" | "identity";
  readonly cause?: unknown;
}> {}

export class ApplicationMutationOutcomeUnavailableError
  extends Data.TaggedError("ApplicationMutationOutcomeUnavailableError")<{
    readonly reason: "expired" | "inProgress";
  }> {}

export class ApplicationMutationSystemConfigurationError extends Error {
  readonly _tag = "ApplicationMutationSystemConfigurationError" as const;
  readonly name = "ApplicationMutationSystemConfigurationError";

  constructor(readonly reason:
    | "unregisteredLegacyGrantVerifier"
    | "invalidCandidateSchemaWriteGuard") {
    super(`Application mutation System configuration is invalid: ${reason}.`);
  }
}

export class ApplicationMutationAuthorityChangedError extends Data.TaggedError(
  "ApplicationMutationAuthorityChangedError",
)<{
  readonly reason: "scopeChanged";
  readonly retryable: true;
}> {}

export class ApplicationTaskMutationLaunchError extends Data.TaggedError(
  "ApplicationTaskMutationLaunchError",
)<{ readonly reason: "invalidLaunch" | "staleLaunch"; readonly cause?: unknown }> {}

export type InvokeApplicationSelectionMutationError =
  | SelectApplicationMutationAdmissionError
  | CurrentScopeAuthorizationEpochError
  | ApplicationMutationAuthorityChangedError
  | ApplicationMutationInputError
  | PointMutationTargetSelectionV1Error
  | ValidatorValueErrorV1
  | TransactionGrantIdentityAccessPolicyV1Error
  | Effect.Error<ReturnType<ApplicationMutationGrantIssuer["issue"]>>
  | ApplicationPointMutationSessionActivationExecutionV1Error
  | PointMutationInitialExecutionV1Error
  | PointCommitOutcomeResolutionV1Error
  | ApplicationMutationOutcomeUnavailableError;

export type InvokeApplicationMutationError =
  | Effect.Error<ReturnType<ApplicationMutationSystemLive["activation"]["readActive"]>>
  | InvokeApplicationSelectionMutationError;

export type InvokeApplicationTaskMutationError =
  | InvokeApplicationMutationError
  | ApplicationTaskMutationLaunchError;

export interface AuthoritativeCommittedApplicationMutationOutcome {
  readonly status: "committed";
  readonly disposition: "published" | "replayed";
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly commitSeq: bigint;
  readonly value: Json;
}

/**
 * Current selection-bound mutation execution core. It accepts one issuer-owned
 * opaque selection and retains every existing mutation admission, grant, OCC,
 * commit, outcome, feed, outbox, and schema-guard owner. Identity is required
 * because this port does not own authentication or an anonymous-default policy.
 */
export interface ApplicationSelectionMutationPort {
  readonly runMutation: (
    selection: ApplicationActiveSelection,
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
    identity: ExecutionIdentity,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationSelectionMutationError,
    Scope.Scope
  >;
}

export interface ApplicationMutationSystemApi {
  readonly selectionMutation: ApplicationSelectionMutationPort;
  readonly invoke: (
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationMutationError,
    Scope.Scope
  >;
  readonly invokeAuthenticated: (
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
    identity: ApplicationMutationAuthenticatedIdentity,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationMutationError,
    Scope.Scope
  >;
  readonly invokeAuthenticatedAtTaskLaunch: (
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
    identity: ApplicationMutationAuthenticatedIdentity,
    launch: ApplicationTaskQueryLaunchEvidence,
  ) => Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationTaskMutationError,
    Scope.Scope
  >;
}

export interface ApplicationMutationAuthenticatedIdentity {
  readonly _ApplicationMutationAuthenticatedIdentity: unique symbol;
}

export interface ApplicationMutationAuthenticatedIdentityEvidence {
  readonly identityAccessPolicySha256: Uint8Array;
}

interface ApplicationMutationAuthenticatedIdentityState {
  readonly identityAccessPolicy:
    CanonicalTransactionGrantIdentityAccessPolicyV1;
}

const authenticatedIdentityStates = new WeakMap<
  object,
  ApplicationMutationAuthenticatedIdentityState
>();

export class ApplicationMutationSystem extends Context.Service<
  ApplicationMutationSystem,
  ApplicationMutationSystemApi
>()("flarex/standard-application-invocation/ApplicationMutationSystem") {}

export const invokeApplicationMutation = Effect.fn(
  "ApplicationMutation.invoke",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
): Effect.fn.Return<
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeApplicationMutationError,
  ApplicationMutationSystem | Scope.Scope
> {
  const system = yield* ApplicationMutationSystem;
  return yield* system.invoke(functionRef, args, requestKey);
});

export const invokeAuthenticatedApplicationMutation = Effect.fn(
  "ApplicationMutation.invokeAuthenticated",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
  identity: ApplicationMutationAuthenticatedIdentity,
): Effect.fn.Return<
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeApplicationMutationError,
  ApplicationMutationSystem | Scope.Scope
> {
  const system = yield* ApplicationMutationSystem;
  return yield* system.invokeAuthenticated(
    functionRef,
    args,
    requestKey,
    identity,
  );
});

export const invokeAuthenticatedApplicationTaskMutation = Effect.fn(
  "ApplicationMutation.invokeAuthenticatedAtTaskLaunch",
)(function* (
  functionRef: TransactionFunctionPathV1,
  args: unknown,
  requestKey: TransactionRequestKeyV1,
  identity: ApplicationMutationAuthenticatedIdentity,
  launch: ApplicationTaskQueryLaunchEvidence,
): Effect.fn.Return<
  AuthoritativeCommittedApplicationMutationOutcome,
  InvokeApplicationTaskMutationError,
  ApplicationMutationSystem | Scope.Scope
> {
  const system = yield* ApplicationMutationSystem;
  return yield* system.invokeAuthenticatedAtTaskLaunch(
    functionRef,
    args,
    requestKey,
    identity,
    launch,
  );
});

export const prepareApplicationMutationAuthenticatedIdentity = Effect.fn(
  "ApplicationMutation.prepareAuthenticatedIdentity",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ApplicationMutationAuthenticatedIdentity,
  ApplicationMutationInputError |
    TransactionGrantIdentityAccessPolicyV1Error
> {
  const identity = yield* captureApplicationMutationExecutionIdentity(input);
  if (identity.kind !== "user") {
    return yield* new ApplicationMutationInputError({ field: "identity" });
  }
  const identityAccessPolicy = yield*
    canonicalizeApplicationMutationIdentityAccessPolicy(identity);
  // SAFETY: structural shape carries no authority. The module-private WeakMap
  // below is the only source accepted by authenticated mutation invocation.
  const prepared = Object.freeze({}) as
    ApplicationMutationAuthenticatedIdentity;
  authenticatedIdentityStates.set(prepared, Object.freeze({
    identityAccessPolicy,
  }));
  return prepared;
});

const prepareApplicationMutationIdentityAccessPolicy = Effect.fn(
  "ApplicationMutation.prepareIdentityAccessPolicy",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalTransactionGrantIdentityAccessPolicyV1,
  ApplicationMutationInputError |
    TransactionGrantIdentityAccessPolicyV1Error
> {
  const identity = yield* captureApplicationMutationExecutionIdentity(input);
  return yield* canonicalizeApplicationMutationIdentityAccessPolicy(identity);
});

const captureApplicationMutationExecutionIdentity = Effect.fn(
  "ApplicationMutation.captureExecutionIdentity",
)(function* (
  input: unknown,
): Effect.fn.Return<ExecutionIdentity, ApplicationMutationInputError> {
  const captured = yield* Effect.try({
    try: () => structuredClone(input),
    catch: cause => new ApplicationMutationInputError({
      field: "identity",
      cause,
    }),
  });
  const identity = yield* decodeExecutionIdentityEffect(captured).pipe(
    Effect.mapError(cause => new ApplicationMutationInputError({
      field: "identity",
      cause,
    })),
  );
  return identity;
});

function canonicalizeApplicationMutationIdentityAccessPolicy(
  identity: ExecutionIdentity,
): Effect.Effect<
  CanonicalTransactionGrantIdentityAccessPolicyV1,
  TransactionGrantIdentityAccessPolicyV1Error
> {
  return canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: transactionGrantAuthFromExecutionIdentity(identity),
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
}

export function inspectApplicationMutationAuthenticatedIdentity(
  identity: unknown,
): Result.Result<
  ApplicationMutationAuthenticatedIdentityEvidence,
  ApplicationMutationInputError
> {
  return claimApplicationMutationAuthenticatedIdentity(identity).pipe(
    Result.map(state => Object.freeze({
      identityAccessPolicySha256:
        transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
          state.identityAccessPolicy.sha256Hex,
        ),
    })),
  );
}

export function makeApplicationMutationSystemLayer(
  live: ApplicationMutationSystemLive,
): Layer.Layer<ApplicationMutationSystem> {
  const captured = captureLive(live);
  preflightApplicationMutationSystemConfiguration(captured);
  const invokeRootSelection = makeSelectionInvoke(
    captured,
    selectApplicationMutationAdmission,
  );
  const invokeCallbackSelection = makeSelectionInvoke(
    captured,
    selectApplicationMutationCallbackAdmission,
  );
  const selectionMutation = Object.freeze({
    runMutation: Effect.fn(
      "ApplicationSelectionMutationPort.runMutation",
    )(function* (selection, functionRef, args, requestKey, identity) {
      const preparedInput = yield* prepareApplicationMutationInvocationInput(
        functionRef,
        requestKey,
      );
      const preparedIdentityAccessPolicy = yield*
        prepareApplicationMutationIdentityAccessPolicy(identity);
      return yield* invokeCallbackSelection(
        selection,
        preparedInput,
        args,
        preparedIdentityAccessPolicy,
      ).pipe(Effect.catchTag(
        "ApplicationTaskMutationLaunchError",
        Effect.die,
      ));
    }),
  }) satisfies ApplicationSelectionMutationPort;
  return Layer.succeed(
    ApplicationMutationSystem,
    ApplicationMutationSystem.of({
      selectionMutation,
      invoke: Effect.fn("ApplicationMutationSystem.invoke")(function* (
        functionRef,
        args,
        requestKey,
      ) {
        const preparedInput = yield* prepareApplicationMutationInvocationInput(
          functionRef,
          requestKey,
        );
        const active = yield* captured.activation.readActive();
        return yield* invokeRootSelection(
          active.selection,
          preparedInput,
          args,
        ).pipe(
          Effect.catchTag(
            "ApplicationTaskMutationLaunchError",
            Effect.die,
          ),
        );
      }),
      invokeAuthenticated: Effect.fn(
        "ApplicationMutationSystem.invokeAuthenticated",
      )(function* (functionRef, args, requestKey, identity) {
        const prepared = yield* Effect.fromResult(
          claimApplicationMutationAuthenticatedIdentity(identity),
        );
        const preparedInput = yield* prepareApplicationMutationInvocationInput(
          functionRef,
          requestKey,
        );
        const active = yield* captured.activation.readActive();
        return yield* invokeRootSelection(
          active.selection,
          preparedInput,
          args,
          prepared.identityAccessPolicy,
        ).pipe(Effect.catchTag(
          "ApplicationTaskMutationLaunchError",
          Effect.die,
        ));
      }),
      invokeAuthenticatedAtTaskLaunch: Effect.fn(
        "ApplicationMutationSystem.invokeAuthenticatedAtTaskLaunch",
      )(function* (functionRef, args, requestKey, identity, launch) {
        const prepared = yield* Effect.fromResult(
          claimApplicationMutationAuthenticatedIdentity(identity),
        );
        const capturedLaunch = yield* Effect.fromResult(
          captureApplicationTaskLaunchEvidence(launch).pipe(
            Result.mapError(cause => new ApplicationTaskMutationLaunchError({
              reason: "invalidLaunch",
              cause,
            })),
          ),
        );
        const preparedInput = yield* prepareApplicationMutationInvocationInput(
          functionRef,
          requestKey,
        );
        const active = yield* captured.activation.readActive();
        return yield* invokeRootSelection(
          active.selection,
          preparedInput,
          args,
          prepared.identityAccessPolicy,
          capturedLaunch,
        );
      }),
    }),
  );
}

export function preflightApplicationMutationSystemConfiguration(
  live: Pick<
    ApplicationMutationSystemLive,
    "legacyGrantVerifier" | "sessionAuthority" | "candidateSchemaWriteGuard"
  >,
): void {
  if (!isRegisteredTransactionGrantVerifierV1(live.legacyGrantVerifier)) {
    throw new ApplicationMutationSystemConfigurationError(
      "unregisteredLegacyGrantVerifier",
    );
  }
  if (!Object.isFrozen(live.sessionAuthority) ||
    !hasAppSchemaCandidateWriteGuardComposition(
      live.candidateSchemaWriteGuard,
      live.sessionAuthority,
    )) {
    throw new ApplicationMutationSystemConfigurationError(
      "invalidCandidateSchemaWriteGuard",
    );
  }
}

type ApplicationMutationAdmissionSelector =
  typeof selectApplicationMutationAdmission;

interface PreparedApplicationMutationInvocationInput {
  readonly functionRef: TransactionFunctionPathV1;
  readonly requestKey: TransactionRequestKeyV1;
}

const prepareApplicationMutationInvocationInput = Effect.fn(
  "ApplicationMutation.prepareInvocationInput",
)(function* (
  functionRefInput: unknown,
  requestKeyInput: unknown,
): Effect.fn.Return<
  PreparedApplicationMutationInvocationInput,
  ApplicationMutationInputError
> {
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
  return Object.freeze({ functionRef, requestKey });
});

function makeSelectionInvoke(
  live: ApplicationMutationSystemLive,
  selectAdmission: ApplicationMutationAdmissionSelector,
) {
  const applicationRunner = makeApplicationPointMutationRunner(
    live.applicationRunner,
  );
  const pointCommit = createPointCommitPublisherPortV1(
    live.sessionAuthority,
    {
      intrinsicCreationTimeIndexes: live.intrinsicCreationTimeIndexes,
      developerIndexes: live.developerIndexes,
      candidateSchemaWriteGuard: live.candidateSchemaWriteGuard,
      ...(live.applicationRelations === undefined
        ? {}
        : { applicationRelations: live.applicationRelations }),
      ...(live.pointCommitProofAfterTransactionStep === undefined
        ? {}
        : {
          afterTransactionStep:
            live.pointCommitProofAfterTransactionStep,
        }),
    },
  );
  const store = createSessionJournalStorePersistenceV1(
    live.sessionAuthority,
    {
      grantRetentionPolicy: live.grantRetentionPolicy,
      indexedQueries: live.indexedQueries,
      randomUuid: live.randomUuid,
    },
  );
  const loading = createPointMutationSessionAttemptLoadingV1(
    createPointMutationSessionAttemptLoadPersistenceV1(
      live.sessionAuthority,
    ),
  );
  const storedAttemptEvidence = createStoredAttemptEvidenceLoaderV1(
    live.sessionAuthority,
  );
  const storedCommitAuthority = createStoredCommitAuthorityEvidenceLoaderV1(
    live.sessionAuthority,
  );
  const pointCommitFinishing = createPointCommitFinishingTransitionPortV1(
    live.sessionAuthority,
  );
  const pointMutationAttemptReplacement =
    createPointMutationAttemptReplacementPortV1(
      live.sessionAuthority,
      { leaseDurationMilliseconds: live.leaseDurationMilliseconds },
    );
  const occExecutionEvidence = createStoredOccExecutionEvidenceLoaderV1(
    live.sessionAuthority,
  );
  const liveness = createPointMutationExecutionClaimLivenessV1(
    live.sessionAuthority,
    {
      claimDurationMilliseconds: live.claimDurationMilliseconds,
      leaseRenewalDurationMilliseconds:
        live.leaseRenewalDurationMilliseconds,
      grantRetentionPolicy: live.grantRetentionPolicy,
    },
  );
  Result.getOrThrow(
    validatePointMutationExecutionLivenessConfigurationV1Result(
      liveness,
      {
        heartbeatIntervalMilliseconds: live.heartbeatIntervalMilliseconds,
      },
    ),
  );
  return Effect.fn("ApplicationSelectionMutationPort.invoke")(function* (
    selection,
    preparedInput: PreparedApplicationMutationInvocationInput,
    args,
    preparedIdentityAccessPolicy?:
      CanonicalTransactionGrantIdentityAccessPolicyV1,
    taskLaunch?: ApplicationTaskQueryLaunchEvidence,
  ) {
    const { functionRef, requestKey } = preparedInput;
    const admission = yield* selectAdmission(
      selection,
      functionRef,
      live.admission,
    );
    if (taskLaunch !== undefined) {
      yield* Effect.fromResult(
        correlateApplicationTaskQuerySelection(taskLaunch, admission.basis)
          .pipe(Result.mapError(() =>
            new ApplicationTaskMutationLaunchError({
              reason: "staleLaunch",
            })
          )),
      );
    }
    const syscallValidator = yield* deriveApplicationSyscallValidator({
      scopeId: admission.basis.authority.scopeId,
      schemaVersionId: admission.basis.schemaVersionId,
      schemaManifest: admission.schema.manifest,
    });
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const terminalization = createPointMutationSessionAttemptTerminalizationV1(
      createPointMutationSessionAttemptTerminalizationPersistenceV1(
        live.sessionAuthority,
      ),
      executionClaims.admission,
    );
    const execution = createPointMutationInitialExecutionV1(
      storedAttemptEvidence,
      {
        evidenceLoader: storedCommitAuthority,
        transactionGrantVerifier: live.legacyGrantVerifier,
        applicationMutationGrantVerifier: live.applicationGrantVerifier,
        functionMetadata: live.legacyFunctionMetadata,
        pointCommit,
        pointCommitFinishing,
        pointMutationAttemptReplacement,
        pointMutationOccRerun: {
          attemptLoading: loading,
          executionEvidence: occExecutionEvidence,
          journal: createPointMutationJournalV1(
            store,
            executionClaims.admission,
            syscallValidator,
          ),
          terminalization,
          contextFactory: live.executionContextFactory,
          runner: applicationRunner,
          liveness,
          heartbeatIntervalMilliseconds: live.heartbeatIntervalMilliseconds,
        },
      },
      executionClaims,
    );
    const fn = admission.executionAuthority.authority.runtimeTarget.function;
    const argsValidator = yield* Effect.fromResult(
      pointMutationArgsValidator(fn.args),
    );
    const validatedArguments = yield* Effect.tryPromise({
      try: () => canonicalizePointMutationArgumentsV1(
        argsValidator,
        args,
        admission.schema.manifest,
      ),
      catch: cause =>
        cause instanceof PointMutationTargetSelectionV1Error ||
          cause instanceof ValidatorValueErrorV1
          ? cause
          : new ApplicationMutationInputError({
              field: "arguments",
              cause,
            }),
    });
    const request = yield* Effect.promise(() =>
      canonicalizePointMutationRequestV1({
        deploymentId: live.deploymentId,
        functionPath: functionRef,
        validatedArgsSha256: validatedArguments.sha256,
        requestKey,
      })
    );
    const currentAuthority = yield* resolveCurrentScopeAuthorizationEpochEffect(
      live.deploymentId,
      live.currentEpochAuthority,
    );
    if (currentAuthority.scopeId !== admission.basis.authority.scopeId) {
      return yield* new ApplicationMutationAuthorityChangedError({
        reason: "scopeChanged",
        retryable: true,
      });
    }
    const identityAccessPolicy = preparedIdentityAccessPolicy === undefined
      ? yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        auth: { kind: "anonymous" },
        capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      })
      : preparedIdentityAccessPolicy;
    const verifiedGrant = yield* live.grantIssuer.issue({
      deploymentId: live.deploymentId,
      executionAuthority: admission.executionAuthority,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicy,
      validatedArgsValueCodecVersion: FlarexValueCodecVersionSchema.make(1),
      validatedArgsSha256: encodeBytesToLowercaseHex(
        validatedArguments.sha256,
      ),
      requestKey,
      requestSha256: encodeBytesToLowercaseHex(request.sha256),
      authorizationRevocationEpoch:
        currentAuthority.authorizationRevocationEpoch,
    });
    const grant = inspectVerifiedApplicationMutationGrantV1(verifiedGrant);
    const lookup = outcomeLookup(grant.payload);
    const existing = yield* pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
      live.deploymentId,
      lookup,
    );
    if (existing.kind !== "missing") {
      return yield* outcomeFromResolution(existing, "replayed");
    }
    const activated = yield* createApplicationPointMutationSessionActivationV1(
      createApplicationMutationSessionActivationPersistenceV1(
        live.sessionAuthority,
        {
          leaseDurationMilliseconds: live.leaseDurationMilliseconds,
          randomUuid: live.randomUuid,
        },
      ),
      executionClaims.issuer,
    ).activate({
      deploymentId: live.deploymentId,
      scopeId: decodeReplacementScopeIdV1(admission.basis.authority.scopeId),
      activeSelection: admission.selection,
      evidence: Object.freeze({
        executionAuthority: admission.executionAuthority.authority,
        verifiedGrant,
        functionPath: functionRef,
        functionKind: "mutation" as const,
        schemaVersionId: admission.basis.schemaVersionId,
        policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
        identityAccessPolicySha256:
          transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
            identityAccessPolicy.sha256Hex,
          ),
        validatedArgsJson: validatedArguments.valueJson,
        validatedArgsValueCodecVersion:
          FlarexValueCodecVersionSchema.make(1),
        validatedArgsCanonicalBytes: validatedArguments.canonicalBytes,
        validatedArgsSha256: validatedArguments.sha256,
        requestKey,
        requestSha256: request.sha256,
      }),
    });
    if (inspectActivatedPointMutationSessionV1(activated).status !== "created") {
      const replay = yield* pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
        live.deploymentId,
        lookup,
      );
      if (replay.kind !== "missing") {
        return yield* outcomeFromResolution(replay, "replayed");
      }
      return yield* new ApplicationMutationOutcomeUnavailableError({
        reason: "inProgress",
      });
    }
    const result = yield* execution.executeInitialPointMutationAttempt(
      activated,
    );
    if (result.kind === "expired") {
      return yield* new ApplicationMutationOutcomeUnavailableError({
        reason: "expired",
      });
    }
    const authoritative = yield* pointCommit[
      RESOLVE_POINT_COMMIT_OUTCOME_V1
    ](live.deploymentId, lookup);
    return yield* outcomeFromResolution(authoritative, result.kind);
  });
}

function captureLive(
  live: ApplicationMutationSystemLive,
): ApplicationMutationSystemLive {
  return Object.freeze({
    deploymentId: live.deploymentId,
    activation: Object.freeze({ readActive: live.activation.readActive }),
    admission: Object.freeze({
      deploymentId: live.admission.deploymentId,
      controlDb: live.admission.controlDb,
      schema: live.admission.schema,
      ...(live.admission.relationSchema === undefined
        ? {}
        : { relationSchema: live.admission.relationSchema }),
      authority: Object.freeze({
        scopeMetadata: live.admission.authority.scopeMetadata,
        provisioningReceipts: live.admission.authority.provisioningReceipts,
        scopeClockTargets: live.admission.authority.scopeClockTargets,
      }),
    }),
    currentEpochAuthority: Object.freeze({
      scopeMetadata: live.currentEpochAuthority.scopeMetadata,
      provisioningReceipts: live.currentEpochAuthority.provisioningReceipts,
      scopeEpochTargets: live.currentEpochAuthority.scopeEpochTargets,
    }),
    grantIssuer: Object.freeze({ issue: live.grantIssuer.issue }),
    applicationGrantVerifier: Object.freeze({
      verify: live.applicationGrantVerifier.verify,
    }),
    // Registration is WeakMap-backed in executor; identity is the capability.
    legacyGrantVerifier: live.legacyGrantVerifier,
    legacyFunctionMetadata: live.legacyFunctionMetadata,
    // The candidate guard is WeakMap-bound to this exact authority capability.
    // Derived persistence ports snapshot the fields they consume at creation.
    sessionAuthority: live.sessionAuthority,
    candidateSchemaWriteGuard: live.candidateSchemaWriteGuard,
    intrinsicCreationTimeIndexes: Object.freeze({
      locate: live.intrinsicCreationTimeIndexes.locate,
    }),
    developerIndexes: Object.freeze({
      locate: live.developerIndexes.locate,
    }),
    ...(live.applicationRelations === undefined
      ? {}
      : { applicationRelations: live.applicationRelations }),
    indexedQueries: live.indexedQueries,
    grantRetentionPolicy: Object.freeze({ ...live.grantRetentionPolicy }),
    applicationRunner: Object.freeze({
      source: Object.freeze({ read: live.applicationRunner.source.read }),
      host: Object.freeze({
        runTransaction: live.applicationRunner.host.runTransaction,
        runAction: live.applicationRunner.host.runAction,
      }),
      hostPolicy: live.applicationRunner.hostPolicy,
      hostPolicySha256: Uint8Array.from(
        live.applicationRunner.hostPolicySha256,
      ),
      sha256: live.applicationRunner.sha256,
    }),
    randomUuid: live.randomUuid,
    executionContextFactory: Object.freeze({
      make: live.executionContextFactory.make,
    }),
    leaseDurationMilliseconds: live.leaseDurationMilliseconds,
    claimDurationMilliseconds: live.claimDurationMilliseconds,
    leaseRenewalDurationMilliseconds: live.leaseRenewalDurationMilliseconds,
    heartbeatIntervalMilliseconds: live.heartbeatIntervalMilliseconds,
    ...(live.pointCommitProofAfterTransactionStep === undefined
      ? {}
      : {
        pointCommitProofAfterTransactionStep:
          live.pointCommitProofAfterTransactionStep,
      }),
  });
}

function decodeInput<A>(
  decode: (input: unknown) => Result.Result<A, unknown>,
  input: unknown,
  field: "functionRef" | "requestKey",
) {
  return Effect.fromResult(decode(input)).pipe(
    Effect.mapError(cause => new ApplicationMutationInputError({
      field,
      cause,
    })),
  );
}

function claimApplicationMutationAuthenticatedIdentity(
  input: unknown,
): Result.Result<
  ApplicationMutationAuthenticatedIdentityState,
  ApplicationMutationInputError
> {
  if (typeof input !== "object" || input === null) {
    return Result.fail(new ApplicationMutationInputError({
      field: "identity",
    }));
  }
  const state = authenticatedIdentityStates.get(input);
  return state === undefined
    ? Result.fail(new ApplicationMutationInputError({ field: "identity" }))
    : Result.succeed(state);
}

function transactionGrantAuthFromExecutionIdentity(
  identity: ExecutionIdentity,
): TransactionGrantInertAuthV1 {
  if (identity.kind === "anonymous") {
    return Object.freeze({ kind: "anonymous" as const });
  }
  const user = identity.user;
  const claims: Record<string, Json> = {};
  for (const [key, value] of Object.entries(user)) {
    if (
      key === "tokenIdentifier" ||
      key === "issuer" ||
      key === "subject" ||
      value === undefined
    ) continue;
    Object.defineProperty(claims, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value: freezeOwnedIdentityJson(value),
    });
  }
  return Object.freeze({
    kind: "verifiedBearer" as const,
    issuer: user.issuer,
    subject: user.subject,
    tokenIdentifier: user.tokenIdentifier,
    claims: Object.freeze(claims),
  });
}

function freezeOwnedIdentityJson(value: Json): Json {
  if (Array.isArray(value)) {
    for (const member of value) freezeOwnedIdentityJson(member);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) {
      freezeOwnedIdentityJson(member);
    }
    return Object.freeze(value);
  }
  return value;
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  Schema.toType(TransactionFunctionPathV1Schema),
);
const decodeRequestKey = Schema.decodeUnknownResult(
  Schema.toType(TransactionRequestKeyV1Schema),
);

type PointMutationArgsValidator = Parameters<
  typeof canonicalizePointMutationArgumentsV1
>[0];

function pointMutationArgsValidator(
  value: typeof import("flarex-protocol/validator-json").ValidatorJsonV1.Type,
): Result.Result<PointMutationArgsValidator, ApplicationMutationInputError> {
  return decodePointMutationArgsValidator(value).pipe(
    Result.mapError(cause => new ApplicationMutationInputError({
      field: "arguments",
      cause,
    })),
  );
}

const decodePointMutationArgsValidator = Schema.decodeUnknownResult(
  Schema.Union([
    ObjectValidatorJsonV1,
    Schema.Struct({ type: Schema.Literal("any") }),
  ]),
);

function outcomeLookup(
  payload: ReturnType<
    typeof inspectVerifiedApplicationMutationGrantV1
  >["payload"],
) {
  return Object.freeze({
    scopeUuid: projectScopeIdUuidV1(payload.scopeId).scopeUuid,
    requestKey: payload.requestKey,
    expectedIdentityAccessPolicySha256:
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
        TransactionGrantIdentityAccessPolicySha256HexV1Schema.make(
          payload.identityAccessPolicySha256,
        ),
      ),
    expectedFunctionPath: TransactionFunctionPathV1Schema.make(
      payload.functionPath,
    ),
    expectedRequestSha256: transactionGrantRequestSha256BytesV1FromHex(
      TransactionGrantRequestSha256HexV1Schema.make(
        payload.requestSha256,
      ),
    ),
  });
}

const outcomeFromResolution = Effect.fn(
  "ApplicationMutation.outcomeFromResolution",
)(function* (
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
): Effect.fn.Return<
  AuthoritativeCommittedApplicationMutationOutcome,
  ApplicationMutationOutcomeUnavailableError
> {
  if (outcome.kind === "expired") {
    return yield* new ApplicationMutationOutcomeUnavailableError({
      reason: "expired",
    });
  }
  if (outcome.kind === "missing") {
    return yield* Effect.die(
      new Error("A committed Application mutation had no durable outcome."),
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
