import { appUniqueConstraintEligibilityFrame } from "../storage/unique/appUniqueConstraintSetBuildV1";
import { observeExecution } from "../execution/diagnostics/operation";
import { chargeUniqueConstraintPreparation, lendPreparedAppUniqueConstraintDefinitions, type AppUniqueConstraintSetPreparation } from "../storage/unique/appUniqueConstraintSetBuildV1";
import { readUniqueMaintenanceRequirements } from "../storage/unique/appUniqueConstraintSetBuildV1";
import { UniqueMaintenanceError } from "../storage/indexes/indexMaintenanceModel";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../execution/transactionSessionAttemptKernel";
import { getActivationServingInstallationReferencesResult, isManagedInstallationTransaction,
  type PreparedActivationServingInstallation, type PreparedInstallation } from "../installation/installationLifecycle";
import { scopePhysicalLocatorsEqual } from "../scope/scopePhysicalLocator";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { acquireProtectedMetadataInstallationAdmission, captureProtectedMetadataEpoch, authenticateProtectedTargetMetadataSnapshot, guardProtectedMetadataEpoch, hasProtectedMetadataFinalGuardScope, registerProtectedMetadataFinalGuard,
  authenticateProtectedReadinessMetadataPair, type ProtectedTargetMetadataEvidence,
  type ProtectedMetadataEpochIdentity, type ProtectedMetadataPreparation } from "../execution/preparation/preparedMetadataEpoch";
import {
  canonicalizeApplicationManifestV1,
  APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { isCanonicalCalendarDate } from "@flarex/time/calendar-date";
import {
  applicationFunctionEntryPublicationFrameV1,
  applicationFunctionCatalogPublicationFrameV1,
  applicationPublicationCommitmentFrameV1,
  applicationSchemaPublicationFrameV1,
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1, MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1 } from
  "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { Cause, Data, Effect, Exit, Result } from "effect";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
  type CanonicalApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { appSchemaCandidateManifestSha256HexV1FromBytes } from
  "flarex-protocol/internal/app-schema-candidate-validation-v1";
import { encodeCanonicalJson, isJson, type Json } from "flarex-protocol/json";
import {
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  FlarexDbV1StorageGenerationSchema,
  type FlarexDbV1StorageGeneration,
} from "flarex-protocol/storage-authority";

import { AppRowReadPersistenceError, type AppRowTransaction } from "../storage/documents/appRows";
import {
  hasAppSchemaCandidateReadinessComposition,
  loadAppSchemaCandidateReadinessEffect,
  validateAppSchemaCandidateReadinessInTransactionEffect,
  type AppSchemaCandidateReadinessEvidence,
  type AppSchemaCandidateReadinessPort,
  type LoadAppSchemaCandidateReadinessError,
  type ValidateAppSchemaCandidateReadinessError,
} from "../storage/catalog/appSchemaCandidateValidation";
import {
  type ApplicationSchemaAuthority,
  type ApplicationSchemaAuthorityError,
  type ApplicationSchemaAuthorityPublisher,
  hasApplicationSchemaAuthorityComposition,
} from "./applicationSchemaAuthority";
import {
  captureApplicationTaskCatalogRowsInTransaction,
  authenticateCapturedApplicationTaskCatalogRows,
  type CapturedApplicationTaskCatalogRows,
  isApplicationTaskCatalogSnapshotPort,
  type ApplicationTaskCatalogSnapshot,
  type ApplicationTaskCatalogSnapshotError,
  type ApplicationTaskCatalogSnapshotPort,
} from "./tasks/applicationTaskBindings";
import { databaseTimestampFromUnknown } from "../database/databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { detachDriverRows } from "../database/detachDriverRows";
import { runEffectTransaction } from "../database/effectTransaction";
import { runDrizzleStatementEffect } from "../database/drizzleStatementEffect";
import { isRetryableSqlTransactionCause } from "../database/locatedReadCommittedEffect";
import { captureHostPreparationLifetime, chargeHostPreparation, registerHostPreparationDisposal } from "../execution/preparation/preparedHostRuntime";
import type { OriginalSchemaVersionRead } from "../storage/catalog/schemaVersionArtifacts";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  publishedPhysicalDefinitionMatchesLocated,
  MAX_RECONCILED_DEFINITIONS,
  type IndexBuildReconciliationCatalogV1Error,
  type PublishedPhysicalRequirementSnapshotV1,
} from "../storage/indexes/indexBuildReconciliation";
import { IndexMaintenanceError } from "../storage/indexes/indexMaintenanceModel";
import type { CheckedApplicationActiveHead } from "./applicationActiveHeadRead";
import {
  isIndexBuildSnapshotCoveredInTransactionEffect,
  readIndexCoverageContextInTransactionEffect,
  decodeIndexBuildStateRowResult,
  indexMaintenanceBindingPredicate,
  type IndexBuildStateRecord,
  validateIndexBuildStateFrontierResult,
} from "../storage/indexes/indexBuildStates";
import type { ReadAppIndexDefinitionError } from "../storage/indexes/appIndexDefinitions";
import type { ReadAppSchemaVersionIndexBindingError } from
  "../storage/indexes/appIndexDefinitions";
import type { ReadSchemaVersionArtifactError } from "../storage/catalog/schemaVersionArtifacts";
import {
  hasPhysicalDefinitionLifecycleComposition,
  preparePhysicalDefinitionLifecycleReadinessEffect,
  chargePhysicalDefinitionPreparation,
  validatePhysicalDefinitionLifecycleReadinessInTransactionEffect,
  validatePhysicalDefinitionLifecycleReadinessCatalogEffect,
  type PhysicalDefinitionLifecyclePort,
  type PreparedPhysicalDefinitionLifecycleReadiness,
  type PreparePhysicalDefinitionLifecycleReadinessError,
  type ValidatePhysicalDefinitionLifecycleReadinessError,
} from "../installation/physicalDefinitionLifecycle";
import {
  loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect,
  preparePointCommitUniqueConstraintSet,
  acceptPreparedPointCommitUniqueConstraintSet,
  validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect,
  type LoadPointCommitUniqueConstraintEligibilityV1Error,
  type ValidatePointCommitUniqueConstraintEligibilityV1Error,
} from "../commit/pointCommitTransaction";
import type {
  AppUniqueConstraintSetEligibilityResultV1,
} from "../storage/unique/appUniqueConstraintSetBuildV1";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type ExactTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "../scope/scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  decodeScopeClockRecordResult,
  scopeClockSelection,
  ScopeAuthorizationRevocationEpochPersistenceError,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "../scope/scopeClock";
import {
  deployments,
  fxControlApplicationSchemaAuthoritiesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationCandidatesV1,
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../database/schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../execution/transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_FUNCTIONS = 4_096;
const MAX_PHYSICAL_DEFINITIONS = MAX_RECONCILED_DEFINITIONS;
const MAX_BINDING_BYTES = 1_048_576;
const MAX_READINESS_BYTES = 16_777_216;

export interface ApplicationReadinessColdMaterializationPort<Failure> {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly materialize: (input: {
    readonly target: CanonicalApplicationRuntimeTargetV1["target"];
    readonly manifest: ApplicationManifestV1;
  }) => Effect.Effect<CanonicalApplicationRuntimeColdReceiptV1, Failure>;
}

export interface ApplicationReadinessContext<SchemaFailure, ColdFailure> {
  readonly controlDb: FlarexMetadataDatabase;
  /** Optional authenticated target installation for bounded structural reuse. */
  readonly protectedMetadata?: Readonly<{ database: FlarexMetadataDatabase;
    token: ProtectedMetadataPreparation }>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> &
    ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly schema: ApplicationSchemaAuthorityPublisher<SchemaFailure>;
  readonly taskCatalog: ApplicationTaskCatalogSnapshotPort;
  readonly candidateValidation: AppSchemaCandidateReadinessPort;
  /** Exact point-commit factory result; structural substitutes fail closed. */
  readonly pointCommit: unknown;
  /** Exact scope-local physical-definition availability authority. */
  readonly physicalDefinitionLifecycle: PhysicalDefinitionLifecyclePort;
  readonly cold: ApplicationReadinessColdMaterializationPort<ColdFailure>;
}

/** Activation construction is explicit. Full proof retains the privileged
 * compatibility/test owner; managed serving logins cannot execute publishers. */
export type ApplicationActivationTargetProfile =
  | Readonly<{ readonly kind: "installed"; readonly installation: PreparedActivationServingInstallation;
      readonly target: LocatedReadCommittedAttemptTargetV1 }>
  | Readonly<{ readonly kind: "fullProof" }>;

export interface ApplicationActivationTargetPreparation {
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly installed?: Readonly<{ database: FlarexMetadataDatabase; installation: PreparedInstallation }>;
}

/** Domain construction only: the readiness issuer still authenticates its own
 * result, and the real selected runner freshly admits the activation login. */
export function selectApplicationActivationTargetResult(profile: ApplicationActivationTargetProfile,
  servingTarget: LocatedReadCommittedAttemptTargetV1, locator: ScopePhysicalLocator):
  Result.Result<ApplicationActivationTargetPreparation, ApplicationReadinessError> {
  return Result.gen(function* () {
    if (!scopePhysicalLocatorsEqual(servingTarget.physicalLocator, locator))
      return yield* Result.fail(readinessFailureValue("invalidComposition"));
    if (profile.kind === "fullProof") return Object.freeze({ target: servingTarget });
    const references = yield* getActivationServingInstallationReferencesResult(profile.installation).pipe(
      Result.mapError(cause => readinessFailureValue("invalidComposition", false, cause)));
    if (!hasLocatedReadCommittedTargetDatabaseV1(servingTarget, references.serving.database) ||
      !hasLocatedReadCommittedTargetDatabaseV1(profile.target, references.activation.database) ||
      !scopePhysicalLocatorsEqual(profile.target.physicalLocator, locator))
      return yield* Result.fail(readinessFailureValue("invalidComposition"));
    return Object.freeze({ target: profile.target, installed: references.activation });
  });
}

export type ApplicationReadinessNotReadyReason =
  | "revisionMissing"
  | "publicationMissing"
  | "taskCatalogMissing"
  | "candidateValidationMissing"
  | "candidateValidationInProgress"
  | "candidateValidationFailed"
  | "candidateValidationWrongSchema"
  | "physicalBuildMissing"
  | "physicalBuildNotCovered"
  | "physicalBuildNotEnabled"
  | "physicalDefinitionNotActive"
  | "uniqueConstraintSetMissing"
  | "uniqueConstraintBuildMissing"
  | "uniqueConstraintBuildNotEnabled"
  | "uniqueConstraintBuildStale";

export type ApplicationReadinessResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly revisionId: string;
      readonly reason: ApplicationReadinessNotReadyReason;
      readonly detail?: string;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly disposition: "inserted" | "replayed";
      readonly scopeId: TrustedScopeAuthority["scopeId"];
      readonly revisionId: string;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly readinessSha256: string;
      readonly readinessBytes: Uint8Array;
      readonly readyAt: Date;
    }>;

