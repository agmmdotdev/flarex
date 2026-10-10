import { runEffectTransaction, runEffectTransactionSettlement } from "../../database/effectTransaction";
import { fxSystemApplicationAnalysesV1, fxSystemApplicationReadinessV1 } from "../../database/schema";
import {
  initializeCurrentFiniteMetadataProjection,
  inspectFiniteMetadataProjection,
  mergeFiniteMetadataProjections,
} from "../../execution/finiteMetadataDependencies";
import { lockScopeClockForUpdateInTransactionEffect } from "../../scope/scopeClock";
import { prepareLogicalStorageMetadataProjection } from "../../storage/catalog/logicalStorageReadiness";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { loadPublishedPhysicalRequirementSnapshotV1 } from "../../storage/indexes/indexBuildReconciliation";
import { readUniqueMaintenanceRequirements } from "../../storage/unique/appUniqueConstraintSetBuildV1";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../applicationActivationSchema";
import { canonicalStandaloneApplicationBinding } from "../applicationStandaloneBinding";
import type { FlarexMetadataDatabase } from "../deployments";
import { fxSystemApplicationReadiness } from "../relations/applicationRelationSchema";
import type { ValidatedActivation } from "./activationPersistence";
import { query, sha256 } from "./databaseBoundary";
import { activationError, activationFailure, type ApplicationActivationError } from "./errors";
import { decodeActivation, decodeHead } from "./headCapture";
import { UTF8_FATAL } from "./limits";
import { prepareApplicationExecutionMetadataProjection } from "./metadataProjection";
import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

export const publishStandaloneBindingInTransaction = Effect.fn("ApplicationActivation.publishStandaloneBinding")(
  function* (tx: AppRowTransaction, validated: ValidatedActivation, activationSequence: bigint,
    activationSha256: Uint8Array, headSha256: Uint8Array) {
    const basis = validated.basis;
    const readiness = validated.kind === "legacy"
      ? { kind: "legacy" as const, schemaBindingSha256: encodeBytesToLowercaseHex(validated.basis.schemaBindingSha256) }
      : { ...(validated.basis.writeOwnership === null ? { kind: "relation" as const } : { kind: "policy" as const,
          writePolicySetSha256: validated.basis.writeOwnership.frame.writePolicySetSha256,
          writeOwnershipSha256: validated.basis.writeOwnership.sha256Hex }),
        manifestSchemaBindingSha256: encodeBytesToLowercaseHex(validated.basis.manifestSchemaBindingSha256),
        boundPublicationSha256: encodeBytesToLowercaseHex(validated.basis.boundPublicationSha256),
        relationFrontierCommitSeq: validated.basis.relationFrontierCommitSeq,
        relationSetReadinessSha256: encodeBytesToLowercaseHex(validated.basis.relationSetReadinessSha256), relationCount: validated.basis.relationCount };
    const canonical = yield* canonicalStandaloneApplicationBinding({ format: "flarex.application.read-binding",
      deploymentId: basis.deploymentId, scopeId: basis.authority.scopeId, storageGeneration: basis.authority.storageGeneration,
      storageGenerationFence: basis.authority.storageGenerationFence.toString(), epoch: basis.authority.epoch,
      activationSequence: activationSequence.toString(), activationSha256: encodeBytesToLowercaseHex(activationSha256),
      headSha256: encodeBytesToLowercaseHex(headSha256), revisionId: basis.revisionId, schemaVersionId: basis.schemaVersionId,
      applicationSchemaSha256: encodeBytesToLowercaseHex(basis.applicationSchemaSha256), schemaManifestSha256: encodeBytesToLowercaseHex(basis.schemaManifestSha256),
      readinessSha256: encodeBytesToLowercaseHex(basis.readinessSha256), readiness,
      analysis: { candidateId: basis.candidateId, analysisId: basis.analysisId, manifestSha256: encodeBytesToLowercaseHex(basis.manifestSha256),
        sourceArtifactRootSha256: encodeBytesToLowercaseHex(basis.sourceArtifactRootSha256) } }).pipe(Effect.mapError(cause =>
          activationError("activate", cause.reason, basis.revisionId, false, cause)));
    yield* query(tx.select({ published: sql<null>`${sql.identifier(basis.authority.physicalLocator.schemaName)}.fx_publish_application_read_binding(
      ${canonical.bytes}::bytea, ${canonical.sha256}::bytea)` }).from(sql`(values (1)) as publication_input(value)`), "activate", basis.revisionId);
  },
);

