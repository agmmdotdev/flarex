import type { CatalogSchemaVersion } from "flarex-protocol/schema-manifest";
import type { ApplicationSchemaAuthority } from "../applicationSchemaAuthority";
import type {
  PublishedPhysicalRequirementSnapshotV1,
} from "../../storage/indexes/indexBuildReconciliation";
import type {
  AppSchemaCandidateReadinessEvidence,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type {
  AppUniqueConstraintSetEligibilityResultV1,
  AppUniqueConstraintSetPreparation,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type {
  PreparedPhysicalDefinitionLifecycleReadiness,
} from "../../installation/physicalDefinitionLifecycle";
import type {
  StoredBundle,
  CapturedBundleSelection,
} from "./bundle";
import type {
  ColdEvidence,
  PreparedColdEvidence,
} from "./coldEvidence";
import type { ApplicationReadinessContext } from "./constructionContracts";
import type { LocatedReadCommittedAttemptTargetV1 } from "../../execution/transactionSessionAttemptKernel";
import type { FlarexMetadataDatabase } from "../deployments";
import type {
  ProtectedMetadataPreparation,
  ProtectedMetadataEpochIdentity,
} from "../../execution/preparation/preparedMetadataEpoch";
import type {
  ApplicationReadinessProtection,
  OriginalApplicationControlRead,
  ApplicationReadinessRepository,
  ApplicationReadinessResult,
  PreparedApplicationReadinessActivation,
  ApplicationActivationTargetPreparation,
  ApplicationReadinessAuthority,
  CapturedApplicationReadiness,
  ApplicationReadinessActivationBasis,
} from "./contracts";
import {
  Effect,
  Result,
} from "effect";
import {
  captureHostPreparationLifetime,
  registerHostPreparationDisposal,
} from "../../execution/preparation/preparedHostRuntime";
import {
  readinessFailureValue,
  type ApplicationReadinessError,
} from "./errors";
import type {
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "../../database/schema";
import type {
  CapturedApplicationTaskCatalogRows,
  ApplicationTaskCatalogSnapshotError,
} from "../tasks/applicationTaskBindings";
import type { TrustedScopeAuthorityResolutionPorts } from "../../scope/scopeAuthorityResolution";
import {
  encodeBytesToLowercaseHex,
  copyBytes,
} from "@flarex/utils/bytes";
import { decodeSha256 } from "./frames";

export interface PreparedReadiness {
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
export type ApplicationReadinessRepositoryIssuerV1 = {
  readonly __flarexApplicationReadinessRepositoryIssuerV1: "FlarexPersistence/ApplicationReadinessRepositoryIssuerV1";
};

export interface ApplicationReadinessIssuerState {
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

export interface StoredReadinessAuthority {
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

export function snapshotReadinessProtection(protection: ApplicationReadinessProtection): ApplicationReadinessProtection {
  return Object.freeze({
    target: Object.freeze({ database: protection.target.database, token: protection.target.token,
      epoch: Object.freeze({ ...protection.target.epoch }) }),
    control: Object.freeze({ database: protection.control.database, token: protection.control.token,
      epoch: Object.freeze({ ...protection.control.epoch }) }),
  });
}

export function readinessEpochsEqual(left: ProtectedMetadataEpochIdentity, right: ProtectedMetadataEpochIdentity): boolean {
  return left.databaseName === right.databaseName && left.namespaceOid === right.namespaceOid &&
    left.incarnation === right.incarnation && left.generation === right.generation && left.login === right.login;
}

export function readinessProtectionMatches(original: ApplicationReadinessProtection, supplied: ApplicationReadinessProtection): boolean {
  return original.target.database === supplied.target.database && original.target.token === supplied.target.token &&
    original.control.database === supplied.control.database && original.control.token === supplied.control.token &&
    readinessEpochsEqual(original.target.epoch, supplied.target.epoch) &&
    readinessEpochsEqual(original.control.epoch, supplied.control.epoch);
}

export interface StoredIssuedApplicationReadinessState {
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

const readinessActivationViews = new WeakMap<PreparedApplicationReadinessActivation, Readonly<{
  owner: ApplicationReadinessIssuerState;
  issued: Extract<ApplicationReadinessResult, { readonly status: "ready" }>;
  target: ApplicationActivationTargetPreparation;
}>>();

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

const readinessCaptures = new WeakMap<CapturedApplicationReadiness, {
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
  readonly profile: "request" | "retained";
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly rows: CapturedReadinessRows;
}>();

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

export function hasApplicationReadinessComposition(
  repository: unknown,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  return typeof repository === "object" && repository !== null &&
    readinessRepositoryStates.get(repository)?.context.authority === authority;
}

export const readyProjection = Effect.fn("ApplicationReadiness.issueReadyProjection")(function* (
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

export const storedReadyProjection = Effect.fn("ApplicationReadiness.issueStoredReadyProjection")(function* (
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

export function activationBasis(
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

/** The repository constructor registers its exact captured context and issuer. */
export function registerApplicationReadinessRepository<SchemaFailure, ColdFailure>(
  repository: ApplicationReadinessRepository<SchemaFailure, ColdFailure>, state: ApplicationReadinessIssuerState,
): void {
  readinessRepositoryStates.set(repository, state);
}

export function createApplicationReadinessRepositoryIssuer(): ApplicationReadinessRepositoryIssuerV1 {
  // SAFETY: the issuer is an internal identity token; only this module
  // mints it, and WeakMap membership, not the brand property, carries proof.
  return Object.freeze({}) as ApplicationReadinessRepositoryIssuerV1;
}

export function readApplicationReadinessIssuerState(repository: unknown): ApplicationReadinessIssuerState | undefined {
  return typeof repository === "object" && repository !== null ? readinessRepositoryStates.get(repository) : undefined;
}

export function readIssuedApplicationReadinessState(issued: Extract<ApplicationReadinessResult, { readonly status: "ready" }>): IssuedApplicationReadinessState | undefined {
  return issuedReadinessStates.get(issued);
}

export function readApplicationReadinessActivationState(preparation: PreparedApplicationReadinessActivation) {
  return readinessActivationViews.get(preparation);
}

export function registerApplicationReadinessActivation(preparation: PreparedApplicationReadinessActivation,
  state: Readonly<{ owner: ApplicationReadinessIssuerState; issued: Extract<ApplicationReadinessResult, { readonly status: "ready" }>; target: ApplicationActivationTargetPreparation }>): void {
  readinessActivationViews.set(preparation, state);
}

export function readApplicationReadinessCapture(capture: CapturedApplicationReadiness) {
  return readinessCaptures.get(capture);
}

export function registerApplicationReadinessCapture(capture: CapturedApplicationReadiness,
  state: Parameters<typeof readinessCaptures.set>[1]): void {
  readinessCaptures.set(capture, state);
}