export class ApplicationReadinessError extends Data.TaggedError(
  "ApplicationReadinessError",
)<{
  readonly operation: "settle" | "readReady";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "storedState"
    | "schemaBinding"
    | "coldMaterialization"
    | "conflictingReplay"
    | "invalidComposition"
    | "decisionUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type SettleApplicationReadinessError<SchemaFailure, ColdFailure> =
  | ApplicationReadinessError
  | ApplicationSchemaAuthorityError
  | ApplicationTaskCatalogSnapshotError
  | SchemaFailure
  | ColdFailure
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | IndexBuildReconciliationCatalogV1Error
  | TrustedScopeAuthorityError
  | LoadAppSchemaCandidateReadinessError
  | ValidateAppSchemaCandidateReadinessError
  | LoadPointCommitUniqueConstraintEligibilityV1Error
  | ValidatePointCommitUniqueConstraintEligibilityV1Error
  | PreparePhysicalDefinitionLifecycleReadinessError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError;

export type ReadApplicationReadinessError =
  | ApplicationReadinessError
  | ApplicationSchemaAuthorityError
  | ApplicationTaskCatalogSnapshotError
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | IndexBuildReconciliationCatalogV1Error
  | TrustedScopeAuthorityError
  | LoadPointCommitUniqueConstraintEligibilityV1Error
  | PreparePhysicalDefinitionLifecycleReadinessError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | LockScopeClockForShareError;

export interface ApplicationReadinessRepository<SchemaFailure, ColdFailure> {
  readonly settle: (input: {
    readonly deploymentId: string;
    readonly scopeId: TrustedScopeAuthority["scopeId"];
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationReadinessResult,
    SettleApplicationReadinessError<SchemaFailure, ColdFailure>
  >;
  readonly readReady: (input: {
    readonly deploymentId: string;
    readonly scopeId: TrustedScopeAuthority["scopeId"];
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationReadinessResult,
    ReadApplicationReadinessError
  >;
}

export interface ApplicationReadinessActivationBasis {
  readonly physicalRequirements: PublishedPhysicalRequirementSnapshotV1;
  readonly authority: TrustedScopeAuthority;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: Uint8Array;
  readonly manifestSha256: Uint8Array;
  readonly manifest: ApplicationManifestV1;
  readonly publicationSha256: Uint8Array;
  readonly functionCatalogSha256: Uint8Array;
  readonly applicationSchemaSha256: Uint8Array;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly taskCatalogSha256: Uint8Array;
  readonly taskCatalogBindingSha256: Uint8Array;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly readinessSha256: Uint8Array;
}

export type ApplicationReadinessActivationValidation =
  | Extract<ApplicationReadinessResult, { readonly status: "not_ready" }>
  | Readonly<{
      readonly status: "ready";
      readonly basis: ApplicationReadinessActivationBasis;
    }>;

type StoredApplicationReadinessActivationValidation = Extract<
  ApplicationReadinessActivationValidation,
  { readonly status: "ready" }
>;

export type ApplicationReadinessAuthority = TrustedScopeAuthority & Readonly<{
  readonly storageGeneration: FlarexDbV1StorageGeneration;
}>;

interface StoredBundle {
  readonly authority: ApplicationReadinessAuthority;
  readonly deploymentId: string;
  readonly revision: typeof fxSystemApplicationRevisionsV2.$inferSelect;
  readonly publication: typeof fxSystemApplicationPublicationsV1.$inferSelect;
  readonly manifest: ApplicationManifestV1;
  readonly functions: ReadonlyArray<
    typeof fxSystemApplicationFunctionsV1.$inferSelect
  >;
  readonly task: ApplicationTaskCatalogSnapshot;
}

interface ColdEvidence {
  readonly functionPath: string;
  readonly runtimeTargetSha256: Uint8Array;
  readonly coldReceiptSha256: Uint8Array;
  readonly coldReceiptBytes: Uint8Array;
}

interface PreparedColdEvidence {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly entries: ReadonlyArray<ColdEvidence>;
}

interface PreparedReadiness {
  readonly bundle: StoredBundle;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schema: ApplicationSchemaAuthority;
  readonly schemaBindingSha256: Uint8Array;
  readonly cold: ReadonlyArray<ColdEvidence>;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly coldReceiptSetSha256: Uint8Array;
  readonly requirements: PublishedPhysicalRequirementSnapshotV1;
  readonly candidateValidation: AppSchemaCandidateReadinessEvidence;
  readonly uniqueConstraintEligibility: Exclude<
    AppUniqueConstraintSetEligibilityResultV1,
    { readonly status: "not_ready" }
  >;
  readonly uniqueConstraintEligibilitySha256: Uint8Array;
  readonly physicalDefinitionLifecycle:
    PreparedPhysicalDefinitionLifecycleReadiness;
}

/** Internal identity token binding issued readiness results to their
 * repository; WeakMap membership, not structure, is proof. The unguessable
 * property key makes the type nominally distinct from caller objects. */
type ApplicationReadinessRepositoryIssuerV1 = {
  readonly __flarexApplicationReadinessRepositoryIssuerV1: "FlarexPersistence/ApplicationReadinessRepositoryIssuerV1";
};

interface ApplicationReadinessIssuerState {
  readonly context: ApplicationReadinessContext<unknown, unknown>;
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
}

interface PreparedIssuedApplicationReadinessState {
  readonly kind: "prepared";
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
  readonly prepared: PreparedReadiness;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
}

interface StoredReadinessAuthority {
  readonly target?: LocatedReadCommittedAttemptTargetV1;
  readonly controlIdentity?: Readonly<{ databaseName: string; namespaceOid: string }>;
  readonly generationProtection?: ApplicationReadinessProtection;
  readonly preparationProfile?: "finiteEntry";
  readonly bundle: StoredBundle;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schema: ApplicationSchemaAuthority;
  readonly schemaBindingSha256: Uint8Array;
  readonly originalControl?: OriginalApplicationControlRead;
  readonly requirements: PublishedPhysicalRequirementSnapshotV1;
  readonly physicalDefinitionLifecycle:
    PreparedPhysicalDefinitionLifecycleReadiness;
  readonly uniquePreparation?: AppUniqueConstraintSetPreparation;
  readonly cold: PreparedColdEvidence;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
  readonly readyAt: Date;
  readonly physicalReadinessSha256: Uint8Array;
  readonly protectedMetadata?: Readonly<{ database: FlarexMetadataDatabase;
    token: ProtectedMetadataPreparation; epoch: ProtectedMetadataEpochIdentity }>;
}
export interface ApplicationReadinessProtection {
  readonly target: ProtectedTargetMetadataEvidence;
  readonly control: ProtectedTargetMetadataEvidence;
}

function snapshotReadinessProtection(protection: ApplicationReadinessProtection): ApplicationReadinessProtection {
  return Object.freeze({
    target: Object.freeze({ database: protection.target.database, token: protection.target.token,
      epoch: Object.freeze({ ...protection.target.epoch }) }),
    control: Object.freeze({ database: protection.control.database, token: protection.control.token,
      epoch: Object.freeze({ ...protection.control.epoch }) }),
  });
}

function readinessEpochsEqual(left: ProtectedMetadataEpochIdentity, right: ProtectedMetadataEpochIdentity): boolean {
  return left.databaseName === right.databaseName && left.namespaceOid === right.namespaceOid &&
    left.incarnation === right.incarnation && left.generation === right.generation && left.login === right.login;
}

function readinessProtectionMatches(original: ApplicationReadinessProtection, supplied: ApplicationReadinessProtection): boolean {
  return original.target.database === supplied.target.database && original.target.token === supplied.target.token &&
    original.control.database === supplied.control.database && original.control.token === supplied.control.token &&
    readinessEpochsEqual(original.target.epoch, supplied.target.epoch) &&
    readinessEpochsEqual(original.control.epoch, supplied.control.epoch);
}

export interface OriginalApplicationControlRead {
  readonly database: FlarexMetadataDatabase;
  readonly artifact: OriginalSchemaVersionRead;
  readonly schemaAuthority: Readonly<{
    row: typeof fxControlApplicationSchemaAuthoritiesV1.$inferSelect;
    schemaBindingByteLengthText: string;
  }>;
}

interface StoredIssuedApplicationReadinessState {
  readonly kind: "stored";
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
  readonly stored: StoredReadinessAuthority;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
  readonly lifetime: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
}

type IssuedApplicationReadinessState =
  | PreparedIssuedApplicationReadinessState
  | StoredIssuedApplicationReadinessState;

const readinessRepositoryStates = new WeakMap<
  object,
  ApplicationReadinessIssuerState
>();

/** The exact Application issuer supplies installation protection for compact
 * immutable binding capture; no prior serving/readiness verdict is borrowed. */
export function readApplicationReadinessPreparationProtection(repository: unknown) {
  if (typeof repository !== "object" || repository === null)
    return Result.fail(readinessFailureValue("invalidComposition"));
  const state = readinessRepositoryStates.get(repository);
  const protection = state?.context.protectedMetadata;
  return state === undefined || protection === undefined
    ? Result.fail(readinessFailureValue("invalidComposition"))
    : Result.succeed(protection);
}
/** Package-private composition identity; this exposes no positive readiness. */
export function readApplicationReadinessControlDatabase<SchemaFailure, ColdFailure>(repository: ApplicationReadinessRepository<SchemaFailure, ColdFailure>) {
  const state = readinessRepositoryStates.get(repository);
  return state === undefined ? Result.fail(readinessFailureValue("invalidComposition")) :
    Result.succeed(state.context.controlDb);
}
const issuedReadinessStates = new WeakMap<
  Extract<ApplicationReadinessResult, { readonly status: "ready" }>,
  IssuedApplicationReadinessState
>();

declare const readinessActivationViewBrand: unique symbol;
export interface PreparedApplicationReadinessActivation {
  readonly [readinessActivationViewBrand]: true;
}
const readinessActivationViews = new WeakMap<PreparedApplicationReadinessActivation, Readonly<{
  owner: ApplicationReadinessIssuerState;
  issued: Extract<ApplicationReadinessResult, { readonly status: "ready" }>;
  target: ApplicationActivationTargetPreparation;
}>>();

/** Reuses the original ready result and issuer. No serving preparation or
 * readiness graph is transferred to another database object. */
export const prepareApplicationReadinessActivation = Effect.fn("ApplicationReadiness.prepareActivation")(
  function* (repository: unknown, issued: ApplicationReadinessResult,
    profile: ApplicationActivationTargetProfile, servingTarget: LocatedReadCommittedAttemptTargetV1) {
    const owner = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
    const ready = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
    if (owner === undefined || ready?.kind !== "prepared" || ready.issuer !== owner.issuer || issued.status !== "ready")
      return yield* readinessFailure("invalidComposition");
    const target = yield* Effect.fromResult(selectApplicationActivationTargetResult(profile, servingTarget,
      ready.prepared.bundle.authority.physicalLocator));
    // SAFETY: the issuer registry alone authenticates this inert target view.
    const preparation = Object.freeze({}) as PreparedApplicationReadinessActivation;
    readinessActivationViews.set(preparation, Object.freeze({ owner, issued, target }));
    return Object.freeze({ target: target.target, preparation });
  },
);

interface CapturedReadinessRows {
  readonly authority: ApplicationReadinessAuthority;
  readonly deploymentId: string;
  readonly revision: typeof fxSystemApplicationRevisionsV2.$inferSelect | undefined;
  readonly revisionId: string;
  readonly selected: CapturedBundleSelection | undefined;
  readonly functions: ReadonlyArray<typeof fxSystemApplicationFunctionsV1.$inferSelect>;
  readonly task: Result.Result<CapturedApplicationTaskCatalogRows | null, ApplicationTaskCatalogSnapshotError>;
  readonly readiness: typeof fxSystemApplicationReadinessV1.$inferSelect | undefined;
  readonly cold: ReadonlyArray<typeof fxSystemApplicationReadinessFunctionsV1.$inferSelect>;
  readonly protection?: NonNullable<ApplicationReadinessContext<unknown, unknown>["protectedMetadata"]> & {
    readonly epoch: ProtectedMetadataEpochIdentity;
  };
}

declare const readinessCaptureBrand: unique symbol;
export interface CapturedApplicationReadiness {
  readonly [readinessCaptureBrand]: true;
}
const readinessCaptures = new WeakMap<CapturedApplicationReadiness, {
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
  readonly profile: "request" | "retained";
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly rows: CapturedReadinessRows;
}>();

/** Bounded target capture. Canonical authentication and control access run after SQL closes. */
export const captureApplicationReadinessInTransaction = Effect.fn(
  "ApplicationReadiness.captureRows",
)(function* (repository: ApplicationReadinessRepository<unknown, unknown>, authority: TrustedScopeAuthority, revisionId: string,
  target: LocatedReadCommittedAttemptTargetV1, tx: AppRowTransaction, clock: ScopeClockRecord, profile: "request" | "retained") {
  const state = readinessRepositoryStates.get(repository);
  const protection = state?.context.protectedMetadata;
  if (state === undefined || authority.storageGeneration !== "flarexdb_v1" ||
    (protection !== undefined && !hasLocatedReadCommittedTargetDatabaseV1(target, protection.database)))
    return yield* readinessFailure("invalidComposition");
  const exactAuthority: ApplicationReadinessAuthority = Object.freeze({ ...authority,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1") });
  const before = protection === undefined ? undefined : yield* captureProtectedMetadataEpoch(protection.token, protection.database, tx).pipe(
    Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  yield* requireExactAuthority(exactAuthority, clock);
  const revisions = yield* query(tx.select().from(fxSystemApplicationRevisionsV2).where(and(
    eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
    eq(fxSystemApplicationRevisionsV2.revisionId, revisionId),
  )).limit(1).for("share"));
  const revision = revisions[0];
  if (revision === undefined && profile === "retained") return yield* readinessFailure("storedState");
  const selectedRows = yield* query(tx.select({ candidate: fxSystemApplicationCandidatesV1,
    analysis: { ...getTableColumns(fxSystemApplicationAnalysesV1),
      manifestBytes: sql<Uint8Array | null>`case when octet_length(${fxSystemApplicationAnalysesV1.manifestBytes}) between 1 and ${APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1}
        then ${fxSystemApplicationAnalysesV1.manifestBytes} else null end` },
    publication: { ...getTableColumns(fxSystemApplicationPublicationsV1),
      schemaBytes: sql<Uint8Array>`case when octet_length(${fxSystemApplicationPublicationsV1.schemaBytes}) between 1 and ${APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1}
        then ${fxSystemApplicationPublicationsV1.schemaBytes} else ''::bytea end`,
      functionCatalogBytes: sql<Uint8Array>`case when octet_length(${fxSystemApplicationPublicationsV1.functionCatalogBytes}) between 1 and ${APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1}
        then ${fxSystemApplicationPublicationsV1.functionCatalogBytes} else ''::bytea end` } })
    .from(fxSystemApplicationRevisionsV2)
    .leftJoin(fxSystemApplicationCandidatesV1, and(
      eq(fxSystemApplicationCandidatesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationCandidatesV1.candidateId, fxSystemApplicationRevisionsV2.candidateId)))
    .leftJoin(fxSystemApplicationAnalysesV1, and(
      eq(fxSystemApplicationAnalysesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationAnalysesV1.analysisId, fxSystemApplicationRevisionsV2.analysisId)))
    .leftJoin(fxSystemApplicationPublicationsV1, and(
      eq(fxSystemApplicationPublicationsV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
      eq(fxSystemApplicationPublicationsV1.revisionId, fxSystemApplicationRevisionsV2.revisionId)))
    .where(and(eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
      eq(fxSystemApplicationRevisionsV2.revisionId, revisionId))).limit(1));
  const selected = selectedRows[0];
  if (profile === "retained" && (selected === undefined || selected.analysis?.manifestBytes === null ||
    selected.analysis?.manifestBytes === undefined || selected.analysis.manifestBytes.byteLength > APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1)
  ) return yield* readinessFailure("storedState");
  // Every canonical function entry is an element of the same bounded catalog.
  // Admit the aggregate stored bytes before transferring any entry body.
  const functionBytesAdmitted = sql<boolean>`(select coalesce(sum(octet_length(${fxSystemApplicationFunctionsV1.entryBytes})), 0)
    <= ${APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1} and count(*) <= ${MAX_FUNCTIONS}
    from ${fxSystemApplicationFunctionsV1} where ${fxSystemApplicationFunctionsV1.scopeId} = ${authority.scopeId}
      and ${fxSystemApplicationFunctionsV1.revisionId} = ${revisionId})`;
  const functions = yield* query(tx.select({ ...getTableColumns(fxSystemApplicationFunctionsV1),
    entryBytes: sql<Uint8Array>`case when ${functionBytesAdmitted} and octet_length(${fxSystemApplicationFunctionsV1.entryBytes}) between 1 and ${APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1}
      then ${fxSystemApplicationFunctionsV1.entryBytes} else ''::bytea end` }).from(fxSystemApplicationFunctionsV1).where(and(
    eq(fxSystemApplicationFunctionsV1.scopeId, authority.scopeId),
    eq(fxSystemApplicationFunctionsV1.revisionId, revisionId),
  )).limit(MAX_FUNCTIONS + 1));
  const invalidFunctions = functions.length > MAX_FUNCTIONS || functions.some(row => row.entryBytes.byteLength < 1 ||
    row.entryBytes.byteLength > APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1);
  if (invalidFunctions && profile === "retained") return yield* readinessFailure("storedState");
  // Expected task failures are resolved at their original position after bundle/function
  // authentication. Defects and interruption still escape the capture immediately.
  const task = profile === "retained"
    ? Result.succeed(yield* captureApplicationTaskCatalogRowsInTransaction(state.context.taskCatalog, tx, exactAuthority, revisionId))
    : invalidFunctions ? Result.succeed(null) : yield* Effect.result(
      captureApplicationTaskCatalogRowsInTransaction(state.context.taskCatalog, tx, exactAuthority, revisionId));
  const readyRows = yield* query(tx.select({ ...getTableColumns(fxSystemApplicationReadinessV1),
    readinessBytes: sql<Uint8Array>`case when octet_length(${fxSystemApplicationReadinessV1.readinessBytes}) between 1 and ${MAX_READINESS_BYTES}
      then ${fxSystemApplicationReadinessV1.readinessBytes} else ''::bytea end` }).from(fxSystemApplicationReadinessV1).where(and(
    eq(fxSystemApplicationReadinessV1.scopeId, authority.scopeId),
    eq(fxSystemApplicationReadinessV1.revisionId, revisionId),
  )).limit(1).for("share"));
  const readiness = readyRows[0];
  if (profile === "retained" && (readiness === undefined || readiness.readinessBytes.byteLength > MAX_READINESS_BYTES))
    return yield* readinessFailure("storedState");
  const coldBytesAdmitted = sql<boolean>`(select coalesce(sum(octet_length(${fxSystemApplicationReadinessFunctionsV1.coldReceiptBytes})), 0)
    <= ${MAX_FUNCTIONS * MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1} and count(*) <= ${MAX_FUNCTIONS}
    from ${fxSystemApplicationReadinessFunctionsV1}
    where ${fxSystemApplicationReadinessFunctionsV1.scopeId} = ${authority.scopeId}
      and ${fxSystemApplicationReadinessFunctionsV1.revisionId} = ${revisionId})`;
  const cold = yield* query(tx.select({ ...getTableColumns(fxSystemApplicationReadinessFunctionsV1),
    coldReceiptBytes: sql<Uint8Array>`case when ${coldBytesAdmitted} and octet_length(${fxSystemApplicationReadinessFunctionsV1.coldReceiptBytes}) between 1 and ${MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1}
      then ${fxSystemApplicationReadinessFunctionsV1.coldReceiptBytes} else ''::bytea end` }).from(fxSystemApplicationReadinessFunctionsV1).where(and(
    eq(fxSystemApplicationReadinessFunctionsV1.scopeId, authority.scopeId),
    eq(fxSystemApplicationReadinessFunctionsV1.revisionId, revisionId),
  )).limit(MAX_FUNCTIONS + 1).for("share"));
  if (profile === "retained" && (cold.length > MAX_FUNCTIONS || cold.some(row => row.coldReceiptBytes.byteLength < 1 ||
    row.coldReceiptBytes.byteLength > MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1)))
    return yield* readinessFailure("storedState");
  if (protection !== undefined && before !== undefined) yield* authenticateProtectedTargetMetadataSnapshot(
    { ...protection, epoch: before }, tx).pipe(
      Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  const rows = structuredClone({ authority: exactAuthority, deploymentId: authority.deploymentId,
    revisionId, revision, selected, functions, readiness, cold });
  // SAFETY: the inert token is authenticated solely by the issuing repository's private map.
  const capture = Object.freeze({}) as CapturedApplicationReadiness;
  readinessCaptures.set(capture, { issuer: state.issuer, profile, target, rows: Object.freeze({ ...rows, task,
    ...(protection === undefined || before === undefined ? {} : {
      protection: Object.freeze({ ...protection, epoch: before }) }) }) });
  return capture;
});

/** Complete immutable authentication and configured control preparation after target SQL closes. */
export const prepareCapturedApplicationReadiness = Effect.fn(
  "ApplicationReadiness.prepareCapturedRows",
)(function* (repository: ApplicationReadinessRepository<unknown, unknown>, capture: CapturedApplicationReadiness,
  preparationProfile: "full" | "finiteEntry" = "full", originalGenerationProtection?: ApplicationReadinessProtection) {
  const state = readinessRepositoryStates.get(repository);
  const captured = readinessCaptures.get(capture);
  if (state === undefined || captured === undefined || captured.issuer !== state.issuer)
    return yield* readinessFailure("invalidComposition");
  const rows = captured.rows;
  const generationProtection = originalGenerationProtection === undefined ? undefined : snapshotReadinessProtection(originalGenerationProtection);
  if (generationProtection !== undefined && (captured.profile !== "retained" || preparationProfile !== "full" ||
    rows.protection === undefined || !hasLocatedReadCommittedTargetDatabaseV1(captured.target, generationProtection.target.database) ||
    generationProtection.target.database !== generationProtection.control.database ||
    !readinessEpochsEqual(rows.protection.epoch, generationProtection.target.epoch)))
    return yield* readinessFailure("invalidComposition");
  if (rows.revision === undefined) return notReady(rows.revisionId, "revisionMissing");
  const bundle = yield* authenticateStoredBundle(rows.authority,
    { deploymentId: rows.deploymentId, revisionId: rows.revision.revisionId }, rows.revision, rows.selected,
    () => Effect.succeed(rows.functions),
    () => Effect.fromResult(rows.task).pipe(Effect.flatMap(task => task === null
      ? Effect.succeed(null) : authenticateCapturedApplicationTaskCatalogRows(task))));
  if ("status" in bundle) return captured.profile === "request" ? bundle : yield* readinessFailure("storedState");
  const { schema, originalArtifact } = yield* state.context.schema.readPublished({ deploymentId: rows.deploymentId, manifest: bundle.manifest });
  yield* requireSchemaCorrelation(bundle, schema.schemaVersion, schema);
  const controlIdentity = (yield* query(state.context.controlDb.select({
    databaseName: sql<string>`current_database()`,
    namespaceOid: sql<string>`current_schema()::pg_catalog.regnamespace::oid::text`,
  }).from(sql`(values (1)) as readiness_control_identity(value)`).limit(1)))[0];
  if (controlIdentity === undefined) return yield* readinessFailure("invalidComposition");
  if (generationProtection !== undefined && (controlIdentity.databaseName !== generationProtection.control.epoch.databaseName ||
    controlIdentity.namespaceOid !== generationProtection.control.epoch.namespaceOid.toString()))
    return yield* readinessFailure("invalidComposition");
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(state.context.controlDb,
    { deploymentId: rows.deploymentId, schemaVersionId: schema.schemaVersionId });
  if (requirements === null || encodeBytesToLowercaseHex(requirements.manifestSha256) !== schema.schemaManifestSha256 ||
    requirements.definitions.length > MAX_PHYSICAL_DEFINITIONS) return yield* readinessFailure("storedState");
  let uniquePreparation: AppUniqueConstraintSetPreparation | undefined;
  if (preparationProfile === "full") {
    const unique = yield* loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(state.context.pointCommit,
      { deploymentId: rows.deploymentId, scopeId: rows.authority.scopeId, schemaVersionId: schema.schemaVersionId },
      state.context.controlDb, state.context.authority);
    if (unique.status === "not_ready") return captured.profile === "request"
      ? notReady(rows.revisionId, uniqueNotReadyReason(unique.reason), unique.lifecycle)
      : yield* readinessFailure("authorityChanged");
    const uniqueCatalog = yield* preparePointCommitUniqueConstraintSet(state.context.pointCommit,
      { deploymentId: rows.deploymentId, scopeId: rows.authority.scopeId, schemaVersionId: schema.schemaVersionId },
      state.context.controlDb, state.context.authority);
    if (uniqueCatalog.status !== "prepared") return yield* readinessFailure("authorityChanged");
    uniquePreparation = uniqueCatalog.preparation;
  }
  const physicalDefinitionLifecycle = yield* preparePhysicalDefinitionLifecycleReadinessEffect(
    state.context.physicalDefinitionLifecycle, rows.authority.scopeId, requirements);
  const binding = yield* runTransaction(state.context.controlDb,
    tx => readSchemaBinding(tx, bundle, schema.schemaVersion, schema));
  const schemaBindingSha256 = binding.sha256;
  const originalControl = Object.freeze({ database: state.context.controlDb, artifact: originalArtifact,
    schemaAuthority: Object.freeze({ row: binding.originalRow, schemaBindingByteLengthText: binding.schemaBindingByteLengthText }) });
  if (rows.readiness === undefined) return yield* readinessFailure("storedState");
  const cold = yield* authenticateStoredColdEvidence(bundle, state.context.cold, rows.readiness, rows.cold);
  const stored = yield* authenticateStoredReadinessAuthority(bundle, schema.schemaVersion, schema,
    schemaBindingSha256, requirements, physicalDefinitionLifecycle, rows.readiness.physicalReadinessSha256,
    rows.readiness, cold);
  if (captured.profile === "retained") {
    if (generationProtection !== undefined) yield* chargeHostPreparation({
      targetEpoch: generationProtection.target.epoch, controlEpoch: generationProtection.control.epoch,
    }).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
    if (uniquePreparation !== undefined) yield* chargeUniqueConstraintPreparation(uniquePreparation).pipe(
      Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
    yield* chargePhysicalDefinitionPreparation(physicalDefinitionLifecycle).pipe(
      Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
    yield* chargeHostPreparation({ bundle: { ...bundle,
    revision: { ...bundle.revision, registeredAt: bundle.revision.registeredAt.getTime() },
    publication: { ...bundle.publication, publishedAt: bundle.publication.publishedAt.getTime() } },
    schema, requirements: { ...requirements }, cold, schemaBindingSha256,
    originalControl: { artifact: { sizes: { ...originalArtifact.sizes, createdAt: originalArtifact.sizes.createdAt.getTime() },
      payload: originalArtifact.payload === null ? null : { ...originalArtifact.payload, createdAt: originalArtifact.payload.createdAt.getTime() } },
      schemaAuthority: { ...binding.originalRow, createdAt: binding.originalRow.createdAt.getTime(),
        publishedAt: binding.originalRow.publishedAt?.getTime() ?? null, schemaBindingByteLengthText: binding.schemaBindingByteLengthText } },
    readinessBytes: stored.readinessBytes }).pipe(
      Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  }
  const issued = yield* storedReadyProjection(Object.freeze({ ...stored, originalControl, target: captured.target, controlIdentity,
    ...(generationProtection === undefined ? {} : { generationProtection }),
    ...(uniquePreparation === undefined ? {} : { uniquePreparation }),
    ...(preparationProfile === "finiteEntry" ? { preparationProfile: "finiteEntry" as const } : {}),
    ...(rows.protection === undefined ? {} : { protectedMetadata: rows.protection }) }), state.issuer, captured.profile);
  if (issued.status !== "ready") return yield* readinessFailure("storedState");
  const issuedState = issuedReadinessStates.get(issued);
  if (issuedState === undefined) return yield* readinessFailure("storedState");
  return Object.freeze({ readiness: issued, basis: activationBasis(issuedState), schema, originalControl });
});

export interface DerivedFiniteApplicationReadiness {
  readonly readiness: Extract<ApplicationReadinessResult, { readonly status: "ready" }>;
  readonly schema: ApplicationSchemaAuthority;
  readonly originalControl: OriginalApplicationControlRead;
}

/** A finite capability derives from the original complete cold issuer in its
 * same construction allocation. It cannot turn a partial or foreign capture
 * into paired readiness, and does not recapture SQL or canonical evidence. */
export const deriveFiniteApplicationReadiness = Effect.fnUntraced(function* (repository: unknown,
  issued: ApplicationReadinessResult, originalProtection?: ApplicationReadinessProtection): Effect.fn.Return<
    DerivedFiniteApplicationReadiness, ApplicationReadinessError> {
  const owner = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
  const state = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
  const lifetime = yield* captureHostPreparationLifetime();
  if (owner === undefined || state?.kind !== "stored" || state.issuer !== owner.issuer ||
    state.stored.preparationProfile !== undefined || state.stored.originalControl === undefined ||
    lifetime === undefined || state.lifetime === undefined || lifetime.checkOpen !== state.lifetime.checkOpen)
    return yield* readinessFailure("invalidComposition");
  yield* Effect.fromResult(state.lifetime.checkOpen()).pipe(
    Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  const retained = state.stored.generationProtection;
  if (originalProtection === undefined ? retained !== undefined :
    retained === undefined || !readinessProtectionMatches(retained, originalProtection))
    return yield* readinessFailure("invalidComposition");
  const readiness = yield* storedReadyProjection(Object.freeze({ ...state.stored, preparationProfile: "finiteEntry" }), state.issuer);
  if (readiness.status !== "ready") return yield* readinessFailure("storedState");
  return Object.freeze({ readiness, schema: state.stored.schema, originalControl: state.stored.originalControl });
}, work => observeExecution("ApplicationReadiness.deriveFinite", work));

/** Only the exact readiness issuer can expose its already bracketed immutable
 * target proof to connected internal preparation owners. */
export function readApplicationReadinessTargetProtection(repository: unknown, issued: ApplicationReadinessResult) {
  const state = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
  const ready = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
  return state !== undefined && ready?.kind === "stored" && ready.issuer === state.issuer
    ? ready.stored.protectedMetadata : undefined;
}

/** The compatibility capture owner borrows the exact readiness issuer's
 * existing authority ports; caller-authored placement cannot issue them. */
export function readApplicationReadinessCapturePorts(repository: unknown, issued: ApplicationReadinessResult):
  Result.Result<Pick<ApplicationReadinessContext<unknown, unknown>, "authority" | "controlDb">, ApplicationReadinessError> {
  const state = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
  const ready = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
  return state === undefined || ready === undefined || ready.issuer !== state.issuer
    ? Result.fail(readinessFailureValue("invalidComposition")) : Result.succeed(Object.freeze({ authority: state.context.authority, controlDb: state.context.controlDb }));
}

/** Immutable closed membership from the exact retained readiness issuer. */
export const readApplicationMetadataUniqueRequirements = Effect.fn("ApplicationReadiness.readMetadataUniqueRequirements")(
  function* (repository: unknown, issued: ApplicationReadinessResult, schemaVersionId: CatalogSchemaVersionId) {
    const state = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
    const ready = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
    if (state === undefined || ready === undefined || ready.issuer !== state.issuer)
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    const retained = ready.kind === "prepared" ? ready.prepared : ready.stored;
    if (retained.requirements.schemaVersionId !== schemaVersionId)
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    return yield* readUniqueMaintenanceRequirements(state.context.controlDb, retained.bundle.deploymentId, schemaVersionId);
  },
);

export const readApplicationActivationUniqueRequirements = Effect.fn("ApplicationReadiness.readActivationUniqueRequirements")(
  function* (repository: unknown, issued: ApplicationReadinessResult, schemaVersionId: string,
    target: LocatedReadCommittedAttemptTargetV1, tx: AppRowTransaction) {
    const state = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
    const ready = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
    if (state === undefined || ready === undefined || ready.issuer !== state.issuer) {
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    }
    const bundle = ready.kind === "prepared" ? ready.prepared.bundle : ready.stored.bundle;
    const db = state.context.controlDb;
    return yield* readUniqueMaintenanceRequirements(db, bundle.deploymentId, schemaVersionId,
      hasLocatedReadCommittedTargetDatabaseV1(target, db) ? tx : undefined);
  },
);

export function makeApplicationReadinessRepository<SchemaFailure, ColdFailure>(
  context: ApplicationReadinessContext<SchemaFailure, ColdFailure>,
): ApplicationReadinessRepository<SchemaFailure, ColdFailure> {
  const capturedContext = Object.freeze({
    controlDb: context.controlDb,
    ...(context.protectedMetadata === undefined ? {} : { protectedMetadata: context.protectedMetadata }),
    authority: context.authority,
    schema: context.schema,
    taskCatalog: context.taskCatalog,
    candidateValidation: context.candidateValidation,
    pointCommit: context.pointCommit,
    physicalDefinitionLifecycle: context.physicalDefinitionLifecycle,
    cold: context.cold,
  });
  // SAFETY: the issuer is an internal identity token; only this module
  // mints it, and WeakMap membership, not the brand property, carries proof.
  const issuer = Object.freeze(
    {},
  ) as ApplicationReadinessRepositoryIssuerV1;
  const compositionIsExact = () =>
    hasAppSchemaCandidateReadinessComposition(
      capturedContext.candidateValidation,
      capturedContext.controlDb,
      capturedContext.authority,
    ) && hasApplicationSchemaAuthorityComposition(
      capturedContext.schema,
      capturedContext.controlDb,
    ) && isApplicationTaskCatalogSnapshotPort(capturedContext.taskCatalog) &&
    hasPhysicalDefinitionLifecycleComposition(
      capturedContext.physicalDefinitionLifecycle,
      capturedContext.controlDb,
      capturedContext.authority,
    );
  const settle = Effect.fn("ApplicationReadiness.settle")(
    function* (input: {
      readonly deploymentId: string;
      readonly scopeId: TrustedScopeAuthority["scopeId"];
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationReadinessResult,
      SettleApplicationReadinessError<SchemaFailure, ColdFailure>
    > {
      if (!validIdentity(input.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* readinessFailure("invalidInput");
      }
      if (!compositionIsExact()) {
        return yield* readinessFailure("invalidComposition");
      }
      const captured = Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        capturedContext.authority,
      );
      if (located.authority.storageGeneration !== "flarexdb_v1") {
        return yield* readinessFailure("authorityChanged");
      }
      const authority: ApplicationReadinessAuthority = Object.freeze({
        ...located.authority,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      });
      const reserved = yield* runLocatedTransaction(
        located.target,
        tx => reserveBundle(
          tx,
          authority,
          captured,
          capturedContext.taskCatalog,
        ),
      );
      if ("status" in reserved) return reserved;
      const schema = yield* capturedContext.schema.publish({
        deploymentId: reserved.deploymentId,
        manifest: reserved.manifest,
      });
      const schemaVersion = schema.schemaVersion;
      yield* requireSchemaCorrelation(reserved, schemaVersion, schema);
      const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
        capturedContext.controlDb,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          schemaVersionId: schema.schemaVersionId,
        }),
      );
      if (requirements === null ||
        encodeBytesToLowercaseHex(requirements.manifestSha256) !==
          schema.schemaManifestSha256) {
        return yield* readinessFailure("storedState");
      }
      if (requirements.definitions.length > MAX_PHYSICAL_DEFINITIONS) {
        return yield* readinessFailure("storedState");
      }
      const schemaBindingSha256 = yield* runTransaction(
        capturedContext.controlDb,
        tx => publishSchemaBinding(tx, reserved, schemaVersion, schema),
      );
      const candidateValidation = yield* loadAppSchemaCandidateReadinessEffect(
        capturedContext.candidateValidation,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          scopeId: reserved.authority.scopeId,
          schemaVersionId: schema.schemaVersionId,
          schemaManifestSha256Hex:
            appSchemaCandidateManifestSha256HexV1FromBytes(
              requirements.manifestSha256,
            ),
        }),
      );
      if (candidateValidation.status !== "ready") {
        return notReady(
          reserved.revision.revisionId,
          candidateNotReadyReason(candidateValidation.reason),
        );
      }
      const uniqueConstraintEligibility = yield*
        loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
          capturedContext.pointCommit,
          Object.freeze({
            deploymentId: reserved.deploymentId,
            scopeId: reserved.authority.scopeId,
            schemaVersionId: schema.schemaVersionId,
          }),
          capturedContext.controlDb,
          capturedContext.authority,
        );
      if (uniqueConstraintEligibility.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          uniqueNotReadyReason(uniqueConstraintEligibility.reason),
          uniqueConstraintEligibility.lifecycle,
        );
      }
      // Unique-set closure must be observed first: once closed, its member set is
      // immutable, so lifecycle preparation cannot omit a concurrently published
      // required unique definition that the eligibility evidence admits.
      const physicalDefinitionLifecycle = yield*
        preparePhysicalDefinitionLifecycleReadinessEffect(
          capturedContext.physicalDefinitionLifecycle,
          reserved.authority.scopeId,
          requirements,
        );
      const preliminaryPhysical = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          const clock = yield* lockScopeClockForShareInTransactionEffect(
            tx,
            reserved.authority.scopeId,
          );
          return yield* loadPhysicalReadiness(
            tx,
            reserved.authority,
            requirements,
            capturedContext.physicalDefinitionLifecycle,
            physicalDefinitionLifecycle,
            clock,
          );
        }),
      );
      if (preliminaryPhysical.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          preliminaryPhysical.reason,
          preliminaryPhysical.detail,
        );
      }
      const storedColdEvidence = yield* runLocatedTransaction(
        located.target,
        tx => loadStoredColdEvidence(tx, reserved, capturedContext.cold),
      );
      const coldEvidence = storedColdEvidence ??
        (yield* materializeFunctions(reserved, capturedContext.cold));
      const cold = coldEvidence.entries;
      const coldReceiptSetSha256 = yield* digestColdReceiptSet(coldEvidence);
      const uniqueConstraintEligibilitySha256 = yield* digestCanonicalJson(
        appUniqueConstraintEligibilityFrame(uniqueConstraintEligibility),
      );
      return yield* runLocatedTransaction(
        located.target,
        tx => settleReadiness(tx, {
          bundle: reserved,
          schemaVersion,
          schema,
          schemaBindingSha256,
          cold,
          runtimeHostIdentity: coldEvidence.runtimeHostIdentity,
          compatibilityDate: coldEvidence.compatibilityDate,
          coldReceiptSetSha256,
          requirements,
          candidateValidation: candidateValidation.evidence,
          uniqueConstraintEligibility,
          uniqueConstraintEligibilitySha256,
          physicalDefinitionLifecycle,
        }, capturedContext, issuer),
      );
    },
  );
  const readReadyOperation = Effect.fn("ApplicationReadiness.readReady")(
    function* (input: {
      readonly deploymentId: string;
      readonly scopeId: TrustedScopeAuthority["scopeId"];
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationReadinessResult,
      ReadApplicationReadinessError
    > {
      if (!validIdentity(input.deploymentId) || !validIdentity(input.revisionId)) {
        return yield* readinessFailure("invalidInput");
      }
      if (!compositionIsExact()) {
        return yield* readinessFailure("invalidComposition");
      }
      const captured = Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        captured,
        capturedContext.authority,
      );
      if (located.authority.storageGeneration !== "flarexdb_v1") {
        return yield* readinessFailure("authorityChanged");
      }
      const authority: ApplicationReadinessAuthority = Object.freeze({
        ...located.authority,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      });
      const protection = capturedContext.protectedMetadata;
      if (protection !== undefined &&
        !hasLocatedReadCommittedTargetDatabaseV1(located.target, protection.database))
        return yield* readinessFailure("invalidComposition");
      const protectedTarget = protection !== undefined &&
        hasLocatedReadCommittedTargetDatabaseV1(located.target, protection.database) ? protection : undefined;
      const first = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          if (protectedTarget !== undefined) yield* acquireProtectedMetadataInstallationAdmission(
            protectedTarget.token, protectedTarget.database, tx,
          ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const epoch = protectedTarget === undefined ? undefined :
            yield* captureProtectedMetadataEpoch(protectedTarget.token, protectedTarget.database, tx)
              .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const reserved = yield* reserveBundle(tx, authority, captured, capturedContext.taskCatalog, "share");
          return { reserved, epoch };
        }),
      );
      const { reserved } = first;
      if ("status" in reserved) return reserved;
      const { schema } = yield* capturedContext.schema.readPublished({
        deploymentId: reserved.deploymentId,
        manifest: reserved.manifest,
      });
      const schemaVersion = schema.schemaVersion;
      yield* requireSchemaCorrelation(reserved, schemaVersion, schema);
      const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
        capturedContext.controlDb,
        Object.freeze({
          deploymentId: reserved.deploymentId,
          schemaVersionId: schema.schemaVersionId,
        }),
      );
      if (requirements === null ||
        encodeBytesToLowercaseHex(requirements.manifestSha256) !==
          schema.schemaManifestSha256 ||
        requirements.definitions.length > MAX_PHYSICAL_DEFINITIONS) {
        return yield* readinessFailure("storedState");
      }
      const uniqueConstraintEligibility = yield*
        loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
          capturedContext.pointCommit,
          Object.freeze({
            deploymentId: reserved.deploymentId,
            scopeId: reserved.authority.scopeId,
            schemaVersionId: schema.schemaVersionId,
          }),
          capturedContext.controlDb,
          capturedContext.authority,
        );
      if (uniqueConstraintEligibility.status === "not_ready") {
        return notReady(
          reserved.revision.revisionId,
          uniqueNotReadyReason(uniqueConstraintEligibility.reason),
          uniqueConstraintEligibility.lifecycle,
        );
      }
      const physicalDefinitionLifecycle = yield*
        preparePhysicalDefinitionLifecycleReadinessEffect(
          capturedContext.physicalDefinitionLifecycle,
          reserved.authority.scopeId,
          requirements,
        );
      const schemaBindingSha256 = yield* runTransaction(
        capturedContext.controlDb,
        tx => readSchemaBinding(tx, reserved, schemaVersion, schema),
      ).pipe(Effect.map(binding => binding.sha256));
      const second = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          if (protectedTarget !== undefined) yield* acquireProtectedMetadataInstallationAdmission(
            protectedTarget.token, protectedTarget.database, tx,
          ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
            tx,
            reserved.authority.scopeId,
          );
          const physical = yield* loadPhysicalReadiness(
            tx,
            reserved.authority,
            requirements,
            capturedContext.physicalDefinitionLifecycle,
            physicalDefinitionLifecycle,
            clock,
          );
          if (physical.status === "not_ready") return { stored: physical };
          const storedAuthority = yield* loadStoredReadinessAuthority(
            tx,
            reserved,
            schemaVersion,
            schema,
            schemaBindingSha256,
            requirements,
            physicalDefinitionLifecycle,
            physical.physicalReadinessSha256,
            capturedContext.cold,
            // Reuse this provisional read's clock. Reacquiring FOR SHARE would
            // serialize fresh selection behind an ordinary data publication.
            clock,
          );
          if (storedAuthority === null) return yield* readinessFailure("storedState");
          const epoch = protectedTarget === undefined ? undefined :
            yield* captureProtectedMetadataEpoch(protectedTarget.token, protectedTarget.database, tx)
              .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
          return { stored: storedAuthority, epoch };
        }),
      );
      const { stored } = second;
      if (first.epoch !== undefined && second.epoch !== undefined &&
        first.epoch.generation !== second.epoch.generation)
        return yield* readinessFailure("authorityChanged");
      return "status" in stored
        ? notReady(
            reserved.revision.revisionId,
            stored.reason,
            stored.detail,
          )
        : yield* storedReadyProjection(second.epoch === undefined || protectedTarget === undefined ? stored :
          Object.freeze({ ...stored, protectedMetadata: Object.freeze({ database: protectedTarget.database,
            token: protectedTarget.token, epoch: second.epoch }) }), issuer);
    },
  );
  const readReady: ApplicationReadinessRepository<
    SchemaFailure,
    ColdFailure
  >["readReady"] = input => readReadyOperation(input).pipe(
    Effect.mapError(error => error instanceof ApplicationReadinessError
      ? readinessFailureForOperationValue("readReady", error)
      : error),
  );
  const repository = Object.freeze({ settle, readReady });
  readinessRepositoryStates.set(repository, Object.freeze({
    // SAFETY: the captured context is erased to unknown at this internal
    // state boundary; the generic parameters are recovered by the typed
    // settle/readReady wrappers above.
    context: capturedContext as ApplicationReadinessContext<unknown, unknown>,
    issuer,
  }));
  return repository;
}

