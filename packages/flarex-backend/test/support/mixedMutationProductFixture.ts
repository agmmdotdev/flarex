import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { Effect, Exit, Result, Schema, Scope } from "effect";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from
  "@flarex/persistence-postgres/internal/commerce-values";
import { CommitEnvelopeV1Schema, CommitSyscallSequenceV1Schema, canonicalizeSuccessfulResultV1Effect,
  decodeCanonicalSessionJournalEffect } from "flarex-protocol/commit-protocol";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeLogicalParticipantDependencyEvidence } from "../../../persistence-postgres/src/logicalDocuments/journalEvidence";
import { inspectLogicalParticipantCommitAuthority } from "../../../persistence-postgres/src/logicalDocuments/participantAdmission";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { selectApplicationMutationAdmission } from
  "../../../persistence-postgres/src/applicationMutationAdmission";
import { prepareLogicalRelationalAdmission } from
  "../../../persistence-postgres/src/logicalDocuments/relationalAdmission";
import { createApplicationMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1 } from
  "../../../persistence-postgres/src/transactionSessionActivation";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedOccExecution";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../../../persistence-postgres/src/transactionExecutionClaimLiveness";
import { createSessionJournalStorePersistence, readConfirmedFiniteRootSealCapture } from
  "../../../persistence-postgres/src/sessionJournalStore";
import type { LogicalParticipantBorrow } from
  "@flarex/persistence-postgres/session-journal-store";
import type { PerformanceSettlementLedger } from "./mixedMutationPerformanceReport";
import { createStoredAttemptEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedAttemptEvidence";
import { createStoredCommitAuthorityEvidenceLoaderV1 } from
  "../../../persistence-postgres/src/storedCommitAuthorityEvidence";
import { createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1, createPointMutationAttemptReplacementPortV1 } from
  "../../../persistence-postgres/src/pointCommitTransaction";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import { makeCmsHost } from "@flarex/persistence-postgres/internal/cms-adapter";
import { createPostgresPersistence } from "../../../persistence-postgres/src/postgres";
import { makePostgresRelationalSession } from
  "../../../persistence-postgres/src/relationalTransaction/session";
import { preparedHostTestRuntime } from
  "../../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from
  "../../../persistence-postgres/src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from
  "../../../persistence-postgres/src/appDeveloperIndexCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from
  "../../../persistence-postgres/src/appSchemaCandidateValidation";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../../../persistence-postgres/src/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../../../persistence-postgres/src/appUniqueConstraintSetBuildV1";
import { createPointMutationJournalV1 } from
  "../../../executor/src/pointMutationJournal";
import { createPointMutationExecutionClaimVaultV1 } from
  "../../../executor/src/pointMutationExecutionClaim";
import { ApplicationPointMutationRunnerHostV1Error, createStoredPointCommitExecutorV1,
  createStoredPointMutationOccRerunExecutionV1 } from
  "../../../executor/src/storedAttemptAuthentication";
import type { PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1 } from
  "../../../executor/src/storedAttemptAuthentication";
import { createApplicationMutationGrantVerificationKernelV1 } from
  "../../../executor/src/applicationMutationGrantVerificationKernel";
import { createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1 } from
  "../../../executor/src/pointMutationSessionActivation";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../../../executor/src/pointMutationSessionAttemptSelector";
import { bindPointMutationOccJournal } from
  "../../../executor/src/storedAttemptAuthentication/exactPointMutationExecutionOperations";
import { issueSetupSeededSyscallValidatorProofV1 } from
  "../../../persistence-postgres/test/applicationRevisionSyscallValidatorTestSupport";
import { applicationMutationActivationFixture } from
  "../../../persistence-postgres/test/applicationMutationActivationFixture";
import type { MixedMutationPerformanceTrace } from
  "../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { TEST_GRANT_RETENTION_POLICY_V1 } from
  "../../../persistence-postgres/test/transactionSessionActivationTestSupport";
import { logicalCurrencyFixture } from
  "../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalProductHost } from
  "../../../medusa-adapter/test/support/logical-product-fixture";
import { prepareLogicalPricingHost } from
  "../../../medusa-adapter/test/support/logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from
  "../../../medusa-adapter/test/support/logical-variant-pricing-link-fixture";
import { seedNativeProductAttemptGraph, runNativeStandaloneProductUpdate,
  runNativeStandaloneProductMutation, runNativeStandaloneLinkCreate } from
  "../../../medusa-adapter/test/support/native-product-attempt-seed";
import { executePrivateProductAttemptOperation,
  preparePrivateProductAttempt, preparePrivateProductAttemptEventPolicy } from
  "@flarex/medusa-adapter/internal/product-attempt";
import { preparePrivateProductLaunchAttempt } from
  "../../../medusa-adapter/src/product-launch-workflow";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBorrowedLogicalAttempt } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { LogicalParticipantAdmissionError, LogicalParticipantInvocationError } from
  "@flarex/persistence-postgres/internal/logical-participant-admission";
import { CmsTransactionError, makeBorrowedCmsAttempt } from
  "@flarex/persistence-postgres/internal/cms-adapter";
import { prepareLogicalDocumentSourceAdmission } from
  "@flarex/persistence-postgres/internal/logical-document-admission";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { makePayloadRuntime } from "@flarex/payload-adapter/internal/runtime";
import {
  mixedPayloadPostsCollections,
  mixedPayloadSuccessProfile, mixedPayloadCaughtFailureProfile, mixedPayloadDeniedProfile,
  mixedPayloadPromisedIdProfile, mixedPayloadForeignIdProfile,
  mixedPayloadRemovedIdProfile, mixedPayloadUnresolvedIdProfile, mixedPayloadInspectionProfile,
  makeMixedPayloadSuccessRuntime, makeMixedPayloadCaughtFailureRuntime, makeMixedPayloadDeniedRuntime,
  makeMixedPayloadPromisedIdRuntime, makeMixedPayloadForeignIdRuntime,
  makeMixedPayloadRemovedIdRuntime, makeMixedPayloadUnresolvedIdRuntime,
  makeMixedPayloadInspectionRuntime,
} from "@flarex/payload-adapter/internal/testing";
import {
  POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
  POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
  POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
  pointMutationExactRuntimeWorkerConfigurationSource,
  pointMutationExactRuntimeWorkerExecutionBridgeSource,
} from "../../src/artifactRuntime";
import { POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationExactRuntimeWorkerCore.generated";
import { POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 } from
  "../../src/artifactRuntime/PointMutationRuntimeKernel.generated";
import { FUNCTION_API_CORE_MODULE_V1, FUNCTION_API_CORE_SOURCE_V1 } from
  "../../src/artifactRuntime/FunctionApiCore.generated";
import {
  APPLICATION_ERROR_PLATFORM_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
  APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1,
  applicationErrorPlatformSourceV1,
} from "../../src/artifactRuntime/ApplicationErrorExactRuntimeWorkerSource";

export interface MixedMutationProductFixtureHooks {
  readonly beforeProductBorrow?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  readonly beforeWorkflowBorrow?: () => Effect.Effect<void, CommerceTransactionError>;
  readonly beforeNative?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterProductBorrow?: (method: string, borrowed: Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>,
    rootEvaluator: Parameters<typeof makeBorrowedLogicalAttempt>[0]["rootEvaluator"]) =>
    Effect.Effect<void, CommerceTransactionError>;
  readonly afterNativeBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CommerceTransactionError>;
  readonly beforeProductClose?: (method: string, borrowed: Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>) =>
    Effect.Effect<void, CommerceTransactionError>;
  readonly afterPayloadBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CmsTransactionError>;
  readonly afterStoreAckBeforeBridgeReply?: (method: string, result: Json) => void;
  readonly observeWorkflowSql?: (sql: string) => Promise<void> | void;
  readonly observeSql?: (phase: string, sql: string) => Promise<void> | void;
}
type CurrencyFixture = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type ProductFixture = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
type PricingFixture = Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
type LinkFixture = Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
type ProductSeed = Awaited<ReturnType<typeof seedNativeProductAttemptGraph>>;
type PayloadRuntime = Effect.Success<ReturnType<typeof makeMixedPayloadSuccessRuntime>>;
export type MixedPayloadProfileKind = "success" | "caughtFailure" | "denied" | "promisedId" |
  "foreignId" | "removedId" | "unresolvedId" | "inspection";
const mixedPayloadProfiles = Object.freeze({
  success: { profile: mixedPayloadSuccessProfile, make: makeMixedPayloadSuccessRuntime },
  caughtFailure: { profile: mixedPayloadCaughtFailureProfile, make: makeMixedPayloadCaughtFailureRuntime },
  denied: { profile: mixedPayloadDeniedProfile, make: makeMixedPayloadDeniedRuntime },
  promisedId: { profile: mixedPayloadPromisedIdProfile, make: makeMixedPayloadPromisedIdRuntime },
  foreignId: { profile: mixedPayloadForeignIdProfile, make: makeMixedPayloadForeignIdRuntime },
  removedId: { profile: mixedPayloadRemovedIdProfile, make: makeMixedPayloadRemovedIdRuntime },
  unresolvedId: { profile: mixedPayloadUnresolvedIdProfile, make: makeMixedPayloadUnresolvedIdRuntime },
  inspection: { profile: mixedPayloadInspectionProfile, make: makeMixedPayloadInspectionRuntime },
});
type Journal = ReturnType<typeof createPointMutationJournalV1>;
type BoundJournal = ReturnType<typeof bindPointMutationOccJournal>;

function mapProductInvocationFailure(cause: CommerceTransactionError | LogicalParticipantAdmissionError): LogicalParticipantInvocationError {
  return new LogicalParticipantInvocationError({
    kind: cause.reason === "resourceFailure" || cause.reason === "storedCorruption"
      ? "infrastructure" : "rejection",
    cause,
  });
}

function mapPayloadInvocationFailure(cause: CmsTransactionError | LogicalParticipantAdmissionError): LogicalParticipantInvocationError {
  return new LogicalParticipantInvocationError({
    kind: cause.reason === "resourceFailure" || cause.reason === "storedCorruption" ||
      cause.reason === "statementFailure" || cause.reason === "decisionUncertain"
      ? "infrastructure" : "rejection",
    cause,
  });
}
type CreatedActivation = Extract<Effect.Success<ReturnType<
  ReturnType<typeof createApplicationMutationSessionActivationPersistenceV1>["activateEffect"]
>>, { status: "created" }>;

export interface MixedMutationProductFixture {
  readonly readSettlementLedger: () => Promise<PerformanceSettlementLedger | null>;
  readonly currency: CurrencyFixture;
  readonly product: ProductFixture;
  readonly pricing?: PricingFixture;
  readonly link?: LinkFixture;
  readonly payload?: Readonly<{ profile: PayloadRuntime["profile"];
    runtimeHistory: readonly PayloadRuntime[];
    current: () => PayloadRuntime | undefined }>;
  readonly seed: ProductSeed["seed"];
  readonly baseline: ProductSeed["baseline"];
  readonly application: CurrencyFixture["application"];
  readonly active: Effect.Success<ReturnType<CurrencyFixture["application"]["activation"]["readActive"]>>;
  readonly activation: CreatedActivation;
  readonly prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>;
  readonly binding: Effect.Success<ReturnType<typeof preparePrivateProductAttempt>>;
  readonly productProfileRevision: string;
  readonly workflowBinding?: Effect.Success<ReturnType<typeof preparePrivateProductLaunchAttempt>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof preparePrivateProductAttemptEventPolicy>>;
  readonly eventGroup: string;
  readonly journal: Journal;
  readonly store: ReturnType<typeof createSessionJournalStorePersistence>;
  readonly sealFiniteRootDirect: (result: unknown) => Effect.Effect<
    Effect.Success<ReturnType<ReturnType<typeof createSessionJournalStorePersistence>["sealFiniteRootEffect"]>>,
    Effect.Error<ReturnType<ReturnType<typeof createSessionJournalStorePersistence>["sealFiniteRootEffect"]>> |
      Effect.Error<ReturnType<typeof canonicalizeSuccessfulResultV1Effect>>>;
  readonly executionClaims: ReturnType<typeof createPointMutationExecutionClaimVaultV1>;
  readonly attempt: Effect.Success<ReturnType<Journal["openAttempt"]>>;
  readonly reopenJournalAttempt: () => ReturnType<Journal["openAttempt"]>;
  readonly bound: BoundJournal;
  readonly runAdmitted: NonNullable<BoundJournal["runAdmittedOperation"]>;
  readonly selector: ReturnType<typeof decodePointMutationSessionAttemptSelectorV1>;
  readonly schemaVersionId: CurrencyFixture["application"]["active"]["basis"]["schemaVersionId"];
  readonly logicalSchemaVersionId: CurrencyFixture["schemaVersionId"];
  readonly serviceTransactionDepth: number[];
  readonly pgTransactionObservations: Array<Readonly<{
    targetBackends: number; openTransactions: number;
  }>>;
  readonly observePgNativeSqlTransactions: () => Promise<Readonly<{
    targetBackends: number; openTransactions: number;
  }> | undefined>;
  readonly standalonePayloadPgConnections: Array<Readonly<{
    primaryTargetPid: number; standalonePid: number;
  }>>;
  readonly standaloneProductPgConnections: Array<Readonly<{
    primaryTargetPid: number; standalonePid: number;
  }>>;
  readonly standaloneLinkPgConnections: Array<Readonly<{
    primaryTargetPid: number; standalonePid: number;
  }>>;
  readonly nativeInvokeCount: Map<string, number>;
  readonly retryContexts: Array<PointMutationOccRuntimeNeutralRunnerInputV1["context"]>;
  readonly retryReturnedValues: unknown[];
  readonly sqlByPhase: Map<string, number>;
  readonly hasSqlObserver: boolean;
  readonly bridgeFailures: string[];
  readonly runWorkerd: (source?: string,
    runnerInput?: PointMutationOccRuntimeNeutralRunnerInputV1) => Promise<unknown>;
  readonly getUpdateRequest: () => Parameters<NonNullable<BoundJournal["runAdmittedOperation"]>>[0] | undefined;
  readonly getAdmittedRequest: (participant: string, method: string) =>
    Parameters<NonNullable<BoundJournal["runAdmittedOperation"]>>[0] | undefined;
  readonly getOpenTransactionDepth: () => number;
  readonly getTransactionCounts: () => Readonly<{ beginCount: number; settleCount: number }>;
  readonly setSqlPhase: (phase: string) => void;
  readonly publisherOptions: Parameters<typeof createPointCommitPublisherPortV1>[1];
  readonly participantAuthority: ReturnType<Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>["createCommitAuthority"]>;
  readonly pointCommitPorts: CurrencyFixture["application"]["sessionAuthority"];
  readonly makePublisher: () => ReturnType<typeof createPointCommitPublisherPortV1>;
  readonly preparePublication: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  readonly prepareSealedPublication: (envelope: Effect.Success<ReturnType<Journal[
    "sealSuccessfulResult"]>>) =>
    Promise<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  readonly publish: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>>;
  readonly replayPublication: () =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>>;
  readonly prepareOccPublication: (returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1]) =>
    Promise<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  readonly retryWholeAttempt: (conflict: unknown) =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createStoredPointMutationOccRerunExecutionV1>[
      "executeAuthorizedPointMutationOccRerun"]>>>;
  readonly runStandaloneProductUpdate: (next: Readonly<{ title: string; handle: string }>) => Promise<Json>;
  readonly runStandaloneProductMutation: (kind: "replaceOptionValues" | "createVariant" |
    "updateTag" | "createTag" | "removeProductTag", input: Json) => Promise<Json>;
  readonly runStandaloneLinkCreate: (variantId: string, priceSetId: string) => Promise<Json>;
  readonly runStandalonePayloadCreate: (title: string) => Promise<Json>;
  readonly retryClosedWorkflow: (value: Json) => Promise<unknown>;
  readonly readCurrentProduct: () => Promise<Json>;
  readonly close: () => Promise<void>;
}

