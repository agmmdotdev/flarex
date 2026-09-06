import { and, eq, ne, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import { canonicalizeApplicationManifest, verifyApplicationManifestWithRelations } from "@flarex/analysis/application-analysis";
import { applicationFunctionCatalogPublicationFrameV1, applicationPublicationCommitmentFrameV1 } from "@flarex/analysis/internal/application-publication-v1";
import { applicationFunctionCatalogPublicationFrameV2, applicationPublicationCommitmentFrame,
  applicationSchemaPublicationFrame } from "@flarex/analysis/internal/application-publication-v2";
import { bytesEqualFullScan, encodeBytesToLowercaseHex as hex } from "@flarex/utils/bytes";
import { digestApplicationWriteOwnership as digest } from "./Digest";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { CatalogSchemaVersionIdSchema, decodeSchemaManifestAppSchemaV1Result, type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { readSchemaVersionArtifactByIdEffect } from "../schemaVersionArtifacts";
import { locateApplicationRelationBindingForCommitEffect } from "../applicationRelationBinding";
import { makeApplicationSchemaAuthorityPublisher } from "../applicationSchemaAuthority";
import { fxSystemApplicationPublications } from "../applicationRelationSchema";
import { fxSystemApplicationPublicationsV1, fxSystemApplicationAnalysesV1, fxControlBoundApplicationSchemas,
  fxControlSchemaVersions } from "../schema";
import type { AppRowTransaction } from "../appRows";
import type { FlarexMetadataDatabase } from "../deployments";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError } from "./Model";
import type { ApplicationWriteOwnershipHistoryBudget } from "./Policy";

/** Complete, bounded publication history over stable catalog identities, including inactive revisions. */
export const readPreviouslyApplicationWritableTables = Effect.fn("ApplicationWriteOwnership.readPublicationHistory")(
  function* (tx: AppRowTransaction, controlDb: FlarexMetadataDatabase, input: Readonly<{
    scopeId: ScopeId; deploymentId: string; revisionId: string;
    schemaVersionId: CatalogSchemaVersionId;
  }>, budget: ApplicationWriteOwnershipHistoryBudget): Effect.fn.Return<ReadonlySet<CatalogTableId>, ApplicationWriteOwnershipError> {
    const legacy = yield* query(tx.select(publicationProjection(fxSystemApplicationPublicationsV1))
      .from(fxSystemApplicationPublicationsV1).where(and(eq(fxSystemApplicationPublicationsV1.scopeId, input.scopeId),
        ne(fxSystemApplicationPublicationsV1.revisionId, input.revisionId))).limit(65));
    yield* Effect.fromResult(budget.consume(legacy.length, 0));
    const current = yield* query(tx.select({ ...publicationProjection(fxSystemApplicationPublications),
      deploymentId: fxSystemApplicationPublications.deploymentId,
      schemaVersionId: fxSystemApplicationPublications.schemaVersionId,
      schemaManifestSha256: fxSystemApplicationPublications.schemaManifestSha256,
      manifestSchemaBindingSha256: fxSystemApplicationPublications.manifestSchemaBindingSha256,
      boundPublicationSha256: fxSystemApplicationPublications.boundPublicationSha256,
    }).from(fxSystemApplicationPublications).where(and(eq(fxSystemApplicationPublications.scopeId, input.scopeId),
      ne(fxSystemApplicationPublications.revisionId, input.revisionId))).limit(65));
    yield* Effect.fromResult(budget.consume(current.length, 0));
    const writable = new Set<CatalogTableId>();
    // Legacy worker schemas need not have an Application publication row. Inspect
    // the deployment's complete retained catalog history as well, so absence from
    // Application publications never grants first ownership of an old identity.
    const catalogHistory = yield* query(controlDb.select({ schemaVersionId: fxControlSchemaVersions.schemaVersionId,
      length: sql<number>`octet_length(${fxControlSchemaVersions.manifestBytes})` }).from(fxControlSchemaVersions)
      .where(and(eq(fxControlSchemaVersions.deploymentId, input.deploymentId),
        ne(fxControlSchemaVersions.schemaVersionId, input.schemaVersionId))).limit(65));
    yield* Effect.fromResult(budget.consume(catalogHistory.length, catalogHistory.reduce((sum, row) => sum + row.length, 0)));
    for (const historical of catalogHistory) {
      const artifact = yield* readSchemaVersionArtifactByIdEffect(controlDb, input.deploymentId, historical.schemaVersionId).pipe(Effect.mapError(failure));
      if (artifact === null || artifact.manifestBytes.byteLength !== historical.length) return yield* invalid();
      const appSchema = yield* Effect.fromResult(decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(Result.mapError(failure)));
      const sizes = yield* query(controlDb.select({ length: sql<number>`octet_length(${fxControlBoundApplicationSchemas.bindingBytes}) + octet_length(${fxControlBoundApplicationSchemas.applicationSchemaFrameBytes})` })
        .from(fxControlBoundApplicationSchemas).where(and(eq(fxControlBoundApplicationSchemas.deploymentId, input.deploymentId),
          eq(fxControlBoundApplicationSchemas.schemaVersionId, historical.schemaVersionId))).limit(1));
      let managed = new Set<CatalogTableId>();
      if (sizes[0] !== undefined) {
        yield* Effect.fromResult(budget.consume(1, sizes[0].length));
        const bound = yield* locateApplicationRelationBindingForCommitEffect(controlDb, { deploymentId: input.deploymentId,
          schemaVersionId: historical.schemaVersionId }).pipe(Effect.mapError(failure));
        if (bound === null || !bytesEqualFullScan(bound.schemaManifestSha256, artifact.manifestSha256)) return yield* invalid();
        if (bound.binding.version === 3) managed = new Set(bound.binding.writePolicies.filter(policy => policy.owner === "payload").map(policy => policy.tableId));
      }
      for (const table of appSchema.tableDefinitions.tables) if (!managed.has(table.tableId)) writable.add(table.tableId);
    }
    const publications: ReadonlyArray<(typeof legacy)[number] | (typeof current)[number]> = [...legacy, ...current];
    for (const publication of publications) {
      const sizes = yield* query(tx.select({ length: sql<number>`octet_length(${fxSystemApplicationAnalysesV1.manifestBytes})`,
        manifestSha256: fxSystemApplicationAnalysesV1.manifestSha256,
      }).from(fxSystemApplicationAnalysesV1).where(and(eq(fxSystemApplicationAnalysesV1.scopeId, input.scopeId),
        eq(fxSystemApplicationAnalysesV1.analysisId, publication.analysisId))).limit(1));
      const size = sizes[0];
      if (size === undefined || size.manifestSha256 === null || !bytesEqualFullScan(size.manifestSha256, publication.manifestSha256)) return yield* invalid();
      yield* Effect.fromResult(budget.consume(1, size.length));
      const analyses = yield* query(tx.select({ bytes: fxSystemApplicationAnalysesV1.manifestBytes })
        .from(fxSystemApplicationAnalysesV1).where(and(eq(fxSystemApplicationAnalysesV1.scopeId, input.scopeId),
          eq(fxSystemApplicationAnalysesV1.analysisId, publication.analysisId))).limit(1));
      const bytes = analyses[0]?.bytes;
      if (bytes === null || bytes === undefined || bytes.byteLength !== size.length) return yield* invalid();
      const parsed = yield* Effect.try({ try: (): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), catch: cause => failure(cause) });
      const canonical = yield* Effect.fromResult(canonicalizeApplicationManifest(parsed).pipe(Result.mapError(failure)));
      const manifest = canonical.manifest;
      if (manifest.version === 3) yield* verifyApplicationManifestWithRelations(manifest).pipe(Effect.mapError(failure));
      if (!bytesEqualFullScan(bytes, canonical.canonicalBytes) || !bytesEqualFullScan(yield* digest(bytes), publication.manifestSha256) ||
        manifest.sourceArtifact.rootSha256 !== hex(publication.sourceArtifactRootSha256)) return yield* invalid();
      const schema = yield* Effect.fromResult(applicationSchemaPublicationFrame(manifest).pipe(Result.mapError(failure)));
      const catalogFrame = manifest.version === 1 ? applicationFunctionCatalogPublicationFrameV1(manifest)
        : applicationFunctionCatalogPublicationFrameV2(manifest);
      const catalog = yield* Effect.fromResult(Result.mapError(catalogFrame, failure));
      if (!bytesEqualFullScan(yield* digest(schema), publication.schemaSha256) ||
        !bytesEqualFullScan(yield* digest(catalog), publication.functionCatalogSha256)) return yield* invalid();
      const commitment = { scopeId: input.scopeId, revisionId: publication.revisionId,
        candidateId: publication.candidateId, analysisId: publication.analysisId,
        sourceArtifactRootSha256: hex(publication.sourceArtifactRootSha256), manifestSha256: hex(publication.manifestSha256),
        schemaSha256: hex(publication.schemaSha256), functionCatalogSha256: hex(publication.functionCatalogSha256) };
      if (manifest.version === 1) {
        if ("deploymentId" in publication) return yield* invalid();
        const frame = yield* Effect.fromResult(applicationPublicationCommitmentFrameV1(commitment).pipe(Result.mapError(failure)));
        yield* Effect.fromResult(budget.consume(0, frame.byteLength));
        if (!bytesEqualFullScan(yield* digest(frame), publication.publicationSha256)) return yield* invalid();
        const schemaVersionId = CatalogSchemaVersionIdSchema.make(`application_${hex(publication.schemaSha256)}`);
        yield* chargeSchemaArtifact(controlDb, input.deploymentId, schemaVersionId, budget);
        const bound = yield* makeApplicationSchemaAuthorityPublisher({ db: controlDb, runTransaction: run => controlDb.transaction(run) })
          .readPublished({ deploymentId: input.deploymentId, manifest }).pipe(Effect.mapError(failure));
        for (const table of bound.tables) writable.add(table.tableId);
      } else {
        if (!("deploymentId" in publication) || publication.deploymentId !== input.deploymentId) return yield* invalid();
        const frame = yield* Effect.fromResult(applicationPublicationCommitmentFrame(manifest, { ...commitment,
          deploymentId: input.deploymentId, schemaVersionId: publication.schemaVersionId,
          schemaManifestSha256: hex(publication.schemaManifestSha256), manifestSchemaBindingSha256: hex(publication.manifestSchemaBindingSha256),
          boundPublicationSha256: hex(publication.boundPublicationSha256) }).pipe(Result.mapError(failure)));
        yield* Effect.fromResult(budget.consume(0, frame.byteLength));
        if (!bytesEqualFullScan(yield* digest(frame), publication.publicationSha256)) return yield* invalid();
        const bindingSizes = yield* query(controlDb.select({ length: sql<number>`octet_length(${fxControlBoundApplicationSchemas.bindingBytes}) + octet_length(${fxControlBoundApplicationSchemas.applicationSchemaFrameBytes})` })
          .from(fxControlBoundApplicationSchemas).where(and(eq(fxControlBoundApplicationSchemas.deploymentId, input.deploymentId),
            eq(fxControlBoundApplicationSchemas.schemaVersionId, publication.schemaVersionId))).limit(1));
        if (bindingSizes[0] === undefined) return yield* invalid();
        yield* Effect.fromResult(budget.consume(1, bindingSizes[0].length));
        yield* chargeSchemaArtifact(controlDb, input.deploymentId, publication.schemaVersionId, budget);
        const bound = yield* locateApplicationRelationBindingForCommitEffect(controlDb, { deploymentId: input.deploymentId,
          schemaVersionId: publication.schemaVersionId }).pipe(Effect.mapError(failure));
        if (bound === null || bound.binding.version !== manifest.version ||
          !bytesEqualFullScan(bound.applicationSchemaSha256, publication.schemaSha256) ||
          !bytesEqualFullScan(bound.boundPublicationSha256, publication.boundPublicationSha256)) return yield* invalid();
        if (bound.binding.version === 2) for (const table of bound.binding.tables) writable.add(table.tableId);
        else for (const policy of bound.binding.writePolicies) if (policy.owner === "application") writable.add(policy.tableId);
      }
    }
    return writable;
  },
);

