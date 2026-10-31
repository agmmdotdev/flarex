import { createHash } from "node:crypto";
import { encodeValidatorJsonV1 } from "flarex-protocol/validator-json";
import { Effect, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { analyzeLoadedApplicationSourcePackageEffect } from "@flarex/analysis";
import { makeApplicationManifest, verifyApplicationManifestV3 } from "@flarex/analysis/application-analysis";
import { readPreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { applicationSchemaDefinition, applicationTableDefinition, applicationTableDefinitionWithIndex } from "../../../../application-schema-definition/src/ApplicationSchema";
import { applicationObjectValidatorJson, applicationScalarValidatorJson } from "../../../../application-schema-definition/src/ValidatorJson";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { compilePayloadCollections, type CompiledPayloadCollections } from "../../../../payload-adapter/src/collections";
import { makeSchemaComposer } from "../../../../medusa-adapter/src/composition/schema";
import { compileCurrencyDefinition } from "../../../../medusa-adapter/src/modules/currency/schema";
import { currencyInitialization } from "../../../../medusa-adapter/src/modules/currency/contract";
import { currencyAnnouncementWrite } from "../../../../medusa-adapter/src/modules/currency/service";
import { makeApplicationAnalysisRepository } from "../../../src/application/applicationAnalysisRegistration";
import { openApplicationRelationQuerySnapshot, readApplicationRelationQueryIncomingSources } from "../../../src/application/applicationQuerySnapshot";
import { createApplicationRelationReadPort } from "../../../src/application/relations/applicationRelationRead";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import { fxAppEdgeAdjacencyVersions, fxAppEdgeCurrent, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions,
  fxAppRowCurrent, fxAppRowRevisions, fxAppUniqueKeys, fxSystemCommitAppRowChanges,
  fxSystemCommitRelationAdjacencyChanges, fxSystemCommits, fxSystemCommitWakes, fxSystemIdempotency,
  fxSystemScopeClocks, fxControlSchemaVersionIndexBindings } from "../../../src/database/schema";
import { fxSystemCommitEvents } from "../../../src/commit/events/schema";
import { fxSystemCommitRelationalChanges } from "../../../src/commit/publication/relationalFactsSchema";
import { makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { fxSystemCommitPayloadPreferenceDeletions } from "../../../src/frameworks/payloadPreferences/factsSchema";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { ensureLogicalStorageDefinitions } from "../../../src/storage/catalog/logicalStorageDefinitions";
import { makeLogicalSchemaAdmission } from "../../../src/storage/catalog/logicalSchemaAdmission";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { closeAppUniqueConstraintSetV1InTransactionEffect, prepareAppUniqueConstraintSetClosureV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { installationBindingReference } from "../../installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "../../support/effectTestRuntime";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { cmsHostFixture } from "../cmsTransaction/cmsHostFixture";
import { installPayloadPreferenceFixture } from "../payloadPreferences/payloadPreferenceFixture";

export const jointRelationCollections = [
  { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
  { slug: "articles", fields: [{ name: "headline", type: "text", required: true, unique: true },
    { name: "author", type: "relationship", relationTo: "authors" }] },
];

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Author the App table, retain the native compiler's complete policy evidence,
 * then analyze the complete loaded schema instead of manufacturing a manifest. */
async function jointApplicationManifest(compiled: CompiledPayloadCollections) {
  const authored = applicationSchemaDefinition({ audit: applicationTableDefinitionWithIndex(
    applicationTableDefinition(applicationObjectValidatorJson({
      name: { fieldType: applicationScalarValidatorJson("string"), optional: false },
    })), "by_name", ["name"]) });
  const audit = authored.tables[0];
  if (audit === undefined) throw new Error("Missing authored audit table");
  const schemaDefinition = { ...compiled.schemaDefinition,
    tables: { ...compiled.schemaDefinition.tables, audit: {
      kind: "table", validator: { isFlarexValidator: true, json: encodeValidatorJsonV1(audit.definition.documentType) },
      indexes: authored.indexes.map(index => ({ name: index.descriptor, fields: index.fields })),
    } },
    writePolicies: { ...compiled.schemaDefinition.writePolicies,
      tables: [...compiled.schemaDefinition.writePolicies.tables, { logicalTableName: "audit", owner: "application" }]
        .toSorted((a, b) => a.logicalTableName < b.logicalTableName ? -1 : a.logicalTableName > b.logicalTableName ? 1 : 0) },
  };
  const schemaSource = `export default ${encodeCanonicalJson(schemaDefinition, () => { throw new Error("Invalid authored fixture schema"); })};\n`;
  const executionSource = "export {};\n";
  const modules = [{ path: "_flarex/execution.js", roles: 8, sourceSha256: digest(executionSource), sourceByteLength: Buffer.byteLength(executionSource) },
    { path: "_flarex/schema.js", roles: 2, sourceSha256: digest(schemaSource), sourceByteLength: Buffer.byteLength(schemaSource) }];
  const analysis = await runEffect(analyzeLoadedApplicationSourcePackageEffect({ executionModules: {}, sourceMaps: {}, schemaDefinition }));
  const result = await runEffect(makeApplicationManifest(analysis, {
    rootSha256: digest(encodeCanonicalJson(modules, () => { throw new Error("Invalid fixture source artifact"); })),
    executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js", modules,
  }));
  const canonical = await runEffect(verifyApplicationManifestV3(result.manifest));
  expect(canonical.manifest.schema.writePolicies.tables.map(table => [table.logicalTableName, table.owner]))
    .toEqual([["articles", "payload"], ["audit", "application"], ["authors", "payload"]]);
  return { manifest: canonical.manifest, manifestSha256: digest(canonical.canonicalBytes) };
}

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

/** Real V3/R02 Application activation plus the same compiler/composer/catalog/
 * admission/build/binding owners used by the native Currency integration. */
export async function jointApplicationRelationsFixture(persistence: Persistence, session: RelationalSession) {
  const compiled = await runEffect(compilePayloadCollections(jointRelationCollections));
  const control = "pool" in persistence ? persistence : await createMigratedPGlitePersistence();
  const { fixture, target, bindings: contentBindings, candidate: contentCandidate, payloadProfiles } = await cmsHostFixture(persistence,
    { controlPersistence: control, cmsManifest: await jointApplicationManifest(compiled) }, compiled);
  const preferences = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId, control);
  const active = await runEffect(fixture.relationActivation.readActive());
  expect(active.basis).toHaveProperty("relationCount", 1);
  const schemaVersionId = decodeCatalogSchemaVersionId("joint-source-application-relations");
  expect(schemaVersionId).not.toBe(fixture.relation.binding.schemaVersionId);
  const prepared = await runEffect(makeSchemaComposer({ deploymentId: fixture.deploymentId,
    authority: fixture.authority, applicationAnalyses: makeApplicationAnalysisRepository(persistence.drizzle),
    medusaModules: ["currency"] })({ applicationCandidateId: fixture.publication.candidateId,
    payloadCollections: jointRelationCollections, payloadViews: [], extensions: [] }));
  const candidate = await runEffect(readPreparedLogicalSchemaCandidate(prepared));
  const application = candidate.sources.find(source => source.key === "application");
  if (application === undefined) throw new Error("Missing actual composed Application source");
  expect(application.definition).toMatchObject({ kind: "documents", tables: [{ logicalName: "audit" }], relations: [] });
  const applicationSource = { sourceKey: application.key, writeProfile: application.writeProfile,
    definition: application.definition, evidence: application.evidence };
  expect(candidate.sources.map(source => source.key).toSorted()).toEqual(["application", "medusa.currency", "payload"]);
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
    "Prepare joint source relation catalog", arrange, cause => new Error("Joint source relation setup", { cause })));
  const ports = { controlDb: control.drizzle, authority: fixture.authorityPorts };
  const input = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, schemaVersionId };
  const indexes = await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, input));
  if (indexes.status !== "reconciled") throw new Error("Missing joint source index requirements");
  const indexDefinitions = [];
  for (const indexDefinitionId of indexes.definitionIds) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(control.drizzle, input.scopeId, indexDefinitionId));
    if (definition === null) throw new Error("Missing joint source index definition");
    indexDefinitions.push(definition);
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
  if (unique.status !== "reconciled") throw new Error("Missing joint source unique closure");
  let enabled = false;
  for (let step = 0; step < (unique.definitionCount + 1) * 4; step++) {
    const result = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...input, pageSize: 16 }));
    if (result.lifecycle === "enabled" && result.uniqueConstraintDefinitionId === null) { enabled = true; break; }
  }
  expect(enabled).toBe(true);
  const bindings = await runEffect(makeDataBindingHost({ database: persistence.drizzle, target,
    selection: { deploymentId: input.deploymentId, scopeId: input.scopeId }, authority: fixture.authorityPorts,
    application: fixture.relationActivation, payloadProfiles,
    logicalStorage: { controlDb: control.drizzle, schemaVersionId, unique: fixture.servingOwners.uniqueConstraintEligibility } }));
  const previous = await runEffect(contentBindings.withCurrent(readAdmittedDataBinding));
  const reference = await runEffect(bindings.readApplicationReference());
  const logicalBinding = await runEffect(bindings.prepare({ ...contentCandidate.frame, application: reference,
    payloadContent: null, logicalSchema: { schemaVersionId,
      manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) } }));
  await runEffect(bindings.activate(dataBindingActivationRequest(input.scopeId, reference.storageGeneration,
    "joint-source-relations-activate", logicalBinding.sha256, previous.head)));
  const currencyDefinition = await runEffect(compileCurrencyDefinition());
  const initialization = await runEffect(currencyInitialization());
  const currency = { ports, unique: fixture.servingOwners.uniqueConstraintEligibility, schemaVersionId,
    source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency", schema: currencyDefinition.schema, evidence: currencyDefinition.provenance },
    initialization: { stepId: initialization.stepId, datasetSha256: initialization.datasetSha256, expectedRowCount: initialization.expectedRowCount } };
  const hostRuntime = preparedHostTestRuntime(persistence.drizzle);
  const currencyHost = await runEffect(makeCommerceHost({ hostRuntime, database: persistence.drizzle, session, target,
    deploymentId: input.deploymentId, scopeId: input.scopeId, authority: fixture.authorityPorts,
    application: fixture.relationActivation, identityAndAccessPolicy: { profile: "joint-source-relations" },
    logicalStorage: currency, commands: [currencyAnnouncementWrite] }));
  try { await runEffect(currencyHost.initialize(initialization.rows)); }
  finally { await runEffect(currencyHost.close); }
  const scopeUuid = projectScopeIdUuidV1(input.scopeId).scopeUuid;
  const db = persistence.drizzle;
  const indexBindings = await control.drizzle.select().from(fxControlSchemaVersionIndexBindings).where(and(
    eq(fxControlSchemaVersionIndexBindings.deploymentId, fixture.deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId)));
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
    relationalFacts: await db.select().from(fxSystemCommitRelationalChanges).where(eq(fxSystemCommitRelationalChanges.scopeUuid, scopeUuid)).orderBy(fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal),
    events: await db.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid)).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal),
    commits: await db.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)).orderBy(fxSystemCommits.commitSeq),
    outcomes: await db.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)).orderBy(fxSystemIdempotency.commitSeq),
    wakes: await db.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scopeUuid)).orderBy(fxSystemCommitWakes.commitSeq),
    clock: await db.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid)),
    preferences: await db.select().from(preferences.table).where(eq(preferences.table.scope, scopeUuid)).orderBy(preferences.table.id),
    preferenceFacts: await db.select().from(fxSystemCommitPayloadPreferenceDeletions).where(eq(fxSystemCommitPayloadPreferenceDeletions.scopeUuid, scopeUuid))
      .orderBy(fxSystemCommitPayloadPreferenceDeletions.commitSeq, fxSystemCommitPayloadPreferenceDeletions.changeOrdinal),
  });
  const incoming = Effect.fn("JointApplicationRelations.incoming")(function* (targetId: string) {
    const current = yield* fixture.relationActivation.readActive();
    const declaration = compiled.logicalDefinition.relations[0];
    if (declaration === undefined) return yield* Effect.die(new Error("Missing actual native relation"));
    return yield* Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationRelationQuerySnapshot(current.selection,
        { source: { table: declaration.source.table, path: declaration.source.path } }, {
          deploymentId: fixture.deploymentId, controlDb: control.drizzle, authority: fixture.authorityPorts,
          relations: createApplicationRelationReadPort(control.drizzle, fixture.pointCommitAuthority, fixture.relationCommit, fixture.fold) });
      return yield* readApplicationRelationQueryIncomingSources(opened.snapshot, decodeAppDocumentIdV1(targetId), 16);
    }));
  });
  // The fixed joint profile admits no preference cleanup. Deletion is checked
  // after a genuine binding transition into the standalone CMS lifecycle.
  const activatePayloadLifecycle = Effect.fn("JointApplicationRelations.activatePayloadLifecycle")(function* () {
    const current = yield* bindings.withCurrent(readAdmittedDataBinding);
    const application = yield* bindings.readApplicationReference();
    const candidate = yield* bindings.prepare({ ...logicalBinding.frame, application,
      payloadLifecycle: { ...installationBindingReference(preferences.availability), profiles: [preferences.profile.profile] } });
    return yield* bindings.activate(dataBindingActivationRequest(input.scopeId, application.storageGeneration,
      "joint-relations-preference-lifecycle", candidate.sha256, current.head));
  });
  return { fixture, compiled, schemaVersionId, control, currency, hostRuntime, session, target,
    applicationSource, inventory, incoming, catalog, indexBindings, indexDefinitions, activatePayloadLifecycle };
}

export const decodeJointAuthor = Schema.decodeUnknownSync(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, name: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]));
export const decodeJointResult = Schema.decodeUnknownSync(Schema.Struct({
  currency: Schema.StructWithRest(Schema.Struct({ code: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]),
  cms: Schema.StructWithRest(Schema.Struct({ id: Schema.String, headline: Schema.String, author: Schema.NullOr(Schema.String) }),
    [Schema.Record(Schema.String, Schema.Json)]), applicationId: Schema.String,
}));
