import {
  Effect,
  Result,
} from "effect";
import type {
  TrustedScopeAuthority,
  TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import {
  type LocatedReadCommittedAttemptTargetV1,
  hasLocatedReadCommittedTargetDatabaseV1,
} from "../../execution/transactionSessionAttemptKernel";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import { FlarexDbV1StorageGenerationSchema } from "flarex-protocol/storage-authority";
import {
  captureProtectedMetadataEpoch,
  authenticateProtectedTargetMetadataSnapshot,
} from "../../execution/preparation/preparedMetadataEpoch";
import {
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationAnalysesV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationReadinessFunctionsV1,
} from "../../database/schema";
import {
  and,
  eq,
  getTableColumns,
  sql,
} from "drizzle-orm";
import { APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1 } from "@flarex/analysis/application-analysis";
import {
  APPLICATION_PUBLICATION_MAXIMUM_FRAME_BYTES_V1,
} from "@flarex/analysis/internal/application-publication-v1";
import {
  captureApplicationTaskCatalogRowsInTransaction,
  authenticateCapturedApplicationTaskCatalogRows,
} from "../tasks/applicationTaskBindings";
import {
  MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import type {
  ApplicationReadinessRepository,
  ApplicationReadinessAuthority,
  CapturedApplicationReadiness,
  ApplicationReadinessProtection,
  ApplicationReadinessResult,
  DerivedFiniteApplicationReadiness,
} from "./contracts";
import {
  readApplicationReadinessIssuerState,
  registerApplicationReadinessCapture,
  readApplicationReadinessCapture,
  snapshotReadinessProtection,
  readinessEpochsEqual,
  storedReadyProjection,
  readIssuedApplicationReadinessState,
  activationBasis,
  readinessProtectionMatches,
} from "./identity";
import {
  readinessFailure,
  readinessFailureValue,
  type ApplicationReadinessError,
} from "./errors";
import {
  requireExactAuthority,
  authenticateStoredBundle,
} from "./bundle";
import {
  query,
  runTransaction,
} from "./databaseBoundary";
import {
  MAX_FUNCTIONS,
  MAX_READINESS_BYTES,
} from "./limits";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../storage/indexes/indexBuildReconciliation";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import {
  type AppUniqueConstraintSetPreparation,
  chargeUniqueConstraintPreparation,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect,
  preparePointCommitUniqueConstraintSet,
} from "../../commit/point/uniqueEligibility";
import {
  preparePhysicalDefinitionLifecycleReadinessEffect,
  chargePhysicalDefinitionPreparation,
  hasPhysicalDefinitionLifecycleComposition,
} from "../../installation/physicalDefinitionLifecycle";
import {
  chargeHostPreparation,
  captureHostPreparationLifetime,
} from "../../execution/preparation/preparedHostRuntime";
import {
  notReady,
  uniqueNotReadyReason,
} from "./outcomes";
import {
  requireSchemaCorrelation,
  readSchemaBinding,
} from "./controlSchema";
import { MAX_PHYSICAL_DEFINITIONS } from "./physicalCoverage";
import { authenticateStoredColdEvidence } from "./coldEvidence";
import { authenticateStoredReadinessAuthority } from "./storedAuthority";
import { observeExecution } from "../../execution/diagnostics/operation";
import type { FlarexMetadataDatabase } from "../deployments";
import type { ApplicationSchemaAuthorityPublisher } from "../applicationSchemaAuthority";

/** Bounded target capture. Canonical authentication and control access run after SQL closes. */
export const captureApplicationReadinessInTransaction = Effect.fn(
  "ApplicationReadiness.captureRows",
)(function* (repository: ApplicationReadinessRepository<unknown, unknown>, authority: TrustedScopeAuthority, revisionId: string,
  target: LocatedReadCommittedAttemptTargetV1, tx: AppRowTransaction, clock: ScopeClockRecord, profile: "request" | "retained") {
  const state = readApplicationReadinessIssuerState(repository);
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
  registerApplicationReadinessCapture(capture, { issuer: state.issuer, profile, target, rows: Object.freeze({ ...rows, task,
    ...(protection === undefined || before === undefined ? {} : {
      protection: Object.freeze({ ...protection, epoch: before }) }) }) });
  return capture;
});

/** Complete immutable authentication and configured control preparation after target SQL closes. */
export const prepareCapturedApplicationReadiness = Effect.fn(
  "ApplicationReadiness.prepareCapturedRows",
)(function* (repository: ApplicationReadinessRepository<unknown, unknown>, capture: CapturedApplicationReadiness,
  preparationProfile: "full" | "finiteEntry" = "full", originalGenerationProtection?: ApplicationReadinessProtection) {
  const state = readApplicationReadinessIssuerState(repository);
  const captured = readApplicationReadinessCapture(capture);
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
  const issuedState = readIssuedApplicationReadinessState(issued);
  if (issuedState === undefined) return yield* readinessFailure("storedState");
  return Object.freeze({ readiness: issued, basis: activationBasis(issuedState), schema, originalControl });
});

/** A finite capability derives from the original complete cold issuer in its
 * same construction allocation. It cannot turn a partial or foreign capture
 * into paired readiness, and does not recapture SQL or canonical evidence. */
export const deriveFiniteApplicationReadiness = Effect.fnUntraced(function* (repository: unknown,
  issued: ApplicationReadinessResult, originalProtection?: ApplicationReadinessProtection): Effect.fn.Return<
    DerivedFiniteApplicationReadiness, ApplicationReadinessError> {
  const owner = typeof repository === "object" && repository !== null ? readApplicationReadinessIssuerState(repository) : undefined;
  const state = issued.status === "ready" ? readIssuedApplicationReadinessState(issued) : undefined;
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

export function hasApplicationReadinessPlanningComposition(
  repository: unknown,
  controlDb: FlarexMetadataDatabase,
  schema: ApplicationSchemaAuthorityPublisher<unknown>,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >,
): boolean {
  if (typeof repository !== "object" || repository === null) return false;
  const context = readApplicationReadinessIssuerState(repository)?.context;
  return context !== undefined && context.controlDb === controlDb &&
    context.schema === schema && context.authority === authority &&
    hasPhysicalDefinitionLifecycleComposition(
      context.physicalDefinitionLifecycle,
      controlDb,
      authority,
    );
}
