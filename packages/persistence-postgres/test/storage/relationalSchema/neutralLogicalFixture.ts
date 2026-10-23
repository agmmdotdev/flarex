import { Effect } from "effect";
import type { LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result } from "flarex-protocol/schema-manifest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { createApplicationNativeMutationPGliteFixtureWithPersistence, createApplicationNativeMutationPostgresFixture } from "../../application/applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { makeApplicationAnalysisRepository } from "../../../src/application/applicationAnalysisRegistration";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../src/database/postgresCatalogControlSession";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { makeLogicalSchemaAdmission } from "../../../src/storage/catalog/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../../../src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { runEffectTransaction } from "../../../src/database/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import type { LogicalCommerceHostInput } from "../../../src/frameworks/commerceTransaction/host";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";

interface NeutralLogicalFixture {
  readonly application: Pick<ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>,
    "authority" | "authorityPorts" | "activation" | "deploymentId" | "active" | "uniqueConstraintEligibility">;
  readonly control: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly catalog: Effect.Success<ReturnType<typeof ensureLogicalStorageDefinitions>>;
  readonly hostInput: Omit<LogicalCommerceHostInput<unknown>, "logicalStorage" | "commands" | "identityAndAccessPolicy" | "logicalResources"> & {
    readonly logicalStorage: Pick<LogicalCommerceSelectionInput, "ports" | "unique" | "schemaVersionId">;
  };
}

/** Neutral conformance consumers share only actual fixture setup and the
 * existing production admission/build/binding owners. No framework adapter or
 * replacement storage, validation or publication implementation is involved. */
