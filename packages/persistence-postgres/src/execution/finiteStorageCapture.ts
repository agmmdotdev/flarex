import { observeExecution } from "./diagnostics/operation";
import { createHash } from "node:crypto";
import { captureDriverDecoder, compileFiniteCaptureResultMapper, type CaptureProjectionField } from "./finiteStorageCaptureProjection";
import { Cause, Data, Effect, Result, Schema } from "effect";
import { sql, type SQL } from "drizzle-orm";
import { buildPostgresRelationalPredicateBody, decodePostgresRelationalMatches, inspectPostgresRelationalBatch, type PostgresRelationalPredicateBatch } from "../storage/documents/logicalDocuments/postgresRelationalPredicate";
import { alias } from "drizzle-orm/pg-core";
import { inspectLogicalRelationalRealBatch, executeLogicalRelationalRealBatch, type LogicalRelationalRealBatch } from "../storage/documents/logicalDocuments/relationalRows";
import type { JsonObject } from "flarex-protocol/json";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";

import type { FlarexMetadataDatabase } from "../application/deployments";
import type { FlarexMetadataTransaction } from "../database/metadataTransaction";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import { prepareFiniteAttemptStorageCaptureBasis, readCapturedFiniteAttemptAnchorRow } from "./finiteAttemptAnchor";
import { prepareInstalledFiniteCaptureSource } from "../scope/scopeAuthorityControlRead";
import { acquireCoLocatedInstallationAdmission, closeInstallationAdmission, getCoLocatedReadInstallationReferencesResult,
  lockInstallationForCurrentTransaction, type InstallationLifecycleError, type PreparedCoLocatedReadInstallation } from "../installation/installationLifecycle";
import { runEffectTransaction, runEffectTransactionSettlement } from "../database/effectTransaction";

import { prepareAppRowsSnapshotReadResult, buildPreparedAppRowsSnapshotReadStatement } from "../storage/documents/appRows";
import { prepareAppIndexSnapshotReadResult, buildPreparedAppIndexSnapshotReadStatement } from "../storage/indexes/appIndexEntries";
import { inspectFiniteParticipantStorageDemand } from "../storage/documents/logicalDocuments/participantAdmission";
import { matchesLogicalRelationalAttemptTable } from "../storage/documents/logicalDocuments/relationalAdmission";
import { inspectFiniteApplicationStorageDemand, readFiniteStorageCaptureMetadata, readFiniteStorageCaptureRetirementAuthority } from "../storage/documents/logicalDocuments/sourceAdmission";
import { fxSystemTransactionSessions, fxSystemPreparedMetadataEpoch } from "../database/schema";
import { makePhysicalDeadlineOperations } from "../database/physicalSession/deadline";
import { executeNativePhysicalCommand } from "../database/physicalSession/drizzle";
import type { PostgresPhysicalSessionDriver } from "../database/physicalSession/postgres";
import { physicalSessionErrors } from "../database/physicalSession/errors";
import { relationalLimits } from "./preparation/frameworkExecutionPolicy";
import type { CatalogTableId } from "flarex-protocol/catalog";
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


export type FiniteStorageCaptureOperation =
  | Readonly<{ kind: "rows"; input: ReadAppRowsAtSnapshotV1Input; maximumTotalValueBytes?: number; settlementWindow?: true }>
  | Readonly<{ kind: "indexPage"; input: ScanAppIndexAtSnapshotV1Input; tableId: CatalogTableId }>
  | Readonly<{ kind: "relationalPredicate"; tableId: CatalogTableId; batch: PostgresRelationalPredicateBatch }>
  | Readonly<{ kind: "relationalReal"; tableId: CatalogTableId; batch: LogicalRelationalRealBatch }>
  | Readonly<{ kind: "ownership"; tableId: CatalogTableId }>
  | Readonly<{ kind: "historicalIdentity"; tableId: CatalogTableId; rowId: Uint8Array }>
  | Readonly<{ kind: "transactionTime" }>
  | Readonly<{ kind: "retirement"; selector: PointMutationSessionAttemptSelectorV1; executionClaim: TransactionExecutionClaimPinV1 }>;

