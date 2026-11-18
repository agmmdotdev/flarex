/** Package-internal scalar projection of the finite entry's second command.
 * Composite output fields are expanded before transport and use actual column codecs. */
import { getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { Data, Effect, Result, Schema } from "effect";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type { ScopeClockRecord } from "../scope/scopeClock";
import { exactScopeWriteClockObservationIdentity, readExactScopeWriteClockObservation } from "../scope/scopeClock";
import { runDrizzleStatementEffect } from "../database/drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../database/databaseTimestamp";
import { fxSystemTransactionSessions as sessions, fxSystemAppSchemaCandidateValidations as planningHeads } from "../database/schema";
import { fxSystemApplicationActiveHeads as appHeads, fxSystemApplicationActivations as appActivations } from "../application/applicationActivationSchema";
import { fxSystemDataBindingHeads as bindingHeads, fxSystemDataBindingActivations as bindingActivations,
  fxSystemDataBindingCandidates as bindingCandidates, fxSystemDataBindingPhysicalLanes as bindingLanes } from "../installation/frameworkSchema/binding/schema";
import { MAX_BINDING_BYTES, MAX_COMMERCE_BINDINGS } from "../installation/frameworkSchema/binding/model";

export class FiniteEntryObservationError extends Data.TaggedError("FiniteEntryObservationError")<{
  readonly reason: "invalidObservation" | "resourceFailure"; readonly cause?: unknown;
}> {}
const decodeEntryEnvelope = Schema.decodeUnknownEffect(Schema.Struct({
  hasSession: Schema.Boolean, hasObservation: Schema.Boolean,
}));
const decodeBindingCanonicalColumn = Schema.decodeUnknownSync(Schema.Uint8Array);
function boundedBindingCanonicalColumn(value: SQL,
  column: Pick<typeof bindingHeads.canonicalBytes, "mapFromDriverValue">) {
  return sql`case when octet_length(${value}) between 1 and ${sql.raw(String(MAX_BINDING_BYTES))}
    then ${value} else null end`.mapWith((raw: Uint8Array | null): Uint8Array | null =>
      raw === null ? null : decodeBindingCanonicalColumn(column.mapFromDriverValue(raw)));
}

const entrySelection = {
  hasSession: sql<boolean>`entry.has_session`, hasObservation: sql<boolean>`entry.has_observation`,
  databaseNow: sql`entry.database_now`.mapWith(sessions.createdAt),
  session: {
    scopeUuid: sql`(entry.session).${sql.identifier(sessions.scopeUuid.name)}`.mapWith(sessions.scopeUuid),
    sessionId: sql`(entry.session).${sql.identifier(sessions.sessionId.name)}`.mapWith(sessions.sessionId),
    executionProfile: sql`(entry.session).${sql.identifier(sessions.executionProfile.name)}`.mapWith(sessions.executionProfile),
    finiteAttemptBytes: sql`(entry.session).${sql.identifier(sessions.finiteAttemptBytes.name)}`.mapWith(sessions.finiteAttemptBytes),
    finiteAttemptSha256: sql`(entry.session).${sql.identifier(sessions.finiteAttemptSha256.name)}`.mapWith(sessions.finiteAttemptSha256),
    finiteSnapshotEpochUuid: sql`(entry.session).${sql.identifier(sessions.finiteSnapshotEpochUuid.name)}`.mapWith(sessions.finiteSnapshotEpochUuid),
    finiteSnapshotCommitSeq: sql`(entry.session).${sql.identifier(sessions.finiteSnapshotCommitSeq.name)}`.mapWith(sessions.finiteSnapshotCommitSeq),
    finiteMetadataWatermark: sql`(entry.session).${sql.identifier(sessions.finiteMetadataWatermark.name)}`.mapWith(sessions.finiteMetadataWatermark),
    finiteLeaseExpiresAt: sql`(entry.session).${sql.identifier(sessions.finiteLeaseExpiresAt.name)}`.mapWith(sessions.finiteLeaseExpiresAt),
    finiteClaimOwner: sql`(entry.session).${sql.identifier(sessions.finiteClaimOwner.name)}`.mapWith(sessions.finiteClaimOwner),
    finiteClaimFence: sql`(entry.session).${sql.identifier(sessions.finiteClaimFence.name)}`.mapWith(sessions.finiteClaimFence),
    finiteClaimedAt: sql`(entry.session).${sql.identifier(sessions.finiteClaimedAt.name)}`.mapWith(sessions.finiteClaimedAt),
    finiteClaimExpiresAt: sql`(entry.session).${sql.identifier(sessions.finiteClaimExpiresAt.name)}`.mapWith(sessions.finiteClaimExpiresAt),
    storageGeneration: sql`(entry.session).${sql.identifier(sessions.storageGeneration.name)}`.mapWith(sessions.storageGeneration),
    storageGenerationFence: sql`(entry.session).${sql.identifier(sessions.storageGenerationFence.name)}`.mapWith(sessions.storageGenerationFence),
    executionAuthorityGeneration: sql`(entry.session).${sql.identifier(sessions.executionAuthorityGeneration.name)}`.mapWith(sessions.executionAuthorityGeneration),
    applicationExecutionAuthorityJson: sql`(entry.session).${sql.identifier(sessions.applicationExecutionAuthorityJson.name)}`.mapWith(sessions.applicationExecutionAuthorityJson),
    applicationExecutionAuthorityCanonicalBytes: sql`(entry.session).${sql.identifier(sessions.applicationExecutionAuthorityCanonicalBytes.name)}`.mapWith(sessions.applicationExecutionAuthorityCanonicalBytes),
    applicationExecutionAuthoritySha256: sql`(entry.session).${sql.identifier(sessions.applicationExecutionAuthoritySha256.name)}`.mapWith(sessions.applicationExecutionAuthoritySha256),
    packageId: sql`(entry.session).${sql.identifier(sessions.packageId.name)}`.mapWith(sessions.packageId),
    artifactRuntime: sql`(entry.session).${sql.identifier(sessions.artifactRuntime.name)}`.mapWith(sessions.artifactRuntime),
    artifactId: sql`(entry.session).${sql.identifier(sessions.artifactId.name)}`.mapWith(sessions.artifactId),
    sourcePackageHash: sql`(entry.session).${sql.identifier(sessions.sourcePackageHash.name)}`.mapWith(sessions.sourcePackageHash),
    executionModule: sql`(entry.session).${sql.identifier(sessions.executionModule.name)}`.mapWith(sessions.executionModule),
    functionPath: sql`(entry.session).${sql.identifier(sessions.functionPath.name)}`.mapWith(sessions.functionPath),
    functionKind: sql`(entry.session).${sql.identifier(sessions.functionKind.name)}`.mapWith(sessions.functionKind),
    schemaVersionId: sql`(entry.session).${sql.identifier(sessions.schemaVersionId.name)}`.mapWith(sessions.schemaVersionId),
    policyVersion: sql`(entry.session).${sql.identifier(sessions.policyVersion.name)}`.mapWith(sessions.policyVersion),
    identityAccessPolicySha256: sql`(entry.session).${sql.identifier(sessions.identityAccessPolicySha256.name)}`.mapWith(sessions.identityAccessPolicySha256),
    validatedArgsJson: sql`(entry.session).${sql.identifier(sessions.validatedArgsJson.name)}`.mapWith(sessions.validatedArgsJson),
    validatedArgsValueCodecVersion: sql`(entry.session).${sql.identifier(sessions.validatedArgsValueCodecVersion.name)}`.mapWith(sessions.validatedArgsValueCodecVersion),
    validatedArgsCanonicalBytes: sql`(entry.session).${sql.identifier(sessions.validatedArgsCanonicalBytes.name)}`.mapWith(sessions.validatedArgsCanonicalBytes),
    validatedArgsSha256: sql`(entry.session).${sql.identifier(sessions.validatedArgsSha256.name)}`.mapWith(sessions.validatedArgsSha256),
    authorizationGrantId: sql`(entry.session).${sql.identifier(sessions.authorizationGrantId.name)}`.mapWith(sessions.authorizationGrantId),
    authorizationGrantJson: sql`(entry.session).${sql.identifier(sessions.authorizationGrantJson.name)}`.mapWith(sessions.authorizationGrantJson),
    authorizationGrantValueCodecVersion: sql`(entry.session).${sql.identifier(sessions.authorizationGrantValueCodecVersion.name)}`.mapWith(sessions.authorizationGrantValueCodecVersion),
    authorizationGrantCanonicalBytes: sql`(entry.session).${sql.identifier(sessions.authorizationGrantCanonicalBytes.name)}`.mapWith(sessions.authorizationGrantCanonicalBytes),
    authorizationGrantSha256: sql`(entry.session).${sql.identifier(sessions.authorizationGrantSha256.name)}`.mapWith(sessions.authorizationGrantSha256),
    authorizationRevocationEpoch: sql`(entry.session).${sql.identifier(sessions.authorizationRevocationEpoch.name)}`.mapWith(sessions.authorizationRevocationEpoch),
    authorizationGrantExpiresAt: sql`(entry.session).${sql.identifier(sessions.authorizationGrantExpiresAt.name)}`.mapWith(sessions.authorizationGrantExpiresAt),
    requestKey: sql`(entry.session).${sql.identifier(sessions.requestKey.name)}`.mapWith(sessions.requestKey),
    requestSha256: sql`(entry.session).${sql.identifier(sessions.requestSha256.name)}`.mapWith(sessions.requestSha256),
    lifecycle: sql`(entry.session).${sql.identifier(sessions.lifecycle.name)}`.mapWith(sessions.lifecycle),
    attemptFence: sql`(entry.session).${sql.identifier(sessions.attemptFence.name)}`.mapWith(sessions.attemptFence),
    protocolVersion: sql`(entry.session).${sql.identifier(sessions.protocolVersion.name)}`.mapWith(sessions.protocolVersion),
    hardExpiresAt: sql`(entry.session).${sql.identifier(sessions.hardExpiresAt.name)}`.mapWith(sessions.hardExpiresAt),
    createdAt: sql`(entry.session).${sql.identifier(sessions.createdAt.name)}`.mapWith(sessions.createdAt),
    updatedAt: sql`(entry.session).${sql.identifier(sessions.updatedAt.name)}`.mapWith(sessions.updatedAt),
  },
  applicationHead: {
    scopeId: sql`(entry.application_head).${sql.identifier(appHeads.scopeId.name)}`.mapWith(appHeads.scopeId),
    activationSequence: sql`(entry.application_head).${sql.identifier(appHeads.activationSequence.name)}`.mapWith(appHeads.activationSequence),
    revisionId: sql`(entry.application_head).${sql.identifier(appHeads.revisionId.name)}`.mapWith(appHeads.revisionId),
    readinessContractVersion: sql`(entry.application_head).${sql.identifier(appHeads.readinessContractVersion.name)}`.mapWith(appHeads.readinessContractVersion),
    readinessSha256: sql`(entry.application_head).${sql.identifier(appHeads.readinessSha256.name)}`.mapWith(appHeads.readinessSha256),
    relationSetReadinessSha256: sql`(entry.application_head).${sql.identifier(appHeads.relationSetReadinessSha256.name)}`.mapWith(appHeads.relationSetReadinessSha256),
    relationCount: sql`(entry.application_head).${sql.identifier(appHeads.relationCount.name)}`.mapWith(appHeads.relationCount),
    writePolicySetSha256: sql`(entry.application_head).${sql.identifier(appHeads.writePolicySetSha256.name)}`.mapWith(appHeads.writePolicySetSha256),
    writeOwnershipSha256: sql`(entry.application_head).${sql.identifier(appHeads.writeOwnershipSha256.name)}`.mapWith(appHeads.writeOwnershipSha256),
    activationSha256: sql`(entry.application_head).${sql.identifier(appHeads.activationSha256.name)}`.mapWith(appHeads.activationSha256),
    headSha256: sql`(entry.application_head).${sql.identifier(appHeads.headSha256.name)}`.mapWith(appHeads.headSha256),
    headBytes: sql`(entry.application_head).${sql.identifier(appHeads.headBytes.name)}`.mapWith(appHeads.headBytes),
    createdAt: sql`(entry.application_head).${sql.identifier(appHeads.createdAt.name)}`.mapWith(appHeads.createdAt),
    updatedAt: sql`(entry.application_head).${sql.identifier(appHeads.updatedAt.name)}`.mapWith(appHeads.updatedAt),
  },
  applicationActivation: {
    scopeId: sql`(entry.application_activation).${sql.identifier(appActivations.scopeId.name)}`.mapWith(appActivations.scopeId),
    activationSequence: sql`(entry.application_activation).${sql.identifier(appActivations.activationSequence.name)}`.mapWith(appActivations.activationSequence),
    previousActivationSequence: sql`(entry.application_activation).${sql.identifier(appActivations.previousActivationSequence.name)}`.mapWith(appActivations.previousActivationSequence),
    revisionId: sql`(entry.application_activation).${sql.identifier(appActivations.revisionId.name)}`.mapWith(appActivations.revisionId),
    readinessContractVersion: sql`(entry.application_activation).${sql.identifier(appActivations.readinessContractVersion.name)}`.mapWith(appActivations.readinessContractVersion),
    readinessSha256: sql`(entry.application_activation).${sql.identifier(appActivations.readinessSha256.name)}`.mapWith(appActivations.readinessSha256),
    legacyReadinessSha256: sql`(entry.application_activation).${sql.identifier(appActivations.legacyReadinessSha256.name)}`.mapWith(appActivations.legacyReadinessSha256),
    relationReadinessSha256: sql`(entry.application_activation).${sql.identifier(appActivations.relationReadinessSha256.name)}`.mapWith(appActivations.relationReadinessSha256),
    relationSetReadinessSha256: sql`(entry.application_activation).${sql.identifier(appActivations.relationSetReadinessSha256.name)}`.mapWith(appActivations.relationSetReadinessSha256),
    relationCount: sql`(entry.application_activation).${sql.identifier(appActivations.relationCount.name)}`.mapWith(appActivations.relationCount),
    writePolicySetSha256: sql`(entry.application_activation).${sql.identifier(appActivations.writePolicySetSha256.name)}`.mapWith(appActivations.writePolicySetSha256),
    writeOwnershipSha256: sql`(entry.application_activation).${sql.identifier(appActivations.writeOwnershipSha256.name)}`.mapWith(appActivations.writeOwnershipSha256),
    activationRequestSha256: sql`(entry.application_activation).${sql.identifier(appActivations.activationRequestSha256.name)}`.mapWith(appActivations.activationRequestSha256),
    activationSha256: sql`(entry.application_activation).${sql.identifier(appActivations.activationSha256.name)}`.mapWith(appActivations.activationSha256),
    activationBytes: sql`(entry.application_activation).${sql.identifier(appActivations.activationBytes.name)}`.mapWith(appActivations.activationBytes),
    activatedAt: sql`(entry.application_activation).${sql.identifier(appActivations.activatedAt.name)}`.mapWith(appActivations.activatedAt),
  },
  bindingHead: {
    scopeId: sql`(entry.binding_head).${sql.identifier(bindingHeads.scopeId.name)}`.mapWith(bindingHeads.scopeId),
    storageGeneration: sql`(entry.binding_head).${sql.identifier(bindingHeads.storageGeneration.name)}`.mapWith(bindingHeads.storageGeneration),
    sha256: sql`(entry.binding_head).${sql.identifier(bindingHeads.sha256.name)}`.mapWith(bindingHeads.sha256),
    canonicalBytes: boundedBindingCanonicalColumn(sql`(entry.binding_head).${sql.identifier(bindingHeads.canonicalBytes.name)}`, bindingHeads.canonicalBytes),
    canonicalByteLength: sql`(entry.binding_head).${sql.identifier(bindingHeads.canonicalByteLength.name)}`.mapWith(bindingHeads.canonicalByteLength),
    sequence: sql`(entry.binding_head).${sql.identifier(bindingHeads.sequence.name)}`.mapWith(bindingHeads.sequence),
    activationSha256: sql`(entry.binding_head).${sql.identifier(bindingHeads.activationSha256.name)}`.mapWith(bindingHeads.activationSha256),
    candidateSha256: sql`(entry.binding_head).${sql.identifier(bindingHeads.candidateSha256.name)}`.mapWith(bindingHeads.candidateSha256),
  },
  bindingActivation: {
    scopeId: sql`(entry.binding_activation).${sql.identifier(bindingActivations.scopeId.name)}`.mapWith(bindingActivations.scopeId),
    storageGeneration: sql`(entry.binding_activation).${sql.identifier(bindingActivations.storageGeneration.name)}`.mapWith(bindingActivations.storageGeneration),
    sha256: sql`(entry.binding_activation).${sql.identifier(bindingActivations.sha256.name)}`.mapWith(bindingActivations.sha256),
    canonicalBytes: boundedBindingCanonicalColumn(sql`(entry.binding_activation).${sql.identifier(bindingActivations.canonicalBytes.name)}`, bindingActivations.canonicalBytes),
    canonicalByteLength: sql`(entry.binding_activation).${sql.identifier(bindingActivations.canonicalByteLength.name)}`.mapWith(bindingActivations.canonicalByteLength),
    sequence: sql`(entry.binding_activation).${sql.identifier(bindingActivations.sequence.name)}`.mapWith(bindingActivations.sequence),
    requestId: sql`(entry.binding_activation).${sql.identifier(bindingActivations.requestId.name)}`.mapWith(bindingActivations.requestId),
    candidateSha256: sql`(entry.binding_activation).${sql.identifier(bindingActivations.candidateSha256.name)}`.mapWith(bindingActivations.candidateSha256),
  },
  bindingCandidate: {
    scopeId: sql`(entry.binding_candidate).${sql.identifier(bindingCandidates.scopeId.name)}`.mapWith(bindingCandidates.scopeId),
    storageGeneration: sql`(entry.binding_candidate).${sql.identifier(bindingCandidates.storageGeneration.name)}`.mapWith(bindingCandidates.storageGeneration),
    sha256: sql`(entry.binding_candidate).${sql.identifier(bindingCandidates.sha256.name)}`.mapWith(bindingCandidates.sha256),
    canonicalBytes: boundedBindingCanonicalColumn(sql`(entry.binding_candidate).${sql.identifier(bindingCandidates.canonicalBytes.name)}`, bindingCandidates.canonicalBytes),
    canonicalByteLength: sql`(entry.binding_candidate).${sql.identifier(bindingCandidates.canonicalByteLength.name)}`.mapWith(bindingCandidates.canonicalByteLength),
  },
  planningHead: {
    scopeId: sql`(entry.planning_head).${sql.identifier(planningHeads.scopeId.name)}`.mapWith(planningHeads.scopeId),
    deploymentId: sql`(entry.planning_head).${sql.identifier(planningHeads.deploymentId.name)}`.mapWith(planningHeads.deploymentId),
    schemaVersionId: sql`(entry.planning_head).${sql.identifier(planningHeads.schemaVersionId.name)}`.mapWith(planningHeads.schemaVersionId),
    schemaManifestSha256: sql`(entry.planning_head).${sql.identifier(planningHeads.schemaManifestSha256.name)}`.mapWith(planningHeads.schemaManifestSha256),
    storageGeneration: sql`(entry.planning_head).${sql.identifier(planningHeads.storageGeneration.name)}`.mapWith(planningHeads.storageGeneration),
    storageGenerationFence: sql`(entry.planning_head).${sql.identifier(planningHeads.storageGenerationFence.name)}`.mapWith(planningHeads.storageGenerationFence),
    epoch: sql`(entry.planning_head).${sql.identifier(planningHeads.epoch.name)}`.mapWith(planningHeads.epoch),
    frontierCommitSeq: sql`(entry.planning_head).${sql.identifier(planningHeads.frontierCommitSeq.name)}`.mapWith(planningHeads.frontierCommitSeq),
    attemptFence: sql`(entry.planning_head).${sql.identifier(planningHeads.attemptFence.name)}`.mapWith(planningHeads.attemptFence),
    frameCodecVersion: sql`(entry.planning_head).${sql.identifier(planningHeads.frameCodecVersion.name)}`.mapWith(planningHeads.frameCodecVersion),
    frameKind: sql`(entry.planning_head).${sql.identifier(planningHeads.frameKind.name)}`.mapWith(planningHeads.frameKind),
    frameByteLength: sql`(entry.planning_head).${sql.identifier(planningHeads.frameByteLength.name)}`.mapWith(planningHeads.frameByteLength),
    frameSha256: sql`(entry.planning_head).${sql.identifier(planningHeads.frameSha256.name)}`.mapWith(planningHeads.frameSha256),
    frameBytes: sql`(entry.planning_head).${sql.identifier(planningHeads.frameBytes.name)}`.mapWith(planningHeads.frameBytes),
    createdAt: sql`(entry.planning_head).${sql.identifier(planningHeads.createdAt.name)}`.mapWith(planningHeads.createdAt),
    updatedAt: sql`(entry.planning_head).${sql.identifier(planningHeads.updatedAt.name)}`.mapWith(planningHeads.updatedAt),
  },
  lane: {
    scopeId: sql`(entry.lane).${sql.identifier(bindingLanes.scopeId.name)}`.mapWith(bindingLanes.scopeId),
    storageGeneration: sql`(entry.lane).${sql.identifier(bindingLanes.storageGeneration.name)}`.mapWith(bindingLanes.storageGeneration),
    candidateSha256: sql`(entry.lane).${sql.identifier(bindingLanes.candidateSha256.name)}`.mapWith(bindingLanes.candidateSha256),
    slot: sql`(entry.lane).${sql.identifier(bindingLanes.slot.name)}`.mapWith(bindingLanes.slot),
    installationStorageId: sql`(entry.lane).${sql.identifier(bindingLanes.installationStorageId.name)}`.mapWith(bindingLanes.installationStorageId),
    installationSha256: sql`(entry.lane).${sql.identifier(bindingLanes.installationSha256.name)}`.mapWith(bindingLanes.installationSha256),
    installationReceiptSha256: sql`(entry.lane).${sql.identifier(bindingLanes.installationReceiptSha256.name)}`.mapWith(bindingLanes.installationReceiptSha256),
    readinessStorageId: sql`(entry.lane).${sql.identifier(bindingLanes.readinessStorageId.name)}`.mapWith(bindingLanes.readinessStorageId),
    readinessSha256: sql`(entry.lane).${sql.identifier(bindingLanes.readinessSha256.name)}`.mapWith(bindingLanes.readinessSha256),
    availabilityHistoryStorageId: sql`(entry.lane).${sql.identifier(bindingLanes.availabilityHistoryStorageId.name)}`.mapWith(bindingLanes.availabilityHistoryStorageId),
    availabilitySequence: sql`(entry.lane).${sql.identifier(bindingLanes.availabilitySequence.name)}`.mapWith(bindingLanes.availabilitySequence),
    availabilityStatus: sql`(entry.lane).${sql.identifier(bindingLanes.availabilityStatus.name)}`.mapWith(bindingLanes.availabilityStatus),
    availabilityHistorySha256: sql`(entry.lane).${sql.identifier(bindingLanes.availabilityHistorySha256.name)}`.mapWith(bindingLanes.availabilityHistorySha256),
  },
};
function observationQuery(tx: AppRowTransaction, schemaName: string, scopeId: string,
  scopeUuid: string, generation: string, requestKey: string) {
  return tx.select(entrySelection).from(sql`${sql.identifier(schemaName)}.fx_observe_finite_entry(
    ${scopeId}::text, ${scopeUuid}::uuid, ${generation}::text, ${requestKey}::text) as entry`);
}
type EntryRow = Awaited<ReturnType<typeof observationQuery>>[number];
export interface FiniteEntryApplicationObservation {
  readonly applicationHead: typeof appHeads.$inferSelect | null;
  readonly applicationActivation: typeof appActivations.$inferSelect | null;
}
type BoundedBindingRow<Row> = Omit<Row, "canonicalBytes"> & Readonly<{ canonicalBytes: Uint8Array | null }>;
export interface FiniteEntryBindingObservation {
  readonly bindingHead: BoundedBindingRow<typeof bindingHeads.$inferSelect> | null;
  readonly bindingActivation: BoundedBindingRow<typeof bindingActivations.$inferSelect> | null;
  readonly bindingCandidate: BoundedBindingRow<typeof bindingCandidates.$inferSelect> | null;
  readonly lanes: readonly (typeof bindingLanes.$inferSelect)[];
}
export type FiniteEntryPlanningObservation = typeof planningHeads.$inferSelect | null;
const finiteEntryObservationBrand: unique symbol = Symbol("FiniteEntryObservation");
/** Inert observation ownership; its implementation and row graph stay private. */
export interface FiniteEntryObservation { readonly [finiteEntryObservationBrand]: true }
export interface FiniteEntryCapture {
  readonly sessions: readonly (typeof sessions.$inferSelect)[];
  readonly databaseNow: Date;
  readonly observation: FiniteEntryObservation | null;
}

const observationIssuance = Symbol("FiniteEntryObservationIssuance");
class CapturedFiniteEntryObservation implements FiniteEntryObservation {
  readonly [finiteEntryObservationBrand] = true;
  #open: boolean;
  readonly #tx: AppRowTransaction;
  readonly #clock: ScopeClockRecord;
  #rows: readonly EntryRow[] | undefined;
  readonly #clockIdentity: symbol;
  constructor(issuance: typeof observationIssuance, tx: AppRowTransaction, clock: ScopeClockRecord, rows: readonly EntryRow[], clockIdentity: symbol) {
    // A reflected constructor call cannot obtain the module-private issuance
    // token. Invalid issuance produces a closed carrier and the ordinary typed refusal.
    this.#open = issuance === observationIssuance;
    this.#tx = tx;
    this.#clock = structuredClone(clock);
    this.#rows = this.#open ? rows : undefined;
    this.#clockIdentity = clockIdentity;
    Object.freeze(this);
  }
  static authentic(value: unknown): value is CapturedFiniteEntryObservation {
    return value instanceof CapturedFiniteEntryObservation && #tx in value;
  }
  #authenticate(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<EntryRow, FiniteEntryObservationError> {
    const original = this.#clock;
    if (!this.#open || tx !== this.#tx || exactScopeWriteClockObservationIdentity(tx, clock.scopeId) !== this.#clockIdentity ||
      original.scopeId !== clock.scopeId ||
      original.storageGeneration !== clock.storageGeneration || original.storageGenerationFence !== clock.storageGenerationFence ||
      original.epoch !== clock.epoch || original.lastCommitSeq !== clock.lastCommitSeq ||
      original.lastMetadataSequence !== clock.lastMetadataSequence || original.oldestAvailableCommitSeq !== clock.oldestAvailableCommitSeq ||
      original.updatedAt.getTime() !== clock.updatedAt.getTime())
      return Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
    const first = this.#rows?.[0];
    if (first === undefined) return Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
    return Result.succeed(first);
  }
  application(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<FiniteEntryApplicationObservation, FiniteEntryObservationError> {
    return this.#authenticate(tx, clock).pipe(Result.map(first => ({
      applicationHead: first.applicationHead.scopeId === null ? null : structuredClone(first.applicationHead),
      applicationActivation: first.applicationActivation.scopeId === null ? null : structuredClone(first.applicationActivation),
    })));
  }
  binding(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<FiniteEntryBindingObservation, FiniteEntryObservationError> {
    return this.#authenticate(tx, clock).pipe(Result.map(first => ({
      bindingHead: first.bindingHead.scopeId === null ? null : structuredClone(first.bindingHead),
      bindingActivation: first.bindingActivation.scopeId === null ? null : structuredClone(first.bindingActivation),
      bindingCandidate: first.bindingCandidate.scopeId === null ? null : structuredClone(first.bindingCandidate),
      lanes: this.#rows?.flatMap(row => row.lane.scopeId === null ? [] : [structuredClone(row.lane)]) ?? [],
    })));
  }
  planning(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<FiniteEntryPlanningObservation, FiniteEntryObservationError> {
    return this.#authenticate(tx, clock).pipe(Result.map(first =>
      first.planningHead.scopeId === null ? null : structuredClone(first.planningHead)));
  }

  close(): void { this.#open = false; this.#rows = undefined; }
}
Object.freeze(CapturedFiniteEntryObservation.prototype);
Object.freeze(CapturedFiniteEntryObservation);

