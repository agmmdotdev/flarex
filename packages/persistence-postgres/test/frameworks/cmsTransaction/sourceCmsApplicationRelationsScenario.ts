import { setTimeout as delay } from "node:timers/promises";
import { Effect, Fiber, Result, Schema } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { prepareApplicationLogicalSource } from "@flarex/analysis/internal/logical-application-source";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, captureSchemaManifestAppTableDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { RelationIdentityV1Schema } from "flarex-protocol/internal/relation-declaration-v1";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { makeApplicationAnalysisRepository } from "../../../src/application/applicationAnalysisRegistration";
import { fxSystemApplicationReadiness, fxSystemApplicationReadinessRelations } from "../../../src/application/relations/applicationRelationSchema";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import { lendApplicationBindingRelations } from "../../../src/application/activation/bindingPreparation";
import { prepareCurrentApplicationBinding } from "../../../src/application/activation/currentBinding";
import { openApplicationRelationQuerySnapshot, readApplicationRelationQueryIncomingSources } from "../../../src/application/applicationQuerySnapshot";
import { createApplicationRelationReadPort } from "../../../src/application/relations/applicationRelationRead";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { makePostgresRelationalSession, type RelationalSession } from "../../../src/database/relationalTransaction/session";
import { fxControlLogicalReadSources, fxControlLogicalReadTables, fxControlLogicalReadAccess,
  fxAppEdgeAdjacencyVersions, fxAppEdgeCurrent, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxAppRowCurrent, fxAppRowRevisions, fxAppUniqueKeys, fxSystemCommitAppRowChanges,
  fxSystemCommitRelationAdjacencyChanges, fxSystemCommits, fxSystemIdempotency, fxSystemScopeClocks,
  fxSystemEdgeDefinitionBuilds, fxSystemEdgeDefinitionReadiness } from "../../../src/database/schema";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { makeCmsCommandBinding } from "../../../src/frameworks/cmsTransaction/construction";
import { makeCmsHost, type SourceCmsHostInput } from "../../../src/frameworks/cmsTransaction/host";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { prepareSourceCmsDocumentMaterialization } from "../../../src/frameworks/cmsTransaction/contribution";
import { fxSystemCommitPayloadPreferenceDeletions } from "../../../src/frameworks/payloadPreferences/factsSchema";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { ScopeExecutionLive } from "../../../src/scope/execution/ScopeExecution";
import { ensureLogicalStorageDefinitions } from "../../../src/storage/catalog/logicalStorageDefinitions";
import { makeLogicalSchemaAdmission } from "../../../src/storage/catalog/logicalSchemaAdmission";
import { prepareLogicalReadMetadata } from "../../../src/storage/documents/logicalReadMetadata";
import { prepareLogicalDocumentSourceAdmission } from "../../../src/storage/documents/logicalDocuments/documentAdmission";
import { prepareLogicalSourceEvidence } from "../../../src/storage/documents/logicalDocuments/sourceAdmission";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { closeAppUniqueConstraintSetV1InTransactionEffect, prepareAppUniqueConstraintSetClosureV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { prepareAdditionalRelationRevision } from "../../application/relations/applicationRelationReadinessFixture";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { installationBindingReference } from "../../installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { installPayloadPreferenceFixture } from "../payloadPreferences/payloadPreferenceFixture";
import { barrier, withDeadline } from "../../integration/payload/payloadRelationScenario";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createProtectedFileScopedPostgresFixture, type FileScopedPostgresFixture } from "../../support/postgresHelpers";
import { cmsHostFixture } from "./cmsHostFixture";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;
const collections = [
  { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
  { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
    { name: "author", type: "relationship", relationTo: "authors" }] },
];

const decodeAuthor = Schema.decodeUnknownSync(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
const decodeArticle = Schema.decodeUnknownSync(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, headline: Schema.String, author: Schema.NullOr(Schema.String) }),
  [Schema.Record(Schema.String, Schema.Json)]));

