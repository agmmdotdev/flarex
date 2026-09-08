import {
  PointCommitCorruptionV1Error,
  PointCommitSqlFailureMarkerV1,
} from "../pointCommitErrors";

import { type AppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  type CatalogIndexDefinitionId,
  type CatalogUniqueConstraintDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import { type LogicalReadDependencyV1 } from "flarex-protocol/commit-protocol";
import {
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import { type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  type CommitSeq,
  type ReplacementScopeIdV1,
  type ScopeUuidV1,
  type SnapshotToken,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import { type AppDeveloperIndexDefinitionPortV1 } from "../appDeveloperIndexCommitV1";
import { type AppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import { type LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";

import {
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyV1,
} from "../appUniqueKeyContract";

import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";

import {
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationTargetDeleteRestrictedError,
  type ApplicationRelationCommitPort,
  type LocatedApplicationRelationDefinitionSet,
  type PreparedApplicationRelationCommit,
} from "../applicationRelationCommit";

import {
  type AppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
} from "../appSchemaCandidateValidation";
import type { IntrinsicCreationTimeIndexDefinitionPortV1 } from "../intrinsicCreationTimeIndexBuildV1";
import { type IndexBuildStateRecord } from "../indexBuildStates";
import { type AppRowPointHeadObservationV1 } from "../appRowPointOcc";

import { type ScopeClockRecord } from "../scopeClock";

export interface ApplicationDocumentDefinitionComposition {
  readonly hasRelationAuthority: (
    port: ApplicationRelationCommitPort,
  ) => boolean;
  readonly hasCandidateGuardAuthority: (
    port: AppSchemaCandidateWriteGuardPort,
  ) => boolean;
}

export type ApplicationDocumentMaterializationStep =
  | "tentativeRowWritten"
  | "intrinsicIndexEntryWritten"
  | "developerIndexEntryWritten"
  | "uniqueKeyWritten"
  | "relationEdgeWritten"
  | "relationRestrictValidated"
  | "uniqueConstraintValidationReset";

export interface ApplicationDocumentMaterializationOptions {
  /**
   * Private C08 composition. Absence keeps the lower-level O07/C07 proof lane
   * independent of a published schema; presence requires the exact intrinsic
   * definition and fails closed when it cannot be located.
   */
  readonly intrinsicCreationTimeIndexes?: IntrinsicCreationTimeIndexDefinitionPortV1;
  /** Private C08-A composition; absence preserves the lower O07 proof lane. */
  readonly developerIndexes?: AppDeveloperIndexDefinitionPortV1;
  /** Private C08-B2 composition; absence preserves the lower proof lane. */
  readonly uniqueConstraints?: AppUniqueConstraintDefinitionPortV1;
  /** Private C09 composition; absence preserves the lower proof lane. */
  readonly applicationRelations?: ApplicationRelationCommitPort;
  /** Private M03-B composition; absence preserves the lower commit lane. */
  readonly candidateSchemaWriteGuard?: AppSchemaCandidateWriteGuardPort;
  readonly afterTransactionStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: ApplicationDocumentMaterializationStep;
    }>,
  ) => Promise<void>;
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: "loadRelationTargets" | "loadRowHeads";
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

export interface PointCommitDependencyV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly dependency: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appRowPoint" }
  >;
}

export type PointCommitRowIntentV1 =
  | Readonly<
      PointCommitDependencyV1 & {
        readonly kind: "live";
        readonly creationTime: AppCreationTimeV1;
        readonly value: CanonicalFlarexRuntimeValueV1;
        readonly canonicalBytes: Uint8Array;
        readonly semanticSizeBytes: number;
      }
    >
  | Readonly<
      PointCommitDependencyV1 & {
        readonly kind: "deleted";
      }
    >;

export interface PreparedLivePointCommitRowIntentV1 extends Omit<
  Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
  "value" | "canonicalBytes" | "semanticSizeBytes"
> {
  readonly document: CanonicalFlarexValueV1;
}

export type PreparedPointCommitRowIntentV1 =
  | PreparedLivePointCommitRowIntentV1
  | Extract<PointCommitRowIntentV1, { readonly kind: "deleted" }>;

/** Shared document mechanics require no Application function, journal or session. */
export interface ApplicationDocumentDefinitionCommand {
  readonly authorityPins: {
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly scopeId: ReplacementScopeIdV1;
    readonly schemaVersionId: CatalogSchemaVersionId;
  };
  readonly rowIntents: ReadonlyArray<
    Pick<PreparedPointCommitRowIntentV1, "tableId">
  >;
}

export interface ApplicationDocumentMaterializationCommand extends ApplicationDocumentDefinitionCommand {
  readonly authorityPins: ApplicationDocumentDefinitionCommand["authorityPins"] & {
    readonly snapshotToken: SnapshotToken;
  };
  readonly rowIntents: ReadonlyArray<PreparedPointCommitRowIntentV1>;
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
}

export type ApplicationDocumentMaterializationClock = {
  readonly record: ScopeClockRecord;
  readonly scopeUuid: ScopeUuidV1;
};

export type PreparedPointCommitCandidateSchemaWriteGuard = Readonly<{
  readonly guard: AppSchemaCandidateWriteGuardPort;
  readonly prepared: PreparedAppSchemaCandidateWriteGuard;
}>;

export type PreparedPointCommitApplicationRelations = Readonly<{
  readonly port: ApplicationRelationCommitPort;
  readonly definitions: LocatedApplicationRelationDefinitionSet | null;
}>;

export type LocatedPreparedPointCommitApplicationRelations = Readonly<{
  readonly port: ApplicationRelationCommitPort;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
}>;

export interface LoadedPointCommitHeadV1 {
  readonly head: AppRowPointHeadObservationV1;
  readonly creationTime: AppCreationTimeV1 | null;
}

export type PreparedPointCommitApplicationRelationPlan = Readonly<{
  readonly port: ApplicationRelationCommitPort;
  readonly prepared: PreparedApplicationRelationCommit;
}>;

export type PointCommitApplicationRelationMaintenanceError =
  | ApplicationRelationCommitUnavailableError
  | ApplicationRelationTargetDeleteRestrictedError
  | PointCommitCorruptionV1Error
  | PointCommitSqlFailureMarkerV1;

export interface LockedPointCommitDeveloperIndexV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
}

export interface PointCommitDeveloperIndexEntryHeadV1 {
  readonly commitSeq: CommitSeq | null;
  readonly isTombstone: boolean | null;
}

export interface PointCommitDeveloperIndexEntryActionV1 {
  readonly kind: "live" | "tombstone";
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly prevCommitSeq: CommitSeq | null;
}

export interface PointCommitDeveloperIndexRowPlanV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly priorCommitSeq: CommitSeq | null;
  readonly priorKey: OrderedIndexKeyHexV1 | null;
  readonly finalKey: OrderedIndexKeyHexV1 | null;
}

export interface PointCommitDeveloperIndexDocumentRequestV1 {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly commitSeq: CommitSeq;
  readonly creationTime: AppCreationTimeV1;
}

export interface PointCommitUniqueKeyPlanV1 {
  readonly definition: LocatedAppUniqueConstraintDefinitionV1;
  readonly rowId: AppRowIdHexV1;
  readonly rowPrevCommitSeq: CommitSeq | null;
  readonly previousProjection: AppUniqueKeyProjectionV1 | null;
  readonly previousCanonical: CanonicalAppUniqueKeyV1 | null;
  readonly nextProjection: AppUniqueKeyProjectionV1 | null;
  readonly nextCanonical: CanonicalAppUniqueKeyV1 | null;
}

export interface PointCommitUniqueKeyOwnerV1 {
  readonly commitSeq: CommitSeq;
  readonly encodedKey: OrderedIndexKeyHexV1;
}

export interface PointCommitUniqueKeyOwnerPositionV1 {
  readonly definitionId: CatalogUniqueConstraintDefinitionId;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface PointCommitUniqueKeyActionV1 {
  readonly phase: "release" | "advance" | "claim";
  readonly definition: LocatedAppUniqueConstraintDefinitionV1;
  readonly rowId: AppRowIdHexV1;
  readonly rowPrevCommitSeq: CommitSeq | null;
  readonly previousClaimCommitSeq: CommitSeq | null;
  readonly previous: AppUniqueKeyProjectionV1 | null;
  readonly next: AppUniqueKeyProjectionV1 | null;
  readonly sortKey: OrderedIndexKeyHexV1;
}

export interface PointCommitDeveloperIndexPositionV1 {
  readonly definitionId: CatalogIndexDefinitionId;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

export interface LockedPointCommitIntrinsicIndexV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly build: IndexBuildStateRecord;
}
