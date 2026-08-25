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
  hasApplicationRelationReadinessComposition,
  hasApplicationRelationSetReadinessEvidenceAuthority,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationSetReadinessEvidence,
  type PrepareApplicationRelationReadinessError,
  type PreparedApplicationRelationReadiness,
  type ValidateApplicationRelationSetReadinessError,
  validateApplicationRelationSetReadinessInTransactionEffect,
} from "./applicationRelationReadiness";
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
  | "functionRuntimeUnavailable"
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
  readonly operation: "settle";
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

export interface ApplicationRelationReadinessFoldRepository {
  readonly settle: (input: {
    readonly deploymentId: string;
    readonly revisionId: string;
  }) => Effect.Effect<
    ApplicationRelationReadinessFoldResult,
    SettleApplicationRelationReadinessFoldError
  >;
}

interface FoldRepositoryState {
  readonly context: ApplicationRelationReadinessFoldContext;
}

const repositoryStates = new WeakMap<object, FoldRepositoryState>();
const issuedReadyResults = new WeakMap<object, FoldRepositoryState>();

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

  const settle = Effect.fn("ApplicationRelationReadinessFold.settle")(
    function* (input: {
      readonly deploymentId: string;
      readonly revisionId: string;
    }): Effect.fn.Return<
      ApplicationRelationReadinessFoldResult,
      SettleApplicationRelationReadinessFoldError
    > {
      if (!validIdentity(input.deploymentId) ||
        !validIdentity(input.revisionId)) {
        return yield* failure("invalidInput");
      }
      if (!compositionIsExact()) return yield* failure("invalidComposition");
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        input.deploymentId,
        captured.authority,
      );
      if (located.authority.storageGeneration !== "flarexdb_v1") {
        return yield* failure("authorityChanged");
      }
      const authority: ApplicationReadinessAuthority = Object.freeze({
        ...located.authority,
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      });
      const bundle = yield* runLocatedTransaction(
        located.target,
        tx => reserveBundle(
          tx,
          authority,
          input,
          captured.taskCatalog,
          "share",
        ),
      );
      if ("status" in bundle) return bundle;
      if (bundle.functions.length !== 0) {
        return notReady(
          bundle.revision.revisionId,
          "functionRuntimeUnavailable",
          "relation-aware cold runtime target is not yet installed",
        );
      }
      const schema = yield* captured.schema.resolve({
        deploymentId: bundle.deploymentId,
        applicationManifestSha256:
          encodeBytesToLowercaseHex(bundle.revision.manifestSha256),
        manifest: bundle.manifest,
      });
      yield* requireSchemaCorrelation(bundle, schema);
      const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
        captured.controlDb,
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
      const candidate = yield* loadAppSchemaCandidateReadinessEffect(
        captured.candidateValidation,
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
      if (candidate.status !== "ready") {
        return notReady(
          bundle.revision.revisionId,
          candidateNotReadyReason(candidate.reason),
        );
      }
      const unique = yield*
        loadPointCommitUniqueConstraintEligibilityForReadinessV1Effect(
          captured.pointCommit,
          Object.freeze({
            deploymentId: bundle.deploymentId,
            scopeId: bundle.authority.scopeId,
            schemaVersionId: schema.schemaVersionId,
          }),
          captured.controlDb,
          captured.authority,
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
          captured.physicalDefinitionLifecycle,
          bundle.authority.scopeId,
          requirements,
          unique,
        );
      const relations = yield* captured.relations.prepare({
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
      return yield* runLocatedTransaction(
        located.target,
        tx => settleInTransaction(
          tx,
          Object.freeze({
            bundle,
            schema,
            requirements,
            candidate: candidate.evidence,
            unique,
            uniqueSha256,
            physicalLifecycle,
            relations,
            coldReceiptSetSha256,
          }),
          captured,
          state,
        ),
      );
    },
  );
  const repository = Object.freeze({ settle });
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
  return repositoryState !== undefined && issuedReadyResults.get(value) ===
    repositoryState;
}

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
  readonly candidate: AppSchemaCandidateReadinessEvidence;
  readonly unique: Exclude<
    AppUniqueConstraintSetEligibilityResultV1,
    { readonly status: "not_ready" }
  >;
  readonly uniqueSha256: Uint8Array;
  readonly physicalLifecycle: PreparedPhysicalDefinitionLifecycleReadiness;
  readonly relations: PreparedApplicationRelationReadiness;
  readonly coldReceiptSetSha256: Uint8Array;
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
    | ApplicationRelationReadinessFoldError
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
): Effect.fn.Return<void, ApplicationRelationReadinessFoldError> {
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

const settleInTransaction = Effect.fn(
  "ApplicationRelationReadinessFold.settleInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  context: ApplicationRelationReadinessFoldContext,
  repositoryState: FoldRepositoryState,
): Effect.fn.Return<
  ApplicationRelationReadinessFoldResult,
  | SettleApplicationRelationReadinessFoldError
  | ApplicationTaskCatalogSnapshotError
> {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(
      tx,
      prepared.bundle.authority.scopeId,
    );
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
    const candidate = yield*
      validateAppSchemaCandidateReadinessInTransactionEffect(
        tx,
        context.candidateValidation,
        prepared.candidate,
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
    const readyAt = yield* readinessReadyAt(
      tx,
      prepared.bundle.authority.scopeId,
      prepared.bundle.revision.revisionId,
    );
    const readinessBytes = yield* relationReadinessFrame(
      prepared,
      physical,
      relationSet.evidence,
      readyAt,
    );
    const readinessSha256 = yield* sha256(readinessBytes);
    const inserted = yield* insertOrReplayReadiness(
      tx,
      prepared,
      physical,
      relationSet.evidence,
      readinessSha256,
      readinessBytes,
      readyAt,
    );
    const stableReadinessBytes = copyBytes(readinessBytes);
    const stableReadyAtMillis = inserted.readyAt.getTime();
    const result = Object.freeze({
      status: "ready",
      disposition: inserted.disposition,
      scopeId: prepared.bundle.authority.scopeId,
      revisionId: prepared.bundle.revision.revisionId,
      schemaVersionId: prepared.schema.schemaVersionId,
      readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
      get readinessBytes(): Uint8Array {
        return copyBytes(stableReadinessBytes);
      },
      relationSetReadinessSha256:
        encodeBytesToLowercaseHex(relationSet.evidence.sha256),
      relationCount: relationSet.evidence.receipt.relationCount,
      get readyAt(): Date {
        return new Date(stableReadyAtMillis);
      },
    } as const);
    issuedReadyResults.set(result, repositoryState);
    return result;
});

const insertOrReplayReadiness = Effect.fn(
  "ApplicationRelationReadinessFold.insertOrReplayReadiness",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedFold,
  physical: Extract<ApplicationPhysicalReadinessResult, {
    readonly status: "ready";
  }>,
  relations: ApplicationRelationSetReadinessEvidence,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
  readyAt: Date,
): Effect.fn.Return<
  Readonly<{ readonly disposition: "inserted" | "replayed"; readonly readyAt: Date }>,
  ApplicationRelationReadinessFoldError
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
      prepared.candidate.receiptSha256Hex,
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
): Effect.fn.Return<void, ApplicationRelationReadinessFoldError> {
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
  relations: ApplicationRelationSetReadinessEvidence,
  readinessSha256: Uint8Array,
  readinessBytes: Uint8Array,
): Effect.fn.Return<Date, ApplicationRelationReadinessFoldError> {
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
      prepared.candidate.receiptSha256Hex,
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
  relations: ApplicationRelationSetReadinessEvidence,
  readyAt: Date,
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldError> {
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
      prepared.candidate.receiptSha256Hex,
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
): Effect.Effect<void, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<void, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<void, ApplicationRelationReadinessFoldError> {
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
  ApplicationRelationReadinessFoldError
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
): Effect.Effect<void, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<Uint8Array, ApplicationRelationReadinessFoldError> {
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
): Effect.fn.Return<Uint8Array, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<Date, ApplicationRelationReadinessFoldError> {
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
): Effect.fn.Return<Date, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<ReadonlyArray<Row>, ApplicationRelationReadinessFoldError> {
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
): Effect.Effect<void, ApplicationRelationReadinessFoldError> {
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
): Effect.fn.Return<Value, Failure | ApplicationRelationReadinessFoldError> {
  return yield* runLocatedReadCommittedEffect(
    target,
    {
      rollbackMessage: "Application relation readiness fold rolled back.",
      cleanupDefect: cause => failureValue("resourceFailure", false, cause),
    },
    body,
  ).pipe(Effect.mapError((cause): Failure |
    ApplicationRelationReadinessFoldError => {
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
): Effect.Effect<never, ApplicationRelationReadinessFoldError> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationRelationReadinessFoldError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationRelationReadinessFoldError {
  return new ApplicationRelationReadinessFoldError({
    operation: "settle",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
