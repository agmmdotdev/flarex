import {
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { and, desc, eq } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Scope } from "effect";
import type {
  PreparedStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import {
  canonicalizeSchemaManifestV1,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1,
} from "flarex-protocol/internal/declarative-v2-runtime-projection-v1";
import type {
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import type { ScopeId } from "flarex-protocol/storage-authority";

import {
  type PrepareAppSchemaPublicationV1Error,
  type PreparedAppSchemaPublicationV1,
  prepareAppSchemaPublicationV1Effect,
  getPreparedAppSchemaPublicationV1StateResult,
} from "./appSchemaPublicationPreparation";
import {
  publishPreparedAppSchemaV1InTransactionEffect,
  type PublishPreparedAppSchemaV1InTransactionError,
} from "./appSchemaPublicationTransaction";
import type { AppRowTransaction } from "./appRows";
import {
  ApplicationRevisionRegistrationIdentityV1Error,
  ApplicationRevisionRegistrationRequestKeyV1Error,
  decodeApplicationRevisionRegistrationRequestKeyV1,
  deriveApplicationRevisionRegistrationClaimSha256V1,
  deriveSchemaBindingSha256V1,
  deriveSystemExecutionArtifactSha256V1,
  deriveSystemFunctionIdentityV1,
  deriveSystemSourcePackageSha256V1,
  SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1,
  SYSTEM_SOURCE_CODEC_IDENTITY_V1,
  validateRegistrationFramesAgainstFunctionMetadataV1,
  type ApplicationRevisionRegistrationIdentityErrorV1,
  type ApplicationRevisionRegistrationRequestKeyV1,
  type SystemFunctionIdentityV1,
} from "./applicationRevisionRegistrationIdentitiesV1";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  type CandidateRuntimeArtifactPublisherV1,
  type CandidateRuntimePublicationV1,
  type PrepareCandidateRuntimePublicationV1Error,
  type PublishCandidateRuntimeArtifactsV1Error,
  prepareCandidateRuntimePublicationV1,
  publishCandidateRuntimeArtifactsV1,
} from "./candidateRuntimeProjectionV1";
import {
  makeCandidateRuntimePublicationRepositoryV1,
  type CandidateRuntimePublicationRepositoryV1Error,
} from "./candidateRuntimePublicationRepositoryV1";
import {
  makeDeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryOperationBudgetV2,
  type DeclarativeV2VerifierProgressRepositoryOptionsV2,
  type DeclarativeV2VerifierProgressRepositoryV2,
  type DeclarativeV2VerifierProgressRepositoryV2Error,
  type DeclarativeV2VerifierProgressSettlementSnapshotV2,
} from "./declarativeV2VerifierProgressRepositoryV2";

import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  type FunctionMetadataOperationBudgetV1,
} from "./functionMetadataCodec";
import type { FunctionMetadataSha256V1Error } from "./functionMetadataSha256";
import {
  getScopeClock,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
} from "./scopeClock";
import {
  prepareSchemaManifestAppSchemaBindingsV1Effect,
  type PrepareSchemaManifestAppSchemaBindingsV1Error,
} from "./schemaManifestAppSchemaBindings";
import {
  fxControlSchemaVersions,
  fxSystemApplicationRevisionRequestsV1,
  fxSystemApplicationRevisionsV1,
  fxSystemDeclarativeV2Candidates,
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandsV2,
} from "./schema";

import {
  getPreparedSchemaVersionArtifactEvidenceResult,
  SchemaVersionArtifactPreparationError,
  type PreparedSchemaVersionArtifactEvidenceV1,
} from "./schemaVersionArtifacts";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  captureScopePhysicalLocator,
} from "./scopePhysicalLocator";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

interface LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1 {
  readonly result: Readonly<{
    readonly registrationFrames: ReadonlyArray<Uint8Array>;
    readonly registrationRootSha256: Uint8Array;
    readonly outputManifestBytes: Uint8Array;
    readonly nextProgressBytes: Uint8Array;
  }>;
}

const REGISTRATION_TARGET_DB: unique symbol = Symbol(
  "FlarexDB/applicationRevisionRegistrationTargetDbV1",
);
const SHA256_BYTES = 32;
const FUNCTION_METADATA_CODEC_VERSION = 1;
const MAX_SCHEMA_VERSION = 2_147_483_647;
const REGISTRATION_RETRY_ATTEMPTS = 3;
const PREPARATION_HASH_BUDGET = Object.freeze({
  maximumCalls: 32,
  maximumFrameBytes: 16 * 1_048_576,
  maximumCanonicalBytes: 16 * 1_048_576,
  maximumHashBytes: 16 * 1_048_576,
});
const PROGRESS_OPERATION_BUDGET: DeclarativeV2VerifierProgressRepositoryOperationBudgetV2 =
  Object.freeze({
    maximumCalls: 64,
    maximumRows: 64,
    maximumFrameBytes: 16 * 1_048_576,
    maximumCanonicalBytes: 16 * 1_048_576,
    maximumHashBytes: 16 * 1_048_576,
    maximumElapsedMilliseconds: 60_000,
  });

export interface LocatedApplicationRevisionRegistrationTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [REGISTRATION_TARGET_DB]: FlarexMetadataDatabase;
}

export function createLocatedApplicationRevisionRegistrationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted:
    RunLocatedReadCommittedTransactionV1 =
      createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedApplicationRevisionRegistrationTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [REGISTRATION_TARGET_DB]: db,
  });
}

export interface ApplicationRevisionAuthenticatedSourceModuleV1 {
  readonly ordinal: number;
  readonly artifactModulePath: string;
  readonly roles: number;
  readonly sourceByteLength: number;
  readonly sourceSha256: Uint8Array;
}

export interface ApplicationRevisionCandidateEvidenceProjectionV1 {
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceRootSha256: Uint8Array;
  readonly sourceSelectorSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly semanticSelectorSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly sourceModules:
    ReadonlyArray<ApplicationRevisionAuthenticatedSourceModuleV1>;
  readonly semanticByteLength: number;
  readonly semanticStreamSha256: Uint8Array;
  readonly semanticModelIdentity: string;
  readonly semanticCodecIdentity: string;
  readonly semanticPolicyIdentity: string;
  readonly coreLanguageIdentity: string;
  readonly abiIdentity: string;
  readonly grammarIdentity: string;
  readonly unicodeIdentity: string;
  readonly parserTableIdentity: string;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly deploymentAnalysisCodecIdentity: string;
  readonly deploymentAnalysisByteLength: bigint;
  readonly deploymentAnalysisSha256: Uint8Array;
  readonly deploymentCodegenAnalysisCodecIdentity: string;
  readonly deploymentCodegenAnalysisByteLength: bigint;
  readonly deploymentCodegenAnalysisSha256: Uint8Array;
}

export interface ApplicationRevisionRegistrationCommandReceiptV1 {
  readonly commandKind: "registration_page";
  readonly sequence: bigint;
  readonly attemptSha256: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly reservationSha256: Uint8Array;
  readonly requestSha256: Uint8Array;
  readonly canonicalByteLength: number;
  readonly freshAuthenticatedInputSha256: Uint8Array;
  readonly commandInputSha256: Uint8Array;
  readonly rangeAndPredecessorTailsSha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
}

export interface PrepareApplicationRevisionAnalysisV1Input {
  readonly preparedDefinition: PreparedStandardApplicationDefinitionV1;
  readonly authenticatedEvidence: unknown;
  readonly attemptCeilings: DeclarativeV2VerifierBudgetFrameV2 & {
    readonly kind: "attempt_ceilings";
  };
}

/**
 * Private composition authority. Request callers carry only opaque values;
 * this context-owned port is the sole structural projection boundary.
 */
export interface ApplicationRevisionRegistrationEvidenceAuthorityV1 {
  readonly claimCandidate: (
    preparedDefinition: PreparedStandardApplicationDefinitionV1,
    authority: unknown,
  ) => Result.Result<
    ApplicationRevisionCandidateEvidenceProjectionV1,
    ApplicationRevisionRegistrationEvidenceV1Error
  >;
  readonly claimCommand: (
    preparation: PrivateApplicationRevisionAnalysisPreparationV1,
    authority: unknown,
  ) => Result.Result<
    ApplicationRevisionRegistrationCommandReceiptV1,
    ApplicationRevisionRegistrationEvidenceV1Error
  >;
}

const PrivateApplicationRevisionAnalysisPreparationV1Brand: unique symbol =
  Symbol("FlarexDB/privateApplicationRevisionAnalysisPreparationV1");

export interface PrivateApplicationRevisionAnalysisPreparationV1 {
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly [PrivateApplicationRevisionAnalysisPreparationV1Brand]: true;
}