export function hasApplicationReadinessComposition(
  repository: unknown,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  return typeof repository === "object" && repository !== null &&
    readinessRepositoryStates.get(repository)?.context.authority === authority;
}

export function hasApplicationReadinessPlanningComposition(
  repository: unknown,
  controlDb: FlarexMetadataDatabase,
  schema: ApplicationSchemaAuthorityPublisher<unknown>,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  if (typeof repository !== "object" || repository === null) return false;
  const context = readinessRepositoryStates.get(repository)?.context;
  return context !== undefined && context.controlDb === controlDb &&
    context.schema === schema && context.authority === authority &&
    hasPhysicalDefinitionLifecycleComposition(
      context.physicalDefinitionLifecycle,
      controlDb,
      authority,
    );
}

export const validateApplicationReadinessForActivationInTransaction =
  Effect.fn("ApplicationReadiness.validateForActivationInTransaction")(
    function* (
      repository: unknown,
      issued: ApplicationReadinessResult,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
      activationPreparation?: PreparedApplicationReadinessActivation,
    ): Effect.fn.Return<
      ApplicationReadinessActivationValidation,
      | ApplicationReadinessError
      | ApplicationTaskCatalogSnapshotError
      | ValidateAppSchemaCandidateReadinessError
      | ValidatePointCommitUniqueConstraintEligibilityV1Error
      | ValidatePhysicalDefinitionLifecycleReadinessError
      | LockScopeClockForShareError
      | LockScopeClockForUpdateError
    > {
      if (typeof repository !== "object" || repository === null ||
        issued.status !== "ready") {
        return yield* readinessFailure("invalidComposition");
      }
      const repositoryState = readinessRepositoryStates.get(repository);
      const issuedState = issuedReadinessStates.get(issued);
      if (repositoryState === undefined || issuedState === undefined ||
        issuedState.kind !== "prepared" ||
        issuedState.issuer !== repositoryState.issuer ||
        issuedState.prepared.bundle.authority.scopeId !== currentClock.scopeId) {
        return yield* readinessFailure("invalidComposition");
      }
      if (activationPreparation !== undefined) {
        const activation = readinessActivationViews.get(activationPreparation);
        if (activation === undefined || activation.owner !== repositoryState || activation.issued !== issued ||
          (activation.target.installed !== undefined && !isManagedInstallationTransaction(tx,
            activation.target.installed.database, activation.target.installed.installation)))
          return yield* readinessFailure("invalidComposition");
      }
      const replay = yield* settleReadiness(
        tx,
        issuedState.prepared,
        repositoryState.context,
        repositoryState.issuer,
        "validate",
      );
      if (replay.status !== "ready") return replay;
      const replayState = issuedReadinessStates.get(replay);
      if (replayState === undefined ||
        !bytesEqualFullScan(
          replayState.readinessSha256,
          issuedState.readinessSha256,
        ) || !bytesEqualFullScan(
          replayState.readinessBytes,
          issuedState.readinessBytes,
        )) return yield* readinessFailure("authorityChanged");
      return Object.freeze({
        status: "ready",
        basis: activationBasis(issuedState),
      });
    },
  );

