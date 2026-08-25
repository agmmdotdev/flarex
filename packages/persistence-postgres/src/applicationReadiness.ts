import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  applicationFunctionEntryPublicationFrameV1,
  applicationSchemaPublicationFrameV1,
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
import { MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 } from
  "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  type ApplicationSchemaAuthority,
  type ApplicationSchemaAuthorityError,
  type ApplicationSchemaAuthorityPublisher,
  hasApplicationSchemaAuthorityComposition,
} from "./applicationSchemaAuthority";
import {
  isApplicationTaskCatalogSnapshotPort,
  type ApplicationTaskCatalogSnapshot,
  type ApplicationTaskCatalogSnapshotError,
  type ApplicationTaskCatalogSnapshotPort,
} from "./applicationTaskBindings";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { detachDriverRows } from "./detachDriverRows";
import { runEffectTransaction } from "./effectTransaction";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  type IndexBuildReconciliationCatalogV1Error,
  type PublishedPhysicalRequirementSnapshotV1,
} from "./indexBuildReconciliation";
import {
  decodeIndexBuildStateRowResult,
  type IndexBuildStateRecord,
  validateIndexBuildStateFrontierResult,
} from "./indexBuildStates";
import type { ReadAppIndexDefinitionError } from "./appIndexDefinitions";
import type { ReadAppSchemaVersionIndexBindingError } from
  "./appIndexDefinitions";
import type { ReadSchemaVersionArtifactError } from "./schemaVersionArtifacts";
import {
  hasPhysicalDefinitionLifecycleComposition,
  preparePhysicalDefinitionLifecycleReadinessEffect,
  validatePhysicalDefinitionLifecycleReadinessInTransactionEffect,
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
} from "./pointCommitTransaction";
import type {
  AppUniqueConstraintSetEligibilityResultV1,
} from "./appUniqueConstraintSetBuildV1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
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
  fxSystemScopeClocks,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_FUNCTIONS = 4_096;
const MAX_PHYSICAL_DEFINITIONS = 16_384;
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
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
  readonly schema: ApplicationSchemaAuthorityPublisher<SchemaFailure>;
  readonly taskCatalog: ApplicationTaskCatalogSnapshotPort;
  readonly candidateValidation: AppSchemaCandidateReadinessPort;
  /** Exact point-commit factory result; structural substitutes fail closed. */
  readonly pointCommit: unknown;
  /** Exact scope-local physical-definition availability authority. */
  readonly physicalDefinitionLifecycle: PhysicalDefinitionLifecyclePort;
  readonly cold: ApplicationReadinessColdMaterializationPort<ColdFailure>;
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
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationReadinessResult,
    SettleApplicationReadinessError<SchemaFailure, ColdFailure>
  >;
  readonly readReady: (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationReadinessResult,
    ReadApplicationReadinessError
  >;
}

export interface ApplicationReadinessActivationBasis {
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
  readonly bundle: StoredBundle;
  readonly schemaVersion: CatalogSchemaVersion;
  readonly schema: ApplicationSchemaAuthority;
  readonly schemaBindingSha256: Uint8Array;
  readonly requirements: PublishedPhysicalRequirementSnapshotV1;
  readonly physicalDefinitionLifecycle:
    PreparedPhysicalDefinitionLifecycleReadiness;
  readonly cold: PreparedColdEvidence;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
  readonly readyAt: Date;
}

interface StoredIssuedApplicationReadinessState {
  readonly kind: "stored";
  readonly issuer: ApplicationReadinessRepositoryIssuerV1;
  readonly stored: StoredReadinessAuthority;
  readonly readinessSha256: Uint8Array;
  readonly readinessBytes: Uint8Array;
}

type IssuedApplicationReadinessState =
  | PreparedIssuedApplicationReadinessState
  | StoredIssuedApplicationReadinessState;

const readinessRepositoryStates = new WeakMap<
  object,
  ApplicationReadinessIssuerState
