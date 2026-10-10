import { observeExecution } from "./diagnostics/operation";
import { createHash } from "node:crypto";
import { captureDriverDecoder, compileFiniteCaptureResultMapper, type CaptureProjectionField } from "./finiteStorageCaptureProjection";
import { Data, Effect, Result, Schema } from "effect";
import { getTableName, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";

import type { FlarexMetadataDatabase } from "../application/deployments";
import type { FlarexMetadataTransaction } from "../database/metadataTransaction";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { prepareFiniteAttemptStorageCaptureBasis, projectExpectedFiniteAttemptAnchor, readFiniteAttemptAnchorRow } from "./finiteAttemptAnchor";
import { prepareInstalledFiniteCaptureSource } from "../scope/scopeAuthorityControlRead";
import { getCoLocatedReadInstallationReferencesResult, type PreparedCoLocatedReadInstallation } from "../installation/installationLifecycle";
import { runEffectTransaction } from "../database/effectTransaction";

import { prepareAppRowsSnapshotReadEffect, buildPreparedAppRowsSnapshotReadStatement } from "../storage/documents/appRows";
import { prepareAppIndexSnapshotReadEffect, buildPreparedAppIndexSnapshotReadStatement } from "../storage/indexes/appIndexEntries";
import { inspectFiniteParticipantStorageDemand } from "../storage/documents/logicalDocuments/participantAdmission";
import { inspectFiniteApplicationStorageDemand, readFiniteStorageCaptureMetadata, readFiniteStorageCaptureRetirementAuthority } from "../storage/documents/logicalDocuments/sourceAdmission";
import { fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds, fxSystemTransactionSessions,
  fxSystemPreparedMetadataEpoch, fxSystemIndexMaintenanceObligations, fxSystemUniqueMaintenanceObligations } from "../database/schema";
import { decodeIndexBuildStateRowResult, validateIndexBuildStateFrontierResult } from "../storage/indexes/indexBuildStates";
import { decodeFiniteUniqueBuildStateEffect } from "../storage/unique/appUniqueConstraintSetBuildV1";
import { makePhysicalDeadlineOperations } from "../database/physicalSession/deadline";
import type { PostgresPhysicalSessionDriver } from "../database/physicalSession/postgres";
import type { CatalogTableId, CatalogIndexDefinitionId } from "flarex-protocol/catalog";
import type { ScanAppIndexAtSnapshotV1Input, PreparedAppIndexSnapshotRead } from "../storage/indexes/appIndexEntries";
import type { ReadAppRowsAtSnapshotV1Input, PreparedAppRowsSnapshotRead } from "../storage/documents/appRows";
import type {
  ExactRunningAttemptKernelInputV1,
} from "./session/kernelContracts";
import { resolveLocatedTrustedScopeAuthorityByIdEffect, resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError, type LocatedScopeClockReader, type ExactTrustedScopeAuthorityResolutionPorts } from "../scope/scopeAuthorityResolution";
import type { LocatedTrustedScopeAuthority, TrustedScopeAuthorityError } from "../scope/scopeAuthorityResolution";
import {
  ScopeClockCorruptionError,
} from "../scope/scopeClockErrors";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../database/locatedTransactionIdentity";

import { decodeCapturedApplicationWriteOwnershipEffect } from "../application/ownership/Repository";
import { ApplicationWriteOwnershipHistoryBudget, denyManagedApplicationTableWrites } from "../application/ownership/Policy";
import { ApplicationWriteOwnershipError } from "../application/ownership/Model";


import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  PointMutationSessionAttemptSelectorV1,
} from "./session/contracts";
import type { TransactionExecutionClaimPinV1 } from "./claims/transactionExecutionClaimModel";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../storage/unique/appUniqueConstraintDefinitions";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";

export type FiniteStorageCaptureOperation =
  | Readonly<{ kind: "rows"; input: ReadAppRowsAtSnapshotV1Input; maximumTotalValueBytes?: number; settlementWindow?: true }>
  | Readonly<{ kind: "indexPage"; input: ScanAppIndexAtSnapshotV1Input; tableId: CatalogTableId }>
  | Readonly<{ kind: "indexRows"; input: ScanAppIndexAtSnapshotV1Input; tableId: CatalogTableId;
      excludeRowIds?: readonly AppRowIdHexV1[]; maximumTotalValueBytes?: number; maximumHydratedOwners?: 1 }>
  | Readonly<{ kind: "ownership"; tableId: CatalogTableId }>
  | Readonly<{ kind: "historicalIdentity"; tableId: CatalogTableId; rowId: Uint8Array }>
  | Readonly<{ kind: "transactionTime" }>
  | Readonly<{ kind: "retirement"; selector: PointMutationSessionAttemptSelectorV1; executionClaim: TransactionExecutionClaimPinV1 }>;

export interface FiniteStorageCaptureEnvelopes {
  readonly rows: Readonly<{ kind: "rows"; prepared: PreparedAppRowsSnapshotRead; rawRows: readonly unknown[] }>;
  readonly indexPage: Readonly<{ kind: "indexPage"; prepared: PreparedAppIndexSnapshotRead; rawRows: readonly unknown[] }>;
  readonly indexRows: Readonly<{ kind: "indexRows"; prepared: PreparedAppIndexSnapshotRead; rawIndexRows: readonly unknown[]; rawRows: readonly unknown[] }>;
  readonly ownership: Readonly<{ kind: "ownership"; denied: boolean }>;
  readonly historicalIdentity: Readonly<{ kind: "historicalIdentity"; exists: boolean }>;
  readonly transactionTime: Readonly<{ kind: "transactionTime"; timestamp: string }>;
  readonly retirement: Readonly<{ kind: "retirement"; retired: boolean }>;
}

const refused = (reason: FiniteStorageCaptureError["reason"], cause?: unknown) =>
  new FiniteStorageCaptureError({ reason, ...(cause === undefined ? {} : { cause }) });
const scopeFailure = (cause: TrustedScopeAuthorityError) => cause instanceof TrustedScopeAuthorityPortError ? refused(
  cause.cause instanceof ScopeClockCorruptionError ? "storedCorruption" : "resourceFailure", cause) : refused("invalidAuthority", cause);
const HeaderReasonSchema = Schema.Literals(["accepted", "invalidAuthority", "resourceFailure", "storedCorruption", "attemptMissing",
  "attemptReplaced", "ownershipChanged", "lifecycleChanged", "expired", "unsupportedStorageGeneration",
  "storageGenerationFenceChanged", "scopeEpochChanged", "authorizationRevocationEpochChanged"]);
const decodeReason = Schema.decodeUnknownEffect(HeaderReasonSchema);
const decodeTime = Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^[0-9]+$/)));
const ControlEpochSchema = Schema.Struct({ databaseName: Schema.NonEmptyString, namespaceOid: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  incarnation: Schema.String.check(Schema.isUUID()), generation: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  login: Schema.NonEmptyString, valid: Schema.Literal(true) });
const decodeControlEpoch = Schema.decodeUnknownEffect(Schema.Tuple([ControlEpochSchema]));
type ControlEpoch = typeof ControlEpochSchema.Type;
type ControlCapture = Readonly<{ rawRows: readonly unknown[]; epoch: ControlEpoch }>;
const sameControlEpoch = (a: ControlEpoch, b: ControlEpoch) => a.databaseName === b.databaseName &&
  a.namespaceOid === b.namespaceOid && a.incarnation === b.incarnation && a.generation === b.generation && a.login === b.login;
type ExpectedAnchor = Result.Result.Success<ReturnType<typeof projectExpectedFiniteAttemptAnchor>>;

export type FiniteStorageCaptureProfile =
  | Readonly<{ kind: "installed"; installation: PreparedCoLocatedReadInstallation;
      driver: Pick<PostgresPhysicalSessionDriver<FiniteStorageCaptureError>, "runImplicitReadEffect"> }>
  | Readonly<{ kind: "fullArtifact"; authority?: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> }>;

type InternalCaptureOperation = FiniteStorageCaptureOperation |
  Readonly<{ kind: "ownershipFence" }> |
  Readonly<{ kind: "ownershipPolicyManifest"; revisionId: string; remaining: Readonly<{ records: number; bytes: number }> }> |
  Readonly<{ kind: "ownershipUniqueClosure"; deploymentId: string; schemaVersionId: CatalogSchemaVersionId;
    remaining: Readonly<{ records: number; bytes: number }> }>;