type StoredApplicationReadinessValidationError = ApplicationReadinessError |
  ApplicationTaskCatalogSnapshotError | ValidatePhysicalDefinitionLifecycleReadinessError |
  LockScopeClockForShareError | Effect.Error<ReturnType<typeof preparePointCommitUniqueConstraintSet>> |
  Effect.Error<ReturnType<typeof acceptPreparedPointCommitUniqueConstraintSet>> |
  Effect.Error<ReturnType<typeof lendPreparedAppUniqueConstraintDefinitions>> |
  Effect.Error<ReturnType<typeof loadPublishedPhysicalRequirementSnapshotV1>>;

export const validateStoredApplicationReadinessForActivationInTransaction =
  Effect.fn("ApplicationReadiness.validateStoredForActivationInTransaction")(
    function* (
      repository: unknown,
      issued: ApplicationReadinessResult,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
      checkedActive?: CheckedApplicationActiveHead,
      pairedProtection?: ApplicationReadinessProtection,
    ): Effect.fn.Return<
      StoredApplicationReadinessActivationValidation,
      StoredApplicationReadinessValidationError
    > {
      if (typeof repository !== "object" || repository === null ||
        issued.status !== "ready") {
        return yield* readinessFailure("invalidComposition");
      }
      const repositoryState = readinessRepositoryStates.get(repository);
      const issuedState = issuedReadinessStates.get(issued);
      if (repositoryState === undefined || issuedState === undefined ||
        issuedState.kind !== "stored" ||
        issuedState.stored.preparationProfile === "finiteEntry" ||
        issuedState.issuer !== repositoryState.issuer ||
        issuedState.stored.bundle.authority.scopeId !== currentClock.scopeId) {
        return yield* readinessFailure("invalidComposition");
      }
      return yield* validateStoredIssuedReadiness(
        repositoryState,
        issuedState,
        tx,
        currentClock,
        checkedActive,
        undefined,
        pairedProtection,
      );
    },
  );

/** Finite entry authenticates immutable publication under fresh head and scope
 * authority; demanded reads and final touched maintenance own build coverage. */
export const validateFiniteApplicationReadinessInTransaction = Effect.fn("ApplicationReadiness.validateFiniteEntry")(
  function* (repository: unknown, issued: ApplicationReadinessResult, tx: AppRowTransaction,
    currentClock: ScopeClockRecord, checkedActive?: CheckedApplicationActiveHead) {
    const owner = typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
    const state = issued.status === "ready" ? issuedReadinessStates.get(issued) : undefined;
    if (owner === undefined || state?.kind !== "stored" || state.issuer !== owner.issuer ||
      state.stored.preparationProfile !== "finiteEntry" || state.stored.bundle.authority.scopeId !== currentClock.scopeId)
      return yield* readinessFailure("invalidComposition");
    yield* requireExactAuthority(state.stored.bundle.authority, currentClock);
    return yield* validateStoredIssuedReadiness(owner, state, tx, currentClock, checkedActive);
  },
);

/** Only the Application request owner calls this after its live head/activation
 * read. The original issuer's canonical projection stays inside this callback;
 * all physical checks are fresh and successful work must pass the final guard. */
export const withStoredApplicationReadinessForBindingInTransaction = Effect.fnUntraced(function* <Value, Failure, Requirements>(
  repository: unknown, issued: ApplicationReadinessResult, tx: AppRowTransaction,
  currentClock: ScopeClockRecord, checkedActive: CheckedApplicationActiveHead | undefined,
  work: (validated: StoredApplicationReadinessActivationValidation) => Effect.Effect<Value, Failure, Requirements>,
  pairedProtection?: ApplicationReadinessProtection,
) {
  if (typeof repository !== "object" || repository === null || issued.status !== "ready")
    return yield* readinessFailure("invalidComposition");
  const repositoryState = readinessRepositoryStates.get(repository);
  const issuedState = issuedReadinessStates.get(issued);
  if (repositoryState === undefined || issuedState === undefined || issuedState.kind !== "stored" ||
    issuedState.stored.preparationProfile === "finiteEntry" ||
    issuedState.issuer !== repositoryState.issuer || issuedState.stored.bundle.authority.scopeId !== currentClock.scopeId)
    return yield* readinessFailure("invalidComposition");
  const protection = issuedState.stored.protectedMetadata;
  const deferredGuard = hasProtectedMetadataFinalGuardScope(tx);
  if (protection !== undefined) yield* authenticateProtectedTargetMetadataSnapshot(protection, tx).pipe(
    Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  if (protection !== undefined && deferredGuard) yield* registerProtectedMetadataFinalGuard(
    tx, protection.token, protection.database, protection.epoch,
  ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  const validated = yield* validateStoredIssuedReadiness(repositoryState, issuedState, tx, currentClock,
    checkedActive, protection, pairedProtection);
  const value = yield* Effect.suspend(() => work(validated));
  // This remains the last metadata acquisition. Body failures, defects and
  // interruption bypass this success tail and retain the owning rollback Cause.
  // A genuine installed relational entry owns the existing transaction guard
  // scope and flushes it after all business work. Other callers keep this tail.
  if (protection !== undefined && !deferredGuard) yield* guardProtectedMetadataEpoch(
    protection.token, protection.database, protection.epoch, tx,
  ).pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  return value;
}, work => observeExecution("ApplicationReadiness.withStoredForBindingInTransaction", work));

const validateStoredIssuedReadiness = Effect.fnUntraced(function* (
  repositoryState: ApplicationReadinessIssuerState,
  issuedState: StoredIssuedApplicationReadinessState,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
  requestProjection?: StoredReadinessAuthority["protectedMetadata"],
  pairedProtection?: ApplicationReadinessProtection,
): Effect.fn.Return<
  StoredApplicationReadinessActivationValidation,
  StoredApplicationReadinessValidationError
> {
  const protection = issuedState.stored.protectedMetadata;
  if (requestProjection !== undefined && requestProjection !== protection)
    return yield* readinessFailure("invalidComposition");
  if (pairedProtection !== undefined) {
    const expected = issuedState.stored.controlIdentity;
    const original = issuedState.stored.generationProtection;
    if (issuedState.stored.target === undefined ||
      !hasLocatedReadCommittedTargetDatabaseV1(issuedState.stored.target, pairedProtection.target.database) ||
      expected === undefined || expected.databaseName !== pairedProtection.control.epoch.databaseName ||
      expected.namespaceOid !== pairedProtection.control.epoch.namespaceOid.toString() ||
      original === undefined || !readinessProtectionMatches(original, pairedProtection))
      return yield* readinessFailure("invalidComposition");
    yield* Effect.fromResult(authenticateProtectedReadinessMetadataPair(tx, original.target, original.control)).pipe(Effect.mapError(cause =>
      readinessFailureValue(cause.reason === "changed" ? "authorityChanged" : "invalidComposition", false, cause)));
  }
  let currentBundle: StoredBundle;
  let freshCatalog: Readonly<{ schema: ApplicationSchemaAuthority; reader: AppRowTransaction | FlarexMetadataDatabase }> | undefined;
  const useProtectedProjection = (pairedProtection !== undefined || issuedState.stored.preparationProfile === "finiteEntry") &&
    (requestProjection !== undefined || (protection !== undefined && hasProtectedMetadataFinalGuardScope(tx)));
  if (useProtectedProjection) {
    if (requestProjection === undefined && protection !== undefined)
      yield* registerProtectedMetadataFinalGuard(tx, protection.token, protection.database, protection.epoch)
        .pipe(Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
    currentBundle = issuedState.stored.bundle;
  } else {
    const loaded = yield* reserveBundle(
      tx,
      issuedState.stored.bundle.authority,
      Object.freeze({
        deploymentId: issuedState.stored.bundle.deploymentId,
        revisionId: issuedState.stored.bundle.revision.revisionId,
      }),
      repositoryState.context.taskCatalog,
      "share",
      clock,
    );
    if ("status" in loaded || !storedBundlesEqual(loaded, issuedState.stored.bundle))
      return yield* readinessFailure("authorityChanged");
    currentBundle = loaded;
    freshCatalog = yield* validateStoredReadinessControlCatalog(repositoryState, issuedState.stored, currentBundle, tx);
  }
  if (issuedState.stored.preparationProfile !== "finiteEntry") {
    const preparedUnique = !useProtectedProjection || issuedState.stored.uniquePreparation === undefined
      ? yield* preparePointCommitUniqueConstraintSet(repositoryState.context.pointCommit,
          { deploymentId: currentBundle.deploymentId, scopeId: currentBundle.authority.scopeId,
            schemaVersionId: issuedState.stored.schema.schemaVersionId },
          repositoryState.context.controlDb, repositoryState.context.authority)
      : { status: "prepared" as const, preparation: issuedState.stored.uniquePreparation };
    if (preparedUnique.status !== "prepared") return yield* readinessFailure("authorityChanged");
    if (!useProtectedProjection && issuedState.stored.uniquePreparation !== undefined) {
      const original = yield* lendPreparedAppUniqueConstraintDefinitions(issuedState.stored.uniquePreparation, repositoryState.context.controlDb);
      const current = yield* lendPreparedAppUniqueConstraintDefinitions(preparedUnique.preparation, repositoryState.context.controlDb);
      if (current.length !== original.length || current.some((definition, index) => {
        const expected = original[index];
        return expected === undefined || definition.deploymentId !== expected.deploymentId ||
          definition.uniqueConstraintDefinitionId !== expected.uniqueConstraintDefinitionId ||
          definition.logicalUniqueConstraintId !== expected.logicalUniqueConstraintId || definition.tableId !== expected.tableId ||
          definition.physicalSpecCodecVersion !== expected.physicalSpecCodecVersion ||
          definition.physicalSpecBytesHex !== expected.physicalSpecBytesHex || definition.physicalSpecSha256Hex !== expected.physicalSpecSha256Hex;
      })) return yield* readinessFailure("authorityChanged");
    }
    const unique = yield* acceptPreparedPointCommitUniqueConstraintSet(repositoryState.context.pointCommit,
      preparedUnique.preparation, tx, currentBundle.authority, clock);
    if (unique.status === "not_ready") return yield* readinessFailure("authorityChanged");
  }
  if (freshCatalog !== undefined) {
    yield* validatePhysicalDefinitionLifecycleReadinessCatalogEffect(repositoryState.context.physicalDefinitionLifecycle,
      issuedState.stored.physicalDefinitionLifecycle, tx);
    const binding = yield* readSchemaBinding(freshCatalog.reader, currentBundle, issuedState.stored.schemaVersion, freshCatalog.schema);
    if (!bytesEqualFullScan(binding.sha256, issuedState.stored.schemaBindingSha256)) return yield* readinessFailure("schemaBinding");
  }
  if (issuedState.stored.preparationProfile === "finiteEntry") {
    if (repositoryState.context.cold.runtimeHostIdentity !== issuedState.stored.cold.runtimeHostIdentity ||
      repositoryState.context.cold.compatibilityDate !== issuedState.stored.cold.compatibilityDate)
      return yield* readinessFailure("authorityChanged");
    if (!useProtectedProjection) {
      const replay = yield* loadStoredReadinessAuthority(tx, currentBundle, issuedState.stored.schemaVersion,
        issuedState.stored.schema, issuedState.stored.schemaBindingSha256, issuedState.stored.requirements,
        issuedState.stored.physicalDefinitionLifecycle, issuedState.stored.physicalReadinessSha256,
        repositoryState.context.cold, clock);
      if (replay === null || !bytesEqualFullScan(replay.readinessSha256, issuedState.readinessSha256) ||
        !bytesEqualFullScan(replay.readinessBytes, issuedState.readinessBytes)) return yield* readinessFailure("authorityChanged");
    }
    return Object.freeze({ status: "ready" as const, basis: activationBasis(issuedState) });
  }
  const physical = yield* loadPhysicalReadiness(
    tx,
    currentBundle.authority,
    issuedState.stored.requirements,
    repositoryState.context.physicalDefinitionLifecycle,
    issuedState.stored.physicalDefinitionLifecycle,
    clock,
    checkedActive,
  );
  if (physical.status === "not_ready") {
    return yield* readinessFailure("authorityChanged");
  }
  if (useProtectedProjection) {
    if (repositoryState.context.cold.runtimeHostIdentity !== issuedState.stored.cold.runtimeHostIdentity ||
      repositoryState.context.cold.compatibilityDate !== issuedState.stored.cold.compatibilityDate ||
      !bytesEqualFullScan(physical.physicalReadinessSha256, issuedState.stored.physicalReadinessSha256))
      return yield* readinessFailure("authorityChanged");
    return Object.freeze({ status: "ready", basis: activationBasis(issuedState) });
  }
  const replay = yield* loadStoredReadinessAuthority(
    tx,
    currentBundle,
    issuedState.stored.schemaVersion,
    issuedState.stored.schema,
    issuedState.stored.schemaBindingSha256,
    issuedState.stored.requirements,
    issuedState.stored.physicalDefinitionLifecycle,
    physical.physicalReadinessSha256,
    repositoryState.context.cold,
    clock,
  );
  if (replay === null ||
    !bytesEqualFullScan(
      replay.readinessSha256,
      issuedState.readinessSha256,
    ) || !bytesEqualFullScan(
      replay.readinessBytes,
      issuedState.readinessBytes,
    )) return yield* readinessFailure("authorityChanged");
  return Object.freeze({
    status: "ready",
    basis: activationBasis(issuedState),
  });
}, work => observeExecution("ApplicationReadiness.validateStoredIssuedReadiness", work));

/** Retention never replaces an unprotected catalog proof. Reuse the original
 * catalog owners and the actual accepting client for colocated metadata; a
 * separate control catalog keeps its established bounded reader. */
const validateStoredReadinessControlCatalog = Effect.fnUntraced(function* (
  repository: ApplicationReadinessIssuerState, stored: StoredReadinessAuthority,
  bundle: StoredBundle, tx: AppRowTransaction,
) {
  const control = repository.context.controlDb;
  const catalog = stored.target !== undefined && hasLocatedReadCommittedTargetDatabaseV1(stored.target, control) ? tx : undefined;
  const { schema } = yield* repository.context.schema.readPublished({
    deploymentId: bundle.deploymentId, manifest: bundle.manifest,
  }, catalog).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
    error => readinessFailureValue("schemaBinding", false, error)))));
  yield* requireSchemaCorrelation(bundle, stored.schemaVersion, schema);
  if (!bytesEqualFullScan(applicationSchemaBindingBytes(schema), applicationSchemaBindingBytes(stored.schema)))
    return yield* readinessFailure("schemaBinding");
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(control,
    { deploymentId: bundle.deploymentId, schemaVersionId: schema.schemaVersionId }, catalog);
  if (requirements === null || !bytesEqualFullScan(requirements.manifestSha256, stored.requirements.manifestSha256) ||
    requirements.definitions.length !== stored.requirements.definitions.length ||
    requirements.definitions.some((definition, index) => {
      const expected = stored.requirements.definitions[index];
      return expected === undefined || definition.tableId !== expected.tableId ||
        !publishedPhysicalDefinitionMatchesLocated(expected, definition);
    })) return yield* readinessFailure("authorityChanged");
  return Object.freeze({ schema, reader: catalog ?? control });
});