>();
const issuedReadinessStates = new WeakMap<
  Extract<ApplicationReadinessResult, { readonly status: "ready" }>,
  IssuedApplicationReadinessState
>();

export function makeApplicationReadinessRepository<SchemaFailure, ColdFailure>(
  context: ApplicationReadinessContext<SchemaFailure, ColdFailure>,
): ApplicationReadinessRepository<SchemaFailure, ColdFailure> {
  const capturedContext = Object.freeze({
    controlDb: context.controlDb,
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
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
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
          uniqueConstraintEligibility,
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
        uniqueConstraintFrame(uniqueConstraintEligibility),
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
        revisionId: input.revisionId,
      });
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        captured.deploymentId,
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
          "share",
        ),
      );
      if ("status" in reserved) return reserved;
      const schema = yield* capturedContext.schema.readPublished({
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
          uniqueConstraintEligibility,
        );
      const schemaBindingSha256 = yield* runTransaction(
        capturedContext.controlDb,
        tx => readSchemaBinding(tx, reserved, schemaVersion, schema),
      );
      const stored = yield* runLocatedTransaction(
        located.target,
        tx => Effect.gen(function* () {
          const clock = yield* lockScopeClockForShareInTransactionEffect(
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
          if (physical.status === "not_ready") return physical;
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
          );
          return storedAuthority === null
            ? yield* readinessFailure("storedState")
            : storedAuthority;
        }),
      );
      return "status" in stored
        ? notReady(
            reserved.revision.revisionId,
            stored.reason,
            stored.detail,
          )
        : storedReadyProjection(stored, issuer);
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

export const validateStoredApplicationReadinessForActivationInTransaction =
  Effect.fn("ApplicationReadiness.validateStoredForActivationInTransaction")(
    function* (
      repository: unknown,
      issued: ApplicationReadinessResult,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
    ): Effect.fn.Return<
      StoredApplicationReadinessActivationValidation,
      | ApplicationReadinessError
      | ApplicationTaskCatalogSnapshotError
      | ValidatePhysicalDefinitionLifecycleReadinessError
      | LockScopeClockForShareError
    > {
      if (typeof repository !== "object" || repository === null ||
        issued.status !== "ready") {
        return yield* readinessFailure("invalidComposition");
      }
      const repositoryState = readinessRepositoryStates.get(repository);
      const issuedState = issuedReadinessStates.get(issued);
      if (repositoryState === undefined || issuedState === undefined ||
        issuedState.kind !== "stored" ||
        issuedState.issuer !== repositoryState.issuer ||
        issuedState.stored.bundle.authority.scopeId !== currentClock.scopeId) {
        return yield* readinessFailure("invalidComposition");
      }
      return yield* validateStoredIssuedReadiness(
        repositoryState,
        issuedState,
        tx,
      );
    },
  );

const validateStoredIssuedReadiness = Effect.fn(
  "ApplicationReadiness.validateStoredIssuedReadiness",
)(function* (
  repositoryState: ApplicationReadinessIssuerState,
  issuedState: StoredIssuedApplicationReadinessState,
  tx: AppRowTransaction,
): Effect.fn.Return<
  StoredApplicationReadinessActivationValidation,
  | ApplicationReadinessError
  | ApplicationTaskCatalogSnapshotError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | LockScopeClockForShareError
> {
  const currentBundle = yield* reserveBundle(
    tx,
    issuedState.stored.bundle.authority,
    Object.freeze({
      deploymentId: issuedState.stored.bundle.deploymentId,
      revisionId: issuedState.stored.bundle.revision.revisionId,
    }),
    repositoryState.context.taskCatalog,
    "share",
  );
  if ("status" in currentBundle ||
    !storedBundlesEqual(currentBundle, issuedState.stored.bundle)) {
    return yield* readinessFailure("authorityChanged");
  }
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    currentBundle.authority.scopeId,
  );
  const physical = yield* loadPhysicalReadiness(
    tx,
    currentBundle.authority,
    issuedState.stored.requirements,
    repositoryState.context.physicalDefinitionLifecycle,
    issuedState.stored.physicalDefinitionLifecycle,
    clock,
  );
  if (physical.status === "not_ready") {
    return yield* readinessFailure("authorityChanged");
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
): Effect.fn.Return<StoredBundle | Extract<ApplicationReadinessResult, {
  readonly status: "not_ready";
}>, ApplicationReadinessError | ApplicationTaskCatalogSnapshotError |
  LockScopeClockForShareError> {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      authority.scopeId,
    );
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
    if (candidate === undefined ||
      candidate.storageGeneration !== authority.storageGeneration ||
      candidate.storageGenerationFence !== authority.storageGenerationFence ||
      candidate.epoch !== authority.epoch ||
      !bytesEqualFullScan(
        candidate.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      )) return yield* readinessFailure("authorityChanged");
    const analysisRows = yield* query(
      tx.select().from(fxSystemApplicationAnalysesV1).where(and(
        eq(fxSystemApplicationAnalysesV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId, revision.analysisId),
      )).limit(1),
    );
    const analysis = analysisRows[0];
    if (analysis === undefined || analysis.status !== "analyzed" ||
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
    const publicationRows = yield* query(
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId, revision.revisionId),
      )).limit(1),
    );
    const publication = publicationRows[0];
    if (publication === undefined) {
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
    if (!bytesEqualFullScan(yield* sha256(schemaFrame), publication.schemaSha256)) {
      return yield* readinessFailure("storedState");
    }
    const functionRows = yield* query(
      tx.select().from(fxSystemApplicationFunctionsV1).where(and(
        eq(fxSystemApplicationFunctionsV1.scopeId, revision.scopeId),
        eq(fxSystemApplicationFunctionsV1.revisionId, revision.revisionId),
      )),
    );
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
    const task = yield* taskCatalog.loadInTransaction(
      tx,
      authority,
      revision.revisionId,
    );
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

function readSchemaBinding(
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
    return copyBytes(bindingSha256);
  });
}

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