type MixedMutationProductFixtureInput = Readonly<{
  driver: "pglite" | "postgres"; suffix: string; hooks?: MixedMutationProductFixtureHooks;
}> & (Readonly<{ workflow: true; payloadProfile: MixedPayloadProfileKind;
  workflowIds?: Readonly<{ variantId: string; priceSetId: string }> }> |
Readonly<{ workflow?: never; workflowIds?: never; payloadProfile?: MixedPayloadProfileKind }>) &
 (Readonly<{ resource?: never; fixtureIdentity?: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }> | Readonly<{ resource: CurrencyFixture["resource"]; fixtureIdentity: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }>);

async function prepareMixedMutationProductContext(input: MixedMutationProductFixtureInput,
  initialSeedSuffix: string, mode: "single" | "series") {
  const cleanup: Array<() => Promise<void>> = [];
  const provisioningStart = globalThis.performance.now();
  const currency = await logicalCurrencyFixture(input.driver, close => cleanup.push(close),
    input.resource === undefined
      ? { includeProduct: true,
        protectedRuntime: input.driver === "postgres",
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }),
        ...(input.fixtureIdentity === undefined ? {} :
        { fixtureIdentity: input.fixtureIdentity }) }
      : { includeProduct: true, resource: input.resource, fixtureIdentity: input.fixtureIdentity,
        protectedRuntime: input.driver === "postgres",
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }) });
  const provisioningMilliseconds = globalThis.performance.now() - provisioningStart;
  const application = currency.application;
  const selectAttempt = async () => {
    const active = await Effect.runPromise(application.activation.readActive());
    const applicationAdmission = await Effect.runPromise(selectApplicationMutationAdmission(
      active.selection, input.workflow === true ? "productLaunch:launch" : "users:create", {
        deploymentId: currency.deploymentId,
        controlDb: currency.control.drizzle, authority: application.authorityPorts,
        schema: application.schema }));
    return { active, applicationAdmission };
  };
  const activateAttempt = async (suffix: string, validatedArgsJson?: Readonly<{ body: string }>) => {
    const { active, applicationAdmission } = await selectAttempt();
    const activationInput = await applicationMutationActivationFixture({
      deploymentId: currency.deploymentId,
      selection: active.selection, executionAuthority: applicationAdmission.executionAuthority,
      requestKey: `mixed-product-${suffix}`, grantId: `mixed-product-${suffix}-grant`,
      ...(validatedArgsJson === undefined ? {} : { validatedArgsJson }),
    });
    const activation = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
      application.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(
      { ...activationInput, executionProfile: "finiteRoot" }));
    if (activation.status !== "created") throw new Error("Expected fresh mixed attempt");
    return { active, applicationAdmission, activationInput, activation };
  };
  const preparedModuleStart = globalThis.performance.now();
  try {
  const product = await prepareLogicalProductHost(currency);
  const pricing = input.workflow === true ? await prepareLogicalPricingHost(currency) : undefined;
  const link = input.workflow === true ? await prepareLogicalVariantPricingLinkHost(currency) : undefined;
  for (const member of [product, pricing, link]) {
    if (member === undefined) continue;
    await Effect.runPromise(member.host.initialize([]));
    await Effect.runPromise(member.host.close);
  }
  const initialSeedStart = globalThis.performance.now();
  const initialSeed = initialSeedSuffix === undefined ? undefined :
    await seedNativeProductAttemptGraph(currency, product, initialSeedSuffix,
      input.workflow === true ? "launch" : "existing");
  const initialSeedingMilliseconds = globalThis.performance.now() - initialSeedStart;
  // The ordinary fixture activates after native seeding and before preparing
  // logical source admissions, preserving the seed's admission frontier.
  const earlyActivation = mode === "single" ? await activateAttempt(input.suffix) : undefined;
  const selected = earlyActivation ?? await selectAttempt();
  const { active, applicationAdmission } = selected;
  const schemaVersionId = application.active.basis.schemaVersionId;
  const logicalSchemaVersionId = currency.schemaVersionId;
  const prepared = await Effect.runPromise(prepareLogicalRelationalAdmission({
    controlDb: currency.control.drizzle, authority: application.authorityPorts,
  }, application.uniqueConstraintEligibility, { deploymentId: currency.deploymentId,
    scopeId: application.authority.scopeId, schemaVersionId: logicalSchemaVersionId },
  product.hostInput.logicalStorage.source));
  const selectedPayload = input.payloadProfile === undefined ? undefined : mixedPayloadProfiles[input.payloadProfile];
  const payloadProfileRevision = selectedPayload === undefined ? undefined :
    createHash("sha256").update(
      `mixed-payload-${selectedPayload.profile.participant}-${input.payloadProfile}`).digest("hex");
  const compiledPayload = selectedPayload === undefined ? undefined :
    await Effect.runPromise(compilePayloadCollections(mixedPayloadPostsCollections()));
  const payloadPrepared = compiledPayload === undefined ? undefined : await Effect.runPromise(
    prepareLogicalDocumentSourceAdmission({ controlDb: currency.control.drizzle,
      authority: application.authorityPorts }, application.uniqueConstraintEligibility,
    { deploymentId: currency.deploymentId, scopeId: application.authority.scopeId,
      schemaVersionId: logicalSchemaVersionId }, compiledPayload.sourceContract));
  const binding = await Effect.runPromise(preparePrivateProductAttempt());
  const revision = createHash("sha256").update("mixed-product-workerd-events").digest("hex");
  const eventPolicy = await Effect.runPromise(preparePrivateProductAttemptEventPolicy(binding, {
    producerRevision: revision, contractRevision: revision,
    subscribers: [{ id: "mixed-product-proof", revision }],
  }));
  const workflowBinding = pricing === undefined || link === undefined ? undefined :
    await Effect.runPromise(preparePrivateProductLaunchAttempt({
      modules: {
        product: { module: product.runtime.workflow,
          logicalStorage: product.hostInput.logicalStorage },
        pricing: { module: pricing.runtime.workflow,
          logicalStorage: pricing.hostInput.logicalStorage },
        link: { module: link.runtime.workflow,
          logicalStorage: link.hostInput.logicalStorage },
      },
      identityAndAccessPolicy: product.hostInput.identityAndAccessPolicy,
      revision: createHash("sha256").update("mixed-product-launch-workflow").digest("hex"),
      subscribers: [{ id: "mixed-product-launch-proof", revision }],
    }));
  const workflowSelections: Array<Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>> = [];
  for (const source of workflowBinding?.sources ?? []) {
    workflowSelections.push(await Effect.runPromise(prepareLogicalRelationalAdmission({
      controlDb: currency.control.drizzle, authority: application.authorityPorts,
    }, application.uniqueConstraintEligibility, { deploymentId: currency.deploymentId,
      scopeId: application.authority.scopeId, schemaVersionId: logicalSchemaVersionId },
    source.logicalStorage.source)));
  }
  const store = createSessionJournalStorePersistence(application.sessionAuthority,
    { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      indexedQueries: application.indexedQueries });
  const pgTarget = currency.resource.kind === "postgres"
    ? Object.freeze({ observer: currency.resource.target,
      applicationName: (await currency.resource.target.query<{ applicationName: string }>(
        'select current_setting(\'application_name\') as "applicationName"')).rows[0]?.applicationName })
    : undefined;
  if (pgTarget !== undefined && !pgTarget.applicationName)
    throw new Error("Missing target PostgreSQL application_name");
  return { cleanup, currency, product, pricing, link, application, active,
    applicationActivation: earlyActivation, activateAttempt,
    initialSeed,
    schemaVersionId, logicalSchemaVersionId, applicationAdmission, prepared,
    selectedPayload, payloadProfileRevision, compiledPayload, payloadPrepared,
    binding, revision, eventPolicy, workflowBinding, workflowSelections, store, pgTarget,
    provisioningMilliseconds,
    initialSeedingMilliseconds,
    preparedModuleMilliseconds: globalThis.performance.now() - preparedModuleStart - initialSeedingMilliseconds };
  } catch (cause) {
    return closeMixedMutationResourcesAfterFailure(cleanup.reverse(), cause);
  }
}