export class ApplicationRevisionRegistrationContextV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationContextV1Error")<{
    readonly reason:
      | "unrecognizedPreparation"
      | "unrecognizedAnalysis"
      | "wrongContext"
      | "alreadyCorrelated";
  }> {}

export class ApplicationRevisionRegistrationEvidenceV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationEvidenceV1Error")<{
    readonly reason:
      | "authorityChanged"
      | "candidateMissing"
      | "candidateMismatch"
      | "attemptMissing"
      | "attemptMismatch"
      | "terminalCommandMissing"
      | "terminalCommandMismatch"
      | "authenticatedCorrelationMismatch"
      | "manifestMismatch"
      | "receiptMismatch"
      | "registrationRootMismatch"
      | "schemaPreparationChanged";
    readonly path?: string;
  }> {}

export class ApplicationRevisionRegistrationRequestConflictV1Error
  extends Data.TaggedError(
    "ApplicationRevisionRegistrationRequestConflictV1Error",
  )<{
    readonly reason: "requestKeyReuse" | "revisionClaimMismatch";
    readonly scopeId: string;
  }> {}

export class ApplicationRevisionRegistrationStoredStateV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationStoredStateV1Error")<{
    readonly reason:
      | "revision"
      | "receipt"
      | "function"
      | "registrationEvidence";
    readonly scopeId: string;
  }> {}

export class ApplicationRevisionRegistrationConfirmedRollbackV1Error
  extends Data.TaggedError(
    "ApplicationRevisionRegistrationConfirmedRollbackV1Error",
  )<{
    readonly cause: unknown;
    readonly retryable: boolean;
  }> {}

export class ApplicationRevisionRegistrationDecisionUncertainV1Error
  extends Data.TaggedError(
    "ApplicationRevisionRegistrationDecisionUncertainV1Error",
  )<{
    readonly scopeId: string;
    readonly requestKey: string;
    readonly registrationInputSha256: Uint8Array;
    readonly cause: unknown;
  }> {}

export class ApplicationRevisionRegistrationResourceV1Error
  extends Data.TaggedError("ApplicationRevisionRegistrationResourceV1Error")<{
    readonly phase: "preparation" | "infrastructure" | "cleanup";
    readonly cause: unknown;
  }> {}

export type PrepareApplicationRevisionAnalysisV1Error =
  | TrustedScopeAuthorityError
  | PrepareSchemaManifestAppSchemaBindingsV1Error
  | PrepareAppSchemaPublicationV1Error
  | ApplicationRevisionRegistrationIdentityErrorV1
  | ApplicationRevisionRegistrationEvidenceV1Error
  | ApplicationRevisionRegistrationResourceV1Error
  | PrepareCandidateRuntimePublicationV1Error
  | PublishCandidateRuntimeArtifactsV1Error
  | CandidateRuntimePublicationRepositoryV1Error
  | DeclarativeV2VerifierProgressRepositoryV2Error;

export type RegisterApplicationRevisionV1Error =
  | ApplicationRevisionRegistrationRequestKeyV1Error
  | ApplicationRevisionRegistrationContextV1Error
  | ApplicationRevisionRegistrationEvidenceV1Error
  | ApplicationRevisionRegistrationRequestConflictV1Error
  | ApplicationRevisionRegistrationStoredStateV1Error
  | ApplicationRevisionRegistrationConfirmedRollbackV1Error
  | ApplicationRevisionRegistrationDecisionUncertainV1Error
  | ApplicationRevisionRegistrationResourceV1Error
  | TrustedScopeAuthorityError
  | DeclarativeV2VerifierProgressRepositoryV2Error
  | LockScopeClockForUpdateError
  | PublishPreparedAppSchemaV1InTransactionError
  | FunctionMetadataSha256V1Error
  | DeclarativeV2Sha256V1Error;

export interface DurableRegisteredApplicationRevisionV1 {
  readonly kind: "registered" | "replayed";
  readonly revisionId: string;
  readonly deploymentId: string;
  readonly scopeId: string;
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly registrationInputSha256: Uint8Array;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly functionMetadataSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly registrationRootSha256: Uint8Array;
  readonly status: "inactive";
  readonly registeredAt: Date;
}

export interface ApplicationRevisionRegistrationContextV1 {
  readonly register: (
    verifiedAnalysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
    requestKey: unknown,
  ) => Effect.Effect<
    DurableRegisteredApplicationRevisionV1,
    RegisterApplicationRevisionV1Error,
    Scope.Scope
  >;
}

export interface PrivateApplicationRevisionRegistrationContextV1
  extends ApplicationRevisionRegistrationContextV1 {
  readonly prepareAnalysis: (
    input: PrepareApplicationRevisionAnalysisV1Input,
  ) => Effect.Effect<
    PrivateApplicationRevisionAnalysisPreparationV1,
    PrepareApplicationRevisionAnalysisV1Error,
    Scope.Scope
  >;
  readonly correlateAnalysis: (
    preparation: PrivateApplicationRevisionAnalysisPreparationV1,
    analysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
    authenticatedCommand: unknown,
  ) => Effect.Effect<
    void,
    | ApplicationRevisionRegistrationContextV1Error
    | ApplicationRevisionRegistrationEvidenceV1Error
    | DeclarativeV2VerifierProgressRepositoryV2Error,
    never
  >;
}

export interface MakeApplicationRevisionRegistrationContextV1Options {
  readonly authority:
    TrustedScopeAuthorityResolutionPorts<
      LocatedApplicationRevisionRegistrationTargetV1
    >;
  readonly functionMetadataBudget: FunctionMetadataOperationBudgetV1;
  readonly progressRepository: DeclarativeV2VerifierProgressRepositoryOptionsV2;
  readonly evidenceAuthority:
    ApplicationRevisionRegistrationEvidenceAuthorityV1;
  readonly runtimeArtifactPublisher: CandidateRuntimeArtifactPublisherV1;
}

interface PreparedRegistrationStateV1 {
  readonly authority: TrustedScopeAuthority;
  readonly target: LocatedApplicationRevisionRegistrationTargetV1;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly candidateCanonicalBytes: Uint8Array;
  readonly candidateSha256: Uint8Array;
  readonly attemptSha256: Uint8Array;
  readonly semanticAttemptIdentitySha256: Uint8Array;
  readonly analyzerIdentitySha256: Uint8Array;
  readonly verifierIdentitySha256: Uint8Array;
  readonly schemaPublication: PreparedAppSchemaPublicationV1;
  readonly schemaEvidence: PreparedSchemaVersionArtifactEvidenceV1;
  readonly schemaBindingSha256: Uint8Array;
  readonly functionIdentity: SystemFunctionIdentityV1;
  readonly moduleOrdinalByFunctionPath: ReadonlyMap<string, bigint>;
  readonly packageSha256: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly progress: DeclarativeV2VerifierProgressRepositoryV2;
  correlation: "prepared" | "correlating" | "correlated";
  analysis?: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1;
  command?: ApplicationRevisionRegistrationCommandReceiptV1;
  settlement?: DeclarativeV2VerifierProgressSettlementSnapshotV2;
  registrationFramesBytes?: Uint8Array;
}

interface CorrelatedRegistrationStateV1 extends PreparedRegistrationStateV1 {
  readonly analysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1;
  readonly command: ApplicationRevisionRegistrationCommandReceiptV1;
  readonly settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2;
  readonly registrationFramesBytes: Uint8Array;
}