const indexMaintenanceTable = alias(fxSystemIndexMaintenanceObligations, "index_maintenance");
const indexMaintenanceFields = {
  scopeId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.scopeId.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.scopeId),
  activationSequence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.activationSequence.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.activationSequence),
  storageGeneration: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.storageGeneration.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.storageGeneration),
  storageGenerationFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.storageGenerationFence.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.storageGenerationFence),
  epoch: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.epoch.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.epoch),
  attemptFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.attemptFence.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.attemptFence),
  openedCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.openedCommitSeq.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.openedCommitSeq),
  tableId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.tableId.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.tableId),
  physicalSpecSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.physicalSpecSha256.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.physicalSpecSha256),
  deploymentId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.deploymentId.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.deploymentId),
  schemaVersionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.schemaVersionId.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.schemaVersionId),
  activationSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.activationSha256.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.activationSha256),
  headSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.headSha256.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.headSha256),
  indexDefinitionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.indexDefinitionId.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.indexDefinitionId),
  firstReadableCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.firstReadableCommitSeq.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.firstReadableCommitSeq),
  schemaManifestSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(indexMaintenanceTable))}.${sql.identifier(indexMaintenanceTable.schemaManifestSha256.name)} else null end`.mapWith(fxSystemIndexMaintenanceObligations.schemaManifestSha256),
};

const uniqueMaintenanceTable = alias(fxSystemUniqueMaintenanceObligations, "unique_maintenance");
const uniqueMaintenanceFields = {
  scopeId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.scopeId.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.scopeId),
  activationSequence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.activationSequence.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.activationSequence),
  storageGeneration: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.storageGeneration.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.storageGeneration),
  storageGenerationFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.storageGenerationFence.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.storageGenerationFence),
  epoch: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.epoch.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.epoch),
  attemptFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.attemptFence.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.attemptFence),
  openedCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.openedCommitSeq.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.openedCommitSeq),
  tableId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.tableId.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.tableId),
  physicalSpecSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.physicalSpecSha256.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.physicalSpecSha256),
  deploymentId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.deploymentId.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.deploymentId),
  schemaVersionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.schemaVersionId.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.schemaVersionId),
  activationSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.activationSha256.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.activationSha256),
  headSha256: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.headSha256.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.headSha256),
  uniqueConstraintDefinitionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.uniqueConstraintDefinitionId.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId),
  startCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${sql.identifier(getTableName(uniqueMaintenanceTable))}.${sql.identifier(uniqueMaintenanceTable.startCommitSeq.name)} else null end`.mapWith(fxSystemUniqueMaintenanceObligations.startCommitSeq),
};

