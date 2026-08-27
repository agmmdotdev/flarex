import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionCatalogPublicationFrameV2,
  applicationFunctionEntryPublicationFrameV2,
  applicationPublicationCommitmentFrameV2,
  applicationSchemaPublicationFrameV2,
} from "@flarex/analysis/internal/application-publication-v2";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import { appSchemaCandidateManifestSha256HexV1FromBytes } from
  "flarex-protocol/internal/app-schema-candidate-validation-v1";
import { encodeCanonicalJson, isJson, type Json } from "flarex-protocol/json";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
} from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  hasAppSchemaCandidateReadinessComposition,
  loadAppSchemaCandidateReadinessEffect,
  validateAppSchemaCandidateReadinessInTransactionEffect,
  type AppSchemaCandidateReadinessEvidence,
  type AppSchemaCandidateReadinessPort,
  type LoadAppSchemaCandidateReadinessError,
  type ValidateAppSchemaCandidateReadinessError,
} from "./appSchemaCandidateValidation";
import {
  type ApplicationPhysicalReadinessResult,
  type ApplicationReadinessAuthority,
  ApplicationReadinessError,
  validateApplicationPhysicalReadinessInTransactionEffect,
} from "./applicationReadiness";
import {
  ApplicationRelationSemanticValidationAttemptFenceSchema,
  getPreparedApplicationRelationReadinessDefinitions,
  hasApplicationRelationReadinessComposition,
  hasApplicationRelationSetReadinessEvidenceAuthority,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationSetReadinessEvidence,
  type ApplicationRelationSetReadinessReceipt,
  type PrepareApplicationRelationReadinessError,
  type PreparedApplicationRelationReadiness,
  type ValidateApplicationRelationSetReadinessError,
  validateApplicationRelationSetReadinessInTransactionEffect,
  validateReferencedApplicationRelationSetReadinessInTransactionEffect,
} from "./applicationRelationReadiness";
import type { LocatedApplicationRelationDefinitionSet } from
  "./applicationRelationCommit";
import type {
  ReadAppIndexDefinitionError,
  ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import {
  hasApplicationRelationSchemaAuthorityComposition,
  type ApplicationRelationSchemaAuthority,
  type ApplicationRelationSchemaAuthorityPort,
  type ResolveApplicationRelationSchemaAuthorityError,
} from "./applicationRelationSchemaAuthority";
import {
  fxSystemApplicationFunctions,
  fxSystemApplicationPublications,
  fxSystemApplicationReadiness,
  fxSystemApplicationReadinessRelations,
  fxSystemApplicationRevisionSchemas,
} from "./applicationRelationSchema";
import {
  isApplicationRelationTaskCatalogSnapshotPort,
  type ApplicationRelationTaskCatalogSnapshotPort,
} from "./applicationRelationTaskBindings";
import type {
  ApplicationTaskCatalogSnapshot,
  ApplicationTaskCatalogSnapshotError,
} from "./applicationTaskBindings";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { detachDriverRows } from "./detachDriverRows";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  type IndexBuildReconciliationCatalogV1Error,
  type PublishedPhysicalRequirementSnapshotV1,
} from "./indexBuildReconciliation";
import {
  preparePhysicalDefinitionLifecycleReadinessEffect,
  hasPhysicalDefinitionLifecycleComposition,
  type PhysicalDefinitionLifecyclePort,
  type PreparedPhysicalDefinitionLifecycleReadiness,
  type PreparePhysicalDefinitionLifecycleReadinessError,
  type ValidatePhysicalDefinitionLifecycleReadinessError,
} from "./physicalDefinitionLifecycle";
import {
  loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect,
  validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect,
  type LoadPointCommitUniqueConstraintEligibilityV1Error,
  type ValidatePointCommitUniqueConstraintEligibilityV1Error,
  type PointCommitPublisherPortV1,
} from "./pointCommitTransaction";
import type { AppUniqueConstraintSetEligibilityResultV1 } from
  "./appUniqueConstraintSetBuildV1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import type { ReadSchemaVersionArtifactError } from
  "./schemaVersionArtifacts";
import {
  isRetryableLocatedReadCommittedTransactionFailure,
  isRetryableSqlTransactionCause,
  runLocatedReadCommittedEffect,
} from
  "./locatedReadCommittedEffect";
import {
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationRevisionsV2,
  fxSystemScopeClocks,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAXIMUM_FUNCTIONS = 4_096;
const MAXIMUM_PHYSICAL_DEFINITIONS = 16_384;

export interface ApplicationRelationReadinessFoldContext {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly schema: ApplicationRelationSchemaAuthorityPort;
  readonly taskCatalog: ApplicationRelationTaskCatalogSnapshotPort;
  readonly candidateValidation: AppSchemaCandidateReadinessPort;
  readonly pointCommit: PointCommitPublisherPortV1;
  readonly physicalDefinitionLifecycle: PhysicalDefinitionLifecyclePort;
  readonly relations: ApplicationRelationReadinessPort;
}

export type ApplicationRelationReadinessFoldNotReadyReason =
  | "revisionMissing"
  | "publicationMissing"
  | "taskCatalogMissing"
  | "candidateValidationMissing"
  | "candidateValidationInProgress"
  | "candidateValidationFailed"
  | "candidateValidationWrongSchema"
  | "physicalBuildMissing"
  | "physicalBuildNotEnabled"
  | "physicalDefinitionNotActive"
  | "uniqueConstraintSetMissing"
  | "uniqueConstraintBuildMissing"
  | "uniqueConstraintBuildNotEnabled"
  | "uniqueConstraintBuildStale"
  | "relationPhysicalReadinessMissing"
  | "relationSemanticReadinessIncomplete";

export type ApplicationRelationReadinessFoldResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly revisionId: string;
      readonly reason: ApplicationRelationReadinessFoldNotReadyReason;
      readonly detail?: string;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly disposition: "inserted" | "replayed";
      readonly scopeId: ApplicationReadinessAuthority["scopeId"];
      readonly revisionId: string;
      readonly schemaVersionId: ApplicationRelationSchemaAuthority[
        "schemaVersionId"
      ];
      readonly readinessSha256: string;
      readonly readinessBytes: Uint8Array;
      readonly relationSetReadinessSha256: string;
      readonly relationCount: number;
      readonly readyAt: Date;
    }>;