type PreparedMixedMutationProductContext = Awaited<ReturnType<typeof prepareMixedMutationProductContext>>;

async function closeMixedMutationResources(resources: readonly (() => Promise<void>)[]) {
  const failures: unknown[] = [];
  for (const close of resources) {
    try { await close(); }
    catch (cause) { failures.push(cause); }
  }
  if (failures.length > 0) throw new AggregateError(failures, "Mixed mutation fixture cleanup failed");
}

async function closeMixedMutationResourcesAfterFailure(resources: readonly (() => Promise<void>)[],
  cause: unknown): Promise<never> {
  try { await closeMixedMutationResources(resources); }
  catch (cleanupCause) { throw new AggregateError([cause, cleanupCause],
    "Mixed mutation fixture setup and cleanup failed"); }
  throw cause;
}

type MixedMutationPerformanceProfile = "product" | "productPayload" | "workflow";

function mixedMutationPerformanceApplicationSource(profile: MixedMutationPerformanceProfile,
  payloadParticipant?: string): string {
  const productCalls = `
        const updated = await ctx.privateMixed.call("medusa.product", "update", seed.updateInput);
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", seed.retrieveInput);`;
  const listCall = `
        const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", seed.listInput);`;
  const payloadCalls = `
        const created = await ctx.privateMixed.call(${JSON.stringify(payloadParticipant)}, "payload-create",
          { collection: "posts", data: { title: pending.title, publishedAt: "2026-01-01" } });
        const afterHook = await ctx.privateMixed.call(${JSON.stringify(payloadParticipant)}, "payload-findByID",
          { collection: "posts", id: created.id });
        const enabled = await ctx.privateMixed.call(${JSON.stringify(payloadParticipant)}, "payload-update",
          { collection: "posts", id: created.id, data: { enabled: true } });
        const final = await ctx.privateMixed.call(${JSON.stringify(payloadParticipant)}, "payload-findByID",
          { collection: "posts", id: created.id });`;
  if (profile === "workflow") return `export default { productLaunch: { launch: { isMutation: true,
    isPublic: true, _handler: async (ctx, args) => {
      const seed = JSON.parse(args.body);
      const id = await ctx.db.insert("productLaunch", { productId: seed.productId, phase: "draft" });
      ${productCalls}
      const workflow = await ctx.privateMixed.call("medusa.workflow", "run", {
        product_id: seed.productId, tag_id: seed.tagId,
        variant_title: "Launch variant", usd_amount: 50,
      });
      ${payloadCalls}
      await ctx.db.patch(id, { phase: "launched",
        variantId: workflow.pricing.variants[0].id,
        priceSetId: workflow.pricing.priceSets[0].id,
        priceId: workflow.pricing.priceSets[0].prices[0].id,
        tagId: workflow.tags[0].id, payloadPostId: final.id });
      return { id, updated, pending, workflow, created, afterHook, enabled, final };
    } } } };`;
  if (profile === "productPayload") return `export default { users: { create: { isMutation: true,
    isPublic: true, _handler: async (ctx, args) => {
      const seed = JSON.parse(args.body);
      const id = await ctx.db.insert("users", { name: "before" });
      ${productCalls}
      ${listCall}
      ${payloadCalls}
      await ctx.db.patch(id, { name: final.title + ":" + final.score });
      return { id, updated, pending, listed, created, afterHook, enabled, final };
    } } } };`;
  return `export default { users: { create: { isMutation: true,
    isPublic: true, _handler: async (ctx, args) => {
      const seed = JSON.parse(args.body);
      const id = await ctx.db.insert("users", { name: "before" });
      ${productCalls}
      ${listCall}
      await ctx.db.patch(id, { name: pending.title });
      return { id, updated, pending, listed };
    } } } };`;
}

export async function createMixedMutationProductFixture(
  input: MixedMutationProductFixtureInput,
): Promise<MixedMutationProductFixture> {
  const preparedContext = await prepareMixedMutationProductContext(input, input.suffix, "single");
  try {
    const seedGraph = preparedContext.initialSeed;
    if (seedGraph === undefined) throw new Error("Missing prepared Product graph");
    return await createMixedMutationAttemptFixture(input, preparedContext, seedGraph, true);
  } catch (cause) {
    return closeMixedMutationResourcesAfterFailure(preparedContext.cleanup.reverse(), cause);
  }
}

export interface MixedMutationPerformanceSeries {
  readonly currency: CurrencyFixture;
  readonly profileRevisions: Readonly<{ product: string; payload?: string; workflow?: string }>;
  readonly workerConstructionCount: number;
  readonly provisioningMilliseconds: number;
  readonly preparedModuleMilliseconds: number;
  readonly initialSeedingMilliseconds: number;
  readonly additionalSetupSeedingMilliseconds: number;
  readonly setTrace: (trace: MixedMutationPerformanceTrace) => void;
  readonly prepareAttempt: (index: number) => Promise<void>;
  readonly runAttempt: (index: number) => Promise<Readonly<{
    fixture: MixedMutationProductFixture;
    seed: ProductSeed["seed"];
    returnedValue: unknown;
    workerConstructionMilliseconds: number;
    sealedJournalBytes: number;
    publication: Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["publishPointCommit"]>>;
  }>>;
  readonly close: () => Promise<void>;
}

/** Test-only repeated private attempts over one prepared module graph, scope,
 * and pair of database pools. Each attempt gets a fresh single-use Worker. */
export async function prepareMixedMutationPerformanceSeries(input: Readonly<{
  driver: "pglite" | "postgres";
  suffix: string;
  profile: MixedMutationPerformanceProfile;
  sampleCount: number;
}>): Promise<MixedMutationPerformanceSeries> {
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount < 1 || input.sampleCount > 30)
    throw new Error("Invalid finite mixed performance sample count");
  const makeInput = (suffix: string): MixedMutationProductFixtureInput =>
    input.profile === "workflow"
      ? { driver: input.driver, suffix, workflow: true, payloadProfile: "success" }
      : input.profile === "productPayload"
        ? { driver: input.driver, suffix, payloadProfile: "success" }
        : { driver: input.driver, suffix };
  const context = await prepareMixedMutationProductContext(makeInput(input.suffix),
    `${input.suffix}-0`, "series");
  const seeded = new Map<number, ProductSeed>();
  const attempted = new Set<number>();
  const completed = new Set<number>();
  const openFixtures = new Set<MixedMutationProductFixture>();
  let workerConstructionCount = 0;
  let trace: MixedMutationPerformanceTrace | undefined;
  let closed = false;
  try {
    if (context.initialSeed === undefined) throw new Error("Missing first mixed performance seed");
    seeded.set(0, context.initialSeed);
    const additionalSetupSeedStart = globalThis.performance.now();
    if (input.profile !== "workflow") {
      for (let index = 1; index < input.sampleCount; index += 1) {
        seeded.set(index, await seedNativeProductAttemptGraph(context.currency, context.product,
          `${input.suffix}-${index}`, "existing"));
      }
    }
    const additionalSetupSeedingMilliseconds = globalThis.performance.now() - additionalSetupSeedStart;
    const applicationSource = mixedMutationPerformanceApplicationSource(input.profile,
      context.selectedPayload?.profile.participant);
    const prepareAttempt = async (index: number) => {
      if (closed || index < 0 || index >= input.sampleCount || !Number.isSafeInteger(index))
        throw new Error("Invalid mixed performance attempt index");
      if (seeded.has(index)) return;
      if (input.profile !== "workflow") throw new Error("Missing prepared Product graph");
      if (index > 0) {
        if (!completed.has(index - 1)) throw new Error("Previous workflow sample did not publish");
        const previous = seeded.get(index - 1);
        if (previous === undefined) throw new Error("Missing preceding workflow seed");
        await runNativeStandaloneProductMutation(context.currency, context.product,
          `performance-clear-${input.suffix}-${index - 1}`, "updateTag", {
            selector: { id: previous.seed.tagId },
            update: { value: `launched-${input.suffix}-${index - 1}` },
          });
      }
      seeded.set(index, await seedNativeProductAttemptGraph(context.currency, context.product,
        `${input.suffix}-${index}`, "launch"));
    };
    const runAttempt = async (index: number) => {
      if (closed || attempted.has(index)) throw new Error("Mixed performance attempt already used or closed");
      const seedGraph = seeded.get(index);
      if (seedGraph === undefined) throw new Error("Prepare the disjoint graph before measurement");
      attempted.add(index);
      const runPhase = <T>(name: string, run: () => Promise<T>): Promise<T> =>
        trace === undefined ? run() : trace.withPhase(name, run);
      const seed = seedGraph.seed;
      const validatedArgsJson = Object.freeze({ body: JSON.stringify(input.profile === "workflow"
        ? { productId: seed.productId, tagId: seed.tagId,
          updateInput: seed.updateInput, retrieveInput: seed.retrieveInput }
        : { updateInput: seed.updateInput, retrieveInput: seed.retrieveInput,
          listInput: seed.listInput }) });
      let workerConstructionMilliseconds: number | null = null;
      let sealedJournalBytes: number | null = null;
      const fixture = await runPhase("request admission", () => createMixedMutationAttemptFixture(
        makeInput(`${input.suffix}-${index}`), context, seedGraph, false,
        { validatedArgsJson, onWorkerReady: milliseconds => {
          workerConstructionCount++;
          workerConstructionMilliseconds = milliseconds;
        }, onSealBytes: bytes => { sealedJournalBytes = bytes; },
        ...(trace === undefined ? {} : { trace }) }));
      openFixtures.add(fixture);
      try {
        const raw = await runPhase("Worker execution", () => fixture.runWorkerd(applicationSource));
        if (workerConstructionMilliseconds === null) throw new Error("Missing fresh Worker readiness");
        const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
          result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
        const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
          success.result.result))).value;
        const publicationEffect = await runPhase("journal seal and OCC verification",
          () => fixture.preparePublication(returnedValue));
        const publication = await runPhase("authoritative publication",
          () => Effect.runPromise(publicationEffect));
        if (publication.kind !== "published") throw new Error("Missing first committed outcome");
        if (sealedJournalBytes === null || sealedJournalBytes < 1)
          throw new Error("Missing canonical sealed journal byte count");
        completed.add(index);
        return Object.freeze({ fixture, seed, returnedValue,
          workerConstructionMilliseconds, sealedJournalBytes, publication });
      } finally {
        await fixture.close();
        openFixtures.delete(fixture);
      }
    };
    return Object.freeze({ currency: context.currency,
      profileRevisions: Object.freeze({ product: context.revision,
        ...(context.payloadProfileRevision === undefined ? {} : { payload: context.payloadProfileRevision }),
        ...(context.workflowBinding === undefined ? {} : { workflow: context.workflowBinding.profileRevision }) }),
      get workerConstructionCount() { return workerConstructionCount; },
      provisioningMilliseconds: context.provisioningMilliseconds,
      preparedModuleMilliseconds: context.preparedModuleMilliseconds,
      initialSeedingMilliseconds: context.initialSeedingMilliseconds,
      additionalSetupSeedingMilliseconds,
      setTrace: (next: MixedMutationPerformanceTrace) => { trace = next; },
      prepareAttempt, runAttempt,
      close: async () => {
        if (closed) return;
        closed = true;
        await closeMixedMutationResources([...Array.from(openFixtures, fixture => fixture.close),
          ...context.cleanup.reverse()]);
      },
    });
  } catch (cause) {
    return closeMixedMutationResourcesAfterFailure(context.cleanup.reverse(), cause);
  }
}