const buildFields = {
  scopeId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.scopeId.name)} else null end`.mapWith(fxSystemIndexBuildStates.scopeId),
  indexDefinitionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.indexDefinitionId.name)} else null end`.mapWith(fxSystemIndexBuildStates.indexDefinitionId),
  storageGeneration: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.storageGeneration.name)} else null end`.mapWith(fxSystemIndexBuildStates.storageGeneration),
  storageGenerationFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.storageGenerationFence.name)} else null end`.mapWith(fxSystemIndexBuildStates.storageGenerationFence),
  epoch: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.epoch.name)} else null end`.mapWith(fxSystemIndexBuildStates.epoch),
  startCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.startCommitSeq.name)} else null end`.mapWith(fxSystemIndexBuildStates.startCommitSeq),
  coveredThroughCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.coveredThroughCommitSeq.name)} else null end`.mapWith(fxSystemIndexBuildStates.coveredThroughCommitSeq),
  firstReadableCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.firstReadableCommitSeq.name)} else null end`.mapWith(fxSystemIndexBuildStates.firstReadableCommitSeq),
  maintenanceActivationSequence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.maintenanceActivationSequence.name)} else null end`.mapWith(fxSystemIndexBuildStates.maintenanceActivationSequence),
  lifecycle: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.lifecycle.name)} else null end`.mapWith(fxSystemIndexBuildStates.lifecycle),
  cursorCodecVersion: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.cursorCodecVersion.name)} else null end`.mapWith(fxSystemIndexBuildStates.cursorCodecVersion),
  backfillCursorRowId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.backfillCursorRowId.name)} else null end`.mapWith(fxSystemIndexBuildStates.backfillCursorRowId),
  attemptFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.attemptFence.name)} else null end`.mapWith(fxSystemIndexBuildStates.attemptFence),
  createdAt: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.createdAt.name)} else null end`.mapWith(fxSystemIndexBuildStates.createdAt),
  updatedAt: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.updatedAt.name)} else null end`.mapWith(fxSystemIndexBuildStates.updatedAt),
};

const uniqueFields = {
  scopeId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.scopeId.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.scopeId),
  uniqueConstraintDefinitionId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId),
  storageGeneration: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.storageGeneration.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.storageGeneration),
  storageGenerationFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.storageGenerationFence.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.storageGenerationFence),
  epoch: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.epoch.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.epoch),
  startCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.startCommitSeq.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.startCommitSeq),
  lifecycle: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.lifecycle.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.lifecycle),
  coveredThroughCommitSeq: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq),
  maintenanceActivationSequence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence),
  cursorRowId: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.cursorRowId.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.cursorRowId),
  attemptFence: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.attemptFence.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.attemptFence),
  createdAt: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.createdAt.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.createdAt),
  updatedAt: sql`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.updatedAt.name)} else null end`.mapWith(fxSystemUniqueConstraintBuilds.updatedAt),
};
const frontierFields = {
  scopeUuid: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.scopeUuid.name)} else null end`.mapWith(fxSystemTransactionSessions.scopeUuid),
  sessionId: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.sessionId.name)} else null end`.mapWith(fxSystemTransactionSessions.sessionId),
  attemptFence: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.attemptFence.name)} else null end`.mapWith(fxSystemTransactionSessions.attemptFence),
  executionProfile: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.executionProfile.name)} else null end`.mapWith(fxSystemTransactionSessions.executionProfile),
  policyVersion: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.policyVersion.name)} else null end`.mapWith(fxSystemTransactionSessions.policyVersion),
  protocolVersion: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.protocolVersion.name)} else null end`.mapWith(fxSystemTransactionSessions.protocolVersion),
  executionAuthorityGeneration: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.executionAuthorityGeneration.name)} else null end`.mapWith(fxSystemTransactionSessions.executionAuthorityGeneration),
  functionPath: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.functionPath.name)} else null end`.mapWith(fxSystemTransactionSessions.functionPath),
  functionKind: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.functionKind.name)} else null end`.mapWith(fxSystemTransactionSessions.functionKind),
  executionModule: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.executionModule.name)} else null end`.mapWith(fxSystemTransactionSessions.executionModule),
  schemaVersionId: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.schemaVersionId.name)} else null end`.mapWith(fxSystemTransactionSessions.schemaVersionId),
  packageId: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.packageId.name)} else null end`.mapWith(fxSystemTransactionSessions.packageId),
  artifactRuntime: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.artifactRuntime.name)} else null end`.mapWith(fxSystemTransactionSessions.artifactRuntime),
  artifactId: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.artifactId.name)} else null end`.mapWith(fxSystemTransactionSessions.artifactId),
  sourcePackageHash: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.sourcePackageHash.name)} else null end`.mapWith(fxSystemTransactionSessions.sourcePackageHash),
  validatedArgsValueCodecVersion: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.validatedArgsValueCodecVersion.name)} else null end`.mapWith(fxSystemTransactionSessions.validatedArgsValueCodecVersion),
  authorizationGrantValueCodecVersion: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.authorizationGrantValueCodecVersion.name)} else null end`.mapWith(fxSystemTransactionSessions.authorizationGrantValueCodecVersion),
  storageGeneration: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.storageGeneration.name)} else null end`.mapWith(fxSystemTransactionSessions.storageGeneration),
  storageGenerationFence: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.storageGenerationFence.name)} else null end`.mapWith(fxSystemTransactionSessions.storageGenerationFence),
  identityAccessPolicySha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.identityAccessPolicySha256.name)} else null end`.mapWith(fxSystemTransactionSessions.identityAccessPolicySha256),
  requestSha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.requestSha256.name)} else null end`.mapWith(fxSystemTransactionSessions.requestSha256),
  validatedArgsSha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.validatedArgsSha256.name)} else null end`.mapWith(fxSystemTransactionSessions.validatedArgsSha256),
  authorizationGrantId: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.authorizationGrantId.name)} else null end`.mapWith(fxSystemTransactionSessions.authorizationGrantId),
  authorizationGrantSha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.authorizationGrantSha256.name)} else null end`.mapWith(fxSystemTransactionSessions.authorizationGrantSha256),
  applicationExecutionAuthoritySha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.applicationExecutionAuthoritySha256.name)} else null end`.mapWith(fxSystemTransactionSessions.applicationExecutionAuthoritySha256),
  requestKey: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.requestKey.name)} else null end`.mapWith(fxSystemTransactionSessions.requestKey),
  lifecycle: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.lifecycle.name)} else null end`.mapWith(fxSystemTransactionSessions.lifecycle),
  authorizationRevocationEpoch: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.authorizationRevocationEpoch.name)} else null end`.mapWith(fxSystemTransactionSessions.authorizationRevocationEpoch),
  authorizationGrantExpiresAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.authorizationGrantExpiresAt.name)} else null end`.mapWith(fxSystemTransactionSessions.authorizationGrantExpiresAt),
  hardExpiresAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.hardExpiresAt.name)} else null end`.mapWith(fxSystemTransactionSessions.hardExpiresAt),
  createdAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.createdAt.name)} else null end`.mapWith(fxSystemTransactionSessions.createdAt),
  updatedAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.updatedAt.name)} else null end`.mapWith(fxSystemTransactionSessions.updatedAt),
  finiteAttemptBytes: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteAttemptBytes.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteAttemptBytes),
  finiteAttemptSha256: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteAttemptSha256.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteAttemptSha256),
  finiteSnapshotEpochUuid: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteSnapshotEpochUuid.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteSnapshotEpochUuid),
  finiteSnapshotCommitSeq: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteSnapshotCommitSeq.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteSnapshotCommitSeq),
  finiteMetadataWatermark: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteMetadataWatermark.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteMetadataWatermark),
  finiteLeaseExpiresAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteLeaseExpiresAt),
  finiteClaimOwner: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteClaimOwner.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteClaimOwner),
  finiteClaimFence: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteClaimFence.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteClaimFence),
  finiteClaimedAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteClaimedAt.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteClaimedAt),
  finiteClaimExpiresAt: sql`case when capture.reason = 'attemptReplaced' and coalesce(storage._capture_header_ordinal,1) = 1 then (capture.session_row).${sql.identifier(fxSystemTransactionSessions.finiteClaimExpiresAt.name)} else null end`.mapWith(fxSystemTransactionSessions.finiteClaimExpiresAt),
};
const ownershipFields = ["kind", "ordinal", "scopeId", "sequenceText", "previousSequenceText", "revisionId", "readinessContractVersion", "relationCount", "activatedAtText", "createdAtText", "updatedAtText", "evidenceLength", "evidenceBytes", "evidenceSha256", "bodyWithheld", "readinessSha256", "relationSetReadinessSha256", "writePolicySetSha256", "writeOwnershipSha256", "activationSha256", "activationRequestSha256", "legacyReadinessSha256", "relationReadinessSha256"];
const manifestFields = ["evidenceLength", "bytes", "hash", "publicationHash", "analysisHash", "deploymentId", "schemaVersionId"];
const closureFields = ["kind", "ordinal", "evidenceLength", "deploymentId", "schemaVersionId", "setCodecVersion", "definitionCount", "definitionSetSha256", "closedAtText", "uniqueConstraintDefinitionId", "logicalUniqueConstraintId", "tableId", "physicalSpecCodecVersion", "physicalSpecJson", "physicalSpecBytes", "physicalSpecSha256", "definitionCreatedAtText", "bindingDefinitionId", "bindingLogicalId", "requiredForActivation", "bindingCreatedAtText"];
const rowFields = ["ordinal", "requestedRowId", "rowPresent", "scopeUuid", "tableId", "rowId", "commitSeq", "prevCommitSeq",
  "writeEpochUuid", "schemaVersionId", "creationTime", "valueCodecVersion", "isTombstone", "valueSha256", "valueBytes", "bodyWithheld"];
const indexFields = ["ordinal", "tableIdText", "keyCodecVersionText", "physicalSpecSha256", "encodedKeyBytes",
  "keySha256", "rowIdBytes", "commitSeqText", "isTombstone"];

const rowColumns = [["ordinal","integer"],["requestedRowId","bytea"],["rowPresent","boolean"],["scopeUuid","uuid"],["tableId","integer"],["rowId","bytea"],["commitSeq","text"],["prevCommitSeq","text"],["writeEpochUuid","uuid"],["schemaVersionId","text"],["creationTime","double precision"],["valueCodecVersion","integer"],["isTombstone","boolean"],["valueSha256","bytea"],["valueBytes","bytea"],["bodyWithheld","boolean"]] as const;
const indexColumns = [["ordinal","integer"],["tableIdText","text"],["keyCodecVersionText","text"],["physicalSpecSha256","bytea"],["encodedKeyBytes","bytea"],["keySha256","bytea"],["rowIdBytes","bytea"],["commitSeqText","text"],["isTombstone","boolean"]] as const;
const parameter = (name: string) => sql`${sql.placeholder(name)}`;

/** Separate foreign-control catalog projection has no finite capture header. */
function compileControlResultMapper<T>(fields: readonly CaptureProjectionField[]) {
  const slots = fields.map(({ path, field }, index) => {
    if (path.length !== 1) throw new Error("Invalid control catalog projection");
    return { index, name: path[0]!, decode: captureDriverDecoder(field) };
  });
  // SAFETY: This restores the declared flat Drizzle catalog projection only.
  return (rows: unknown[][]): T => rows.map(row => {
    const result: Record<string, unknown> = {};
    for (const slot of slots) result[slot.name] = slot.decode(row[slot.index]);
    return result;
  }) as T;
}

/** Database-owned pure SQL topology. No query/session, driver, attempt or verdict
 * survives compilation. Installed SQL embeds only the genuine immutable inputs. */
function compileFiniteStorageCapturePlan(database: FlarexMetadataDatabase, locator: ScopePhysicalLocator,
  installed: Result.Result.Success<ReturnType<typeof prepareInstalledFiniteCaptureSource>> | undefined) {
  const namespace = sql.identifier(installed?.schemaName ?? locator.schemaName);
  const compile = (kind: InternalCaptureOperation["kind"]) => {
    const captureSource = sql`(with accepted_capture as materialized (select ${namespace}.fx_accept_finite_storage_capture(
      ${installed?.acceptedScope ?? sql.placeholder("scopeId")},
      row(${sql.placeholder("pin_scopeUuid")} ::uuid,
    ${sql.placeholder("pin_sessionId")} ::uuid,
    ${sql.placeholder("pin_attemptFence")} ::bigint,
    ${sql.placeholder("pin_policyVersion")} ::text,
    ${sql.placeholder("pin_protocolVersion")} ::integer,
    ${sql.placeholder("pin_executionProfile")} ::text,
    ${sql.placeholder("pin_executionAuthorityGeneration")} ::text,
    ${sql.placeholder("pin_functionPath")} ::text,
    ${sql.placeholder("pin_functionKind")} ::text,
    ${sql.placeholder("pin_executionModule")} ::text,
    ${sql.placeholder("pin_packageId")} ::text,
    ${sql.placeholder("pin_artifactRuntime")} ::text,
    ${sql.placeholder("pin_artifactId")} ::text,
    ${sql.placeholder("pin_sourcePackageHash")} ::text,
    ${sql.placeholder("pin_validatedArgsValueCodecVersion")} ::integer,
    ${sql.placeholder("pin_authorizationGrantValueCodecVersion")} ::integer,
    ${sql.placeholder("pin_schemaVersionId")} ::text,
    ${sql.placeholder("pin_storageGeneration")} ::text,
    ${sql.placeholder("pin_storageGenerationFence")} ::bigint,
    ${sql.placeholder("pin_requestKey")} ::text,
    ${sql.placeholder("pin_authorizationRevocationEpoch")} ::bigint,
    ${sql.placeholder("pin_authorizationGrantId")} ::text,
    ${sql.placeholder("pin_authorizationGrantExpiresAt")} ::bigint,
    ${sql.placeholder("pin_hardExpiresAt")} ::bigint,
    ${sql.placeholder("pin_createdAt")} ::bigint,
    ${sql.placeholder("pin_identityAccessPolicySha256")} ::text,
    ${sql.placeholder("pin_requestSha256")} ::text,
    ${sql.placeholder("pin_validatedArgsSha256")} ::text,
    ${sql.placeholder("pin_authorizationGrantSha256")} ::text,
    ${sql.placeholder("pin_applicationExecutionAuthoritySha256")} ::text)::${namespace}.fx_finite_capture_expected,
      ${sql.placeholder("anchorBytes")}::bytea, ${sql.placeholder("anchorDigest")}::bytea,
      ${sql.placeholder("snapshotEpoch")}::uuid, ${sql.placeholder("snapshot")}::bigint, ${sql.placeholder("metadataWatermark")}::bigint,
      ${sql.placeholder("claimOwner")}::uuid, ${sql.placeholder("claimFence")}::bigint,
      ${sql.placeholder("generation")}::text, ${sql.placeholder("generationFence")}::bigint,
      ${sql.placeholder("epoch")}::text, ${sql.placeholder("indexDefinitionId")}::integer, ${sql.placeholder("tableId")}::integer,
      ${sql.placeholder("uniqueDefinitionId")}::integer) as frontier) select (frontier).* from accepted_capture) capture`;
    const authoritySource = installed === undefined ? captureSource : sql`${installed.source} cross join lateral ${captureSource}`;

    const indexStorage = () => buildPreparedAppIndexSnapshotReadStatement(installed?.schemaName ?? locator.schemaName, {
      scopeUuid: parameter("scopeUuid"), indexDefinitionId: parameter("indexDefinitionId"), snapshotCommitSeq: parameter("snapshot"),
      start: parameter("start"), end: parameter("end"), afterKey: parameter("afterKey"), afterRow: parameter("afterRow"), limit: parameter("limit"),
    });
    const indexedRowsStorage = () => buildPreparedAppRowsSnapshotReadStatement(installed?.schemaName ?? locator.schemaName, {
      scopeUuid: parameter("scopeUuid"), tableId: parameter("tableId"), snapshotCommitSeq: parameter("snapshot"),
      transferBudget: parameter("transferBudget"), settlementWindow: sql`false`,
      rowIds: sql`case when (select count(*) from membership) <= coalesce(${parameter("maximumHydratedOwners")}::integer,${parameter("limit")}::integer)
          and not exists(select 1 from membership where "tableIdText" is distinct from ${parameter("tableId")}::text)
          and (select count(distinct "rowIdBytes") from membership where encode("rowIdBytes",'hex') <> all(${parameter("excludeRowIds")}::text[])) <= 256 then
        coalesce((select array_agg(id order by first_ordinal) from (
          select "rowIdBytes" id,min(ordinal) first_ordinal from membership
            where encode("rowIdBytes",'hex') <> all(${parameter("excludeRowIds")}::text[]) group by "rowIdBytes") selected),
          array[]::bytea[]) else array[]::bytea[] end`,
    });
    const storage = kind === "indexRows" ? sql`with membership as materialized (${indexStorage()})
      select 'index'::text as "captureGroup", ${sql.join(indexFields.map(name => sql`i.${sql.identifier(name)} as ${sql.identifier("index_" + name)}`), sql`,`)},
        ${sql.join(rowColumns.map(([name, type]) => sql`null::${sql.raw(type)} as ${sql.identifier("row_" + name)}`), sql`,`)} from membership i
      union all select 'row'::text, ${sql.join(indexColumns.map(([, type]) => sql`null::${sql.raw(type)}`), sql`,`)},
        ${sql.join(rowFields.map(name => sql`r.${sql.identifier(name)}`), sql`,`)} from (${indexedRowsStorage()}) r`
      : kind === "rows" ? buildPreparedAppRowsSnapshotReadStatement(installed?.schemaName ?? locator.schemaName, {
      scopeUuid: parameter("scopeUuid"), tableId: parameter("tableId"),
      rowIds: sql`coalesce((select array_agg(decode(id,'hex') order by ord)
        from unnest(${parameter("rowIds")}::text[]) with ordinality x(id,ord)),array[]::bytea[])`,
      snapshotCommitSeq: parameter("snapshot"), transferBudget: parameter("transferBudget"), settlementWindow: parameter("settlementWindow"),
    }) : kind === "indexPage" ? indexStorage() : kind === "ownership" ? sql`select * from ${namespace}.fx_read_application_write_ownership_snapshot(
      ${parameter("scopeId")}::text,64::integer,1048576::integer)` : kind === "ownershipPolicyManifest" ?
      sql`select * from ${namespace}.fx_read_application_ownership_manifest(${parameter("scopeId")}::text,
        ${parameter("revisionId")}::text,${parameter("remainingRecords")}::integer,${parameter("remainingBytes")}::integer)` :
    kind === "ownershipUniqueClosure" ? sql`select * from ${sql.identifier(installed?.controlSchemaName ?? locator.schemaName)}.fx_read_application_ownership_unique_closure(
      ${parameter("catalogDeploymentId")}::text,${parameter("catalogSchemaVersionId")}::text,
      ${parameter("remainingRecords")}::integer,${parameter("remainingBytes")}::integer)` : sql`select 0 as ordinal`;
    const rawFields = kind === "indexRows" ? ["captureGroup", ...indexFields.map(name => "index_" + name), ...rowFields.map(name => "row_" + name)] :
      kind === "rows" ? rowFields : kind === "indexPage" ? indexFields : kind === "ownership" ? ownershipFields :
      kind === "ownershipPolicyManifest" ? manifestFields : kind === "ownershipUniqueClosure" ? closureFields : ["ordinal"];
    const storageOrder = kind === "indexRows" ? sql`s."captureGroup",s.index_ordinal,s.row_ordinal` :
      kind === "ownership" || kind === "ownershipUniqueClosure" ? sql`s.kind,s.ordinal` :
        kind === "ownershipPolicyManifest" ? sql`1` : sql`s.ordinal`;
    const fields = { reason: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.reason else null end`, databaseNow: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.database_now_epoch_milliseconds else null end`,
      servingCommitSeq: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.serving_commit_seq::text else null end`, tableFrontier: sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.table_frontier::text else null end`,
      historicalChange: sql<boolean>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.historical_change else null end`, retainedFloor: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then (capture.authority_row).oldest_available_commit_seq::text else null end`,
      build: buildFields, uniqueBuild: uniqueFields, indexMaintenance: indexMaintenanceFields, uniqueMaintenance: uniqueMaintenanceFields, frontier: frontierFields,
      targetMetadataEpoch: installed === undefined ? sql<string | null>`(select generation::text from ${namespace}.fx_system_prepared_metadata_epoch where singleton_id=1)` : sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${installed.targetMetadataEpoch} else null end`,
      controlMetadataEpoch: installed === undefined ? sql<string | null>`(select generation::text from ${namespace}.fx_system_prepared_metadata_epoch where singleton_id=1)` : sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${installed.controlMetadataEpoch} else null end`,
      storagePresent: kind === "indexRows" ? sql<boolean>`storage."captureGroup" is not null` :
        kind === "ownershipPolicyManifest" ? sql<boolean>`storage."evidenceLength" is not null` : sql<boolean>`storage.ordinal is not null`,
      raw: Object.fromEntries(rawFields.map(name => [name, sql`storage.${sql.identifier(name)}`])),
      transactionTimestamp: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then current_timestamp::text else null end`,
      exists: kind === "historicalIdentity" ? sql<boolean>`case when capture.reason = 'accepted' and capture.body_eligible then
        (select identity_exists from ${namespace}.fx_read_historical_row_identity((capture.session_row).scope_uuid,
          ${parameter("tableId")}::integer,${parameter("historicalRowId")}::bytea)) else false end` : sql<boolean>`false` };
    const query = database.select(fields).from(sql`${authoritySource}
      left join ${namespace}.${sql.identifier(getTableName(fxSystemIndexMaintenanceObligations))} index_maintenance on
        ${indexMaintenanceTable.scopeId} = (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.scopeId.name)} and
        ${indexMaintenanceTable.indexDefinitionId} = (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.indexDefinitionId.name)} and
        ${indexMaintenanceTable.activationSequence} = (capture.build_row).${sql.identifier(fxSystemIndexBuildStates.maintenanceActivationSequence.name)}
      left join ${namespace}.${sql.identifier(getTableName(fxSystemUniqueMaintenanceObligations))} unique_maintenance on
        ${uniqueMaintenanceTable.scopeId} = (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.scopeId.name)} and
        ${uniqueMaintenanceTable.uniqueConstraintDefinitionId} = (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId.name)} and
        ${uniqueMaintenanceTable.activationSequence} = (capture.unique_row).${sql.identifier(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence.name)}
      left join lateral (select s.*,row_number() over (order by ${storageOrder}) as _capture_header_ordinal from (${storage}) s
        where capture.reason = 'accepted' and capture.body_eligible offset 0) storage on true`).orderBy(sql`storage._capture_header_ordinal`);
    const orderedFields = [
      ...Object.entries({ reason: fields.reason, databaseNow: fields.databaseNow, servingCommitSeq: fields.servingCommitSeq,
        tableFrontier: fields.tableFrontier, historicalChange: fields.historicalChange, retainedFloor: fields.retainedFloor })
        .map(([name, field]) => ({ path: [name], field })),
      ...Object.entries(fields.build).map(([name, field]) => ({ path: ["build", name], field })),
      ...Object.entries(fields.uniqueBuild).map(([name, field]) => ({ path: ["uniqueBuild", name], field })),
      ...Object.entries(fields.indexMaintenance).map(([name, field]) => ({ path: ["indexMaintenance", name], field })),
      ...Object.entries(fields.uniqueMaintenance).map(([name, field]) => ({ path: ["uniqueMaintenance", name], field })),
      ...Object.entries(fields.frontier).map(([name, field]) => ({ path: ["frontier", name], field })),
      { path: ["targetMetadataEpoch"], field: fields.targetMetadataEpoch }, { path: ["controlMetadataEpoch"], field: fields.controlMetadataEpoch },
      { path: ["storagePresent"], field: fields.storagePresent },
      ...Object.entries(fields.raw).map(([name, field]) => ({ path: ["raw", name], field })),
      { path: ["transactionTimestamp"], field: fields.transactionTimestamp }, { path: ["exists"], field: fields.exists },
    ];
    const statement = query.toSQL();
    // PostgreSQL retains parsing on the actual pooled connection. Only fixed
    // SQL names are shared; every execution binds fresh pins and checks state.
    const statementName = `fx_finite_${createHash("sha256").update(statement.sql).digest("hex").slice(0, 40)}`;
    return Object.freeze({ statement: Object.freeze(statement), statementName, orderedFields,
      mapResult: compileFiniteCaptureResultMapper<Omit<typeof query._.result[number], "storagePresent" | "raw">>(orderedFields, { indexRows: kind === "indexRows", historicalIdentity: kind === "historicalIdentity", fullArtifact: installed === undefined }) });
  };
  const shapes = new Map<InternalCaptureOperation["kind"], ReturnType<typeof compile>>();
  for (const kind of ["rows", "indexPage", "indexRows", "ownership", "historicalIdentity", "transactionTime", "retirement",
    "ownershipPolicyManifest", "ownershipUniqueClosure", "ownershipFence"] as const) shapes.set(kind, compile(kind));
  const plan: ReadonlyMap<InternalCaptureOperation["kind"], ReturnType<typeof compile>> = shapes;
  return plan;
}
type RetainedCapturePlan = Readonly<{ locator: ScopePhysicalLocator; shapes: ReturnType<typeof compileFiniteStorageCapturePlan> }>;
// Database identity and genuine installation identity own weak retention. Each
// installation has one locator slot, so changing arbitrary locator strings cannot
// accumulate plans. A new installation never inherits a previous incarnation.
const installedCapturePlans = new WeakMap<FlarexMetadataDatabase,
  WeakMap<PreparedCoLocatedReadInstallation, RetainedCapturePlan>>();