export function makeApplicationRevisionRegistrationContextV1(
  options: MakeApplicationRevisionRegistrationContextV1Options,
): PrivateApplicationRevisionRegistrationContextV1 {
  const preparations = new WeakMap<
    PrivateApplicationRevisionAnalysisPreparationV1,
    PreparedRegistrationStateV1
  >();
  const analyses = new WeakMap<
    LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
    CorrelatedRegistrationStateV1
  >();

  const prepareAnalysis = Effect.fn(
    "ApplicationRevisionRegistration.prepareAnalysis",
  )(function* (
    input: PrepareApplicationRevisionAnalysisV1Input,
  ): Effect.fn.Return<
    PrivateApplicationRevisionAnalysisPreparationV1,
    PrepareApplicationRevisionAnalysisV1Error,
    Scope.Scope
  > {
    const evidence = yield* Effect.fromResult(
      options.evidenceAuthority.claimCandidate(
        input.preparedDefinition,
        input.authenticatedEvidence,
      ),
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      evidence.deploymentId,
      options.authority,
    );
    const target = located.target;
    const db = target[REGISTRATION_TARGET_DB];
    yield* validatePreparedMaterializationEvidence(
      input.preparedDefinition,
      evidence,
    );
    const schema = yield* prepareSchemaPublication(
      db,
      input.preparedDefinition,
      evidence.deploymentId,
    );
    const schemaBindingSha256 = yield* deriveSchemaBindingSha256V1({
      deploymentId: evidence.deploymentId,
      schemaVersionId: schema.publication.schemaVersionId,
      version: schema.publication.version,
      manifestCodecVersion: schema.evidence.manifestCodecVersion,
      manifestByteLength: BigInt(schema.evidence.manifestByteLength),
      schemaArtifactSha256: schema.evidence.manifestSha256,
    });
    const packageSha256 = yield* deriveSystemSourcePackageSha256V1(
      evidence.sourceRootSha256,
    );
    const artifactSha256 = yield* deriveSystemExecutionArtifactSha256V1({
      packageSha256,
      executionPath:
        input.preparedDefinition.artifactIngressPlan.source.executionPath,
      moduleBindings:
        input.preparedDefinition.artifactIngressPlan.source.functionEntries.map(
          (binding) => Object.freeze({
            logicalModulePath: binding.logicalModulePath,
            artifactModulePath: binding.artifactModulePath,
          }),
        ),
    });
    const functionMetadata = yield* Effect.fromResult(
      functionMetadataInput(input.preparedDefinition),
    );
    const moduleOrdinalByFunctionPath = yield* Effect.fromResult(
      registrationModuleOrdinals(input.preparedDefinition),
    );
    const functionIdentity = yield* deriveSystemFunctionIdentityV1(
      functionMetadata,
      options.functionMetadataBudget,
    );
    const runtimePublication = yield* prepareCandidateRuntimePublicationV1(
      input.preparedDefinition,
      functionIdentity,
    );
    const runtimePublishedAuthority = yield* publishCandidateRuntimeArtifactsV1(
      runtimePublication,
      options.runtimeArtifactPublisher,
    );
    const candidate = makeCandidateFrame(
      located.authority,
      evidence,
      packageSha256,
      artifactSha256,
      schema.evidence.manifestSha256,
      schemaBindingSha256,
      functionIdentity,
      runtimePublication,
    );
    const candidateCanonicalBytes = yield* Effect.fromResult(
      encodeDeclarativeV2PhysicalFrameV1(candidate, {
        maximumFrameBytes: PREPARATION_HASH_BUDGET.maximumFrameBytes,
        maximumCanonicalBytes:
          PREPARATION_HASH_BUDGET.maximumCanonicalBytes,
      }),
    ).pipe(
      Effect.map((encoded) => new Uint8Array(encoded.canonicalBytes)),
      Effect.orDie,
    );
    const candidateSha256 = yield* makeLiveDeclarativeV2Sha256V1()(
      candidateCanonicalBytes,
      { maximumInputBytes: candidateCanonicalBytes.byteLength },
    );
    const runtimeRepository =
      makeCandidateRuntimePublicationRepositoryV1(target);
    yield* runtimeRepository.publish({
      authority: located.authority,
      candidate,
      candidateSha256,
      candidateFrameBytes: candidateCanonicalBytes,
      publication: runtimePublication,
      publishedAuthority: runtimePublishedAuthority,
    });
    const inserted = Object.freeze({
      candidateSha256: new Uint8Array(candidateSha256),
    });
    const progress = makeDeclarativeV2VerifierProgressRepositoryV2(
      target,
      options.progressRepository,
    );
    const attempt = yield* progress.createAttempt({
      scopeId: located.authority.scopeId,
      candidateSha256: inserted.candidateSha256,
      ceilings: input.attemptCeilings,
    }, PROGRESS_OPERATION_BUDGET);
    const preparation = Object.freeze({
      candidateSha256: new Uint8Array(inserted.candidateSha256),
      attemptSha256: new Uint8Array(attempt.attemptSha256),
      [PrivateApplicationRevisionAnalysisPreparationV1Brand]: true as const,
    }) satisfies PrivateApplicationRevisionAnalysisPreparationV1;
    const state: PreparedRegistrationStateV1 = {
      authority: located.authority,
      target,
      candidate,
      candidateCanonicalBytes,
      candidateSha256: new Uint8Array(inserted.candidateSha256),
      attemptSha256: new Uint8Array(attempt.attemptSha256),
      semanticAttemptIdentitySha256:
        new Uint8Array(evidence.semanticAttemptIdentitySha256),
      analyzerIdentitySha256:
        new Uint8Array(evidence.analyzerIdentitySha256),
      verifierIdentitySha256:
        new Uint8Array(evidence.verifierIdentitySha256),
      schemaPublication: schema.publication,
      schemaEvidence: schema.evidence,
      schemaBindingSha256: new Uint8Array(schemaBindingSha256),
      functionIdentity,
      moduleOrdinalByFunctionPath,
      packageSha256: new Uint8Array(packageSha256),
      artifactSha256: new Uint8Array(artifactSha256),
      progress,
      correlation: "prepared",
    };
    preparations.set(preparation, state);
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      preparations.delete(preparation);
      if (state.analysis !== undefined) analyses.delete(state.analysis);
    }));
    return preparation;
  });

  const correlateAnalysis = Effect.fn(
    "ApplicationRevisionRegistration.correlateAnalysis",
  )(function* (
    preparation: PrivateApplicationRevisionAnalysisPreparationV1,
    analysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
    authenticatedCommand: unknown,
  ) {
    const state = preparations.get(preparation);
    if (state === undefined) {
      return yield* new ApplicationRevisionRegistrationContextV1Error({
        reason: "unrecognizedPreparation",
      });
    }
    if (state.correlation !== "prepared") {
      return yield* new ApplicationRevisionRegistrationContextV1Error({
        reason: "alreadyCorrelated",
      });
    }
    state.correlation = "correlating";
    yield* Effect.gen(function* () {
      const command = yield* Effect.fromResult(
        options.evidenceAuthority.claimCommand(
          preparation,
          authenticatedCommand,
        ),
      );
      yield* requireCommandCorrelation(state, command);
      const observed = yield* state.progress.observeCommandDecision({
        scopeId: state.authority.scopeId,
        attemptSha256: state.attemptSha256,
        sequence: command.sequence,
        reservationSha256: command.reservationSha256,
      }, PROGRESS_OPERATION_BUDGET);
      if (observed.decision.kind !== "settled") {
        return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
          reason: "terminalCommandMissing",
        });
      }
      yield* Effect.fromResult(validateTerminalCorrelation(
        state,
        analysis,
        command,
        observed.decision.settlement,
      ));
      state.analysis = analysis;
      state.command = snapshotCommand(command);
      state.settlement = observed.decision.settlement;
      state.registrationFramesBytes =
        encodeRegistrationFrames(analysis.result.registrationFrames);
      state.correlation = "correlated";
      const correlated = state as CorrelatedRegistrationStateV1;
      analyses.set(analysis, correlated);
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (
            Exit.isFailure(exit) &&
            state.correlation === "correlating"
          ) {
            state.correlation = "prepared";
          }
        })
      ),
    );
  });

  const register = Effect.fn(
    "ApplicationRevisionRegistration.register",
  )(function* (
    analysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
    rawRequestKey: unknown,
  ): Effect.fn.Return<
    DurableRegisteredApplicationRevisionV1,
    RegisterApplicationRevisionV1Error,
    Scope.Scope
  > {
    const requestKey = yield* Effect.fromResult(
      decodeApplicationRevisionRegistrationRequestKeyV1(rawRequestKey),
    );
    const state = analyses.get(analysis);
    if (state === undefined) {
      return yield* new ApplicationRevisionRegistrationContextV1Error({
        reason: "unrecognizedAnalysis",
      });
    }
    const claim = yield*
      deriveApplicationRevisionRegistrationClaimSha256V1(
        registrationClaim(state),
      ).pipe(
        Effect.catchTag(
          "ApplicationRevisionRegistrationIdentityV1Error",
          Effect.die,
        ),
      );
    return yield* runRegistrationTransaction(
      state,
      requestKey,
      claim,
    );
  });

  return Object.freeze({ prepareAnalysis, correlateAnalysis, register });
}

export const registerApplicationRevisionV1 = Effect.fn(
  "ApplicationRevisionRegistration.registerApplicationRevisionV1",
)(function* (
  verifiedAnalysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  context: ApplicationRevisionRegistrationContextV1,
): Effect.fn.Return<
  DurableRegisteredApplicationRevisionV1,
  RegisterApplicationRevisionV1Error,
  Scope.Scope
> {
  return yield* context.register(verifiedAnalysis, requestKey);
});