export interface FiniteStorageCaptureEnvelopes {
  readonly relationalReal: Readonly<{ kind: "relationalReal"; rows: readonly JsonObject[]; bytes: number }>;
  readonly relationalPredicate: Readonly<{ kind: "relationalPredicate"; rawRows: readonly unknown[];
    matches: readonly (boolean | null)[]; bytes: number }>;
  readonly rows: Readonly<{ kind: "rows"; prepared: PreparedAppRowsSnapshotRead; rawRows: readonly unknown[] }>;
  readonly indexPage: Readonly<{ kind: "indexPage"; prepared: PreparedAppIndexSnapshotRead; rawRows: readonly unknown[] }>;
  readonly ownership: Readonly<{ kind: "ownership"; denied: boolean;
    commandPolicy?: import("../application/ownership/Command").ApplicationCommandPolicy }>;
  readonly historicalIdentity: Readonly<{ kind: "historicalIdentity"; exists: boolean }>;
  readonly transactionTime: Readonly<{ kind: "transactionTime"; timestamp: string }>;
  readonly retirement: Readonly<{ kind: "retirement"; retired: boolean }>;
}

const refused = (reason: FiniteStorageCaptureError["reason"], cause?: unknown) =>
  new FiniteStorageCaptureError({ reason, ...(cause === undefined ? {} : { cause }) });
const installationFailure = (cause: InstallationLifecycleError) => refused(
  cause.reason === "resourceFailure" || cause.reason === "busy" ? "resourceFailure" : "invalidAuthority", cause);
const scopeFailure = (cause: TrustedScopeAuthorityError) => cause instanceof TrustedScopeAuthorityPortError ? refused(
  cause.cause instanceof ScopeClockCorruptionError ? "storedCorruption" : "resourceFailure", cause) : refused("invalidAuthority", cause);
const HeaderReasonSchema = Schema.Literals(["accepted", "invalidAuthority", "resourceFailure", "storedCorruption", "attemptMissing",
  "attemptReplaced", "ownershipChanged", "lifecycleChanged", "expired", "unsupportedStorageGeneration",
  "storageGenerationFenceChanged", "scopeEpochChanged", "authorizationRevocationEpochChanged", "notReady"]);
const decodeReason = Schema.decodeUnknownEffect(HeaderReasonSchema);
const decodeSequenceText = Schema.decodeUnknownEffect(CommitSeqSchema);
const decodeTransactionTimestamp = Schema.decodeUnknownEffect(Schema.String);

const decodeTime = Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^[0-9]+$/)));
const ControlEpochSchema = Schema.Struct({ databaseName: Schema.NonEmptyString, namespaceOid: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  incarnation: Schema.String.check(Schema.isUUID()), generation: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
  login: Schema.NonEmptyString, valid: Schema.Literal(true) });
const decodeControlEpoch = Schema.decodeUnknownEffect(Schema.Tuple([ControlEpochSchema]));
type ControlEpoch = typeof ControlEpochSchema.Type;
type ControlCapture = Readonly<{ rawRows: readonly unknown[]; epoch: ControlEpoch }>;
const sameControlEpoch = (a: ControlEpoch, b: ControlEpoch) => a.databaseName === b.databaseName &&
  a.namespaceOid === b.namespaceOid && a.incarnation === b.incarnation && a.generation === b.generation && a.login === b.login;

export type FiniteStorageCaptureProfile =
  | Readonly<{ kind: "installed"; installation: PreparedCoLocatedReadInstallation;
      driver: Pick<PostgresPhysicalSessionDriver<FiniteStorageCaptureError>, "runImplicitCommandEffect" | "runInitialTransactionEffect"> }>
  | Readonly<{ kind: "fullArtifact"; authority?: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> }>;