export async function prepareNeutralLogicalFixture(driver: "pglite" | "postgres", close: (cleanup: () => Promise<void>) => void,
  input: Readonly<{ name: "neutral-null-implication" | "neutral-real" | "neutral-non-null" | "neutral-serial" | "neutral-timestamp"; sources: readonly LogicalSchemaSource[]; finiteCapture?: true;
    /** Test-only row-revision arrangement. The normal owners still reconcile,
     * backfill, validate and bind every index after this callback finishes. */
    beforeIndexBuild?: (fixture: Pick<NeutralLogicalFixture, "application" | "persistence" | "schemaVersionId" | "catalog">) => Promise<void>;
  }>): Promise<NeutralLogicalFixture> {
  const pair = driver === "postgres" ? await (async () => {
    const control = await createFileScopedPostgresFixture(); close(control.dispose);
    const target = await createFileScopedPostgresFixture({}, { immutableCatalog: control.persistence.drizzle }, input.finiteCapture === true ? "finiteCapture" : "ordinary"); close(target.dispose);
    const schemaName = (await target.persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
    if (schemaName === undefined) throw new Error("Missing neutral target schema");
    return { control: control.persistence, target: target.persistence, session: makePostgresRelationalSession(target.persistence),
      controlSession: makeCatalogControlSessionStarter({ controlDb: control.persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(control.persistence.pool) }),
      application: await createApplicationNativeMutationPostgresFixture({ runtimeHostIdentity: "flarex.test/" + input.name, compatibilityDate: "2026-10-22",
        physicalLocator: { kind: "database_per_scope", databaseKey: "neutral_relational_target", schemaName } }, { control: control.persistence, target: target.persistence }) };
  })() : await (async () => {
    const control = await createMigratedPGlitePersistence(close), target = await createRelationalPGliteFixture({ registerCleanup: close, immutableCatalog: control.drizzle, transport: input.finiteCapture === true ? "finiteCapture" : "ordinary" });
    return { control, target: target.persistence, session: target.session,
      controlSession: makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter,
      application: await createApplicationNativeMutationPGliteFixtureWithPersistence({ runtimeHostIdentity: "flarex.test/" + input.name, compatibilityDate: "2026-10-22" },
        { control, target: target.persistence }) };
  })();
  const { control, target, application, session, controlSession } = pair;
  return Effect.runPromise(Effect.gen(function* () {
    const analysis = yield* makeApplicationAnalysisRepository(target.drizzle).inspect(application.authority, application.active.basis.candidateId);
    if (analysis.status !== "analyzed" || analysis.manifest.version === 3) throw new Error("Missing plain authenticated Application fixture metadata");
    const manifest = analysis.manifest;
    const tables = yield* Effect.fromResult(decodeSchemaManifestAppTableDeclarationsV1Result(manifest.schema.tables.map(table => ({ logicalName: table.name,
      definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator } }))));
    const indexes = yield* Effect.fromResult(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes.map(index => ({
      tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)?.name, descriptor: index.name, fields: index.fields,
      ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }) }))));
    const applicationSource = yield* captureLogicalSchemaSource({ key: "application", owner: "application", writeProfile: "application.occ",
      evidence: { sourceArtifact: manifest.sourceArtifact, manifestSha256: analysis.manifestSha256 },
      definition: { kind: "documents", tables, indexes, uniqueConstraints: [], relations: manifest.version === 2 ? manifest.schema.relations.map(relation => relation.declaration) : [] },
      bindings: tables.map(table => ({ kind: "definition", localName: table.logicalName, table: { namespace: "app", logicalName: table.logicalName } })) });
    const sources = input.sources;
    const prepared = yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
      deploymentId: application.deploymentId, scopeId: application.authority.scopeId,
      applicationAnalysis: { candidateId: analysis.candidateId, analysisId: analysis.analysisId, manifestSha256: analysis.manifestSha256,
        sourceArtifactRootSha256: analysis.sourceArtifactRootSha256 }, sources: [applicationSource, ...sources], extensions: [] });
    const schemaVersionId = decodeCatalogSchemaVersionId(input.name);
    yield* makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession, deploymentId: application.deploymentId,
      scopeId: application.authority.scopeId }).admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
      initialDeadline: yield* startCatalogControlDeadline("initial", 20_000), lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
    const arrangeCatalog = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const definitions = yield* ensureLogicalStorageDefinitions(tx, application.deploymentId, schemaVersionId);
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle, { deploymentId: application.deploymentId, schemaVersionId }, tx);
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure); return definitions;
    });
    const catalog = yield* runEffectTransaction<Effect.Success<ReturnType<typeof arrangeCatalog>>,
      Effect.Error<ReturnType<typeof arrangeCatalog>>, Error, FlarexMetadataTransaction>(callback => control.drizzle.transaction(callback),
      "Arrange neutral null catalog", arrangeCatalog, cause => new Error("Neutral null catalog transaction", { cause }));
    if (input.beforeIndexBuild !== undefined) {
      const beforeIndexBuild = input.beforeIndexBuild;
      yield* Effect.tryPromise({ try: () => beforeIndexBuild({ application, persistence: target, schemaVersionId, catalog }),
        catch: cause => new Error("Arrange neutral pre-build row revisions", { cause }) });
    }
    const ports = { controlDb: control.drizzle, authority: application.authorityPorts }, buildInput = { deploymentId: application.deploymentId,
      scopeId: application.authority.scopeId, schemaVersionId };
    const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, buildInput);
    if (reconciled.status !== "reconciled") throw new Error("Incomplete neutral index requirements");
    for (const indexDefinitionId of reconciled.definitionIds) {
      const definition = yield* locateAppIndexDefinitionByIdEffect(control.drizzle, application.authority.scopeId, indexDefinitionId);
      if (definition === null) throw new Error("Missing neutral index definition");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const input = { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, indexDefinitionId, pageSize: 10 };
        const state = definition.access.kind === "by_creation_time" ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, input)
          : yield* buildAppDeveloperOrderedIndexV1Effect(ports, input);
        if (state.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("Neutral index did not become enabled");
    }
    const unique = yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports, buildInput);
    if (unique.status !== "reconciled") throw new Error("Incomplete neutral uniqueness requirements");
    let uniqueEnabled = false;
    for (let step = 0; step < (unique.definitionCount + 1) * 4; step++) {
      const state = yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...buildInput, pageSize: 10 });
      if (state.lifecycle === "enabled" && state.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("Neutral uniqueness did not become enabled");
    const bindingTarget = yield* makeFrameworkSchemaTarget({ database: target.drizzle, deploymentId: application.deploymentId,
      canonicalPhysicalDatabaseIdentity: "neutral-relational-target", physicalLocator: application.active.basis.authority.physicalLocator });
    const bindings = yield* makeDataBindingHost({ database: target.drizzle, target: bindingTarget,
      selection: { deploymentId: application.deploymentId, scopeId: application.authority.scopeId }, authority: application.authorityPorts,
      application: application.activation, logicalStorage: { controlDb: control.drizzle, schemaVersionId, unique: application.uniqueConstraintEligibility } });
    const reference = yield* bindings.readApplicationReference();
    const candidate = yield* bindings.prepare({ format: "flarex.data-binding-set", application: reference,
      logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] });
    yield* bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration, "neutral-relational-activate", candidate.sha256, null));
    return { application, control, schemaVersionId, persistence: target, catalog, hostInput: { hostRuntime: preparedHostTestRuntime(target.drizzle), database: target.drizzle,
      session, target: bindingTarget, deploymentId: application.deploymentId, scopeId: application.authority.scopeId,
      authority: application.authorityPorts, application: application.activation,
      logicalStorage: { ports, unique: application.uniqueConstraintEligibility, schemaVersionId } } };
  }));
}