function validatePreparedMaterializationEvidence(
  prepared: PreparedStandardApplicationDefinitionV1,
  evidence: ApplicationRevisionCandidateEvidenceProjectionV1,
): Effect.Effect<
  void,
  | ApplicationRevisionRegistrationEvidenceV1Error
  | DeclarativeV2Sha256V1Error
> {
  const sha256 = makeLiveDeclarativeV2Sha256V1();
  return Effect.gen(function* () {
    const preparedModules = prepared.artifactIngressPlan.source.modules;
    if (
      evidence.sourceModules.length !== preparedModules.length ||
      !Number.isSafeInteger(evidence.semanticByteLength) ||
      evidence.semanticByteLength < 0 ||
      evidence.semanticByteLength !==
        prepared.artifactIngressPlan.semantic.bytes.byteLength ||
      !isUint8ArrayWithByteLength(
        evidence.semanticStreamSha256,
        SHA256_BYTES,
      )
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "authenticatedCorrelationMismatch",
        path: "materialization",
      });
    }
    for (let index = 0; index < preparedModules.length; index += 1) {
      const expected = preparedModules[index]!;
      const actual = evidence.sourceModules[index];
      if (
        actual === undefined ||
        actual.ordinal !== index ||
        actual.artifactModulePath !== expected.path ||
        actual.roles !== expected.roles ||
        actual.sourceByteLength !== expected.sourceBytes.byteLength ||
        expected.sourceMapBytes !== null ||
        !isUint8ArrayWithByteLength(actual.sourceSha256, SHA256_BYTES)
      ) {
        return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
          reason: "authenticatedCorrelationMismatch",
          path: `sourceModules[${index}]`,
        });
      }
      const sourceSha256 = yield* sha256(expected.sourceBytes, {
        maximumInputBytes: PREPARATION_HASH_BUDGET.maximumHashBytes,
      });
      if (!bytesEqualFullScan(sourceSha256, actual.sourceSha256)) {
        return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
          reason: "authenticatedCorrelationMismatch",
          path: `sourceModules[${index}].sourceSha256`,
        });
      }
    }
    const semanticSha256 = yield* sha256(
      prepared.artifactIngressPlan.semantic.bytes,
      { maximumInputBytes: PREPARATION_HASH_BUDGET.maximumHashBytes },
    );
    if (
      !bytesEqualFullScan(
        semanticSha256,
        evidence.semanticStreamSha256,
      )
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "authenticatedCorrelationMismatch",
        path: "semanticStreamSha256",
      });
    }
  });
}

function makeCandidateFrame(
  authority: TrustedScopeAuthority,
  evidence: ApplicationRevisionCandidateEvidenceProjectionV1,
  packageSha256: Uint8Array,
  artifactSha256: Uint8Array,
  schemaArtifactSha256: Uint8Array,
  schemaBindingSha256: Uint8Array,
  functionIdentity: SystemFunctionIdentityV1,
  runtimePublication: CandidateRuntimePublicationV1,
): DeclarativeV2CandidateFrameV1 {
  return Object.freeze({
    kind: "candidate",
    projectId: evidence.projectId,
    deploymentId: evidence.deploymentId,
    deploymentCreatedAt: evidence.deploymentCreatedAt,
    scopeId: authority.scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: authority.storageGenerationFence,
    scopeEpoch: authority.epoch,
    sourceRootSha256: new Uint8Array(evidence.sourceRootSha256),
    sourceSelectorSha256: new Uint8Array(evidence.sourceSelectorSha256),
    sourceCodecIdentity: SYSTEM_SOURCE_CODEC_IDENTITY_V1,
    semanticRootSha256: new Uint8Array(evidence.semanticRootSha256),
    semanticSelectorSha256: new Uint8Array(evidence.semanticSelectorSha256),
    semanticModelIdentity: evidence.semanticModelIdentity,
    semanticCodecIdentity: evidence.semanticCodecIdentity,
    semanticPolicyIdentity: evidence.semanticPolicyIdentity,
    packageSha256: new Uint8Array(packageSha256),
    artifactSha256: new Uint8Array(artifactSha256),
    artifactRuntimeIdentity: SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1,
    schemaArtifactSha256: new Uint8Array(schemaArtifactSha256),
    schemaBindingSha256: new Uint8Array(schemaBindingSha256),
    validatorRootSha256:
      new Uint8Array(functionIdentity.validatorRootSha256),
    coreLanguageIdentity: evidence.coreLanguageIdentity,
    abiIdentity: evidence.abiIdentity,
    grammarIdentity: evidence.grammarIdentity,
    unicodeIdentity: evidence.unicodeIdentity,
    parserTableIdentity: evidence.parserTableIdentity,
    analyzerIdentity:
      `sha256:${encodeBytesToLowercaseHex(evidence.analyzerIdentitySha256)}`,
    verifierIdentity:
      `sha256:${encodeBytesToLowercaseHex(evidence.verifierIdentitySha256)}`,
    declaredHandlerSetSha256:
      new Uint8Array(functionIdentity.declaredHandlerSetSha256),
    deploymentAnalysisCodecIdentity:
      evidence.deploymentAnalysisCodecIdentity,
    deploymentAnalysisByteLength: evidence.deploymentAnalysisByteLength,
    deploymentAnalysisSha256:
      new Uint8Array(evidence.deploymentAnalysisSha256),
    deploymentCodegenAnalysisCodecIdentity:
      evidence.deploymentCodegenAnalysisCodecIdentity,
    deploymentCodegenAnalysisByteLength:
      evidence.deploymentCodegenAnalysisByteLength,
    deploymentCodegenAnalysisSha256:
      new Uint8Array(evidence.deploymentCodegenAnalysisSha256),
    runtimeProjectionSetSha256:
      new Uint8Array(runtimePublication.runtimeProjectionSetSha256),
    functionGroupManifestSha256:
      new Uint8Array(runtimePublication.functionGroupManifestSha256),
    readinessPolicyIdentity:
      DECLARATIVE_V2_RUNTIME_READINESS_POLICY_IDENTITY_V1,
  });
}

function functionMetadataInput(
  prepared: PreparedStandardApplicationDefinitionV1,
): Result.Result<
  unknown,
  ApplicationRevisionRegistrationIdentityV1Error
> {
  const bindings = new Map(
    prepared.artifactIngressPlan.source.functionEntries.map((binding) => [
      binding.logicalModulePath,
      binding.artifactModulePath,
    ]),
  );
  const functions: unknown[] = [];
  for (const module of prepared.program.modules) {
      const executionModule = bindings.get(module.modulePath);
      if (executionModule === undefined) {
        return Result.fail(new ApplicationRevisionRegistrationIdentityV1Error({
          operation: "functionMetadata",
          reason: "missingBinding",
          path: module.modulePath,
        }));
      }
      functions.push(...module.functions.map((fn) => Object.freeze({
        path: `${module.modulePath}:${fn.exportName}`,
        kind: fn.kind,
        visibility: fn.visibility,
        args: fn.argsValidator,
        returns: fn.returnsValidator,
        route: null,
        partition: null,
      })));
  }
  return Result.succeed(Object.freeze({
    functions: Object.freeze(functions),
  }));
}

function registrationModuleOrdinals(
  prepared: PreparedStandardApplicationDefinitionV1,
): Result.Result<
  ReadonlyMap<string, bigint>,
  ApplicationRevisionRegistrationIdentityV1Error
> {
  const artifactModuleOrdinal = new Map(
    prepared.artifactIngressPlan.source.modules.map((module, ordinal) => [
      module.path,
      BigInt(ordinal),
    ]),
  );
  const bindings = new Map(
    prepared.artifactIngressPlan.source.functionEntries.map((binding) => [
      binding.logicalModulePath,
      binding.artifactModulePath,
    ]),
  );
  const result = new Map<string, bigint>();
  for (const module of prepared.program.modules) {
    const artifactPath = bindings.get(module.modulePath);
    const ordinal = artifactPath === undefined
      ? undefined
      : artifactModuleOrdinal.get(artifactPath);
    if (ordinal === undefined) {
      return Result.fail(new ApplicationRevisionRegistrationIdentityV1Error({
        operation: "registrationCorrelation",
        reason: "missingBinding",
        path: module.modulePath,
      }));
    }
    for (const fn of module.functions) {
      result.set(`${module.modulePath}:${fn.exportName}`, ordinal);
    }
  }
  return Result.succeed(result);
}