/** Setup invokes the real compiler, catalog admission, builds and binding owners. */
async function sourceFixture(persistence: Persistence, session: RelationalSession, proveNativeRefusal = false,
  fixtureIdentity?: NonNullable<Parameters<typeof cmsHostFixture>[1]>["fixtureIdentity"]) {
  const compiled = await runEffect(compilePayloadCollections(collections));
  // Retain the actual driver handle before the general Application fixture
  // intentionally projects it to its driver-neutral persistence contract.
  const control = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const { fixture, target, bindings: contentBindings, candidate: contentCandidate, payloadProfiles } = await cmsHostFixture(persistence,
    { controlPersistence: control, ...(fixtureIdentity === undefined ? {} : { fixtureIdentity }) }, compiled);
  const preferences = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId, control);
  const active = await runEffect(fixture.relationActivation.readActive());
  expect(active.basis).toHaveProperty("relationCount", 1);
  const schemaVersionId = decodeCatalogSchemaVersionId("source-cms-application-relations");
  expect(schemaVersionId).not.toBe(fixture.relation.binding.schemaVersionId);
  const source = await runEffect(captureLogicalSchemaSource({ key: compiled.sourceContract.sourceKey,
    owner: "payload", writeProfile: compiled.sourceContract.writeProfile, evidence: compiled.sourceContract.evidence,
    definition: compiled.sourceContract.definition,
    bindings: compiled.logicalDefinition.tables.map(table => ({ kind: "definition", localName: table.logicalName,
      table: { namespace: "app", logicalName: table.logicalName } })) }));
  const analysis = await runEffect(makeApplicationAnalysisRepository(persistence.drizzle).inspect(fixture.authority, fixture.publication.candidateId));
  if (analysis.status !== "analyzed") throw new Error("Missing authentic Application analysis");
  const applicationSource = await runEffect(prepareApplicationLogicalSource(analysis.manifest, analysis.manifestSha256, source));
  const articleTable = compiled.logicalDefinition.tables.find(table => table.logicalName === "articles");
  const relation = compiled.logicalDefinition.relations[0];
  if (articleTable === undefined || relation === undefined) throw new Error("Missing actual compiled article relation");
  const auditTables = Result.getOrThrow(captureSchemaManifestAppTableDeclarationsV1Result([
    { ...articleTable, logicalName: "audit" },
  ]));
  // This is an explicitly unsupported candidate, never a fabricated successful
  // admission: its native relation's target belongs to the separate Payload source.
  const auditSource = await runEffect(captureLogicalSchemaSource({ key: "application.audit", owner: "application", writeProfile: "application.occ",
    evidence: applicationSource.evidence, definition: { kind: "documents", tables: auditTables, indexes: [], uniqueConstraints: [],
      relations: [{ ...relation, source: { ...relation.source, table: RelationIdentityV1Schema.make("audit") } }] },
    bindings: [{ kind: "definition", localName: "audit", table: { namespace: "app", logicalName: "audit" } }] }));
  const crossOwner = await runEffect(Effect.flip(prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
    state: "candidate", deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    applicationAnalysis: { candidateId: analysis.candidateId, analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256, sourceArtifactRootSha256: analysis.sourceArtifactRootSha256 },
    sources: [applicationSource, source, auditSource], extensions: [] })));
  expect(crossOwner).toMatchObject({ reason: "invalidInput" });
  expect(String(crossOwner.cause)).toContain("Unresolved native relationship");
  const prepared = await runEffect(prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
    state: "candidate", deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    applicationAnalysis: { candidateId: analysis.candidateId, analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256, sourceArtifactRootSha256: analysis.sourceArtifactRootSha256 },
    sources: [applicationSource, source], extensions: [] }));
  const controlSession = "pool" in control
    ? makeCatalogControlSessionStarter({ controlDb: control.drizzle, driver: makePostgresCatalogControlSessionDriver(control.pool) })
    : makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter;
  await runEffect(Effect.gen(function* () {
    yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession,
      deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId }).admit(prepared,
      { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
        initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
  }));
  const arrange = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
    const catalog = yield* ensureLogicalStorageDefinitions(tx, fixture.deploymentId, schemaVersionId);
    const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle,
      { deploymentId: fixture.deploymentId, schemaVersionId }, tx);
    yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
    return catalog;
  });
  const catalog = await runEffect(runEffectTransaction<Effect.Success<ReturnType<typeof arrange>>,
    Effect.Error<ReturnType<typeof arrange>>, Error, FlarexMetadataTransaction>(work => control.drizzle.transaction(work),
    "Prepare source CMS relation catalog", arrange, cause => new Error("Source CMS relation setup", { cause })));
  const carrier = catalog.requirements.evidence.candidate.sources.find(candidate => candidate.key === applicationSource.key);
  expect(carrier).toEqual(applicationSource);
  expect(carrier?.definition).toMatchObject({ kind: "documents", tables: [], indexes: [], uniqueConstraints: [], relations: [] });
  expect(carrier?.bindings).toEqual([]);
  const projectionInventory = async () => ({
    roots: await control.drizzle.select().from(fxControlLogicalReadSources)
      .where(and(eq(fxControlLogicalReadSources.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadSources.schemaVersionId, schemaVersionId)))
      .orderBy(fxControlLogicalReadSources.sourceKey),
    tables: await control.drizzle.select().from(fxControlLogicalReadTables)
      .where(and(eq(fxControlLogicalReadTables.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadTables.schemaVersionId, schemaVersionId)))
      .orderBy(fxControlLogicalReadTables.sourceKey, fxControlLogicalReadTables.localName),
    access: await control.drizzle.select().from(fxControlLogicalReadAccess)
      .where(and(eq(fxControlLogicalReadAccess.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadAccess.schemaVersionId, schemaVersionId)))
      .orderBy(fxControlLogicalReadAccess.sourceKey, fxControlLogicalReadAccess.localName, fxControlLogicalReadAccess.selectorKind, fxControlLogicalReadAccess.selectorKey),
  });
  const projections = await projectionInventory();
  expect(projections.roots.map(root => root.sourceKey)).toEqual([source.key]);
  expect(projections.tables.map(table => table.localName).toSorted()).toEqual(compiled.logicalDefinition.tables.map(table => table.logicalName).toSorted());
  expect(projections.tables.every(table => table.sourceKey === source.key)).toBe(true);
  expect(projections.access.length).toBeGreaterThan(0);
  expect(projections.access.every(access => access.sourceKey === source.key)).toBe(true);
  await runEffect(runEffectTransaction<Effect.Success<ReturnType<typeof arrange>>,
    Effect.Error<ReturnType<typeof arrange>>, Error, FlarexMetadataTransaction>(work => control.drizzle.transaction(work),
    "Repeat actual source CMS catalog ensure", arrange, cause => new Error("Repeat source CMS catalog ensure", { cause })));
  expect(await projectionInventory()).toEqual(projections);
  if (proveNativeRefusal) {
    const malformedNative = await runEffect(captureLogicalSchemaSource({ key: "payload.empty-view", owner: "payload",
      writeProfile: "payload.readOnlyView", evidence: {}, definition: { kind: "documents", tables: [], indexes: [],
        uniqueConstraints: [], relations: [] }, bindings: [] }));
    const admittedCandidate = await runEffect(readPreparedLogicalSchemaCandidate(prepared));
    const malformedCandidate = await runEffect(prepareLogicalSchemaCandidate({ ...admittedCandidate,
      sources: [...admittedCandidate.sources, malformedNative] }));
    const malformedSchemaId = decodeCatalogSchemaVersionId("source-cms-empty-native-refusal");
    await runEffect(Effect.gen(function* () {
      yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession,
        deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId }).admit(malformedCandidate,
        { schemaVersionId: malformedSchemaId, version: decodeCatalogSchemaVersion(101) }, {
          initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
    }));
    const rejected = await runEffect(Effect.flip(runEffectTransaction(work => control.drizzle.transaction(work),
      "Refuse actual malformed native read projection", (tx: FlarexMetadataTransaction) =>
        ensureLogicalStorageDefinitions(tx, fixture.deploymentId, malformedSchemaId),
      cause => new Error("Malformed source projection transaction", { cause }))));
    expect(rejected).toMatchObject({ _tag: "LogicalReadMetadataError", reason: "storedCorruption" });
    expect(await control.drizzle.select().from(fxControlLogicalReadSources).where(and(
      eq(fxControlLogicalReadSources.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadSources.schemaVersionId, malformedSchemaId)))).toEqual([]);
    expect(await projectionInventory()).toEqual(projections);
  }
  const ports = { controlDb: control.drizzle, authority: fixture.authorityPorts };
  const input = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId };
  const indexes = await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, input));
  if (indexes.status !== "reconciled") throw new Error("Missing source index requirements");
  for (const indexDefinitionId of indexes.definitionIds) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(control.drizzle, input.scopeId, indexDefinitionId));
    if (definition === null) throw new Error("Missing source index definition");
    let enabled = false;
    for (let step = 0; step < 20; step++) {
      const request = { deploymentId: input.deploymentId, scopeId: input.scopeId, indexDefinitionId, pageSize: 16 };
      const result = definition.access.kind === "by_creation_time"
        ? await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, request))
        : await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, request));
      if (result.lifecycle === "enabled") { enabled = true; break; }
    }
    expect(enabled).toBe(true);
  }
  const unique = await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(ports, input));
  if (unique.status !== "reconciled") throw new Error("Missing source unique closure");
  let uniqueEnabled = false;
  for (let step = 0; step < (unique.definitionCount + 1) * 4; step++) {
    const result = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...input, pageSize: 16 }));
    if (result.lifecycle === "enabled" && result.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  expect(uniqueEnabled).toBe(true);
  for (const table of fixture.relation.binding.tables) {
    const logical = catalog.requirements.evidence.tableBindings.find(binding => binding.table.namespace === "app" && binding.table.logicalName === table.logicalName);
    expect(logical?.tableId).toBe(table.tableId);
  }
  const bindings = await runEffect(makeDataBindingHost({ database: persistence.drizzle, target,
    selection: { deploymentId: input.deploymentId, scopeId: input.scopeId }, authority: fixture.authorityPorts,
    application: fixture.relationActivation, payloadProfiles,
    logicalStorage: { controlDb: control.drizzle, schemaVersionId, unique: fixture.servingOwners.uniqueConstraintEligibility } }));
  const previous = await runEffect(contentBindings.withCurrent(readAdmittedDataBinding));
  const reference = await runEffect(bindings.readApplicationReference());
  const candidate = await runEffect(bindings.prepare({ ...contentCandidate.frame, application: reference,
    payloadContent: null, payloadLifecycle: { ...installationBindingReference(preferences.availability), profiles: [preferences.profile.profile] },
    logicalSchema: { schemaVersionId,
      manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) } }));
  await runEffect(bindings.activate(dataBindingActivationRequest(input.scopeId, reference.storageGeneration,
    "source-cms-relations-activate", candidate.sha256, previous.head)));
  const hostRuntime = preparedHostTestRuntime(persistence.drizzle);
  const sourceInput = { hostRuntime, database: persistence.drizzle, controlDatabase: control.drizzle, session,
    deploymentId: input.deploymentId, scopeId: input.scopeId, authority: fixture.authorityPorts,
    application: fixture.relationActivation, identityAndAccessPolicy: { subject: "source-cms-application-relations" },
    materialization: fixture.servingOwners.materialization, payloadPreferenceTarget: target,
    logicalStorage: { ports, unique: fixture.servingOwners.uniqueConstraintEligibility, schemaVersionId, source: compiled.sourceContract } } satisfies Omit<SourceCmsHostInput<unknown>, "commands">;
  const scopeUuid = projectScopeIdUuidV1(input.scopeId).scopeUuid;
  const db = persistence.drizzle;
  const inventory = async () => ({
    rows: await db.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid)).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    revisions: await db.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    indexes: await db.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid)).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
    indexRevisions: await db.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid)).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    unique: await db.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.scopeUuid, scopeUuid)).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.rowId),
    edges: await db.select().from(fxAppEdgeCurrent).where(eq(fxAppEdgeCurrent.scopeUuid, scopeUuid)).orderBy(fxAppEdgeCurrent.edgeDefinitionId, fxAppEdgeCurrent.sourceRowId, fxAppEdgeCurrent.targetRowId),
    adjacency: await db.select().from(fxAppEdgeAdjacencyVersions).where(eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid)).orderBy(fxAppEdgeAdjacencyVersions.edgeDefinitionId, fxAppEdgeAdjacencyVersions.direction, fxAppEdgeAdjacencyVersions.endpointRowId),
    relationFacts: await db.select().from(fxSystemCommitRelationAdjacencyChanges).where(eq(fxSystemCommitRelationAdjacencyChanges.scopeUuid, scopeUuid)).orderBy(fxSystemCommitRelationAdjacencyChanges.commitSeq, fxSystemCommitRelationAdjacencyChanges.changeOrdinal),
    facts: await db.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid)).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal),
    commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq),
    outcomes: await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)).orderBy(fxSystemIdempotency.commitSeq),
    clock: await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid)),
    preferences: await db.select().from(preferences.table).where(eq(preferences.table.scope, scopeUuid)).orderBy(preferences.table.id),
    preferenceFacts: await db.select().from(fxSystemCommitPayloadPreferenceDeletions).where(eq(fxSystemCommitPayloadPreferenceDeletions.scopeUuid, scopeUuid))
      .orderBy(fxSystemCommitPayloadPreferenceDeletions.commitSeq, fxSystemCommitPayloadPreferenceDeletions.changeOrdinal),
  });
  const incoming = Effect.fn("SourceCmsApplicationRelations.incoming")(function* (targetId: string) {
    const current = yield* fixture.relationActivation.readActive();
    const declaration = compiled.logicalDefinition.relations[0];
    if (declaration === undefined) return yield* Effect.die(new Error("Missing compiled relation declaration"));
    return yield* Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationRelationQuerySnapshot(current.selection,
        { source: { table: declaration.source.table, path: declaration.source.path } }, {
          deploymentId: fixture.deploymentId, controlDb: control.drizzle, authority: fixture.authorityPorts,
          relations: createApplicationRelationReadPort(control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold) });
      return yield* readApplicationRelationQueryIncomingSources(opened.snapshot, decodeAppDocumentIdV1(targetId), 16);
    }));
  });
  return { fixture, compiled, sourceInput, schemaVersionId, inventory, incoming, applicationSource, source, projectionInventory, preferences, scopeUuid, reference };
}