export class ApplicationRelationReadinessFoldError extends Data.TaggedError(
  "ApplicationRelationReadinessFoldError",
)<{
  readonly operation: "settle" | "readReady" | "validate";
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "authorityChanged"
    | "storedState"
    | "schemaBinding"
    | "conflictingReplay"
    | "decisionUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class ApplicationRelationReadinessFoldIssue extends Data.TaggedError(
  "ApplicationRelationReadinessFoldIssue",
)<{
  readonly reason: ApplicationRelationReadinessFoldError["reason"];
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type SettleApplicationRelationReadinessFoldError =
  | ApplicationRelationReadinessFoldError
  | ApplicationReadinessError
  | ApplicationTaskCatalogSnapshotError
  | ResolveApplicationRelationSchemaAuthorityError
  | TrustedScopeAuthorityError
  | LoadAppSchemaCandidateReadinessError
  | ValidateAppSchemaCandidateReadinessError
  | LoadPointCommitUniqueConstraintEligibilityV1Error
  | ValidatePointCommitUniqueConstraintEligibilityV1Error
  | IndexBuildReconciliationCatalogV1Error
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | ReadSchemaVersionArtifactError
  | PreparePhysicalDefinitionLifecycleReadinessError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | PrepareApplicationRelationReadinessError
  | ValidateApplicationRelationSetReadinessError
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError;

export type ReadApplicationRelationReadinessFoldError =
  SettleApplicationRelationReadinessFoldError;

type InternalApplicationRelationReadinessFoldError =
  | ApplicationRelationReadinessFoldIssue
  | Exclude<
      SettleApplicationRelationReadinessFoldError,
      ApplicationRelationReadinessFoldError
    >;

export interface ApplicationRelationReadinessFoldRepository {
  readonly settle: (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationRelationReadinessFoldResult,
    SettleApplicationRelationReadinessFoldError
  >;
  readonly readReady: (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationRelationReadinessFoldResult,
    ReadApplicationRelationReadinessFoldError
  >;
  /** Authenticates immutable stored readiness for an already-active head. */
  readonly readActiveReady: (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationRelationReadinessFoldResult,
    ReadApplicationRelationReadinessFoldError
  >;
}

export interface ApplicationRelationReadinessActivationBasis {
  readonly authority: ApplicationReadinessAuthority;
  readonly deploymentId: string;
  readonly revisionId: string;
  readonly candidateId: string;
  readonly analysisId: string;
  readonly sourceArtifactRootSha256: Uint8Array;
  readonly manifestSha256: Uint8Array;
  readonly manifest: ApplicationManifestV2;
  readonly publicationSha256: Uint8Array;
  readonly functionCatalogSha256: Uint8Array;
  readonly applicationSchemaSha256: Uint8Array;
  readonly schemaVersionId: ApplicationRelationSchemaAuthority[
    "schemaVersionId"
  ];
  readonly schemaManifestSha256: Uint8Array;
  readonly manifestSchemaBindingSha256: Uint8Array;
  readonly boundPublicationSha256: Uint8Array;
  readonly taskCatalogSha256: Uint8Array;
  readonly taskCatalogBindingSha256: Uint8Array;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly readinessSha256: Uint8Array;
  readonly relationFrontierCommitSeq: string;
  readonly relationSetReadinessSha256: Uint8Array;
  readonly relationCount: number;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
}

export type ApplicationRelationReadinessActivationValidation =
  | Extract<
      ApplicationRelationReadinessFoldResult,
      { readonly status: "not_ready" }
    >
  | Readonly<{
      readonly status: "ready";
      readonly basis: ApplicationRelationReadinessActivationBasis;
    }>;

type StoredApplicationRelationReadinessActivationValidation = Extract<
  ApplicationRelationReadinessActivationValidation,
  { readonly status: "ready" }
>;

interface FoldRepositoryState {
  readonly context: ApplicationRelationReadinessFoldContext;
}

interface ApplicationRelationSetReadinessEvidenceSnapshot {
  readonly receipt: ApplicationRelationSetReadinessEvidence["receipt"];
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

const repositoryStates = new WeakMap<object, FoldRepositoryState>();
interface IssuedReadyResultState {
  readonly kind: "prepared" | "stored" | "active";
  readonly repository: FoldRepositoryState;
  readonly deploymentId: string;
  readonly prepared: PreparedFold;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
  readonly relationEvidence: ApplicationRelationSetReadinessEvidenceSnapshot;
  readonly readyAt: Date;
}
const issuedReadyResults = new WeakMap<object, IssuedReadyResultState>();

export function makeApplicationRelationReadinessFoldRepository(
  context: ApplicationRelationReadinessFoldContext,
): ApplicationRelationReadinessFoldRepository {
  const captured = Object.freeze({ ...context });
  const state = Object.freeze({ context: captured });
  const compositionIsExact = () =>
    hasApplicationRelationSchemaAuthorityComposition(
      captured.schema,
      captured.controlDb,
    ) &&
    isApplicationRelationTaskCatalogSnapshotPort(captured.taskCatalog) &&
    hasAppSchemaCandidateReadinessComposition(
      captured.candidateValidation,
      captured.controlDb,
      captured.authority,
    ) &&
    hasPhysicalDefinitionLifecycleComposition(
      captured.physicalDefinitionLifecycle,
      captured.controlDb,
      captured.authority,
    ) &&
    hasApplicationRelationReadinessComposition(
      captured.relations,
      captured.controlDb,
      captured.authority,
    );

  const settleOperation = Effect.fn("ApplicationRelationReadinessFold.settle")(
    function* (input: {
      readonly deploymentId: string;
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationRelationReadinessFoldResult,
      InternalApplicationRelationReadinessFoldError
    > {
      const preparation = yield* prepareFold(
        input,
        captured,
        compositionIsExact,
        "current",
      );
      if ("status" in preparation) return preparation;
      return yield* runLocatedTransaction(
        preparation.target,
        tx => settleInTransaction(
          tx,
          preparation.prepared,
          captured,
          state,
        ),
      );
    },
  );
  const readReadyOperation = Effect.fn(
    "ApplicationRelationReadinessFold.readReady",
  )(function* (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }): Effect.fn.Return<
    ApplicationRelationReadinessFoldResult,
    InternalApplicationRelationReadinessFoldError
  > {
    const preparation = yield* prepareFold(
      input,
      captured,
      compositionIsExact,
      "current",
    );
    if ("status" in preparation) return preparation;
    return yield* runLocatedTransaction(
      preparation.target,
      tx => readReadyInTransaction(
        tx,
        preparation.prepared,
        captured,
        state,
      ),
    );
  });
  const readActiveReadyOperation = Effect.fn(
    "ApplicationRelationReadinessFold.readActiveReady",
  )(function* (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }): Effect.fn.Return<
    ApplicationRelationReadinessFoldResult,
    InternalApplicationRelationReadinessFoldError
  > {
    const preparation = yield* prepareFold(
      input,
      captured,
      compositionIsExact,
      "storedActive",
    );
    if ("status" in preparation) return preparation;
    return yield* runLocatedTransaction(
      preparation.target,
      tx => readActiveReadyInTransaction(
        tx,
        preparation.prepared,
        captured,
        state,
      ),
    );
  });
  const settle: ApplicationRelationReadinessFoldRepository["settle"] =
    input => settleOperation(input).pipe(
      Effect.mapError(error => exposeFoldIssue("settle", error)),
    );
  const readReady: ApplicationRelationReadinessFoldRepository["readReady"] =
    input => readReadyOperation(input).pipe(
      Effect.mapError(error => exposeFoldIssue("readReady", error)),
    );
  const readActiveReady:
    ApplicationRelationReadinessFoldRepository["readActiveReady"] =
      input => readActiveReadyOperation(input).pipe(
        Effect.mapError(error => exposeFoldIssue("readReady", error)),
      );
  const repository = Object.freeze({ settle, readReady, readActiveReady });
  repositoryStates.set(repository, state);
  return repository;
}

export function hasApplicationRelationReadinessFoldAuthority(
  repository: ApplicationRelationReadinessFoldRepository,
  value: unknown,
): value is Extract<
  ApplicationRelationReadinessFoldResult,
  { readonly status: "ready" }
> {
  if (typeof value !== "object" || value === null) return false;
  const repositoryState = repositoryStates.get(repository);
  return repositoryState !== undefined &&
    issuedReadyResults.get(value)?.repository === repositoryState;
}

export function hasApplicationRelationReadinessFoldComposition(
  repository: unknown,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): repository is ApplicationRelationReadinessFoldRepository {
  return typeof repository === "object" && repository !== null &&
    repositoryStates.get(repository)?.context.authority === authority;
}

/** Exact private composition/correlation check used by O10-R capability minting. */
export function hasApplicationRelationReadinessFoldAuthorityFor(
  repository: ApplicationRelationReadinessFoldRepository,
  value: unknown,
  controlDb: FlarexMetadataDatabase,
  deploymentId: string,
): value is Extract<
  ApplicationRelationReadinessFoldResult,
  { readonly status: "ready" }
> {
  if (!hasApplicationRelationReadinessFoldAuthority(repository, value)) {
    return false;
  }
  const repositoryState = repositoryStates.get(repository);
  const issued = issuedReadyResults.get(value);
  return repositoryState?.context.controlDb === controlDb &&
    issued?.repository === repositoryState &&
    issued.deploymentId === deploymentId;
}

/** Recovers only the exact E01-B/R02 set retained by this issued result. */
export function getApplicationRelationReadinessFoldDefinitions(
  repository: ApplicationRelationReadinessFoldRepository,
  value: unknown,
): LocatedApplicationRelationDefinitionSet | null {
  if (!hasApplicationRelationReadinessFoldAuthority(repository, value)) {
    return null;
  }
  const repositoryState = repositoryStates.get(repository);
  const issued = issuedReadyResults.get(value);
  if (repositoryState === undefined || issued?.repository !== repositoryState) {
    return null;
  }
  return getPreparedApplicationRelationReadinessDefinitions(
    repositoryState.context.relations,
    issued.prepared.relations,
  );
}

export interface ApplicationRelationReadinessFoldDefinitionAuthority {
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly storageGenerationFence:
    ApplicationReadinessAuthority["storageGenerationFence"];
  readonly epoch: ApplicationReadinessAuthority["epoch"];
}

export function getApplicationRelationReadinessFoldDefinitionAuthority(
  repository: ApplicationRelationReadinessFoldRepository,
  value: unknown,
): ApplicationRelationReadinessFoldDefinitionAuthority | null {
  const definitions = getApplicationRelationReadinessFoldDefinitions(
    repository,
    value,
  );
  const issued = typeof value === "object" && value !== null
    ? issuedReadyResults.get(value)
    : undefined;
  if (definitions === null || issued === undefined) return null;
  return Object.freeze({
    definitions,
    storageGenerationFence:
      issued.prepared.bundle.authority.storageGenerationFence,
    epoch: issued.prepared.bundle.authority.epoch,
  });
}

export const validateApplicationRelationReadinessForActivationInTransaction =
  Effect.fn(
    "ApplicationRelationReadinessFold.validateForActivationInTransaction",
  )(function* (
    repository: unknown,
    issued: ApplicationRelationReadinessFoldResult,
    tx: AppRowTransaction,
    currentClock: ScopeClockRecord,
  ): Effect.fn.Return<
    ApplicationRelationReadinessActivationValidation,
    SettleApplicationRelationReadinessFoldError
  > {
    return yield* validateIssuedRelationReadinessForActivation(
      "prepared",
      repository,
      issued,
      tx,
      currentClock,
    ).pipe(
      Effect.mapError(error => exposeFoldIssue("validate", error)),
    );
  });

export const validateStoredApplicationRelationReadinessForActivationInTransaction =
  Effect.fn(
    "ApplicationRelationReadinessFold.validateStoredForActivationInTransaction",
  )(function* (
    repository: unknown,
    issued: ApplicationRelationReadinessFoldResult,
    tx: AppRowTransaction,
    currentClock: ScopeClockRecord,
  ): Effect.fn.Return<
    StoredApplicationRelationReadinessActivationValidation,
    SettleApplicationRelationReadinessFoldError
  > {
    const validation = yield* validateIssuedRelationReadinessForActivation(
      "stored",
      repository,
      issued,
      tx,
      currentClock,
    ).pipe(
      Effect.mapError(error => exposeFoldIssue("validate", error)),
    );
    return validation.status === "ready"
      ? validation
      : yield* failureForOperation("validate", "authorityChanged");
  });

export const validateActiveApplicationRelationReadinessInTransaction =
  Effect.fn(
    "ApplicationRelationReadinessFold.validateActiveInTransaction",
  )(function* (
    repository: unknown,
    issued: ApplicationRelationReadinessFoldResult,
    tx: AppRowTransaction,
    currentClock: ScopeClockRecord,
  ): Effect.fn.Return<
    StoredApplicationRelationReadinessActivationValidation,
    SettleApplicationRelationReadinessFoldError
  > {
    const validation = yield* validateIssuedRelationReadinessForActivation(
      "active",
      repository,
      issued,
      tx,
      currentClock,
    ).pipe(
      Effect.mapError(error => exposeFoldIssue("validate", error)),
    );
    return validation.status === "ready"
      ? validation
      : yield* failureForOperation("validate", "authorityChanged");
  });

interface StoredBundle {
  readonly authority: ApplicationReadinessAuthority;
  readonly deploymentId: string;
  readonly revision: typeof fxSystemApplicationRevisionsV2.$inferSelect;
  readonly publication: typeof fxSystemApplicationPublications.$inferSelect;
  readonly manifest: ApplicationManifestV2;
  readonly functions: ReadonlyArray<
    typeof fxSystemApplicationFunctions.$inferSelect
  >;
  readonly task: ApplicationTaskCatalogSnapshot;
}

interface PreparedFold {
  readonly bundle: StoredBundle;
  readonly schema: ApplicationRelationSchemaAuthority;
  readonly requirements: PublishedPhysicalRequirementSnapshotV1;
  readonly candidate: PreparedCandidateValidation;
  readonly unique: Exclude<
    AppUniqueConstraintSetEligibilityResultV1,
    { readonly status: "not_ready" }
  >;
  readonly uniqueSha256: Uint8Array;
  readonly physicalLifecycle: PreparedPhysicalDefinitionLifecycleReadiness;
  readonly relations: PreparedApplicationRelationReadiness;
  readonly coldReceiptSetSha256: Uint8Array;
}

type PreparedCandidateValidation =
  | Readonly<{
      readonly kind: "current";
      readonly evidence: AppSchemaCandidateReadinessEvidence;
    }>
  | Readonly<{
      readonly kind: "storedActive";
      readonly receiptSha256: Uint8Array;
    }>;

type StoredActivePreparedCandidateValidation = Extract<
  PreparedCandidateValidation,
  { readonly kind: "storedActive" }
>;

interface PreparedFoldLocation {
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly prepared: PreparedFold;
}

const prepareFold = Effect.fn("ApplicationRelationReadinessFold.prepare")(
  function* (
    input: { readonly deploymentId: string; readonly revisionId: string },
    context: ApplicationRelationReadinessFoldContext,
    compositionIsExact: () => boolean,
    mode: "current" | "storedActive",
  ): Effect.fn.Return<
    PreparedFoldLocation | Extract<
      ApplicationRelationReadinessFoldResult,
      { readonly status: "not_ready" }
    >,
    InternalApplicationRelationReadinessFoldError
  > {
    if (!validIdentity(input.deploymentId) ||
      !validIdentity(input.revisionId)) {
      return yield* failure("invalidInput");
    }
    if (!compositionIsExact()) return yield* failure("invalidComposition");
    const capturedInput = Object.freeze({ ...input });
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      capturedInput.deploymentId,
      context.authority,
    );
    if (located.authority.storageGeneration !== "flarexdb_v1") {
      return yield* failure("authorityChanged");
    }
    const authority: ApplicationReadinessAuthority = Object.freeze({
      ...located.authority,
      physicalLocator: Object.freeze({ ...located.authority.physicalLocator }),
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    });
    const bundle = yield* runLocatedTransaction(
      located.target,
      tx => reserveBundle(
        tx,
        authority,
        capturedInput,
        context.taskCatalog,
        "share",
      ),
    );
    if ("status" in bundle) return bundle;
    const schema = yield* context.schema.resolve({
      deploymentId: bundle.deploymentId,
      applicationManifestSha256:
        encodeBytesToLowercaseHex(bundle.revision.manifestSha256),
      manifest: bundle.manifest,
    });
    yield* requireSchemaCorrelation(bundle, schema);
    const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
      context.controlDb,
      Object.freeze({
        deploymentId: bundle.deploymentId,
        schemaVersionId: schema.schemaVersionId,
      }),
    );
    if (
      requirements === null ||
      encodeBytesToLowercaseHex(requirements.manifestSha256) !==
        schema.schemaManifestSha256 ||
      requirements.definitions.length > MAXIMUM_PHYSICAL_DEFINITIONS
    ) return yield* failure("storedState");
    let candidate: PreparedCandidateValidation;
    if (mode === "current") {
      const currentCandidate = yield* loadAppSchemaCandidateReadinessEffect(
        context.candidateValidation,
        Object.freeze({
          deploymentId: bundle.deploymentId,
          scopeId: bundle.authority.scopeId,
          schemaVersionId: schema.schemaVersionId,
          schemaManifestSha256Hex:
            appSchemaCandidateManifestSha256HexV1FromBytes(
              requirements.manifestSha256,
            ),
        }),
      );
      if (currentCandidate.status !== "ready") {
        return notReady(
          bundle.revision.revisionId,
          candidateNotReadyReason(currentCandidate.reason),
        );
      }
      candidate = Object.freeze({
        kind: "current",
        evidence: currentCandidate.evidence,
      });
    } else {
      candidate = yield* runLocatedTransaction(
        located.target,
        tx => loadStoredActiveCandidateValidationReceiptInTransaction(
          tx,
          bundle.authority,
          bundle.revision.revisionId,
        ),
      );
    }
    const unique = yield*
      loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
        context.pointCommit,
        Object.freeze({
          deploymentId: bundle.deploymentId,
          scopeId: bundle.authority.scopeId,
          schemaVersionId: schema.schemaVersionId,
        }),
        context.controlDb,
        context.authority,
      );
    if (unique.status === "not_ready") {
      return notReady(
        bundle.revision.revisionId,
        uniqueNotReadyReason(unique.reason),
        unique.lifecycle,
      );
    }
    const physicalLifecycle = yield*
      preparePhysicalDefinitionLifecycleReadinessEffect(
        context.physicalDefinitionLifecycle,
        bundle.authority.scopeId,
        requirements,
        unique,
      );
    const relations = yield* context.relations.prepare({
      deploymentId: bundle.deploymentId,
      applicationManifestSha256:
        encodeBytesToLowercaseHex(bundle.revision.manifestSha256),
    });
    yield* requireRelationCorrelation(bundle, schema, relations);
    const coldReceiptSetSha256 = yield* digestCanonicalJson({
      format: "flarex.application-cold-receipt-set",
      version: 1,
      runtimeHostIdentity: bundle.task.runtimeHostIdentity,
      compatibilityDate: bundle.task.compatibilityDate,
      entries: [],
    });
    const uniqueSha256 = yield* digestCanonicalJson(
      uniqueConstraintFrame(unique),
    );
    return Object.freeze({
      target: located.target,
      prepared: Object.freeze({
        bundle,
        schema,
        requirements,
        candidate,
        unique,
        uniqueSha256,
        physicalLifecycle,
        relations,
        coldReceiptSetSha256,
      }),
    });
  },
);

const loadStoredActiveCandidateValidationReceiptInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.loadStoredActiveCandidateValidationReceipt",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationReadinessAuthority,
  revisionId: string,
): Effect.fn.Return<
  StoredActivePreparedCandidateValidation,
  ApplicationRelationReadinessFoldIssue | LockScopeClockForShareError
> {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* requireExactAuthority(authority, clock);
  const rows = yield* query(
    tx.select({
      receiptSha256:
        fxSystemApplicationReadiness.candidateValidationReceiptSha256,
    }).from(fxSystemApplicationReadiness).where(and(
      eq(fxSystemApplicationReadiness.scopeId, authority.scopeId),
      eq(fxSystemApplicationReadiness.revisionId, revisionId),
    )).limit(1).for("share"),
  );
  const receiptSha256 = rows[0]?.receiptSha256;
  if (!isUint8ArrayWithByteLength(receiptSha256, 32)) {
    return yield* failure("storedState");
  }
  return Object.freeze({
    kind: "storedActive",
    receiptSha256: copyBytes(receiptSha256),
  });
});