function issueFiniteEntryObservation(tx: AppRowTransaction, clock: ScopeClockRecord,
  rows: readonly EntryRow[], identity: symbol): Result.Result<FiniteEntryObservation, FiniteEntryObservationError> {
  if (exactScopeWriteClockObservationIdentity(tx, clock.scopeId) !== identity)
    return Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
  return Result.succeed(new CapturedFiniteEntryObservation(observationIssuance, tx, clock, rows, identity));
}

/** Only the authenticated command-one certificate permits owner lending.
 * Historical request rows return before any fresh source observation is decoded. */
export const captureFiniteEntryObservationInTransactionEffect = Effect.fn("FiniteEntryObservation.capture")(
  function* (tx: AppRowTransaction, schemaName: string, clock: ScopeClockRecord,
    scopeUuid: string, generation: string, requestKey: string): Effect.fn.Return<FiniteEntryCapture, FiniteEntryObservationError> {
    const authority = readExactScopeWriteClockObservation(tx, clock.scopeId);
    const identity = exactScopeWriteClockObservationIdentity(tx, clock.scopeId);
    const nativeScope = yield* Effect.fromResult(projectScopeIdUuidV1Result(clock.scopeId)).pipe(Effect.mapError(cause =>
      new FiniteEntryObservationError({ reason: "invalidObservation", cause })));
    if (authority === undefined || identity === undefined || authority.storageGeneration !== generation ||
      nativeScope.scopeUuid !== scopeUuid ||
      authority.storageGenerationFence !== clock.storageGenerationFence || authority.epoch !== clock.epoch ||
      authority.lastCommitSeq !== clock.lastCommitSeq || authority.lastMetadataSequence !== clock.lastMetadataSequence ||
      authority.oldestAvailableCommitSeq !== clock.oldestAvailableCommitSeq || authority.updatedAt.getTime() !== clock.updatedAt.getTime())
      return yield* Effect.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
    const rows = yield* runDrizzleStatementEffect(observationQuery(tx, schemaName, clock.scopeId, scopeUuid, generation, requestKey),
      cause => new FiniteEntryObservationError({ reason: "resourceFailure", cause }));
    for (const row of rows) yield* decodeEntryEnvelope(row).pipe(Effect.mapError(cause =>
      new FiniteEntryObservationError({ reason: "invalidObservation", cause })));
    const first = rows[0];
    const databaseNow = databaseTimestampFromUnknown(first?.databaseNow);
    if (first === undefined || databaseNow === null || rows.length > MAX_COMMERCE_BINDINGS + 2 ||
      rows.some(row => row.hasSession !== first.hasSession || row.hasObservation !== first.hasObservation) ||
      first.hasSession === first.hasObservation)
      return yield* Effect.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
    if (first.hasSession) {
      if (rows.length > 2) return yield* Effect.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
      return Object.freeze({ sessions: rows.map(row => row.session), databaseNow, observation: null });
    }
    const observation = yield* Effect.fromResult(issueFiniteEntryObservation(tx, clock, rows, identity));
    return Object.freeze({ sessions: [], databaseNow, observation });
  },
);
export function readFiniteEntryApplicationObservation(observation: FiniteEntryObservation,
  tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<FiniteEntryApplicationObservation, FiniteEntryObservationError> {
  return CapturedFiniteEntryObservation.authentic(observation) ? observation.application(tx, clock) :
    Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
}
function observedScopeClock(tx: AppRowTransaction, scopeId: ScopeClockRecord["scopeId"], generation: string):
  Result.Result<ScopeClockRecord, FiniteEntryObservationError> {
  const clock = readExactScopeWriteClockObservation(tx, scopeId);
  return clock === undefined || clock.storageGeneration !== generation
    ? Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" })) : Result.succeed(clock);
}
export function readFiniteEntryBindingObservation(observation: FiniteEntryObservation, tx: AppRowTransaction,
  scopeId: ScopeClockRecord["scopeId"], generation: string): Result.Result<FiniteEntryBindingObservation, FiniteEntryObservationError> {
  if (!CapturedFiniteEntryObservation.authentic(observation))
    return Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
  return observedScopeClock(tx, scopeId, generation).pipe(Result.flatMap(clock => observation.binding(tx, clock)));
}
export function readFiniteEntryPlanningObservation(observation: FiniteEntryObservation, tx: AppRowTransaction,
  scopeId: ScopeClockRecord["scopeId"], generation: string): Result.Result<FiniteEntryPlanningObservation, FiniteEntryObservationError> {
  if (!CapturedFiniteEntryObservation.authentic(observation))
    return Result.fail(new FiniteEntryObservationError({ reason: "invalidObservation" }));
  return observedScopeClock(tx, scopeId, generation).pipe(Result.flatMap(clock => observation.planning(tx, clock)));
}
export function closeFiniteEntryObservation(observation: FiniteEntryObservation | null | undefined): void {
  if (CapturedFiniteEntryObservation.authentic(observation)) observation.close();
}

/** Installation-owned fixed SQL. Storage identifiers and composite result
 * types come from their Drizzle tables; this defines no parallel row schema. */
export function finiteEntryObservationFunctionSql(schemaName: string) {
  const qualified = (table: PgTable) => sql`${sql.identifier(schemaName)}.${sql.identifier(getTableName(table))}`;
  return sql`CREATE FUNCTION ${sql.identifier(schemaName)}.fx_observe_finite_entry(
    p_scope_id text, p_scope_uuid uuid, p_generation text, p_request_key text)
    RETURNS TABLE(has_session boolean, has_observation boolean, database_now timestamptz,
      session ${qualified(sessions)}, application_head ${qualified(appHeads)},
      application_activation ${qualified(appActivations)}, binding_head ${qualified(bindingHeads)},
      binding_activation ${qualified(bindingActivations)}, binding_candidate ${qualified(bindingCandidates)},
      planning_head ${qualified(planningHeads)}, lane ${qualified(bindingLanes)})
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $finite_entry_observation$
    DECLARE
      v_s ${qualified(sessions)}%ROWTYPE;
      v_ah ${qualified(appHeads)}%ROWTYPE;
      v_aa ${qualified(appActivations)}%ROWTYPE;
      v_bh ${qualified(bindingHeads)}%ROWTYPE;
      v_ba ${qualified(bindingActivations)}%ROWTYPE;
      v_bc ${qualified(bindingCandidates)}%ROWTYPE;
      v_p ${qualified(planningHeads)}%ROWTYPE;
      v_replay boolean := false;
      v_now timestamptz;
    BEGIN
      FOR v_s IN SELECT s.* FROM ${qualified(sessions)} AS s
        WHERE s.${sql.identifier(sessions.scopeUuid.name)} = p_scope_uuid
          AND s.${sql.identifier(sessions.requestKey.name)} = p_request_key
        ORDER BY s.${sql.identifier(sessions.sessionId.name)} LIMIT 2 FOR UPDATE
      LOOP
        v_replay := true;
        v_now := date_trunc('milliseconds', clock_timestamp());
        RETURN QUERY SELECT true, false, v_now, v_s, NULL::${qualified(appHeads)},
          NULL::${qualified(appActivations)}, NULL::${qualified(bindingHeads)}, NULL::${qualified(bindingActivations)},
          NULL::${qualified(bindingCandidates)}, NULL::${qualified(planningHeads)}, NULL::${qualified(bindingLanes)};
      END LOOP;
      IF v_replay THEN RETURN; END IF;
      SELECT h.* INTO v_ah FROM ${qualified(appHeads)} AS h
        WHERE h.${sql.identifier(appHeads.scopeId.name)} = p_scope_id FOR SHARE;
      IF v_ah.${sql.identifier(appHeads.scopeId.name)} IS NOT NULL THEN
        SELECT a.* INTO v_aa FROM ${qualified(appActivations)} AS a
          WHERE a.${sql.identifier(appActivations.scopeId.name)} = p_scope_id
            AND a.${sql.identifier(appActivations.activationSequence.name)} = v_ah.${sql.identifier(appHeads.activationSequence.name)} FOR SHARE;
      END IF;
      SELECT h.* INTO v_bh FROM ${qualified(bindingHeads)} AS h
        WHERE h.${sql.identifier(bindingHeads.scopeId.name)} = p_scope_id
          AND h.${sql.identifier(bindingHeads.storageGeneration.name)} = p_generation FOR SHARE;
      IF v_bh.${sql.identifier(bindingHeads.scopeId.name)} IS NOT NULL THEN
        SELECT a.* INTO v_ba FROM ${qualified(bindingActivations)} AS a
          WHERE a.${sql.identifier(bindingActivations.scopeId.name)} = p_scope_id
            AND a.${sql.identifier(bindingActivations.storageGeneration.name)} = p_generation
            AND a.${sql.identifier(bindingActivations.sequence.name)} = v_bh.${sql.identifier(bindingHeads.sequence.name)};
        SELECT c.* INTO v_bc FROM ${qualified(bindingCandidates)} AS c
          WHERE c.${sql.identifier(bindingCandidates.scopeId.name)} = p_scope_id
            AND c.${sql.identifier(bindingCandidates.storageGeneration.name)} = p_generation
            AND c.${sql.identifier(bindingCandidates.sha256.name)} = v_bh.${sql.identifier(bindingHeads.candidateSha256.name)};
      END IF;
      SELECT p.* INTO v_p FROM ${qualified(planningHeads)} AS p
        WHERE p.${sql.identifier(planningHeads.scopeId.name)} = p_scope_id;
      v_now := date_trunc('milliseconds', clock_timestamp());
      RETURN QUERY SELECT false, true, v_now, NULL::${qualified(sessions)},
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_ah END,
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_aa END,
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_bh END,
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_ba END,
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_bc END,
        CASE WHEN row_number() OVER (ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)}) = 1 THEN v_p END,
        l::${qualified(bindingLanes)}
        FROM (SELECT 1) AS singleton LEFT JOIN LATERAL (
          SELECT observed_lane.* FROM ${qualified(bindingLanes)} AS observed_lane
            WHERE observed_lane.${sql.identifier(bindingLanes.scopeId.name)} = p_scope_id
              AND observed_lane.${sql.identifier(bindingLanes.storageGeneration.name)} = p_generation
              AND observed_lane.${sql.identifier(bindingLanes.candidateSha256.name)} = v_bh.${sql.identifier(bindingHeads.candidateSha256.name)}
            ORDER BY observed_lane.${sql.identifier(bindingLanes.slot.name)}, observed_lane.${sql.identifier(bindingLanes.installationStorageId.name)} LIMIT ${sql.raw(String(MAX_COMMERCE_BINDINGS + 2))}
        ) AS l ON true
        ORDER BY l.${sql.identifier(bindingLanes.slot.name)}, l.${sql.identifier(bindingLanes.installationStorageId.name)};
    END;
    $finite_entry_observation$;`;
}

export const FINITE_ENTRY_OBSERVATION_FUNCTION_SQL = new PgDialect().sqlToQuery(
  finiteEntryObservationFunctionSql("__flarex_observation_schema__"),
).sql.replaceAll('"__flarex_observation_schema__"', "%1$I");
const observationBody = FINITE_ENTRY_OBSERVATION_FUNCTION_SQL.split("$finite_entry_observation$")[1];
if (observationBody === undefined) throw new Error("Finite entry observation function body is missing");
const normalizedObservationBody = observationBody.replaceAll("%1$I.", '"__flarex_target__".');

/** Installation-only source/signature/privilege proof under the enclosing
 * installation bounds CTE. Serving uses the admitted installation lifetime. */
export function finiteEntryObservationInstallationSql(schemaName: SQL): SQL<boolean> {
  const compositeTables = [sessions, appHeads, appActivations, bindingHeads, bindingActivations, bindingCandidates,
    planningHeads, bindingLanes];
  const argumentNames = ["p_scope_id", "p_scope_uuid", "p_generation", "p_request_key",
    "has_session", "has_observation", "database_now", "session", "application_head", "application_activation",
    "binding_head", "binding_activation", "binding_candidate", "planning_head", "lane"];
  const scalarTypes = ["text", "uuid", "text", "text", "boolean", "boolean", "timestamptz"];
  const argumentTypes = [...scalarTypes.map(type => sql`${type}::pg_catalog.regtype::oid`),
    ...compositeTables.map(table => sql`(pg_catalog.quote_ident(${schemaName}) || ${`.${getTableName(table)}`})::pg_catalog.regtype::oid`)];
  return sql<boolean>`(
    (select count(*) = 1 from pg_catalog.pg_proc p, bounds b
      where p.pronamespace = b.namespace_oid and p.proname = 'fx_observe_finite_entry')
    and exists (select 1 from pg_catalog.pg_proc p, bounds b
      where p.oid = (pg_catalog.quote_ident(${schemaName}) || '.fx_observe_finite_entry(text,uuid,text,text)')::pg_catalog.regprocedure
        and p.pronamespace = b.namespace_oid and p.proowner = b.owner_oid
        and p.pronargdefaults = 0 and p.prokind = 'f' and p.provolatile = 'v' and not p.prosecdef and not p.proisstrict
        and p.proretset and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
        and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
        and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
        and p.proconfig = array['search_path=pg_catalog, pg_temp']
        and p.proargnames = array[${sql.join(argumentNames.map(name => sql`${name}`), sql`,`)}]::text[]
        and p.proallargtypes = array[${sql.join(argumentTypes, sql`,`)}]::oid[]
        and p.proargmodes = array['i','i','i','i','t','t','t','t','t','t','t','t','t','t','t']::"char"[]
        and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
        and pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),
          '"' || pg_catalog.replace(${schemaName},'"','""') || '".', '"__flarex_target__".'),
          pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".') = ${normalizedObservationBody})
  )`;
}