async function selectSchemaVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<CatalogSchemaVersion> {
  const existing = await db
    .select({ version: fxControlSchemaVersions.version })
    .from(fxControlSchemaVersions)
    .where(and(
      eq(fxControlSchemaVersions.deploymentId, deploymentId),
      eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId),
    ))
    .limit(1);
  if (existing[0] !== undefined) return existing[0].version;
  const highest = await db
    .select({ version: fxControlSchemaVersions.version })
    .from(fxControlSchemaVersions)
    .where(eq(fxControlSchemaVersions.deploymentId, deploymentId))
    .orderBy(desc(fxControlSchemaVersions.version))
    .limit(1);
  const next = (highest[0]?.version ?? 0) + 1;
  if (next > MAX_SCHEMA_VERSION) {
    throw new ApplicationRevisionRegistrationResourceV1Error({
      phase: "preparation",
      cause: new RangeError("Schema version allocation exhausted."),
    });
  }
  return next as CatalogSchemaVersion;
}

function prepareSchemaPublication(
  db: FlarexMetadataDatabase,
  prepared: PreparedStandardApplicationDefinitionV1,
  deploymentId: string,
): Effect.Effect<
  Readonly<{
    readonly publication: PreparedAppSchemaPublicationV1;
    readonly evidence: PreparedSchemaVersionArtifactEvidenceV1;
  }>,
  | PrepareSchemaManifestAppSchemaBindingsV1Error
  | PrepareAppSchemaPublicationV1Error
  | ApplicationRevisionRegistrationEvidenceV1Error
  | ApplicationRevisionRegistrationResourceV1Error
> {
  return Effect.gen(function* () {
    const preliminary = yield* prepareSchemaManifestAppSchemaBindingsV1Effect(
      db,
      {
        deploymentId,
        tables: prepared.program.schema.tables,
        indexes: prepared.program.schema.indexes,
      },
    );
    const canonical = yield* Effect.tryPromise({
      try: () => canonicalizeSchemaManifestV1(preliminary.manifest),
      catch: (cause) => new ApplicationRevisionRegistrationResourceV1Error({
        phase: "preparation",
        cause: new SchemaVersionArtifactPreparationError(
          deploymentId,
          { cause },
        ),
      }),
    });
    const schemaVersionId =
      `dv2_schema_${encodeBytesToLowercaseHex(canonical.sha256)}` as
        CatalogSchemaVersionId;
    const version = yield* Effect.tryPromise({
      try: () => selectSchemaVersion(db, deploymentId, schemaVersionId),
      catch: (cause) =>
        cause instanceof ApplicationRevisionRegistrationResourceV1Error
          ? cause
          : new ApplicationRevisionRegistrationResourceV1Error({
              phase: "preparation",
              cause,
            }),
    });
    const publication = yield* prepareAppSchemaPublicationV1Effect(db, {
      deploymentId,
      schemaVersionId,
      version,
      tables: prepared.program.schema.tables,
      indexes: prepared.program.schema.indexes,
    });
    const state = yield* Effect.fromResult(
      getPreparedAppSchemaPublicationV1StateResult(publication),
    ).pipe(Effect.orDie);
    const evidence = yield* Effect.fromResult(
      getPreparedSchemaVersionArtifactEvidenceResult(state.artifact),
    ).pipe(Effect.orDie);
    if (!bytesEqualFullScan(evidence.manifestSha256, canonical.sha256)) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "schemaPreparationChanged",
      });
    }
    return Object.freeze({ publication, evidence });
  });
}

function requireCommandCorrelation(
  state: PreparedRegistrationStateV1,
  command: ApplicationRevisionRegistrationCommandReceiptV1,
): Effect.Effect<void, ApplicationRevisionRegistrationEvidenceV1Error> {
  const pairs: ReadonlyArray<readonly [Uint8Array, Uint8Array, string]> = [
    [command.attemptSha256, state.attemptSha256, "attemptSha256"],
    [command.candidateSha256, state.candidateSha256, "candidateSha256"],
  ];
  for (const [actual, expected, path] of pairs) {
    if (!bytesEqualFullScan(actual, expected)) {
      return Effect.fail(
        new ApplicationRevisionRegistrationEvidenceV1Error({
          reason: "authenticatedCorrelationMismatch",
          path,
        }),
      );
    }
  }
  const digestFields: ReadonlyArray<readonly [string, Uint8Array]> = [
    ["reservationSha256", command.reservationSha256],
    ["requestSha256", command.requestSha256],
    ["freshAuthenticatedInputSha256", command.freshAuthenticatedInputSha256],
    ["commandInputSha256", command.commandInputSha256],
    [
      "rangeAndPredecessorTailsSha256",
      command.rangeAndPredecessorTailsSha256,
    ],
    ["analyzerIdentitySha256", command.analyzerIdentitySha256],
    ["verifierIdentitySha256", command.verifierIdentitySha256],
  ];
  if (
    command.commandKind !== "registration_page" ||
    digestFields.some(([, value]) =>
      !isUint8ArrayWithByteLength(value, SHA256_BYTES)
    ) ||
    !bytesEqualFullScan(
      command.analyzerIdentitySha256,
      state.analyzerIdentitySha256,
    ) ||
    !bytesEqualFullScan(
      command.verifierIdentitySha256,
      state.verifierIdentitySha256,
    ) ||
    typeof command.sequence !== "bigint" ||
    command.sequence < 0n ||
    !Number.isSafeInteger(command.canonicalByteLength) ||
    command.canonicalByteLength < 0
  ) {
    return Effect.fail(
      new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "authenticatedCorrelationMismatch",
        path: "command",
      }),
    );
  }
  return Effect.void;
}

function validateTerminalCorrelation(
  state: PreparedRegistrationStateV1,
  analysis: LegacyAuthenticatedVerifiedStandardApplicationAnalysisV1,
  command: ApplicationRevisionRegistrationCommandReceiptV1,
  settlement: DeclarativeV2VerifierProgressSettlementSnapshotV2,
): Result.Result<void, ApplicationRevisionRegistrationEvidenceV1Error> {
  const result = analysis.result;
  const reservation = settlement.reservation;
  if (
    settlement.commandKind !== "registration_page" ||
    settlement.sequence !== command.sequence ||
    !bytesEqualFullScan(
      settlement.reservationSha256,
      command.reservationSha256,
    ) ||
    reservation.commandKind !== command.commandKind ||
    reservation.sequence !== command.sequence ||
    !bytesEqualFullScan(reservation.attemptSha256, command.attemptSha256) ||
    !bytesEqualFullScan(
      reservation.candidateSha256,
      command.candidateSha256,
    ) ||
    !bytesEqualFullScan(
      reservation.freshAuthenticatedInputSha256,
      command.freshAuthenticatedInputSha256,
    ) ||
    !bytesEqualFullScan(
      reservation.commandInputSha256,
      command.commandInputSha256,
    ) ||
    !bytesEqualFullScan(
      reservation.rangeAndPredecessorTailsSha256,
      command.rangeAndPredecessorTailsSha256,
    ) ||
    !bytesEqualFullScan(
      reservation.analyzerIdentitySha256,
      command.analyzerIdentitySha256,
    ) ||
    !bytesEqualFullScan(
      reservation.verifierIdentitySha256,
      command.verifierIdentitySha256,
    )
  ) {
    return Result.fail(new ApplicationRevisionRegistrationEvidenceV1Error({
      reason: "terminalCommandMismatch",
    }));
  }
  if (
    !bytesEqualFullScan(
      settlement.outputManifestBytes,
      result.outputManifestBytes,
    ) ||
    !bytesEqualFullScan(
      settlement.nextProgressBytes,
      result.nextProgressBytes,
    )
  ) {
    return Result.fail(new ApplicationRevisionRegistrationEvidenceV1Error({
      reason: "manifestMismatch",
    }));
  }
  if (
    !bytesEqualFullScan(
      settlement.outputManifest.evidenceRootSha256,
      result.registrationRootSha256,
    ) ||
    settlement.outputManifest.evidenceCount !==
      BigInt(result.registrationFrames.length)
  ) {
    return Result.fail(new ApplicationRevisionRegistrationEvidenceV1Error({
      reason: "registrationRootMismatch",
    }));
  }
  if (
    !bytesEqualFullScan(
      settlement.outputManifest.nextProgressSha256,
      settlement.receipt.nextProgressSha256,
    )
  ) {
    return Result.fail(new ApplicationRevisionRegistrationEvidenceV1Error({
      reason: "receiptMismatch",
    }));
  }
  return validateRegistrationFramesAgainstFunctionMetadataV1(
    state.candidate,
    state.attemptSha256,
    result.registrationFrames,
    state.functionIdentity,
    state.moduleOrdinalByFunctionPath,
  ).pipe(
    Result.map(() => undefined),
    Result.mapError((cause) =>
      new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "authenticatedCorrelationMismatch",
        ...(cause.path === undefined ? {} : { path: cause.path }),
      })
    ),
  );
}