const fullArtifactCapturePlans = new WeakMap<FlarexMetadataDatabase, RetainedCapturePlan>();
const sameCaptureLocator = (a: ScopePhysicalLocator, b: ScopePhysicalLocator) =>
  a.kind === b.kind && a.databaseKey === b.databaseKey && a.schemaName === b.schemaName;

function compileControlCapturePlan(controlDb: FlarexMetadataDatabase) {
  const epochTable = alias(fxSystemPreparedMetadataEpoch, "epoch");
  const epochFields = { databaseName: sql<string>`${epochTable.databaseName}`, namespaceOid: sql<string>`${epochTable.namespaceOid}::text`,
    incarnation: sql<string>`${epochTable.incarnation}::text`, generation: sql<string>`${epochTable.generation}::text`, login: sql<string>`session_user`,
    valid: sql<boolean>`${epochTable.databaseName} = current_database() and ${epochTable.namespaceOid} =
      (select oid::bigint from pg_catalog.pg_namespace where nspname = current_schema()) and current_user = session_user`,
  };
  const epoch = controlDb.select(epochFields).from(epochTable).where(sql`${epochTable.singletonId} = 1`).limit(2);
  const raw = Object.fromEntries(closureFields.map(name => [name, sql`catalog.${sql.identifier(name)}`]));
  const closure = controlDb.select(raw).from(sql`fx_read_application_ownership_unique_closure(
    ${sql.placeholder("deploymentId")}::text,${sql.placeholder("schemaVersionId")}::text,
    ${sql.placeholder("remainingRecords")}::integer,${sql.placeholder("remainingBytes")}::integer) catalog`).orderBy(sql`catalog.kind,catalog.ordinal`);
  const orderedEpoch = Object.entries(epochFields).map(([name, field]) => ({ path: [name], field }));
  const orderedClosure = Object.entries(raw).map(([name, field]) => ({ path: [name], field }));
  return Object.freeze({ epochStatement: Object.freeze(epoch.toSQL()), epochFields: orderedEpoch,
    closureStatement: Object.freeze(closure.toSQL()), closureFields: orderedClosure,
    mapEpochResult: compileControlResultMapper<typeof epoch._.result>(orderedEpoch),
    mapClosureResult: compileControlResultMapper<typeof closure._.result>(orderedClosure) });
}