function candidateValidationReceiptSha256Hex(
  candidate: PreparedCandidateValidation,
): string {
  return candidate.kind === "current"
    ? candidate.evidence.receiptSha256Hex
    : encodeBytesToLowercaseHex(candidate.receiptSha256);
}

const reserveBundle = Effect.fn("ApplicationRelationReadinessFold.reserve")(
  function* (
    tx: AppRowTransaction,
    authority: ApplicationReadinessAuthority,
    input: { readonly deploymentId: string; readonly revisionId: string },
    taskCatalog: ApplicationRelationTaskCatalogSnapshotPort,
    rowLock: "share" | "update",
    lockedClock?: ScopeClockRecord,
  ): Effect.fn.Return<
    StoredBundle | Extract<
      ApplicationRelationReadinessFoldResult,
      { readonly status: "not_ready" }
    >,
    | ApplicationRelationReadinessFoldIssue
    | ApplicationTaskCatalogSnapshotError
    | LockScopeClockForShareError
  > {
    const clock = lockedClock ??
      (yield* lockScopeClockForShareInTransactionEffect(
        tx,
        authority.scopeId,
      ));
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
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId, revision.candidateId),
      )).limit(1),
    );
    const candidate = candidateRows[0];
    if (
      candidate === undefined ||
      candidate.storageGeneration !== authority.storageGeneration ||
      candidate.storageGenerationFence !== authority.storageGenerationFence ||
      candidate.epoch !== authority.epoch ||
      !bytesEqualFullScan(
        candidate.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )
    ) return yield* failure("authorityChanged");
    const analysisRows = yield* query(
      tx.select().from(fxSystemApplicationAnalysesV1).where(and(
        eq(fxSystemApplicationAnalysesV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId, revision.analysisId),
      )).limit(1),
    );
    const analysis = analysisRows[0];
    if (
      analysis === undefined || analysis.status !== "analyzed" ||
      analysis.manifestBytes === null || analysis.manifestSha256 === null ||
      analysis.candidateId !== revision.candidateId ||
      !bytesEqualFullScan(analysis.manifestSha256, revision.manifestSha256) ||
      !bytesEqualFullScan(
        analysis.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )
    ) return yield* failure("storedState");
    const manifest = yield* decodeStoredManifest(
      analysis.manifestBytes,
      analysis.manifestSha256,
    );
    const publicationRows = yield* query(
      tx.select().from(fxSystemApplicationPublications).where(and(
        eq(fxSystemApplicationPublications.scopeId, revision.scopeId),
        eq(fxSystemApplicationPublications.revisionId, revision.revisionId),
      )).limit(1),
    );
    const publication = publicationRows[0];
    if (publication === undefined) {
      return notReady(input.revisionId, "publicationMissing");
    }
    if (
      publication.deploymentId !== input.deploymentId ||
      publication.candidateId !== revision.candidateId ||
      publication.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) ||
      !bytesEqualFullScan(publication.manifestSha256,
        revision.manifestSha256)
    ) return yield* failure("storedState");
    yield* validateStoredPublication(manifest, publication);
    const functionRows = yield* query(
      tx.select().from(fxSystemApplicationFunctions).where(and(
        eq(fxSystemApplicationFunctions.scopeId, revision.scopeId),
        eq(fxSystemApplicationFunctions.revisionId, revision.revisionId),
      )).limit(manifest.functions.length + 1),
    );
    if (
      functionRows.length !== manifest.functions.length ||
      functionRows.length > MAXIMUM_FUNCTIONS
    ) return yield* failure("storedState");
    const byPath = new Map(
      functionRows.map(row => [row.functionPath, row] as const),
    );
    if (byPath.size !== functionRows.length) {
      return yield* failure("storedState");
    }
    const functions: Array<(typeof functionRows)[number]> = [];
    for (const fn of manifest.functions) {
      const row = byPath.get(fn.path);
      if (row === undefined) return yield* failure("storedState");
      const entryBytes = yield* Effect.fromResult(
        applicationFunctionEntryPublicationFrameV2(fn).pipe(
          Result.mapError(cause => failureValue("storedState", false, cause)),
        ),
      );
      if (
        row.moduleName !== fn.moduleName || row.exportName !== fn.exportName ||
        row.functionKind !== fn.kind || row.visibility !== fn.visibility ||
        !bytesEqualFullScan(row.functionCatalogSha256,
          publication.functionCatalogSha256) ||
        !bytesEqualFullScan(row.entryBytes, entryBytes) ||
        !bytesEqualFullScan(row.entrySha256, yield* sha256(entryBytes))
      ) return yield* failure("storedState");
      functions.push(row);
    }
    const task = yield* taskCatalog.loadInTransaction(
      tx,
      authority,
      revision.revisionId,
    );
    if (task === null) return notReady(input.revisionId, "taskCatalogMissing");
    if (
      task.candidateId !== revision.candidateId ||
      task.analysisId !== revision.analysisId ||
      !bytesEqualFullScan(task.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256) ||
      !bytesEqualFullScan(task.publicationSha256,
        publication.publicationSha256)
    ) return yield* failure("storedState");
    const ownedRevision = detachDriverRows([revision])[0];
    const ownedPublication = detachDriverRows([publication])[0];
    const ownedFunctions = detachDriverRows(functions);
    if (ownedRevision === undefined || ownedPublication === undefined) {
      return yield* failure("storedState");
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

const validateStoredPublication = Effect.fn(
  "ApplicationRelationReadinessFold.validateStoredPublication",
)(function* (
  manifest: ApplicationManifestV2,
  publication: typeof fxSystemApplicationPublications.$inferSelect,
): Effect.fn.Return<void, ApplicationRelationReadinessFoldIssue> {
    const schemaBytes = yield* Effect.fromResult(
      applicationSchemaPublicationFrameV2(manifest).pipe(
        Result.mapError(cause => failureValue("storedState", false, cause)),
      ),
    );
    const functionCatalogBytes = yield* Effect.fromResult(
      applicationFunctionCatalogPublicationFrameV2(manifest).pipe(
        Result.mapError(cause => failureValue("storedState", false, cause)),
      ),
    );
    if (
      !bytesEqualFullScan(publication.schemaBytes, schemaBytes) ||
      !bytesEqualFullScan(publication.schemaSha256,
        yield* sha256(schemaBytes)) ||
      !bytesEqualFullScan(publication.functionCatalogBytes,
        functionCatalogBytes) ||
      !bytesEqualFullScan(publication.functionCatalogSha256,
        yield* sha256(functionCatalogBytes))
    ) return yield* failure("storedState");
    const commitment = yield* Effect.fromResult(
      applicationPublicationCommitmentFrameV2({
        scopeId: publication.scopeId,
        deploymentId: publication.deploymentId,
        revisionId: publication.revisionId,
        candidateId: publication.candidateId,
        analysisId: publication.analysisId,
        sourceArtifactRootSha256:
          encodeBytesToLowercaseHex(publication.sourceArtifactRootSha256),
        manifestSha256: encodeBytesToLowercaseHex(publication.manifestSha256),
        schemaSha256: encodeBytesToLowercaseHex(publication.schemaSha256),
        functionCatalogSha256:
          encodeBytesToLowercaseHex(publication.functionCatalogSha256),
        schemaVersionId: publication.schemaVersionId,
        schemaManifestSha256:
          encodeBytesToLowercaseHex(publication.schemaManifestSha256),
        manifestSchemaBindingSha256:
          encodeBytesToLowercaseHex(publication.manifestSchemaBindingSha256),
        boundPublicationSha256:
          encodeBytesToLowercaseHex(publication.boundPublicationSha256),
      }).pipe(
        Result.mapError(cause => failureValue("storedState", false, cause)),
      ),
    );
    if (!bytesEqualFullScan(
      publication.publicationSha256,
      yield* sha256(commitment),
    )) return yield* failure("storedState");
});

interface ValidatedPreparedFold {
  readonly physical: Extract<
    ApplicationPhysicalReadinessResult,
    { readonly status: "ready" }
  >;
  readonly relations: ApplicationRelationSetReadinessEvidenceSnapshot;
}

interface StoredRelationReadinessReplay {
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
  readonly readyAt: Date;
}

const validatePreparedFoldInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.validatePreparedInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  context: ApplicationRelationReadinessFoldContext,
  clock: ScopeClockRecord,
  relationMode: "current" | "storedActive" = "current",
): Effect.fn.Return<
  ValidatedPreparedFold | Extract<
    ApplicationRelationReadinessFoldResult,
    { readonly status: "not_ready" }
  >,
  | InternalApplicationRelationReadinessFoldError