function registrationClaim(
  state: CorrelatedRegistrationStateV1,
) {
  const settlement = state.settlement;
  const command = state.command;
  return {
    scopeId: state.authority.scopeId,
    candidateSha256: state.candidateSha256,
    attemptSha256: state.attemptSha256,
    semanticAttemptIdentitySha256: state.semanticAttemptIdentitySha256,
    sequence: command.sequence,
    reservationSha256: command.reservationSha256,
    producerRequestSha256: command.requestSha256,
    canonicalCommandByteLength: BigInt(command.canonicalByteLength),
    freshAuthenticatedInputSha256: command.freshAuthenticatedInputSha256,
    commandInputSha256: command.commandInputSha256,
    rangeAndPredecessorTailsSha256:
      command.rangeAndPredecessorTailsSha256,
    analyzerIdentitySha256: command.analyzerIdentitySha256,
    verifierIdentitySha256: command.verifierIdentitySha256,
    outputManifestSha256: settlement.receipt.outputManifestSha256,
    receiptSha256: settlement.receiptSha256,
    nextProgressSha256: settlement.receipt.nextProgressSha256,
    registrationRootSha256: state.analysis.result.registrationRootSha256,
    registrationFrameCount:
      BigInt(state.analysis.result.registrationFrames.length),
    sourceCodecIdentity: SYSTEM_SOURCE_CODEC_IDENTITY_V1,
    packageSha256: state.packageSha256,
    artifactRuntimeIdentity: SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1,
    artifactSha256: state.artifactSha256,
    schemaVersionId: state.schemaPublication.schemaVersionId,
    schemaVersion: state.schemaPublication.version,
    manifestCodecVersion: state.schemaEvidence.manifestCodecVersion,
    manifestByteLength: BigInt(state.schemaEvidence.manifestByteLength),
    schemaArtifactSha256: state.schemaEvidence.manifestSha256,
    schemaBindingSha256: state.schemaBindingSha256,
    functionMetadataCodecVersion: FUNCTION_METADATA_CODEC_VERSION,
    functionMetadataByteLength:
      BigInt(state.functionIdentity.metadata.canonicalBytes.byteLength),
    functionMetadataSha256: state.functionIdentity.functionMetadataSha256,
    validatorRootSha256: state.functionIdentity.validatorRootSha256,
    declaredHandlerSetSha256:
      state.functionIdentity.declaredHandlerSetSha256,
  } as const;
}

function snapshotCommand(
  command: ApplicationRevisionRegistrationCommandReceiptV1,
): ApplicationRevisionRegistrationCommandReceiptV1 {
  return Object.freeze({
    ...command,
    attemptSha256: new Uint8Array(command.attemptSha256),
    candidateSha256: new Uint8Array(command.candidateSha256),
    reservationSha256: new Uint8Array(command.reservationSha256),
    requestSha256: new Uint8Array(command.requestSha256),
    freshAuthenticatedInputSha256:
      new Uint8Array(command.freshAuthenticatedInputSha256),
    commandInputSha256: new Uint8Array(command.commandInputSha256),
    rangeAndPredecessorTailsSha256:
      new Uint8Array(command.rangeAndPredecessorTailsSha256),
    analyzerIdentitySha256: new Uint8Array(command.analyzerIdentitySha256),
    verifierIdentitySha256: new Uint8Array(command.verifierIdentitySha256),
  });
}

function runRegistrationTransaction(
  state: CorrelatedRegistrationStateV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  registrationInputSha256: Uint8Array,
): Effect.Effect<
  DurableRegisteredApplicationRevisionV1,
  RegisterApplicationRevisionV1Error,
  Scope.Scope
> {
  const attempt = () => runRegistrationTransactionAttempt(
    state,
    requestKey,
    registrationInputSha256,
  );
  const loop = (
    number: number,
  ): Effect.Effect<
    DurableRegisteredApplicationRevisionV1,
    RegisterApplicationRevisionV1Error,
    Scope.Scope
  > => attempt().pipe(Effect.catch(
    (error) =>
      error instanceof
          ApplicationRevisionRegistrationConfirmedRollbackV1Error &&
        error.retryable &&
        number < REGISTRATION_RETRY_ATTEMPTS
        ? loop(number + 1)
        : Effect.fail(error),
  ));
  return loop(1);
}

function runRegistrationTransactionAttempt(
  state: CorrelatedRegistrationStateV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  registrationInputSha256: Uint8Array,
): Effect.Effect<
  DurableRegisteredApplicationRevisionV1,
  RegisterApplicationRevisionV1Error,
  Scope.Scope
> {
  // This is the audited Effect-to-driver callback boundary. The surrounding
  // settlement effect waits for the database promise even when interrupted.
  return Effect.suspend(() => {
    let callbackCause:
      | Cause.Cause<
        | LockScopeClockForUpdateError
        | PublishPreparedAppSchemaV1InTransactionError
        | ApplicationRevisionRegistrationEvidenceV1Error
        | ApplicationRevisionRegistrationRequestConflictV1Error
        | ApplicationRevisionRegistrationStoredStateV1Error
        | ApplicationRevisionRegistrationConfirmedRollbackV1Error
      >
      | undefined;
    const rollbackSignal = new Error(
      "Application revision registration failed; roll back.",
    );
    const transaction: Promise<DurableRegisteredApplicationRevisionV1> =
      state.target[RUN_LOCATED_READ_COMMITTED_V1](
      async (tx) => {
        const exit = await Effect.runPromise(Effect.exit(
          registerInTransaction(
            tx,
            state,
            requestKey,
            registrationInputSha256,
          ),
        ));
        if (Exit.isFailure(exit)) {
          callbackCause = exit.cause;
          throw rollbackSignal;
        }
        return exit.value;
      },
      );
    return awaitSettlement(transaction).pipe(
      Effect.catch((cause): Effect.Effect<
        never,
        RegisterApplicationRevisionV1Error
      > => {
        if (
          cause instanceof LocatedReadCommittedTransactionFailureV1 &&
          cause.issue.kind === "callbackRolledBack" &&
          cause.issue.callbackCause === rollbackSignal &&
          callbackCause !== undefined
        ) {
          return Effect.failCause(callbackCause);
        }
        if (
          cause instanceof LocatedReadCommittedTransactionFailureV1 &&
          cause.issue.kind === "callbackCleanupFailed" &&
          callbackCause !== undefined &&
          (Cause.hasDies(callbackCause) ||
            Cause.hasInterrupts(callbackCause))
        ) {
          return Effect.failCause(Cause.combine(
            callbackCause,
            Cause.die(new ApplicationRevisionRegistrationResourceV1Error({
              phase: "cleanup",
              cause,
            })),
          ));
        }
        return Effect.fail(mapTransactionFailure(
          state,
          requestKey,
          registrationInputSha256,
          cause,
        ));
      }),
    );
  });
}

function registerInTransaction(
  tx: AppRowTransaction,
  state: CorrelatedRegistrationStateV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  registrationInputSha256: Uint8Array,
): Effect.Effect<
  DurableRegisteredApplicationRevisionV1,
  | LockScopeClockForUpdateError
  | PublishPreparedAppSchemaV1InTransactionError
  | ApplicationRevisionRegistrationEvidenceV1Error
  | ApplicationRevisionRegistrationRequestConflictV1Error
  | ApplicationRevisionRegistrationStoredStateV1Error
  | ApplicationRevisionRegistrationConfirmedRollbackV1Error