// Full-artifact control compilation also retains no transaction or live epoch.
const controlCapturePlans = new WeakMap<FlarexMetadataDatabase, ReturnType<typeof compileControlCapturePlan>>();

/** Fresh binding authenticates its original preparation before pure-plan reuse.
 * Every run still binds current entry/claim/demand and accepts current live SQL. */
export function bindFiniteStorageCaptureOwner(database: FlarexMetadataDatabase, locator: ScopePhysicalLocator,
  profile: FiniteStorageCaptureProfile) {
  // Stable untraced operations preserve cancellation and full Cause. The SDK
  // alone opts into named diagnostic observation at their existing boundaries.
  return Result.gen(function* () {
    const installed = profile.kind === "installed" ? yield* prepareInstalledFiniteCaptureSource(profile.installation, database, locator) : undefined;
    const slots = profile.kind === "installed" ? installedCapturePlans.get(database) ??
      new WeakMap<PreparedCoLocatedReadInstallation, RetainedCapturePlan>() : undefined;
    const retainedPlan = profile.kind === "installed" ? slots?.get(profile.installation) : fullArtifactCapturePlans.get(database);
    const shapes = retainedPlan !== undefined && sameCaptureLocator(retainedPlan.locator, locator) ? retainedPlan.shapes :
      compileFiniteStorageCapturePlan(database, locator, installed);
    if (shapes !== retainedPlan?.shapes) {
      const plan = Object.freeze({ locator: Object.freeze({ ...locator }), shapes });
      if (profile.kind === "installed" && slots !== undefined) {
        slots.set(profile.installation, plan);
        installedCapturePlans.set(database, slots);
      } else fullArtifactCapturePlans.set(database, plan);
    }
    const deadlines = makePhysicalDeadlineOperations({ deadline: fields => refused("resourceFailure", fields),
      invariant: fields => refused("invalidInput", fields) });
    const captureControl = Effect.fnUntraced(function* (controlDb: FlarexMetadataDatabase,
      operation?: Extract<InternalCaptureOperation, { kind: "ownershipUniqueClosure" }>, expectedEpoch?: ControlEpoch): Effect.fn.Return<ControlCapture, FiniteStorageCaptureError> {
      let shape = controlCapturePlans.get(controlDb);
      if (shape === undefined) { shape = compileControlCapturePlan(controlDb); controlCapturePlans.set(controlDb, shape); }
      const prepared = shape;
      return yield* runEffectTransaction<ControlCapture, FiniteStorageCaptureError, FiniteStorageCaptureError, FlarexMetadataTransaction>(work => controlDb.transaction(work), "Finite ownership control capture failed", tx => Effect.gen(function* () {
        const readEpoch = () => Effect.tryPromise({ try: () => tx._.session.prepareQuery<import("drizzle-orm/pg-core").PreparedQueryConfig & {
          execute: ReturnType<typeof prepared.mapEpochResult>;
        }>(prepared.epochStatement, prepared.epochFields, undefined, true, prepared.mapEpochResult).execute(),
          catch: cause => refused("resourceFailure", cause) }).pipe(Effect.flatMap(rows => decodeControlEpoch(rows)),
          Effect.mapError(cause => cause instanceof FiniteStorageCaptureError ? cause : refused("storedCorruption", cause)));
        const [before] = yield* readEpoch();
        if (expectedEpoch !== undefined && !sameControlEpoch(before, expectedEpoch))
          return yield* Effect.fail(refused("invalidAuthority"));
        if (operation === undefined) return Object.freeze({ rawRows: Object.freeze([]), epoch: before });
        const rawRows = yield* Effect.tryPromise({ try: () => tx._.session.prepareQuery<import("drizzle-orm/pg-core").PreparedQueryConfig & {
          execute: ReturnType<typeof prepared.mapClosureResult>;
        }>(prepared.closureStatement, prepared.closureFields, undefined, true, prepared.mapClosureResult).execute({ deploymentId: operation.deploymentId, schemaVersionId: operation.schemaVersionId,
          remainingRecords: operation.remaining.records, remainingBytes: operation.remaining.bytes }), catch: cause => refused("resourceFailure", cause) });
        const [after] = yield* readEpoch();
        if (!sameControlEpoch(before, after)) return yield* Effect.fail(refused("invalidAuthority"));
        return Object.freeze({ rawRows: Object.freeze(rawRows), epoch: before });
      }), cause => refused("resourceFailure", cause));
    }, effect => observeExecution("FiniteStorageCapture.fullArtifactControlCatalog", effect));
    const run = Effect.fnUntraced(function* (input: ExactRunningAttemptKernelInputV1,
      operation: InternalCaptureOperation, metadataEpoch?: Readonly<{ target: string | null; control: string | null }>) {
      if (input.finiteAnchor === undefined || input.selector.scopeId !== input.preliminaryAuthority.scopeId ||
        input.selector.deploymentId !== input.preliminaryAuthority.deploymentId)
        return yield* Effect.fail(refused("invalidInput"));
      const attemptBasis = yield* Effect.fromResult(prepareFiniteAttemptStorageCaptureBasis(input.finiteAnchor)).pipe(
        Effect.mapError(cause => refused("invalidInput", cause)));
      const expected = attemptBasis.expected;
      if (input.selector.scopeId !== expected.snapshotToken.scopeId || input.selector.sessionId !== expected.pins.sessionId ||
        input.selector.attemptFence !== expected.pins.attemptFence) return yield* Effect.fail(refused("invalidInput"));
      if (profile.kind === "installed") yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(profile.installation, database))
        .pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
      const participant = input.finiteReadDemand === undefined ? undefined :
        yield* Effect.fromResult(inspectFiniteParticipantStorageDemand(input.finiteReadDemand)).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
      const application = input.finiteApplicationReadDemand === undefined ? undefined :
        yield* Effect.fromResult(inspectFiniteApplicationStorageDemand(input.finiteApplicationReadDemand)).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
      if (participant !== undefined && application !== undefined) return yield* Effect.fail(refused("invalidAuthority"));
      const selected = participant ?? application;
      if (selected !== undefined && (selected.root.scopeId !== input.selector.scopeId || selected.root.sessionId !== input.selector.sessionId ||
        selected.root.attemptFence !== input.selector.attemptFence || selected.root.snapshotCommitSeq !== expected.snapshotToken.commitSeq))
        return yield* Effect.fail(refused("invalidAuthority"));
      const metadata = participant === undefined ? input.finiteApplicationReadDemand?.metadata : participant.metadata;
      const root = participant === undefined ? input.finiteApplicationReadDemand?.root : input.finiteReadDemand?.attempt;
      const retained = operation.kind === "retirement" || metadata === undefined || root === undefined ? undefined :
        yield* readFiniteStorageCaptureMetadata(metadata, root).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
      if (profile.kind === "fullArtifact") {
        const originalPorts = retained?.authorityPorts ?? (metadata === undefined || root === undefined ? undefined :
          yield* Effect.fromResult(readFiniteStorageCaptureRetirementAuthority(metadata, root)).pipe(
            Effect.mapError(cause => refused("invalidAuthority", cause))));
        if (originalPorts === undefined && profile.authority === undefined) return yield* Effect.fail(refused("invalidAuthority"));
        let located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>;
        if (originalPorts !== undefined) located = yield* resolveLocatedTrustedScopeAuthorityEffect(input.selector.deploymentId, originalPorts)
          .pipe(Effect.mapError(scopeFailure));
        else if (profile.authority !== undefined) located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(input.selector, profile.authority)
          .pipe(Effect.mapError(scopeFailure));
        else return yield* Effect.fail(refused("invalidAuthority"));
        if (located.authority.scopeId !== input.selector.scopeId || !hasLocatedReadCommittedTargetDatabaseV1(located.target, database) ||
          located.authority.physicalLocator.kind !== locator.kind || located.authority.physicalLocator.databaseKey !== locator.databaseKey ||
          located.authority.physicalLocator.schemaName !== locator.schemaName)
          return yield* Effect.fail(refused("invalidAuthority"));
      }
      if ((operation.kind === "rows" || operation.kind === "indexRows") && operation.maximumTotalValueBytes !== undefined &&
        (!Number.isSafeInteger(operation.maximumTotalValueBytes) || operation.maximumTotalValueBytes < 0 || operation.maximumTotalValueBytes > 1_048_576) ||
        operation.kind === "historicalIdentity" && operation.rowId.byteLength !== 16 ||
        operation.kind === "indexRows" && operation.maximumHydratedOwners !== undefined && operation.maximumHydratedOwners !== 1)
        return yield* Effect.fail(refused("invalidInput"));
      if (operation.kind === "retirement" && (operation.selector.scopeId !== input.selector.scopeId ||
        operation.selector.sessionId !== input.selector.sessionId || operation.selector.attemptFence !== input.selector.attemptFence ||
        operation.selector.deploymentId !== input.selector.deploymentId || operation.executionClaim.claimFence !== input.executionClaim.claimFence ||
        operation.executionClaim.claimOwner !== input.executionClaim.claimOwner)) return yield* Effect.fail(refused("invalidAuthority"));
      const rows = operation.kind === "rows" ? yield* prepareAppRowsSnapshotReadEffect(operation.input)
        .pipe(Effect.mapError(cause => refused("invalidInput", cause))) : undefined;
      const index = operation.kind === "indexPage" || operation.kind === "indexRows" ? yield* prepareAppIndexSnapshotReadEffect(operation.input)
        .pipe(Effect.mapError(cause => refused("invalidInput", cause))) : undefined;
      const excludedRows = operation.kind === "indexRows" ? yield* prepareAppRowsSnapshotReadEffect({
        scopeId: input.selector.scopeId, tableId: operation.tableId, snapshotCommitSeq: expected.snapshotToken.commitSeq,
        rowIds: operation.excludeRowIds ?? [],
      }).pipe(Effect.mapError(cause => refused("invalidInput", cause))) : undefined;
      const tableId = rows?.tableId ?? (operation.kind === "indexPage" || operation.kind === "indexRows" || operation.kind === "ownership" ||
        operation.kind === "historicalIdentity" ? operation.tableId : selected?.demand.kind !== "clock" ? selected?.demand.tableId ?? null : null);
      const snapshot = rows?.snapshotCommitSeq ?? index?.snapshotCommitSeq ?? expected.snapshotToken.commitSeq;
      if (snapshot !== expected.snapshotToken.commitSeq || rows !== undefined && rows.scopeId !== input.selector.scopeId ||
        index !== undefined && index.scopeId !== input.selector.scopeId ||
        selected !== undefined && selected.demand.kind !== "clock" && tableId !== selected.demand.tableId)
        return yield* Effect.fail(refused("invalidAuthority"));
      const selectsBusiness = operation.kind === "rows" || operation.kind === "indexPage" || operation.kind === "indexRows" ||
        operation.kind === "ownership" || operation.kind === "historicalIdentity";
      if (selectsBusiness && (selected === undefined || selected.demand.kind === "clock"))
        return yield* Effect.fail(refused("invalidAuthority"));
      if (index !== undefined && (selected?.definition === undefined ||
        selected.definition.indexDefinitionId !== index.indexDefinitionId ||
        !bytesEqualFullScan(appIndexPhysicalSpecSha256HexV1ToBytes(selected.definition.physicalSpecSha256Hex), index.physicalSpecSha256)))
        return yield* Effect.fail(refused("invalidAuthority"));
      const selectedIndexId = selected?.definition?.indexDefinitionId ?? null;
      const unique = participant?.uniqueDefinition;
      const shape = shapes.get(operation.kind);
      if (shape === undefined) return yield* Effect.die("Named finite capture shape missing");
      const placeholders = Object.setPrototypeOf({
        deploymentId: input.selector.deploymentId, scopeId: input.selector.scopeId,
        snapshot, claimOwner: input.executionClaim.claimOwner,
        claimFence: input.executionClaim.claimFence, generation: input.preliminaryAuthority.storageGeneration,
        generationFence: input.preliminaryAuthority.storageGenerationFence, epoch: input.preliminaryAuthority.epoch,
        indexDefinitionId: selectedIndexId, tableId, uniqueDefinitionId: unique?.uniqueConstraintDefinitionId ?? null,
        rowIds: rows?.rowIds ?? [],
        settlementWindow: operation.kind === "rows" && operation.settlementWindow === true,
        excludeRowIds: excludedRows?.rowIds ?? [],
        maximumHydratedOwners: operation.kind === "indexRows" ? operation.maximumHydratedOwners ?? null : null,
        transferBudget: operation.kind === "rows" || operation.kind === "indexRows" ? operation.maximumTotalValueBytes ?? 1_048_576 : 1_048_576,
        start: index?.bounds.startInclusive ?? null, end: index?.bounds.endExclusive ?? null,
        afterKey: index?.after?.keyBytes ?? null, afterRow: index?.after?.rowIdBytes ?? null, limit: index?.limit ?? 1,
        historicalRowId: operation.kind === "historicalIdentity" ? operation.rowId : null,
        revisionId: operation.kind === "ownershipPolicyManifest" ? operation.revisionId : null,
        catalogDeploymentId: operation.kind === "ownershipUniqueClosure" ? operation.deploymentId : null,
        catalogSchemaVersionId: operation.kind === "ownershipUniqueClosure" ? operation.schemaVersionId : null,
        remainingRecords: operation.kind === "ownershipPolicyManifest" || operation.kind === "ownershipUniqueClosure" ? operation.remaining.records : 64,
        remainingBytes: operation.kind === "ownershipPolicyManifest" || operation.kind === "ownershipUniqueClosure" ? operation.remaining.bytes : 1_048_576,
      }, attemptBasis.parameters);
      const execute = (db: FlarexMetadataDatabase) => Effect.tryPromise({ try: () =>
        db._.session.prepareQuery<import("drizzle-orm/pg-core").PreparedQueryConfig & { execute: ReturnType<typeof shape.mapResult> }>(
          shape.statement, shape.orderedFields, shape.statementName, true, shape.mapResult).execute(placeholders), catch: cause => refused("resourceFailure", cause) });
      const result = profile.kind === "installed" ? yield* profile.driver.runImplicitReadEffect(
        { deadline: yield* deadlines.start("read", 30_000) }, execute) :
        yield* runEffectTransaction(work => database.transaction(work), "Finite named capture failed", execute,
          cause => refused("resourceFailure", cause));
      const first = result.header;
      if (first === undefined) return yield* Effect.fail(refused("invalidAuthority"));
      const reason = yield* decodeReason(first.reason).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
      if (reason === "attemptReplaced") yield* readFiniteAttemptAnchorRow(first.frontier).pipe(
        Effect.mapError(cause => refused(cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause)));
      if (operation.kind === "retirement") {
        if (["attemptMissing", "attemptReplaced", "ownershipChanged", "lifecycleChanged", "expired"].includes(reason))
          return Object.freeze({ kind: "retirement" as const, retired: true });
      }
      if (reason !== "accepted") return yield* Effect.fail(refused(reason));
      const timeText = yield* decodeTime(first.databaseNow).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
      const timestamp = Number(timeText);
      if (!Number.isSafeInteger(timestamp)) return yield* Effect.fail(refused("storedCorruption"));
      const serving = yield* decodeSequenceText(first.servingCommitSeq).pipe(
        Effect.mapError(cause => refused("storedCorruption", cause)));
      const retainedFloor = yield* decodeSequenceText(first.retainedFloor).pipe(
        Effect.mapError(cause => refused("storedCorruption", cause)));
      if (serving < expected.snapshotToken.commitSeq || retainedFloor > serving)
        return yield* Effect.fail(refused("storedCorruption"));
      if (selected !== undefined && operation.kind !== "retirement") {
        if (retained === undefined) return yield* Effect.fail(refused("invalidAuthority"));
        yield* acceptDemandBuildEvidence(input, selected?.definition, tableId, unique, retained.basis, first, expected);
      }
      const observedEpoch = Object.freeze({ target: first.targetMetadataEpoch, control: first.controlMetadataEpoch });
      if (metadataEpoch !== undefined && (observedEpoch.target !== metadataEpoch.target || observedEpoch.control !== metadataEpoch.control))
        return yield* Effect.fail(refused("invalidAuthority"));
      if (result.layoutFailure !== undefined) return yield* Effect.fail(refused("storedCorruption", result.layoutFailure));
      const rawRows = result.rawRows;
      switch (operation.kind) {
        case "rows": {
          if (rows === undefined) return yield* Effect.die("Prepared rows missing");
          return Object.freeze({ kind: "rows" as const, prepared: rows, rawRows });
        }
        case "indexPage": {
          if (index === undefined) return yield* Effect.die("Prepared index missing");
          return Object.freeze({ kind: "indexPage" as const, prepared: index, rawRows });
        }
        case "indexRows": {
          if (index === undefined) return yield* Effect.die("Prepared index missing");
          return Object.freeze({ kind: "indexRows" as const, prepared: index, rawIndexRows: result.rawIndexRows, rawRows });
        }
        case "transactionTime": return Object.freeze({ kind: "transactionTime" as const, timestamp: first.transactionTimestamp });
        case "historicalIdentity": return Object.freeze({ kind: "historicalIdentity" as const, exists: first.exists });
        case "ownership": return Object.freeze({ kind: "ownership" as const, rawRows, metadataEpoch: observedEpoch });
        case "ownershipPolicyManifest": case "ownershipUniqueClosure": case "ownershipFence":
          return Object.freeze({ kind: operation.kind, rawRows, metadataEpoch: observedEpoch });
        case "retirement": return Object.freeze({ kind: "retirement" as const, retired: false });
      }
    }, effect => observeExecution("FiniteStorageCapture.run", effect));
    type CaptureValue = Effect.Success<ReturnType<typeof run>>;
    const runOwnership = Effect.fnUntraced(function* (input: ExactRunningAttemptKernelInputV1,
      operation: Extract<FiniteStorageCaptureOperation, { kind: "ownership" }>) {
      const value = yield* run(input, operation);
      if (value.kind !== "ownership") return yield* Effect.die("Ownership capture kind changed");
      const mapOwnershipFailure = (cause: ApplicationWriteOwnershipError) => refused(
        cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause);
      let demandedSuccessor = false;
      let controlEpoch: ControlEpoch | undefined;
      let controlDb: FlarexMetadataDatabase | undefined;
      if (profile.kind === "fullArtifact") {
        const selected = input.finiteReadDemand === undefined ? undefined : yield* Effect.fromResult(
          inspectFiniteParticipantStorageDemand(input.finiteReadDemand)).pipe(Effect.mapError(cause => refused("invalidAuthority", cause)));
        const metadata = selected?.metadata ?? input.finiteApplicationReadDemand?.metadata;
        const root = input.finiteReadDemand?.attempt ?? input.finiteApplicationReadDemand?.root;
        if (metadata === undefined || root === undefined) return yield* Effect.fail(refused("invalidAuthority"));
        controlDb = (yield* readFiniteStorageCaptureMetadata(metadata, root).pipe(
          Effect.mapError(cause => refused("invalidAuthority", cause)))).controlDb;
      }
      const snapshot = yield* decodeCapturedApplicationWriteOwnershipEffect(input.selector.scopeId, value.rawRows,
        new ApplicationWriteOwnershipHistoryBudget(), undefined, { kind: "capture",
          capturePolicyManifest: (scopeId, revisionId, remaining) => {
            demandedSuccessor = true;
            return scopeId !== input.selector.scopeId ?
            Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" })) :
            run(input, { kind: "ownershipPolicyManifest", revisionId, remaining }, value.metadataEpoch).pipe(
              Effect.flatMap(result => "rawRows" in result ? Effect.succeed(result.rawRows) : Effect.die("Manifest capture shape changed")),
              Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidEvidence", cause })));
          },
          captureUniqueClosure: (deploymentId, schemaVersionId, remaining) => {
            demandedSuccessor = true;
            const actualControl = controlDb;
            return deploymentId !== input.selector.deploymentId ?
            Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" })) :
            (profile.kind === "fullArtifact" ? (actualControl === undefined ? Effect.fail(refused("invalidAuthority")) :
              run(input, { kind: "ownershipFence" }, value.metadataEpoch).pipe(Effect.andThen(() =>
                captureControl(actualControl, { kind: "ownershipUniqueClosure", deploymentId, schemaVersionId, remaining }, controlEpoch)),
                Effect.map(result => { controlEpoch = result.epoch; return result.rawRows; }))) :
              run(input, { kind: "ownershipUniqueClosure", deploymentId, schemaVersionId, remaining }, value.metadataEpoch).pipe(
                Effect.flatMap(result => "rawRows" in result ? Effect.succeed(result.rawRows) : Effect.die("Catalog capture shape changed"))))
              .pipe(Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: cause.reason === "resourceFailure" ? "resourceFailure" : "invalidEvidence", cause })));
          },
        }).pipe(Effect.mapError(mapOwnershipFailure));
      if (controlEpoch !== undefined && controlDb !== undefined) yield* captureControl(controlDb, undefined, controlEpoch);
      if (demandedSuccessor) yield* run(input, { kind: "ownershipFence" }, value.metadataEpoch);
      const verdict = denyManagedApplicationTableWrites([operation.tableId], snapshot.ownership?.frame.claims ?? []);
      if (Result.isFailure(verdict) && verdict.failure.reason !== "writeDenied")
        return yield* Effect.fail(mapOwnershipFailure(verdict.failure));
      return Object.freeze({ kind: "ownership" as const, denied: Result.isFailure(verdict) });
    }, effect => observeExecution("FiniteStorageCapture.acceptOwnership", effect));
    const capture: FiniteStorageCaptureTarget[typeof CAPTURE_FINITE_STORAGE] = (input, operation) =>
      // Inspect the operation only when evaluated. Non-ownership captures keep
      // one named capture boundary rather than an ownership orchestration span.
      Effect.suspend((): Effect.Effect<CaptureValue | Effect.Success<ReturnType<typeof runOwnership>>, FiniteStorageCaptureError> => {
        const selected: FiniteStorageCaptureOperation = operation;
        return selected.kind === "ownership" ? runOwnership(input, selected) : run(input, selected);
      }).pipe(Effect.map(value => {
        // SAFETY: run's exhaustive named operation switch returns exactly the same discriminant.
        return value as FiniteStorageCaptureEnvelopes[typeof operation.kind];
      }));
    return Object.freeze({ capture });
  });
}