async function verifySourceGenerationLoans(tested: Awaited<ReturnType<typeof sourceFixture>>, foreignDatabase?: FlarexMetadataDatabase) {
  const { fixture, sourceInput } = tested;
  const before = await tested.inventory();
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const retained = yield* retainPreparedHost(sourceInput.hostRuntime,
      prepareCurrentApplicationBinding(fixture.relationActivation, fixture.persistence.drizzle, binding => Effect.gen(function* () {
        for (const definition of [
          { kind: "unknown" },
          { ...tested.compiled.logicalDefinition, tables: tested.compiled.logicalDefinition.tables.map(table => ({
            ...table, definition: { ...table.definition, documentType: { type: "unknown" } },
          })) },
        ]) {
          expect(yield* Effect.result(prepareLogicalSourceEvidence(sourceInput.logicalStorage.ports,
            sourceInput.logicalStorage.unique, { deploymentId: sourceInput.deploymentId, scopeId: sourceInput.scopeId,
              schemaVersionId: tested.schemaVersionId }, { sourceKey: tested.compiled.sourceContract.sourceKey,
              writeProfile: tested.compiled.sourceContract.writeProfile, evidence: tested.compiled.sourceContract.evidence, definition },
            "payload", "documents", { kind: "standalone", application: binding })))
            .toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalSourceAdmissionError", reason: "invalidInput" } });
        }
        const prepared = yield* prepareLogicalDocumentSourceAdmission(sourceInput.logicalStorage.ports,
          sourceInput.logicalStorage.unique, { deploymentId: sourceInput.deploymentId, scopeId: sourceInput.scopeId,
            schemaVersionId: tested.schemaVersionId }, tested.compiled.sourceContract, { kind: "standalone", application: binding });
        const source = yield* prepared.lendPreparation();
        const template = yield* prepareSourceCmsDocumentMaterialization(source, {}, binding, fixture.control.drizzle);
        const loan = yield* lendApplicationBindingRelations(binding, fixture.control.drizzle);
        expect(loan.kind).toBe("relation");
        if (loan.kind !== "relation") return yield* Effect.die("Genuine relation-bearing input became absent");
        expect(loan.schemaVersionId).toBe(fixture.relation.binding.schemaVersionId);
        expect(loan.relations.definitions.definitions).toHaveLength(1);
        expect(yield* Effect.flip(lendApplicationBindingRelations({ ...binding }, fixture.control.drizzle)))
          .toMatchObject({ reason: "invalidComposition" });
        const foreign = foreignDatabase ?? (fixture.control.drizzle === fixture.persistence.drizzle ? undefined : fixture.persistence.drizzle);
        if (foreign !== undefined) {
          expect(yield* Effect.flip(prepareSourceCmsDocumentMaterialization(source, {}, binding, foreign)))
            .toMatchObject({ reason: "invalidAuthority" });
        }
        return { binding, source, template };
      }), { selection: { deploymentId: sourceInput.deploymentId, scopeId: sourceInput.scopeId }, candidateIssuer: fixture.pointCommitAuthority }));
    yield* Effect.addFinalizer(() => retained.close);
    const original = yield* retained.use(current => current.withEntry(graph => Effect.succeed(Result.succeed(graph.payload))));
    expect(yield* Effect.flip(retainPreparedHost(sourceInput.hostRuntime,
      prepareSourceCmsDocumentMaterialization(original.source, {}, original.binding, fixture.control.drizzle))))
      .toMatchObject({ reason: "invalidAuthority" });
    yield* retained.close;
    expect(yield* Effect.flip(original.template.read)).toMatchObject({ reason: "invalidAuthority" });
  })));
  expect(await tested.inventory()).toEqual(before);
}