> {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(
      tx,
      state.authority.scopeId,
    );
    if (
      clock.storageGeneration !== state.authority.storageGeneration ||
      clock.storageGenerationFence !==
        state.authority.storageGenerationFence ||
      clock.epoch !== state.authority.epoch
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "authorityChanged",
      });
    }
    const requestRows = yield* statement(tx
      .select()
      .from(fxSystemApplicationRevisionRequestsV1)
      .where(and(
        eq(
          fxSystemApplicationRevisionRequestsV1.scopeId,
          state.authority.scopeId,
        ),
        eq(fxSystemApplicationRevisionRequestsV1.requestKey, requestKey),
      ))
      .limit(1)
      .for("update"));
    if (requestRows[0] !== undefined) {
      const request = requestRows[0];
      if (
        !bytesEqualFullScan(
          request.registrationInputSha256,
          registrationInputSha256,
        )
      ) {
        return yield* new
          ApplicationRevisionRegistrationRequestConflictV1Error({
            reason: "requestKeyReuse",
            scopeId: state.authority.scopeId,
          });
      }
      const revision = yield* reloadProjection(
        tx,
        state,
        request.candidateSha256,
        registrationInputSha256,
        "replayed",
      );
      if (
        request.revisionId !== revision.revisionId ||
        request.registeredAt.getTime() !== revision.registeredAt.getTime()
      ) {
        return yield* new ApplicationRevisionRegistrationStoredStateV1Error({
          reason: "receipt",
          scopeId: state.authority.scopeId,
        });
      }
      return revision;
    }
    yield* verifyDurableAnalyzerEvidence(tx, state);
    const revisionRows = yield* statement(tx
      .select()
      .from(fxSystemApplicationRevisionsV1)
      .where(and(
        eq(
          fxSystemApplicationRevisionsV1.scopeId,
          state.authority.scopeId,
        ),
        eq(
          fxSystemApplicationRevisionsV1.candidateSha256,
          state.candidateSha256,
        ),
      ))
      .limit(1)
      .for("update"));
    if (
      revisionRows[0] !== undefined &&
      !bytesEqualFullScan(
        revisionRows[0].registrationInputSha256,
        registrationInputSha256,
      )
    ) {
      return yield* new
        ApplicationRevisionRegistrationRequestConflictV1Error({
          reason: "revisionClaimMismatch",
          scopeId: state.authority.scopeId,
        });
    }
    if (revisionRows[0] === undefined) {
      yield* publishPreparedAppSchemaV1InTransactionEffect(
        tx,
        state.schemaPublication,
      );
      yield* executeStatement(tx.insert(fxSystemApplicationRevisionsV1).values({
        scopeId: state.authority.scopeId,
        candidateSha256: state.candidateSha256,
        revisionId:
          `dv2_${encodeBytesToLowercaseHex(state.candidateSha256)}`,
        deploymentId: state.authority.deploymentId,
        attemptSha256: state.attemptSha256,
        registrationInputSha256,
        semanticAttemptIdentitySha256:
          state.semanticAttemptIdentitySha256,
        sourceCodecIdentity: SYSTEM_SOURCE_CODEC_IDENTITY_V1,
        packageSha256: state.packageSha256,
        artifactRuntimeIdentity: SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1,
        artifactSha256: state.artifactSha256,
        schemaVersionId: state.schemaPublication.schemaVersionId,
        schemaVersion: state.schemaPublication.version,
        manifestCodecVersion: state.schemaEvidence.manifestCodecVersion,
        manifestByteLength: BigInt(state.schemaEvidence.manifestByteLength),
        schemaArtifactSha256: state.schemaEvidence.manifestSha256,
        schemaBindingSha256: state.schemaBindingSha256,
        functionMetadataCodecVersion: FUNCTION_METADATA_CODEC_VERSION,
        functionMetadataByteLength:
          BigInt(state.functionIdentity.metadata.canonicalBytes.byteLength),
        functionMetadataSha256:
          state.functionIdentity.functionMetadataSha256,
        functionMetadataBytes:
          state.functionIdentity.metadata.canonicalBytes,
        validatorRootSha256: state.functionIdentity.validatorRootSha256,
        declaredHandlerSetSha256:
          state.functionIdentity.declaredHandlerSetSha256,
        registrationRootSha256:
          state.analysis.result.registrationRootSha256,
        registrationFrameCount:
          BigInt(state.analysis.result.registrationFrames.length),
        registrationFramesByteLength:
          BigInt(state.registrationFramesBytes.byteLength),
        registrationFramesBytes: state.registrationFramesBytes,
        outputManifestSha256:
          state.settlement.receipt.outputManifestSha256,
        outputManifestBytes: state.settlement.outputManifestBytes,
        nextProgressSha256: state.settlement.receipt.nextProgressSha256,
        nextProgressBytes: state.settlement.nextProgressBytes,
        receiptSha256: state.settlement.receiptSha256,
        receiptBytes: state.settlement.receiptBytes,
        status: "inactive",
      }));
    }
    const revision = yield* reloadProjection(
      tx,
      state,
      state.candidateSha256,
      registrationInputSha256,
      revisionRows[0] === undefined ? "registered" : "replayed",
    );
    yield* executeStatement(tx.insert(fxSystemApplicationRevisionRequestsV1).values({
      scopeId: state.authority.scopeId,
      requestKey,
      registrationInputSha256,
      candidateSha256: state.candidateSha256,
      revisionId: revision.revisionId,
      registeredAt: revision.registeredAt,
    }));
    return revision;
  });
}

function verifyDurableAnalyzerEvidence(
  tx: AppRowTransaction,
  state: CorrelatedRegistrationStateV1,
): Effect.Effect<
  void,
  | ApplicationRevisionRegistrationEvidenceV1Error
  | ApplicationRevisionRegistrationStoredStateV1Error
  | ApplicationRevisionRegistrationConfirmedRollbackV1Error
> {
  return Effect.gen(function* () {
    const candidates = yield* statement(tx
      .select({
        frameByteLength: fxSystemDeclarativeV2Candidates.frameByteLength,
        frameSha256: fxSystemDeclarativeV2Candidates.frameSha256,
        frameBytes: fxSystemDeclarativeV2Candidates.frameBytes,
      })
      .from(fxSystemDeclarativeV2Candidates)
      .where(and(
        eq(fxSystemDeclarativeV2Candidates.scopeId, state.authority.scopeId),
        eq(
          fxSystemDeclarativeV2Candidates.candidateSha256,
          state.candidateSha256,
        ),
      ))
      .limit(1));
    const candidate = candidates[0];
    if (candidate === undefined) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "candidateMissing",
      });
    }
    if (
      candidate.frameByteLength !==
        BigInt(state.candidateCanonicalBytes.byteLength) ||
      !bytesEqualFullScan(candidate.frameSha256, state.candidateSha256) ||
      !bytesEqualFullScan(
        candidate.frameBytes,
        state.candidateCanonicalBytes,
      )
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "candidateMismatch",
      });
    }
    const attempts = yield* statement(tx
      .select({
        candidateSha256:
          fxSystemDeclarativeV2VerifierAttemptsV2.candidateSha256,
        lifecycle: fxSystemDeclarativeV2VerifierAttemptsV2.lifecycle,
      })
      .from(fxSystemDeclarativeV2VerifierAttemptsV2)
      .where(and(
        eq(
          fxSystemDeclarativeV2VerifierAttemptsV2.scopeId,
          state.authority.scopeId,
        ),
        eq(
          fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256,
          state.attemptSha256,
        ),
      ))
      .limit(1));
    if (attempts[0] === undefined) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "attemptMissing",
      });
    }
    if (
      !bytesEqualFullScan(
        attempts[0].candidateSha256,
        state.candidateSha256,
      ) ||
      attempts[0].lifecycle !== "registering"
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "attemptMismatch",
      });
    }
    const commands = yield* statement(tx
      .select({
        commandKind: fxSystemDeclarativeV2VerifierCommandsV2.commandKind,
        reservationSha256:
          fxSystemDeclarativeV2VerifierCommandsV2.reservationSha256,
        outputManifestSha256:
          fxSystemDeclarativeV2VerifierCommandsV2.outputManifestSha256,
        nextProgressSha256:
          fxSystemDeclarativeV2VerifierCommandsV2.nextProgressSha256,
        receiptSha256: fxSystemDeclarativeV2VerifierCommandsV2.receiptSha256,
      })
      .from(fxSystemDeclarativeV2VerifierCommandsV2)
      .where(and(
        eq(
          fxSystemDeclarativeV2VerifierCommandsV2.scopeId,
          state.authority.scopeId,
        ),
        eq(
          fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256,
          state.attemptSha256,
        ),
        eq(
          fxSystemDeclarativeV2VerifierCommandsV2.sequence,
          state.command.sequence,
        ),
      ))
      .limit(1));
    const command = commands[0];
    if (
      command === undefined ||
      command.commandKind !== "registration_page" ||
      command.outputManifestSha256 === null ||
      command.nextProgressSha256 === null ||
      command.receiptSha256 === null
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "terminalCommandMissing",
      });
    }
    if (
      !bytesEqualFullScan(
        command.reservationSha256,
        state.command.reservationSha256,
      ) ||
      !bytesEqualFullScan(
        command.outputManifestSha256,
        state.settlement.receipt.outputManifestSha256,
      ) ||
      !bytesEqualFullScan(
        command.nextProgressSha256,
        state.settlement.receipt.nextProgressSha256,
      ) ||
      !bytesEqualFullScan(
        command.receiptSha256,
        state.settlement.receiptSha256,
      )
    ) {
      return yield* new ApplicationRevisionRegistrationEvidenceV1Error({
        reason: "terminalCommandMismatch",
      });
    }
  });
}

function reloadProjection(
  tx: AppRowTransaction,
  state: CorrelatedRegistrationStateV1,
  candidateSha256: Uint8Array,
  registrationInputSha256: Uint8Array,
  kind: "registered" | "replayed",
): Effect.Effect<
  DurableRegisteredApplicationRevisionV1,
  | ApplicationRevisionRegistrationStoredStateV1Error
  | ApplicationRevisionRegistrationConfirmedRollbackV1Error