const reserveBundle = Effect.fn("ApplicationReadiness.reserveBundle")(
function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  },
  taskCatalog: ApplicationTaskCatalogSnapshotPort,
  rowLock: "share" | "update" = "update",
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<StoredBundle | Extract<ApplicationReadinessResult, {
  readonly status: "not_ready";
}>, ApplicationReadinessError | ApplicationTaskCatalogSnapshotError |
  LockScopeClockForShareError> {
    const clock = lockedClock ?? (yield* (rowLock === "share"
      ? lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId)
      : lockScopeClockForShareInTransactionEffect(tx, authority.scopeId)));
    yield* requireExactAuthority(authority, clock);
    const revisionRows = yield* query(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId, input.revisionId),
      )).limit(1).for(rowLock),
    );
    const revision = revisionRows[0];
    if (revision === undefined) {
      return notReady(input.revisionId, "revisionMissing");
    }
    const selectedRows = yield* query(
      tx.select({
        candidate: fxSystemApplicationCandidatesV1,
        analysis: fxSystemApplicationAnalysesV1,
        publication: fxSystemApplicationPublicationsV1,
      }).from(fxSystemApplicationRevisionsV2)
        .leftJoin(fxSystemApplicationCandidatesV1, and(
          eq(fxSystemApplicationCandidatesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationCandidatesV1.candidateId, fxSystemApplicationRevisionsV2.candidateId),
        ))
        .leftJoin(fxSystemApplicationAnalysesV1, and(
          eq(fxSystemApplicationAnalysesV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationAnalysesV1.analysisId, fxSystemApplicationRevisionsV2.analysisId),
        ))
        .leftJoin(fxSystemApplicationPublicationsV1, and(
          eq(fxSystemApplicationPublicationsV1.scopeId, fxSystemApplicationRevisionsV2.scopeId),
          eq(fxSystemApplicationPublicationsV1.revisionId, fxSystemApplicationRevisionsV2.revisionId),
        ))
        .where(and(
          eq(fxSystemApplicationRevisionsV2.scopeId, revision.scopeId),
          eq(fxSystemApplicationRevisionsV2.revisionId, revision.revisionId),
        )).limit(1),
    );
    return yield* authenticateStoredBundle(authority, input, revision, selectedRows[0],
      count => query(tx.select().from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationFunctionsV1.revisionId, revision.revisionId),
      )).limit(count + 1)),
      () => taskCatalog.loadInTransaction(tx, authority, revision.revisionId));
  },
);

interface CapturedBundleSelection {
  readonly candidate: typeof fxSystemApplicationCandidatesV1.$inferSelect | null;
  readonly analysis: typeof fxSystemApplicationAnalysesV1.$inferSelect | null;
  readonly publication: typeof fxSystemApplicationPublicationsV1.$inferSelect | null;
}

/** Authentication is reused by retained readers and SQL-closed finite preparation. */
const authenticateStoredBundle = Effect.fn('ApplicationReadiness.authenticateBundle')(
function* (
  authority: ApplicationReadinessAuthority,
  input: { readonly deploymentId: string; readonly revisionId: string },
  revision: typeof fxSystemApplicationRevisionsV2.$inferSelect,
  selected: CapturedBundleSelection | undefined,
  readFunctions: (count: number) => Effect.Effect<ReadonlyArray<typeof fxSystemApplicationFunctionsV1.$inferSelect>, ApplicationReadinessError>,
  readTask: () => Effect.Effect<ApplicationTaskCatalogSnapshot | null, ApplicationTaskCatalogSnapshotError>,
) {
    const candidate = selected?.candidate;
    if (candidate === undefined || candidate === null ||
      candidate.storageGeneration !== authority.storageGeneration ||
      candidate.storageGenerationFence !== authority.storageGenerationFence ||
      candidate.epoch !== authority.epoch ||
      !bytesEqualFullScan(
        candidate.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )) return yield* readinessFailure("authorityChanged");
    const analysis = selected?.analysis;
    if (analysis === undefined || analysis === null ||
      analysis.status !== "analyzed" ||
      analysis.manifestBytes === null || analysis.manifestSha256 === null ||
      analysis.candidateId !== revision.candidateId ||
      !bytesEqualFullScan(analysis.manifestSha256, revision.manifestSha256) ||
      !bytesEqualFullScan(
        analysis.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )) {
      return yield* readinessFailure("storedState");
    }
    const manifest = yield* decodeStoredManifest(
      analysis.manifestBytes,
      analysis.manifestSha256,
    );
    const publication = selected?.publication;
    if (publication === undefined || publication === null) {
      return notReady(input.revisionId, "publicationMissing");
    }
    if (publication.candidateId !== revision.candidateId ||
      publication.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(publication.manifestSha256, revision.manifestSha256)) {
      return yield* readinessFailure("storedState");
    }
    const schemaFrame = yield* Effect.fromResult(
      applicationSchemaPublicationFrameV1(manifest).pipe(
        Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        )),
      ),
    );
    if (!bytesEqualFullScan(schemaFrame, publication.schemaBytes) ||
      !bytesEqualFullScan(yield* sha256(schemaFrame), publication.schemaSha256)) {
      return yield* readinessFailure("storedState");
    }
    const catalogFrame = yield* Effect.fromResult(applicationFunctionCatalogPublicationFrameV1(manifest).pipe(
      Result.mapError(cause => readinessFailureValue("storedState", false, cause))));
    if (!bytesEqualFullScan(catalogFrame, publication.functionCatalogBytes) ||
      !bytesEqualFullScan(yield* sha256(catalogFrame), publication.functionCatalogSha256))
      return yield* readinessFailure("storedState");
    const commitmentFrame = yield* Effect.fromResult(applicationPublicationCommitmentFrameV1({
      scopeId: authority.scopeId, revisionId: revision.revisionId, candidateId: revision.candidateId,
      analysisId: revision.analysisId, sourceArtifactRootSha256: manifest.sourceArtifact.rootSha256,
      manifestSha256: encodeBytesToLowercaseHex(revision.manifestSha256),
      schemaSha256: encodeBytesToLowercaseHex(publication.schemaSha256),
      functionCatalogSha256: encodeBytesToLowercaseHex(publication.functionCatalogSha256),
    }).pipe(Result.mapError(cause => readinessFailureValue("storedState", false, cause))));
    if (!bytesEqualFullScan(yield* sha256(commitmentFrame), publication.publicationSha256))
      return yield* readinessFailure("storedState");
    const functionRows = yield* readFunctions(manifest.functions.length);
    if (functionRows.length !== manifest.functions.length ||
      functionRows.length > MAX_FUNCTIONS) {
      return yield* readinessFailure("storedState");
    }
    const functionsByPath = new Map(
      functionRows.map(row => [row.functionPath, row] as const),
    );
    if (functionsByPath.size !== functionRows.length) {
      return yield* readinessFailure("storedState");
    }
    const functions: Array<(typeof functionRows)[number]> = [];
    for (const fn of manifest.functions) {
      const row = functionsByPath.get(fn.path);
      if (row === undefined) return yield* readinessFailure("storedState");
      functions.push(row);
    }
    yield* validateStoredFunctions(manifest, publication, functions);
    const task = yield* readTask();
    if (task === null) {
      return notReady(input.revisionId, "taskCatalogMissing");
    }
    if (task.candidateId !== revision.candidateId ||
      task.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(
        task.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(task.publicationSha256, publication.publicationSha256)) {
      return yield* readinessFailure("storedState");
    }
    const ownedRevision = detachDriverRows([revision])[0];
    const ownedPublication = detachDriverRows([publication])[0];
    const ownedFunctions = detachDriverRows(functions);
    if (ownedRevision === undefined || ownedPublication === undefined) {
      return yield* readinessFailure("storedState");
    }
    return Object.freeze({
      authority,
      deploymentId: input.deploymentId,
      revision: ownedRevision,
      publication: ownedPublication,
      manifest,
      functions: ownedFunctions,
      task,
    });
  },
);

function bindRevisionSchema(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  revisionId: string,
  deploymentId: string,
  applicationSchemaSha256: Uint8Array,
  schemaVersionId: ApplicationSchemaAuthority["schemaVersionId"],
  schemaVersion: CatalogSchemaVersion,
  schemaManifestSha256: Uint8Array,
  schemaBindingSha256: Uint8Array,
): Effect.Effect<void, ApplicationReadinessError> {
  return Effect.gen(function* () {
    yield* execute(tx.insert(fxSystemApplicationRevisionSchemasV1).values({
      scopeId,
      revisionId,
      deploymentId,
      applicationSchemaSha256: copyBytes(applicationSchemaSha256),
      schemaVersionId,
      schemaVersion,
      schemaManifestSha256: copyBytes(schemaManifestSha256),
      schemaBindingSha256: copyBytes(schemaBindingSha256),
    }).onConflictDoNothing());
    const rows = yield* query(
      tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
        eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
        eq(fxSystemApplicationRevisionSchemasV1.revisionId, revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (row === undefined || row.deploymentId !== deploymentId ||
      row.schemaVersionId !== schemaVersionId ||
      row.schemaVersion !== schemaVersion ||
      !bytesEqualFullScan(
        row.applicationSchemaSha256,
        applicationSchemaSha256,
      ) ||
      !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
      !bytesEqualFullScan(row.schemaBindingSha256, schemaBindingSha256)) {
      return yield* readinessFailure("conflictingReplay");
    }
  });
}

function requireSchemaCorrelation(
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.Effect<void, ApplicationReadinessError> {
  return schema.deploymentId === bundle.deploymentId &&
      schema.applicationSchemaSha256 ===
        encodeBytesToLowercaseHex(bundle.publication.schemaSha256) &&
      schema.schemaVersion === schemaVersion &&
      schema.schemaVersionId ===
        `application_${schema.applicationSchemaSha256}`
    ? Effect.void
    : readinessFailure("schemaBinding");
}

function publishSchemaBinding(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.Effect<Uint8Array, ApplicationReadinessError> {
  return Effect.gen(function* () {
    const bindingBytes = applicationSchemaBindingBytes(schema);
    if (bindingBytes.byteLength > MAX_BINDING_BYTES) {
      return yield* readinessFailure("schemaBinding");
    }
    const bindingSha256 = yield* sha256(bindingBytes);
    const schemaManifestSha256 = decodeSha256(schema.schemaManifestSha256);
    const rows = yield* query(
      tx.select().from(fxControlApplicationSchemaAuthoritiesV1).where(and(
        eq(
          fxControlApplicationSchemaAuthoritiesV1.deploymentId,
          bundle.deploymentId,
        ),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
          bundle.publication.schemaSha256,
        ),
      )).limit(1).for("update"),
    );
    const row = rows[0];
    if (row === undefined || row.schemaVersionId !== schema.schemaVersionId ||
      row.schemaVersion !== schemaVersion) {
      return yield* readinessFailure("schemaBinding");
    }
    if (row.status === "published") {
      if (row.schemaManifestSha256 === null || row.bindingSha256 === null ||
        row.bindingBytes === null ||
        !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
        !bytesEqualFullScan(row.bindingSha256, bindingSha256) ||
        !bytesEqualFullScan(row.bindingBytes, bindingBytes)) {
        return yield* readinessFailure("conflictingReplay");
      }
      return copyBytes(bindingSha256);
    }
    const now = yield* controlDatabaseTime(tx, bundle.deploymentId);
    const updated = yield* query(
      tx.update(fxControlApplicationSchemaAuthoritiesV1).set({
        status: "published",
        schemaManifestSha256,
        bindingSha256,
        bindingBytes,
        publishedAt: now,
      }).where(and(
        eq(
          fxControlApplicationSchemaAuthoritiesV1.deploymentId,
          bundle.deploymentId,
        ),
        eq(
          fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
          bundle.publication.schemaSha256,
        ),
        eq(fxControlApplicationSchemaAuthoritiesV1.status, "reserved"),
      )).returning({
        deploymentId: fxControlApplicationSchemaAuthoritiesV1.deploymentId,
      }),
    );
    if (updated.length !== 1) {
      return yield* readinessFailure("conflictingReplay");
    }
    return copyBytes(bindingSha256);
  });
}

const readSchemaBinding = Effect.fn("ApplicationReadiness.readSchemaBinding")(function* (
  tx: AppRowTransaction | FlarexMetadataDatabase,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
): Effect.fn.Return<Readonly<{ sha256: Uint8Array;
  originalRow: typeof fxControlApplicationSchemaAuthoritiesV1.$inferSelect;
  schemaBindingByteLengthText: string }>, ApplicationReadinessError> {
  const bindingBytes = applicationSchemaBindingBytes(schema);
  if (bindingBytes.byteLength > MAX_BINDING_BYTES) {
    return yield* readinessFailure("schemaBinding");
  }
  const bindingSha256 = yield* sha256(bindingBytes);
  const schemaManifestSha256 = decodeSha256(schema.schemaManifestSha256);
  const rows = yield* query(
    tx.select({ ...getTableColumns(fxControlApplicationSchemaAuthoritiesV1),
      bindingBytes: sql<Uint8Array | null>`case when octet_length(${fxControlApplicationSchemaAuthoritiesV1.bindingBytes})
        <= ${MAX_BINDING_BYTES} then ${fxControlApplicationSchemaAuthoritiesV1.bindingBytes} else null end`,
      schemaBindingByteLengthText: sql<string>`octet_length(${fxControlApplicationSchemaAuthoritiesV1.bindingBytes})::bigint::text`,
    }).from(fxControlApplicationSchemaAuthoritiesV1).where(and(
      eq(
        fxControlApplicationSchemaAuthoritiesV1.deploymentId,
        bundle.deploymentId,
      ),
      eq(
        fxControlApplicationSchemaAuthoritiesV1.applicationSchemaSha256,
        bundle.publication.schemaSha256,
      ),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined || row.status !== "published" ||
    row.schemaVersionId !== schema.schemaVersionId ||
    row.schemaVersion !== schemaVersion ||
    row.schemaManifestSha256 === null || row.bindingSha256 === null ||
    row.bindingBytes === null ||
    !bytesEqualFullScan(row.schemaManifestSha256, schemaManifestSha256) ||
    !bytesEqualFullScan(row.bindingSha256, bindingSha256) ||
    !bytesEqualFullScan(row.bindingBytes, bindingBytes)) {
    return yield* readinessFailure("schemaBinding");
  }
  const { schemaBindingByteLengthText, ...originalRow } = row;
  return Object.freeze({ sha256: copyBytes(bindingSha256), originalRow: structuredClone(originalRow), schemaBindingByteLengthText });
});

function applicationSchemaBindingBytes(
  schema: ApplicationSchemaAuthority,
): Uint8Array {
  return canonicalBytes({
    format: "flarex.application-schema-binding",
    version: 1,
    deploymentId: schema.deploymentId,
    applicationSchemaSha256: schema.applicationSchemaSha256,
    schemaVersionId: schema.schemaVersionId,
    schemaVersion: schema.schemaVersion,
    schemaManifestSha256: schema.schemaManifestSha256,
    tables: schema.tables.map(table => ({ ...table })),
    indexes: schema.indexes.map(index => ({ ...index })),
  });
}

function materializeFunctions<Failure>(
  bundle: StoredBundle,
  port: ApplicationReadinessColdMaterializationPort<Failure>,
): Effect.Effect<PreparedColdEvidence, ApplicationReadinessError | Failure> {
  return Effect.gen(function* () {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    const materialize = port.materialize;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) ||
      !validCompatibilityDate(compatibilityDate) ||
      typeof materialize !== "function" ||
      runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) {
      return yield* readinessFailure("coldMaterialization");
    }
    const output: ColdEvidence[] = [];
    for (let index = 0; index < bundle.manifest.functions.length; index += 1) {
      const fn = bundle.manifest.functions[index];
      const stored = bundle.functions[index];
      if (fn === undefined || stored === undefined || stored.functionPath !== fn.path) {
        return yield* readinessFailure("storedState");
      }
      const target = yield* prepareRuntimeTarget(bundle, fn, stored);
      const received = yield* materialize({
        target: target.target,
        manifest: bundle.manifest,
      });
      const canonical = yield* Effect.fromResult(
        canonicalizeApplicationRuntimeColdReceiptV1(received.receipt).pipe(
          Result.mapError(cause => readinessFailureValue(
            "coldMaterialization",
            false,
            cause,
          )),
        ),
      );
      if (canonical.receipt.runtimeHostIdentity !== runtimeHostIdentity ||
        canonical.receipt.compatibilityDate !== compatibilityDate ||
        canonical.receipt.functionPath !== fn.path ||
        canonical.receipt.functionKind !== fn.kind ||
        canonical.receipt.visibility !== fn.visibility ||
        canonical.receipt.sourceArtifactRootSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256) ||
        canonical.receipt.manifestSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.manifestSha256) ||
        canonical.receipt.runtimeTargetSha256 !==
          encodeBytesToLowercaseHex(yield* sha256(target.canonicalBytes)) ||
        canonical.receipt.publicationSha256 !==
          encodeBytesToLowercaseHex(bundle.publication.publicationSha256)) {
        return yield* readinessFailure("coldMaterialization");
      }
      output.push(Object.freeze({
        functionPath: fn.path,
        runtimeTargetSha256: decodeSha256(
          canonical.receipt.runtimeTargetSha256,
        ),
        coldReceiptSha256: yield* sha256(canonical.canonicalBytes),
        coldReceiptBytes: copyBytes(canonical.canonicalBytes),
      }));
    }
    return Object.freeze({
      runtimeHostIdentity,
      compatibilityDate,
      entries: Object.freeze(output),
    });
  });
}

const loadStoredColdEvidence = Effect.fn("ApplicationReadiness.loadStoredColdEvidence")(function* <Failure>(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  port: ApplicationReadinessColdMaterializationPort<Failure>,
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<PreparedColdEvidence | null, ApplicationReadinessError |
  LockScopeClockForShareError> {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) ||
      !validCompatibilityDate(compatibilityDate) ||
      typeof port.materialize !== "function" ||
      runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) {
      return yield* readinessFailure("coldMaterialization");
    }
    const clock = lockedClock ?? (yield* lockScopeClockForShareInTransactionEffect(tx, bundle.authority.scopeId));
    yield* requireExactAuthority(bundle.authority, clock);
    const readinessRows = yield* query(
      tx.select().from(fxSystemApplicationReadinessV1).where(and(
        eq(fxSystemApplicationReadinessV1.scopeId, bundle.authority.scopeId),
        eq(fxSystemApplicationReadinessV1.revisionId, bundle.revision.revisionId),
      )).limit(1).for("share"),
    );
    const readiness = readinessRows[0];
    if (readiness === undefined) return null;
    if (readiness.runtimeHostIdentity !== runtimeHostIdentity ||
      readiness.compatibilityDate !== compatibilityDate) {
      return yield* readinessFailure("conflictingReplay");
    }
    const children = yield* query(
      tx.select().from(fxSystemApplicationReadinessFunctionsV1).where(and(
        eq(
          fxSystemApplicationReadinessFunctionsV1.scopeId,
          bundle.authority.scopeId,
        ),
        eq(
          fxSystemApplicationReadinessFunctionsV1.revisionId,
          bundle.revision.revisionId,
        ),
      )).for("share"),
    );
    return yield* authenticateStoredColdEvidence(bundle, port, readiness, children);
});