> {
    yield* requireExactAuthority(prepared.bundle.authority, clock);
    const current = yield* reserveBundle(
      tx,
      prepared.bundle.authority,
      {
        deploymentId: prepared.bundle.deploymentId,
        revisionId: prepared.bundle.revision.revisionId,
      },
      context.taskCatalog,
      "update",
      clock,
    );
    if ("status" in current) return current;
    if (!storedBundlesEqual(prepared.bundle, current)) {
      return yield* failure("storedState");
    }
    if (relationMode === "current") {
      if (prepared.candidate.kind !== "current") {
        return yield* failure("invalidComposition");
      }
      const candidate = yield*
        validateAppSchemaCandidateReadinessInTransactionEffect(
          tx,
          context.candidateValidation,
          prepared.candidate.evidence,
          prepared.bundle.authority,
          clock,
          "share",
        );
      if (candidate.status !== "ready") {
        return notReady(
          prepared.bundle.revision.revisionId,
          candidateNotReadyReason(candidate.reason),
        );
      }
    } else if (prepared.candidate.kind !== "storedActive") {
      return yield* failure("invalidComposition");
    }
    if (prepared.unique.status === "eligible") {
      const unique = yield*
        validatePointCommitUniqueConstraintEligibilityInTransactionV1Effect(
          context.pointCommit,
          tx,
          prepared.unique.evidence,
          prepared.bundle.authority,
          clock,
        );
      if (unique.status === "not_ready") {
        return notReady(
          prepared.bundle.revision.revisionId,
          uniqueNotReadyReason(unique.reason),
          unique.lifecycle,
        );
      }
      if (
        unique.status !== "eligible" ||
        !bytesEqualFullScan(
          yield* digestCanonicalJson(uniqueConstraintFrame(unique)),
          prepared.uniqueSha256,
        )
      ) return yield* failure("authorityChanged");
    }
    const physical = yield*
      validateApplicationPhysicalReadinessInTransactionEffect(
        tx,
        prepared.bundle.authority,
        prepared.requirements,
        context.physicalDefinitionLifecycle,
        prepared.physicalLifecycle,
        clock,
      );
    if (physical.status === "not_ready") {
      return notReady(
        prepared.bundle.revision.revisionId,
        physical.reason,
        physical.detail,
      );
    }
    let relations: ApplicationRelationSetReadinessEvidenceSnapshot;
    if (relationMode === "current") {
      const relationSet = yield*
        validateApplicationRelationSetReadinessInTransactionEffect(
          context.relations,
          tx,
          prepared.bundle.authority,
          clock,
          prepared.relations,
        );
      if (relationSet.status === "not_ready") {
        return notReady(
          prepared.bundle.revision.revisionId,
          relationSet.reason === "physicalReadinessMissing"
            ? "relationPhysicalReadinessMissing"
            : "relationSemanticReadinessIncomplete",
          `${relationSet.relationOrdinal}:${relationSet.edgeDefinitionId}`,
        );
      }
      if (!hasApplicationRelationSetReadinessEvidenceAuthority(
        context.relations,
        relationSet.evidence,
      )) return yield* failure("invalidComposition");
      yield* requireRelationEvidenceCorrelation(
        prepared,
        clock,
        relationSet.evidence,
      );
      relations = snapshotRelationEvidence(relationSet.evidence);
    } else {
      relations = yield* loadStoredActiveRelationEvidence(
        tx,
        prepared,
        clock,
        context.relations,
      );
    }
    return Object.freeze({
      physical,
      relations,
    });
});

const loadStoredActiveRelationEvidence = Effect.fn(
  "ApplicationRelationReadinessFold.loadStoredActiveRelationEvidence",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  clock: ScopeClockRecord,
  relations: ApplicationRelationReadinessPort,
): Effect.fn.Return<
  ApplicationRelationSetReadinessEvidenceSnapshot,
  | ApplicationRelationReadinessFoldIssue
  | ValidateApplicationRelationSetReadinessError
> {
  const roots = yield* query(
    tx.select().from(fxSystemApplicationReadiness).where(and(
      eq(
        fxSystemApplicationReadiness.scopeId,
        prepared.bundle.authority.scopeId,
      ),
      eq(
        fxSystemApplicationReadiness.revisionId,
        prepared.bundle.revision.revisionId,
      ),
    )).limit(2).for("update"),
  );
  const root = roots[0];
  if (roots.length !== 1 || root === undefined ||
    root.readinessCodecVersion !== 2 || root.relationSetCodecVersion !== 1 ||
    root.storageGeneration !== clock.storageGeneration ||
    root.storageGenerationFence !== clock.storageGenerationFence ||
    root.epoch !== clock.epoch ||
    root.relationFrontierCommitSeq > clock.lastCommitSeq ||
    root.relationCount !== prepared.relations.relations.length ||
    !isUint8ArrayWithByteLength(root.readinessSha256, 32) ||
    !isUint8ArrayWithByteLength(root.relationSetReadinessSha256, 32)) {
    return yield* failure("storedState");
  }
  const children = yield* query(
    tx.select().from(fxSystemApplicationReadinessRelations).where(and(
      eq(
        fxSystemApplicationReadinessRelations.scopeId,
        prepared.bundle.authority.scopeId,
      ),
      eq(
        fxSystemApplicationReadinessRelations.revisionId,
        prepared.bundle.revision.revisionId,
      ),
    )).orderBy(
      asc(fxSystemApplicationReadinessRelations.relationOrdinal),
    ).for("update"),
  );
  if (children.length !== root.relationCount) {
    return yield* failure("storedState");
  }
  const relationFrames: ApplicationRelationSetReadinessReceipt[
    "relations"
  ][number][] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const expected = prepared.relations.relations[index];
    if (child === undefined || expected === undefined) {
      return yield* failure("storedState");
    }
    const ordinal = index + 1;
    const attemptFence = child.readinessKind === "physical"
      ? child.physicalAttemptFence
      : child.semanticAttemptFence;
    if (child.scopeId !== root.scopeId ||
      child.revisionId !== root.revisionId ||
      child.relationOrdinal !== ordinal ||
      child.relationCount !== root.relationCount ||
      child.schemaVersionId !== root.schemaVersionId ||
      child.relationId !== expected.binding.relationId ||
      child.sourceTableId !== expected.binding.sourceTableId ||
      child.targetTableId !== expected.binding.targetTableId ||
      child.edgeDefinitionId !== expected.edge.edgeDefinitionId ||
      encodeBytesToLowercaseHex(child.semanticDefinitionSha256) !==
        expected.binding.semanticDefinitionSha256 ||
      encodeBytesToLowercaseHex(child.physicalDefinitionSha256) !==
        expected.physicalDefinitionSha256 || attemptFence === null ||
      (child.readinessKind === "physical"
        ? child.semanticAttemptFence !== null
        : child.physicalAttemptFence !== null) ||
      !isUint8ArrayWithByteLength(child.relationReadinessSha256, 32) ||
      !bytesEqualFullScan(child.readinessSha256, root.readinessSha256) ||
      !bytesEqualFullScan(
        child.relationSetReadinessSha256,
        root.relationSetReadinessSha256,
      )) return yield* failure("storedState");
    relationFrames.push(Object.freeze({
      relationOrdinal: ordinal,
      relationId: child.relationId,
      sourceTableId: child.sourceTableId,
      targetTableId: child.targetTableId,
      semanticDefinitionSha256:
        encodeBytesToLowercaseHex(child.semanticDefinitionSha256),
      edgeDefinitionId: child.edgeDefinitionId,
      physicalDefinitionSha256:
        encodeBytesToLowercaseHex(child.physicalDefinitionSha256),
      readinessKind: child.readinessKind,
      attemptFence: attemptFence.toString(),
      readinessSha256:
        encodeBytesToLowercaseHex(child.relationReadinessSha256),
    }));
  }
  yield* validateReferencedApplicationRelationSetReadinessInTransactionEffect(
    relations,
    tx,
    prepared.bundle.authority,
    clock,
    prepared.relations,
    Object.freeze({
      frontierCommitSeq: root.relationFrontierCommitSeq,
      relations: Object.freeze(relationFrames),
    }),
  );
  const receipt = Object.freeze({
    format: "flarex.application-relation-set-readiness" as const,
    version: 1 as const,
    scopeId: root.scopeId,
    deploymentId: root.deploymentId,
    applicationManifestSha256:
      prepared.relations.applicationManifestSha256,
    manifestSchemaBindingSha256:
      prepared.relations.manifestSchemaBindingSha256,
    applicationSchemaSha256:
      prepared.relations.applicationSchemaSha256,
    schemaVersionId: prepared.relations.schemaVersionId,
    schemaVersion: prepared.relations.schemaVersion,
    schemaManifestSha256:
      prepared.relations.schemaManifestSha256,
    boundPublicationSha256:
      prepared.relations.boundPublicationSha256,
    storageGeneration: root.storageGeneration,
    storageGenerationFence: root.storageGenerationFence.toString(),
    epoch: root.epoch,
    frontierCommitSeq: root.relationFrontierCommitSeq.toString(),
    relationCount: root.relationCount,
    relations: Object.freeze(relationFrames),
  } satisfies ApplicationRelationSetReadinessReceipt);
  const receiptBytes = yield* canonicalBytes(receipt);
  const digest = yield* sha256(receiptBytes);
  if (!bytesEqualFullScan(receiptBytes, root.relationSetReadinessBytes) ||
    !bytesEqualFullScan(digest, root.relationSetReadinessSha256)) {
    return yield* failure("storedState");
  }
  return snapshotRelationEvidence(Object.freeze({
    receipt,
    canonicalBytes: receiptBytes,
    sha256: digest,
  }));
});

const settleInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.settleInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  context: ApplicationRelationReadinessFoldContext,
  repositoryState: FoldRepositoryState,
): Effect.fn.Return<
  ApplicationRelationReadinessFoldResult,
  | InternalApplicationRelationReadinessFoldError
> {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(
      tx,
      prepared.bundle.authority.scopeId,
    );
    const validated = yield* validatePreparedFoldInTransaction(
      tx,
      prepared,
      context,
      clock,
    );
    if ("status" in validated) return validated;
    const readyAt = yield* readinessReadyAt(
      tx,
      prepared.bundle.authority.scopeId,
      prepared.bundle.revision.revisionId,
    );
    const readinessBytes = yield* relationReadinessFrame(
      prepared,
      validated.physical,
      validated.relations,
      readyAt,
    );
    const readinessSha256 = yield* sha256(readinessBytes);
    const inserted = yield* insertOrReplayReadiness(
      tx,
      prepared,
      validated.physical,
      validated.relations,
      readinessSha256,
      readinessBytes,
      readyAt,
    );
    return issueReadyResult(
      "prepared",
      inserted.disposition,
      repositoryState,
      prepared,
      readinessSha256,
      readinessBytes,
      validated.relations,
      inserted.readyAt,
    );
});

const readReadyInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.readReadyInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  context: ApplicationRelationReadinessFoldContext,
  repositoryState: FoldRepositoryState,
): Effect.fn.Return<
  ApplicationRelationReadinessFoldResult,
  | InternalApplicationRelationReadinessFoldError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    prepared.bundle.authority.scopeId,
  );
  const validated = yield* validatePreparedFoldInTransaction(
    tx,
    prepared,
    context,
    clock,
  );
  if ("status" in validated) return validated;
  const replay = yield* loadStoredRelationReadinessReplay(
    tx,
    prepared,
    validated,
  );
  return issueReadyResult(
    "stored",
    "replayed",
    repositoryState,
    prepared,
    replay.readinessSha256,
    replay.readinessBytes,
    validated.relations,
    replay.readyAt,
  );
});

const readActiveReadyInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.readActiveReadyInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  context: ApplicationRelationReadinessFoldContext,
  repositoryState: FoldRepositoryState,
): Effect.fn.Return<
  ApplicationRelationReadinessFoldResult,
  | InternalApplicationRelationReadinessFoldError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    prepared.bundle.authority.scopeId,
  );
  const validated = yield* validatePreparedFoldInTransaction(
    tx,
    prepared,
    context,
    clock,
    "storedActive",
  );
  if ("status" in validated) return validated;
  const replay = yield* loadStoredRelationReadinessReplay(
    tx,
    prepared,
    validated,
  );
  return issueReadyResult(
    "active",
    "replayed",
    repositoryState,
    prepared,
    replay.readinessSha256,
    replay.readinessBytes,
    validated.relations,
    replay.readyAt,
  );
});

const loadStoredRelationReadinessReplay = Effect.fn(
  "ApplicationRelationReadinessFold.loadStoredReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  validated: ValidatedPreparedFold,
): Effect.fn.Return<
  StoredRelationReadinessReplay,
  ApplicationRelationReadinessFoldIssue
> {
  const rows = yield* query(
    tx.select({ readyAt: fxSystemApplicationReadiness.readyAt })
      .from(fxSystemApplicationReadiness)
      .where(and(
        eq(fxSystemApplicationReadiness.scopeId,
          prepared.bundle.authority.scopeId),
        eq(fxSystemApplicationReadiness.revisionId,
          prepared.bundle.revision.revisionId),
      ))
      .limit(1)
      .for("update"),
  );
  const readyAt = databaseTimestampFromUnknown(rows[0]?.readyAt);
  if (readyAt === null) return yield* failure("storedState");
  yield* validateRevisionSchemaReplay(tx, prepared, readyAt);
  const readinessBytes = yield* relationReadinessFrame(
    prepared,
    validated.physical,
    validated.relations,
    readyAt,
  );
  const readinessSha256 = yield* sha256(readinessBytes);
  const storedAt = yield* validateReadinessReplay(
    tx,
    prepared,
    validated.physical,
    validated.relations,
    readinessSha256,
    readinessBytes,
  );
  if (storedAt.getTime() !== readyAt.getTime()) {
    return yield* failure("conflictingReplay");
  }
  return Object.freeze({
    readinessSha256: copyBytes(readinessSha256),
    readinessBytes: copyBytes(readinessBytes),
    readyAt: new Date(readyAt.getTime()),
  });
});

function issueReadyResult(
  kind: IssuedReadyResultState["kind"],
  disposition: "inserted" | "replayed",
  repositoryState: FoldRepositoryState,
  prepared: PreparedFold,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
  relationEvidence: ApplicationRelationSetReadinessEvidenceSnapshot,
  readyAt: Date,
): Extract<
  ApplicationRelationReadinessFoldResult,
  { readonly status: "ready" }
> {
  const stableReadinessSha256 = copyBytes(readinessSha256);
  const stableReadinessBytes = copyBytes(readinessBytes);
  const stableRelationEvidence = snapshotRelationEvidence(relationEvidence);
  const stableReadyAtMillis = readyAt.getTime();
  const result = Object.freeze({
    status: "ready",
    disposition,
    scopeId: prepared.bundle.authority.scopeId,
    revisionId: prepared.bundle.revision.revisionId,
    schemaVersionId: prepared.schema.schemaVersionId,
    readinessSha256: encodeBytesToLowercaseHex(stableReadinessSha256),
    get readinessBytes(): Uint8Array {
      return copyBytes(stableReadinessBytes);
    },
    relationSetReadinessSha256:
      encodeBytesToLowercaseHex(stableRelationEvidence.sha256),
    relationCount: stableRelationEvidence.receipt.relationCount,
    get readyAt(): Date {
      return new Date(stableReadyAtMillis);
    },
  } as const);
  issuedReadyResults.set(result, Object.freeze({
    kind,
    repository: repositoryState,
    deploymentId: prepared.bundle.deploymentId,
    prepared,
    readinessSha256: stableReadinessSha256,
    readinessBytes: stableReadinessBytes,
    relationEvidence: stableRelationEvidence,
    readyAt: new Date(stableReadyAtMillis),
  }));
  return result;
}

function snapshotRelationEvidence(
  evidence: ApplicationRelationSetReadinessEvidenceSnapshot,
): ApplicationRelationSetReadinessEvidenceSnapshot {
  const stableBytes = copyBytes(evidence.canonicalBytes);
  const stableSha256 = copyBytes(evidence.sha256);
  const receipt = Object.freeze({
    ...evidence.receipt,
    relations: Object.freeze(
      evidence.receipt.relations.map(relation => Object.freeze({
        ...relation,
      })),
    ),
  });
  return Object.freeze({
    receipt,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
  });
}

const validateIssuedRelationReadinessForActivation = Effect.fn(
  "ApplicationRelationReadinessFold.validateIssuedForActivation",
)(function* (
  expectedKind: IssuedReadyResultState["kind"],
  repository: unknown,
  issued: ApplicationRelationReadinessFoldResult,
  tx: AppRowTransaction,
  currentClock: ScopeClockRecord,
): Effect.fn.Return<
  ApplicationRelationReadinessActivationValidation,
  InternalApplicationRelationReadinessFoldError
> {
  if (typeof repository !== "object" || repository === null ||
    issued.status !== "ready") {
    return yield* failure("invalidComposition");
  }
  const repositoryState = repositoryStates.get(repository);
  const issuedState = issuedReadyResults.get(issued);
  if (
    repositoryState === undefined ||
    issuedState === undefined ||
    issuedState.kind !== expectedKind ||
    issuedState.repository !== repositoryState ||
    issuedState.prepared.bundle.authority.scopeId !== currentClock.scopeId
  ) return yield* failure("invalidComposition");
  const validated = yield* validatePreparedFoldInTransaction(
    tx,
    issuedState.prepared,
    repositoryState.context,
    currentClock,
    expectedKind === "active" ? "storedActive" : "current",
  );
  if ("status" in validated) return validated;
  const replay = yield* loadStoredRelationReadinessReplay(
    tx,
    issuedState.prepared,
    validated,
  );
  if (
    !bytesEqualFullScan(
      replay.readinessSha256,
      issuedState.readinessSha256,
    ) ||
    !bytesEqualFullScan(replay.readinessBytes, issuedState.readinessBytes) ||
    !bytesEqualFullScan(
      validated.relations.sha256,
      issuedState.relationEvidence.sha256,
    ) ||
    !bytesEqualFullScan(
      validated.relations.canonicalBytes,
      issuedState.relationEvidence.canonicalBytes,
    ) ||
    replay.readyAt.getTime() !== issuedState.readyAt.getTime()
  ) return yield* failure("authorityChanged");
  const definitions = getPreparedApplicationRelationReadinessDefinitions(
    repositoryState.context.relations,
    issuedState.prepared.relations,
  );
  if (definitions === null) return yield* failure("invalidComposition");
  return Object.freeze({
    status: "ready",
    basis: yield* relationActivationBasis(issuedState, definitions),
  });
});