function loadStoredColdEvidence<Failure>(
  tx: AppRowTransaction,
  bundle: StoredBundle,
  port: ApplicationReadinessColdMaterializationPort<Failure>,
): Effect.Effect<PreparedColdEvidence | null, ApplicationReadinessError |
  LockScopeClockForShareError> {
  return Effect.gen(function* () {
    const runtimeHostIdentity = port.runtimeHostIdentity;
    const compatibilityDate = port.compatibilityDate;
    if (!validRuntimeHostIdentity(runtimeHostIdentity) ||
      !validCompatibilityDate(compatibilityDate) ||
      typeof port.materialize !== "function" ||
      runtimeHostIdentity !== bundle.task.runtimeHostIdentity ||
      compatibilityDate !== bundle.task.compatibilityDate) {
      return yield* readinessFailure("coldMaterialization");
    }
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      bundle.authority.scopeId,
    );
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
}

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
): Effect.fn.Return<
  StoredReadinessAuthority | null,
  ApplicationReadinessError | LockScopeClockForShareError
> {
  const cold = yield* loadStoredColdEvidence(tx, bundle, coldPort);
  if (cold === null) return null;
  const rows = yield* query(
    tx.select().from(fxSystemApplicationReadinessV1).where(and(
      eq(fxSystemApplicationReadinessV1.scopeId, bundle.authority.scopeId),
      eq(fxSystemApplicationReadinessV1.revisionId, bundle.revision.revisionId),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined) return yield* readinessFailure("storedState");
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
        yield* digestCanonicalJson(uniqueConstraintFrame(validatedUnique)),
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
      return readyProjection(
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
    return readyProjection(
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
      readonly reason: "physicalBuildMissing" | "physicalBuildNotEnabled";
      readonly detail: string;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly rows: ReadonlyArray<IndexBuildStateRecord>;
    }>;

export type ApplicationPhysicalReadinessResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly reason:
        | "physicalBuildMissing"
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
): Effect.fn.Return<
  ApplicationPhysicalReadinessResult,
  ApplicationReadinessError |
    ValidatePhysicalDefinitionLifecycleReadinessError
> {
  const physicalBuilds = yield* loadPhysicalBuildRows(
    tx,
    authority,
    requirements,
    clock,
  );
  if (physicalBuilds.status === "not_ready") return physicalBuilds;
  const lifecycle = yield*
    validatePhysicalDefinitionLifecycleReadinessInTransactionEffect(
      lifecyclePort,
      lifecycleReadiness,
      tx,
      authority,
      clock,
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
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence.toString(),
    epoch: clock.epoch,
    schemaVersionId: requirements.schemaVersionId,
    schemaManifestSha256:
      encodeBytesToLowercaseHex(requirements.manifestSha256),
    requirementCount: requirements.definitions.length,
    indexes: physicalBuilds.rows.map((build, index) => {
      const requirement = requirements.definitions[index];
      if (requirement === undefined) {
        throw new Error("Application readiness physical definition vanished.");
      }
      return {
        indexDefinitionId: build.indexDefinitionId,
        physicalSpecCodecVersion: requirement.physicalSpecCodecVersion,
        physicalSpecSha256Hex: requirement.physicalSpecSha256Hex,
        lifecycle: build.lifecycle,
        startCommitSeq: build.startCommitSeq.toString(),
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
): Effect.fn.Return<PhysicalBuildRowsResult, ApplicationReadinessError> {
    yield* requireExactAuthority(authority, clock);
    const definitionIds = requirements.definitions.map(
      definition => definition.indexDefinitionId,
    );
    const unordered = definitionIds.length === 0 ? [] : yield* query(
      tx.select().from(fxSystemIndexBuildStates).where(and(
        eq(fxSystemIndexBuildStates.scopeId, authority.scopeId),
        inArray(fxSystemIndexBuildStates.indexDefinitionId, definitionIds),
      )).for("share"),
    );
    const rowsById = new Map(
      unordered.map(row => [row.indexDefinitionId, row] as const),
    );
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
        });
      }
      const decoded = yield* Effect.fromResult(
        decodeIndexBuildStateRowResult(
          build,
          authority.scopeId,
          definitionId,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      yield* Effect.fromResult(
        validateIndexBuildStateFrontierResult(
          decoded,
          clock.lastCommitSeq,
        ).pipe(Result.mapError(cause => readinessFailureValue(
          "storedState",
          false,
          cause,
        ))),
      );
      if (decoded.storageGeneration !== clock.storageGeneration ||
        decoded.storageGenerationFence !== clock.storageGenerationFence ||
        decoded.epoch !== clock.epoch) {
        return yield* readinessFailure("authorityChanged");
      }
      if (decoded.lifecycle !== "enabled") {
        return Object.freeze({
          status: "not_ready" as const,
          reason: "physicalBuildNotEnabled" as const,
          detail: `${definitionId}:${decoded.lifecycle}`,
        });
      }
      rows.push(decoded);
    }
    return Object.freeze({ status: "ready" as const, rows: Object.freeze(rows) });
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

function readyProjection(
  disposition: "inserted" | "replayed",
  prepared: PreparedReadiness,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
  readyAt: Date,
  issuer: ApplicationReadinessRepositoryIssuerV1,
): ApplicationReadinessResult {
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
  return result;
}

function storedReadyProjection(
  stored: StoredReadinessAuthority,
  issuer: ApplicationReadinessRepositoryIssuerV1,
): ApplicationReadinessResult {
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
    stored,
    readinessSha256: copyBytes(stored.readinessSha256),
    readinessBytes: copyBytes(stored.readinessBytes),
  }));
  return result;
}

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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value;
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
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => readinessFailureValue(
      "resourceFailure",
      retryableCause(cause),
      cause,
    ),
  });
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationReadinessError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => readinessFailureValue(
      "resourceFailure",
      retryableCause(cause),
      cause,
    ),
  }).pipe(Effect.asVoid);
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