const authenticateStoredColdEvidence = Effect.fn('ApplicationReadiness.authenticateStoredColdEvidence')(
function* <Failure>(bundle: StoredBundle, port: ApplicationReadinessColdMaterializationPort<Failure>,
  readiness: typeof fxSystemApplicationReadinessV1.$inferSelect,
  children: ReadonlyArray<typeof fxSystemApplicationReadinessFunctionsV1.$inferSelect>) {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) || !validCompatibilityDate(compatibilityDate) ||
      typeof port.materialize !== 'function' || runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) return yield* readinessFailure('coldMaterialization');
    if (readiness.runtimeHostIdentity !== runtimeHostIdentity || readiness.compatibilityDate !== compatibilityDate)
      return yield* readinessFailure('conflictingReplay');
    if (children.length !== bundle.manifest.functions.length) {
      return yield* readinessFailure("conflictingReplay");
    }
    const childrenByPath = new Map(
      children.map(child => [child.functionPath, child] as const),
    );
    if (childrenByPath.size !== children.length) {
      return yield* readinessFailure("conflictingReplay");
    }
    const entries: ColdEvidence[] = [];
    for (let index = 0; index < bundle.manifest.functions.length; index += 1) {
      const fn = bundle.manifest.functions[index];
      const storedFunction = bundle.functions[index];
      const child = fn === undefined ? undefined : childrenByPath.get(fn.path);
      if (fn === undefined || storedFunction === undefined ||
        child === undefined || child.functionPath !== fn.path ||
        storedFunction.functionPath !== fn.path) {
        return yield* readinessFailure("conflictingReplay");
      }
      const target = yield* prepareRuntimeTarget(bundle, fn, storedFunction);
      const runtimeTargetSha256 = yield* sha256(target.canonicalBytes);
      const canonical = yield* decodeStoredColdReceipt(child.coldReceiptBytes);
      if (!bytesEqualFullScan(child.readinessSha256, readiness.readinessSha256) ||
        !bytesEqualFullScan(child.runtimeTargetSha256, runtimeTargetSha256) ||
        !bytesEqualFullScan(
          child.coldReceiptSha256,
          yield* sha256(canonical.canonicalBytes),
        ) || canonical.receipt.runtimeHostIdentity !== runtimeHostIdentity ||
        canonical.receipt.compatibilityDate !== compatibilityDate ||
        canonical.receipt.functionPath !== fn.path ||
        canonical.receipt.functionKind !== fn.kind ||
        canonical.receipt.visibility !== fn.visibility ||
        canonical.receipt.sourceArtifactRootSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256) ||
        canonical.receipt.manifestSha256 !==
          encodeBytesToLowercaseHex(bundle.revision.manifestSha256) ||
        canonical.receipt.publicationSha256 !==
          encodeBytesToLowercaseHex(bundle.publication.publicationSha256) ||
        canonical.receipt.runtimeTargetSha256 !==
          encodeBytesToLowercaseHex(runtimeTargetSha256)) {
        return yield* readinessFailure("conflictingReplay");
      }
      entries.push(Object.freeze({
        functionPath: fn.path,
        runtimeTargetSha256: copyBytes(runtimeTargetSha256),
        coldReceiptSha256: copyBytes(child.coldReceiptSha256),
        coldReceiptBytes: copyBytes(canonical.canonicalBytes),
      }));
    }
    return Object.freeze({
      runtimeHostIdentity,
      compatibilityDate,
      entries: Object.freeze(entries),
    });
});

const loadStoredReadinessAuthority = Effect.fn(
  "ApplicationReadiness.loadStoredAuthority",
)(function* <Failure>(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  schemaVersion: CatalogSchemaVersion,
  schema: ApplicationSchemaAuthority,
  schemaBindingSha256: Uint8Array,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  physicalDefinitionLifecycle:
    PreparedPhysicalDefinitionLifecycleReadiness,
  physicalReadinessSha256: Uint8Array,
  coldPort: ApplicationReadinessColdMaterializationPort<Failure>,
  lockedClock?: ScopeClockRecord,
): Effect.fn.Return<
  StoredReadinessAuthority | null,
  ApplicationReadinessError | LockScopeClockForShareError
> {
  const cold = yield* loadStoredColdEvidence(tx, bundle, coldPort, lockedClock);
  if (cold === null) return null;
  const rows = yield* query(
    tx.select().from(fxSystemApplicationReadinessV1).where(and(
      eq(fxSystemApplicationReadinessV1.scopeId, bundle.authority.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, bundle.revision.revisionId),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined) return yield* readinessFailure("storedState");
  return yield* authenticateStoredReadinessAuthority(bundle, schemaVersion, schema, schemaBindingSha256,
    requirements, physicalDefinitionLifecycle, physicalReadinessSha256, row, cold);
});

const authenticateStoredReadinessAuthority = Effect.fn('ApplicationReadiness.authenticateStoredAuthority')(
function* (
  bundle: StoredBundle, schemaVersion: CatalogSchemaVersion, schema: ApplicationSchemaAuthority,
  schemaBindingSha256: Uint8Array, requirements: PublishedPhysicalRequirementSnapshotV1,
  physicalDefinitionLifecycle: PreparedPhysicalDefinitionLifecycleReadiness,
  physicalReadinessSha256: Uint8Array, row: typeof fxSystemApplicationReadinessV1.$inferSelect,
  cold: PreparedColdEvidence,
) {
  const readyAt = databaseTimestampFromUnknown(row.readyAt);
  const readinessByteLength = uint8ArrayByteLength(row.readinessBytes);
  const sha256Fields = [
    row.sourceArtifactRootSha256,
    row.manifestSha256,
    row.publicationSha256,
    row.applicationSchemaSha256,
    row.functionCatalogSha256,
    row.schemaManifestSha256,
    row.schemaBindingSha256,
    row.taskCatalogBindingSha256,
    row.coldReceiptSetSha256,
    row.candidateValidationReceiptSha256,
    row.uniqueConstraintEligibilitySha256,
    row.physicalReadinessSha256,
    row.readinessSha256,
  ];
  if (readyAt === null ||
    sha256Fields.some(value => !isUint8ArrayWithByteLength(value, 32)) ||
    readinessByteLength === undefined || readinessByteLength < 1 ||
    readinessByteLength > MAX_READINESS_BYTES) {
    return yield* readinessFailure("storedState");
  }
  const coldReceiptSetSha256 = yield* digestColdReceiptSet(cold);
  const readinessBytes = readinessFrameFromAuthority({
    bundle,
    schemaVersionId: schema.schemaVersionId,
    schemaManifestSha256Hex: schema.schemaManifestSha256,
    schemaBindingSha256,
    runtimeHostIdentity: cold.runtimeHostIdentity,
    compatibilityDate: cold.compatibilityDate,
    coldReceiptSetSha256,
    candidateValidationReceiptSha256Hex: encodeBytesToLowercaseHex(
      row.candidateValidationReceiptSha256,
    ),
    uniqueConstraintStatus: row.uniqueConstraintStatus,
    uniqueConstraintEligibilitySha256:
      row.uniqueConstraintEligibilitySha256,
    physicalReadinessSha256,
    cold: cold.entries,
  }, readyAt);
  const readinessSha256 = yield* sha256(readinessBytes);
  if (row.deploymentId !== bundle.deploymentId ||
    row.candidateId !== bundle.revision.candidateId ||
    row.analysisId !== bundle.revision.analysisId ||
    row.storageGeneration !== bundle.authority.storageGeneration ||
    row.storageGenerationFence !== bundle.authority.storageGenerationFence ||
    row.epoch !== bundle.authority.epoch ||
    row.schemaVersionId !== schema.schemaVersionId ||
    row.runtimeHostIdentity !== cold.runtimeHostIdentity ||
    row.compatibilityDate !== cold.compatibilityDate ||
    !bytesEqualFullScan(
      row.sourceArtifactRootSha256,
      bundle.revision.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(row.manifestSha256, bundle.revision.manifestSha256) ||
    !bytesEqualFullScan(
      row.publicationSha256,
      bundle.publication.publicationSha256,
    ) ||
    !bytesEqualFullScan(
      row.applicationSchemaSha256,
      bundle.publication.schemaSha256,
    ) ||
    !bytesEqualFullScan(
      row.functionCatalogSha256,
      bundle.publication.functionCatalogSha256,
    ) ||
    !bytesEqualFullScan(
      row.schemaManifestSha256,
      decodeSha256(schema.schemaManifestSha256),
    ) ||
    !bytesEqualFullScan(row.schemaBindingSha256, schemaBindingSha256) ||
    !bytesEqualFullScan(
      row.taskCatalogBindingSha256,
      bundle.task.taskCatalogBindingSha256,
    ) ||
    !bytesEqualFullScan(row.coldReceiptSetSha256, coldReceiptSetSha256) ||
    !bytesEqualFullScan(
      row.physicalReadinessSha256,
      physicalReadinessSha256,
    ) ||
    !bytesEqualFullScan(row.readinessSha256, readinessSha256) ||
    !bytesEqualFullScan(row.readinessBytes, readinessBytes)) {
    return yield* readinessFailure("storedState");
  }
  return Object.freeze({
    bundle,
    schemaVersion,
    schema,
    schemaBindingSha256: copyBytes(schemaBindingSha256),
    requirements,
    physicalDefinitionLifecycle,
    cold,
    readinessSha256: copyBytes(readinessSha256),
    readinessBytes: copyBytes(readinessBytes),
    readyAt: new Date(readyAt.getTime()),
    physicalReadinessSha256: copyBytes(physicalReadinessSha256),
  });
});

function digestColdReceiptSet(
  cold: PreparedColdEvidence,
): Effect.Effect<Uint8Array> {
  return digestCanonicalJson({
    format: "flarex.application-cold-receipt-set",
    version: 1,
    runtimeHostIdentity: cold.runtimeHostIdentity,
    compatibilityDate: cold.compatibilityDate,
    entries: cold.entries.map(entry => ({
      functionPath: entry.functionPath,
      runtimeTargetSha256:
        encodeBytesToLowercaseHex(entry.runtimeTargetSha256),
      coldReceiptSha256: encodeBytesToLowercaseHex(entry.coldReceiptSha256),
    })),
  });
}

function prepareRuntimeTarget(
  bundle: StoredBundle,
  fn: ApplicationManifestV1["functions"][number],
  stored: typeof fxSystemApplicationFunctionsV1.$inferSelect,
): Effect.Effect<CanonicalApplicationRuntimeTargetV1, ApplicationReadinessError> {
  return Effect.fromResult(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: bundle.revision.scopeId,
    revisionId: bundle.revision.revisionId,
    candidateId: bundle.revision.candidateId,
    analysisId: bundle.revision.analysisId,
    sourceArtifactRootSha256:
      encodeBytesToLowercaseHex(bundle.revision.sourceArtifactRootSha256),
    manifestSha256: encodeBytesToLowercaseHex(bundle.revision.manifestSha256),
    schemaSha256: encodeBytesToLowercaseHex(bundle.publication.schemaSha256),
    functionCatalogSha256:
      encodeBytesToLowercaseHex(bundle.publication.functionCatalogSha256),
    publicationSha256:
      encodeBytesToLowercaseHex(bundle.publication.publicationSha256),
    executionModulePath: bundle.manifest.sourceArtifact.executionModulePath,
    function: {
      ...fn,
      entrySha256: encodeBytesToLowercaseHex(stored.entrySha256),
    },
  }).pipe(Result.mapError(cause => readinessFailureValue(
    "storedState",
    false,
    cause,
  ))));
}

const decodeStoredColdReceipt = Effect.fn(
  "ApplicationReadiness.decodeStoredColdReceipt",
)(function* (
  bytes: Uint8Array,
): Effect.fn.Return<
  CanonicalApplicationRuntimeColdReceiptV1,
  ApplicationReadinessError
> {
  const parsed = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => readinessFailureValue("conflictingReplay", false, cause),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationRuntimeColdReceiptV1(parsed).pipe(
      Result.mapError(cause => readinessFailureValue(
        "conflictingReplay",
        false,
        cause,
      )),
    ),
  );
  return bytesEqualFullScan(bytes, canonical.canonicalBytes)
    ? canonical
    : yield* readinessFailure("conflictingReplay");
});