> {
  return Effect.gen(function* () {
    const rows = yield* statement(tx
      .select()
      .from(fxSystemApplicationRevisionsV1)
      .where(and(
        eq(
          fxSystemApplicationRevisionsV1.scopeId,
          state.authority.scopeId,
        ),
        eq(
          fxSystemApplicationRevisionsV1.candidateSha256,
          candidateSha256,
        ),
      ))
      .limit(1));
    const row = rows[0];
    const expectedRevisionId =
      `dv2_${encodeBytesToLowercaseHex(state.candidateSha256)}`;
    if (
      row === undefined ||
      row.status !== "inactive" ||
      row.revisionId !== expectedRevisionId ||
      row.deploymentId !== state.authority.deploymentId ||
      !bytesEqualFullScan(row.candidateSha256, state.candidateSha256) ||
      !bytesEqualFullScan(row.attemptSha256, state.attemptSha256) ||
      !bytesEqualFullScan(
        row.registrationInputSha256,
        registrationInputSha256,
      ) ||
      !bytesEqualFullScan(
        row.semanticAttemptIdentitySha256,
        state.semanticAttemptIdentitySha256,
      ) ||
      row.sourceCodecIdentity !== SYSTEM_SOURCE_CODEC_IDENTITY_V1 ||
      !bytesEqualFullScan(row.packageSha256, state.packageSha256) ||
      row.artifactRuntimeIdentity !== SYSTEM_ARTIFACT_RUNTIME_IDENTITY_V1 ||
      !bytesEqualFullScan(row.artifactSha256, state.artifactSha256) ||
      row.schemaVersionId !== state.schemaPublication.schemaVersionId ||
      row.schemaVersion !== state.schemaPublication.version ||
      row.manifestCodecVersion !== state.schemaEvidence.manifestCodecVersion ||
      row.manifestByteLength !==
        BigInt(state.schemaEvidence.manifestByteLength) ||
      !bytesEqualFullScan(
        row.schemaArtifactSha256,
        state.schemaEvidence.manifestSha256,
      ) ||
      !bytesEqualFullScan(
        row.schemaBindingSha256,
        state.schemaBindingSha256,
      ) ||
      row.functionMetadataCodecVersion !== FUNCTION_METADATA_CODEC_VERSION ||
      row.functionMetadataByteLength !==
        BigInt(state.functionIdentity.metadata.canonicalBytes.byteLength) ||
      !bytesEqualFullScan(
        row.functionMetadataSha256,
        state.functionIdentity.functionMetadataSha256,
      ) ||
      !bytesEqualFullScan(
        row.functionMetadataBytes,
        state.functionIdentity.metadata.canonicalBytes,
      ) ||
      !bytesEqualFullScan(
        row.validatorRootSha256,
        state.functionIdentity.validatorRootSha256,
      ) ||
      !bytesEqualFullScan(
        row.declaredHandlerSetSha256,
        state.functionIdentity.declaredHandlerSetSha256,
      ) ||
      !bytesEqualFullScan(
        row.registrationRootSha256,
        state.analysis.result.registrationRootSha256,
      ) ||
      row.registrationFrameCount !==
        BigInt(state.analysis.result.registrationFrames.length) ||
      row.registrationFramesByteLength !==
        BigInt(state.registrationFramesBytes.byteLength) ||
      !bytesEqualFullScan(
        row.registrationFramesBytes,
        state.registrationFramesBytes,
      ) ||
      !bytesEqualFullScan(
        row.outputManifestSha256,
        state.settlement.receipt.outputManifestSha256,
      ) ||
      !bytesEqualFullScan(
        row.outputManifestBytes,
        state.settlement.outputManifestBytes,
      ) ||
      !bytesEqualFullScan(
        row.nextProgressSha256,
        state.settlement.receipt.nextProgressSha256,
      ) ||
      !bytesEqualFullScan(
        row.nextProgressBytes,
        state.settlement.nextProgressBytes,
      ) ||
      !bytesEqualFullScan(
        row.receiptSha256,
        state.settlement.receiptSha256,
      ) ||
      !bytesEqualFullScan(row.receiptBytes, state.settlement.receiptBytes) ||
      !Number.isFinite(row.registeredAt.getTime())
    ) {
      return yield* new ApplicationRevisionRegistrationStoredStateV1Error({
        reason: "revision",
        scopeId: state.authority.scopeId,
      });
    }
    return Object.freeze({
      kind,
      revisionId: row.revisionId,
      deploymentId: row.deploymentId,
      scopeId: row.scopeId,
      candidateSha256: new Uint8Array(row.candidateSha256),
      attemptSha256: new Uint8Array(row.attemptSha256),
      registrationInputSha256:
        new Uint8Array(row.registrationInputSha256),
      schemaVersionId: row.schemaVersionId,
      functionMetadataSha256: new Uint8Array(row.functionMetadataSha256),
      validatorRootSha256: new Uint8Array(row.validatorRootSha256),
      declaredHandlerSetSha256:
        new Uint8Array(row.declaredHandlerSetSha256),
      registrationRootSha256: new Uint8Array(row.registrationRootSha256),
      status: "inactive",
      registeredAt: new Date(row.registeredAt.getTime()),
    });
  });
}

function statement<Row>(
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  ApplicationRevisionRegistrationConfirmedRollbackV1Error
> {
  return Effect.tryPromise({
    try: () => Promise.resolve(query),
    catch: cause => new ApplicationRevisionRegistrationConfirmedRollbackV1Error({
      cause,
      retryable: isRetryableTransactionCause(cause),
    }),
  });
}

function executeStatement(
  query: PromiseLike<unknown>,
): Effect.Effect<
  void,
  ApplicationRevisionRegistrationConfirmedRollbackV1Error
> {
  return Effect.tryPromise({
    try: () => Promise.resolve(query).then(() => undefined),
    catch: cause => new ApplicationRevisionRegistrationConfirmedRollbackV1Error({
      cause,
      retryable: isRetryableTransactionCause(cause),
    }),
  });
}

function awaitSettlement<Value>(
  transaction: Promise<Value>,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptibleMask(restore =>
    restore(Effect.tryPromise({
      try: () => transaction,
      catch: cause => cause,
    })).pipe(
      Effect.onInterrupt(() =>
        Effect.promise(() =>
          transaction.then(() => undefined, () => undefined)
        )
      ),
    )
  );
}

function mapTransactionFailure(
  state: CorrelatedRegistrationStateV1,
  requestKey: ApplicationRevisionRegistrationRequestKeyV1,
  registrationInputSha256: Uint8Array,
  cause: unknown,
):
  | ApplicationRevisionRegistrationConfirmedRollbackV1Error
  | ApplicationRevisionRegistrationDecisionUncertainV1Error
  | ApplicationRevisionRegistrationResourceV1Error {
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    switch (cause.issue.kind) {
      case "decisionUncertain":
        return new ApplicationRevisionRegistrationDecisionUncertainV1Error({
          scopeId: state.authority.scopeId,
          requestKey,
          registrationInputSha256:
            new Uint8Array(registrationInputSha256),
          cause,
        });
      case "callbackCleanupFailed":
        return new ApplicationRevisionRegistrationResourceV1Error({
          phase: "cleanup",
          cause,
        });
      case "infrastructureFailure":
        return new ApplicationRevisionRegistrationResourceV1Error({
          phase: "infrastructure",
          cause,
        });
      case "callbackRolledBack":
        return new
          ApplicationRevisionRegistrationConfirmedRollbackV1Error({
            cause: cause.issue.callbackCause,
            retryable: isRetryableTransactionCause(
              cause.issue.callbackCause,
            ),
          });
    }
  }
  return new ApplicationRevisionRegistrationConfirmedRollbackV1Error({
    cause,
    retryable: isRetryableTransactionCause(cause),
  });
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01";
}

function encodeRegistrationFrames(
  frames: ReadonlyArray<Uint8Array>,
): Uint8Array {
  let total = 8;
  for (const frame of frames) total += 8 + frame.byteLength;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(frames.length), false);
  let offset = 8;
  for (const frame of frames) {
    view.setBigUint64(offset, BigInt(frame.byteLength), false);
    offset += 8;
    bytes.set(frame, offset);
    offset += frame.byteLength;
  }
  return bytes;
}

export {
  decodeApplicationRevisionRegistrationRequestKeyV1,
  type ApplicationRevisionRegistrationRequestKeyV1,
} from "./applicationRevisionRegistrationIdentitiesV1";