async function createMixedMutationAttemptFixture(input: MixedMutationProductFixtureInput,
  context: PreparedMixedMutationProductContext, seedGraph: ProductSeed,
  ownsContext: boolean, performance?: Readonly<{
    validatedArgsJson: Readonly<{ body: string }>;
    onWorkerReady: (milliseconds: number) => void;
    onSealBytes: (bytes: number) => void;
    trace?: MixedMutationPerformanceTrace;
  }>): Promise<MixedMutationProductFixture> {
  const { cleanup, currency, product, pricing, link, application,
    schemaVersionId, logicalSchemaVersionId, prepared,
    selectedPayload, payloadProfileRevision, compiledPayload, payloadPrepared,
    binding, revision, eventPolicy, workflowBinding, workflowSelections, store, pgTarget } = context;
  const { seed, baseline } = seedGraph;
  const selected = performance === undefined ? context.applicationActivation
    : await context.activateAttempt(input.suffix, performance.validatedArgsJson);
  if (selected === undefined) throw new Error("Missing single-attempt activation");
  const { active, applicationAdmission, activationInput, activation } = selected;
  const eventGroup = admittedCommerceEventGroup({
    scopeUuid: projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid,
    sessionId: activation.anchor.sessionId, attemptFence: activation.anchor.attemptFence,
  });
  const executionClaims = createPointMutationExecutionClaimVaultV1();
    const hasSqlObserver = currency.observeSql !== undefined;
    let sqlPhase = "prepare";
    const sqlByPhase = new Map<string, number>();
    let openTransactionDepth = 0;
    let beginCount = 0, settleCount = 0;
    currency.observeSql?.(async sql => {
      sqlByPhase.set(sqlPhase, (sqlByPhase.get(sqlPhase) ?? 0) + 1);
      if (/^\s*begin\b/i.test(sql)) { openTransactionDepth += 1; beginCount += 1; }
      if (/^\s*(commit|rollback)\b/i.test(sql)) { openTransactionDepth -= 1; settleCount += 1; }
      await input.hooks?.observeSql?.(sqlPhase, sql);
      if (sqlPhase === "workflow:run") await input.hooks?.observeWorkflowSql?.(sql);
    });
    const serviceTransactionDepth: number[] = [];
    const pgTransactionObservations: Array<Readonly<{
      targetBackends: number; openTransactions: number;
    }>> = [];
    const observePgNativeSqlTransactions = async () => {
      if (pgTarget === undefined) return undefined;
      const reading = await pgTarget.observer.query<{
        targetBackends: number; openTransactions: number;
      }>(`select count(*)::int as "targetBackends",
                count(*) filter (where pid <> pg_backend_pid() and
                  xact_start is not null)::int as "openTransactions"
           from pg_stat_activity
          where datname = current_database() and application_name = $1`,
        [pgTarget.applicationName]);
      return reading.rows[0];
    };
    const standalonePayloadPgConnections: Array<Readonly<{
      primaryTargetPid: number; standalonePid: number;
    }>> = [];
    const standaloneProductPgConnections: Array<Readonly<{
      primaryTargetPid: number; standalonePid: number;
    }>> = [];
    const standaloneLinkPgConnections: Array<Readonly<{
      primaryTargetPid: number; standalonePid: number;
    }>> = [];
    const nativeInvokeCount = new Map<string, number>();
    let lastBorrowedWorkflowInvoke: ((value: Json) => Promise<unknown>) | undefined;
    const retryContexts: Array<PointMutationOccRuntimeNeutralRunnerInputV1["context"]> = [];
    const retryReturnedValues: unknown[] = [];
    const payloadRuntimeHistory: PayloadRuntime[] = [];
    const payloadRuntimes = new WeakMap<object, PayloadRuntime>();
    const payloadScopes = new Set<Scope.Scope>();
    const ensurePayloadRuntime = (attemptHandle: object) => Effect.gen(function* () {
      const existing = payloadRuntimes.get(attemptHandle);
      if (existing !== undefined) return existing;
      if (selectedPayload === undefined || compiledPayload === undefined)
        return yield* Effect.fail(new CmsTransactionError({ reason: "invalidAuthority" }));
      const scope = yield* Scope.make();
      const runtime = yield* Scope.provide(scope)(selectedPayload.make(compiledPayload)).pipe(
        Effect.onError(() => Scope.close(scope, Exit.succeed(undefined))));
      payloadRuntimes.set(attemptHandle, runtime);
      payloadScopes.add(scope);
      payloadRuntimeHistory.push(runtime);
      return runtime;
    });
    const closePayloadScopes = Effect.gen(function* () {
      for (const scope of payloadScopes) yield* Scope.close(scope, Exit.succeed(undefined));
      payloadScopes.clear();
    });
    let initialPersistenceAttempt: Effect.Success<ReturnType<typeof store.openAttemptEffect>> | undefined;
    const journalStore = Object.freeze({ ...store,
      openAttemptEffect: (...args: Parameters<typeof store.openAttemptEffect>) =>
        store.openAttemptEffect(...args).pipe(Effect.tap(handle => Effect.sync(() => {
          initialPersistenceAttempt ??= handle;
        }))),
      completeSealEffect: (...args: Parameters<typeof store.completeSealEffect>) =>
        store.completeSealEffect(...args).pipe(Effect.tap(() => Effect.sync(() =>
          performance?.onSealBytes(args[1].canonicalBytes.byteLength)))),
      sealFiniteRootEffect: (...args: Parameters<typeof store.sealFiniteRootEffect>) =>
        store.sealFiniteRootEffect(...args).pipe(Effect.tap(sealed => Effect.sync(() =>
          performance?.onSealBytes(sealed.journalByteLength)))),
    });
    const journal = createPointMutationJournalV1(journalStore, executionClaims.admission,
      issueSetupSeededSyscallValidatorProofV1({ scopeId: application.authority.scopeId,
        schemaVersionId, schemaManifest: applicationAdmission.schema.manifest }), [{
        participant: "medusa.product",
        admission: { participant: "medusa.product",
          operationMethods: ["update", "retrieve", "listByHandle"],
          profileRevision: revision,
          sources: [{ selection: prepared, application: active.selection,
            methods: ["update", "retrieve", "listByHandle"] }] },
        borrow: borrowedInput => Effect.suspend(() => input.hooks?.beforeProductBorrow?.(borrowedInput.method) ?? Effect.void).pipe(
          Effect.andThen(makeBorrowedLogicalAttempt({
            ...borrowedInput, admission: borrowedInput.admissions[0]!,
          })),
          Effect.map(borrowed => Object.freeze({
            abort: borrowed.abort,
            currentUsage: borrowed.currentUsage,
            invoke: (method: string, args: Json) => Effect.gen(function* () {
              if (pgTarget !== undefined && performance === undefined) {
                const reading = yield* Effect.tryPromise({
                  try: observePgNativeSqlTransactions,
                  catch: cause => commerceError("resourceFailure", cause),
                });
                if (reading === undefined || reading.targetBackends < 1 ||
                  reading.openTransactions !== 0)
                  return yield* Effect.fail(commerceError("resourceFailure",
                    new Error(`Product native callback overlapped target SQL transaction: ${JSON.stringify(reading)}`)));
                pgTransactionObservations.push(Object.freeze(reading));
              }
              serviceTransactionDepth.push(openTransactionDepth);
              nativeInvokeCount.set(method, (nativeInvokeCount.get(method) ?? 0) + 1);
              yield* input.hooks?.beforeNative?.(method) ?? Effect.void;
              yield* input.hooks?.afterProductBorrow?.(method, borrowed, borrowedInput.rootEvaluator) ?? Effect.void;
              const beforeProductClose = input.hooks?.beforeProductClose;
              const nativeBorrowed = beforeProductClose === undefined ? borrowed : Object.freeze({ ...borrowed,
                close: Effect.suspend(() => beforeProductClose(method, borrowed)).pipe(Effect.andThen(borrowed.close)) });
              const completed = yield* executePrivateProductAttemptOperation(binding, nativeBorrowed, method, args,
                eventPolicy);
              yield* input.hooks?.afterNativeBeforeAck?.(method, completed.result) ?? Effect.void;
              return Object.freeze({ result: completed.result, changes: completed.changes,
                eventIntents: completed.eventIntents.map(intent => Object.freeze({
                  sourceKey: "medusa.product", intent })),
                workBytes: completed.workBytes,
                workCalls: completed.workCalls });
            }).pipe(Effect.mapError(mapProductInvocationFailure)),
          })),
          Effect.mapError(mapProductInvocationFailure)),
      }, ...(payloadPrepared === undefined || selectedPayload === undefined ? [] : [{
        participant: selectedPayload.profile.participant,
        admission: { participant: selectedPayload.profile.participant,
          operationMethods: ["payload-create", "payload-update", "payload-findByID"],
          profileRevision: payloadProfileRevision!,
          sources: [{ selection: payloadPrepared, application: active.selection,
            methods: ["payload-create", "payload-update", "payload-findByID"] }] },
        borrow: (borrowedInput: Parameters<LogicalParticipantBorrow>[0]) => Effect.gen(function* () {
          const runtime = yield* ensurePayloadRuntime(borrowedInput.attempt);
          const cms = yield* makeBorrowedCmsAttempt({
            ...borrowedInput, admission: borrowedInput.admissions[0]!,
          });
          return Object.freeze({
            abort: cms.abort,
            currentUsage: cms.currentUsage,
            invoke: (method: string, args: Json) => Effect.gen(function* () {
              nativeInvokeCount.set(method, (nativeInvokeCount.get(method) ?? 0) + 1);
              const result = yield* cms.withinDeadline(runtime.invoke(cms.context, method, args));
              const closed = yield* cms.close;
              yield* input.hooks?.afterPayloadBeforeAck?.(method, result) ?? Effect.void;
              const sourceKey = compiledPayload?.sourceContract.sourceKey;
              if (sourceKey === undefined)
                return yield* Effect.fail(new CmsTransactionError({ reason: "invalidAuthority" }));
              return Object.freeze({ result, changes: closed.changes,
                eventIntents: closed.events.map(intent => Object.freeze({
                  sourceKey, intent })),
                workBytes: closed.workBytes, workCalls: closed.workCalls });
            }).pipe(Effect.mapError(mapPayloadInvocationFailure)),
          });
        }).pipe(Effect.mapError(mapPayloadInvocationFailure)),
      }]), ...(workflowBinding === undefined ? [] : [{
        participant: "medusa.workflow",
        admission: { participant: "medusa.workflow", operationMethods: ["run"],
          profileRevision: workflowBinding.profileRevision,
          sources: workflowBinding.sources.map((source, index) => ({
            selection: workflowSelections[index]!, application: active.selection,
            methods: source.methods,
          })) },
        borrow: (borrowedInput: Parameters<LogicalParticipantBorrow>[0]) =>
          Effect.suspend(() => input.hooks?.beforeWorkflowBorrow?.() ?? Effect.void).pipe(
            Effect.andThen(workflowBinding.borrow(borrowedInput)),
            Effect.map(borrowed => {
              lastBorrowedWorkflowInvoke = value => Effect.runPromise(borrowed.invoke(value));
              return Object.freeze({
              abort: borrowed.abort,
              currentUsage: borrowed.currentUsage,
              invoke: (method: string, args: Json) => Effect.gen(function* () {
                if (method !== "run") return yield* Effect.fail(commerceError("invalidAuthority"));
                if (pgTarget !== undefined && performance === undefined) {
                  const reading = yield* Effect.tryPromise({
                    try: observePgNativeSqlTransactions,
                    catch: cause => commerceError("resourceFailure", cause),
                  });
                  if (reading === undefined || reading.targetBackends < 1 ||
                    reading.openTransactions !== 0)
                    return yield* Effect.fail(commerceError("resourceFailure",
                      new Error(`Workflow callback overlapped target SQL transaction: ${JSON.stringify(reading)}`)));
                  pgTransactionObservations.push(Object.freeze(reading));
                }
                serviceTransactionDepth.push(openTransactionDepth);
                nativeInvokeCount.set("workflow:run", (nativeInvokeCount.get("workflow:run") ?? 0) + 1);
                yield* input.hooks?.beforeNative?.("workflow:run") ?? Effect.void;
                const completed = yield* borrowed.invoke(args);
                yield* input.hooks?.afterNativeBeforeAck?.("workflow:run", completed.result) ?? Effect.void;
                return completed;
              }).pipe(Effect.mapError(mapProductInvocationFailure)),
              });
            }),
            Effect.mapError(mapProductInvocationFailure)),
      }])], "finiteRoot");
    const rawSelector = Object.freeze({
      deploymentId: String(activation.anchor.deploymentId),
      scopeId: String(activation.anchor.scopeId),
      sessionId: String(activation.anchor.sessionId),
      attemptFence: String(activation.anchor.attemptFence),
    });
    const selector = decodePointMutationSessionAttemptSelectorV1(rawSelector);
    const loaded = await Effect.runPromise(createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority)).load(rawSelector));
    const claim = executionClaims.issuer.mint({ selector, observation: activation.executionClaim,
      mode: "execute" });
    const execution = Result.getOrThrow(executionClaims.admission.admit(claim, "execute"));
    const attempt = await Effect.runPromise(journal.openAttempt(loaded, execution));
    const bound = bindPointMutationOccJournal(journal, attempt);
    const runAdmitted = bound.runAdmittedOperation;
    if (runAdmitted === undefined) throw new Error("Missing bound admitted participant");
    let updateRequest: Parameters<typeof runAdmitted>[0] | undefined;
    const admittedRequests = new Map<string, Parameters<typeof runAdmitted>[0]>();
    const bridgeFailures: string[] = [];
    const makeBridge = (runtimeJournal: PointMutationOccBoundJournalV1) => {
      const tableHandles = new Map<string, Effect.Success<ReturnType<typeof bound.resolvePointTable>>>();
      return async (request: Request): Promise<Response> => {
      try {
        const message = await request.json() as Readonly<{ kind: string; tableName?: string;
          sequence?: string; operation?: Record<string, unknown>; frame?: unknown }>;
        let value: unknown;
        if (message.kind === "point") {
          sqlPhase = "application";
          if (typeof message.tableName !== "string" || message.operation === undefined)
            throw new Error("Invalid point bridge request");
          const operation = message.operation;
          const syscallSequence = operation.syscallSequence;
          if (typeof syscallSequence !== "string") throw new Error("Invalid point bridge sequence");
          let table = tableHandles.get(message.tableName);
          if (table === undefined) {
            table = await Effect.runPromise(runtimeJournal.resolvePointTable(message.tableName));
            tableHandles.set(message.tableName, table);
          }
          const runPoint = () => Effect.runPromise(runtimeJournal.runPointOperation(table, {
            ...operation,
            syscallSequence: CommitSyscallSequenceV1Schema.make(
              BigInt(syscallSequence)),
          }));
          const result = performance?.trace === undefined ? await runPoint()
            : await performance.trace.withPhase("Application point", runPoint);
          if (result.kind !== "completed") throw new Error(`Point operation ${result.kind}`);
          value = result.outcome;
        } else if (message.kind === "admitted") {
          if (typeof message.sequence !== "string") throw new Error("Invalid admitted sequence");
          const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result(message.frame));
          sqlPhase = encoded.operation.participant === "medusa.product"
            ? `product:${encoded.operation.operation}`
            : encoded.operation.participant === "medusa.workflow"
              ? `workflow:${encoded.operation.operation}`
              : `payload:${encoded.operation.operation}`;
          const admittedInput = {
            syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(message.sequence)),
            operation: encoded.operation, requestBytes: encoded.bytes,
            requestSha256: createHash("sha256").update(encoded.bytes).digest(),
          };
          admittedRequests.set(`${encoded.operation.participant}:${encoded.operation.operation}`, admittedInput);
          if (encoded.operation.operation === "update") updateRequest = admittedInput;
          const runtimeAdmitted = runtimeJournal.runAdmittedOperation;
          if (runtimeAdmitted === undefined) throw new Error("Missing runtime admitted participant");
          const runParticipant = () => Effect.runPromise(runtimeAdmitted(admittedInput));
          const admittedValue = performance?.trace === undefined ? await runParticipant()
            : await performance.trace.withPhase(
              `${encoded.operation.participant}:${encoded.operation.operation}`, runParticipant);
          value = admittedValue;
          input.hooks?.afterStoreAckBeforeBridgeReply?.(encoded.operation.operation, admittedValue);
        } else throw new Error("Unsupported bridge request");
        return Response.json({ ok: true, value });
      } catch (cause) {
        bridgeFailures.push(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n${inspect(cause, { depth: 5 })}`);
        return Response.json({ ok: false, error: cause instanceof Error ? cause.message : String(cause) },
          { status: 500 });
      }
    };
    };
  async function runWorkerd(source?: string,
    runnerInput?: PointMutationOccRuntimeNeutralRunnerInputV1): Promise<unknown> {
    const bridge = makeBridge(runnerInput?.journal ?? bound);
    const executionTime = runnerInput?.context.executionTime ?? Date.UTC(2026, 6, 24);
    const argumentsJson = runnerInput?.argumentsJson ?? activationInput.evidence.validatedArgsJson;
    const normalizedArguments = normalizeFlarexValueV1(argumentsJson);
    const runtimeTarget = applicationAdmission.executionAuthority.authority.runtimeTarget;
    const executionModule = runtimeTarget.executionModulePath;
    const request = JSON.stringify({ format: "flarex.point-mutation-exact-runtime", version: 1,
      artifact: { runtime: "dynamic-worker", artifactId: "artifact_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        sourcePackageHash: "a".repeat(64), executionModule },
      function: { path: runtimeTarget.function.path, executionModule,
        kind: runtimeTarget.function.kind, visibility: runtimeTarget.function.visibility,
        argsValidator: runtimeTarget.function.args, returnsValidator: runtimeTarget.function.returns },
      auth: { kind: "anonymous" }, arguments: argumentsJson,
      argumentArraySemanticBytes: runnerInput?.argumentArraySemanticBytes ??
        requirePointMutationArgumentSemanticSizeV1(normalizedArguments.semanticSizeBytes),
      tables: runnerInput?.stableBindings.map(binding => ({ tableId: binding.tableId,
        logicalName: binding.logicalName })) ?? (input.workflow === true
        ? [{ tableId: 1, logicalName: "productLaunch" }, { tableId: 2, logicalName: "users" }]
        : [{ tableId: 1, logicalName: "users" }]),
      context: { executionId: runnerInput?.context.executionId ?? "mixed-product-1",
        logScopeId: runnerInput?.context.logScopeId ?? "mixed-product-log-1",
        randomSeed: Array.from(runnerInput?.context.randomSeed ?? new Uint8Array(32).fill(5)),
        executionTime, initialCreationTimeCursor:
          runnerInput?.context.initialCreationTimeCursor ?? executionTime },
    });
    const productSource = `export default { users: { create: { isMutation: true,
      isPublic: true, _handler: async (ctx) => {
        const id = await ctx.db.insert("users", { name: "before" });
        const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});
        const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", ${JSON.stringify(seed.listInput)});
        await ctx.db.patch(id, { name: pending.title });
        return { id, updated, pending, listed };
      },
    } } };`;
    const payloadSource = selectedPayload === undefined ? undefined :
      `export default { users: { create: { isMutation: true,
      isPublic: true, _handler: async (ctx) => {
        const id = await ctx.db.insert("users", { name: "before" });
        const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});
        const listed = await ctx.privateMixed.call("medusa.product", "listByHandle", ${JSON.stringify(seed.listInput)});
        const created = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-create", { collection: "posts", data: { title: pending.title, publishedAt: "2026-01-01" } });
        const afterHook = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-findByID", { collection: "posts", id: created.id });
        const enabled = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-update", { collection: "posts", id: created.id, data: { enabled: true } });
        const final = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-findByID", { collection: "posts", id: created.id });
        await ctx.db.patch(id, { name: final.title + ":" + final.score });
        return { id, updated, pending, listed, created, afterHook, enabled, final };
      },
    } } };`;
    const workflowSource = input.workflow !== true || selectedPayload === undefined ? undefined :
      `export default { productLaunch: { launch: { isMutation: true,
      isPublic: true, _handler: async (ctx) => {
        const id = await ctx.db.insert("productLaunch", {
          productId: ${JSON.stringify(seed.productId)}, phase: "draft" });
        const updated = await ctx.privateMixed.call("medusa.product", "update", ${JSON.stringify(seed.updateInput)});
        const pending = await ctx.privateMixed.call("medusa.product", "retrieve", ${JSON.stringify(seed.retrieveInput)});
        const workflow = await ctx.privateMixed.call("medusa.workflow", "run", {
          product_id: ${JSON.stringify(seed.productId)}, tag_id: ${JSON.stringify(seed.tagId)},
          variant_title: "Launch variant", usd_amount: 50,
          ${input.workflowIds === undefined ? "" :
            `variant_id: ${JSON.stringify(input.workflowIds.variantId)},
             price_set_id: ${JSON.stringify(input.workflowIds.priceSetId)},`}
        });
        const created = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-create", { collection: "posts", data: { title: pending.title, publishedAt: "2026-01-01" } });
        const afterHook = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-findByID", { collection: "posts", id: created.id });
        const enabled = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-update", { collection: "posts", id: created.id, data: { enabled: true } });
        const final = await ctx.privateMixed.call(${JSON.stringify(selectedPayload.profile.participant)},
          "payload-findByID", { collection: "posts", id: created.id });
        await ctx.db.patch(id, { phase: "launched",
          variantId: workflow.pricing.variants[0].id,
          priceSetId: workflow.pricing.priceSets[0].id,
          priceId: workflow.pricing.priceSets[0].prices[0].id,
          tagId: workflow.tags[0].id,
          payloadPostId: final.id });
        return { id, updated, pending, workflow, created, afterHook, enabled, final };
      },
    } } };`;
    const applicationSource = source ?? workflowSource ?? payloadSource ?? productSource;
    const workerPhase = <T>(name: string, run: () => Promise<T>): Promise<T> =>
      performance?.trace === undefined ? run() : performance.trace.withPhase(name, run);
    const workerStarted = globalThis.performance.now();
    let dispatchBridge = bridge;
    const serviceBinding = (request: Request) => dispatchBridge(request);
    const platformSource = applicationErrorPlatformSourceV1({
      runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
      captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
      captureProjectionExportName: "captureCoreApplicationErrorV1",
      invalid: { kind: "nativeError" },
    });
    const worker = await workerPhase("Worker construction and ready", async () => {
      const created = new Miniflare({ compatibilityDate: "2026-06-18",
      serviceBindings: { MIXED_JOURNAL: serviceBinding }, modules: [
        { type: "ESModule", path: "worker.js", contents: `${POINT_MUTATION_EXACT_RUNTIME_WORKER_CORE_SOURCE_V1}