export class FiniteStorageCaptureError extends Data.TaggedError("FiniteStorageCaptureError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "resourceFailure" | "storedCorruption" | "attemptMissing" |
    "attemptReplaced" | "ownershipChanged" | "lifecycleChanged" | "expired" | "unsupportedStorageGeneration" |
    "storageGenerationFenceChanged" | "scopeEpochChanged" | "authorizationRevocationEpochChanged" | "notReady";
  readonly cause?: unknown;
}> {}

type CaptureMetadataBasis = Effect.Success<ReturnType<typeof readFiniteStorageCaptureMetadata>>["basis"];
const decodeSequenceText = Schema.decodeUnknownEffect(CommitSeqSchema);
const acceptDemandBuildEvidence = Effect.fnUntraced(function* (
  input: ExactRunningAttemptKernelInputV1,
  definition: Readonly<{ indexDefinitionId: CatalogIndexDefinitionId; physicalSpecSha256Hex: string }> | undefined,
  tableId: CatalogTableId | null, unique: LocatedAppUniqueConstraintDefinitionV1 | undefined,
  basis: CaptureMetadataBasis, header: Readonly<{ servingCommitSeq: string; tableFrontier: string | null; historicalChange: boolean;
    retainedFloor: string; build: typeof fxSystemIndexBuildStates.$inferSelect; uniqueBuild: typeof fxSystemUniqueConstraintBuilds.$inferSelect;
    indexMaintenance: typeof fxSystemIndexMaintenanceObligations.$inferSelect;
    uniqueMaintenance: typeof fxSystemUniqueMaintenanceObligations.$inferSelect }>, expected: ExpectedAnchor,
) {
  const serving = yield* decodeSequenceText(header.servingCommitSeq).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
  const snapshot = expected.snapshotToken.commitSeq;
  const authority = input.preliminaryAuthority;
  const retainedFloor = yield* decodeSequenceText(header.retainedFloor).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
  if (serving < snapshot) return yield* Effect.fail(refused("storedCorruption"));
  const tableFrontier = header.tableFrontier === null ? null :
    yield* decodeSequenceText(header.tableFrontier).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
  if (tableFrontier !== null && tableFrontier < 1n) return yield* Effect.fail(refused("storedCorruption"));
  if (definition !== undefined) {
    if (header.build.scopeId === null) return yield* Effect.fail(refused("notReady"));
    const state = yield* Effect.fromResult(decodeIndexBuildStateRowResult(header.build, input.selector.scopeId, definition.indexDefinitionId, header.indexMaintenance.scopeId === null ? null : header.indexMaintenance))
      .pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
    yield* Effect.fromResult(validateIndexBuildStateFrontierResult(state, serving)).pipe(
      Effect.mapError(cause => refused("storedCorruption", cause)));
    if (state.storageGeneration !== authority.storageGeneration || state.storageGenerationFence !== authority.storageGenerationFence ||
      state.epoch !== authority.epoch) return yield* Effect.fail(refused("storedCorruption"));
    if (state.lifecycle !== "enabled" || state.firstReadableCommitSeq === null || state.firstReadableCommitSeq > snapshot ||
      state.coveredThroughCommitSeq === null) return yield* Effect.fail(refused("notReady"));
    const covered = state.coveredThroughCommitSeq;
    if (state.maintenance !== null) {
      const obligation = state.maintenance;
      if (obligation.tableId !== tableId || encodeBytesToLowercaseHex(obligation.physicalSpecSha256) !== definition.physicalSpecSha256Hex)
        return yield* Effect.fail(refused("storedCorruption"));
      if (covered >= snapshot) return;
      if (obligation.deploymentId === basis.deploymentId && obligation.schemaVersionId === basis.schemaVersionId &&
        encodeBytesToLowercaseHex(obligation.schemaManifestSha256) === basis.manifestSha256 && obligation.activationSequence.toString() === basis.activationSequence &&
        encodeBytesToLowercaseHex(obligation.headSha256) === basis.headSha256 &&
        encodeBytesToLowercaseHex(obligation.activationSha256) === basis.activationSha256) return;
    } else if (covered >= snapshot) return;
    if (tableFrontier === null || tableFrontier <= covered) return;
    if (covered < retainedFloor || header.historicalChange)
      return yield* Effect.fail(refused("notReady"));
  }
  if (unique !== undefined) {
    if (header.uniqueBuild.scopeId === null) return yield* Effect.fail(refused("notReady"));
    const state = yield* decodeFiniteUniqueBuildStateEffect(authority, { schemaVersionId: basis.schemaVersionId,
      members: [{ logicalUniqueConstraintId: unique.logicalUniqueConstraintId,
        uniqueConstraintDefinitionId: unique.uniqueConstraintDefinitionId, tableId: unique.tableId,
        physicalSpecSha256Hex: unique.physicalSpecSha256Hex }] }, { ...header.uniqueBuild,
        maintenanceObligation: header.uniqueMaintenance.scopeId === null ? null : header.uniqueMaintenance }, serving)
      .pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
    if (state.storageGeneration !== authority.storageGeneration || state.storageGenerationFence !== authority.storageGenerationFence ||
      state.epoch !== authority.epoch || state.lifecycle !== "enabled" || state.startCommitSeq > snapshot ||
      state.coveredThroughCommitSeq === null) return yield* Effect.fail(refused("notReady"));
    const covered = state.coveredThroughCommitSeq;
    if (state.maintenance !== null) {
      const obligation = state.maintenance;
      if (obligation.tableId !== tableId || encodeBytesToLowercaseHex(obligation.physicalSpecSha256) !== unique.physicalSpecSha256Hex)
        return yield* Effect.fail(refused("storedCorruption"));
      if (covered >= snapshot) return;
      if (obligation.deploymentId === basis.deploymentId && obligation.schemaVersionId === basis.schemaVersionId &&
        obligation.activationSequence.toString() === basis.activationSequence && encodeBytesToLowercaseHex(obligation.headSha256) === basis.headSha256 &&
        encodeBytesToLowercaseHex(obligation.activationSha256) === basis.activationSha256) return;
    } else if (covered >= snapshot) return;
    if (tableFrontier === null || tableFrontier <= covered) return;
    if (covered < retainedFloor || header.historicalChange)
      return yield* Effect.fail(refused("notReady"));
  }
}, effect => observeExecution("FiniteStorageCapture.acceptDemandBuild", effect));

