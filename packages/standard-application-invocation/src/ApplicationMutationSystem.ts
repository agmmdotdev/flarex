import { applicationFunctionEntryPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import {
  createPointMutationExecutionClaimVaultV1,
} from "@flarex/executor/internal/point-mutation-execution-claim-v1";
import type {
  PointMutationOccExecutionContextFactoryV1,
  PointMutationOccRuntimeNeutralRunnerV1,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  createPointMutationInitialExecutionV1,
  type PointMutationInitialExecutionV1Error,
} from "@flarex/executor/point-mutation-initial-execution";
import type { TransactionGrantVerifierV1 } from
  "@flarex/executor/transaction-grant";
import { createPointMutationJournalV1 } from
  "@flarex/executor/point-mutation-journal";
import {
  createApplicationMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
  type ApplicationMutationSessionActivationExecutionV1Error,
} from "@flarex/executor/point-mutation-session";
import type {
  ApplicationExecutionHost,
} from "flarex-backend/internal/application-execution-host";
import type {
  ApplicationAnalysisSourceReader,
} from "flarex-backend/internal/application-analysis-source-reader";
import {
  claimApplicationActiveSelection,
  type ApplicationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation";
import type {
  ApplicationSchemaAuthorityPublisher,
} from "@flarex/persistence-postgres/internal/application-schema-authority";
import {
  deriveApplicationMutationSyscallValidator,
  type InvalidApplicationRevisionSyscallValidatorV1Error,
} from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { createStoredAttemptEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/internal/stored-attempt-evidence-v1";
import { createStoredCommitAuthorityEvidenceLoaderV1 } from
  "@flarex/persistence-postgres/internal/stored-commit-authority-evidence-v1";
import {
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  createPointCommitFinishingTransitionPortV1,
  createPointMutationAttemptReplacementPortV1,
  hasPointCommitAuthorityBindingV1,
  type CommittedPointOutcomeResolutionV1,
  type PointCommitOutcomeResolutionV1Error,
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitPublisherPortV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  createSessionJournalStorePersistenceV1,
  hasAppDeveloperIndexQueryAuthorityV1,
  hasAppDeveloperIndexQuerySchemaAuthorityCompositionV1,
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
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Context, Data, Effect, Layer, Result, Schema, Scope } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  inspectVerifiedApplicationMutationGrantV1,
  type ApplicationMutationGrantV1Error,
  type ApplicationMutationGrantVerifierNamespaceV1,
  type VerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  canonicalizePointMutationArgumentsV1,
  canonicalizePointMutationRequestV1,
  PointMutationTargetSelectionV1Error,
  PointMutationTargetFunctionMetadataV1Schema,
} from "flarex-protocol/point-mutation-start";
import { ValidatorValueErrorV1 } from "flarex-protocol/validator-engine";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
} from "flarex-protocol/value";
import type { GrantRetentionPolicyV1 } from
  "flarex-protocol/grant-retention-policy";
import {
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import {
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  canonicalizeTransactionGrantIdentityAccessPolicyV1Effect,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  type CanonicalTransactionGrantIdentityAccessPolicyV1,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import type { Json } from "flarex-protocol/json";

import {
  makeApplicationMutationRuntimeNeutralRunner,
} from "./ApplicationMutationRunner";

export interface ApplicationMutationGrantIssueInput {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly executionAuthority:
    CanonicalApplicationMutationExecutionAuthorityV1;
  readonly identityAccessPolicy:
    CanonicalTransactionGrantIdentityAccessPolicyV1;
  readonly validatedArgsSha256: string;
  readonly requestKey: TransactionRequestKeyV1;
  readonly requestSha256: string;
}

export class ApplicationMutationGrantIssuanceError extends Data.TaggedError(
  "ApplicationMutationGrantIssuanceError",
)<{
  readonly reason: "unavailable" | "rejected";
  readonly cause?: unknown;
}> {}

export interface ApplicationMutationGrantIssuer {
  readonly issue: (
    input: ApplicationMutationGrantIssueInput,
  ) => Effect.Effect<
    VerifiedApplicationMutationGrantV1,
    ApplicationMutationGrantIssuanceError
  >;
}

export interface ApplicationMutationSystemLive {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly activation: Pick<
    ApplicationActivationRepository<never, never>,
    "readActive"
  >;
  readonly schema: Pick<ApplicationSchemaAuthorityPublisher<never>, "readPublished">;
  readonly grantIssuer: ApplicationMutationGrantIssuer;
  readonly applicationGrantVerifier:
    ApplicationMutationGrantVerifierNamespaceV1;
  /**
   * Registered compatibility verifier required by the shared generation-aware
   * commit-authentication engine. Application sessions never invoke it.
   */
  readonly legacyGrantVerifier: TransactionGrantVerifierV1;
  readonly source: ApplicationAnalysisSourceReader;
  readonly host: Pick<ApplicationExecutionHost, "runTransaction">;
  readonly sessionAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly pointCommit:
    PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1;
  readonly indexedQueries: AppDeveloperIndexQueryPortV1;
  readonly grantRetentionPolicy: GrantRetentionPolicyV1;
  readonly randomUuid: () => string;
  readonly executionContextFactory: PointMutationOccExecutionContextFactoryV1;
  readonly leaseDurationMilliseconds: number;
  readonly claimDurationMilliseconds: number;
  readonly leaseRenewalDurationMilliseconds: number;
  readonly heartbeatIntervalMilliseconds: number;
}

export interface AuthoritativeCommittedApplicationMutationOutcome {
  readonly status: "committed";
  readonly disposition: "published" | "replayed";
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly commitSeq: bigint;
  readonly value: Json;
}

export class ApplicationMutationInputError extends Data.TaggedError(
  "ApplicationMutationInputError",
)<{
  readonly field: "functionRef" | "requestKey" | "arguments";
  readonly cause?: unknown;
}> {}

export class ApplicationMutationCompositionError extends Data.TaggedError(
  "ApplicationMutationCompositionError",
)<{
  readonly reason:
    | "activeSelectionInvalid"
    | "deploymentMismatch"
    | "functionMissing"
    | "functionNotPublicMutation"
    | "indexedQueryAuthorityMismatch"
    | "pointCommitAuthorityMismatch"
    | "schemaAuthorityMismatch"
    | "schemaMismatch"
    | "runtimeTargetInvalid"
    | "executionAuthorityInvalid";
  readonly cause?: unknown;
}> {}

export class ApplicationMutationOutcomeUnavailableError
  extends Data.TaggedError("ApplicationMutationOutcomeUnavailableError")<{
    readonly reason: "expired" | "inProgress";
  }> {}

export type InvokeApplicationMutationError =
  | Effect.Error<
      ReturnType<ApplicationMutationSystemLive["activation"]["readActive"]>
    >
  | Effect.Error<
      ReturnType<ApplicationMutationSystemLive["schema"]["readPublished"]>
    >
  | Effect.Error<
      ReturnType<
        typeof canonicalizeTransactionGrantIdentityAccessPolicyV1Effect
      >
    >
  | ApplicationMutationGrantV1Error
  | ApplicationMutationGrantIssuanceError
  | ApplicationMutationInputError
  | ApplicationMutationCompositionError
  | ApplicationMutationOutcomeUnavailableError
  | InvalidApplicationRevisionSyscallValidatorV1Error
  | ApplicationMutationSessionActivationExecutionV1Error
  | PointCommitOutcomeResolutionV1Error
  | PointMutationInitialExecutionV1Error;

export interface ApplicationMutationInvoke {
  (
    functionRef: TransactionFunctionPathV1,
    args: unknown,
    requestKey: TransactionRequestKeyV1,
  ): Effect.Effect<
    AuthoritativeCommittedApplicationMutationOutcome,
    InvokeApplicationMutationError,
    Scope.Scope
  >;
}

export interface ApplicationMutationSystemApi {
  readonly invoke: ApplicationMutationInvoke;
}

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

export function makeApplicationMutationSystemLayer(
  live: ApplicationMutationSystemLive,
): Layer.Layer<ApplicationMutationSystem, ApplicationMutationCompositionError> {
  const captured = captureLive(live);
  return Layer.effect(
    ApplicationMutationSystem,
    Effect.gen(function* () {
      if (!hasPointCommitAuthorityBindingV1(
        captured.pointCommit,
        captured.sessionAuthority,
      )) return yield* composition("pointCommitAuthorityMismatch");
      if (!hasAppDeveloperIndexQueryAuthorityV1(
        captured.indexedQueries,
        captured.sessionAuthority,
      )) return yield* composition("indexedQueryAuthorityMismatch");
      if (!hasAppDeveloperIndexQuerySchemaAuthorityCompositionV1(
        captured.indexedQueries,
        captured.schema,
      )) return yield* composition("schemaAuthorityMismatch");
      const runner = yield* makeApplicationMutationRuntimeNeutralRunner({
        legacy: APPLICATION_ONLY_LEGACY_RUNNER,
        source: captured.source,
        host: captured.host,
      });
      return ApplicationMutationSystem.of({
        invoke: makeInvoke(captured, runner),
      });
    }),
  );
}

function makeInvoke(
  live: ApplicationMutationSystemLive,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
): ApplicationMutationInvoke {
  return Effect.fn("ApplicationMutationSystem.invoke")(function* (
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
    const active = yield* live.activation.readActive();
    const basis = yield* Effect.fromResult(
      claimApplicationActiveSelection(active.selection).pipe(
        Result.mapError(cause => composition("activeSelectionInvalid", cause)),
      ),
    );
    if (basis.deploymentId !== live.deploymentId) {
      return yield* composition("deploymentMismatch");
    }
    const matching = basis.manifest.functions.filter(
      candidate => candidate.path === functionRef,
    );
    if (matching.length !== 1) return yield* composition("functionMissing");
    const fn = matching[0]!;
    if (fn.kind !== "mutation" || fn.visibility !== "public") {
      return yield* composition("functionNotPublicMutation");
    }
    const functionMetadata = yield* decodeFunctionMetadata({
      path: fn.path,
      executionModule: fn.moduleName,
      kind: fn.kind,
      visibility: fn.visibility,
      argsValidator: fn.args,
      returnsValidator: fn.returns,
    }).pipe(Effect.mapError(cause =>
      composition("functionNotPublicMutation", cause)
    ));
    const schema = yield* live.schema.readPublished({
      deploymentId: live.deploymentId,
      manifest: basis.manifest,
    });
    if (
      schema.schemaVersionId !== basis.schemaVersionId ||
      schema.applicationSchemaSha256 !==
        encodeBytesToLowercaseHex(basis.applicationSchemaSha256) ||
      schema.schemaManifestSha256 !==
        encodeBytesToLowercaseHex(basis.schemaManifestSha256)
    ) return yield* composition("schemaMismatch");
    const argumentsEvidence = yield* Effect.tryPromise({
      try: () => canonicalizePointMutationArgumentsV1(
        functionMetadata.argsValidator,
        args,
        schema.manifest,
      ),
      catch: cause => {
        if (
          cause instanceof PointMutationTargetSelectionV1Error ||
          cause instanceof ValidatorValueErrorV1
        ) {
          return new ApplicationMutationInputError({
            field: "arguments",
            cause,
          });
        }
        throw cause;
      },
    });
    const request = yield* Effect.promise(() => canonicalizePointMutationRequestV1({
      deploymentId: live.deploymentId,
      functionPath: functionRef,
      validatedArgsSha256: argumentsEvidence.sha256,
      requestKey,
    }));
    const entryBytes = yield* Effect.fromResult(
      applicationFunctionEntryPublicationFrameV1(fn).pipe(
        Result.mapError(cause => composition("runtimeTargetInvalid", cause)),
      ),
    );
    const entrySha256 = encodeBytesToLowercaseHex(
      new Uint8Array(yield* Effect.promise(() =>
        globalThis.crypto.subtle.digest(
          "SHA-256",
          copyBytesToArrayBuffer(entryBytes),
        )
      )),
    );
    const runtimeTarget = yield* Effect.fromResult(
      canonicalizeApplicationRuntimeTargetV1({
        format: "flarex.application-runtime-target",
        version: 1,
        scopeId: basis.authority.scopeId,
        revisionId: basis.revisionId,
        candidateId: basis.candidateId,
        analysisId: basis.analysisId,
        sourceArtifactRootSha256:
          encodeBytesToLowercaseHex(basis.sourceArtifactRootSha256),
        manifestSha256: encodeBytesToLowercaseHex(basis.manifestSha256),
        schemaSha256:
          encodeBytesToLowercaseHex(basis.applicationSchemaSha256),
        functionCatalogSha256:
          encodeBytesToLowercaseHex(basis.functionCatalogSha256),
        publicationSha256:
          encodeBytesToLowercaseHex(basis.publicationSha256),
        executionModulePath:
          basis.manifest.sourceArtifact.executionModulePath,
        function: { ...fn, entrySha256 },
      }).pipe(Result.mapError(cause =>
        composition("runtimeTargetInvalid", cause)
      )),
    );
    const authority = yield* canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256: encodeBytesToLowercaseHex(
        new Uint8Array(yield* Effect.promise(() =>
          globalThis.crypto.subtle.digest(
            "SHA-256",
            copyBytesToArrayBuffer(runtimeTarget.canonicalBytes),
          )
        )),
      ),
      activationSequence: basis.activationSequence.toString(),
      activeHeadSha256: encodeBytesToLowercaseHex(basis.headSha256),
      schemaVersionId: basis.schemaVersionId,
    }).pipe(Effect.mapError(cause =>
      composition("executionAuthorityInvalid", cause)
    ));
    const policy = yield* canonicalizeTransactionGrantIdentityAccessPolicyV1Effect({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const lookup = Object.freeze({
      scopeUuid: projectScopeIdUuidV1(
        decodeReplacementScopeIdV1(basis.authority.scopeId),
      ).scopeUuid,
      requestKey,
      expectedIdentityAccessPolicySha256:
        transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
          policy.sha256Hex,
        ),
      expectedFunctionPath: functionRef,
      expectedRequestSha256: request.sha256,
    });
    const existing = yield* live.pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
      live.deploymentId,
      lookup,
    );
    if (existing.kind !== "missing") {
      return yield* outcomeFromResolution(existing, "replayed");
    }
    const verifiedGrant = yield* live.grantIssuer.issue({
      deploymentId: live.deploymentId,
      executionAuthority: authority,
      identityAccessPolicy: policy,
      validatedArgsSha256: encodeBytesToLowercaseHex(argumentsEvidence.sha256),
      requestKey,
      requestSha256: encodeBytesToLowercaseHex(request.sha256),
    });
    const grant = yield* Effect.try({
      try: () => inspectVerifiedApplicationMutationGrantV1(verifiedGrant),
      catch: cause => new ApplicationMutationGrantIssuanceError({
        reason: "rejected",
        cause,
      }),
    });
    const syscallValidator = yield* deriveApplicationMutationSyscallValidator(
      active.selection,
      schema,
    );
    const claims = createPointMutationExecutionClaimVaultV1();
    const activated = yield* createApplicationMutationSessionActivationV1(
      createApplicationMutationSessionActivationPersistenceV1(
        live.sessionAuthority,
        {
          leaseDurationMilliseconds: live.leaseDurationMilliseconds,
          randomUuid: live.randomUuid,
        },
      ),
      claims.issuer,
    ).activate(Object.freeze({
      deploymentId: live.deploymentId,
      scopeId: decodeReplacementScopeIdV1(basis.authority.scopeId),
      activeSelection: active.selection,
      evidence: Object.freeze({
        executionAuthority: authority.authority,
        verifiedGrant,
        functionPath: functionRef,
        functionKind: TransactionFunctionKindV1Schema.make("mutation"),
        schemaVersionId: basis.schemaVersionId,
        policyVersion: TransactionPolicyVersionV1Schema.make(
          grant.payload.policyVersion,
        ),
        identityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
              policy.sha256Hex,
            ),
          ),
        validatedArgsJson: argumentsEvidence.valueJson,
        validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
        validatedArgsCanonicalBytes: argumentsEvidence.canonicalBytes,
        validatedArgsSha256: argumentsEvidence.sha256,
        requestKey,
        requestSha256: request.sha256,
      }),
    }));
    if (inspectActivatedPointMutationSessionV1(activated).status !== "created") {
      const replay = yield* live.pointCommit[RESOLVE_POINT_COMMIT_OUTCOME_V1](
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
      claims.admission,
    );
    const execution = createPointMutationInitialExecutionV1(
      createStoredAttemptEvidenceLoaderV1(live.sessionAuthority),
      {
        evidenceLoader:
          createStoredCommitAuthorityEvidenceLoaderV1(live.sessionAuthority),
        transactionGrantVerifier: live.legacyGrantVerifier,
        applicationMutationGrantVerifier: live.applicationGrantVerifier,
        functionMetadata: {
          load: () => Effect.die(
            new Error("Application mutation requested legacy metadata."),
          ),
        },
        pointCommit: live.pointCommit,
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
            claims.admission,
            syscallValidator,
          ),
          terminalization,
          contextFactory: live.executionContextFactory,
          runner,
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
      claims,
    );
    const result = yield* execution.executeInitialPointMutationAttempt(activated);
    if (result.kind === "expired") {
      return yield* new ApplicationMutationOutcomeUnavailableError({
        reason: "expired",
      });
    }
    const authoritative = yield* live.pointCommit[
      RESOLVE_POINT_COMMIT_OUTCOME_V1
    ](live.deploymentId, lookup);
    return yield* outcomeFromResolution(authoritative, result.kind);
  });
}