export async function sourceCmsApplicationRelationsScenario(persistence: Persistence, session: RelationalSession,
  foreignDatabase?: FlarexMetadataDatabase) {
  const tested = await sourceFixture(persistence, session, true);
  const { fixture } = tested;
  await verifySourceGenerationLoans(tested, foreignDatabase);
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(tested.compiled);
    const binding = yield* makeCmsCommandBinding({ serving: yield* fixture.makeServing(session), hostRuntime: tested.sourceInput.hostRuntime,
      identityAndAccessPolicy: tested.sourceInput.identityAndAccessPolicy,
      profile: { kind: "source", schemaVersionId: tested.schemaVersionId, source: tested.compiled.sourceContract,
        payloadPreferenceTarget: tested.sourceInput.payloadPreferenceTarget } });
    const host = yield* runtime.bind(binding);
    let executions = 0;
    const diagnostics: ExecutionDiagnosticPolicy = { observe: (name, work) => name === "PayloadAdapter.call"
      ? Effect.sync(() => { executions++; }).pipe(Effect.andThen(work)) : work };
    const observe = <A, E>(work: Effect.Effect<A, E>) => work.pipe(Effect.provideService(ExecutionDiagnostics, diagnostics));
    const author = decodeAuthor(yield* observe(host.create(host.newRequestKey(), { collection: "authors", data: { name: "Ada" } })));
    const other = decodeAuthor(yield* observe(host.create(host.newRequestKey(), { collection: "authors", data: { name: "Grace" } })));
    const before = yield* Effect.promise(tested.inventory);
    const key = host.newRequestKey();
    const args = { collection: "articles", data: { headline: "First", author: author.id } };
    const article = decodeArticle(yield* observe(host.create(key, args)));
    expect(article.author).toBe(author.id);
    yield* Effect.promise(async () => {
      const preference = { scope: tested.scopeUuid, generation: tested.reference.storageGeneration,
        userCollection: "users", userId: "user-a", value: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
      await persistence.drizzle.insert(tested.preferences.table).values([
        { ...preference, id: "author-pref", key: `collection-authors-${author.id}` },
        { ...preference, id: "article-pref", key: `collection-articles-${article.id}` },
        { ...preference, id: "other-author-pref", key: `collection-authors-${other.id}` },
      ]);
    });
    const created = yield* Effect.promise(tested.inventory);
    expect(created.preferences).toHaveLength(3);
    expect(created.edges).toHaveLength(1);
    expect(created.edges[0]?.schemaVersionId).toBe(fixture.relation.binding.schemaVersionId);
    expect(created.revisions.filter(row => row.commitSeq === created.commits.at(-1)?.commitSeq).every(row => row.schemaVersionId === tested.schemaVersionId)).toBe(true);
    expect(created.relationFacts.length - before.relationFacts.length).toBe(2);
    expect(created.commits.at(-1)?.relationAdjacencyChangeCount).toBe(2);
    expect(created.adjacency.map(row => row.direction).toSorted()).toEqual(["incoming", "outgoing"]);
    expect((yield* tested.incoming(author.id)).sources.map(item => item.sourceDocumentId)).toEqual([article.id]);
    const invoked = executions;
    expect(yield* observe(host.create(key, args))).toEqual(article);
    expect(executions).toBe(invoked);
    expect(yield* Effect.promise(tested.inventory)).toEqual(created);
    expect(yield* Effect.flip(observe(host.delete(host.newRequestKey(), { collection: "authors", id: author.id }))))
      .toMatchObject({ reason: "relationDeleteRestricted" });
    expect(yield* Effect.promise(tested.inventory)).toEqual(created);
    yield* observe(host.update(host.newRequestKey(), { collection: "articles", id: article.id, data: { headline: "Unchanged reference" } }));
    const unchanged = yield* Effect.promise(tested.inventory);
    expect(unchanged.edges).toEqual(created.edges);
    expect(unchanged.adjacency).toEqual(created.adjacency);
    expect(unchanged.relationFacts).toEqual(created.relationFacts);
    yield* observe(host.update(host.newRequestKey(), { collection: "articles", id: article.id, data: { author: other.id } }));
    const reassigned = yield* Effect.promise(tested.inventory);
    expect(reassigned.edges).toHaveLength(1);
    expect(reassigned.relationFacts.length - unchanged.relationFacts.length).toBe(3);
    expect((yield* tested.incoming(author.id)).sources).toEqual([]);
    expect((yield* tested.incoming(other.id)).sources.map(item => item.sourceDocumentId)).toEqual([article.id]);
    const nativeCommands = inspectPayloadRuntimeForTest(runtime).commands;
    const fault = new Error("Rollback after actual source relation edge write");
    let edgeFaults = 0;
    let cleanedBeforeFailure = 0;
    const faulted = yield* makeCmsHost({ ...tested.sourceInput, commands: Object.values(nativeCommands),
      expectedContentIdentity: tested.compiled.contentIdentity, materialization: { ...tested.sourceInput.materialization,
        afterTransactionStep: event => { if (event.step === "relationEdgeWritten") { edgeFaults++; return Promise.reject(fault); } return Promise.resolve(); } } }, {
      afterPreferenceCleanup: evidence => Effect.sync(() => { cleanedBeforeFailure += evidence.length; }),
    });
    yield* Effect.addFinalizer(() => faulted.close);
    expect(yield* observe(faulted.run(faulted.newRequestKey(), nativeCommands.update,
      { collection: "articles", id: article.id, data: { author: author.id } })).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" });
    expect(edgeFaults).toBe(1);
    expect(yield* Effect.promise(tested.inventory)).toEqual(reassigned);
    yield* observe(host.update(host.newRequestKey(), { collection: "articles", id: article.id, data: { author: null } }));
    const cleared = yield* Effect.promise(tested.inventory);
    expect(cleared.edges).toEqual([]);
    expect(cleared.relationFacts.length - reassigned.relationFacts.length).toBe(2);
    expect((yield* tested.incoming(other.id)).sources).toEqual([]);
    const empty = decodeArticle(yield* observe(host.create(host.newRequestKey(), { collection: "articles", data: { headline: "Null reference" } })));
    expect(empty.author).toBeNull();
    const nullCreated = yield* Effect.promise(tested.inventory);
    expect(nullCreated.relationFacts).toEqual(cleared.relationFacts);
    yield* observe(host.update(host.newRequestKey(), { collection: "articles", id: article.id, data: { author: author.id } }));
    const restored = yield* Effect.promise(tested.inventory);
    expect(yield* observe(faulted.run(faulted.newRequestKey(), nativeCommands.delete,
      { collection: "articles", id: article.id })).pipe(Effect.exit)).toMatchObject({ _tag: "Failure" });
    expect(edgeFaults).toBe(2);
    expect(cleanedBeforeFailure).toBe(1);
    expect(yield* Effect.promise(tested.inventory)).toEqual(restored);
    yield* observe(host.delete(host.newRequestKey(), { collection: "articles", id: article.id }));
    const deleted = yield* Effect.promise(tested.inventory);
    expect(deleted.edges).toEqual([]);
    expect(deleted.relationFacts.length - restored.relationFacts.length).toBe(2);
    expect(deleted.preferences.map(preference => preference.id)).toEqual(["author-pref", "other-author-pref"]);
    expect(deleted.preferenceFacts.map(fact => fact.preferenceId)).toEqual(["article-pref"]);
    expect(deleted.commits.at(-1)?.payloadPreferenceDeletionCount).toBe(1);
    expect((yield* tested.incoming(author.id)).sources).toEqual([]);
    yield* observe(host.delete(host.newRequestKey(), { collection: "authors", id: author.id }));
    const authorDeleted = yield* Effect.promise(tested.inventory);
    expect(authorDeleted.preferences.map(preference => preference.id)).toEqual(["other-author-pref"]);
    expect(authorDeleted.preferenceFacts.map(fact => fact.preferenceId)).toEqual(["article-pref", "author-pref"]);
    expect(authorDeleted.commits.at(-1)?.payloadPreferenceDeletionCount).toBe(1);
    // A changed compiler contract cannot borrow this source binding's authority.
    const foreignCompiled = yield* compilePayloadCollections([
      collections[0], { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
        { name: "editor", type: "relationship", relationTo: "authors" }] },
    ]);
    const foreignRuntime = yield* makePayloadRuntime(foreignCompiled);
    const foreignHost = yield* foreignRuntime.bind(binding);
    const beforeRefusal = yield* Effect.promise(tested.inventory);
    expect(yield* Effect.flip(foreignHost.find({ collection: "articles" }))).toMatchObject({ reason: "invalidAuthority" });
    expect(yield* Effect.flip(runtime.bind({ ...binding }))).toMatchObject({ reason: "invalidAuthority" });
    expect(yield* Effect.promise(tested.inventory)).toEqual(beforeRefusal);
    yield* host.close;
    expect(yield* Effect.flip(host.find({ collection: "articles" }))).toMatchObject({ reason: "closed" });
  })).pipe(Effect.provide(ScopeExecutionLive)));
}