const relationActivationBasis = Effect.fn(
  "ApplicationRelationReadinessFold.activationBasis",
)(function* (
  state: IssuedReadyResultState,
  definitions: LocatedApplicationRelationDefinitionSet,
): Effect.fn.Return<
  ApplicationRelationReadinessActivationBasis,
  ApplicationRelationReadinessFoldIssue
> {
  const prepared = state.prepared;
  const bundle = prepared.bundle;
  const relationEvidence = state.relationEvidence;
  return Object.freeze({
    authority: Object.freeze({
      ...bundle.authority,
      physicalLocator: Object.freeze({
        ...bundle.authority.physicalLocator,
      }),
    }),
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
    schemaVersionId: prepared.schema.schemaVersionId,
    schemaManifestSha256:
      yield* decodeSha256(prepared.schema.schemaManifestSha256),
    manifestSchemaBindingSha256:
      yield* decodeSha256(prepared.schema.manifestSchemaBindingSha256),
    boundPublicationSha256:
      yield* decodeSha256(prepared.schema.boundPublicationSha256),
    taskCatalogSha256: copyBytes(bundle.task.taskCatalogSha256),
    taskCatalogBindingSha256:
      copyBytes(bundle.task.taskCatalogBindingSha256),
    runtimeHostIdentity: bundle.task.runtimeHostIdentity,
    compatibilityDate: bundle.task.compatibilityDate,
    readinessSha256: copyBytes(state.readinessSha256),
    relationFrontierCommitSeq:
      relationEvidence.receipt.frontierCommitSeq,
    relationSetReadinessSha256: copyBytes(relationEvidence.sha256),
    relationCount: relationEvidence.receipt.relationCount,
    definitions,
  });
});

const insertOrReplayReadiness = Effect.fn(
  "ApplicationRelationReadinessFold.insertOrReplayReadiness",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  physical: Extract<ApplicationPhysicalReadinessResult, {
    readonly status: "ready";
  }>,
  relations: ApplicationRelationSetReadinessEvidenceSnapshot,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
  readyAt: Date,
): Effect.fn.Return<
  Readonly<{ readonly disposition: "inserted" | "replayed"; readonly readyAt: Date }>,
  ApplicationRelationReadinessFoldIssue
> {
    const manifestSha256 = prepared.bundle.revision.manifestSha256;
    const publicationSha256 = prepared.bundle.publication.publicationSha256;
    const applicationSchemaSha256 = prepared.bundle.publication.schemaSha256;
    const schemaManifestSha256 = yield* decodeSha256(
      prepared.schema.schemaManifestSha256,
    );
    const manifestSchemaBindingSha256 = yield* decodeSha256(
      prepared.schema.manifestSchemaBindingSha256,
    );
    const boundPublicationSha256 = yield* decodeSha256(
      prepared.schema.boundPublicationSha256,
    );
    const candidateValidationReceiptSha256 = yield* decodeSha256(
      candidateValidationReceiptSha256Hex(prepared.candidate),
    );
    const relationChildren: Array<Readonly<{
      readonly child: ApplicationRelationSetReadinessEvidence["receipt"][
        "relations"
      ][number];
      readonly semanticDefinitionSha256: Uint8Array;
      readonly physicalDefinitionSha256: Uint8Array;
      readonly relationReadinessSha256: Uint8Array;
    }>> = [];
    for (const child of relations.receipt.relations) {
      relationChildren.push({
        child,
        semanticDefinitionSha256: yield* decodeSha256(
          child.semanticDefinitionSha256,
        ),
        physicalDefinitionSha256: yield* decodeSha256(
          child.physicalDefinitionSha256,
        ),
        relationReadinessSha256: yield* decodeSha256(child.readinessSha256),
      });
    }
    yield* execute(tx.insert(fxSystemApplicationRevisionSchemas).values({
      scopeId: prepared.bundle.authority.scopeId,
      revisionId: prepared.bundle.revision.revisionId,
      deploymentId: prepared.bundle.deploymentId,
      manifestSha256,
      publicationSha256,
      applicationSchemaSha256,
      schemaVersionId: prepared.schema.schemaVersionId,
      schemaVersion: prepared.schema.schemaVersion,
      schemaManifestSha256,
      manifestSchemaBindingSha256,
      boundPublicationSha256,
      boundAt: readyAt,
    }).onConflictDoNothing());
    yield* validateRevisionSchemaReplay(
      tx,
      prepared,
      readyAt,
    );
    const insertedRows = yield* query(
      tx.insert(fxSystemApplicationReadiness).values({
        scopeId: prepared.bundle.authority.scopeId,
        revisionId: prepared.bundle.revision.revisionId,
        deploymentId: prepared.bundle.deploymentId,
        candidateId: prepared.bundle.revision.candidateId,
        analysisId: prepared.bundle.revision.analysisId,
        sourceArtifactRootSha256:
          prepared.bundle.revision.sourceArtifactRootSha256,
        manifestSha256,
        publicationSha256,
        applicationSchemaSha256,
        functionCatalogSha256:
          prepared.bundle.publication.functionCatalogSha256,
        storageGeneration: prepared.bundle.authority.storageGeneration,
        storageGenerationFence:
          prepared.bundle.authority.storageGenerationFence,
        epoch: prepared.bundle.authority.epoch,
        schemaVersionId: prepared.schema.schemaVersionId,
        schemaManifestSha256,
        manifestSchemaBindingSha256,
        boundPublicationSha256,
        taskCatalogBindingSha256:
          prepared.bundle.task.taskCatalogBindingSha256,
        runtimeHostIdentity: prepared.bundle.task.runtimeHostIdentity,
        compatibilityDate: prepared.bundle.task.compatibilityDate,
        coldReceiptSetSha256: prepared.coldReceiptSetSha256,
        candidateValidationReceiptSha256,
        uniqueConstraintStatus: prepared.unique.status,
        uniqueConstraintEligibilitySha256: prepared.uniqueSha256,
        physicalReadinessSha256: physical.physicalReadinessSha256,
        relationSetCodecVersion: relations.receipt.version,
        relationFrontierCommitSeq: CommitSeqSchema.make(BigInt(
          relations.receipt.frontierCommitSeq,
        )),
        relationCount: relations.receipt.relationCount,
        relationSetReadinessSha256: relations.sha256,
        relationSetReadinessBytes: relations.canonicalBytes,
        readinessCodecVersion: 2,
        readinessSha256,
        readinessBytes,
        readyAt,
      }).onConflictDoNothing().returning({
        revisionId: fxSystemApplicationReadiness.revisionId,
      }),
    );
    if (insertedRows.length === 1) {
      yield* execute(tx.insert(fxSystemApplicationReadinessRelations).values(
        relationChildren.map(({ child, semanticDefinitionSha256,
          physicalDefinitionSha256, relationReadinessSha256 }) => ({
          scopeId: prepared.bundle.authority.scopeId,
          revisionId: prepared.bundle.revision.revisionId,
          readinessSha256,
          relationSetReadinessSha256: relations.sha256,
          relationCount: relations.receipt.relationCount,
          schemaVersionId: prepared.schema.schemaVersionId,
          relationOrdinal: child.relationOrdinal,
          relationId: child.relationId,
          sourceTableId: child.sourceTableId,
          targetTableId: child.targetTableId,
          semanticDefinitionSha256,
          edgeDefinitionId: child.edgeDefinitionId,
          physicalDefinitionSha256,
          readinessKind: child.readinessKind,
          physicalAttemptFence: child.readinessKind === "physical"
            ? BigInt(child.attemptFence)
            : null,
          semanticAttemptFence: child.readinessKind === "semantic"
            ? ApplicationRelationSemanticValidationAttemptFenceSchema.make(
              BigInt(child.attemptFence),
            )
            : null,
          relationReadinessSha256,
        })),
      ));
    }
    const storedAt = yield* validateReadinessReplay(
      tx,
      prepared,
      physical,
      relations,
      readinessSha256,
      readinessBytes,
    );
    return Object.freeze({
      disposition: insertedRows.length === 1 ? "inserted" : "replayed",
      readyAt: storedAt,
    });
});

const validateRevisionSchemaReplay = Effect.fn(
  "ApplicationRelationReadinessFold.validateRevisionSchemaReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  expectedBoundAt: Date,
): Effect.fn.Return<void, ApplicationRelationReadinessFoldIssue> {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationRevisionSchemas).where(and(
        eq(fxSystemApplicationRevisionSchemas.scopeId,
          prepared.bundle.authority.scopeId),
        eq(fxSystemApplicationRevisionSchemas.revisionId,
          prepared.bundle.revision.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    const boundAt = databaseTimestampFromUnknown(row?.boundAt);
    const schemaManifestSha256 = yield* decodeSha256(
      prepared.schema.schemaManifestSha256,
    );
    const manifestSchemaBindingSha256 = yield* decodeSha256(
      prepared.schema.manifestSchemaBindingSha256,
    );
    const boundPublicationSha256 = yield* decodeSha256(
      prepared.schema.boundPublicationSha256,
    );
    if (
      row === undefined || boundAt === null ||
      boundAt.getTime() !== expectedBoundAt.getTime() ||
      row.deploymentId !== prepared.bundle.deploymentId ||
      row.schemaVersionId !== prepared.schema.schemaVersionId ||
      row.schemaVersion !== prepared.schema.schemaVersion ||
      !bytesEqualFullScan(row.manifestSha256,
        prepared.bundle.revision.manifestSha256) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.bundle.publication.publicationSha256) ||
      !bytesEqualFullScan(row.applicationSchemaSha256,
        prepared.bundle.publication.schemaSha256) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        schemaManifestSha256) ||
      !bytesEqualFullScan(row.manifestSchemaBindingSha256,
        manifestSchemaBindingSha256) ||
      !bytesEqualFullScan(row.boundPublicationSha256,
        boundPublicationSha256)
    ) return yield* failure("conflictingReplay");
});