type InternalCaptureOperation = FiniteStorageCaptureOperation |
  Readonly<{ kind: "ownershipFence" }> |
  Readonly<{ kind: "ownershipPolicyManifest"; revisionId: string; remaining: Readonly<{ records: number; bytes: number }> }> |
  Readonly<{ kind: "ownershipUniqueClosure"; deploymentId: string; schemaVersionId: CatalogSchemaVersionId;
    remaining: Readonly<{ records: number; bytes: number }> }>;

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
  "writeEpochUuid", "schemaVersionId", "creationTime", "insertionCommitSeq", "insertionAttemptOrdinal",
  "valueCodecVersion", "isTombstone", "valueSha256", "valueBytes", "bodyWithheld"];
const indexFields = ["ordinal", "tableIdText", "keyCodecVersionText", "physicalSpecSha256", "encodedKeyBytes",
  "keySha256", "rowIdBytes", "commitSeqText", "isTombstone"];

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
  installed: Result.Result.Success<ReturnType<typeof prepareInstalledFiniteCaptureSource>> | undefined,
  relationalBody?: SQL) {
  const namespace = sql.identifier(installed?.schemaName ?? locator.schemaName);
  const compile = (operation: Readonly<{ kind: Exclude<InternalCaptureOperation["kind"], "relationalPredicate" | "relationalReal"> }> |
    Readonly<{ kind: "relationalPredicate"; body: SQL }>) => {
    const { kind } = operation;
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
      ${sql.placeholder("uniqueDefinitionId")}::integer,
      row(${sql.placeholder("readDeploymentId")}::text,${sql.placeholder("readSchemaVersionId")}::text,
        ${sql.placeholder("readActivationSequence")}::bigint,decode(${sql.placeholder("readManifestSha256")}::text,'hex'),
        decode(${sql.placeholder("readHeadSha256")}::text,'hex'),decode(${sql.placeholder("readActivationSha256")}::text,'hex'),
        decode(${sql.placeholder("readIndexPhysicalSpecSha256")}::text,'hex'),decode(${sql.placeholder("readUniquePhysicalSpecSha256")}::text,'hex'),${sql.placeholder("acceptReadiness")}::boolean)
        ::${namespace}.fx_finite_read_expected) as frontier) select (frontier).* from accepted_capture) capture`;
    const authoritySource = installed === undefined ? captureSource : sql`${installed.source} cross join lateral ${captureSource}`;

    const indexStorage = () => buildPreparedAppIndexSnapshotReadStatement(installed?.schemaName ?? locator.schemaName, {
      scopeUuid: parameter("scopeUuid"), indexDefinitionId: parameter("indexDefinitionId"), snapshotCommitSeq: parameter("snapshot"),
      start: parameter("start"), end: parameter("end"), afterKey: parameter("afterKey"), afterRow: parameter("afterRow"), limit: parameter("limit"),
    });
    const storage = operation.kind === "relationalPredicate" ? operation.body : kind === "rows" ? buildPreparedAppRowsSnapshotReadStatement(installed?.schemaName ?? locator.schemaName, {
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
    const rawFields = kind === "relationalPredicate" ? ["ordinal", "matched"] : kind === "rows" ? rowFields : kind === "indexPage" ? indexFields : kind === "ownership" ? ownershipFields :
      kind === "ownershipPolicyManifest" ? manifestFields : kind === "ownershipUniqueClosure" ? closureFields : ["ordinal"];
    const storageOrder = kind === "ownership" || kind === "ownershipUniqueClosure" ? sql`s.kind,s.ordinal` :
        kind === "ownershipPolicyManifest" ? sql`1` : sql`s.ordinal`;
    const fields = { reason: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.reason else null end`, databaseNow: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.database_now_epoch_milliseconds else null end`,
      servingCommitSeq: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.serving_commit_seq::text else null end`, retainedFloor: sql<string>`case when coalesce(storage._capture_header_ordinal,1) = 1 then capture.retained_floor::text else null end`,
      frontier: frontierFields,
      targetMetadataEpoch: installed === undefined ? sql<string | null>`(select generation::text from ${namespace}.fx_system_prepared_metadata_epoch where singleton_id=1)` : sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${installed.targetMetadataEpoch} else null end`,
      controlMetadataEpoch: installed === undefined ? sql<string | null>`(select generation::text from ${namespace}.fx_system_prepared_metadata_epoch where singleton_id=1)` : sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then ${installed.controlMetadataEpoch} else null end`,
      storagePresent: kind === "ownershipPolicyManifest" ? sql<boolean>`storage."evidenceLength" is not null` : sql<boolean>`storage.ordinal is not null`,
      raw: Object.fromEntries(rawFields.map(name => [name, sql`storage.${sql.identifier(name)}`])),
      transactionTimestamp: kind === "transactionTime" ? sql<string | null>`case when coalesce(storage._capture_header_ordinal,1) = 1 then current_timestamp::text else null end` : sql<string | null>`null::text`,
      exists: kind === "historicalIdentity" ? sql<boolean>`case when capture.reason = 'accepted' and capture.body_eligible then
        (select identity_exists from ${namespace}.fx_read_historical_row_identity(${parameter("scopeUuid")}::uuid,
          ${parameter("tableId")}::integer,${parameter("historicalRowId")}::bytea)) else false end` : sql<boolean>`false` };
    const query = database.select(fields).from(sql`${authoritySource}
      left join lateral (select s.*,row_number() over (order by ${storageOrder}) as _capture_header_ordinal from (${storage}) s
        where capture.reason = 'accepted' and capture.body_eligible offset 0) storage on true`).orderBy(sql`storage._capture_header_ordinal`);
    const orderedFields = [
      ...Object.entries({ reason: fields.reason, databaseNow: fields.databaseNow, servingCommitSeq: fields.servingCommitSeq,
        retainedFloor: fields.retainedFloor })
        .map(([name, field]) => ({ path: [name], field })),
      ...Object.entries(fields.frontier).map(([name, field]) => ({ path: ["frontier", name], field })),
      { path: ["targetMetadataEpoch"], field: fields.targetMetadataEpoch }, { path: ["controlMetadataEpoch"], field: fields.controlMetadataEpoch },
      { path: ["storagePresent"], field: fields.storagePresent },
      ...Object.entries(fields.raw).map(([name, field]) => ({ path: ["raw", name], field })),
      { path: ["transactionTimestamp"], field: fields.transactionTimestamp }, { path: ["exists"], field: fields.exists },
    ];
    const statement = query.toSQL();
    // PostgreSQL retains parsing on the actual pooled connection. Only fixed
    // SQL names are shared; every execution binds fresh pins and checks state.
    const statementName = kind === "relationalPredicate" ? undefined :
      `fx_finite_${createHash("sha256").update(statement.sql).digest("hex").slice(0, 40)}`;
    return Object.freeze({ statement: Object.freeze(statement), statementName, orderedFields,
      mapResult: compileFiniteCaptureResultMapper<Omit<typeof query._.result[number], "storagePresent" | "raw">>(orderedFields, { historicalIdentity: kind === "historicalIdentity", fullArtifact: installed === undefined }) });
  };
  const shapes = new Map<InternalCaptureOperation["kind"], ReturnType<typeof compile>>();
  if (relationalBody !== undefined) shapes.set("relationalPredicate", compile({ kind: "relationalPredicate", body: relationalBody }));
  else for (const kind of ["rows", "indexPage", "ownership", "historicalIdentity", "transactionTime", "retirement",
    "ownershipPolicyManifest", "ownershipUniqueClosure", "ownershipFence"] as const) shapes.set(kind, compile({ kind }));
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
      const { rows, index, tableId, snapshot } = yield* Effect.fromResult(Result.gen(function* () {
        if (operation.kind === "rows" && operation.maximumTotalValueBytes !== undefined &&
          (!Number.isSafeInteger(operation.maximumTotalValueBytes) || operation.maximumTotalValueBytes < 0 || operation.maximumTotalValueBytes > 1_048_576) ||
          operation.kind === "historicalIdentity" && operation.rowId.byteLength !== 16)
          return yield* Result.fail(refused("invalidInput"));
        if (operation.kind === "retirement" && (operation.selector.scopeId !== input.selector.scopeId ||
          operation.selector.sessionId !== input.selector.sessionId || operation.selector.attemptFence !== input.selector.attemptFence ||
          operation.selector.deploymentId !== input.selector.deploymentId || operation.executionClaim.claimFence !== input.executionClaim.claimFence ||
          operation.executionClaim.claimOwner !== input.executionClaim.claimOwner)) return yield* Result.fail(refused("invalidAuthority"));
        const preparedRows = operation.kind === "rows" ? yield* prepareAppRowsSnapshotReadResult(operation.input)
          .pipe(Result.mapError(cause => refused("invalidInput", cause))) : undefined;
        const preparedIndex = operation.kind === "indexPage" ? yield* prepareAppIndexSnapshotReadResult(operation.input)
          .pipe(Result.mapError(cause => refused("invalidInput", cause))) : undefined;
        const selectedTable = preparedRows?.tableId ?? (operation.kind === "indexPage" || operation.kind === "ownership" ||
          operation.kind === "historicalIdentity" || operation.kind === "relationalPredicate" || operation.kind === "relationalReal" ? operation.tableId : selected?.demand.kind !== "clock" ? selected?.demand.tableId ?? null : null);
        const selectedSnapshot = preparedRows?.snapshotCommitSeq ?? preparedIndex?.snapshotCommitSeq ?? expected.snapshotToken.commitSeq;
        if (selectedSnapshot !== expected.snapshotToken.commitSeq || preparedRows !== undefined && preparedRows.scopeId !== input.selector.scopeId ||
          preparedIndex !== undefined && preparedIndex.scopeId !== input.selector.scopeId ||
          selected !== undefined && selected.demand.kind !== "clock" && selectedTable !== selected.demand.tableId)
          return yield* Result.fail(refused("invalidAuthority"));
        const selectsBusiness = operation.kind === "rows" || operation.kind === "indexPage" ||
          operation.kind === "ownership" || operation.kind === "historicalIdentity" || operation.kind === "relationalPredicate" || operation.kind === "relationalReal";
        if (selectsBusiness && (selected === undefined || selected.demand.kind === "clock"))
          return yield* Result.fail(refused("invalidAuthority"));
        if (operation.kind === "relationalPredicate" || operation.kind === "relationalReal") {
          if (participant?.demand.kind !== "rows" || input.finiteReadDemand === undefined)
            return yield* Result.fail(refused("invalidAuthority"));
          const batch = yield* (operation.kind === "relationalPredicate" ? inspectPostgresRelationalBatch(operation.batch, operation.tableId,
            reason => refused(reason === "invalidAuthority" ? "invalidAuthority" : "invalidInput")) :
            inspectLogicalRelationalRealBatch(operation.batch, operation.tableId, reason => refused(reason === "invalidAuthority" ? "invalidAuthority" : "invalidInput")));
          if (!matchesLogicalRelationalAttemptTable(input.finiteReadDemand.admission, operation.tableId, batch.table))
            return yield* Result.fail(refused("invalidAuthority"));
        }
        if (preparedIndex !== undefined && (selected?.definition === undefined ||
          selected.definition.indexDefinitionId !== preparedIndex.indexDefinitionId ||
          !bytesEqualFullScan(appIndexPhysicalSpecSha256HexV1ToBytes(selected.definition.physicalSpecSha256Hex), preparedIndex.physicalSpecSha256)))
          return yield* Result.fail(refused("invalidAuthority"));
        return { rows: preparedRows, index: preparedIndex, tableId: selectedTable, snapshot: selectedSnapshot };
      }));
      const selectedIndexId = selected?.definition?.indexDefinitionId ?? null;
      const unique = participant?.uniqueDefinition;
      // Query-specific bodies remain local to this capture. They are never
      // retained in the static topology cache or named on pooled connections.
      const operationShapes = operation.kind === "relationalPredicate" ? compileFiniteStorageCapturePlan(database, locator, installed,
        yield* Effect.fromResult(buildPostgresRelationalPredicateBody(operation.batch, operation.tableId,
          reason => refused(reason === "invalidAuthority" ? "invalidAuthority" : "invalidInput")))) : shapes;
      const shape = operationShapes.get(operation.kind === "relationalReal" ? "ownershipFence" : operation.kind);
      if (shape === undefined) return yield* Effect.die("Named finite capture shape missing");
      const placeholders = Object.setPrototypeOf({
        deploymentId: input.selector.deploymentId, scopeId: input.selector.scopeId,
        snapshot, claimOwner: input.executionClaim.claimOwner,
        claimFence: input.executionClaim.claimFence, generation: input.preliminaryAuthority.storageGeneration,
        generationFence: input.preliminaryAuthority.storageGenerationFence, epoch: input.preliminaryAuthority.epoch,
        indexDefinitionId: selectedIndexId, tableId, uniqueDefinitionId: unique?.uniqueConstraintDefinitionId ?? null,
        readDeploymentId: retained?.basis.deploymentId ?? null, readSchemaVersionId: retained?.basis.schemaVersionId ?? null,
        readActivationSequence: retained?.basis.activationSequence ?? null, readManifestSha256: retained?.basis.manifestSha256 ?? null,
        readHeadSha256: retained?.basis.headSha256 ?? null, readActivationSha256: retained?.basis.activationSha256 ?? null,
        readIndexPhysicalSpecSha256: selected?.definition?.physicalSpecSha256Hex ?? null,
        readUniquePhysicalSpecSha256: unique?.physicalSpecSha256Hex ?? null,
        acceptReadiness: selected !== undefined && operation.kind !== "retirement",
        rowIds: rows?.rowIds ?? [],
        settlementWindow: operation.kind === "rows" && operation.settlementWindow === true,
        transferBudget: operation.kind === "rows" ? operation.maximumTotalValueBytes ?? 1_048_576 : 1_048_576,
        start: index?.bounds.startInclusive ?? null, end: index?.bounds.endExclusive ?? null,
        afterKey: index?.after?.keyBytes ?? null, afterRow: index?.after?.rowIdBytes ?? null, limit: index?.limit ?? 1,
        historicalRowId: operation.kind === "historicalIdentity" ? operation.rowId : null,
        revisionId: operation.kind === "ownershipPolicyManifest" ? operation.revisionId : null,
        catalogDeploymentId: operation.kind === "ownershipUniqueClosure" ? operation.deploymentId : null,
        catalogSchemaVersionId: operation.kind === "ownershipUniqueClosure" ? operation.schemaVersionId : null,
        remainingRecords: operation.kind === "ownershipPolicyManifest" || operation.kind === "ownershipUniqueClosure" ? operation.remaining.records : 64,
        remainingBytes: operation.kind === "ownershipPolicyManifest" || operation.kind === "ownershipUniqueClosure" ? operation.remaining.bytes : 1_048_576,
      }, attemptBasis.parameters);
      type Captured = ReturnType<typeof shape.mapResult>;
      const acceptCapture = Effect.fnUntraced(function* (result: Captured, requiredEpoch = metadataEpoch) {
        const first = result.header;
        if (first === undefined) return yield* Effect.fail(refused("invalidAuthority"));
        const reason = yield* decodeReason(first.reason).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
        // Replacement validates its fresh native anchor before refusal or
        // retirement. Success never constructs or consumes that frontier.
        if (reason === "attemptReplaced") return { kind: "attemptReplaced" as const, first };
        if (operation.kind === "retirement" && ["attemptMissing", "ownershipChanged", "lifecycleChanged", "expired"].includes(reason))
          return { kind: "retired" as const };
        if (reason !== "accepted") return yield* Effect.fail(refused(reason));
        const timeText = yield* decodeTime(first.databaseNow).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
        if (!Number.isSafeInteger(Number(timeText))) return yield* Effect.fail(refused("storedCorruption"));
        const serving = yield* decodeSequenceText(first.servingCommitSeq).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
        const retainedFloor = yield* decodeSequenceText(first.retainedFloor).pipe(Effect.mapError(cause => refused("storedCorruption", cause)));
        if (serving < expected.snapshotToken.commitSeq || retainedFloor > serving)
          return yield* Effect.fail(refused("storedCorruption"));
        if (selected !== undefined && operation.kind !== "retirement" && retained === undefined)
          return yield* Effect.fail(refused("invalidAuthority"));
        const observedEpoch = Object.freeze({ target: first.targetMetadataEpoch, control: first.controlMetadataEpoch });
        if (requiredEpoch !== undefined && (observedEpoch.target !== requiredEpoch.target || observedEpoch.control !== requiredEpoch.control))
          return yield* Effect.fail(refused("invalidAuthority"));
        if (result.layoutFailure !== undefined) return yield* Effect.fail(refused("storedCorruption", result.layoutFailure));
        return { kind: "accepted" as const, first, observedEpoch };
      });
      const protectedPredicate = Effect.fnUntraced(function* (predicate: Extract<FiniteStorageCaptureOperation, { kind: "relationalPredicate" | "relationalReal" }>) {
        const headerShape = shapes.get("ownershipFence");
        if (headerShape === undefined) return yield* Effect.die("Finite capture header shape missing");
        const requireAccepted = Effect.fnUntraced(function* (result: Captured, epoch?: Readonly<{ target: string | null; control: string | null }>) {
          const accepted = yield* acceptCapture(result, epoch);
          if (accepted.kind === "attemptReplaced") {
            yield* readCapturedFiniteAttemptAnchorRow(accepted.first.frontier).pipe(
              Effect.mapError(cause => refused(cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause)));
            return yield* Effect.fail(refused("attemptReplaced"));
          }
          if (accepted.kind !== "accepted") return yield* Effect.fail(refused("invalidAuthority"));
          return accepted.observedEpoch;
        });
        const work = Effect.fnUntraced(function* (tx: FlarexMetadataTransaction) {
            if (profile.kind === "installed") yield* acquireCoLocatedInstallationAdmission(profile.installation, database, tx)
              .pipe(Effect.mapError(installationFailure));
            else yield* lockInstallationForCurrentTransaction(tx).pipe(Effect.mapError(installationFailure));
            const execute = (command: typeof shape) => Effect.tryPromise({
              try: () => executeNativePhysicalCommand<Captured>(tx._.session, command, placeholders),
              catch: cause => refused("resourceFailure", cause),
            });
            // Planning PostgreSQL regex WHERE clauses can fail before execution.
            // Send the body only after actual admission, retaining its locks.
            const epoch = yield* requireAccepted(yield* execute(headerShape));
            if (predicate.kind === "relationalReal") {
              const result = yield* executeLogicalRelationalRealBatch(tx, predicate.batch, predicate.tableId,
                (reason, cause) => refused(reason === "documentInvalid" ? "documentInvalid" : reason === "unsupportedProfile" ? "unsupportedProfile" :
                  reason === "limitExceeded" ? "limitExceeded" : reason === "invalidAuthority" ? "invalidAuthority" : reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause));
              yield* requireAccepted(yield* execute(headerShape), epoch);
              return Object.freeze({ kind: "relationalReal" as const, ...result });
            }
            const body = yield* execute(shape);
            yield* requireAccepted(body, epoch);
            const decoded = yield* Effect.fromResult(decodePostgresRelationalMatches(predicate.batch, predicate.tableId, body.rawRows,
              (reason, cause) => refused(reason === "invalidAuthority" ? "invalidAuthority" : "storedCorruption", cause)));
            yield* requireAccepted(yield* execute(headerShape), epoch);
            return { kind: "relationalPredicate" as const, body, decoded };
          }, (effect, tx) => effect.pipe(Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx)))));
        if (profile.kind === "fullArtifact") return yield* runEffectTransactionSettlement(
          transaction => database.transaction(transaction), "Protected relational predicate capture failed", work,
          cause => refused("resourceFailure", cause));
        // The physical transaction owner retains rollback access after callback
        // cancellation closes its work fence. Do not nest a Drizzle transaction
        // inside a read callback, whose rollback would use that closed fence.
        return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
          const settled = yield* profile.driver.runInitialTransactionEffect({ isolationLevel: "read committed",
            deadline: yield* deadlines.start("initial", relationalLimits.commandMs),
            lockTimeoutMilliseconds: relationalLimits.lockMs, recoveryTimeoutMilliseconds: relationalLimits.cleanupMs,
          }, restore, work);
          switch (settled.kind) {
            case "committed": return settled.value;
            case "callbackRolledBack": return yield* Effect.failCause(settled.callbackCause);
            case "callbackCleanupFailed": return yield* Effect.failCause(Cause.combine(settled.callbackCause, settled.cleanupCause));
            case "notCommitted": return yield* Effect.failCause(settled.cause);
            case "uncertain": {
              const failure = Cause.fail(refused("resourceFailure", settled.initialSettlementCause));
              return yield* Effect.failCause(settled.quarantine.kind === "confirmed" ? failure : Cause.combine(failure,
                Cause.die(physicalSessionErrors.cleanup({ phase: "quarantine", cause: settled.quarantine.cause }))));
            }
          }
        }));
      });
      if (operation.kind === "relationalPredicate" || operation.kind === "relationalReal") {
        const result = yield* protectedPredicate(operation);
        return result.kind === "relationalReal" ? result :
          Object.freeze({ kind: "relationalPredicate" as const, rawRows: result.body.rawRows, ...result.decoded });
      }
      const result = profile.kind === "installed" ? yield* profile.driver.runImplicitCommandEffect<Captured>(
        { deadline: yield* deadlines.start("read", 30_000) }, shape, placeholders) :
        yield* runEffectTransaction<Captured, FiniteStorageCaptureError, FiniteStorageCaptureError, FlarexMetadataTransaction>(
          work => database.transaction(work), "Finite named capture failed", db => Effect.tryPromise({
          try: () => executeNativePhysicalCommand<Captured>(db._.session, shape, placeholders), catch: cause => refused("resourceFailure", cause),
        }),
          cause => refused("resourceFailure", cause));
      const accepted = yield* acceptCapture(result);
      if (accepted.kind === "attemptReplaced") {
        yield* readCapturedFiniteAttemptAnchorRow(accepted.first.frontier).pipe(
          Effect.mapError(cause => refused(cause.reason === "resourceFailure" ? "resourceFailure" : "storedCorruption", cause)));
        if (operation.kind === "retirement") return Object.freeze({ kind: "retirement" as const, retired: true });
        return yield* Effect.fail(refused("attemptReplaced"));
      }
      if (accepted.kind === "retired") return Object.freeze({ kind: "retirement" as const, retired: true });
      const { first, observedEpoch } = accepted;
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
        case "transactionTime": return Object.freeze({ kind: "transactionTime" as const,
          timestamp: yield* decodeTransactionTimestamp(first.transactionTimestamp).pipe(
            Effect.mapError(cause => refused("storedCorruption", cause))) });
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
      const commandPolicy = snapshot.ownership?.frame.claims.find(claim => claim.policy.tableId === operation.tableId)?.policy;
      return Object.freeze({ kind: "ownership" as const, denied: Result.isFailure(verdict),
        ...(commandPolicy?.owner === "application-command" ? { commandPolicy } : {}) });
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
  readonly reason: "invalidInput" | "invalidAuthority" | "unsupportedProfile" | "documentInvalid" | "limitExceeded" | "resourceFailure" | "storedCorruption" | "attemptMissing" |
    "attemptReplaced" | "ownershipChanged" | "lifecycleChanged" | "expired" | "unsupportedStorageGeneration" |
    "storageGenerationFenceChanged" | "scopeEpochChanged" | "authorizationRevocationEpochChanged" | "notReady";
  readonly cause?: unknown;
}> {}

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
