import { makeCmsCommandBinding } from "@flarex/persistence-postgres/internal/cms-construction";
import { inspectPayloadRuntimeForTest } from "@flarex/payload-adapter/internal/testing";
import { createHash } from "node:crypto";
import {
  awaitEffectTransactionSettlement,
} from "../../../../persistence-postgres/src/database/effectTransaction";
import { maxCorePerformanceSeriesSamples } from "./measurementPlan";
import { inspect } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema, Scope } from "effect";
import { withExecutionDiagnosticDefaults } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { makeNativeProductOperationDiagnostics } from "./nativeProductOperationDiagnostics";
import { commerceError, isJsonObject, type CommerceTransactionError, type Json } from
  "@flarex/persistence-postgres/internal/commerce-values";
import { canonicalizeSuccessfulResultV1Effect, CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import {
  inspectFiniteOperationCommitAuthority,
  inspectLogicalParticipantAdmissionBundle,
} from "../../../../persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { requirePointMutationArgumentSemanticSizeV1 } from
  "flarex-protocol/point-mutation-start";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeCanonicalFlarexValueEvidenceV1, normalizeFlarexValueV1 } from "flarex-protocol/value";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { fxAppRowRevisions } from "../../../../persistence-postgres/src/database/schema";
import type {
  ApplicationNativeMutationUserDocument,
} from "../../../../persistence-postgres/test/application/applicationNativeMutationTestFixture";
import { encodeAdmittedFrameworkOperationV1Result } from
  "flarex-protocol/internal/admitted-framework-operation-v1";
import { prepareFiniteApplicationMutationAdmission, prepareFiniteApplicationMutationSourceComposition,
  readPreparedFiniteApplicationMutationInputs } from
  "../../../../persistence-postgres/src/application/applicationMutationAdmission";
import {
  claimApplicationActiveSelection,
} from "../../../../persistence-postgres/src/application/activation/selectionIdentity";
import {
  prepareCurrentApplicationBinding,
} from "../../../../persistence-postgres/src/application/activation/currentBinding";
import {
  type CurrentApplicationFiniteEntry,
} from "../../../../persistence-postgres/src/application/activation/contracts";
import { prepareLogicalRelationalAdmission } from
  "../../../../persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission";
import { prepareLogicalStorageReadiness, type PreparedLogicalStorageCatalog } from
  "../../../../persistence-postgres/src/storage/catalog/logicalStorageReadiness";
import {
  createApplicationMutationSessionActivationPersistenceV1,
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "@flarex/persistence-postgres/internal/session-construction";
import { createPointMutationExecutionClaimLivenessV1 } from
  "../../../../persistence-postgres/src/execution/claims/transactionExecutionClaimLiveness";
import { createSessionJournalStorePersistence } from "@flarex/persistence-postgres/session-journal-store";
import { inspectPreparedFiniteSessionJournalEntry, readFrozenFiniteAttempt } from
  "@flarex/persistence-postgres/internal/system-test/session-journal-inspection";
import type { LogicalParticipantBorrow, SessionJournalAttempt } from
  "@flarex/persistence-postgres/internal/session-journal";
import type { PerformanceSettlementLedger } from "./mixedMutationMeasurementContracts";
import { traceMixedMutationEffect, type MixedMutationEffectDiagnostics } from "./measurement";
interface MixedMutationPublicationObserver {
  begin(name: string): Promise<void>;
  end(name: string): Promise<void>;
  beginPublication(): Promise<void>;
  endPublication(): Promise<void>;
}
import {
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
} from "../../../../persistence-postgres/src/commit/point/construction";
import {
  PointMutationAttemptReplacementFiniteEntryError,
} from "../../../../persistence-postgres/src/commit/point/errors";
import {
  type PointCommitPublicationObservation,
  type PointCommitPublicationResultV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import { makeCommerceHost } from "../../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeCmsHost } from "@flarex/persistence-postgres/internal/cms-adapter";
import { createPostgresPersistence } from "../../../../persistence-postgres/src/database/postgres";
import { makePostgresRelationalSession } from
  "../../../../persistence-postgres/src/database/relationalTransaction/session";
import { preparedHostTestRuntime } from
  "../../../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import {
  retainPreparedHost,
  type PreparedHostRuntimeError,
} from "../../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import type { LogicalReadMetadataScale } from
  "../../../../persistence-postgres/test/storage/documents/logicalReadMetadataScalingTestSupport";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from
  "../../../../persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from
  "../../../../persistence-postgres/src/storage/indexes/appDeveloperIndexCommitV1";
import { createAppSchemaCandidateWriteGuardPort, prepareFiniteAppSchemaCandidateWriteGuardPortEffect } from
  "../../../../persistence-postgres/src/storage/catalog/appSchemaCandidateValidation";
import { createAppUniqueConstraintDefinitionPortV1 } from
  "../../../../persistence-postgres/src/storage/unique/appUniqueConstraintCommitV1";
import { createAppUniqueConstraintSetEligibilityPortV1 } from
  "../../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { createPointMutationJournalV1, type PointMutationJournalAdmittedParticipantV1 } from
  "../../../src/mutation/journal/pointMutationJournal";
import { createPointMutationExecutionClaimVaultV1 } from
  "../../../src/mutation/claims/pointMutationExecutionClaim";
import { ApplicationPointMutationRunnerHostV1Error } from
  "../../../src/mutation/authentication/storedAttemptAuthentication";
import type { PointMutationOccBoundJournalV1,
  PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1 } from
  "../../../src/mutation/authentication/storedAttemptAuthentication";
import {
  createFinitePointMutationExecution,
  type AuthenticatedFiniteEntry as AuthenticatedFiniteInitialEntry,
} from
  "../../../src/mutation/execution/finitePointMutationExecution";
import { createApplicationMutationGrantVerificationKernelV1 } from
  "../../../src/mutation/authentication/applicationMutationGrantVerificationKernel";
import { createApplicationPointMutationSessionActivationV1, inspectActivatedPointMutationSessionV1 } from
  "../../../src/mutation/session/pointMutationSessionActivation";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../../../src/mutation/session/pointMutationSessionAttemptSelector";
import { bindPointMutationOccJournal } from
  "../../../src/mutation/authentication/stored/exactPointMutationExecutionOperations";
import { deriveApplicationSyscallValidator } from
  "@flarex/persistence-postgres/internal/application-revision-syscall-validator-v1";
import { applicationMutationActivationEvidenceFixture } from
  "../../../../persistence-postgres/test/application/applicationMutationActivationFixture";
import type { MixedMutationPerformanceTrace } from
  "../../../../persistence-postgres/test/performance/mixedMutationPerformanceTrace";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "../../../../persistence-postgres/test/execution/session/support/activationEvidence";
import { logicalCurrencyFixture } from
  "../../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalProductHost } from
  "../../../../medusa-adapter/test/support/logical-product-fixture";
import { prepareLogicalPricingHost } from
  "../../../../medusa-adapter/test/support/logical-pricing-fixture";
import { prepareLogicalVariantPricingLinkHost } from
  "../../../../medusa-adapter/test/support/logical-variant-pricing-link-fixture";
import { prepareNativeProductAttemptSeeder, seedNativeProductAttemptGraph, runNativeStandaloneProductUpdate,
  runNativeStandaloneProductMutation, runNativeStandaloneLinkCreate } from
  "../../../../medusa-adapter/test/support/native-product-attempt-seed";
import { executePrivateProductAttemptOperation,
  preparePrivateProductAttempt, preparePrivateProductAttemptEventPolicy } from
  "@flarex/medusa-adapter/internal/product-attempt";
import { preparePrivateProductLaunchAttempt } from
  "../../../../medusa-adapter/src/workflows/product/launch";
import {
  admittedCommerceEventGroup,
  captureAtomicCommerceParticipants,
  prepareAtomicCommerceParticipants,
} from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBorrowedLogicalAttempt } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import {
  LogicalParticipantAdmissionError,
  LogicalParticipantInvocationError,
} from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { CmsTransactionError } from
  "@flarex/persistence-postgres/internal/cms-adapter";
import { prepareLogicalDocumentSourceAdmission } from
  "@flarex/persistence-postgres/internal/logical-document-admission";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { makePayloadRuntime, type PayloadAttemptRuntime } from "@flarex/payload-adapter/internal/runtime";
import { projectPayloadParticipantFailure } from "@flarex/payload-adapter/internal/participant";
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
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "@flarex/persistence-postgres/internal/application-syscall-errors";
import {
  runMixedMutationInProcess,
  type MixedMutationExecutionHost,
} from "./mixedMutationInProcessRuntime";
import type {
  PostgresFixtureEndpoints,
} from "../../../../persistence-postgres/test/support/postgresHelpers";
const MixedMutationJournalMessageSchema = Schema.Struct({
  kind: Schema.String, tableName: Schema.optional(Schema.String), sequence: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)), frame: Schema.optional(Schema.Unknown),
});

export interface MixedMutationProductFixtureHooks {
  /** Existing journal constructor randomness seam for exact identity-collision witnesses. */
  readonly journalRandomUuid?: () => string;
  /** Genuine test grant signing lifetime; the issuer validates the bound and
   * retains its five-minute default when this input is omitted. */
  readonly finiteGrantLifetimeMilliseconds?: number;
  /** Test-only cancellation inside the acknowledged owned continuation, before
   * the fixture signals readiness or invokes business callbacks. */
  readonly beforeFiniteCallback?: () => Effect.Effect<void>;
  /** Test observer installed after host/seeding construction, before genuine
   * Application preparation, aggregate entry and initial authentication. */
  readonly onPreparedContext?: (currency: CurrencyFixture) => Promise<MixedMutationPerformanceTrace | undefined>;
  /** Select a genuine source before the original preparation generation
   * compiles its ordered graph. Later entry hooks may not swap source loans. */
  readonly selectFiniteProductSource?: (currency: CurrencyFixture) => ProductFixture["hostInput"]["logicalStorage"]["source"];
  readonly onPreparedFiniteProductSource?: (context: Readonly<{ currency: CurrencyFixture;
    catalog: PreparedLogicalStorageCatalog;
    prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>> }>) => Effect.Effect<void>;
  readonly onFiniteEntryPrepared?: (preparation: Effect.Success<ReturnType<ReturnType<typeof createSessionJournalStorePersistence>["prepareFiniteEntryEffect"]>>) => void;
  readonly afterReplacementStep?: NonNullable<Parameters<typeof createPointMutationAttemptReplacementPortV1>[1]>["afterReplacementStep"];
  readonly transformFiniteEntrySources?: (participants: Parameters<ReturnType<typeof createSessionJournalStorePersistence>["prepareFiniteEntryEffect"]>[0]) =>
    Parameters<ReturnType<typeof createSessionJournalStorePersistence>["prepareFiniteEntryEffect"]>[0];
  readonly beforeFinalEntry?: (context: MixedMutationFinalEntryTestContext) => Promise<void>;
  readonly onFinalEntryFailure?: (context: MixedMutationFinalEntryTestContext, exit: Exit.Exit<unknown, unknown>) => Promise<void>;
  readonly standaloneOwnerCredentialFault?: true;
  readonly beforeProductBorrow?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  /** Diagnostic-only observation at the existing typed storage capture seam.
   * The original capture is forwarded once with its exact input and outcome. */
  readonly observeProductStorageCapture?: (method: string,
    operation: import("../../../../persistence-postgres/src/execution/finiteStorageCapture").FiniteStorageCaptureOperation,
    demand: import("../../../../persistence-postgres/src/storage/documents/logicalDocuments/model").LogicalStorageReadDemand) => void;
  readonly beforeWorkflowBorrow?: () => Effect.Effect<void, CommerceTransactionError>;
  readonly beforeNative?: (method: string) => Effect.Effect<void, CommerceTransactionError>;
  readonly afterProductBorrow?: (method: string, borrowed: Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>,
    rootEvaluator: Parameters<typeof makeBorrowedLogicalAttempt>[0]["rootEvaluator"]) =>
    Effect.Effect<void, CommerceTransactionError>;
  readonly afterNativeBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CommerceTransactionError>;
  /** Test-only observation of the complete existing operation. Its Exit is
   * forwarded unchanged, including defects and interruption. */
  readonly onNativeOperationExit?: ReturnType<typeof makeNativeProductOperationDiagnostics>;
  readonly beforeProductClose?: (method: string, borrowed: Effect.Success<ReturnType<typeof makeBorrowedLogicalAttempt>>) =>
    Effect.Effect<void, CommerceTransactionError>;
  readonly afterPayloadBeforeAck?: (method: string, result: Json) => Effect.Effect<void, CmsTransactionError>;
  readonly afterStoreAckBeforeBridgeReply?: (method: string, result: Json) => void;
  readonly observeWorkflowSql?: (sql: string) => Promise<void> | void;
  readonly observeSql?: (phase: string, sql: string) => Promise<void> | void;
}
type CurrencyFixture = Awaited<ReturnType<typeof logicalCurrencyFixture>>;
type ProductFixture = Awaited<ReturnType<typeof prepareLogicalProductHost>>;
export interface MixedMutationFinalEntryTestContext {
  readonly currency: CurrencyFixture;
  readonly product: ProductFixture;
  readonly store: ReturnType<typeof createSessionJournalStorePersistence>;
  readonly sourceCatalog: PreparedLogicalStorageCatalog;
  readonly preparedFiniteApplication: Result.Result.Success<ReturnType<typeof readPreparedFiniteApplicationMutationInputs>>["application"];
}
type PricingFixture = Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
type LinkFixture = Awaited<ReturnType<typeof prepareLogicalVariantPricingLinkHost>>;
type ProductSeed = Awaited<ReturnType<typeof seedNativeProductAttemptGraph>>;
type MixedPayloadNativeRuntime = Effect.Success<ReturnType<typeof makeMixedPayloadSuccessRuntime>>;
type MixedPayloadConformanceRuntime = Effect.Success<ReturnType<MixedPayloadNativeRuntime["makeAttempt"]>>;
export type MixedPayloadProfileKind = "ordinary" | "success" | "caughtFailure" | "denied" | "promisedId" |
  "foreignId" | "removedId" | "unresolvedId" | "inspection";