const validateReadinessReplay = Effect.fn(
  "ApplicationRelationReadinessFold.validateReadinessReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  physical: Extract<ApplicationPhysicalReadinessResult, {
    readonly status: "ready";
  }>,
  relations: ApplicationRelationSetReadinessEvidenceSnapshot,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
): Effect.fn.Return<Date, ApplicationRelationReadinessFoldIssue> {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationReadiness).where(and(
        eq(fxSystemApplicationReadiness.scopeId,
          prepared.bundle.authority.scopeId),
        eq(fxSystemApplicationReadiness.revisionId,
          prepared.bundle.revision.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    const readyAt = databaseTimestampFromUnknown(row?.readyAt);
    const schemaManifestSha256 = yield* decodeSha256(
      prepared.schema.schemaManifestSha256,
    );
    const manifestSchemaBindingSha256 = yield* decodeSha256(
      prepared.schema.manifestSchemaBindingSha256,
    );
    const boundPublicationSha256 = yield* decodeSha256(
      prepared.schema.boundPublicationSha256,
    );
    const candidateValidationReceiptSha256 = yield* decodeSha256(
      candidateValidationReceiptSha256Hex(prepared.candidate),
    );
    const expectedChildren: Array<Readonly<{
      readonly child: ApplicationRelationSetReadinessEvidence["receipt"][
        "relations"
      ][number];
      readonly semanticDefinitionSha256: Uint8Array;
      readonly physicalDefinitionSha256: Uint8Array;
      readonly relationReadinessSha256: Uint8Array;
    }>> = [];
    for (const child of relations.receipt.relations) {
      expectedChildren.push({
        child,
        semanticDefinitionSha256: yield* decodeSha256(
          child.semanticDefinitionSha256,
        ),
        physicalDefinitionSha256: yield* decodeSha256(
          child.physicalDefinitionSha256,
        ),
        relationReadinessSha256: yield* decodeSha256(child.readinessSha256),
      });
    }
    if (
      row === undefined || readyAt === null ||
      row.deploymentId !== prepared.bundle.deploymentId ||
      row.candidateId !== prepared.bundle.revision.candidateId ||
      row.analysisId !== prepared.bundle.revision.analysisId ||
      row.storageGeneration !== prepared.bundle.authority.storageGeneration ||
      row.storageGenerationFence !==
        prepared.bundle.authority.storageGenerationFence ||
      row.epoch !== prepared.bundle.authority.epoch ||
      row.schemaVersionId !== prepared.schema.schemaVersionId ||
      row.runtimeHostIdentity !== prepared.bundle.task.runtimeHostIdentity ||
      row.compatibilityDate !== prepared.bundle.task.compatibilityDate ||
      row.uniqueConstraintStatus !== prepared.unique.status ||
      row.relationSetCodecVersion !== 1 ||
      row.relationFrontierCommitSeq !==
        BigInt(relations.receipt.frontierCommitSeq) ||
      row.relationCount !== relations.receipt.relationCount ||
      row.readinessCodecVersion !== 2 ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256,
        prepared.bundle.revision.sourceArtifactRootSha256) ||
      !bytesEqualFullScan(row.manifestSha256,
        prepared.bundle.revision.manifestSha256) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.bundle.publication.publicationSha256) ||
      !bytesEqualFullScan(row.applicationSchemaSha256,
        prepared.bundle.publication.schemaSha256) ||
      !bytesEqualFullScan(row.functionCatalogSha256,
        prepared.bundle.publication.functionCatalogSha256) ||
      !bytesEqualFullScan(row.schemaManifestSha256,
        schemaManifestSha256) ||
      !bytesEqualFullScan(row.manifestSchemaBindingSha256,
        manifestSchemaBindingSha256) ||
      !bytesEqualFullScan(row.boundPublicationSha256,
        boundPublicationSha256) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.bundle.task.taskCatalogBindingSha256) ||
      !bytesEqualFullScan(row.coldReceiptSetSha256,
        prepared.coldReceiptSetSha256) ||
      !bytesEqualFullScan(row.candidateValidationReceiptSha256,
        candidateValidationReceiptSha256) ||
      !bytesEqualFullScan(row.uniqueConstraintEligibilitySha256,
        prepared.uniqueSha256) ||
      !bytesEqualFullScan(row.physicalReadinessSha256,
        physical.physicalReadinessSha256) ||
      !bytesEqualFullScan(row.relationSetReadinessSha256, relations.sha256) ||
      !bytesEqualFullScan(row.relationSetReadinessBytes,
        relations.canonicalBytes) ||
      !bytesEqualFullScan(row.readinessSha256, readinessSha256) ||
      !bytesEqualFullScan(row.readinessBytes, readinessBytes)
    ) return yield* failure("conflictingReplay");
    const children = yield* query(
      tx.select().from(fxSystemApplicationReadinessRelations).where(and(
        eq(fxSystemApplicationReadinessRelations.scopeId,
          prepared.bundle.authority.scopeId),
        eq(fxSystemApplicationReadinessRelations.revisionId,
          prepared.bundle.revision.revisionId),
      )).orderBy(asc(fxSystemApplicationReadinessRelations.relationOrdinal)),
    );
    if (
      children.length !== relations.receipt.relationCount ||
      children.some((stored, index) => {
        const expected = expectedChildren[index];
        return expected === undefined ||
          stored.relationOrdinal !== index + 1 ||
          expected.child.relationOrdinal !== index + 1 ||
          stored.relationCount !== relations.receipt.relationCount ||
          stored.schemaVersionId !== prepared.schema.schemaVersionId ||
          stored.relationId !== expected.child.relationId ||
          stored.sourceTableId !== expected.child.sourceTableId ||
          stored.targetTableId !== expected.child.targetTableId ||
          stored.edgeDefinitionId !== expected.child.edgeDefinitionId ||
          stored.readinessKind !== expected.child.readinessKind ||
          stored.physicalAttemptFence !==
            (expected.child.readinessKind === "physical"
              ? BigInt(expected.child.attemptFence)
              : null) ||
          stored.semanticAttemptFence !==
            (expected.child.readinessKind === "semantic"
              ? BigInt(expected.child.attemptFence)
              : null) ||
          !bytesEqualFullScan(stored.readinessSha256, readinessSha256) ||
          !bytesEqualFullScan(stored.relationSetReadinessSha256,
            relations.sha256) ||
          !bytesEqualFullScan(stored.semanticDefinitionSha256,
            expected.semanticDefinitionSha256) ||
          !bytesEqualFullScan(stored.physicalDefinitionSha256,
            expected.physicalDefinitionSha256) ||
          !bytesEqualFullScan(stored.relationReadinessSha256,
            expected.relationReadinessSha256);
      })
    ) return yield* failure("conflictingReplay");
    return readyAt;
});

const relationReadinessFrame = Effect.fn(
  "ApplicationRelationReadinessFold.relationReadinessFrame",
)(function (
  prepared: PreparedFold,
  physical: Extract<ApplicationPhysicalReadinessResult, {
    readonly status: "ready";
  }>,
  relations: ApplicationRelationSetReadinessEvidenceSnapshot,
  readyAt: Date,
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldIssue> {
  return canonicalBytes({
    format: "flarex.application-readiness",
    version: 2,
    status: "ready",
    scopeId: prepared.bundle.authority.scopeId,
    deploymentId: prepared.bundle.deploymentId,
    revisionId: prepared.bundle.revision.revisionId,
    candidateId: prepared.bundle.revision.candidateId,
    analysisId: prepared.bundle.revision.analysisId,
    storageGeneration: prepared.bundle.authority.storageGeneration,
    storageGenerationFence:
      prepared.bundle.authority.storageGenerationFence.toString(),
    epoch: prepared.bundle.authority.epoch,
    sourceArtifactRootSha256: encodeBytesToLowercaseHex(
      prepared.bundle.revision.sourceArtifactRootSha256,
    ),
    manifestSha256: encodeBytesToLowercaseHex(
      prepared.bundle.revision.manifestSha256,
    ),
    publicationSha256: encodeBytesToLowercaseHex(
      prepared.bundle.publication.publicationSha256,
    ),
    applicationSchemaSha256: prepared.schema.applicationSchemaSha256,
    functionCatalogSha256: encodeBytesToLowercaseHex(
      prepared.bundle.publication.functionCatalogSha256,
    ),
    schemaVersionId: prepared.schema.schemaVersionId,
    schemaManifestSha256: prepared.schema.schemaManifestSha256,
    manifestSchemaBindingSha256:
      prepared.schema.manifestSchemaBindingSha256,
    boundPublicationSha256: prepared.schema.boundPublicationSha256,
    taskCatalogBindingSha256: encodeBytesToLowercaseHex(
      prepared.bundle.task.taskCatalogBindingSha256,
    ),
    runtimeHostIdentity: prepared.bundle.task.runtimeHostIdentity,
    compatibilityDate: prepared.bundle.task.compatibilityDate,
    coldReceiptSetSha256:
      encodeBytesToLowercaseHex(prepared.coldReceiptSetSha256),
    candidateValidationReceiptSha256:
      candidateValidationReceiptSha256Hex(prepared.candidate),
    uniqueConstraintStatus: prepared.unique.status,
    uniqueConstraintEligibilitySha256:
      encodeBytesToLowercaseHex(prepared.uniqueSha256),
    physicalReadinessSha256:
      encodeBytesToLowercaseHex(physical.physicalReadinessSha256),
    relationSet: {
      version: relations.receipt.version,
      frontierCommitSeq: relations.receipt.frontierCommitSeq,
      relationCount: relations.receipt.relationCount,
      readinessSha256: encodeBytesToLowercaseHex(relations.sha256),
    },
    coldReceipts: [],
    readyAt: readyAt.toISOString(),
  });
});

function requireSchemaCorrelation(
  bundle: StoredBundle,
  schema: ApplicationRelationSchemaAuthority,
): Effect.Effect<void, ApplicationRelationReadinessFoldIssue> {
  return schema.deploymentId === bundle.deploymentId &&
      schema.applicationManifestSha256 ===
        encodeBytesToLowercaseHex(bundle.revision.manifestSha256) &&
      schema.applicationSchemaSha256 ===
        encodeBytesToLowercaseHex(bundle.publication.schemaSha256) &&
      schema.schemaVersionId === bundle.publication.schemaVersionId &&
      schema.schemaManifestSha256 === encodeBytesToLowercaseHex(
        bundle.publication.schemaManifestSha256,
      ) &&
      schema.manifestSchemaBindingSha256 === encodeBytesToLowercaseHex(
        bundle.publication.manifestSchemaBindingSha256,
      ) &&
      schema.boundPublicationSha256 === encodeBytesToLowercaseHex(
        bundle.publication.boundPublicationSha256,
      )
    ? Effect.void
    : failure("schemaBinding");
}

function requireRelationCorrelation(
  bundle: StoredBundle,
  schema: ApplicationRelationSchemaAuthority,
  relations: PreparedApplicationRelationReadiness,
): Effect.Effect<void, ApplicationRelationReadinessFoldIssue> {
  return relations.deploymentId === bundle.deploymentId &&
      relations.applicationManifestSha256 ===
        schema.applicationManifestSha256 &&
      relations.manifestSchemaBindingSha256 ===
        schema.manifestSchemaBindingSha256 &&
      relations.applicationSchemaSha256 === schema.applicationSchemaSha256 &&
      relations.schemaVersionId === schema.schemaVersionId &&
      relations.schemaVersion === schema.schemaVersion &&
      relations.schemaManifestSha256 === schema.schemaManifestSha256 &&
      relations.boundPublicationSha256 === schema.boundPublicationSha256 &&
      relations.relations.length === schema.relations.length
    ? Effect.void
    : failure("schemaBinding");
}

function requireRelationEvidenceCorrelation(
  prepared: PreparedFold,
  clock: ScopeClockRecord,
  evidence: ApplicationRelationSetReadinessEvidence,
): Effect.Effect<void, ApplicationRelationReadinessFoldIssue> {
  const receipt = evidence.receipt;
  return receipt.scopeId === prepared.bundle.authority.scopeId &&
      receipt.deploymentId === prepared.bundle.deploymentId &&
      receipt.applicationManifestSha256 ===
        prepared.schema.applicationManifestSha256 &&
      receipt.manifestSchemaBindingSha256 ===
        prepared.schema.manifestSchemaBindingSha256 &&
      receipt.applicationSchemaSha256 ===
        prepared.schema.applicationSchemaSha256 &&
      receipt.schemaVersionId === prepared.schema.schemaVersionId &&
      receipt.schemaVersion === prepared.schema.schemaVersion &&
      receipt.schemaManifestSha256 === prepared.schema.schemaManifestSha256 &&
      receipt.boundPublicationSha256 ===
        prepared.schema.boundPublicationSha256 &&
      receipt.storageGeneration === clock.storageGeneration &&
      receipt.storageGenerationFence ===
        clock.storageGenerationFence.toString() &&
      receipt.epoch === clock.epoch &&
      receipt.frontierCommitSeq === clock.lastCommitSeq.toString() &&
      receipt.relationCount === receipt.relations.length &&
      receipt.relationCount === prepared.schema.relations.length
    ? Effect.void
    : failure("authorityChanged");
}

function storedBundlesEqual(left: StoredBundle, right: StoredBundle): boolean {
  return left.deploymentId === right.deploymentId &&
    left.authority.scopeId === right.authority.scopeId &&
    left.authority.storageGeneration === right.authority.storageGeneration &&
    left.authority.storageGenerationFence ===
      right.authority.storageGenerationFence &&
    left.authority.epoch === right.authority.epoch &&
    left.revision.revisionId === right.revision.revisionId &&
    left.revision.candidateId === right.revision.candidateId &&
    left.revision.analysisId === right.revision.analysisId &&
    bytesEqualFullScan(left.revision.sourceArtifactRootSha256,
      right.revision.sourceArtifactRootSha256) &&
    bytesEqualFullScan(left.revision.manifestSha256,
      right.revision.manifestSha256) &&
    bytesEqualFullScan(left.publication.publicationSha256,
      right.publication.publicationSha256) &&
    bytesEqualFullScan(left.task.taskCatalogBindingSha256,
      right.task.taskCatalogBindingSha256) &&
    left.functions.length === right.functions.length;
}

const decodeStoredManifest = Effect.fn(
  "ApplicationRelationReadinessFold.decodeStoredManifest",
)(function* (
  bytes: Uint8Array,
  expectedSha256: Uint8Array,
): Effect.fn.Return<
  ApplicationManifestV2,
  ApplicationRelationReadinessFoldIssue
> {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(UTF8_FATAL.decode(bytes)),
      catch: cause => failureValue("storedState", false, cause),
    });
    const canonical = yield* Effect.fromResult(
      canonicalizeApplicationManifestV2(parsed).pipe(
        Result.mapError(cause => failureValue("storedState", false, cause)),
      ),
    );
    if (
      !bytesEqualFullScan(canonical.canonicalBytes, bytes) ||
      !bytesEqualFullScan(yield* sha256(canonical.canonicalBytes),
        expectedSha256)
    ) return yield* failure("storedState");
    return canonical.manifest;
});