export async function sourceCmsRelationUncertainCommitScenario(persistence: PostgresFlarexPersistence) {
  let armed = false;
  let lostPid: number | undefined;
  const acquired: number[] = [];
  const session = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
    const pid: unknown = Reflect.get(event.client, "processID");
    if (typeof pid !== "number") throw new Error("Missing actual PostgreSQL backend PID");
    if (armed && event.phase === "begin" && event.edge === "after") acquired.push(pid);
    if (armed && lostPid === undefined && event.phase === "commit" && event.edge === "after") {
      // The existing physical driver's `after` edge follows successful COMMIT,
      // before it delivers that acknowledgement to the settlement owner.
      lostPid = pid;
      throw new Error("Lost actual native source COMMIT acknowledgement");
    }
  } });
  const tested = await sourceFixture(persistence, session);
  await runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(tested.compiled);
    const host = yield* runtime.bind(yield* makeCmsCommandBinding({ serving: yield* tested.fixture.makeServing(session),
      hostRuntime: tested.sourceInput.hostRuntime, identityAndAccessPolicy: tested.sourceInput.identityAndAccessPolicy,
      profile: { kind: "source", schemaVersionId: tested.schemaVersionId, source: tested.compiled.sourceContract,
        payloadPreferenceTarget: tested.sourceInput.payloadPreferenceTarget } }));
    const author = decodeAuthor(yield* host.create(host.newRequestKey(), { collection: "authors", data: { name: "Durable author" } }));
    let nativeCalls = 0;
    const diagnostic: ExecutionDiagnosticPolicy = { observe: (name, work) => name === "PayloadAdapter.call"
      ? Effect.sync(() => { nativeCalls++; }).pipe(Effect.andThen(work)) : work };
    const key = host.newRequestKey();
    const args = { collection: "articles", data: { headline: "Lost acknowledgement", author: author.id } };
    const before = yield* Effect.promise(tested.inventory);
    armed = true;
    const article = decodeArticle(yield* host.create(key, args).pipe(Effect.provideService(ExecutionDiagnostics, diagnostic)));
    armed = false;
    expect(lostPid).toBeTypeOf("number");
    expect(nativeCalls).toBe(1);
    expect(acquired).toHaveLength(2);
    expect(acquired[0]).toBe(lostPid);
    expect(acquired[1]).not.toBe(lostPid);
    const after = yield* Effect.promise(tested.inventory);
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.edges).toHaveLength(1);
    expect(after.relationFacts.length - before.relationFacts.length).toBe(2);
    expect(yield* host.create(key, args).pipe(Effect.provideService(ExecutionDiagnostics, diagnostic))).toEqual(article);
    expect(nativeCalls).toBe(1);
    expect(yield* Effect.promise(tested.inventory)).toEqual(after);
  })));
}