export const backfillStandaloneApplicationBindings = Effect.fn("ApplicationActivation.backfillStandaloneBindings")(
  function* (database: FlarexMetadataDatabase, controlDb: FlarexMetadataDatabase): Effect.fn.Return<void, ApplicationActivationError> {
    const schemaNameRows = yield* Effect.uninterruptible(query(database.select({ schemaName: sql<string>`current_schema()` })
      .from(sql`(values (1)) as schema_input(value)`), "activate"));
    const schemaName = schemaNameRows[0]?.schemaName;
    if (schemaName === undefined) return yield* activationFailure("activate", "storedState");
    let cursor: typeof fxSystemApplicationActiveHeads.$inferSelect.scopeId | undefined;
    for (;;) {
      const heads = yield* Effect.uninterruptible(query(database.select({ scopeId: fxSystemApplicationActiveHeads.scopeId }).from(fxSystemApplicationActiveHeads)
        .where(cursor === undefined ? undefined : gt(fxSystemApplicationActiveHeads.scopeId, cursor))
        .orderBy(asc(fxSystemApplicationActiveHeads.scopeId)).limit(64), "activate"));
      if (heads.length === 0) return;
      for (const selected of heads) {
        // Settle every foreign read/publication for one finite head before
        // cancellation can leave maintenance. The next head is interruptible.
        cursor = yield* Effect.uninterruptible(runEffectTransactionSettlement<ScopeId, ApplicationActivationError, ApplicationActivationError, AppRowTransaction>(callback => database.transaction(callback), "Application metadata backfill rolled back", tx => Effect.gen(function* () {
          yield* lockScopeClockForUpdateInTransactionEffect(tx, selected.scopeId).pipe(Effect.mapError(cause => activationError("activate", "resourceFailure", undefined, false, cause)));
          const currentHeads = yield* query(tx.select().from(fxSystemApplicationActiveHeads)
            .where(eq(fxSystemApplicationActiveHeads.scopeId, selected.scopeId)).limit(1), "activate");
          const row = currentHeads[0];
          if (row === undefined) return yield* activationFailure("activate", "storedState");
          const head = yield* decodeHead(row, "activate");
          const activations = yield* query(tx.select().from(fxSystemApplicationActivations).where(and(
            eq(fxSystemApplicationActivations.scopeId, row.scopeId),
            eq(fxSystemApplicationActivations.activationSequence, row.activationSequence))).limit(1), "activate", row.revisionId);
          const activationRow = activations[0];
          if (activationRow === undefined) return yield* activationFailure("activate", "storedState", row.revisionId);
          yield* decodeActivation(activationRow, "activate", row.revisionId);
          const readinessRows = row.readinessContractVersion === 1
            ? yield* query(tx.select().from(fxSystemApplicationReadinessV1).where(and(
                eq(fxSystemApplicationReadinessV1.scopeId, row.scopeId), eq(fxSystemApplicationReadinessV1.revisionId, row.revisionId))).limit(1), "activate", row.revisionId)
            : yield* query(tx.select().from(fxSystemApplicationReadiness).where(and(
                eq(fxSystemApplicationReadiness.scopeId, row.scopeId), eq(fxSystemApplicationReadiness.revisionId, row.revisionId))).limit(1), "activate", row.revisionId);
          const parent = readinessRows[0];
          if (parent === undefined) return yield* activationFailure("activate", "storedState", row.revisionId);
          const readiness = "schemaBindingSha256" in parent
            ? { kind: "legacy", schemaBindingSha256: encodeBytesToLowercaseHex(parent.schemaBindingSha256) }
            : { kind: row.readinessContractVersion === 3 ? "policy" : "relation",
                manifestSchemaBindingSha256: encodeBytesToLowercaseHex(parent.manifestSchemaBindingSha256),
                boundPublicationSha256: encodeBytesToLowercaseHex(parent.boundPublicationSha256),
                relationFrontierCommitSeq: parent.relationFrontierCommitSeq.toString(),
                relationSetReadinessSha256: encodeBytesToLowercaseHex(parent.relationSetReadinessSha256), relationCount: parent.relationCount,
                ...(head.readinessContractVersion === 3 ? { writePolicySetSha256: head.writePolicySetSha256,
                  writeOwnershipSha256: head.writeOwnershipSha256 } : {}) };
          const canonical = yield* canonicalStandaloneApplicationBinding({ format: "flarex.application.read-binding",
            deploymentId: parent.deploymentId, scopeId: row.scopeId, storageGeneration: parent.storageGeneration,
            storageGenerationFence: parent.storageGenerationFence.toString(), epoch: parent.epoch,
            activationSequence: row.activationSequence.toString(), headSha256: encodeBytesToLowercaseHex(row.headSha256),
            activationSha256: encodeBytesToLowercaseHex(row.activationSha256), revisionId: row.revisionId,
            schemaVersionId: parent.schemaVersionId, applicationSchemaSha256: encodeBytesToLowercaseHex(parent.applicationSchemaSha256),
            schemaManifestSha256: encodeBytesToLowercaseHex(parent.schemaManifestSha256), readinessSha256: encodeBytesToLowercaseHex(parent.readinessSha256),
            readiness, analysis: { candidateId: parent.candidateId, analysisId: parent.analysisId,
              manifestSha256: encodeBytesToLowercaseHex(parent.manifestSha256), sourceArtifactRootSha256: encodeBytesToLowercaseHex(parent.sourceArtifactRootSha256) } })
            .pipe(Effect.mapError(cause => activationError("activate", cause.reason, row.revisionId, false, cause)));
          const analyses = yield* query(tx.select().from(fxSystemApplicationAnalysesV1).where(and(
            eq(fxSystemApplicationAnalysesV1.scopeId, row.scopeId), eq(fxSystemApplicationAnalysesV1.analysisId, parent.analysisId))).limit(1), "activate", row.revisionId);
          const analysis = analyses[0];
          if (analysis === undefined || analysis.manifestBytes === null || analysis.manifestSha256 === null ||
            !bytesEqualFullScan(analysis.manifestSha256, parent.manifestSha256)) return yield* activationFailure("activate", "storedState", row.revisionId);
          const manifestBytes = analysis.manifestBytes;
          const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(UTF8_FATAL.decode(manifestBytes)),
            catch: cause => activationError("activate", "storedState", row.revisionId, false, cause) });
          const manifest = yield* Effect.fromResult(canonicalizeApplicationManifest(parsed)).pipe(
            Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
          if (!bytesEqualFullScan(manifest.canonicalBytes, analysis.manifestBytes) ||
            !bytesEqualFullScan(yield* sha256(manifest.canonicalBytes), parent.manifestSha256))
            return yield* activationFailure("activate", "storedState", row.revisionId);
          const readCatalog = (catalogTx: AppRowTransaction) => Effect.gen(function* () {
            const snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(controlDb,
              { deploymentId: parent.deploymentId, schemaVersionId: parent.schemaVersionId }, catalogTx).pipe(
              Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
            if (snapshot === null || !bytesEqualFullScan(snapshot.manifestSha256, parent.schemaManifestSha256))
              return yield* activationFailure("activate", "storedState", row.revisionId);
            const unique = snapshot.logicalRequirements === undefined ? null : yield* readUniqueMaintenanceRequirements(controlDb,
              parent.deploymentId, parent.schemaVersionId, catalogTx).pipe(
              Effect.mapError(cause => activationError("activate", cause.reason === "resourceFailure" ? "resourceFailure" : "storedState", row.revisionId, false, cause)));
            const logical = yield* prepareLogicalStorageMetadataProjection(
              { deploymentId: parent.deploymentId, schemaVersionId: parent.schemaVersionId, profile: "nativeApplication" }, snapshot, unique?.members ?? []).pipe(
              Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
            const execution = yield* prepareApplicationExecutionMetadataProjection({ manifest: manifest.manifest,
              runtimeHostIdentity: parent.runtimeHostIdentity, compatibilityDate: parent.compatibilityDate }).pipe(
              Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
            const projection = yield* Effect.fromResult(mergeFiniteMetadataProjections(logical === null ? [execution] : [execution, logical])).pipe(
              Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
            return projection;
            });
          const projection = yield* (controlDb === database ? readCatalog(tx) :
            runEffectTransaction<Effect.Success<ReturnType<typeof readCatalog>>, ApplicationActivationError, ApplicationActivationError, AppRowTransaction>(
              callback => controlDb.transaction(callback), "Application backfill catalog acquisition rolled back", readCatalog,
              cause => activationError("activate", "resourceFailure", row.revisionId, false, cause)));
          yield* query(tx.select({ published: sql<null>`${sql.identifier(schemaName)}.fx_publish_application_read_binding(
            ${canonical.bytes}::bytea, ${canonical.sha256}::bytea)` }).from(sql`(values (1)) as publication_input(value)`), "activate", row.revisionId);
          yield* initializeCurrentFiniteMetadataProjection(tx, row.scopeId, projection, inspectFiniteMetadataProjection(projection)?.owners ?? []).pipe(
            Effect.mapError(cause => activationError("activate", "storedState", row.revisionId, false, cause)));
          return row.scopeId;
        }), cause => activationError("activate", "resourceFailure", undefined, false, cause)));
      }
    }
  },
);