function publicationProjection(table: typeof fxSystemApplicationPublicationsV1 | typeof fxSystemApplicationPublications) {
  return { revisionId: table.revisionId, candidateId: table.candidateId, analysisId: table.analysisId,
    sourceArtifactRootSha256: table.sourceArtifactRootSha256, manifestSha256: table.manifestSha256,
    schemaSha256: table.schemaSha256, functionCatalogSha256: table.functionCatalogSha256, publicationSha256: table.publicationSha256 };
}

const chargeSchemaArtifact = Effect.fn("ApplicationWriteOwnership.chargeSchemaArtifact")(
  function* (db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: typeof fxControlSchemaVersions.$inferSelect.schemaVersionId,
    budget: ApplicationWriteOwnershipHistoryBudget) {
    const rows = yield* query(db.select({ length: sql<number>`octet_length(${fxControlSchemaVersions.manifestBytes})` })
      .from(fxControlSchemaVersions).where(and(eq(fxControlSchemaVersions.deploymentId, deploymentId), eq(fxControlSchemaVersions.schemaVersionId, schemaVersionId))).limit(1));
    if (rows[0] === undefined) return yield* invalid();
    yield* Effect.fromResult(budget.consume(1, rows[0].length));
  },
);

function failure(cause?: unknown) { return new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause }); }
function invalid() { return Effect.fail(failure()); }
function query<A>(statement: PromiseLike<A>) {
  return runDrizzleStatementEffect(statement, cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }));
}