export async function sourceCmsEmptyApplicationReadProjectionScenario(owner: FileScopedPostgresFixture) {
  const tested = await sourceFixture(owner.persistence, makePostgresRelationalSession(owner.persistence));
  const before = await tested.projectionInventory();
  const managed = await createProtectedFileScopedPostgresFixture("managed", owner);
  try {
    const installation = managed.installation;
    if (installation === undefined) throw new Error("Missing genuine managed control installation");
    const database = managed.persistence.drizzle;
    const role = await managed.persistence.query<{ superuser: boolean; bypass: boolean }>(
      "select rolsuper as superuser, rolbypassrls as bypass from pg_roles where rolname = current_user");
    expect(role.rows).toEqual([{ superuser: false, bypass: false }]);
    const input = { deploymentId: tested.fixture.deploymentId, scopeId: tested.fixture.authority.scopeId,
      schemaVersionId: tested.schemaVersionId };
    const payloadPin = { sourceKey: tested.source.key, sourceSha256: tested.source.sourceSha256, writeProfile: tested.source.writeProfile };
    const applicationPin = { sourceKey: tested.applicationSource.key, sourceSha256: tested.applicationSource.sourceSha256,
      writeProfile: tested.applicationSource.writeProfile };
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = preparedHostTestRuntime(database);
      // Prove the same real installation can read the actual native root and
      // children before asserting the absent Application coordinate's refusal.
      const native = yield* retainPreparedHost(runtime, prepareLogicalReadMetadata(database, input, payloadPin, installation));
      yield* Effect.addFinalizer(() => native.close);
      yield* native.use(metadata => Effect.gen(function* () {
        expect(metadata.root.sourceKey).toBe(payloadPin.sourceKey);
        expect((yield* metadata.table("authors")).localName).toBe("authors");
        expect((yield* metadata.table("articles")).localName).toBe("articles");
      }));
      expect(yield* Effect.flip(retainPreparedHost(runtime,
        prepareLogicalReadMetadata(database, input, applicationPin, installation))))
        .toMatchObject({ _tag: "LogicalReadMetadataError", reason: "definitionMissing" });
    })));
    expect(await tested.projectionInventory()).toEqual(before);
  } finally { await managed.dispose(); }
}