export default { async fetch(_request, env) {
  const invoke = async (kind, payload) => {
    const response = await env.MIXED_JOURNAL.fetch("https://mixed-journal.test/", {
      method: "POST", body: JSON.stringify({ kind, ...payload }),
    });
    const answer = await response.json();
    if (!answer.ok) throw new Error(answer.error);
    return answer.value;
  };
  const journal = {
    resolvePointTable(tableName) { return {
      runPointOperation: operation => invoke("point", { tableName,
        operation: { ...operation, syscallSequence: String(operation.syscallSequence) } }),
    }; },
    runAdmittedFrameworkOperation: (sequence, frame) =>
      invoke("admitted", { sequence: String(sequence), frame }),
  };
  const input = ${request};
  input.context.randomSeed = new Uint8Array(input.context.randomSeed);
  try {
    const result = await Reflect.apply(FlarexPointMutationExactRuntimeV1.prototype.runPrivateMixed,
      {}, [input, journal]);
    return Response.json({ kind: "result", result });
  } catch (cause) {
    return Response.json({ kind: "error", name: cause?.name, message: cause?.message,
      cause: cause?.cause?.message });
  }
} };` },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_CONFIG_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerConfigurationSource({
            executionModule, moduleTime: executionTime,
            moduleRandomSeedHex: "a".repeat(64) }) },
        { type: "ESModule", path: POINT_MUTATION_EXACT_RUNTIME_EXECUTION_BRIDGE_MODULE_V1,
          contents: pointMutationExactRuntimeWorkerExecutionBridgeSource(executionModule) },
        { type: "ESModule", path: POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1,
          contents: POINT_MUTATION_RUNTIME_KERNEL_SOURCE_V1 },
        { type: "ESModule", path: FUNCTION_API_CORE_MODULE_V1,
          contents: FUNCTION_API_CORE_SOURCE_V1 },
        { type: "ESModule", path: APPLICATION_ERROR_PLATFORM_MODULE_V1,
          contents: platformSource },
        { type: "ESModule", path: APPLICATION_ERROR_PUBLIC_VALUES_MODULE_V1,
          contents: APPLICATION_ERROR_PUBLIC_VALUES_SOURCE_V1 },
        { type: "ESModule", path: executionModule, contents: applicationSource },
      ] });
      try {
        if (performance !== undefined) await created.ready;
        return created;
      } catch (cause) {
        await created.dispose();
        throw cause;
      }
    });
    performance?.onWorkerReady(globalThis.performance.now() - workerStarted);
    let workerd: unknown;
    try {
      const response = await workerPhase("Worker dispatch", () => {
        dispatchBridge = performance?.trace === undefined ? bridge : performance.trace.bindCurrent(bridge);
        return worker.dispatchFetch("https://mixed-product.test/");
      });
      workerd = await response.json();
    } finally { await workerPhase("Worker disposal", () => worker.dispose()); }
    if (typeof workerd === "object" && workerd !== null && "kind" in workerd &&
      workerd.kind === "error") {
      const failure = new Error(`Native Worker failed: ${JSON.stringify(workerd)}\n${bridgeFailures.join("\n")}`);
      const cleanup = await Effect.runPromiseExit(closePayloadScopes);
      if (Exit.isFailure(cleanup)) bridgeFailures.push(`Payload attempt scope cleanup: ${String(cleanup.cause)}`);
      throw failure;
    }
    return workerd;
  }
  const participantAuthority = prepared.createCommitAuthority(active.selection,
    "medusa.product", ["update", "retrieve", "listByHandle"]);
  const payloadAuthority = payloadPrepared === undefined || selectedPayload === undefined ? undefined :
    payloadPrepared.createCommitAuthority(active.selection, selectedPayload.profile.participant,
      ["payload-create", "payload-update", "payload-findByID"]);
  const workflowAuthorities = workflowBinding === undefined ? [] :
    workflowSelections.map((selection, index) => selection.createCommitAuthority(
      active.selection, "medusa.workflow", workflowBinding.sources[index]!.methods));
  const logicalParticipants = Object.freeze([participantAuthority,
    ...(payloadAuthority === undefined ? [] : [payloadAuthority]), ...workflowAuthorities]);
  const logicalOperationProfiles = Object.freeze([{
    participant: "medusa.product", operationMethods: ["update", "retrieve", "listByHandle"],
    profileRevision: revision, sources: [participantAuthority],
  }, ...(payloadAuthority === undefined || selectedPayload === undefined ||
    payloadProfileRevision === undefined ? [] : [{
    participant: selectedPayload.profile.participant,
    operationMethods: ["payload-create", "payload-update", "payload-findByID"],
    profileRevision: payloadProfileRevision, sources: [payloadAuthority],
  }]), ...(workflowBinding === undefined ? [] : [{
    participant: "medusa.workflow", operationMethods: ["run"],
    profileRevision: workflowBinding.profileRevision, sources: workflowAuthorities,
    operationEvents: { policy: workflowBinding.eventPolicy,
      selection: workflowBinding.operationEventSelection },
  }])]);
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(application.control.drizzle);
  const uniqueConstraintEligibility = createAppUniqueConstraintSetEligibilityPortV1({
    controlDb: application.control.drizzle, authority: application.authorityPorts,
  }, uniqueConstraints);
  const publicationQueries = new Map<string, { ownerQuery: string; dispatches: number;
    parameterCount: number; scalarParameterBytes: number; unknownEncodingParameters: number }>();
  const publisherOptions = Object.freeze({
    ...(performance?.trace === undefined ? {} : { observeQuery: (query: { name: string; params: readonly unknown[] }) => {
      const observation = publicationQueries.get(query.name) ?? { ownerQuery: query.name,
        dispatches: 0, parameterCount: 0, scalarParameterBytes: 0, unknownEncodingParameters: 0 };
      observation.dispatches++;
      observation.parameterCount += query.params.length;
      for (const parameter of query.params) {
        if (parameter instanceof Uint8Array) observation.scalarParameterBytes += parameter.byteLength;
        else if (typeof parameter === "string") observation.scalarParameterBytes += new TextEncoder().encode(parameter).byteLength;
        else if (typeof parameter === "number" || typeof parameter === "bigint" || typeof parameter === "boolean")
          observation.scalarParameterBytes += new TextEncoder().encode(String(parameter)).byteLength;
        else if (parameter !== null) observation.unknownEncodingParameters++;
      }
      publicationQueries.set(query.name, observation);
    } }),
    developerIndexes: application.developerIndexes,
    intrinsicCreationTimeIndexes: application.intrinsicCreationTimeIndexes,
    uniqueConstraints,
    uniqueConstraintEligibility,
    applicationRelations: application.applicationRelations,
    candidateSchemaWriteGuard: application.candidateSchemaWriteGuard,
    logicalOperationProfiles,
    logicalParticipantEvents: [{ authority: participantAuthority,
      policy: eventPolicy.policy, selection: eventPolicy.selection },
      ...(workflowBinding === undefined ? [] : workflowBinding.sources.flatMap((source, index) =>
        source.eventSelection === undefined ? [] : [{ authority: workflowAuthorities[index]!,
          policy: workflowBinding.eventPolicy, selection: source.eventSelection }])),
    ],
  });
  let publication: Readonly<{
    executor: ReturnType<typeof createStoredPointCommitExecutorV1>;
    finishing: Effect.Success<ReturnType<ReturnType<typeof createStoredPointCommitExecutorV1>["enterPointCommitFinishing"]>>;
  }> | undefined;
  let retryExecutor: ReturnType<typeof createStoredPointMutationOccRerunExecutionV1> | undefined;
  let retryContextOrdinal = 0;
  const retryRunner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
    run: (runnerInput: PointMutationOccRuntimeNeutralRunnerInputV1) =>
      runnerInput.executionAuthorityGeneration !== "application_v1"
      ? Effect.fail(new ApplicationPointMutationRunnerHostV1Error({ reason: "requestProjectionInvalid" }))
      : Effect.tryPromise({
        try: async () => {
          retryContexts.push(Object.freeze({ ...runnerInput.context,
            randomSeed: new Uint8Array(runnerInput.context.randomSeed),
            snapshotToken: Object.freeze({ ...runnerInput.context.snapshotToken }) }));
          const raw = await runWorkerd(undefined, runnerInput);
          const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
            result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
          const value = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
            success.result.result))).value;
          retryReturnedValues.push(value);
          return value;
        },
        catch: cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause }),
      }),
  });
  async function preparePublicationFromEnvelope(envelope: Effect.Success<ReturnType<Journal[
    "sealSuccessfulResult"]>>,
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    await Effect.runPromise(closePayloadScopes);
    const publisher = publisherOverride ?? createPointCommitPublisherPortV1(
      application.sessionAuthority, publisherOptions);
    const loader = createStoredAttemptEvidenceLoaderV1(application.sessionAuthority);
    const attemptLoading = createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority));
    const common = {
      evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(application.sessionAuthority),
      applicationMutationGrantVerifier: createApplicationMutationGrantVerificationKernelV1({
        deploymentId: activationInput.deploymentId,
        keys: [activationInput.verificationKey],
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      }),
      logicalParticipants,
      logicalOperationProfiles,
      pointCommit: publisher,
      pointCommitFinishing: createPointCommitFinishingTransitionPortV1(application.sessionAuthority),
    } as const;
    const occExecutor = withOccRetry
      ? createStoredPointMutationOccRerunExecutionV1(loader, {
        ...common,
        pointMutationAttemptReplacement: createPointMutationAttemptReplacementPortV1(
          application.sessionAuthority, { leaseDurationMilliseconds: 60_000,
            logicalOperationProfiles }),
        pointMutationOccRerun: {
          attemptLoading,
          executionEvidence: createStoredOccExecutionEvidenceLoaderV1(application.sessionAuthority),
          journal,
          terminalization: createPointMutationSessionAttemptTerminalizationV1(
            createPointMutationSessionAttemptTerminalizationPersistenceV1(application.sessionAuthority),
            executionClaims.admission),
          contextFactory: { make: () => Effect.sync(() => {
            retryContextOrdinal += 1;
            return Object.freeze({ executionId: `mixed-product-retry-${retryContextOrdinal}`,
              logScopeId: `mixed-product-retry-log-${retryContextOrdinal}`,
              randomSeed: new Uint8Array(32).fill(5 + retryContextOrdinal) });
          }) },
          runner: retryRunner,
          liveness: createPointMutationExecutionClaimLivenessV1(application.sessionAuthority, {
            claimDurationMilliseconds: 60_000,
            leaseRenewalDurationMilliseconds: 120_000,
            grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          }),
          heartbeatIntervalMilliseconds: 20_000,
        },
      }, executionClaims)
      : undefined;
    if (occExecutor !== undefined) retryExecutor = occExecutor;
    const executor = occExecutor ?? createStoredPointCommitExecutorV1(loader, common, executionClaims);
    const authority = await Effect.runPromise(executor.deriveAuthority(loaded, execution));
    const stored = await Effect.runPromise(executor.authenticate(authority,
      Schema.encodeSync(CommitEnvelopeV1Schema)(envelope), journal.confirmedSealCapture?.(attempt)));
    const authenticated = await Effect.runPromise(executor.authenticateCommitAuthority(stored));
    const verified = await Effect.runPromise(executor.verifyCommitInput(authenticated));
    const planned = await Effect.runPromise(executor.planPointCommit(verified));
    sqlPhase = "finish";
    const finishing = await Effect.runPromise(executor.enterPointCommitFinishing(planned));
    publication = Object.freeze({ executor, finishing });
    sqlPhase = "publish";
    return executor.publishPointCommit(finishing);
  }
  async function preparePublicationInternal(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    sqlPhase = "seal";
    const envelope = await Effect.runPromise(journal.sealSuccessfulResult(attempt, returnedValue));
    return preparePublicationFromEnvelope(envelope, publisherOverride, withOccRetry);
  }
  async function prepareSealedPublication(envelope: Effect.Success<ReturnType<Journal[
    "sealSuccessfulResult"]>>) {
    return preparePublicationFromEnvelope(envelope, undefined, false);
  }
  async function preparePublication(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return preparePublicationInternal(returnedValue, publisherOverride, false);
  }
  async function prepareOccPublication(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1]) {
    return preparePublicationInternal(returnedValue, undefined, true);
  }
  async function retryWholeAttempt(conflict: unknown) {
    if (retryExecutor === undefined) throw new Error("Missing OCC retry owner");
    const authorized = await Effect.runPromise(retryExecutor.authorizePointMutationOccRerun(conflict));
    if (authorized.kind !== "authorized") throw new Error(`Unexpected OCC retry disposition: ${authorized.kind}`);
    return Effect.runPromise(retryExecutor.executeAuthorizedPointMutationOccRerun(authorized.rerun));
  }
  async function publish(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return Effect.runPromise(await preparePublication(returnedValue, publisherOverride));
  }
  async function replayPublication() {
    if (publication === undefined) throw new Error("Missing authenticated finishing publication");
    sqlPhase = "publish-replay";
    return Effect.runPromise(publication.executor.publishPointCommit(publication.finishing));
  }
  async function readCurrentProduct(): Promise<Json> {
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve] }));
    try {
      const current = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      if (!isJsonObject(current)) throw new Error("Expected native Product document");
      return current;
    } finally { await Effect.runPromise(read.close); }
  }
  async function runStandaloneCommerceCommand(
    applicationName: "flarex_product_standalone" | "flarex_link_standalone",
    observations: Array<Readonly<{ primaryTargetPid: number; standalonePid: number }>>,
    invoke: (session?: ReturnType<typeof makePostgresRelationalSession>) => Promise<Json>,
  ): Promise<Json> {
    if (currency.resource.kind !== "postgres") return invoke();
    const target = currency.resource.target;
    const primary = await target.pool.connect();
    let separate: Awaited<ReturnType<typeof createPostgresPersistence>> | undefined;
    try {
      const identity = (await primary.query<{ schemaName: string; pid: number }>(
        'select current_schema() as "schemaName", pg_backend_pid()::int as pid')).rows[0];
      if (identity === undefined || !/^[a-z_][a-z0-9_]*$/.test(identity.schemaName))
        throw new Error("Missing standalone target PostgreSQL connection identity");
      const postgresUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
      if (postgresUrl === undefined) throw new Error("Missing PostgreSQL URL for standalone command");
      separate = await createPostgresPersistence({
        connectionString: postgresUrl,
        poolConfig: { options: `-c search_path=${identity.schemaName}`,
          application_name: applicationName, max: 1 },
      });
      const session = makePostgresRelationalSession({ drizzle: target.drizzle,
        pool: separate.pool });
      const result = await invoke(session);
      if (separate.pool.totalCount !== 1 || separate.pool.idleCount !== 1)
        throw new Error("Standalone command did not release its single PostgreSQL connection");
      const standalone = (await separate.query<{ pid: number; schemaName: string; applicationName: string }>(
        `select pg_backend_pid()::int as pid, current_schema() as "schemaName",
          current_setting('application_name') as "applicationName"`)).rows[0];
      if (standalone === undefined || standalone.pid === identity.pid ||
        standalone.schemaName !== identity.schemaName ||
        standalone.applicationName !== applicationName)
        throw new Error("Standalone command used wrong PostgreSQL connection");
      const sameTargetBackend = (await primary.query<{ present: boolean }>(
        `select exists(select 1 from pg_stat_activity where pid = $1 and application_name = $2
          and datname = current_database()) as present`,
        [standalone.pid, applicationName])).rows[0]?.present;
      if (sameTargetBackend !== true)
        throw new Error("Standalone command PostgreSQL backend was not connected");
      observations.push(Object.freeze({
        primaryTargetPid: identity.pid, standalonePid: standalone.pid }));
      return result;
    } finally {
      try { await separate?.close(); }
      finally { primary.release(); }
    }
  }
  async function runStandaloneProductUpdate(next: Readonly<{ title: string; handle: string }>): Promise<Json> {
    const inputData = { ...seed.updateInput,
      data: { ...seed.updateInput.data, title: next.title, handle: next.handle } };
    return runStandaloneCommerceCommand("flarex_product_standalone", standaloneProductPgConnections,
      session => runNativeStandaloneProductUpdate(currency, product,
      `conflict-${input.suffix}`, inputData, session));
  }
  async function runStandaloneProductMutation(kind: "replaceOptionValues" | "createVariant" |
    "updateTag" | "createTag" | "removeProductTag", mutationInput: Json): Promise<Json> {
    return runStandaloneCommerceCommand("flarex_product_standalone", standaloneProductPgConnections,
      session => runNativeStandaloneProductMutation(currency,
      product, `conflict-${input.suffix}-${kind}`, kind, mutationInput, session));
  }
  async function runStandaloneLinkCreate(variantId: string, priceSetId: string): Promise<Json> {
    if (link === undefined) throw new Error("Missing selected Link module");
    return runStandaloneCommerceCommand("flarex_link_standalone", standaloneLinkPgConnections,
      session => runNativeStandaloneLinkCreate(currency, link,
        `conflict-${input.suffix}-link`, { product: { variant_id: variantId },
          pricing: { price_set_id: priceSetId } }, session));
  }
  async function runStandalonePayloadCreate(title: string): Promise<Json> {
    if (compiledPayload === undefined) throw new Error("Missing selected Payload source");
    const postgresTarget = currency.resource.kind === "postgres" ? currency.resource.target : undefined;
    const primary = await postgresTarget?.pool.connect();
    try {
    const postgresUrl = process.env.FLAREX_POSTGRES_DATABASE_URL;
    const primaryIdentity = await primary?.query<{ schemaName: string; pid: number }>(
      'select current_schema() as "schemaName", pg_backend_pid()::int as pid');
    const schemaName = primaryIdentity?.rows[0]?.schemaName;
    const primaryTargetPid = primaryIdentity?.rows[0]?.pid;
    if (postgresTarget !== undefined && (postgresUrl === undefined || schemaName === undefined ||
      primaryTargetPid === undefined || !/^[a-z_][a-z0-9_]*$/.test(schemaName)))
      throw new Error("Missing PostgreSQL standalone target identity");
    const standaloneApplicationName = "flarex_payload_standalone";
    let separate: Awaited<ReturnType<typeof createPostgresPersistence>> | undefined;
    if (postgresTarget !== undefined) {
      if (postgresUrl === undefined || schemaName === undefined)
        throw new Error("Missing PostgreSQL standalone target identity");
      separate = await createPostgresPersistence({ connectionString: postgresUrl,
        poolConfig: { options: `-c search_path=${schemaName}`,
          application_name: standaloneApplicationName },
      });
    }
    const postgresSession = postgresTarget === undefined || separate === undefined ? undefined :
      makePostgresRelationalSession({ drizzle: postgresTarget.drizzle, pool: separate.pool });
    try { return await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePayloadRuntime(compiledPayload);
      const host = yield* makeCmsHost({ hostRuntime: preparedHostTestRuntime(currency.persistence.drizzle),
        database: currency.persistence.drizzle, controlDatabase: currency.control.drizzle,
        session: postgresSession ?? currency.session,
        deploymentId: currency.deploymentId,
        scopeId: application.authority.scopeId, authority: application.authorityPorts,
        application: application.activation,
        identityAndAccessPolicy: { profile: "payload.scalar", release: "3.88.0",
          access: "closed-headless-local-api", hook: "none" },
        logicalStorage: { ports: { controlDb: currency.control.drizzle,
          authority: application.authorityPorts }, unique: application.uniqueConstraintEligibility,
          schemaVersionId: logicalSchemaVersionId, source: compiledPayload.sourceContract },
        materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(
          currency.control.drizzle),
          developerIndexes: createAppDeveloperIndexDefinitionPortV1(currency.control.drizzle),
          uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(currency.control.drizzle),
          candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({
            candidateValidation: application.candidateValidation,
            pointCommitAuthority: application.sessionAuthority }) },
        commands: [runtime.commands.create], expectedContentIdentity: compiledPayload.contentIdentity },
      separate === undefined ? undefined : { afterAdmission: tx => Effect.tryPromise({
        try: async () => {
          const observed = await tx.execute<{ pid: number; schemaName: string; applicationName: string;
            primaryStillConnected: boolean }>(sql`select pg_backend_pid()::int as pid,
              current_schema() as "schemaName",
              current_setting('application_name') as "applicationName",
              exists(select 1 from pg_stat_activity where pid = ${primaryTargetPid}) as "primaryStillConnected"`);
          const connection = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(
            Schema.Struct({ pid: Schema.Number, schemaName: Schema.String,
              applicationName: Schema.String, primaryStillConnected: Schema.Boolean })) }))(observed).rows[0];
          if (connection === undefined || primaryTargetPid === undefined ||
            connection.pid === primaryTargetPid ||
            connection.schemaName !== schemaName ||
            connection.applicationName !== standaloneApplicationName ||
            connection.primaryStillConnected !== true) throw new Error("Standalone Payload used wrong PostgreSQL connection");
          standalonePayloadPgConnections.push(Object.freeze({
            primaryTargetPid, standalonePid: connection.pid }));
        },
        catch: cause => new CmsTransactionError({ reason: "resourceFailure", cause }),
      }) });
      return yield* host.run(host.newRequestKey(), runtime.commands.create, {
        collection: "posts", data: { title, publishedAt: "2026-01-01" },
      }).pipe(Effect.ensuring(host.close));
    }))); } finally { await separate?.close(); }
    } finally { primary?.release(); }
  }
  return { currency, product,
    ...(pricing === undefined ? {} : { pricing }),
    ...(link === undefined ? {} : { link }),
    ...(selectedPayload === undefined ? {} : { payload: Object.freeze({
      profile: selectedPayload.profile, runtimeHistory: payloadRuntimeHistory,
      current: () => payloadRuntimeHistory.at(-1),
    }) }),
    seed, baseline, application, active, activation, prepared, binding,
    productProfileRevision: revision,
    ...(workflowBinding === undefined ? {} : { workflowBinding }),
    schemaVersionId, logicalSchemaVersionId,
    eventPolicy, eventGroup, store, executionClaims, journal, attempt, bound, runAdmitted, selector,
    readSettlementLedger: async () => {
      const handle = journal.confirmedSealCapture?.(attempt);
      if (handle === undefined) return null;
      const captured = readConfirmedFiniteRootSealCapture(handle, application.sessionAuthority);
      const root = captured?.attemptRows.rootRows[0];
      if (captured === undefined || root === undefined) return null;
      if (root.sealedJournalBytes === null || root.sealedJournalSha256 === null)
        throw new Error("Missing confirmed canonical journal for settlement ledger");
      const canonical = await Effect.runPromise(decodeCanonicalSessionJournalEffect({
        canonicalBytes: root.sealedJournalBytes, expectedSha256Hex: encodeBytesToLowercaseHex(root.sealedJournalSha256),
      }));
      let admittedRangeDemands = 0;
      let admittedPageDemands = 0;
      let admittedUniqueDemands = 0;
      let admittedRangeEntryOccurrences = 0;
      let admittedPageEntryOccurrences = 0;
      let admittedIndexDefinitionDemands = 0;
      let admittedConstraintDefinitionDemands = 0;
      const indexIds = new Set<number>();
      const constraintIds = new Set<number>();
      const dependencyBytesBySource: Record<string, number> = {};
      for (const operation of canonical.journal.participantOperations) {
        for (const contribution of operation.sourceContributions) {
          const evidence = await Effect.runPromise(Effect.fromResult(
            decodeLogicalParticipantDependencyEvidence(contribution.dependencyEvidence)));
          const selected = logicalParticipants.flatMap(token => {
            const member = inspectLogicalParticipantCommitAuthority(token, operation, contribution);
            return member === null ? [] : [member];
          })[0];
          if (selected === undefined) throw new Error("Missing issued contribution for settlement ledger");
          admittedRangeDemands += evidence.indexRanges.length;
          admittedPageDemands += evidence.indexPages.length;
          admittedUniqueDemands += evidence.uniqueReads.length;
          admittedRangeEntryOccurrences += evidence.indexRanges.reduce((sum, range) => sum + range.entries.length, 0);
          admittedPageEntryOccurrences += evidence.indexPages.reduce((sum, page) => sum + page.entries.length, 0);
          admittedIndexDefinitionDemands += selected.indexes.length;
          admittedConstraintDefinitionDemands += selected.unique.length;
          for (const definition of selected.indexes) indexIds.add(definition.indexDefinitionId);
          for (const definition of selected.unique) constraintIds.add(definition.uniqueConstraintDefinitionId);
          // This representation is the exact checked persisted JSON evidence;
          // UTF-8 bytes include the complete repeated observation arrays.
          dependencyBytesBySource[contribution.sourceKey] = (dependencyBytesBySource[contribution.sourceKey] ?? 0) +
            new TextEncoder().encode(encodeCanonicalJson(contribution.dependencyEvidence,
              () => { throw new Error("Checked contribution evidence is not canonical JSON"); })).byteLength;
        }
      }
      const bytes: Record<string, number> = {
        canonicalJournal: root.sealedJournalBytes?.byteLength ?? 0,
        canonicalResult: root.sealedResultBytes?.byteLength ?? 0,
        rangeEvidence: root.indexRangeDependencyEvidenceBytes,
        materialWriteEventEvidence: Number(root.materialWriteEventEvidenceBytes),
        receiptEvidence: root.receiptEvidenceBytes,
      };
      for (const session of captured.authorityRows.sessionSizeRows) {
        for (const [name, length] of Object.entries({ argsJson: session.validatedArgsJsonByteLengthText,
          argsCanonical: session.validatedArgsCanonicalByteLengthText,
          grantJson: session.authorizationGrantJsonByteLengthText,
          grantCanonical: session.authorizationGrantCanonicalByteLengthText,
          authorityJson: session.applicationExecutionAuthorityJsonByteLengthText,
          authorityCanonical: session.applicationExecutionAuthorityCanonicalByteLengthText }))
          if (length !== null) bytes[name] = Number(length);
      }
      for (const schema of captured.authorityRows.schemaSizeRows) {
        bytes.schemaManifestJson = Number(schema.manifestJsonByteLengthText);
        bytes.schemaManifestCanonical = Number(schema.manifestCanonicalByteLengthText);
      }
      for (const graph of captured.authorityRows.applicationGraphSizeRows)
        for (const [name, length] of Object.entries(graph))
          if (name !== "kind") bytes[`applicationGraph.${name}`] = Number(length);
      return Object.freeze({ syscallReceipts: Number(root.lastSyscallSequence),
        readDocumentOccurrences: root.readDocuments,
        admittedRangeDemands, admittedPageDemands, admittedUniqueDemands,
        admittedRangeEntryOccurrences, admittedPageEntryOccurrences,
        admittedIndexDefinitionDemands, admittedConstraintDefinitionDemands,
        distinctAdmittedIndexDefinitions: indexIds.size, distinctAdmittedConstraintDefinitions: constraintIds.size,
        dependencyBytesBySource: Object.freeze(dependencyBytesBySource),
        publicationQueries: Object.freeze([...publicationQueries.values()].map(query => Object.freeze({ ...query }))),
        pointDependencies: root.pointDependencyCount, indexedQuerySyscalls: root.indexedQuerySyscalls,
        indexRangeDependencies: root.indexRangeDependencyCount, relationReadSyscalls: root.relationReadSyscalls,
        relationDependencies: root.relationDependencyCount, pointProjectionRows: captured.attemptRows.pointRows.length,
        sealProjectionChunkRows: 128, receiptProjectionChunks: Math.ceil(Number(root.lastSyscallSequence) / 128),
        pointProjectionChunks: Math.ceil(captured.attemptRows.pointRows.length / 128),
        indexRangeProjectionChunks: Math.ceil(root.indexRangeDependencyCount / 128),
        relationProjectionChunks: Math.ceil(root.relationDependencyCount / 128), bytes: Object.freeze(bytes),
        unavailable: Object.freeze(["strongReferenceDemands", "unobservedPublicationOwnerParameters",
          "nonScalarParameterWireEncoding"]),
      });
    },
    sealFiniteRootDirect: result => Effect.gen(function* () {
      if (initialPersistenceAttempt === undefined) throw new Error("Missing initial finite persistence attempt");
      const canonical = yield* canonicalizeSuccessfulResultV1Effect(result);
      return yield* store.sealFiniteRootEffect(initialPersistenceAttempt, canonical);
    }),
    reopenJournalAttempt: () => journal.openAttempt(loaded, execution),
    serviceTransactionDepth, pgTransactionObservations,
    observePgNativeSqlTransactions,
    standalonePayloadPgConnections, standaloneProductPgConnections, standaloneLinkPgConnections,
    nativeInvokeCount, retryContexts, retryReturnedValues, sqlByPhase,
    hasSqlObserver, bridgeFailures, runWorkerd,
    participantAuthority, publisherOptions, pointCommitPorts: application.sessionAuthority,
    makePublisher: () => createPointCommitPublisherPortV1(application.sessionAuthority, publisherOptions),
    preparePublication, prepareSealedPublication, publish, replayPublication,
    prepareOccPublication, retryWholeAttempt,
    runStandaloneProductUpdate, runStandaloneProductMutation, runStandaloneLinkCreate,
    runStandalonePayloadCreate,
    retryClosedWorkflow: value => lastBorrowedWorkflowInvoke === undefined
      ? Promise.reject(new Error("Workflow was never borrowed")) : lastBorrowedWorkflowInvoke(value),
    readCurrentProduct,
    getUpdateRequest: () => updateRequest,
    getAdmittedRequest: (participant: string, method: string) =>
      admittedRequests.get(`${participant}:${method}`),
    getOpenTransactionDepth: () => openTransactionDepth,
    getTransactionCounts: () => ({ beginCount, settleCount }),
    setSqlPhase: (phase: string) => { sqlPhase = phase; },
    close: async () => { await Effect.runPromise(closePayloadScopes);
      if (ownsContext) {
        currency.observeSql?.(undefined);
        for (const close of cleanup.reverse()) await close();
      } },
  };
}