export const CAPTURE_FINITE_STORAGE: unique symbol = Symbol("FlarexDB/captureFiniteStorage");
export interface FiniteStorageCaptureTarget extends LocatedScopeClockReader {
  readonly [CAPTURE_FINITE_STORAGE]: <K extends FiniteStorageCaptureOperation["kind"]>(
    input: ExactRunningAttemptKernelInputV1, operation: Extract<FiniteStorageCaptureOperation, { kind: K }>,
  ) => Effect.Effect<FiniteStorageCaptureEnvelopes[K], FiniteStorageCaptureError>;
}
export function captureFiniteStorageEffect<K extends FiniteStorageCaptureOperation["kind"]>(
  target: LocatedScopeClockReader, input: ExactRunningAttemptKernelInputV1,
  operation: Extract<FiniteStorageCaptureOperation, { kind: K }>,
): Effect.Effect<FiniteStorageCaptureEnvelopes[K], FiniteStorageCaptureError> {
  const capture = Reflect.get(target, CAPTURE_FINITE_STORAGE);
  if (typeof capture !== "function") return Effect.fail(new FiniteStorageCaptureError({ reason: "invalidAuthority" }));
  // SAFETY: the located target's private symbol method is issued by its construction owner.
  return (capture as FiniteStorageCaptureTarget[typeof CAPTURE_FINITE_STORAGE])(input, operation);
}