export async function sourceCmsRelationAdmissionBarrierScenario(persistence: PostgresFlarexPersistence) {
  // Each operation starts from a genuine current-frontier proof. Reusing the
  // first app after its native write would require the pending 04C3A bridge.
  for (const operation of ["rebuild", "activate"] as const) {
    const session = makePostgresRelationalSession(persistence);
    const tested = await sourceFixture(persistence, session, false, {
      deploymentId: `deployment_source_cms_barrier_${operation}`, projectId: `project_source_cms_barrier_${operation}`,
      uuidOffset: operation === "rebuild" ? 40_000 : 80_000,
    });
    const { fixture } = tested;
    const next = await prepareAdditionalRelationRevision(fixture, 61);
    const active = await runEffect(fixture.relationActivation.readActive());
    const located = await runEffect(fixture.relationCommit.locate({ deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.relation.binding.schemaVersionId }));
    const definition = located?.definitions[0];
    if (definition === undefined) throw new Error("Missing genuine edge definition");
    const buildInput = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      schemaVersionId: fixture.relation.binding.schemaVersionId, edgeDefinitionId: definition.edge.edgeDefinitionId };
    expect(await runEffect(fixture.relationBuild.readiness(buildInput))).not.toBeNull();
    const physicalInventory = async () => ({
      heads: await persistence.drizzle.select().from(fxSystemEdgeDefinitionBuilds).where(and(
        eq(fxSystemEdgeDefinitionBuilds.scopeId, buildInput.scopeId), eq(fxSystemEdgeDefinitionBuilds.edgeDefinitionId, buildInput.edgeDefinitionId))),
      receipts: await persistence.drizzle.select().from(fxSystemEdgeDefinitionReadiness).where(and(
        eq(fxSystemEdgeDefinitionReadiness.scopeId, buildInput.scopeId), eq(fxSystemEdgeDefinitionReadiness.edgeDefinitionId, buildInput.edgeDefinitionId)))
        .orderBy(fxSystemEdgeDefinitionReadiness.attemptFence),
      readyRoots: await persistence.drizzle.select().from(fxSystemApplicationReadiness)
        .where(eq(fxSystemApplicationReadiness.scopeId, buildInput.scopeId)).orderBy(fxSystemApplicationReadiness.revisionId),
      readyRelations: await persistence.drizzle.select().from(fxSystemApplicationReadinessRelations)
        .where(eq(fxSystemApplicationReadinessRelations.scopeId, buildInput.scopeId))
        .orderBy(fxSystemApplicationReadinessRelations.revisionId, fxSystemApplicationReadinessRelations.relationOrdinal),
    });
    const physical = await physicalInventory();
    expect(physical.heads).toHaveLength(1);
    expect(physical.receipts).toHaveLength(1);
    expect(physical.heads[0]?.lifecycle).toBe("enabled");
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePayloadRuntime(tested.compiled);
      const commands = inspectPayloadRuntimeForTest(runtime).commands;
      const before = yield* Effect.promise(tested.inventory);
      const entered = barrier<number>();
      const release = barrier<void>();
      const held = yield* makeCmsHost({ ...tested.sourceInput, commands: Object.values(commands), expectedContentIdentity: tested.compiled.contentIdentity }, {
        afterAdmission: tx => Effect.gen(function* () {
          const rows = yield* runDrizzleStatementEffect(tx.select({ pid: sql<number>`pg_backend_pid()` }).from(fxSystemScopeClocks).limit(1),
            cause => cmsError("resourceFailure", cause));
          const pid = rows[0]?.pid;
          if (pid === undefined) return yield* Effect.die("Missing native command backend");
          entered.resolve(pid);
          yield* Effect.promise(() => release.promise);
        }),
      });
      yield* Effect.addFinalizer(() => held.close);
      const native = yield* held.run(held.newRequestKey(), commands.create,
        { collection: "authors", data: { name: `Held ${operation}` } }).pipe(Effect.forkScoped);
      try {
        const blockerPid = yield* Effect.promise(() => withDeadline(entered.promise));
        const maintenance: Effect.Effect<void,
          Effect.Error<ReturnType<typeof fixture.relationBuild.restart>> |
          Effect.Error<ReturnType<typeof fixture.relationActivation.activate>>> = operation === "rebuild"
          ? fixture.relationBuild.restart({ deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
            schemaVersionId: fixture.relation.binding.schemaVersionId, edgeDefinitionId: definition.edge.edgeDefinitionId }).pipe(Effect.asVoid)
          : fixture.relationActivation.activate({ revisionId: next.publication.revisionId, expectedActiveHead: active.expectedActiveHead }).pipe(Effect.asVoid);
        const writer = yield* maintenance.pipe(Effect.result, Effect.forkScoped);
        yield* Effect.promise(async () => {
          for (let attempt = 0; attempt < 200; attempt++) {
            const waiting = await persistence.query<{ pid: number }>(`select pid::int pid from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock' and $1::int = any(pg_blocking_pids(pid))
                and query ilike '%fx_system_scope_clock%' and query ilike '%for update%'`, [blockerPid]);
            if (waiting.rows.length !== 0) return;
            await delay(10);
          }
          throw new Error(`Expected ${operation} to wait behind the actual native command`);
        });
        expect(yield* Effect.sync(writer.pollUnsafe)).toBeUndefined();
        release.resolve();
        expect(decodeAuthor(yield* Fiber.join(native)).name).toBe(`Held ${operation}`);
        const result = yield* Fiber.join(writer);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) expect(result.failure).toMatchObject(operation === "rebuild"
          ? { _tag: "ApplicationRelationBuildServingDefinitionError" }
          : { _tag: "ApplicationActivationError", operation: "activate", reason: "notReady", revisionId: next.publication.revisionId });
        const after = yield* Effect.promise(tested.inventory);
        expect(after.rows.length - before.rows.length).toBe(1);
        expect(after.revisions.length - before.revisions.length).toBe(1);
        expect(after.commits.length - before.commits.length).toBe(1);
        expect(after.outcomes.length - before.outcomes.length).toBe(1);
        expect(after.facts.length - before.facts.length).toBe(1);
        expect(after.edges).toEqual(before.edges);
        expect(after.adjacency).toEqual(before.adjacency);
        expect(after.relationFacts).toEqual(before.relationFacts);
        expect(after.preferences).toEqual(before.preferences);
        expect(after.preferenceFacts).toEqual(before.preferenceFacts);
        expect(yield* Effect.promise(physicalInventory)).toEqual(physical);
        expect(yield* fixture.relationActivation.readActive()).toEqual({ ...active, basis: { ...active.basis,
          authority: { ...active.basis.authority, lastCommitSeq: active.basis.authority.lastCommitSeq + 1n },
        } });
        // Existing active admission authenticates its historical receipt. New
        // current-frontier proof remains absent until 04C3A is implemented.
        expect(yield* fixture.relationBuild.readiness(buildInput)).toBeNull();
      } finally { release.resolve(); }
    })));
  }
}