const ordinaryPayloadRevision = createHash("sha256").update(
  "payload@3.88.0/posts.scalar/local-create-updateByID-findByID/compiled-access/no-hooks-v1").digest("hex");
const mixedPayloadProfiles = Object.freeze({
  ordinary: { profile: Object.freeze({ revisionSha256: ordinaryPayloadRevision,
    participant: `payload.posts.${ordinaryPayloadRevision}` }), make: makePayloadRuntime },
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

type CreatedActivation = Extract<Effect.Success<ReturnType<
  ReturnType<typeof createApplicationMutationSessionActivationPersistenceV1>["activateEffect"]
>>, { status: "created" }>;

export interface MixedMutationProductFixture {
  readonly readSettlementLedger: () => Promise<PerformanceSettlementLedger | null>;
  readonly currency: CurrencyFixture;
  readonly product: ProductFixture;
  readonly pricing?: PricingFixture;
  readonly link?: LinkFixture;
  readonly payload?: Readonly<{ profile: MixedPayloadConformanceRuntime["profile"];
    runtimeHistory: readonly MixedPayloadConformanceRuntime[];
    current: () => MixedPayloadConformanceRuntime | undefined }>;
  readonly seed: ProductSeed["seed"];
  readonly baseline: ProductSeed["baseline"];
  /** The retained native setup catalog; consumers must not recapture metadata. */
  readonly seedGraph: ProductSeed;
  readonly logicalSourceCatalog: PreparedLogicalStorageCatalog;
  readonly setupTimings: Readonly<{ provisioningMilliseconds: number;
    preparedModuleMilliseconds: number; initialSeedingMilliseconds: number }>;
  readonly application: CurrencyFixture["application"];
  readonly active: Pick<Effect.Success<ReturnType<CurrencyFixture["application"]["activation"]["readActive"]>>, "selection" | "basis">;
  readonly activation: CreatedActivation;
  readonly replayFiniteActivation: () => Effect.Effect<AuthenticatedFiniteInitialEntry["activation"], import("../../../src/mutation/session/pointMutationSessionActivation").ApplicationPointMutationFiniteStartError>;
  readonly activateCompetingFiniteRequest: (suffix: string) => Effect.Effect<AuthenticatedFiniteInitialEntry["activation"], import("../../../src/mutation/session/pointMutationSessionActivation").ApplicationPointMutationFiniteStartError | PreparedHostRuntimeError>;
  /** A distinct genuine attempt over this fixture's retained context and seed. */
  readonly openCompetingFiniteFixture: (suffix: string) => Promise<MixedMutationProductFixture>;
  readonly prepared: Effect.Success<ReturnType<typeof prepareLogicalRelationalAdmission>>;
  readonly binding: Effect.Success<ReturnType<typeof preparePrivateProductAttempt>>;
  readonly productProfileRevision: string;
  readonly workflowBinding?: Effect.Success<ReturnType<typeof preparePrivateProductLaunchAttempt>>;
  readonly eventPolicy: Effect.Success<ReturnType<typeof preparePrivateProductAttemptEventPolicy>>;
  readonly eventGroup: string;
  readonly journal: Journal;
  readonly store: ReturnType<typeof createSessionJournalStorePersistence>;
  readonly freezeFiniteRootDirect: (result: unknown) => Effect.Effect<
    Effect.Success<ReturnType<MixedMutationProductFixture["store"]["freezeFiniteRootEffect"]>>,
    Effect.Error<ReturnType<typeof canonicalizeSuccessfulResultV1Effect>> |
      Effect.Error<ReturnType<MixedMutationProductFixture["store"]["freezeFiniteRootEffect"]>>
  >;
  readonly executionClaims: ReturnType<typeof createPointMutationExecutionClaimVaultV1>;
  readonly attempt: Effect.Success<ReturnType<Journal["openAttempt"]>>;
  readonly persistenceAttempt: Effect.Success<ReturnType<ReturnType<typeof createSessionJournalStorePersistence>["openAttemptEffect"]>>;
  readonly reopenJournalAttempt: () => AuthenticatedFiniteInitialEntry["reopenJournalAttempt"];
  readonly makeFiniteDispatcher: () => ReturnType<typeof createFinitePointMutationExecution>;
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
  readonly runExecution: (source?: string,
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
  readonly preparedFiniteApplication: Result.Result.Success<ReturnType<typeof readPreparedFiniteApplicationMutationInputs>>["application"];
  readonly acquireFiniteReplacementEntry: NonNullable<Parameters<typeof createPointMutationAttemptReplacementPortV1>[1]["finiteEntry"]>;
  readonly preparePublication: (returnedValue: unknown,
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<ReturnType<AuthenticatedFiniteInitialEntry["settleFiniteCommit"]>>;
  readonly prepareFrozenPublication: (frozen: Effect.Success<ReturnType<AuthenticatedFiniteInitialEntry["prepareFiniteCommit"]>>) =>
    Promise<ReturnType<AuthenticatedFiniteInitialEntry["settleFiniteCommit"]>>;
  readonly freeze: (result: unknown) => ReturnType<AuthenticatedFiniteInitialEntry["prepareFiniteCommit"]>;
  readonly publish: (returnedValue: unknown,
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<PointCommitPublicationResultV1>;
  readonly replayPublication: () =>
    Promise<PointCommitPublicationResultV1>;
  readonly prepareOccPublication: (returnedValue: unknown, publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) =>
    Promise<ReturnType<AuthenticatedFiniteInitialEntry["settleFiniteCommit"]>>;
  readonly retryWholeAttempt: (conflict: unknown) =>
    Promise<Effect.Success<ReturnType<ReturnType<typeof createFinitePointMutationExecution>["retryFailedAttempt"]>>>;
  readonly runStandaloneProductUpdate: (next: Readonly<{ title: string; handle: string }>) => Promise<Json>;
  readonly runStandaloneProductMutation: (kind: "replaceOptionValues" | "createVariant" |
    "updateTag" | "createTag" | "removeProductTag", input: Json) => Promise<Json>;
  readonly runStandaloneLinkCreate: (variantId: string, priceSetId: string) => Promise<Json>;
  readonly runStandalonePayloadCreate: (title: string) => Promise<Json>;
  readonly retryClosedWorkflow: (value: Json) => Promise<unknown>;
  readonly readCurrentProduct: () => Promise<Json>;
  readonly readCurrentApplicationDocument: (id: string) => Promise<unknown>;
  readonly readCurrentPayloadPost: (id: string) => Promise<Json>;
  readonly readCurrentWorkflowPricing: (variantId: string, priceSetId: string) => Promise<Readonly<{ priceSet: Json; links: Json }>>;
  readonly close: () => Promise<void>;
}

type MixedMutationProductFixtureInput = Readonly<{
  executionHost?: MixedMutationExecutionHost | undefined;
  postgresEndpoints?: PostgresFixtureEndpoints;
  driver: "pglite" | "postgres"; suffix: string; hooks?: MixedMutationProductFixtureHooks;
  includeUserNameIndex?: boolean;
  initialApplicationUsers?: readonly ApplicationNativeMutationUserDocument[];
  readMetadataScale?: LogicalReadMetadataScale;
}> & (Readonly<{ workflow: true; payloadProfile: MixedPayloadProfileKind;
  workflowIds?: Readonly<{ variantId: string; priceSetId: string }> }> |
Readonly<{ workflow?: never; workflowIds?: never; payloadProfile?: MixedPayloadProfileKind }>) &
 (Readonly<{ resource?: never; fixtureIdentity?: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }> | Readonly<{ resource: CurrencyFixture["resource"]; fixtureIdentity: Readonly<{
  deploymentId: string; projectId: string; uuidOffset: number;
}> }>);

async function prepareMixedMutationProductContext(input: MixedMutationProductFixtureInput,
  initialSeedSuffix: string, currentDiagnostics?: () => MixedMutationEffectDiagnostics | undefined) {
  const cleanup: Array<() => Promise<void>> = [];
  const provisioningStart = globalThis.performance.now();
  try {
  const currency = await logicalCurrencyFixture(input.driver, close => cleanup.push(close),
    input.resource === undefined
      ? { includeProduct: true, finiteStorageCapture: true,
        ...(currentDiagnostics === undefined ? {} : { physicalSessionObservation: () => currentDiagnostics()?.physicalSessionObservation }),
        ...(input.postgresEndpoints === undefined ? {} : { postgresEndpoints: input.postgresEndpoints }),
        protectedRuntime: input.driver === "postgres",
        ...(input.driver === "postgres" ? { managedRead: true as const } : {}),
        ...(input.readMetadataScale === undefined ? {} : { readMetadataScale: input.readMetadataScale }),
        ...(input.includeUserNameIndex === undefined ? {} : { includeUserNameIndex: input.includeUserNameIndex }),
        ...(input.initialApplicationUsers === undefined ? {} : { initialUserDocuments: input.initialApplicationUsers }),
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }),
        ...(input.fixtureIdentity === undefined ? {} :
        { fixtureIdentity: input.fixtureIdentity }) }
      : { includeProduct: true, finiteStorageCapture: true, resource: input.resource, fixtureIdentity: input.fixtureIdentity,
        ...(currentDiagnostics === undefined ? {} : { physicalSessionObservation: () => currentDiagnostics()?.physicalSessionObservation }),
        protectedRuntime: input.driver === "postgres",
        ...(input.driver === "postgres" ? { managedRead: true as const } : {}),
        ...(input.readMetadataScale === undefined ? {} : { readMetadataScale: input.readMetadataScale }),
        ...(input.includeUserNameIndex === undefined ? {} : { includeUserNameIndex: input.includeUserNameIndex }),
        ...(input.initialApplicationUsers === undefined ? {} : { initialUserDocuments: input.initialApplicationUsers }),
        ...(input.workflow === true ? { includeProductLaunch: true } : {}),
        ...(input.workflow === true ? { includePricing: true,
          includeVariantPricingLink: true } : {}),
        ...(input.payloadProfile === undefined ? {} : { payloadCollections: mixedPayloadPostsCollections() }) });
  const provisioningMilliseconds = globalThis.performance.now() - provisioningStart;
  const application = currency.application;
  const admissionContext = Object.freeze({ deploymentId: currency.deploymentId,
    controlDb: currency.control.drizzle, authority: application.authorityPorts, schema: application.schema });
  const preparedModuleStart = globalThis.performance.now();
  const product = await prepareLogicalProductHost(currency);
  cleanup.push(() => Effect.runPromise(product.host.close));
  const pricing = input.workflow === true ? await prepareLogicalPricingHost(currency) : undefined;
  if (pricing !== undefined) cleanup.push(() => Effect.runPromise(pricing.host.close));
  const link = input.workflow === true ? await prepareLogicalVariantPricingLinkHost(currency) : undefined;
  if (link !== undefined) cleanup.push(() => Effect.runPromise(link.host.close));
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
  const schemaVersionId = application.active.basis.schemaVersionId;
  const logicalSchemaVersionId = currency.schemaVersionId;
  const sourcePorts = Object.freeze({
    controlDb: currency.control.drizzle, authority: application.authorityPorts,
  });
  const sourceLocation = Object.freeze({ deploymentId: currency.deploymentId,
    scopeId: application.authority.scopeId, schemaVersionId: logicalSchemaVersionId });
  const selectedPayload = input.payloadProfile === undefined ? undefined : mixedPayloadProfiles[input.payloadProfile];
  const payloadProfileRevision = selectedPayload === undefined ? undefined :
    createHash("sha256").update(
      `mixed-payload-${selectedPayload.profile.participant}-${input.payloadProfile}`).digest("hex");
  const compiledPayload = selectedPayload === undefined ? undefined :
    await Effect.runPromise(compilePayloadCollections(mixedPayloadPostsCollections()));
  let retainedPayload: MixedPayloadNativeRuntime | Effect.Success<ReturnType<typeof makePayloadRuntime>> | undefined;
  if (selectedPayload !== undefined && compiledPayload !== undefined) {
    const nativeScope = await Effect.runPromise(Scope.make());
    cleanup.push(() => Effect.runPromise(Scope.close(nativeScope, Exit.succeed(undefined))));
    const construction: Effect.Effect<MixedPayloadNativeRuntime |
      Effect.Success<ReturnType<typeof makePayloadRuntime>>, CmsTransactionError, Scope.Scope> = selectedPayload.make(compiledPayload);
    retainedPayload = await Effect.runPromise(Scope.provide(nativeScope)(construction));
  }
  const revision = createHash("sha256").update("mixed-product-workerd-events").digest("hex");
  const sourceGraph = await Effect.runPromise(retainPreparedHost(preparedHostTestRuntime(currency.persistence.drizzle),
    Effect.gen(function* () {
  const current = yield* prepareCurrentApplicationBinding(application.activation, currency.persistence.drizzle,
    originalBinding => Effect.gen(function* () {
  const candidateSchemaWriteGuard = yield* prepareFiniteAppSchemaCandidateWriteGuardPortEffect({
    candidateValidation: application.candidateValidation, pointCommitAuthority: application.sessionAuthority,
  }, { deploymentId: currency.deploymentId, scopeId: application.authority.scopeId,
    ...(currency.managedRead === undefined ? { profile: "fullArtifactProof" as const } : { profile: "installed" as const,
      database: currency.persistence.drizzle, installation: currency.managedRead.readInstallation }) });
  const preparedAdmission = yield* prepareFiniteApplicationMutationAdmission(
    application.activation, input.workflow === true ? "productLaunch:launch" : "users:create", admissionContext, originalBinding);
  const sourceCatalog = yield* prepareLogicalStorageReadiness(sourcePorts,
    application.uniqueConstraintEligibility, sourceLocation, originalBinding);
  if (sourceCatalog.status !== "prepared") throw new Error("Logical source catalog is not ready");
  const sourceConstruction = Object.freeze({ kind: "prepared" as const, catalog: sourceCatalog });
  const prepared = yield* prepareLogicalRelationalAdmission(sourcePorts,
    application.uniqueConstraintEligibility, sourceLocation,
    input.hooks?.selectFiniteProductSource?.(currency) ?? product.hostInput.logicalStorage.source, sourceConstruction);
  if (input.hooks?.onPreparedFiniteProductSource !== undefined)
    yield* input.hooks.onPreparedFiniteProductSource({ currency, catalog: sourceCatalog, prepared });
  const payloadPrepared = compiledPayload === undefined ? undefined : yield*
    prepareLogicalDocumentSourceAdmission(sourcePorts, application.uniqueConstraintEligibility,
      sourceLocation, compiledPayload.sourceContract, sourceConstruction);
  const binding = yield* preparePrivateProductAttempt();
  const eventPolicy = yield* preparePrivateProductAttemptEventPolicy(binding, {
    producerRevision: revision, contractRevision: revision,
    subscribers: [{ id: "mixed-product-proof", revision }],
  });
  const workflowBinding = pricing === undefined || link === undefined ? undefined :
    yield* preparePrivateProductLaunchAttempt({
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
      prepareSources: members => Effect.gen(function* () {
        const captured = yield* Effect.fromResult(captureAtomicCommerceParticipants(members));
        const issued = yield* prepareAtomicCommerceParticipants(currency.control.drizzle,
          currency.bindingTarget, captured, { deploymentId: currency.deploymentId,
            scopeId: application.authority.scopeId }, sourceConstruction);
        const ordered = [];
        for (const member of members) {
          const selected = issued.find(candidate => candidate.participant === member.participant);
          if (selected === undefined || selected.kind !== "logical") return yield* Effect.fail(commerceError("invalidAuthority"));
          ordered.push(selected);
        }
        return ordered;
      }),
    });
  const workflowSelections = workflowBinding?.sources.map(source => source.prepared) ?? [];
  yield* prepareFiniteApplicationMutationSourceComposition(preparedAdmission,
    [prepared, ...(payloadPrepared === undefined ? [] : [payloadPrepared]), ...workflowSelections]);
  return Object.freeze({ candidateSchemaWriteGuard, preparedAdmission, sourceCatalog, prepared, payloadPrepared, binding, eventPolicy, workflowBinding, workflowSelections });
  }), { selection: { deploymentId: currency.deploymentId, scopeId: application.authority.scopeId },
    ...(currency.managedRead === undefined ? {} : { installation: currency.managedRead.readInstallation }),
    candidateIssuer: application.sessionAuthority });
  return current;
  })));
  cleanup.push(() => Effect.runPromise(sourceGraph.close));
  const { sourceCatalog, prepared, payloadPrepared, binding, eventPolicy, workflowBinding, workflowSelections } =
    await Effect.runPromise(sourceGraph.use(current => current.withEntry(graph => Effect.succeed(Result.succeed(graph.payload)))));
  const readApplicationPreparation = sourceGraph.use(current => current.withEntry(graph => Effect.succeed(Result.succeed(graph.payload))));
  type ApplicationPreparation = Effect.Success<typeof readApplicationPreparation>;
  const withApplicationPreparation = <A, E, R>(work: (graph: ApplicationPreparation, entry: CurrentApplicationFiniteEntry) => Effect.Effect<A, E, R>) =>
    sourceGraph.use(current => current.withFiniteEntry((graph, entry) => work(graph.payload, entry)));
  const acquireFreshApplicationPreparation = sourceGraph.use(current =>
    current.acquireFreshFinitePreparation.pipe(Effect.map(graph => graph.payload)));
  const prepareAttempt = async (suffix: string, validatedArgsJson?: Readonly<{ body: string }>,
    diagnostics?: MixedMutationEffectDiagnostics, selected?: ApplicationPreparation) => {
    const read = (graph: ApplicationPreparation) =>
      Effect.fromResult(readPreparedFiniteApplicationMutationInputs(graph.preparedAdmission, admissionContext)).pipe(
        Effect.map(applicationAdmission => ({ preparedAdmission: graph.preparedAdmission, candidateSchemaWriteGuard: graph.candidateSchemaWriteGuard, applicationAdmission })));
    const preparation = selected === undefined ? readApplicationPreparation.pipe(Effect.flatMap(read)) : read(selected);
    // The signed-evidence helper also starts independent runners. Lend this
    // exact diagnostic-only composition rather than losing it at that edge.
    const runPreparation = <A, E>(work: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(
      diagnostics === undefined ? withExecutionDiagnosticDefaults(work) : diagnostics.provide(work));
    const { preparedAdmission, candidateSchemaWriteGuard, applicationAdmission } = await runPreparation(preparation);
    const activationInput = await applicationMutationActivationEvidenceFixture({
      deploymentId: currency.deploymentId,
      executionAuthority: applicationAdmission.executionAuthority,
      requestKey: `mixed-product-${suffix}`, grantId: `mixed-product-${suffix}-grant`,
      ...(input.hooks?.finiteGrantLifetimeMilliseconds === undefined ? {} : {
        grantLifetimeMilliseconds: input.hooks.finiteGrantLifetimeMilliseconds,
      }),
      ...(validatedArgsJson === undefined ? {} : { validatedArgsJson }),
    }, runPreparation);
    return { preparedAdmission, candidateSchemaWriteGuard, applicationAdmission, activationInput };
  };
  const store = createSessionJournalStorePersistence(application.sessionAuthority,
    { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      ...(input.hooks?.journalRandomUuid === undefined ? {} : { randomUuid: input.hooks.journalRandomUuid }),
      indexedQueries: application.indexedQueries });
  const pgTarget = currency.resource.kind === "postgres"
    ? Object.freeze({ observer: currency.resource.target,
      applicationName: (await currency.resource.target.query<{ applicationName: string }>(
        'select current_setting(\'application_name\') as "applicationName"')).rows[0]?.applicationName })
    : undefined;
  if (pgTarget !== undefined && !pgTarget.applicationName)
    throw new Error("Missing target PostgreSQL application_name");
  return { cleanup, currency, product, pricing, link, application, admissionContext, prepareAttempt, withApplicationPreparation, readApplicationPreparation, acquireFreshApplicationPreparation,
    initialSeed,
    schemaVersionId, logicalSchemaVersionId, sourceCatalog, prepared,
    selectedPayload, payloadProfileRevision, compiledPayload, payloadPrepared, retainedPayload,
    binding, revision, eventPolicy, workflowBinding, workflowSelections, store, pgTarget,
    readSourcePreparationUsage: sourceGraph.readUsage,
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

/** The genuine initial owner drains before its scopes and optional owned
 * context. A failed release never skips a later release or replaces its cause. */
export async function closeMixedMutationFixture(input: Readonly<{
  signalInitial: () => Promise<void>;
  joinInitial: () => Promise<void>;
  closeSyscallScope: () => Promise<void>;
  closePayloadScopes: () => Promise<void>;
  ownsContext: boolean;
  context: Readonly<{ detachSqlObserver: () => void; resources: readonly (() => Promise<void>)[] }>;
}>): Promise<void> {
  const context = input.ownsContext ? input.context : undefined;
  await closeMixedMutationResources([
    input.signalInitial, input.joinInitial, input.closeSyscallScope, input.closePayloadScopes,
    ...(context === undefined ? [] : [async () => { context.detachSqlObserver(); },
      ...context.resources.toReversed()]),
  ]);
}

/** Payload facade scope finalization owns every complete Exit. Preserve failure,
 * defect and interruption while attempting all scopes in registration order. */
export const closeMixedMutationPayloadScopes = Effect.fn("MixedFixture.closePayloadScopes")(function* (
  scopes: Set<Scope.Scope>,
) {
  let failure: Cause.Cause<never> | undefined;
  for (const scope of scopes) {
    const exit = yield* Effect.exit(Scope.close(scope, Exit.succeed(undefined)));
    if (Exit.isFailure(exit)) failure = failure === undefined ? exit.cause : Cause.combine(failure, exit.cause);
  }
  scopes.clear();
  if (failure !== undefined) return yield* Effect.failCause(failure);
}, Effect.uninterruptible);

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
  const preparedContext = await prepareMixedMutationProductContext(input, input.suffix);
  try {
    const seedGraph = preparedContext.initialSeed;
    if (seedGraph === undefined) throw new Error("Missing prepared Product graph");
    const trace = await input.hooks?.onPreparedContext?.(preparedContext.currency);
    const initialize = () => createMixedMutationAttemptFixture(input, preparedContext, seedGraph, true);
    return await (trace === undefined ? initialize() : trace.withInvocation({
      id: "initial admission", mode: "recon",
    }, initialize));
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
  readonly readSourcePreparationUsage: () => Result.Result<Readonly<{ chargedBytes: number }>,
    PreparedHostRuntimeError>;
  readonly setTrace: (trace: MixedMutationPerformanceTrace | undefined) => void;
  readonly setEffectDiagnostics: (diagnostics: MixedMutationEffectDiagnostics | undefined) => void;
  readonly prepareAttempt: (index: number) => Promise<void>;
  readonly runAttempt: (index: number, publicationObservation?: PointCommitPublicationObservation,
    publicationServer?: MixedMutationPublicationObserver, cleanupFailures?: unknown[]) => Promise<Readonly<{
    fixture: MixedMutationProductFixture;
    seed: ProductSeed["seed"];
    returnedValue: unknown;
    workerConstructionMilliseconds: number;
    canonicalResultBytes: number;
    attemptPhases: readonly Readonly<{ phase: string; startMs: number; endMs: number }>[];
    publication: PointCommitPublicationResultV1;
  }>>;
  readonly close: () => Promise<void>;
}

/** Test-only repeated private attempts over one prepared module graph, scope,
 * and pair of database pools. Each attempt gets a fresh request journal and execution context.
 * The default driver calls the portable runtime directly; backend host tests
 * inject their single-use Worker adapter. */
export async function prepareMixedMutationPerformanceSeries(input: Readonly<{
  driver: "pglite" | "postgres";
  suffix: string;
  profile: MixedMutationPerformanceProfile;
  sampleCount: number;
  readMetadataScale?: LogicalReadMetadataScale;
  hooks?: MixedMutationProductFixtureHooks;
  executionHost?: MixedMutationExecutionHost | undefined;
  applicationSource?: (seed: ProductSeed["seed"]) => string;
  postgresEndpoints?: PostgresFixtureEndpoints;
}>): Promise<MixedMutationPerformanceSeries> {
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount < 1 || input.sampleCount > maxCorePerformanceSeriesSamples)
    throw new Error("Invalid finite mixed performance sample count");
  const makeInput = (suffix: string): MixedMutationProductFixtureInput =>
    input.profile === "workflow"
      ? { executionHost: input.executionHost, driver: input.driver, suffix, workflow: true, payloadProfile: "success",
        ...(input.postgresEndpoints === undefined ? {} : { postgresEndpoints: input.postgresEndpoints }),
        ...(input.readMetadataScale === undefined ? {} : { readMetadataScale: input.readMetadataScale }) }
      : input.profile === "productPayload"
        ? { executionHost: input.executionHost, driver: input.driver, suffix, payloadProfile: "success",
            ...(input.postgresEndpoints === undefined ? {} : { postgresEndpoints: input.postgresEndpoints }),
            ...(input.readMetadataScale === undefined ? {} : { readMetadataScale: input.readMetadataScale }) }
        : { executionHost: input.executionHost, driver: input.driver, suffix,
            ...(input.postgresEndpoints === undefined ? {} : { postgresEndpoints: input.postgresEndpoints }),
            ...(input.readMetadataScale === undefined ? {} : { readMetadataScale: input.readMetadataScale }) };
  let diagnostics: MixedMutationEffectDiagnostics | undefined;
  const context = await prepareMixedMutationProductContext(makeInput(input.suffix),
    `${input.suffix}-0`, () => diagnostics);
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
    const seederConstructionStart = globalThis.performance.now();
    const seeder = await prepareNativeProductAttemptSeeder(context.currency, context.product, input.suffix);
    context.cleanup.push(seeder.close);
    const seederConstructionMilliseconds = globalThis.performance.now() - seederConstructionStart;
    const additionalSetupSeedingMilliseconds = 0;
    const applicationSource = mixedMutationPerformanceApplicationSource(input.profile,
      context.selectedPayload?.profile.participant);
    const prepareAttempt = async (index: number) => {
      if (closed || index < 0 || index >= input.sampleCount || !Number.isSafeInteger(index))
        throw new Error("Invalid mixed performance attempt index");
      if (seeded.has(index)) return;
      if (input.profile !== "workflow") {
        seeded.set(index, await seeder.seed(`${input.suffix}-${index}`, "existing"));
        return;
      }
      if (index > 0) {
        if (!completed.has(index - 1)) throw new Error("Previous workflow sample did not publish");
        const previous = seeded.get(index - 1);
        if (previous === undefined) throw new Error("Missing preceding workflow seed");
        await seeder.retireLaunchedTag(previous.seed, `${input.suffix}-${index - 1}`);
      }
      seeded.set(index, await seeder.seed(`${input.suffix}-${index}`, "launch"));
    };
    const runAttempt = async (index: number, publicationObservation?: PointCommitPublicationObservation,
      publicationServer?: MixedMutationPublicationObserver, cleanupFailures?: unknown[]) => {
      if (closed || attempted.has(index)) throw new Error("Mixed performance attempt already used or closed");
      const seedGraph = seeded.get(index);
      if (seedGraph === undefined) throw new Error("Prepare the disjoint graph before measurement");
      attempted.add(index);
      const attemptPhases: { phase: string; startMs: number; endMs: number }[] = [];
      const runPhase = <T>(name: string, run: () => Promise<T>): Promise<T> => {
        const traced = () => trace === undefined ? run() : trace.withPhase(name, run);
        const invoke = () => diagnostics === undefined ? traced() : diagnostics.withPhase(name, traced);
        if (publicationObservation === undefined) return invoke();
        const timed = async () => {
          const startMs = globalThis.performance.now();
          try { return await invoke(); }
          finally { attemptPhases.push({ phase: name, startMs, endMs: globalThis.performance.now() }); }
        };
        return timed();
      };
      const seed = seedGraph.seed;
      const validatedArgsJson = Object.freeze({ body: JSON.stringify(input.profile === "workflow"
        ? { productId: seed.productId, tagId: seed.tagId,
          updateInput: seed.updateInput, retrieveInput: seed.retrieveInput }
        : { updateInput: seed.updateInput, retrieveInput: seed.retrieveInput,
          listInput: seed.listInput }) });
      let workerConstructionMilliseconds: number | null = input.executionHost === undefined ? 0 : null;
      let canonicalResultBytes: number | null = null;
      const fixture = await runPhase("request admission", () => createMixedMutationAttemptFixture(
        { ...makeInput(`${input.suffix}-${index}`), ...(input.hooks === undefined ? {} : { hooks: input.hooks }) }, context, seedGraph, false,
        { validatedArgsJson, onWorkerReady: milliseconds => {
          workerConstructionCount++;
          workerConstructionMilliseconds = milliseconds;
        }, onResultBytes: bytes => { canonicalResultBytes = bytes; },
        ...(publicationObservation === undefined ? {} : { publicationObservation }),
        ...(diagnostics === undefined ? {} : { diagnostics }),
        ...(trace === undefined ? {} : { trace }) }));
      openFixtures.add(fixture);
      try {
        const raw = await runPhase(input.executionHost === undefined ? "portable runtime execution" : "Worker execution", () => fixture.runExecution(
          input.applicationSource?.(seed) ?? applicationSource));
        if (workerConstructionMilliseconds === null) throw new Error("Missing fresh Worker readiness");
        const returnedValue = (await runPhase("runtime result validation", () => {
          const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
            result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
          const decodedResult = decodePointMutationExactRuntimeResultV1Effect(success.result.result);
          return Effect.runPromise(diagnostics === undefined ? withExecutionDiagnosticDefaults(decodedResult) : diagnostics.provide(decodedResult));
        })).value;
        const preparePublication = async () => {
          if (publicationServer === undefined) return fixture.preparePublication(returnedValue);
          await publicationServer.begin("preparationAndFinishing");
          try { return await fixture.preparePublication(returnedValue); }
          finally { await publicationServer.end("preparationAndFinishing"); }
        };
        const publicationEffect = await runPhase("finite freeze and validation",
          publicationServer === undefined ? () => fixture.preparePublication(returnedValue) : preparePublication);
        const publish = async () => {
          if (publicationServer === undefined) return Effect.runPromise(diagnostics === undefined ? withExecutionDiagnosticDefaults(publicationEffect) : diagnostics.provide(publicationEffect));
          await publicationServer.beginPublication();
          try { return await Effect.runPromise(diagnostics === undefined ? withExecutionDiagnosticDefaults(publicationEffect) : diagnostics.provide(publicationEffect)); }
          finally { await publicationServer.endPublication(); }
        };
        const publication = await runPhase("authoritative publication",
          publicationServer === undefined ? () => Effect.runPromise(diagnostics === undefined ? withExecutionDiagnosticDefaults(publicationEffect) : diagnostics.provide(publicationEffect)) : publish);
        if (publication.kind !== "published") throw new Error("Missing first committed outcome");
        if (canonicalResultBytes === null || canonicalResultBytes < 1)
          throw new Error("Missing canonical successful result byte count");
        completed.add(index);
        return Object.freeze({ fixture, seed, returnedValue,
          workerConstructionMilliseconds, canonicalResultBytes, publication,
          attemptPhases: Object.freeze(attemptPhases.map(phase => Object.freeze(phase))) });
      } finally {
        try { await runPhase("complete call cleanup", () => fixture.close()); }
        catch (cause) {
          if (cleanupFailures === undefined) throw cause;
          // Only the opted-in benchmark retains disposal failure separately;
          // the exact business failure continues through its original boundary.
          cleanupFailures.push(cause);
        } finally { openFixtures.delete(fixture); }
      }
    };
    return Object.freeze({ currency: context.currency,
      profileRevisions: Object.freeze({ product: context.revision,
        ...(context.payloadProfileRevision === undefined ? {} : { payload: context.payloadProfileRevision }),
        ...(context.workflowBinding === undefined ? {} : { workflow: context.workflowBinding.profileRevision }) }),
      get workerConstructionCount() { return workerConstructionCount; },
      provisioningMilliseconds: context.provisioningMilliseconds,
      preparedModuleMilliseconds: context.preparedModuleMilliseconds + seederConstructionMilliseconds,
      initialSeedingMilliseconds: context.initialSeedingMilliseconds,
      additionalSetupSeedingMilliseconds,
      readSourcePreparationUsage: context.readSourcePreparationUsage,
      setTrace: (next: MixedMutationPerformanceTrace | undefined) => { trace = next; },
      setEffectDiagnostics: (next: MixedMutationEffectDiagnostics | undefined) => { diagnostics = next; },
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
  ownsContext: boolean, performance?: Parameters<typeof createMixedMutationAttemptFixtureForGeneration>[4]): Promise<MixedMutationProductFixture> {
  const ready = await Effect.runPromise(Deferred.make<MixedMutationProductFixture, unknown>());
  const closed = await Effect.runPromise(Deferred.make<void>());
  const construction = context.withApplicationPreparation((graph, currentEntry) => Effect.gen(function* () {
    const localCleanup: Array<() => Promise<void>> = [];
    // The fixture's original Promise bridge transports a full Effect Cause as
    // such. Foreign constructor throws remain defects, including cleanup.
    const pending = createMixedMutationAttemptFixtureForGeneration(input, context, seedGraph, false, performance,
      graph, currentEntry, localCleanup);
    const fixture = yield* awaitEffectTransactionSettlement(pending, cause => Cause.isCause(cause) && Cause.hasInterruptsOnly(cause))
      .pipe(Effect.catchIf(Cause.isCause, cause => Effect.failCause(cause), cause => Effect.die(cause)),
      Effect.onError(() => Effect.promise(() => closeMixedMutationResources(localCleanup.toReversed()))));
    yield* Deferred.succeed(ready, fixture);
    yield* Deferred.await(closed);
  })).pipe(Effect.onError(cause => Deferred.failCause(ready, cause)));
  const fiber = Effect.runFork(performance?.diagnostics === undefined ? withExecutionDiagnosticDefaults(construction) : performance.diagnostics.provideRequest(construction));
  const fixture = await Effect.runPromise(Deferred.await(ready));
  return { ...fixture, close: () => closeMixedMutationResources([
    fixture.close,
    async () => { await Effect.runPromise(Deferred.succeed(closed, undefined)); },
    async () => { await Effect.runPromise(Fiber.join(fiber)); },
    ...(ownsContext ? [async () => { context.currency.observeSql?.(undefined); }, ...context.cleanup.toReversed()] : []),
  ]) };
}

async function createMixedMutationAttemptFixtureForGeneration(input: MixedMutationProductFixtureInput,
  context: PreparedMixedMutationProductContext, seedGraph: ProductSeed,
  ownsContext: boolean, performance: Readonly<{
    validatedArgsJson: Readonly<{ body: string }>;
    onWorkerReady: (milliseconds: number) => void;
    onResultBytes: (bytes: number) => void;
    trace?: MixedMutationPerformanceTrace;
    publicationObservation?: PointCommitPublicationObservation;
    diagnostics?: MixedMutationEffectDiagnostics;
  }> | undefined, graph: Effect.Success<PreparedMixedMutationProductContext["readApplicationPreparation"]>,
  currentEntry: CurrentApplicationFiniteEntry, cleanup: Array<() => Promise<void>>): Promise<MixedMutationProductFixture> {
  const { currency, product, pricing, link, application,
    schemaVersionId, logicalSchemaVersionId,
    selectedPayload, payloadProfileRevision, compiledPayload, retainedPayload,
    revision, store, pgTarget } = context;
  const { sourceCatalog, prepared, payloadPrepared, binding, eventPolicy, workflowBinding, workflowSelections } = graph;
  const { seed, baseline } = seedGraph;
  const provideDiagnostic = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    performance?.diagnostics === undefined ? withExecutionDiagnosticDefaults(work) : performance.diagnostics.provide(work);
  const runEffect = async <A, E>(work: Effect.Effect<A, E>): Promise<A> => {
    const exit = await Effect.runPromiseExit(provideDiagnostic(work));
    if (Exit.isFailure(exit)) throw exit.cause;
    return exit.value;
  };
  const runEffectExit = <A, E>(work: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(provideDiagnostic(work));
  // The initial finite fiber remains alive until fixture.close joins it. Its
  // supervisor is the request, beyond the shorter admission Promise phase.
  const runForkEffect = <A, E>(work: Effect.Effect<A, E>): Fiber.Fiber<A, E> => Effect.runFork(
    performance?.diagnostics === undefined ? withExecutionDiagnosticDefaults(work) : performance.diagnostics.provideRequest(work));
  const tracePhase = <A>(name: string, run: () => Promise<A>): Promise<A> => {
    const traced = () => performance?.trace === undefined ? run() : performance.trace.withPhase(name, run);
    return performance?.diagnostics === undefined ? traced() : performance.diagnostics.withPhase(name, traced);
  };
  const traceEffect = <A, E>(name: string, operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    performance?.diagnostics === undefined ? traceMixedMutationEffect(performance?.trace, name, operation)
      : performance.diagnostics.traceEffect(name, operation);
  type FiniteExecutionFailure = Effect.Error<ReturnType<ReturnType<typeof createFinitePointMutationExecution>["executePreparedFiniteAttempt"]>>;
  type InitialFailure = FiniteExecutionFailure | PreparedHostRuntimeError;
  const initialReady = await runEffect(Deferred.make<AuthenticatedFiniteInitialEntry, InitialFailure>());
  const initialDone = await runEffect(Deferred.make<void>());
  const preparedReady = await runEffect(Deferred.make<Awaited<ReturnType<typeof context.prepareAttempt>>, InitialFailure>());
  const executionReady = await runEffect(Deferred.make<Effect.Effect<void, FiniteExecutionFailure>>());
  // The existing request fiber borrows before exposing preparation and keeps
  // that generation through final execution and the existing close handshake.
  const initialFiber = runForkEffect(Effect.gen(function* () {
    const preparation = yield* Effect.promise(() => tracePhase("stored read and source preparation", () =>
      context.prepareAttempt(input.suffix, performance?.validatedArgsJson, performance?.diagnostics, graph)));
    yield* Deferred.succeed(preparedReady, preparation);
    const execution = yield* Deferred.await(executionReady);
    yield* execution;
  }).pipe(Effect.onError(cause => Deferred.failCause(preparedReady, cause).pipe(
    Effect.andThen(Deferred.failCause(initialReady, cause))))));
  cleanup.push(() => runEffect(Fiber.interrupt(initialFiber)).then(() => undefined));
  const { preparedAdmission, candidateSchemaWriteGuard, applicationAdmission, activationInput } =
    await runEffect(Deferred.await(preparedReady));
  const executionClaims = createPointMutationExecutionClaimVaultV1();
    const hasSqlObserver = currency.observeSql !== undefined;
    let sqlPhase = "request admission";
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
    const payloadRuntimeHistory: MixedPayloadConformanceRuntime[] = [];
    const payloadRuntimes = new WeakMap<SessionJournalAttempt, PayloadAttemptRuntime>();
    const payloadScopes = new Set<Scope.Scope>();
    const ensurePayloadRuntime = Effect.fn("MixedFixture.ensurePayloadRuntime")(function* (attemptHandle: SessionJournalAttempt) {
      const existing = payloadRuntimes.get(attemptHandle);
      if (existing !== undefined) return existing;
      if (retainedPayload === undefined)
        return yield* Effect.fail(new CmsTransactionError({ reason: "invalidAuthority" }));
      const scope = yield* Scope.make();
      const construction: Effect.Effect<MixedPayloadConformanceRuntime | PayloadAttemptRuntime,
        CmsTransactionError, Scope.Scope> = retainedPayload.makeAttempt(attemptHandle);
      const constructed = yield* Scope.provide(scope)(construction).pipe(
        Effect.onError(() => Scope.close(scope, Exit.succeed(undefined))));
      const runtime = "runtime" in constructed ? constructed.runtime : constructed;
      payloadRuntimes.set(attemptHandle, runtime);
      payloadScopes.add(scope);
      if ("observations" in constructed) payloadRuntimeHistory.push(constructed);
      return runtime;
    });
    const closePayloadScopes = closeMixedMutationPayloadScopes(payloadScopes);
    const initialPreparation = await runEffect(Deferred.make<Effect.Success<ReturnType<typeof store.prepareFiniteEntryEffect>>>());
    const journalStore = Object.freeze({ ...store,
      prepareFiniteEntryEffect: (...args: Parameters<typeof store.prepareFiniteEntryEffect>) => Effect.suspend(() =>
        store.prepareFiniteEntryEffect(input.hooks?.transformFiniteEntrySources?.(args[0]) ?? args[0])).pipe(
          Effect.tap(preparation => Deferred.succeed(initialPreparation, preparation)),
          Effect.tap(preparation => Effect.sync(() => input.hooks?.onFiniteEntryPrepared?.(preparation)))),
      freezeFiniteRootEffect: (...args: Parameters<typeof store.freezeFiniteRootEffect>) =>
        store.freezeFiniteRootEffect(...args).pipe(Effect.tap(() => Effect.sync(() =>
          performance?.onResultBytes(args[1].canonicalBytes.byteLength)))),
    });
    const syscallScope = await runEffect(Scope.make());
    const closeSyscallScope = () => runEffect(Scope.close(syscallScope, Exit.succeed(undefined)));
    cleanup.push(closeSyscallScope);
    const syscallValidator = await runEffect(Scope.provide(syscallScope)(deriveApplicationSyscallValidator({
      scopeId: application.authority.scopeId, schemaVersionId, schemaManifest: applicationAdmission.schema.manifest,
    })));
    const makeJournalParticipants = (currentGraph: typeof graph): readonly PointMutationJournalAdmittedParticipantV1[] => {
      const { prepared, payloadPrepared, binding, eventPolicy, workflowBinding, workflowSelections } = currentGraph;
      return [{
        participant: "medusa.product",
        admission: { participant: "medusa.product",
          operationMethods: ["update", "retrieve", "listByHandle"],
          profileRevision: revision,
          sources: [{ selection: prepared,
            methods: ["update", "retrieve", "listByHandle"] }] },
        borrow: borrowedInput => {
          const observeCapture = input.hooks?.observeProductStorageCapture;
          let observedInput = borrowedInput;
          if (observeCapture !== undefined && borrowedInput.captureStorage !== undefined) {
            const originalCapture = borrowedInput.captureStorage;
            const captureStorage: typeof originalCapture = (operation, demand) => Effect.suspend(() => {
              observeCapture(borrowedInput.method, operation, demand);
              return originalCapture(operation, demand);
            });
            observedInput = { ...borrowedInput, captureStorage };
          }
          return Effect.suspend(() => input.hooks?.beforeProductBorrow?.(borrowedInput.method) ?? Effect.void).pipe(
          Effect.andThen(traceEffect("Product borrow and source checks", makeBorrowedLogicalAttempt({
            ...observedInput, admission: borrowedInput.admissions[0]!,
          }))),
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
              const nativeBorrowed = beforeProductClose === undefined && performance?.trace === undefined && performance?.diagnostics === undefined
                ? borrowed : Object.freeze({ ...borrowed,
                  close: traceEffect("Product operation close", Effect.suspend(() =>
                    beforeProductClose?.(method, borrowed) ?? Effect.void).pipe(Effect.andThen(borrowed.close))) });
              const operation = traceEffect("native Product operation",
                executePrivateProductAttemptOperation(binding, nativeBorrowed, method, args, eventPolicy));
              const observer = input.hooks?.onNativeOperationExit;
              const observed = observer === undefined ? operation : Effect.gen(function* () {
                const started = globalThis.performance.now();
                const exit = yield* Effect.exit(operation);
                return yield* observer.observeAndReplay(method, args, exit, globalThis.performance.now() - started);
              });
              const completed = yield* observed;
              yield* input.hooks?.afterNativeBeforeAck?.(method, completed.result) ?? Effect.void;
              return Object.freeze({ result: completed.result, changes: completed.changes,
                eventIntents: completed.eventIntents.map(intent => Object.freeze({
                  sourceKey: "medusa.product", intent })),
                workBytes: completed.workBytes,
                workCalls: completed.workCalls });
            }).pipe(Effect.mapError(mapProductInvocationFailure)),
          })),
          Effect.mapError(mapProductInvocationFailure));
        },
      }, ...(payloadPrepared === undefined || selectedPayload === undefined ? [] : [{
        participant: selectedPayload.profile.participant,
        admission: { participant: selectedPayload.profile.participant,
          operationMethods: ["payload-create", "payload-update", "payload-findByID"],
          profileRevision: payloadProfileRevision!,
          sources: [{ selection: payloadPrepared,
            methods: ["payload-create", "payload-update", "payload-findByID"] }] },
        borrow: Effect.fn("MixedFixture.borrowPayload")(function* (borrowedInput: Parameters<LogicalParticipantBorrow>[0]) {
          const runtime = yield* ensurePayloadRuntime(borrowedInput.attempt).pipe(
            Effect.mapError(projectPayloadParticipantFailure));
          const borrowed = yield* traceEffect("Payload borrow and source checks", runtime.borrowParticipant(borrowedInput));
          return Object.freeze({ ...borrowed,
            invoke: Effect.fn("MixedFixture.observePayload")(function* (method: string, args: Json) {
              nativeInvokeCount.set(method, (nativeInvokeCount.get(method) ?? 0) + 1);
              const completed = yield* traceEffect("native Payload operation", borrowed.invoke(method, args));
              yield* (input.hooks?.afterPayloadBeforeAck?.(method, completed.result) ?? Effect.void).pipe(
                Effect.mapError(projectPayloadParticipantFailure));
              return completed;
            }),
          });
        }),
      }]), ...(workflowBinding === undefined ? [] : [{
        participant: "medusa.workflow",
        admission: { participant: "medusa.workflow", operationMethods: ["run"],
          profileRevision: workflowBinding.profileRevision,
          sources: workflowBinding.sources.map((source, index) => ({
            selection: workflowSelections[index]!,
            methods: source.methods,
          })) },
        borrow: (borrowedInput: Parameters<LogicalParticipantBorrow>[0]) =>
          Effect.suspend(() => input.hooks?.beforeWorkflowBorrow?.() ?? Effect.void).pipe(
            Effect.andThen(traceEffect("Workflow borrow and source checks", workflowBinding.borrow(borrowedInput))),
            Effect.map(borrowed => {
              lastBorrowedWorkflowInvoke = value => runEffect(borrowed.invoke(value));
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
                const completed = yield* traceEffect("native Medusa workflow", borrowed.invoke(args));
                yield* input.hooks?.afterNativeBeforeAck?.("workflow:run", completed.result) ?? Effect.void;
                return completed;
              }).pipe(Effect.mapError(mapProductInvocationFailure)),
              });
            }),
            Effect.mapError(mapProductInvocationFailure)),
      }])];
    };
    const makeJournal = (currentGraph: typeof graph) => createPointMutationJournalV1(
      journalStore, executionClaims.admission, syscallValidator, makeJournalParticipants(currentGraph), "finiteRoot");
    const journal = makeJournal(graph);
    const finalEntryTestContext = Object.freeze({ currency, product, store, sourceCatalog,
      preparedFiniteApplication: applicationAdmission.application });
    await input.hooks?.beforeFinalEntry?.(finalEntryTestContext);
    const activationPort = createApplicationPointMutationSessionActivationV1(
      createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
        { leaseDurationMilliseconds: 60_000 }), executionClaims.issuer, journal);
    const finiteActivationInput = Object.freeze({
      deploymentId: activationInput.deploymentId, scopeId: activationInput.scopeId,
      preparedAdmission, admissionContext: context.admissionContext, evidence: activationInput.evidence, currentEntry,
    });
    const competingPreparations = new Map<string, ReturnType<typeof context.prepareAttempt>>();
    const connectedFiniteDependencies = await runEffect(Deferred.make<Parameters<typeof createFinitePointMutationExecution>[0]>());
    let retryContextOrdinal = 0;
    const finiteLiveness = { persistence: createPointMutationExecutionClaimLivenessV1(application.sessionAuthority, {
        claimDurationMilliseconds: 60_000, leaseRenewalDurationMilliseconds: 120_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        finiteApplication: { prepared: preparedAdmission, context: context.admissionContext },
      }), heartbeatIntervalMilliseconds: 20_000 };
    const finiteContextFactory = { make: () => Effect.sync(() => {
      retryContextOrdinal += 1;
      return Object.freeze({ executionId: `mixed-product-execution-${retryContextOrdinal}`,
        logScopeId: `mixed-product-log-${retryContextOrdinal}`, randomSeed: new Uint8Array(32).fill(5 + retryContextOrdinal) });
    }) };
    const initialExecution = createFinitePointMutationExecution({ activation: activationPort, journal, executionClaims,
      contextFactory: finiteContextFactory, liveness: finiteLiveness,
      publisher: {
        publishFinite: command => Deferred.await(connectedFiniteDependencies).pipe(Effect.flatMap(connected => connected.publisher.publishFinite(command))),
        resolveFinite: command => Deferred.await(connectedFiniteDependencies).pipe(Effect.flatMap(connected => connected.publisher.resolveFinite(command))),
      },
      replacement: {
        replaceFinite: command => Deferred.await(connectedFiniteDependencies).pipe(Effect.flatMap(connected => connected.replacement.replaceFinite(command))),
        replaceRecoveredFinite: command => Deferred.await(connectedFiniteDependencies).pipe(Effect.flatMap(connected => connected.replacement.replaceRecoveredFinite(command))),
      },
      runner: { run: runnerInput => Deferred.await(connectedFiniteDependencies).pipe(Effect.flatMap(connected => connected.runner.run(runnerInput))) },
      recovery: { acquisition: createPointMutationExecutionClaimAcquisitionV1(application.sessionAuthority, { durationMilliseconds: 60_000 }),
        applicationGrantKernel: createApplicationMutationGrantVerificationKernelV1({ deploymentId: activationInput.deploymentId,
          keys: [activationInput.verificationKey], grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 }) },
      terminalization: createPointMutationSessionAttemptTerminalizationPersistenceV1(application.sessionAuthority),
    });
    await runEffect(Deferred.succeed(executionReady, initialExecution.runPreparedFiniteAttempt(finiteActivationInput,
      entry => Effect.suspend(() => input.hooks?.beforeFiniteCallback?.() ?? Effect.void).pipe(
        Effect.andThen(Deferred.succeed(initialReady, entry)), Effect.andThen(Deferred.await(initialDone))))));
    const activationExit = await tracePhase("finite outer entry activation", () => runEffectExit(Deferred.await(initialReady)));
    if (Exit.isFailure(activationExit)) await input.hooks?.onFinalEntryFailure?.(finalEntryTestContext, activationExit);
    const authenticatedInitialEntry = Exit.isSuccess(activationExit) ? activationExit.value
      : await runEffect(Effect.failCause(activationExit.cause));
    const activation = authenticatedInitialEntry.activation;
    if (activation.status !== "created") throw new Error("Expected fresh mixed attempt");
    const confirmed = inspectPreparedFiniteSessionJournalEntry(await runEffect(Deferred.await(initialPreparation)));
    if (confirmed?.status !== "confirmed") throw new Error("Expected the original acknowledged entry issuer");
    const active = Object.freeze({ selection: authenticatedInitialEntry.applicationSelection,
      basis: Result.getOrThrow(claimApplicationActiveSelection(authenticatedInitialEntry.applicationSelection)) });
    const eventGroup = admittedCommerceEventGroup({
      scopeUuid: projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid,
      sessionId: activation.anchor.sessionId, attemptFence: activation.anchor.attemptFence,
    });
    const rawSelector = Object.freeze({
      deploymentId: String(activation.anchor.deploymentId),
      scopeId: String(activation.anchor.scopeId),
      sessionId: String(activation.anchor.sessionId),
      attemptFence: String(activation.anchor.attemptFence),
    });
    const selector = decodePointMutationSessionAttemptSelectorV1(rawSelector);
    let updateRequest: Parameters<NonNullable<BoundJournal["runAdmittedOperation"]>>[0] | undefined;
    const admittedRequests = new Map<string, Parameters<NonNullable<BoundJournal["runAdmittedOperation"]>>[0]>();
    const bridgeFailures: string[] = [];
    const makeBridge = (runtimeJournal: PointMutationOccBoundJournalV1) => {
      const tableHandles = new Map<string, Effect.Success<ReturnType<typeof bound.resolvePointTable>>>();
      return async (messageInput: unknown): Promise<unknown> => {
      try {
        const message = Schema.decodeUnknownSync(MixedMutationJournalMessageSchema)(messageInput);
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
            table = await runEffect(runtimeJournal.resolvePointTable(message.tableName));
            tableHandles.set(message.tableName, table);
          }
          const runPoint = async () => {
            const exit = await runEffectExit(runtimeJournal.runPointOperation(table, {
              ...operation, syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(syscallSequence)),
            }));
            if (Exit.isSuccess(exit)) return exit.value;
            // Match the real executor RPC boundary: only one genuine typed
            // document validation failure is recoverable by application code.
            const reason = exit.cause.reasons.length === 1 ? exit.cause.reasons[0] : undefined;
            if (reason !== undefined && Cause.isFailReason(reason) &&
                reason.error instanceof ApplicationRevisionSyscallDocumentValidationV1Error) throw reason.error;
            return runEffect(Effect.failCause(exit.cause));
          };
          const result = await tracePhase("Application point", runPoint);
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
          const runParticipant = () => runEffect(runtimeAdmitted(admittedInput));
          const admittedValue = await tracePhase(`${encoded.operation.participant}:${encoded.operation.operation}`, runParticipant);
          value = admittedValue;
          input.hooks?.afterStoreAckBeforeBridgeReply?.(encoded.operation.operation, admittedValue);
        } else throw new Error("Unsupported bridge request");
        return value;
      } catch (cause) {
        bridgeFailures.push(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n${inspect(cause, { depth: 10 })}`);
        throw cause;
      }
    };
    };
  async function runExecution(source?: string,
    runnerInput?: PointMutationOccRuntimeNeutralRunnerInputV1): Promise<unknown> {
    runnerInput ??= authenticatedInitialEntry.runnerInput;
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
    const execute = input.executionHost ?? ((request: Parameters<MixedMutationExecutionHost>[0]) =>
      runMixedMutationInProcess(request, performance?.diagnostics));
    const execution = await execute({
      source: applicationSource, request, executionModule, executionTime,
      bridge, trace: performance?.trace, onReady: performance?.onWorkerReady,
    });
    if (typeof execution === "object" && execution !== null && "kind" in execution &&
      execution.kind === "error") {
      const failure = new Error(`Native runtime failed: ${JSON.stringify(execution)}\n${bridgeFailures.join("\n")}`);
      const cleanup = await runEffectExit(closePayloadScopes);
      if (Exit.isFailure(cleanup)) bridgeFailures.push(`Payload attempt facade cleanup: ${String(cleanup.cause)}`);
      throw failure;
    }
    return execution;
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
    ...(performance?.publicationObservation === undefined ? {} : {
      publicationObservation: performance.publicationObservation,
    }),
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
    candidateSchemaWriteGuard,
    logicalOperationProfiles,
    logicalParticipantEvents: [{ authority: participantAuthority,
      policy: eventPolicy.policy, selection: eventPolicy.selection },
      ...(workflowBinding === undefined ? [] : workflowBinding.sources.flatMap((source, index) =>
        source.eventSelection === undefined ? [] : [{ authority: workflowAuthorities[index]!,
          policy: workflowBinding.eventPolicy, selection: source.eventSelection }])),
    ],
  });
  let publication: Readonly<{
    frozen: Effect.Success<ReturnType<AuthenticatedFiniteInitialEntry["prepareFiniteCommit"]>>;
  }> | undefined;
  let retryExecutor: ReturnType<typeof createFinitePointMutationExecution> | undefined;
  const retryRunner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
    run: (runnerInput: PointMutationOccRuntimeNeutralRunnerInputV1) =>
      runnerInput.executionAuthorityGeneration !== "application_v1"
      ? Effect.fail(new ApplicationPointMutationRunnerHostV1Error({ reason: "requestProjectionInvalid" }))
      : Effect.tryPromise({
        try: async () => {
          retryContexts.push(Object.freeze({ ...runnerInput.context,
            randomSeed: new Uint8Array(runnerInput.context.randomSeed),
            snapshotToken: Object.freeze({ ...runnerInput.context.snapshotToken }) }));
          const raw = await runExecution(undefined, runnerInput);
          const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
            result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
          const value = (await runEffect(decodePointMutationExactRuntimeResultV1Effect(
            success.result.result))).value;
          retryReturnedValues.push(value);
          return value;
        },
        catch: cause => new ApplicationPointMutationRunnerHostV1Error({ reason: "terminalFailed", cause }),
      }),
  });
  async function preparePublicationFromFrozen(frozen: Effect.Success<ReturnType<AuthenticatedFiniteInitialEntry["prepareFiniteCommit"]>>,
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    await tracePhase("Payload attempt facades close", () => runEffect(closePayloadScopes));
    selectedPublisher = publisherOverride ?? defaultPublisher;
    if (withOccRetry) retryExecutor = initialExecution;
    publication = Object.freeze({ frozen });
    sqlPhase = "publish";
    return authenticatedInitialEntry.settleFiniteCommit(frozen);
  }
  async function preparePublicationInternal(returnedValue: unknown,
    publisherOverride: ReturnType<typeof createPointCommitPublisherPortV1> | undefined,
    withOccRetry: boolean) {
    sqlPhase = "freeze";
    const frozen = await tracePhase("freeze and verify", () => runEffect(authenticatedInitialEntry.prepareFiniteCommit(returnedValue)));
    return preparePublicationFromFrozen(frozen, publisherOverride, withOccRetry);
  }
  async function prepareFrozenPublication(frozen: Effect.Success<ReturnType<AuthenticatedFiniteInitialEntry["prepareFiniteCommit"]>>) {
    return preparePublicationFromFrozen(frozen, undefined, false);
  }
  async function preparePublication(returnedValue: unknown,
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return preparePublicationInternal(returnedValue, publisherOverride, false);
  }
  async function prepareOccPublication(returnedValue: unknown, publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return preparePublicationInternal(returnedValue, publisherOverride, true);
  }
  async function retryWholeAttempt(conflict: unknown) {
    if (retryExecutor === undefined) throw new Error("Missing OCC retry owner");
    return runEffect(retryExecutor.retryFailedAttempt(conflict));
  }
  async function publish(returnedValue: unknown,
    publisherOverride?: ReturnType<typeof createPointCommitPublisherPortV1>) {
    return runEffect(await preparePublication(returnedValue, publisherOverride));
  }
  async function replayPublication() {
    if (publication === undefined) throw new Error("Missing authenticated frozen publication");
    sqlPhase = "publish-replay";
    return runEffect(authenticatedInitialEntry.settleFiniteCommit(publication.frozen));
  }
  async function readCurrentProduct(): Promise<Json> {
    const read = await runEffect(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieve] }));
    try {
      const current = await runEffect(read.read(product.runtime.commands.retrieve, {
        id: seed.productId, config: { relations: ["options.values", "tags",
          "variants.options", "images", "categories"] },
      }));
      if (!isJsonObject(current)) throw new Error("Expected native Product document");
      return current;
    } finally { await runEffect(read.close); }
  }
  // Verification only: inspect committed revisions through the persistence
  // schema and canonical evidence owner, never through the tentative journal.
  async function readCurrentApplicationDocument(id: string): Promise<unknown> {
    const identity = decodeAppDocumentIdentityV1(id);
    const revisions = await currency.persistence.drizzle.select().from(fxAppRowRevisions).where(and(
      eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(activation.anchor.scopeId).scopeUuid),
      eq(fxAppRowRevisions.tableId, identity.tableId),
      eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId)),
    )).orderBy(fxAppRowRevisions.commitSeq);
    const row = revisions.at(-1);
    if (row?.valueBytes === undefined || row.valueBytes === null || row.valueSha256 === null)
      throw new Error("Missing committed Application document");
    return (await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: row.valueBytes,
      sha256: row.valueSha256, profile: "appDocument" })).value;
  }
  async function readCurrentWorkflowPricing(variantId: string, priceSetId: string) {
    if (pricing === undefined || link === undefined) throw new Error("Missing selected workflow modules");
    const priceReader = await runEffect(makeCommerceHost({ ...pricing.hostInput,
      commands: [pricing.runtime.retrieve] }));
    try {
      const priceSet = await runEffect(priceReader.read(pricing.runtime.retrieve, {
        id: priceSetId, config: { relations: ["prices.price_rules"] },
      }));
      const linkReader = await runEffect(makeCommerceHost({ ...link.hostInput,
        commands: [link.runtime.count] }));
      try {
        const links = await runEffect(linkReader.read(link.runtime.count, {
          filters: { variant_id: variantId },
          config: { select: ["id", "variant_id", "price_set_id"], take: 10 },
        }));
        return { priceSet, links };
      } finally { await runEffect(linkReader.close); }
    } finally { await runEffect(priceReader.close); }
  }

  const standalonePayloadBinding = Effect.fn("MixedFixture.makePayloadBinding")(function* (
    compiled: NonNullable<typeof compiledPayload>, session: typeof currency.session,
  ) {
    const serving = yield* application.makeServing(session);
    return yield* makeCmsCommandBinding({ serving, hostRuntime: preparedHostTestRuntime(currency.persistence.drizzle),
      identityAndAccessPolicy: { profile: "payload.scalar", release: "3.88.0",
        access: "closed-headless-local-api", hook: "none" },
      profile: { kind: "source", schemaVersionId: logicalSchemaVersionId, source: compiled.sourceContract } });
  });

  function standalonePayloadFaultHostInput(compiled: NonNullable<typeof compiledPayload>, session: typeof currency.session) {
    return { hostRuntime: preparedHostTestRuntime(currency.persistence.drizzle),
      database: currency.persistence.drizzle, controlDatabase: currency.control.drizzle, session,
      deploymentId: currency.deploymentId,
      scopeId: application.authority.scopeId, authority: application.authorityPorts,
      application: application.activation,
      identityAndAccessPolicy: { profile: "payload.scalar", release: "3.88.0",
        access: "closed-headless-local-api", hook: "none" },
      logicalStorage: { ports: { controlDb: currency.control.drizzle,
        authority: application.authorityPorts }, unique: application.uniqueConstraintEligibility,
        schemaVersionId: logicalSchemaVersionId, source: compiled.sourceContract },
      materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(
        currency.control.drizzle),
        developerIndexes: createAppDeveloperIndexDefinitionPortV1(currency.control.drizzle),
        uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(currency.control.drizzle),
        candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({
          candidateValidation: application.candidateValidation,
          pointCommitAuthority: application.sessionAuthority }) },
    };
  }

  async function readCurrentPayloadPost(id: string): Promise<Json> {
    if (compiledPayload === undefined) throw new Error("Missing selected Payload source");
    return runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePayloadRuntime(compiledPayload);
      const host = yield* runtime.bind(yield* standalonePayloadBinding(compiledPayload, currency.session));
      return yield* host.findByID({ collection: "posts", id }).pipe(Effect.ensuring(host.close));
    })));
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
      const identity = (await primary.query<{ schemaName: string; pid: number; login: string; role: string; databaseName: string }>(
        'select current_schema() as "schemaName", pg_backend_pid()::int as pid, session_user as login, current_user as role, current_database() as "databaseName"')).rows[0];
      if (identity === undefined || !/^[a-z_][a-z0-9_]*$/.test(identity.schemaName))
        throw new Error("Missing standalone target PostgreSQL connection identity");
      const faultUrl = input.hooks?.standaloneOwnerCredentialFault === true ? process.env.FLAREX_POSTGRES_DATABASE_URL : undefined;
      if (input.hooks?.standaloneOwnerCredentialFault === true && faultUrl === undefined)
        throw new Error("Missing PostgreSQL owner URL for standalone credential fault");
      separate = await createPostgresPersistence({
        poolConfig: { ...target.pool.options, password: target.pool.options.password,
          ...(faultUrl === undefined ? {} : { connectionString: faultUrl }),
          options: `-c search_path=${identity.schemaName}`,
          application_name: applicationName, max: 1 },
      });
      const authenticated = (await separate.query<{ schemaName: string; login: string; role: string; databaseName: string }>(
        'select current_schema() as "schemaName", session_user as login, current_user as role, current_database() as "databaseName"')).rows[0];
      if (authenticated === undefined || authenticated.schemaName !== identity.schemaName ||
        authenticated.login !== identity.login || authenticated.role !== identity.role ||
        authenticated.databaseName !== identity.databaseName)
        throw new Error("Standalone Commerce credential identity mismatch");
      const session = makePostgresRelationalSession({ drizzle: target.drizzle,
        pool: separate.pool });
      const result = await invoke(session);
      if (separate.pool.totalCount !== 1 || separate.pool.idleCount !== 1)
        throw new Error("Standalone command did not release its single PostgreSQL connection");
      const standalone = (await separate.query<{ pid: number; schemaName: string; applicationName: string;
        login: string; role: string; databaseName: string }>(
        `select pg_backend_pid()::int as pid, current_schema() as "schemaName",
          current_setting('application_name') as "applicationName", session_user as login,
          current_user as role, current_database() as "databaseName"`)).rows[0];
      if (standalone === undefined || standalone.pid === identity.pid ||
        standalone.schemaName !== identity.schemaName ||
        standalone.applicationName !== applicationName || standalone.login !== identity.login ||
        standalone.role !== identity.role || standalone.databaseName !== identity.databaseName)
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
    const faultUrl = input.hooks?.standaloneOwnerCredentialFault === true ? process.env.FLAREX_POSTGRES_DATABASE_URL : undefined;
    if (input.hooks?.standaloneOwnerCredentialFault === true && faultUrl === undefined)
      throw new Error("Missing PostgreSQL owner URL for standalone credential fault");
    const primaryIdentity = await primary?.query<{ schemaName: string; pid: number; login: string; role: string; databaseName: string }>(
      'select current_schema() as "schemaName", pg_backend_pid()::int as pid, session_user as login, current_user as role, current_database() as "databaseName"');
    const schemaName = primaryIdentity?.rows[0]?.schemaName;
    const primaryTargetPid = primaryIdentity?.rows[0]?.pid;
    const primaryLogin = primaryIdentity?.rows[0]?.login;
    const primaryRole = primaryIdentity?.rows[0]?.role;
    const primaryDatabase = primaryIdentity?.rows[0]?.databaseName;
    if (postgresTarget !== undefined && (schemaName === undefined ||
      primaryTargetPid === undefined || primaryLogin === undefined || primaryRole === undefined ||
      primaryDatabase === undefined || !/^[a-z_][a-z0-9_]*$/.test(schemaName)))
      throw new Error("Missing PostgreSQL standalone target identity");
    const standaloneApplicationName = "flarex_payload_standalone";
    let separate: Awaited<ReturnType<typeof createPostgresPersistence>> | undefined;
    try {
    if (postgresTarget !== undefined) {
      if (schemaName === undefined)
        throw new Error("Missing PostgreSQL standalone target identity");
      separate = await createPostgresPersistence({
        poolConfig: { ...postgresTarget.pool.options, password: postgresTarget.pool.options.password,
          ...(faultUrl === undefined ? {} : { connectionString: faultUrl }),
          options: `-c search_path=${schemaName}`,
          application_name: standaloneApplicationName, max: 1 },
      });
    }
    const postgresSession = postgresTarget === undefined || separate === undefined ? undefined :
      makePostgresRelationalSession({ drizzle: postgresTarget.drizzle, pool: separate.pool }, undefined,
        currency.managedRead === undefined ? undefined : { kind: "managed", installation: currency.managedRead.installation });
    if (separate !== undefined) {
      const authenticated = (await separate.query<{ schemaName: string; login: string; role: string; databaseName: string }>(
        'select current_schema() as "schemaName", session_user as login, current_user as role, current_database() as "databaseName"')).rows[0];
      if (authenticated === undefined || authenticated.schemaName !== schemaName ||
        authenticated.login !== primaryLogin || authenticated.role !== primaryRole ||
        authenticated.databaseName !== primaryDatabase)
        throw new Error("Standalone Payload credential identity mismatch");
    }
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePayloadRuntime(compiledPayload);
      const host = yield* makeCmsHost({ ...standalonePayloadFaultHostInput(compiledPayload, postgresSession ?? currency.session),
        commands: [inspectPayloadRuntimeForTest(runtime).commands.create], expectedContentIdentity: compiledPayload.contentIdentity },
      separate === undefined ? undefined : { afterAdmission: tx => Effect.tryPromise({
        try: async () => {
          const observed = await tx.execute<{ pid: number; schemaName: string; applicationName: string;
            primaryStillConnected: boolean; login: string; role: string; databaseName: string }>(sql`select pg_backend_pid()::int as pid,
              current_schema() as "schemaName",
              current_setting('application_name') as "applicationName",
              session_user as login, current_user as role, current_database() as "databaseName",
              exists(select 1 from pg_stat_activity where pid = ${primaryTargetPid}) as "primaryStillConnected"`);
          const connection = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(
            Schema.Struct({ pid: Schema.Number, schemaName: Schema.String,
              applicationName: Schema.String, primaryStillConnected: Schema.Boolean,
              login: Schema.String, role: Schema.String, databaseName: Schema.String })) }))(observed).rows[0];
          if (connection === undefined || primaryTargetPid === undefined ||
            connection.pid === primaryTargetPid ||
            connection.schemaName !== schemaName ||
            connection.applicationName !== standaloneApplicationName ||
            connection.login !== primaryLogin || connection.role !== primaryRole ||
            connection.databaseName !== primaryDatabase ||
            connection.primaryStillConnected !== true) throw new Error("Standalone Payload used wrong PostgreSQL connection");
          standalonePayloadPgConnections.push(Object.freeze({
            primaryTargetPid, standalonePid: connection.pid }));
        },
        catch: cause => new CmsTransactionError({ reason: "resourceFailure", cause }),
      }) });
      return yield* host.run(host.newRequestKey(), inspectPayloadRuntimeForTest(runtime).commands.create, {
        collection: "posts", data: { title, publishedAt: "2026-01-01" },
      }).pipe(Effect.ensuring(host.close));
    })));
    if (separate !== undefined && (separate.pool.totalCount !== 1 || separate.pool.idleCount !== 1))
      throw new Error("Standalone Payload did not release its single PostgreSQL connection");
    return result;
    } finally { await separate?.close(); }
    } finally { primary?.release(); }
  }
  const defaultPublisher = createPointCommitPublisherPortV1(application.sessionAuthority, publisherOptions);
  let selectedPublisher = defaultPublisher;
  const configuredPublisher: ReturnType<typeof createPointCommitPublisherPortV1> = Object.freeze({ ...defaultPublisher,
    publishFinite: (command: Parameters<typeof defaultPublisher.publishFinite>[0]) => Effect.suspend(() => selectedPublisher.publishFinite(command)),
    publish: (command: Parameters<typeof defaultPublisher.publish>[0]) => Effect.suspend(() => selectedPublisher.publish(command)) });
  const prepareFiniteEntry = journal.prepareFiniteEntry;
  if (typeof prepareFiniteEntry !== "function") throw new Error("Mixed finite retry requires the initial journal entry factory");
  const acquireFiniteReplacementEntry = Effect.fn("MixedMutationProductFixture.acquireFiniteReplacementEntry")(function* () {
    const freshGraph = yield* context.acquireFreshApplicationPreparation;
    const freshAdmission = yield* Effect.fromResult(readPreparedFiniteApplicationMutationInputs(
      freshGraph.preparedAdmission, context.admissionContext));
    const participants = makeJournalParticipants(freshGraph);
    return Object.freeze({ application: freshAdmission.application,
      prepareEntry: () => prepareFiniteEntry.call(journal, participants).pipe(
        Effect.mapError(cause => new PointMutationAttemptReplacementFiniteEntryError({ cause }))) });
  }, Effect.mapError(cause => new PointMutationAttemptReplacementFiniteEntryError({ cause })));
  const finiteExecutionDependencies = {
    journal, executionClaims,
    publisher: configuredPublisher,
    replacement: createPointMutationAttemptReplacementPortV1(application.sessionAuthority, {
      ...publisherOptions, leaseDurationMilliseconds: 120_000, executionClaimDurationMilliseconds: 60_000,
      ...(input.hooks?.afterReplacementStep === undefined ? {} : { afterReplacementStep: input.hooks?.afterReplacementStep }),
      finiteEntry: acquireFiniteReplacementEntry,
    }),
    activation: activationPort, contextFactory: finiteContextFactory,
    runner: retryRunner,
    recovery: { acquisition: createPointMutationExecutionClaimAcquisitionV1(application.sessionAuthority, { durationMilliseconds: 60_000 }),
      applicationGrantKernel: createApplicationMutationGrantVerificationKernelV1({ deploymentId: activationInput.deploymentId,
        keys: [activationInput.verificationKey], grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 }) },
    terminalization: createPointMutationSessionAttemptTerminalizationPersistenceV1(application.sessionAuthority),
    liveness: finiteLiveness,
  } satisfies Parameters<typeof createFinitePointMutationExecution>[0];
  await runEffect(Deferred.succeed(connectedFiniteDependencies, finiteExecutionDependencies));
  const makeFiniteExecution = () => createFinitePointMutationExecution(finiteExecutionDependencies);
  const attempt = authenticatedInitialEntry.journalAttempt;
  const bound = bindPointMutationOccJournal(journal, attempt);
  const runAdmitted = bound.runAdmittedOperation;
  if (runAdmitted === undefined) throw new Error("Missing bound admitted participant");
  return { currency, product,
    ...(pricing === undefined ? {} : { pricing }),
    ...(link === undefined ? {} : { link }),
    ...(selectedPayload === undefined ? {} : { payload: Object.freeze({
      profile: selectedPayload.profile, runtimeHistory: payloadRuntimeHistory,
      current: () => payloadRuntimeHistory.at(-1),
    }) }),
    seed, baseline, seedGraph, logicalSourceCatalog: sourceCatalog, setupTimings: Object.freeze({
      provisioningMilliseconds: context.provisioningMilliseconds,
      preparedModuleMilliseconds: context.preparedModuleMilliseconds,
      initialSeedingMilliseconds: context.initialSeedingMilliseconds,
    }), application, active, activation, prepared, binding,
    preparedFiniteApplication: applicationAdmission.application, acquireFiniteReplacementEntry,
    replayFiniteActivation: () => activationPort.withFiniteStart(finiteActivationInput, activated => Effect.succeed(inspectActivatedPointMutationSessionV1(activated))),
    activateCompetingFiniteRequest: suffix => context.withApplicationPreparation((graph, currentEntry) => Effect.gen(function* () {
      const competing = yield* Effect.promise(() => {
        let preparation = competingPreparations.get(suffix);
        if (preparation === undefined) {
          preparation = context.prepareAttempt(suffix, undefined, undefined, graph);
          competingPreparations.set(suffix, preparation);
        }
        return preparation;
      });
      const currentActivation = createApplicationPointMutationSessionActivationV1(
        createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
          { leaseDurationMilliseconds: 60_000 }), executionClaims.issuer, makeJournal(graph));
      return yield* currentActivation.withFiniteStart({ deploymentId: competing.activationInput.deploymentId,
        scopeId: competing.activationInput.scopeId, preparedAdmission: graph.preparedAdmission,
        admissionContext: context.admissionContext, evidence: competing.activationInput.evidence, currentEntry },
        activated => Effect.succeed(inspectActivatedPointMutationSessionV1(activated)));
    })),
    openCompetingFiniteFixture: suffix => createMixedMutationAttemptFixture({ ...input, suffix }, context, seedGraph, false),
    productProfileRevision: revision,
    ...(workflowBinding === undefined ? {} : { workflowBinding }),
    schemaVersionId, logicalSchemaVersionId,
    eventPolicy, eventGroup, store, executionClaims, journal, attempt, bound, runAdmitted, selector,
    readSettlementLedger: async () => {
      const frozen = publication === undefined ? undefined : readFrozenFiniteAttempt(publication.frozen);
      if (frozen === undefined) return null;
      const graph = frozen.graph;
      let admittedIndexDefinitionDemands = 0;
      let admittedConstraintDefinitionDemands = 0;
      const indexIds = new Set<number>();
      const constraintIds = new Set<number>();
      for (const operation of frozen.operations) {
        if (operation.kind !== "participant") continue;
        const bundle = inspectLogicalParticipantAdmissionBundle(operation.admission, frozen.attempt,
          operation.participant, operation.method, operation.profileRevision);
        if (bundle === null) throw new Error("Missing issued finite operation admission");
        for (const [position, admission] of bundle.admissions.entries()) {
          const selected = logicalParticipants.flatMap(token => {
            const value = inspectFiniteOperationCommitAuthority(token, admission, frozen.attempt,
              operation.participant, bundle.sourceMethods[position]!);
            return value === null ? [] : [value];
          })[0];
          if (selected === undefined) throw new Error("Missing issued finite source authority");
          admittedIndexDefinitionDemands += selected.indexes.length;
          admittedConstraintDefinitionDemands += selected.unique.length;
          for (const definition of selected.indexes) indexIds.add(definition.indexDefinitionId);
          for (const definition of selected.unique) constraintIds.add(definition.uniqueConstraintDefinitionId);
        }
      }
      return Object.freeze({ syscallReceipts: frozen.operations.length,
        observedDocuments: graph.dependencies.length,
        admittedRangeDemands: graph.indexReads.length, admittedPageDemands: graph.pageReads.length,
        admittedUniqueDemands: graph.uniqueReads.length,
        admittedRangeEntryOccurrences: graph.indexReads.reduce((sum, range) => sum + range.entries.length, 0),
        admittedPageEntryOccurrences: graph.pageReads.reduce((sum, page) => sum + page.entries.length, 0),
        admittedIndexDefinitionDemands, admittedConstraintDefinitionDemands,
        distinctAdmittedIndexDefinitions: indexIds.size, distinctAdmittedConstraintDefinitions: constraintIds.size,
        publicationQueries: Object.freeze([...publicationQueries.values()].map(query => Object.freeze({ ...query }))),
        pointDependencies: frozen.dependencies.filter(dependency => dependency.kind === "appRowPoint").length,
        indexedQuerySyscalls: frozen.operations.filter(operation => operation.kind === "index").length,
        indexRangeDependencies: frozen.applicationIndexRanges.length,
        relationReadSyscalls: frozen.operations.filter(operation => operation.kind === "relation").length,
        relationDependencies: frozen.applicationRelationDependencies.length,
        finalRows: frozen.rowIntents.length,
        bytes: Object.freeze({ canonicalResult: frozen.successfulResult.canonicalBytes.byteLength }),
        unavailable: Object.freeze(["readDocumentOccurrences", "strongReferenceDemands", "inMemoryGraphBytes",
          "unobservedPublicationOwnerParameters", "nonScalarParameterWireEncoding"]),
      });
    },
    persistenceAttempt: confirmed.attempt,
    freezeFiniteRootDirect: result => canonicalizeSuccessfulResultV1Effect(result === undefined ? null : result).pipe(
      Effect.flatMap(successfulResult => store.freezeFiniteRootEffect(confirmed.attempt, successfulResult))),
    reopenJournalAttempt: () => authenticatedInitialEntry.reopenJournalAttempt,
    makeFiniteDispatcher: makeFiniteExecution,
    serviceTransactionDepth, pgTransactionObservations,
    observePgNativeSqlTransactions,
    standalonePayloadPgConnections, standaloneProductPgConnections, standaloneLinkPgConnections,
    nativeInvokeCount, retryContexts, retryReturnedValues, sqlByPhase,
    hasSqlObserver, bridgeFailures, runExecution,
    participantAuthority, publisherOptions, pointCommitPorts: application.sessionAuthority,
    makePublisher: () => createPointCommitPublisherPortV1(application.sessionAuthority, publisherOptions),
    preparePublication, prepareFrozenPublication, publish, replayPublication,
    freeze: (result: unknown) => authenticatedInitialEntry.prepareFiniteCommit(result),
    prepareOccPublication, retryWholeAttempt,
    runStandaloneProductUpdate, runStandaloneProductMutation, runStandaloneLinkCreate,
    runStandalonePayloadCreate,
    retryClosedWorkflow: value => lastBorrowedWorkflowInvoke === undefined
      ? Promise.reject(new Error("Workflow was never borrowed")) : lastBorrowedWorkflowInvoke(value),
    readCurrentProduct, readCurrentApplicationDocument, readCurrentPayloadPost, readCurrentWorkflowPricing,
    getUpdateRequest: () => updateRequest,
    getAdmittedRequest: (participant: string, method: string) =>
      admittedRequests.get(`${participant}:${method}`),
    getOpenTransactionDepth: () => openTransactionDepth,
    getTransactionCounts: () => ({ beginCount, settleCount }),
    setSqlPhase: (phase: string) => { sqlPhase = phase; },
    close: () => closeMixedMutationFixture({
      signalInitial: async () => { await runEffect(Deferred.succeed(initialDone, undefined)); },
      joinInitial: async () => { await runEffect(Fiber.join(initialFiber)); },
      closeSyscallScope,
      closePayloadScopes: () => runEffect(closePayloadScopes),
      ownsContext, context: {
        detachSqlObserver: () => currency.observeSql?.(undefined),
        // The local syscall scope already has its explicit release above. Its
        // setup-failure registration must not execute it a second time here.
        resources: cleanup.filter(close => close !== closeSyscallScope),
      },
    }),
  };
}
