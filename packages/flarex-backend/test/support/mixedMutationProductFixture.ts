import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { Effect, Exit, Result, Schema, Scope } from "effect";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from
  "@flarex/persistence-postgres/internal/commerce-values";
import { CommitEnvelopeV1Schema, CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { normalizeFlarexValueV1 } from "flarex-protocol/value";
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
import { createSessionJournalStorePersistence } from
  "../../../persistence-postgres/src/sessionJournalStore";
import type { LogicalParticipantBorrow } from
  "@flarex/persistence-postgres/session-journal-store";
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
  readonly beforeNative?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterNativeBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterPayloadBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CmsTransactionError>;
  readonly afterStoreAckBeforeBridgeReply?: (method: string, result: Json) => void;
  readonly observeWorkflowSql?: (sql: string) => Promise<void> | void;
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
  readonly executionClaims: ReturnType<typeof createPointMutationExecutionClaimVaultV1>;
  readonly attempt: Effect.Success<ReturnType<Journal["openAttempt"]>>;
  readonly bound: BoundJournal;
  readonly runAdmitted: NonNullable<BoundJournal["runAdmittedOperation"]>;
  readonly selector: ReturnType<typeof decodePointMutationSessionAttemptSelectorV1>;
  readonly schemaVersionId: CurrencyFixture["application"]["active"]["basis"]["schemaVersionId"];
  readonly logicalSchemaVersionId: CurrencyFixture["schemaVersionId"];
  readonly serviceTransactionDepth: number[];
  readonly pgTransactionObservations: Array<Readonly<{
    targetBackends: number; openTransactions: number;
  }>>;
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

export async function createMixedMutationProductFixture(
  input: MixedMutationProductFixtureInput,
): Promise<MixedMutationProductFixture> {
  const cleanup: Array<() => Promise<void>> = [];
  const currency = await logicalCurrencyFixture(input.driver, close => cleanup.push(close),
    input.resource === undefined
      ? { includeProduct: true,
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }),
        ...(input.fixtureIdentity === undefined ? {} :
        { fixtureIdentity: input.fixtureIdentity }) }
      : { includeProduct: true, resource: input.resource, fixtureIdentity: input.fixtureIdentity,
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }) });
  const product = await prepareLogicalProductHost(currency);
  const pricing = input.workflow === true ? await prepareLogicalPricingHost(currency) : undefined;
  const link = input.workflow === true ? await prepareLogicalVariantPricingLinkHost(currency) : undefined;
  for (const member of [product, pricing, link]) {
    if (member === undefined) continue;
    await Effect.runPromise(member.host.initialize([]));
    await Effect.runPromise(member.host.close);
  }
  const { seed, baseline } = await seedNativeProductAttemptGraph(currency, product,
    input.suffix, input.workflow === true ? "launch" : "existing");
  const application = currency.application;
  const active = await Effect.runPromise(application.activation.readActive());
  const schemaVersionId = application.active.basis.schemaVersionId;
  const logicalSchemaVersionId = currency.schemaVersionId;
  const applicationAdmission = await Effect.runPromise(selectApplicationMutationAdmission(
      active.selection, input.workflow === true ? "productLaunch:launch" : "users:create", {
        deploymentId: currency.deploymentId,
        controlDb: currency.control.drizzle, authority: application.authorityPorts,
        schema: application.schema }));
    const activationInput = await applicationMutationActivationFixture({ deploymentId: currency.deploymentId,
      selection: active.selection, executionAuthority: applicationAdmission.executionAuthority,
      requestKey: `mixed-product-${input.suffix}`, grantId: `mixed-product-${input.suffix}-grant` });
    const activation = await Effect.runPromise(createApplicationMutationSessionActivationPersistenceV1(
      application.sessionAuthority, { leaseDurationMilliseconds: 60_000 }).activateEffect(
      activationInput));
    if (activation.status !== "created") throw new Error("Expected fresh mixed attempt");
    const eventGroup = admittedCommerceEventGroup({
      scopeUuid: projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid,
      sessionId: activation.anchor.sessionId, attemptFence: activation.anchor.attemptFence,
    });
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
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const pgTarget = currency.resource.kind === "postgres"
      ? Object.freeze({ control: currency.resource.control,
        applicationName: (await currency.resource.target.query<{ applicationName: string }>(
          'select current_setting(\'application_name\') as "applicationName"')).rows[0]?.applicationName })
      : undefined;
    if (pgTarget !== undefined && !pgTarget.applicationName)
      throw new Error("Missing target PostgreSQL application_name");
    const hasSqlObserver = currency.observeSql !== undefined;
    let sqlPhase = "prepare";
    const sqlByPhase = new Map<string, number>();
    let openTransactionDepth = 0;
    let beginCount = 0, settleCount = 0;
    currency.observeSql?.(async sql => {
      sqlByPhase.set(sqlPhase, (sqlByPhase.get(sqlPhase) ?? 0) + 1);
      if (/^\s*begin\b/i.test(sql)) { openTransactionDepth += 1; beginCount += 1; }
      if (/^\s*(commit|rollback)\b/i.test(sql)) { openTransactionDepth -= 1; settleCount += 1; }
      if (sqlPhase === "workflow:run") await input.hooks?.observeWorkflowSql?.(sql);
    });
    const serviceTransactionDepth: number[] = [];
    const pgTransactionObservations: Array<Readonly<{
      targetBackends: number; openTransactions: number;
    }>> = [];
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
    const journal = createPointMutationJournalV1(store, executionClaims.admission,
      issueSetupSeededSyscallValidatorProofV1({ scopeId: application.authority.scopeId,
        schemaVersionId, schemaManifest: applicationAdmission.schema.manifest }), [{
        participant: "medusa.product",
        admission: { participant: "medusa.product",
          operationMethods: ["update", "retrieve", "listByHandle"],
          profileRevision: revision,
          sources: [{ selection: prepared, application: active.selection,
            methods: ["update", "retrieve", "listByHandle"] }] },
        borrow: borrowedInput => makeBorrowedLogicalAttempt({
          ...borrowedInput, admission: borrowedInput.admissions[0]!,
        }).pipe(
          Effect.map(borrowed => Object.freeze({
            abort: borrowed.abort,
            currentUsage: borrowed.currentUsage,
            invoke: (method: string, args: Json) => Effect.gen(function* () {
              if (pgTarget !== undefined) {
                const reading = yield* Effect.tryPromise({
                  try: () => pgTarget.control.query<{ targetBackends: number; openTransactions: number }>(
                    `select count(*)::int as "targetBackends",
                            count(*) filter (where xact_start is not null)::int as "openTransactions"
                       from pg_stat_activity
                      where datname = current_database() and usename = current_user
                        and application_name = $1 and pid <> pg_backend_pid()`,
                    [pgTarget.applicationName]),
                  catch: cause => commerceError("resourceFailure", cause),
                });
                const observed = reading.rows[0];
                if (observed === undefined || observed.targetBackends < 1 ||
                  observed.openTransactions !== 0)
                  return yield* Effect.fail(commerceError("resourceFailure",
                    new Error(`Product native callback overlapped target SQL transaction: ${JSON.stringify(observed)}`)));
                pgTransactionObservations.push(Object.freeze(observed));
              }
              serviceTransactionDepth.push(openTransactionDepth);
              nativeInvokeCount.set(method, (nativeInvokeCount.get(method) ?? 0) + 1);
              yield* input.hooks?.beforeNative?.(method) ?? Effect.void;
              const completed = yield* executePrivateProductAttemptOperation(binding, borrowed, method, args,
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
          workflowBinding.borrow(borrowedInput).pipe(
            Effect.map(borrowed => {
              lastBorrowedWorkflowInvoke = value => Effect.runPromise(borrowed.invoke(value));
              return Object.freeze({
              abort: borrowed.abort,
              currentUsage: borrowed.currentUsage,
              invoke: (method: string, args: Json) => Effect.gen(function* () {
                if (method !== "run") return yield* Effect.fail(commerceError("invalidAuthority"));
                if (pgTarget !== undefined) {
                  const reading = yield* Effect.tryPromise({
                    try: () => pgTarget.control.query<{ targetBackends: number; openTransactions: number }>(
                      `select count(*)::int as "targetBackends",
                              count(*) filter (where xact_start is not null)::int as "openTransactions"
                         from pg_stat_activity
                        where datname = current_database() and usename = current_user
                          and application_name = $1 and pid <> pg_backend_pid()`,
                      [pgTarget.applicationName]),
                    catch: cause => commerceError("resourceFailure", cause),
                  });
                  const observed = reading.rows[0];
                  if (observed === undefined || observed.targetBackends < 1 ||
                    observed.openTransactions !== 0)
                    return yield* Effect.fail(commerceError("resourceFailure",
                      new Error(`Workflow callback overlapped target SQL transaction: ${JSON.stringify(observed)}`)));
                  pgTransactionObservations.push(Object.freeze(observed));
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
      }])]);
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
          if (typeof message.tableName !== "string" || message.operation === undefined ||
            typeof message.operation.syscallSequence !== "string") throw new Error("Invalid point bridge request");
          let table = tableHandles.get(message.tableName);
          if (table === undefined) {
            table = await Effect.runPromise(runtimeJournal.resolvePointTable(message.tableName));
            tableHandles.set(message.tableName, table);
          }
          const result = await Effect.runPromise(runtimeJournal.runPointOperation(table, {
            ...message.operation,
            syscallSequence: CommitSyscallSequenceV1Schema.make(
              BigInt(message.operation.syscallSequence)),
          }));
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
          const admittedValue = await Effect.runPromise(runtimeAdmitted(admittedInput));
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
    const platformSource = applicationErrorPlatformSourceV1({
      runtimeKernelModulePath: `../${POINT_MUTATION_RUNTIME_KERNEL_MODULE_V1}`,
      captureExportName: "capturePointMutationCoreApplicationErrorDataV1",
      captureProjectionExportName: "captureCoreApplicationErrorV1",
      invalid: { kind: "nativeError" },
    });
    const worker = new Miniflare({ compatibilityDate: "2026-06-18",
      serviceBindings: { MIXED_JOURNAL: bridge }, modules: [
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
    let workerd: unknown;
    try {
      const response = await worker.dispatchFetch("https://mixed-product.test/");
      workerd = await response.json();
    } finally { await worker.dispose(); }
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
  const publisherOptions = Object.freeze({
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
  async function preparePublicationInternal(returnedValue: Parameters<Journal["sealSuccessfulResult"]>[1],
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    sqlPhase = "seal";
    const envelope = await Effect.runPromise(journal.sealSuccessfulResult(attempt, returnedValue));
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
    const loadedForCommit = await Effect.runPromise(createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(application.sessionAuthority)).load(rawSelector));
    const authority = await Effect.runPromise(executor.deriveAuthority(loadedForCommit, execution));
    const stored = await Effect.runPromise(executor.authenticate(authority,
      Schema.encodeSync(CommitEnvelopeV1Schema)(envelope)));
    const authenticated = await Effect.runPromise(executor.authenticateCommitAuthority(stored));
    const verified = await Effect.runPromise(executor.verifyCommitInput(authenticated));
    const planned = await Effect.runPromise(executor.planPointCommit(verified));
    sqlPhase = "finish";
    const finishing = await Effect.runPromise(executor.enterPointCommitFinishing(planned));
    publication = Object.freeze({ executor, finishing });
    sqlPhase = "publish";
    return executor.publishPointCommit(finishing);
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
          and datname = current_database() and usename = current_user) as present`,
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
    serviceTransactionDepth, pgTransactionObservations,
    standalonePayloadPgConnections, standaloneProductPgConnections, standaloneLinkPgConnections,
    nativeInvokeCount, retryContexts, retryReturnedValues, sqlByPhase,
    hasSqlObserver, bridgeFailures, runWorkerd,
    participantAuthority, publisherOptions, pointCommitPorts: application.sessionAuthority,
    makePublisher: () => createPointCommitPublisherPortV1(application.sessionAuthority, publisherOptions),
    preparePublication, publish, replayPublication, prepareOccPublication, retryWholeAttempt,
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
      currency.observeSql?.(undefined);
      for (const close of cleanup.reverse()) await close(); },
  };
}
