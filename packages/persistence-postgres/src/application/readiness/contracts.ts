import type {
  CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import type { ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import type { Effect } from "effect";
import type {
  CanonicalApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import type {
  PreparedActivationServingInstallation,
  PreparedInstallation,
} from "../../installation/installationLifecycle";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import type { FlarexMetadataDatabase } from "../deployments";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  SettleApplicationReadinessError,
  ReadApplicationReadinessError,
} from "./errors";
import type {
  PublishedPhysicalRequirementSnapshotV1,
} from "../../storage/indexes/indexBuildReconciliation";
import type { FlarexDbV1StorageGeneration } from "flarex-protocol/storage-authority";
import type { ProtectedTargetMetadataEvidence } from "../../execution/preparation/preparedMetadataEpoch";
import type { OriginalSchemaVersionRead } from "../../storage/catalog/schemaVersionArtifacts";
import type { fxControlApplicationSchemaAuthoritiesV1 } from "../../database/schema";
import type { ApplicationSchemaAuthority } from "../applicationSchemaAuthority";

export interface ApplicationReadinessColdMaterializationPort<Failure> {
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly materialize: (input: {
    readonly target: CanonicalApplicationRuntimeTargetV1["target"];
    readonly manifest: ApplicationManifestV1;
  }) => Effect.Effect<CanonicalApplicationRuntimeColdReceiptV1, Failure>;
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

export type StoredApplicationReadinessActivationValidation = Extract<
  ApplicationReadinessActivationValidation,
  { readonly status: "ready" }
>;

export type ApplicationReadinessAuthority = TrustedScopeAuthority & Readonly<{
  readonly storageGeneration: FlarexDbV1StorageGeneration;
}>;

export interface ApplicationReadinessProtection {
  readonly target: ProtectedTargetMetadataEvidence;
  readonly control: ProtectedTargetMetadataEvidence;
}

export interface OriginalApplicationControlRead {
  readonly database: FlarexMetadataDatabase;
  readonly artifact: OriginalSchemaVersionRead;
  readonly schemaAuthority: Readonly<{
    row: typeof fxControlApplicationSchemaAuthoritiesV1.$inferSelect;
    schemaBindingByteLengthText: string;
  }>;
}

declare const readinessActivationViewBrand: unique symbol;

export interface PreparedApplicationReadinessActivation {
  readonly [readinessActivationViewBrand]: true;
}

declare const readinessCaptureBrand: unique symbol;

export interface CapturedApplicationReadiness {
  readonly [readinessCaptureBrand]: true;
}

export interface DerivedFiniteApplicationReadiness {
  readonly readiness: Extract<ApplicationReadinessResult, { readonly status: "ready" }>;
  readonly schema: ApplicationSchemaAuthority;
  readonly originalControl: OriginalApplicationControlRead;
}

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