function requireExactAuthority(
  authority: ApplicationReadinessAuthority,
  clock: ScopeClockRecord,
): Effect.Effect<void, ApplicationRelationReadinessFoldIssue> {
  return authority.scopeId === clock.scopeId &&
      authority.storageGeneration === clock.storageGeneration &&
      authority.storageGenerationFence === clock.storageGenerationFence &&
      authority.epoch === clock.epoch
    ? Effect.void
    : failure("authorityChanged");
}

function uniqueConstraintFrame(
  eligibility: Exclude<
    AppUniqueConstraintSetEligibilityResultV1,
    { readonly status: "not_ready" }
  >,
): Readonly<Record<string, Json>> {
  if (eligibility.status === "not_required") {
    return Object.freeze({
      format: "flarex.application-unique-constraint-eligibility",
      version: 1,
      status: "not_required",
      tableIds: [],
    });
  }
  const evidence = eligibility.evidence;
  return Object.freeze({
    format: "flarex.application-unique-constraint-eligibility",
    version: 1,
    status: "eligible",
    deploymentId: evidence.deploymentId,
    scopeId: evidence.scopeId,
    schemaVersionId: evidence.schemaVersionId,
    definitionCount: evidence.definitionCount,
    definitionSetSha256: evidence.definitionSetSha256Hex,
    tableIds: [...evidence.tableIds],
    storageGeneration: evidence.storageGeneration,
    storageGenerationFence: evidence.storageGenerationFence.toString(),
    epoch: evidence.epoch,
    startCommitSeq: evidence.startCommitSeq.toString(),
    attemptFence: evidence.attemptFence.toString(),
  });
}

const canonicalBytes = Effect.fn(
  "ApplicationRelationReadinessFold.canonicalBytes",
)(function (
  value: unknown,
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldIssue> {
  if (!isJson(value)) return failure("storedState");
  return Effect.try({
    try: () => UTF8.encode(encodeCanonicalJson(value, issue => {
        throw new Error(
          `Application relation readiness frame invariant: ${issue.reason}`,
        );
      })),
    catch: cause => failureValue("storedState", false, cause),
  });
});

const digestCanonicalJson = Effect.fn(
  "ApplicationRelationReadinessFold.digestCanonicalJson",
)(function (
  value: Readonly<Record<string, Json>>,
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldIssue> {
  return canonicalBytes(value).pipe(Effect.flatMap(sha256));
});

function sha256(bytes: Uint8Array): Effect.Effect<Uint8Array> {
  return Effect.tryPromise(() => crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(bytes),
  )).pipe(
    Effect.map(buffer => new Uint8Array(buffer)),
    Effect.orDie,
  );
}

const decodeSha256 = Effect.fn(
  "ApplicationRelationReadinessFold.decodeSha256",
)(function* (
  value: string,
): Effect.fn.Return<Uint8Array, ApplicationRelationReadinessFoldIssue> {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    return yield* failure("storedState");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
});

function targetDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ApplicationReadinessAuthority["scopeId"],
): Effect.Effect<Date, ApplicationRelationReadinessFoldIssue> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ).pipe(Effect.flatMap(rows => {
    const value = databaseTimestampFromUnknown(rows[0]?.now);
    return value === null ? failure("storedState") : Effect.succeed(value);
  }));
}

const readinessReadyAt = Effect.fn(
  "ApplicationRelationReadinessFold.readinessReadyAt",
)(function* (
  tx: AppRowTransaction,
  scopeId: ApplicationReadinessAuthority["scopeId"],
  revisionId: string,
): Effect.fn.Return<Date, ApplicationRelationReadinessFoldIssue> {
    const rows = yield* query(
      tx.select({ readyAt: fxSystemApplicationReadiness.readyAt })
        .from(fxSystemApplicationReadiness)
        .where(and(
          eq(fxSystemApplicationReadiness.scopeId, scopeId),
          eq(fxSystemApplicationReadiness.revisionId, revisionId),
        ))
        .limit(1)
        .for("update"),
    );
    if (rows.length === 0) return yield* targetDatabaseTime(tx, scopeId);
    const readyAt = databaseTimestampFromUnknown(rows[0]?.readyAt);
    return readyAt === null ? yield* failure("storedState") : readyAt;
});

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationRelationReadinessFoldIssue> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  );
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationRelationReadinessFoldIssue> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  ).pipe(Effect.asVoid);
}

const runLocatedTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.runLocatedTransaction",
)(function* <Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.fn.Return<Value, Failure | ApplicationRelationReadinessFoldIssue> {
  return yield* runLocatedReadCommittedEffect(
    target,
    {
      rollbackMessage: "Application relation readiness fold rolled back.",
      cleanupDefect: cause => failureValue("resourceFailure", false, cause),
    },
    body,
  ).pipe(Effect.mapError((cause): Failure |
    ApplicationRelationReadinessFoldIssue => {
    if (!(cause instanceof LocatedReadCommittedTransactionFailureV1)) {
      return cause;
    }
    return cause.issue.kind === "decisionUncertain"
      ? failureValue("decisionUncertain", false, cause)
      : failureValue(
          "resourceFailure",
          isRetryableLocatedReadCommittedTransactionFailure(cause),
          cause,
        );
  }));
});

function notReady(
  revisionId: string,
  reason: ApplicationRelationReadinessFoldNotReadyReason,
  detail?: string,
): Extract<
  ApplicationRelationReadinessFoldResult,
  { readonly status: "not_ready" }
> {
  return Object.freeze({
    status: "not_ready",
    revisionId,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
}

function candidateNotReadyReason(
  reason: "missing" | "inProgress" | "failed" | "wrongSchema",
): ApplicationRelationReadinessFoldNotReadyReason {
  switch (reason) {
    case "missing": return "candidateValidationMissing";
    case "inProgress": return "candidateValidationInProgress";
    case "failed": return "candidateValidationFailed";
    case "wrongSchema": return "candidateValidationWrongSchema";
  }
}

function uniqueNotReadyReason(
  reason: "setNotClosed" | "buildMissing" | "buildNotEnabled" | "buildStale",
): ApplicationRelationReadinessFoldNotReadyReason {
  switch (reason) {
    case "setNotClosed": return "uniqueConstraintSetMissing";
    case "buildMissing": return "uniqueConstraintBuildMissing";
    case "buildNotEnabled": return "uniqueConstraintBuildNotEnabled";
    case "buildStale": return "uniqueConstraintBuildStale";
  }
}

function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    UTF8.encode(value).byteLength <= 1_024;
}

function failure(
  reason: ApplicationRelationReadinessFoldError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationRelationReadinessFoldIssue> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureForOperation(
  operation: ApplicationRelationReadinessFoldError["operation"],
  reason: ApplicationRelationReadinessFoldError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationRelationReadinessFoldError> {
  return Effect.fail(new ApplicationRelationReadinessFoldError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  }));
}

function exposeFoldIssue(
  operation: ApplicationRelationReadinessFoldError["operation"],
  error: InternalApplicationRelationReadinessFoldError,
): SettleApplicationRelationReadinessFoldError {
  if (!(error instanceof ApplicationRelationReadinessFoldIssue)) return error;
  return new ApplicationRelationReadinessFoldError({
    operation,
    reason: error.reason,
    retryable: error.retryable,
    cause: error,
  });
}

function failureValue(
  reason: ApplicationRelationReadinessFoldError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationRelationReadinessFoldIssue {
  return new ApplicationRelationReadinessFoldIssue({
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