const settleReadiness = Effect.fn("ApplicationReadiness.settleTransaction")(
function* <SchemaFailure, ColdFailure>(
  tx: AppRowTransaction,
  prepared: PreparedReadiness,
  context: ApplicationReadinessContext<SchemaFailure, ColdFailure>,
  issuer: ApplicationReadinessRepositoryIssuerV1,
  mode: "settle" | "validate" = "settle",
): Effect.fn.Return<
  ApplicationReadinessResult,
  ApplicationReadinessError |
  ApplicationTaskCatalogSnapshotError |
  ValidateAppSchemaCandidateReadinessError |
  ValidatePointCommitUniqueConstraintEligibilityV1Error |
  ValidatePhysicalDefinitionLifecycleReadinessError |
  LockScopeClockForShareError |
  LockScopeClockForUpdateError
> {
    const clock = yield* (mode === "validate"
      ? lockScopeClockForShareInTransactionEffect(
        tx,
        prepared.bundle.authority.scopeId,
      )
      : lockScopeClockForUpdateInTransactionEffect(
        tx,
        prepared.bundle.authority.scopeId,
      ));
    yield* requireExactAuthority(prepared.bundle.authority, clock);
    const currentBundle = yield* reserveBundle(
      tx,
      prepared.bundle.authority,
      Object.freeze({
        deploymentId: prepared.bundle.deploymentId,
        revisionId: prepared.bundle.revision.revisionId,
      }),
      context.taskCatalog,
      mode === "validate" ? "share" : "update",
    );
    if ("status" in currentBundle) return currentBundle;
    if (!storedBundlesEqual(prepared.bundle, currentBundle)) {
      return yield* readinessFailure("storedState");
    }
    const candidateValidation = yield*
      validateAppSchemaCandidateReadinessInTransactionEffect(
        tx,
        context.candidateValidation,
        prepared.candidateValidation,
        prepared.bundle.authority,
        clock,
        "share",
      );
    if (candidateValidation.status !== "ready") {
      return notReady(
        prepared.bundle.revision.revisionId,
        candidateNotReadyReason(candidateValidation.reason),
      );
    }
    if (prepared.uniqueConstraintEligibility.status === "eligible") {
      const validatedUnique = yield*
        validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect(
          context.pointCommit,
          tx,
          prepared.uniqueConstraintEligibility.evidence,
          prepared.bundle.authority,
          clock,
        );
      if (validatedUnique.status === "not_ready") {
        return notReady(
          prepared.bundle.revision.revisionId,
          uniqueNotReadyReason(validatedUnique.reason),
          validatedUnique.lifecycle,
        );
      }
      if (validatedUnique.status !== "eligible" || !bytesEqualFullScan(
        yield* digestCanonicalJson(appUniqueConstraintEligibilityFrame(validatedUnique)),
        prepared.uniqueConstraintEligibilitySha256,
      )) return yield* readinessFailure("authorityChanged");
    }
    const physical = yield* loadPhysicalReadiness(
      tx,
      prepared.bundle.authority,
      prepared.requirements,
      context.physicalDefinitionLifecycle,
      prepared.physicalDefinitionLifecycle,
      clock,
    );
    if (physical.status === "not_ready") {
      return notReady(
        prepared.bundle.revision.revisionId,
        physical.reason,
        physical.detail,
      );
    }
    const physicalReadinessSha256 = physical.physicalReadinessSha256;
    const schemaManifestSha256 = decodeSha256(
      prepared.schema.schemaManifestSha256,
    );
    const candidateValidationReceiptSha256 = decodeSha256(
      prepared.candidateValidation.receiptSha256Hex,
    );
    if (mode === "settle") {
      yield* bindRevisionSchema(
        tx,
        prepared.bundle.revision.scopeId,
        prepared.bundle.revision.revisionId,
        prepared.bundle.deploymentId,
        prepared.bundle.publication.schemaSha256,
        prepared.schema.schemaVersionId,
        prepared.schemaVersion,
        schemaManifestSha256,
        prepared.schemaBindingSha256,
      );
    }
    const existingRows = yield* query(
      tx.select().from(fxSystemApplicationReadinessV1).where(and(
        eq(
          fxSystemApplicationReadinessV1.scopeId,
          prepared.bundle.revision.scopeId,
        ),
        eq(
          fxSystemApplicationReadinessV1.revisionId,
          prepared.bundle.revision.revisionId,
        ),
      )).limit(1).for(mode === "validate" ? "share" : "update"),
    );
    const existing = existingRows[0];
    if (mode === "validate" && existing === undefined) {
      return yield* readinessFailure("authorityChanged");
    }
    const readyAt = existing === undefined
      ? yield* targetDatabaseTime(tx, prepared.bundle.authority.scopeId)
      : databaseTimestampFromUnknown(existing.readyAt);
    if (readyAt === null) return yield* readinessFailure("storedState");
    const readinessBytes = readinessFrame(
      prepared,
      physicalReadinessSha256,
      readyAt,
    );
    if (readinessBytes.byteLength > MAX_READINESS_BYTES) {
      return yield* readinessFailure("storedState");
    }
    const readinessSha256 = yield* sha256(readinessBytes);
    if (existing !== undefined) {
      yield* validateReadinessReplay(
        tx,
        prepared,
        existing,
        physicalReadinessSha256,
        readinessSha256,
        readinessBytes,
      );
      return yield* readyProjection(
        "replayed",
        prepared,
        readinessSha256,
        readinessBytes,
        readyAt,
        issuer,
      );
    }
    const readinessInsert: typeof fxSystemApplicationReadinessV1.$inferInsert = {
        scopeId: prepared.bundle.revision.scopeId,
        revisionId: prepared.bundle.revision.revisionId,
        deploymentId: prepared.bundle.deploymentId,
        candidateId: prepared.bundle.revision.candidateId,
        analysisId: prepared.bundle.revision.analysisId,
        sourceArtifactRootSha256:
          copyBytes(prepared.bundle.revision.sourceArtifactRootSha256),
        manifestSha256: copyBytes(prepared.bundle.revision.manifestSha256),
        publicationSha256:
          copyBytes(prepared.bundle.publication.publicationSha256),
        applicationSchemaSha256:
          copyBytes(prepared.bundle.publication.schemaSha256),
        functionCatalogSha256:
          copyBytes(prepared.bundle.publication.functionCatalogSha256),
        storageGeneration: prepared.bundle.authority.storageGeneration,
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        schemaVersionId: prepared.schema.schemaVersionId,
        schemaManifestSha256: copyBytes(schemaManifestSha256),
        schemaBindingSha256: copyBytes(prepared.schemaBindingSha256),
        taskCatalogBindingSha256:
          copyBytes(prepared.bundle.task.taskCatalogBindingSha256),
        runtimeHostIdentity: prepared.runtimeHostIdentity,
        compatibilityDate: prepared.compatibilityDate,
        coldReceiptSetSha256: copyBytes(prepared.coldReceiptSetSha256),
        candidateValidationReceiptSha256:
          copyBytes(candidateValidationReceiptSha256),
        uniqueConstraintStatus: prepared.uniqueConstraintEligibility.status,
        uniqueConstraintEligibilitySha256:
          copyBytes(prepared.uniqueConstraintEligibilitySha256),
        physicalReadinessSha256: copyBytes(physicalReadinessSha256),
        readinessSha256: copyBytes(readinessSha256),
        readinessBytes: copyBytes(readinessBytes),
        readyAt,
    };
    const inserted = yield* query(
      tx.insert(fxSystemApplicationReadinessV1).values(readinessInsert)
        .onConflictDoNothing().returning({
        revisionId: fxSystemApplicationReadinessV1.revisionId,
      }),
    );
    if (inserted.length !== 1) {
      return yield* readinessFailure("conflictingReplay");
    }
    if (prepared.cold.length > 0) {
      yield* execute(
        tx.insert(fxSystemApplicationReadinessFunctionsV1).values(
          prepared.cold.map(entry => ({
            scopeId: prepared.bundle.revision.scopeId,
            revisionId: prepared.bundle.revision.revisionId,
            readinessSha256: copyBytes(readinessSha256),
            functionPath: entry.functionPath,
            runtimeTargetSha256: copyBytes(entry.runtimeTargetSha256),
            coldReceiptSha256: copyBytes(entry.coldReceiptSha256),
            coldReceiptBytes: copyBytes(entry.coldReceiptBytes),
          })),
        ),
      );
    }
    return yield* readyProjection(
      "inserted",
      prepared,
      readinessSha256,
      readinessBytes,
      readyAt,
      issuer,
    );
  },
);

type PhysicalBuildRowsResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly reason: "physicalBuildMissing" | "physicalBuildNotEnabled" | "physicalBuildNotCovered";
      readonly detail: string;
      readonly clock: ScopeClockRecord;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly rows: ReadonlyArray<IndexBuildStateRecord>;
      readonly clock: ScopeClockRecord;
    }>;

export type ApplicationPhysicalReadinessResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly reason:
        | "physicalBuildMissing"
        | "physicalBuildNotCovered"
  | "physicalBuildNotEnabled"
        | "physicalDefinitionNotActive";
      readonly detail: string;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly physicalReadinessSha256: Uint8Array;
    }>;

const loadPhysicalReadiness = Effect.fn(
  "ApplicationReadiness.loadPhysicalReadiness",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  lifecyclePort: PhysicalDefinitionLifecyclePort,
  lifecycleReadiness: PreparedPhysicalDefinitionLifecycleReadiness,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
): Effect.fn.Return<
  ApplicationPhysicalReadinessResult,
  ApplicationReadinessError |
    ValidatePhysicalDefinitionLifecycleReadinessError
> {
  let observedClock = clock;
  let physicalBuilds: Extract<PhysicalBuildRowsResult, { readonly status: "ready" }> | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = yield* loadPhysicalBuildRows(
      tx, authority, requirements, observedClock, checkedActive,
    );
    if (candidate.status === "ready") {
      physicalBuilds = candidate;
      break;
    }
    const after = yield* lockScopeClockForSnapshotReadInTransactionEffect(
      tx, authority.scopeId,
    ).pipe(Effect.mapError(cause => cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? readinessFailureValue("resourceFailure", retryableCause(cause.cause), cause)
      : readinessFailureValue("storedState", false, cause)));
    yield* requireExactAuthority(authority, after);
    if (after.lastCommitSeq === candidate.clock.lastCommitSeq) {
      return Object.freeze({
        status: candidate.status,
        reason: candidate.reason,
        detail: candidate.detail,
      });
    }
    observedClock = after;
  }
  if (physicalBuilds === undefined) {
    return yield* readinessFailure("resourceFailure", true,
      new Error("Physical readiness clock advanced during bounded inspection."));
  }
  const snapshotClock = physicalBuilds.clock;
  const lifecycle = yield*
    validatePhysicalDefinitionLifecycleReadinessInTransactionEffect(
      lifecyclePort,
      lifecycleReadiness,
      tx,
      authority,
      snapshotClock,
    );
  if (lifecycle.status === "not_ready") {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "physicalDefinitionNotActive" as const,
      detail:
        `${lifecycle.definitionKind}:${lifecycle.definitionId}:${lifecycle.lifecycle}`,
    });
  }
  const physicalReadinessSha256 = yield* digestCanonicalJson({
    format: "flarex.application-physical-readiness",
    version: 1,
    scopeId: authority.scopeId,
    storageGeneration: snapshotClock.storageGeneration,
    storageGenerationFence: snapshotClock.storageGenerationFence.toString(),
    epoch: snapshotClock.epoch,
    schemaVersionId: requirements.schemaVersionId,
    schemaManifestSha256:
      encodeBytesToLowercaseHex(requirements.manifestSha256),
    requirementCount: requirements.definitions.length,
    indexes: physicalBuilds.rows.map((build, index) => {
      const requirement = requirements.definitions[index];
      if (requirement === undefined || build.firstReadableCommitSeq === null) {
        throw new Error("Application readiness physical definition or readable frontier vanished.");
      }
      return {
        indexDefinitionId: build.indexDefinitionId,
        physicalSpecCodecVersion: requirement.physicalSpecCodecVersion,
        physicalSpecSha256Hex: requirement.physicalSpecSha256Hex,
        lifecycle: build.lifecycle,
        startCommitSeq: build.startCommitSeq.toString(),
        firstReadableCommitSeq: build.firstReadableCommitSeq.toString(),
        attemptFence: build.attemptFence.toString(),
      };
    }),
    definitionLifecycles: lifecycle.entries.map(entry => ({
      definitionKind: entry.definitionKind,
      definitionId: entry.definitionId,
      physicalSpecSha256Hex: entry.physicalSpecSha256Hex,
      lifecycle: entry.lifecycle,
    })),
  });
  return Object.freeze({
    status: "ready" as const,
    physicalReadinessSha256,
  });
});

/**
 * Narrow shared Application capability: validates the retained table/index/
 * unique physical-readiness meaning inside a caller-owned locked transaction.
 */
export const validateApplicationPhysicalReadinessInTransactionEffect =
  loadPhysicalReadiness;

const loadPhysicalBuildRows = Effect.fn(
  "ApplicationReadiness.loadPhysicalBuildRows",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  clock: ScopeClockRecord,
  checkedActive?: CheckedApplicationActiveHead,
): Effect.fn.Return<PhysicalBuildRowsResult, ApplicationReadinessError> {
    yield* requireExactAuthority(authority, clock);
    const definitionIds = requirements.definitions.map(
      definition => definition.indexDefinitionId,
    );
    // The clock and mutable index coverage must come from one MVCC statement.
    // A provisional read must not wait on the index row a point commit holds.
    const unordered = definitionIds.length === 0 ? [] : yield* query(
      tx.select({ build: fxSystemIndexBuildStates, maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations), scopeClock: scopeClockSelection() })
        .from(fxSystemIndexBuildStates)
        .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
        .innerJoin(fxSystemScopeClocks, eq(
          fxSystemScopeClocks.scopeId,
          fxSystemIndexBuildStates.scopeId,
        )).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId)).where(and(
        eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
        inArray(fxSystemIndexBuildStates.indexDefinitionId, definitionIds),
      )),
    );
    const snapshotClock = unordered[0] === undefined ? clock : yield* Effect.fromResult(
      decodeScopeClockRecordResult(unordered[0].scopeClock).pipe(Result.mapError(cause =>
        readinessFailureValue("storedState", false, cause))),
    );
    yield* requireExactAuthority(authority, snapshotClock);
    const rowsById = new Map(
      unordered.map(row => [row.build.indexDefinitionId, { ...row.build, maintenanceObligation: row.maintenanceObligation }] as const),
    );
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, snapshotClock, checkedActive).pipe(Effect.mapError(cause =>
      readinessFailureValue(cause.reason === "resourceFailure" ? "resourceFailure" : "storedState", cause.reason === "resourceFailure" && (cause.retryable ?? retryableCause(cause.cause)), cause)));
    const rows: IndexBuildStateRecord[] = [];
    for (let index = 0; index < definitionIds.length; index += 1) {
      const definitionId = definitionIds[index];
      const build = definitionId === undefined
        ? undefined
        : rowsById.get(definitionId);
      if (definitionId === undefined || build === undefined) {
        return Object.freeze({
          status: "not_ready" as const,
          reason: "physicalBuildMissing" as const,
          detail: String(definitionId),
          clock: snapshotClock,
        });
      }
      const decoded = yield* Effect.fromResult(
        decodeIndexBuildStateRowResult(
          build,
          authority.scopeId,
          definitionId, build.maintenanceObligation,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      yield* Effect.fromResult(
        validateIndexBuildStateFrontierResult(
          decoded,
          snapshotClock.lastCommitSeq,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      if (decoded.storageGeneration !== snapshotClock.storageGeneration ||
        decoded.storageGenerationFence !== snapshotClock.storageGenerationFence ||
        decoded.epoch !== snapshotClock.epoch) {
        return yield* readinessFailure("authorityChanged");
      }
      const requirement = requirements.definitions[index];
      if (requirement === undefined) return yield* readinessFailure("storedState");
      const covered = yield* isIndexBuildSnapshotCoveredInTransactionEffect(
        tx, decoded, requirement, snapshotClock.lastCommitSeq, context,
      ).pipe(Effect.mapError(cause => cause instanceof AppRowReadPersistenceError || (cause instanceof IndexMaintenanceError && cause.reason === "resourceFailure")
        ? readinessFailureValue("resourceFailure", cause instanceof IndexMaintenanceError ? (cause.retryable ?? retryableCause(cause.cause)) : retryableCause(cause.cause), cause.cause)
        : readinessFailureValue("storedState", false, cause)));
      if (!covered) {
        return Object.freeze({
          status: "not_ready" as const,
          reason: decoded.lifecycle === "enabled" ? "physicalBuildNotCovered" as const : "physicalBuildNotEnabled" as const,
          detail: `${definitionId}:${decoded.lifecycle}`,
          clock: snapshotClock,
        });
      }
      rows.push(decoded);
    }
    return Object.freeze({ status: "ready" as const, rows: Object.freeze(rows), clock: snapshotClock });
  },
);

function readinessFrame(
  prepared: PreparedReadiness,
  physicalReadinessSha256: Uint8Array,
  readyAt: Date,
): Uint8Array {
  return readinessFrameFromAuthority({
    bundle: prepared.bundle,
    schemaVersionId: prepared.schema.schemaVersionId,
    schemaManifestSha256Hex: prepared.schema.schemaManifestSha256,
    schemaBindingSha256: prepared.schemaBindingSha256,
    runtimeHostIdentity: prepared.runtimeHostIdentity,
    compatibilityDate: prepared.compatibilityDate,
    coldReceiptSetSha256: prepared.coldReceiptSetSha256,
    candidateValidationReceiptSha256Hex:
      prepared.candidateValidation.receiptSha256Hex,
    uniqueConstraintStatus: prepared.uniqueConstraintEligibility.status,
    uniqueConstraintEligibilitySha256:
      prepared.uniqueConstraintEligibilitySha256,
    physicalReadinessSha256,
    cold: prepared.cold,
  }, readyAt);
}

interface ReadinessFrameAuthority {
  readonly bundle: StoredBundle;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256Hex: string;
  readonly schemaBindingSha256: Uint8Array;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly coldReceiptSetSha256: Uint8Array;
  readonly candidateValidationReceiptSha256Hex: string;
  readonly uniqueConstraintStatus: "not_required" | "eligible";
  readonly uniqueConstraintEligibilitySha256: Uint8Array;
  readonly physicalReadinessSha256: Uint8Array;
  readonly cold: ReadonlyArray<ColdEvidence>;
}

function readinessFrameFromAuthority(
  authority: ReadinessFrameAuthority,
  readyAt: Date,
): Uint8Array {
  return canonicalBytes({
    format: "flarex.application-readiness",
    version: 1,
    status: "ready",
    scopeId: authority.bundle.revision.scopeId,
    deploymentId: authority.bundle.deploymentId,
    revisionId: authority.bundle.revision.revisionId,
    candidateId: authority.bundle.revision.candidateId,
    analysisId: authority.bundle.revision.analysisId,
    storageGeneration: authority.bundle.authority.storageGeneration,
    storageGenerationFence:
      authority.bundle.authority.storageGenerationFence.toString(),
    epoch: authority.bundle.authority.epoch,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(
      authority.bundle.revision.sourceArtifactRootSha256,
    ),
    manifestSha256:
      encodeBytesToLowercaseHex(authority.bundle.revision.manifestSha256),
    publicationSha256:
      encodeBytesToLowercaseHex(authority.bundle.publication.publicationSha256),
    applicationSchemaSha256:
      encodeBytesToLowercaseHex(authority.bundle.publication.schemaSha256),
    functionCatalogSha256: encodeBytesToLowercaseHex(
      authority.bundle.publication.functionCatalogSha256,
    ),
    schemaVersionId: authority.schemaVersionId,
    schemaManifestSha256: authority.schemaManifestSha256Hex,
    schemaBindingSha256:
      encodeBytesToLowercaseHex(authority.schemaBindingSha256),
    taskCatalogBindingSha256: encodeBytesToLowercaseHex(
      authority.bundle.task.taskCatalogBindingSha256,
    ),
    runtimeHostIdentity: authority.runtimeHostIdentity,
    compatibilityDate: authority.compatibilityDate,
    coldReceiptSetSha256:
      encodeBytesToLowercaseHex(authority.coldReceiptSetSha256),
    candidateValidationReceiptSha256:
      authority.candidateValidationReceiptSha256Hex,
    uniqueConstraintStatus: authority.uniqueConstraintStatus,
    uniqueConstraintEligibilitySha256:
      encodeBytesToLowercaseHex(authority.uniqueConstraintEligibilitySha256),
    physicalReadinessSha256:
      encodeBytesToLowercaseHex(authority.physicalReadinessSha256),
    coldReceipts: authority.cold.map(entry => ({
      functionPath: entry.functionPath,
      runtimeTargetSha256:
        encodeBytesToLowercaseHex(entry.runtimeTargetSha256),
      coldReceiptSha256: encodeBytesToLowercaseHex(entry.coldReceiptSha256),
    })),
    readyAt: readyAt.toISOString(),
  });
}

function validateReadinessReplay(
  tx: AppRowTransaction,
  prepared: PreparedReadiness,
  row: typeof fxSystemApplicationReadinessV1.$inferSelect,
  physicalReadinessSha256: Uint8Array,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
): Effect.Effect<void, ApplicationReadinessError> {
  return Effect.gen(function* () {
    if (row.deploymentId !== prepared.bundle.deploymentId ||
      row.candidateId !== prepared.bundle.revision.candidateId ||
      row.analysisId !== prepared.bundle.revision.analysisId ||
      row.storageGeneration !== prepared.bundle.authority.storageGeneration ||
      row.storageGenerationFence !==
        prepared.bundle.authority.storageGenerationFence ||
      row.epoch !== prepared.bundle.authority.epoch ||
      row.schemaVersionId !== prepared.schema.schemaVersionId ||
      row.runtimeHostIdentity !== prepared.runtimeHostIdentity ||
      row.compatibilityDate !== prepared.compatibilityDate ||
      row.uniqueConstraintStatus !==
        prepared.uniqueConstraintEligibility.status ||
      !bytesEqualFullScan(
        row.sourceArtifactRootSha256,
        prepared.bundle.revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(row.manifestSha256,
        prepared.bundle.revision.manifestSha256) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.bundle.publication.publicationSha256) ||
      !bytesEqualFullScan(row.applicationSchemaSha256,
        prepared.bundle.publication.schemaSha256) ||
      !bytesEqualFullScan(row.functionCatalogSha256,
        prepared.bundle.publication.functionCatalogSha256) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        decodeSha256(prepared.schema.schemaManifestSha256)) ||
      !bytesEqualFullScan(row.schemaBindingSha256,
        prepared.schemaBindingSha256) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.bundle.task.taskCatalogBindingSha256) ||
      !bytesEqualFullScan(row.coldReceiptSetSha256,
        prepared.coldReceiptSetSha256) ||
      !bytesEqualFullScan(row.candidateValidationReceiptSha256,
        decodeSha256(prepared.candidateValidation.receiptSha256Hex)) ||
      !bytesEqualFullScan(row.uniqueConstraintEligibilitySha256,
        prepared.uniqueConstraintEligibilitySha256) ||
      !bytesEqualFullScan(row.physicalReadinessSha256,
        physicalReadinessSha256) ||
      !bytesEqualFullScan(row.readinessSha256, readinessSha256) ||
      !bytesEqualFullScan(row.readinessBytes, readinessBytes)) {
      return yield* readinessFailure("conflictingReplay");
    }
    const children = yield* query(
      tx.select().from(fxSystemApplicationReadinessFunctionsV1).where(and(
        eq(fxSystemApplicationReadinessFunctionsV1.scopeId, row.scopeId),
        eq(fxSystemApplicationReadinessFunctionsV1.revisionId, row.revisionId),
      )),
    );
    const childrenByPath = new Map(
      children.map(child => [child.functionPath, child] as const),
    );
    if (children.length !== prepared.cold.length ||
      childrenByPath.size !== children.length || prepared.cold.some(
      expected => {
        const child = childrenByPath.get(expected.functionPath);
        return child === undefined ||
          !bytesEqualFullScan(child.readinessSha256, readinessSha256) ||
          !bytesEqualFullScan(
            child.runtimeTargetSha256,
            expected.runtimeTargetSha256,
          ) ||
          !bytesEqualFullScan(
            child.coldReceiptSha256,
            expected.coldReceiptSha256,
          ) ||
          !bytesEqualFullScan(
            child.coldReceiptBytes,
            expected.coldReceiptBytes,
          );
      }
    )) return yield* readinessFailure("conflictingReplay");
  });
}