const outcomeFromResolution = Effect.fn(
  "ApplicationMutation.outcomeFromResolution",
)(function* (
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
) {
  if (outcome.kind === "expired") {
    return yield* new ApplicationMutationOutcomeUnavailableError({
      reason: "expired",
    });
  }
  if (outcome.kind === "missing") {
    return yield* new ApplicationMutationOutcomeUnavailableError({
      reason: "inProgress",
    });
  }
  return Object.freeze({
    status: "committed" as const,
    disposition,
    scopeUuid: outcome.token.scopeUuid,
    epochUuid: outcome.token.epochUuid,
    commitSeq: outcome.token.commitSeq,
    value: structuredClone(outcome.successfulResult.valueJson),
  } satisfies AuthoritativeCommittedApplicationMutationOutcome);
});

function decodeInput<A>(
  decode: (input: unknown) => Result.Result<A, unknown>,
  input: unknown,
  field: ApplicationMutationInputError["field"],
) {
  return Effect.fromResult(decode(input)).pipe(
    Effect.mapError(() => new ApplicationMutationInputError({ field })),
  );
}

const decodeFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeRequestKey = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);
const decodeFunctionMetadata = Schema.decodeUnknownEffect(
  PointMutationTargetFunctionMetadataV1Schema,
);

function composition(
  reason: ApplicationMutationCompositionError["reason"],
  cause?: unknown,
): ApplicationMutationCompositionError {
  return new ApplicationMutationCompositionError({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function captureLive(
  live: ApplicationMutationSystemLive,
): ApplicationMutationSystemLive {
  return Object.freeze({
    deploymentId: live.deploymentId,
    activation: Object.freeze({ readActive: live.activation.readActive }),
    schema: live.schema,
    grantIssuer: Object.freeze({ issue: live.grantIssuer.issue }),
    applicationGrantVerifier: live.applicationGrantVerifier,
    legacyGrantVerifier: live.legacyGrantVerifier,
    source: Object.freeze({ read: live.source.read }),
    host: Object.freeze({ runTransaction: live.host.runTransaction }),
    sessionAuthority: live.sessionAuthority,
    pointCommit: live.pointCommit,
    indexedQueries: live.indexedQueries,
    grantRetentionPolicy: live.grantRetentionPolicy,
    randomUuid: live.randomUuid,
    executionContextFactory: live.executionContextFactory,
    leaseDurationMilliseconds: live.leaseDurationMilliseconds,
    claimDurationMilliseconds: live.claimDurationMilliseconds,
    leaseRenewalDurationMilliseconds: live.leaseRenewalDurationMilliseconds,
    heartbeatIntervalMilliseconds: live.heartbeatIntervalMilliseconds,
  });
}

const APPLICATION_ONLY_LEGACY_RUNNER: PointMutationOccRuntimeNeutralRunnerV1 =
  Object.freeze({
    run: () => Effect.die(
      new Error("Application mutation system rejected legacy runtime authority."),
    ),
  });