function validateStoredFunctions(
  manifest: ApplicationManifestV1,
  publication: typeof fxSystemApplicationPublicationsV1.$inferSelect,
  rows: ReadonlyArray<typeof fxSystemApplicationFunctionsV1.$inferSelect>,
): Effect.Effect<void, ApplicationReadinessError> {
  return Effect.gen(function* () {
    for (let index = 0; index < manifest.functions.length; index += 1) {
      const fn = manifest.functions[index];
      const row = rows[index];
      if (fn === undefined || row === undefined || row.functionPath !== fn.path ||
        row.moduleName !== fn.moduleName || row.exportName !== fn.exportName ||
        row.functionKind !== fn.kind || row.visibility !== fn.visibility ||
        !bytesEqualFullScan(
          row.functionCatalogSha256,
          publication.functionCatalogSha256,
        )) return yield* readinessFailure("storedState");
      const bytes = yield* Effect.fromResult(
        applicationFunctionEntryPublicationFrameV1(fn).pipe(
          Result.mapError(cause => readinessFailureValue(
            "storedState",
            false,
            cause,
          )),
        ),
      );
      if (!bytesEqualFullScan(bytes, row.entryBytes) ||
        !bytesEqualFullScan(yield* sha256(bytes), row.entrySha256)) {
        return yield* readinessFailure("storedState");
      }
    }
  });
}

const decodeStoredManifest = Effect.fn(
  "ApplicationReadiness.decodeStoredManifest",
)(function* (
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
): Effect.fn.Return<ApplicationManifestV1, ApplicationReadinessError> {
  if (!bytesEqualFullScan(yield* sha256(bytes), expectedSha256)) {
    return yield* readinessFailure("storedState");
  }
  const value = yield* Effect.try({
    try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
    catch: cause => readinessFailureValue("storedState", false, cause),
  });
  const canonical = yield* Effect.fromResult(
    canonicalizeApplicationManifestV1(value).pipe(
      Result.mapError(cause => readinessFailureValue(
        "storedState",
        false,
        cause,
      )),
    ),
  );
  if (!bytesEqualFullScan(canonical.canonicalBytes, bytes)) {
    return yield* readinessFailure("storedState");
  }
  return canonical.manifest;
});

function requireExactAuthority(
  authority: ApplicationReadinessAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, ApplicationReadinessError> {
  return clock.scopeId === authority.scopeId &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Effect.void
    : readinessFailure("authorityChanged");
}

function storedBundlesEqual(left: StoredBundle, right: StoredBundle): boolean {
  if (left.deploymentId !== right.deploymentId ||
    left.authority.scopeId !== right.authority.scopeId ||
    left.authority.storageGeneration !== right.authority.storageGeneration ||
    left.authority.storageGenerationFence !==
      right.authority.storageGenerationFence ||
    left.authority.epoch !== right.authority.epoch ||
    left.revision.revisionId !== right.revision.revisionId ||
    left.revision.candidateId !== right.revision.candidateId ||
    left.revision.analysisId !== right.revision.analysisId ||
    left.publication.revisionId !== right.publication.revisionId ||
    left.task.revisionId !== right.task.revisionId ||
    left.functions.length !== right.functions.length ||
    !bytesEqualFullScan(
      left.revision.sourceArtifactRootSha256,
      right.revision.sourceArtifactRootSha256,
    ) ||
    !bytesEqualFullScan(
      left.revision.manifestSha256,
      right.revision.manifestSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.publicationSha256,
      right.publication.publicationSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.schemaSha256,
      right.publication.schemaSha256,
    ) ||
    !bytesEqualFullScan(
      left.publication.functionCatalogSha256,
      right.publication.functionCatalogSha256,
    ) ||
    !bytesEqualFullScan(
      left.task.taskCatalogBindingSha256,
      right.task.taskCatalogBindingSha256,
    ) ||
    left.task.runtimeHostIdentity !== right.task.runtimeHostIdentity ||
    left.task.compatibilityDate !== right.task.compatibilityDate) return false;
  return left.functions.every((entry, index) => {
    const other = right.functions[index];
    return other !== undefined && entry.functionPath === other.functionPath &&
      bytesEqualFullScan(entry.entrySha256, other.entrySha256);
  });
}

const readyProjection = Effect.fn("ApplicationReadiness.issueReadyProjection")(function* (
  disposition: "inserted" | "replayed",
  prepared: PreparedReadiness,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
  readyAt: Date,
  issuer: ApplicationReadinessRepositoryIssuerV1,
): Effect.fn.Return<ApplicationReadinessResult, ApplicationReadinessError> {
  const result = Object.freeze({
    status: "ready",
    disposition,
    scopeId: prepared.bundle.revision.scopeId,
    revisionId: prepared.bundle.revision.revisionId,
    schemaVersionId: prepared.schema.schemaVersionId,
    readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
    readinessBytes: copyBytes(readinessBytes),
    readyAt: new Date(readyAt.getTime()),
  } as const);
  issuedReadinessStates.set(result, Object.freeze({
    kind: "prepared",
    issuer,
    prepared,
    readinessSha256: copyBytes(readinessSha256),
    readinessBytes: copyBytes(readinessBytes),
  }));
  yield* registerHostPreparationDisposal(() => { issuedReadinessStates.delete(result); }).pipe(
    Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  return result;
});

const storedReadyProjection = Effect.fn("ApplicationReadiness.issueStoredReadyProjection")(function* (
  stored: StoredReadinessAuthority,
  issuer: ApplicationReadinessRepositoryIssuerV1,
  profile: "request" | "retained" = "retained",
): Effect.fn.Return<ApplicationReadinessResult, ApplicationReadinessError> {
  const result = Object.freeze({
    status: "ready",
    disposition: "replayed",
    scopeId: stored.bundle.revision.scopeId,
    revisionId: stored.bundle.revision.revisionId,
    schemaVersionId: stored.schema.schemaVersionId,
    readinessSha256: encodeBytesToLowercaseHex(stored.readinessSha256),
    readinessBytes: copyBytes(stored.readinessBytes),
    readyAt: new Date(stored.readyAt.getTime()),
  } as const);
  issuedReadinessStates.set(result, Object.freeze({
    kind: "stored",
    issuer,
    lifetime: profile === "retained" ? yield* captureHostPreparationLifetime() : undefined,
    stored,
    readinessSha256: copyBytes(stored.readinessSha256),
    readinessBytes: copyBytes(stored.readinessBytes),
  }));
  if (profile === "retained") {
    yield* registerHostPreparationDisposal(() => { issuedReadinessStates.delete(result); }).pipe(
      Effect.mapError(cause => readinessFailureValue("resourceFailure", false, cause)));
  }
  return result;
});

function activationBasis(
  state: IssuedApplicationReadinessState,
): ApplicationReadinessActivationBasis {
  const bundle = state.kind === "prepared"
    ? state.prepared.bundle
    : state.stored.bundle;
  const schema = state.kind === "prepared"
    ? state.prepared.schema
    : state.stored.schema;
  const schemaBindingSha256 = state.kind === "prepared"
    ? state.prepared.schemaBindingSha256
    : state.stored.schemaBindingSha256;
  const runtimeHostIdentity = state.kind === "prepared"
    ? state.prepared.runtimeHostIdentity
    : state.stored.cold.runtimeHostIdentity;
  const compatibilityDate = state.kind === "prepared"
    ? state.prepared.compatibilityDate
    : state.stored.cold.compatibilityDate;
  return Object.freeze({
    authority: Object.freeze({
      ...bundle.authority,
      physicalLocator: Object.freeze({
        ...bundle.authority.physicalLocator,
      }),
    }),
    physicalRequirements: state.kind === "prepared" ? state.prepared.requirements : state.stored.requirements,
    deploymentId: bundle.deploymentId,
    revisionId: bundle.revision.revisionId,
    candidateId: bundle.revision.candidateId,
    analysisId: bundle.revision.analysisId,
    sourceArtifactRootSha256:
      copyBytes(bundle.revision.sourceArtifactRootSha256),
    manifestSha256: copyBytes(bundle.revision.manifestSha256),
    manifest: bundle.manifest,
    publicationSha256:
      copyBytes(bundle.publication.publicationSha256),
    functionCatalogSha256:
      copyBytes(bundle.publication.functionCatalogSha256),
    applicationSchemaSha256:
      copyBytes(bundle.publication.schemaSha256),
    schemaVersionId: schema.schemaVersionId,
    schemaManifestSha256: decodeSha256(schema.schemaManifestSha256),
    schemaBindingSha256: copyBytes(schemaBindingSha256),
    taskCatalogSha256: copyBytes(bundle.task.taskCatalogSha256),
    taskCatalogBindingSha256:
      copyBytes(bundle.task.taskCatalogBindingSha256),
    runtimeHostIdentity,
    compatibilityDate,
    readinessSha256: copyBytes(state.readinessSha256),
  });
}

function notReady(
  revisionId: string,
  reason: ApplicationReadinessNotReadyReason,
  detail?: string,
): Extract<ApplicationReadinessResult, { readonly status: "not_ready" }> {
  return Object.freeze({
    status: "not_ready",
    revisionId,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
}

function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    UTF8.encode(value).byteLength <= 1_024;
}

function validRuntimeHostIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 &&
    isNulFreeScalarText(value);
}

function isNulFreeScalarText(value: string): boolean {
  if (value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function validCompatibilityDate(value: unknown): value is string {
  return isCanonicalCalendarDate(value);
}

function candidateNotReadyReason(
  reason: "missing" | "inProgress" | "failed" | "wrongSchema",
): ApplicationReadinessNotReadyReason {
  switch (reason) {
    case "missing": return "candidateValidationMissing";
    case "inProgress": return "candidateValidationInProgress";
    case "failed": return "candidateValidationFailed";
    case "wrongSchema": return "candidateValidationWrongSchema";
  }
}

function uniqueNotReadyReason(
  reason: "setNotClosed" | "buildMissing" | "buildNotEnabled" | "buildStale",
): ApplicationReadinessNotReadyReason {
  switch (reason) {
    case "setNotClosed": return "uniqueConstraintSetMissing";
    case "buildMissing": return "uniqueConstraintBuildMissing";
    case "buildNotEnabled": return "uniqueConstraintBuildNotEnabled";
    case "buildStale": return "uniqueConstraintBuildStale";
  }
}

function canonicalBytes(value: Readonly<Record<string, Json>>): Uint8Array {
  if (!isJson(value)) throw new Error("Application readiness frame is not JSON.");
  return UTF8.encode(encodeCanonicalJson(value, issue => {
    throw new Error(`Application readiness frame invariant: ${issue.reason}`);
  }));
}

function digestCanonicalJson(
  value: Readonly<Record<string, Json>>,
): Effect.Effect<Uint8Array> {
  return sha256(canonicalBytes(value));
}

function decodeSha256(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("Application readiness SHA-256 text is invalid.");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.tryPromise(() => crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )).pipe(Effect.map(buffer => new Uint8Array(buffer)), Effect.orDie);
}

function controlDatabaseTime(
  tx: AppRowTransaction,
  deploymentId: string,
): Effect.Effect<Date, ApplicationReadinessError> {
  return databaseTimeFromRows(query(
    tx.select({ now: sql<Date>`current_timestamp` }).from(deployments).where(
      eq(deployments.deploymentId, deploymentId),
    ).limit(1),
  ));
}

function targetDatabaseTime(
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
): Effect.Effect<Date, ApplicationReadinessError> {
  return databaseTimeFromRows(query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ));
}

function databaseTimeFromRows(
  rowsEffect: Effect.Effect<ReadonlyArray<{ readonly now: Date }>, ApplicationReadinessError>,
): Effect.Effect<Date, ApplicationReadinessError> {
  return rowsEffect.pipe(Effect.flatMap(rows => {
    const value = databaseTimestampFromUnknown(rows[0]?.now);
    return value === null
      ? readinessFailure("storedState")
      : Effect.succeed(value);
  }));
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationReadinessError> {
  return runDrizzleStatementEffect(
    statement,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableDrizzleStatementCause(cause),
      cause,
    ),
  );
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationReadinessError> {
  return runDrizzleStatementEffect(
    statement,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableDrizzleStatementCause(cause),
      cause,
    ),
  ).pipe(Effect.asVoid);
}

function retryableDrizzleStatementCause(cause: unknown): boolean {
  return isRetryableSqlTransactionCause(
    cause instanceof DrizzleQueryError ? cause.cause : cause,
  );
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<A, ApplicationReadinessError>,
): Effect.Effect<A, ApplicationReadinessError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application readiness transaction rolled back.",
    body,
    cause => readinessFailureValue(
      "resourceFailure",
      retryableCause(cause),
      cause,
    ),
  );
}

const runLocatedTransaction = Effect.fn(
  "ApplicationReadiness.runLocatedTransaction",
)(function* <A, E>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<A, E>,
): Effect.fn.Return<A, E | ApplicationReadinessError> {
    const rollbackSignal = Object.freeze({
      kind: "ApplicationReadinessRollback",
    });
    let callbackCause: Cause.Cause<E> | undefined;
    const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
      const result = await Effect.runPromiseExit(body(tx));
      if (Exit.isSuccess(result)) return result.value;
      callbackCause = result.cause;
      throw rollbackSignal;
    });
    const settled = yield* Effect.uninterruptible(Effect.exit(
      Effect.tryPromise({
        try: () => promise,
        catch: cause => cause,
      }),
    ));
    if (Exit.isSuccess(settled)) return settled.value;
    const error = Cause.findErrorOption(settled.cause);
    if (error._tag === "None") {
      return yield* Effect.failCause(Cause.map(
        settled.cause,
        cause => readinessFailureValue(
          "resourceFailure",
          false,
          cause,
        ),
      ));
    }
    const cause = error.value;
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === rollbackSignal &&
      callbackCause !== undefined) {
      return yield* Effect.failCause(callbackCause);
    }
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      cause.issue.callbackCause === rollbackSignal &&
      callbackCause !== undefined) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(readinessFailureValue(
          "resourceFailure",
          false,
          cause,
        )),
      ));
    }
    if (cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "decisionUncertain") {
      return yield* readinessFailure("decisionUncertain", false, cause);
    }
    return yield* readinessFailure(
      "resourceFailure",
      retryableCause(cause),
      cause,
    );
  },
);

function retryableCause(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function readinessFailure(
  reason: ApplicationReadinessError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationReadinessError> {
  return Effect.fail(readinessFailureValue(reason, retryable, cause));
}

function readinessFailureValue(
  reason: ApplicationReadinessError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationReadinessError {
  return new ApplicationReadinessError({
    operation: "settle",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

function readinessFailureForOperationValue(
  operation: ApplicationReadinessError["operation"],
  error: ApplicationReadinessError,
): ApplicationReadinessError {
  if (error.operation === operation) return error;
  return new ApplicationReadinessError({
    operation,
    reason: error.reason,
    retryable: error.retryable,
    ...("cause" in error ? { cause: error.cause } : {}),
  });
}
