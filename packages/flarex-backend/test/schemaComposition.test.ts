import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { applicationSchemaDefinition, applicationTableDefinition, applicationTableDefinitionWithIndex } from "@flarex/application-schema-definition/application-schema";
import { applicationObjectValidatorJson } from "@flarex/application-schema-definition/validator-json";
import { makeApplicationManifestV1, ApplicationManifestSchema } from "@flarex/analysis/application-analysis";
import { prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeLogicalSchemaCandidate } from "flarex-protocol/internal/logical-schema-candidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { ScopeIdSchema, ScopeEpochSchema, StorageGenerationFenceSchema, FlarexDbV1StorageGenerationSchema } from "flarex-protocol/storage-authority";
import { makeSchemaComposer } from "../src/schemaComposition";
import { makeApplicationAnalysisRepository } from "../../persistence-postgres/src/applicationAnalysisRegistration";
import { makeLogicalSchemaAdmission } from "../../persistence-postgres/src/logicalSchemaAdmission";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../persistence-postgres/test/frameworkSchemaArtifactAdmissionTestSupport";
import { makePostgresCatalogControlSessionDriver } from "../../persistence-postgres/src/postgresCatalogControlSession";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline, type CatalogControlSessionStarter } from "../../persistence-postgres/src/catalogControlSession";
import { postgresUrl, withTemporaryPostgresPersistence } from "../../persistence-postgres/test/postgresHelpers";
import { insertSessionTestScope, SESSION_TEST_SCOPE_UUID, SESSION_TEST_EPOCH_UUID } from "../../persistence-postgres/test/sessionAuthorityTestSupport";
import { ensureStableTableIdentityEffect } from "../../persistence-postgres/src/stableTableCatalog";
import { deployments, fxControlScopes, fxControlTables } from "../../persistence-postgres/src/schema";
import type { FlarexMetadataDatabase } from "../../persistence-postgres/src/deployments";
import type { FlarexSqlClient } from "../../persistence-postgres/src/index";

const deploymentId = "shared-candidate";
const authority = {
  scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
  epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
  storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
  storageGenerationFence: StorageGenerationFenceSchema.make(1n),
};
const rootSha256 = "a".repeat(64);
const table = { namespace: "app", logicalName: "catalog_pages" } as const;
const productTable = { namespace: "medusa", logicalName: "commerce.product/product" } as const;
const sourceArtifact = {
  rootSha256, executionModulePath: "functions.js", schemaModulePath: "schema.js",
  modules: [
    { path: "functions.js", roles: 8, sourceSha256: "b".repeat(64), sourceByteLength: 18 },
    { path: "schema.js", roles: 2, sourceSha256: "c".repeat(64), sourceByteLength: 18 },
  ],
};

describe("shared schema composition and catalog admission", () => {
  it("persists native outputs, shared views and refusal evidence on PGlite", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
    await witness(persistence, fixture.controlSessionStarter, false);
    expect(fixture.isTransactionActive()).toBe(false);
  });

  it.skipIf(postgresUrl === null)("converges and rejects conflicting candidates on ordinary-role PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const role = await persistence.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
      const session = makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) });
      await witness(persistence, session, true);
    });
  });
});

async function witness(
  persistence: Pick<FlarexSqlClient, "query"> & { readonly drizzle: FlarexMetadataDatabase },
  session: CatalogControlSessionStarter,
  concurrent: boolean,
) {
  await persistence.drizzle.insert(deployments).values({ deploymentId, projectId: "project" });
  await persistence.drizzle.insert(fxControlScopes).values({ scopeId: authority.scopeId, deploymentId,
    isolationKind: "shared_database", physicalLocator: { kind: "shared_database", databaseKey: "test", schemaName: "public" } });
  await insertSessionTestScope(persistence);
  const stable = await Effect.runPromise(ensureStableTableIdentityEffect(persistence.drizzle, { deploymentId, ...table }));
  const schema = applicationSchemaDefinition({ catalog_pages: applicationTableDefinitionWithIndex(
    applicationTableDefinition(applicationObjectValidatorJson(Object.fromEntries(
      ["title", "commerceId", "createdAt", "updatedAt"].map(name => [name, { fieldType: { type: "string" }, optional: false }]),
    ))), "by_title", ["title"],
  ) });
  const manifest = await Effect.runPromise(makeApplicationManifestV1({
    schema: { version: 1, tables: schema.tables.map((table, position) => ({
      tableId: position + 1, name: table.logicalName, validator: table.definition.documentType, placement: { kind: "global" },
    })), indexes: schema.indexes.map((index, position) => ({ indexId: position + 1, tableId: 1, name: index.descriptor, fields: [...index.fields] })) },
    functions: [],
  }, sourceArtifact));
  const analyses = makeApplicationAnalysisRepository(persistence.drizzle);
  const pending = await Effect.runPromise(analyses.begin({ authority, requestKey: "application-source", sourceArtifactRootSha256: rootSha256,
    analyzerIdentity: "test-native-analyzer", analyzerPolicyIdentity: "test-policy" }));
  await Effect.runPromise(analyses.settle(authority, { kind: "analyzed", candidateId: pending.candidateId,
    sourceArtifactRootSha256: rootSha256, analyzerIdentity: "test-native-analyzer", analyzerPolicyIdentity: "test-policy",
    canonicalManifest: manifest.canonicalText }));
  const compose = makeSchemaComposer({ deploymentId, authority, applicationAnalyses: analyses });
  const request = {
    applicationCandidateId: pending.candidateId,
    payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true }] }],
    payloadViews: [{ collections: [{ slug: "cms-view", fields: [
      { name: "title", type: "text", required: true }, { name: "commerceId", type: "text", required: true },
    ] }], bindings: [{ localName: "cms_view", table }] }],
    extensions: [
      { name: "page_product", sourceKey: "application", source: { table, field: "commerceId" }, target: { table: productTable, field: "id" }, onTargetDelete: "restrict" },
      { name: "product_page", sourceKey: "medusa.product", source: { table: productTable, field: "handle" }, target: { table, field: "title" }, onTargetDelete: "restrict" },
    ],
  };
  // A purported producer definition is not accepted as a compilation request.
  expect(await Effect.runPromise(Effect.result(compose({ ...request, medusaSchema: {} })))).toMatchObject({ _tag: "Failure" });
  const prepared = await Effect.runPromise(compose(request));
  const candidate = await Effect.runPromise(readPreparedLogicalSchemaCandidate(prepared));
  const product = candidate.sources.find(source => source.key === "medusa.product");
  expect(product?.definition.kind).toBe("relational");
  if (product?.definition.kind !== "relational") throw new Error("Missing compiled Product definition");
  const productDefinition = product.definition;
  expect(product.definition.schema.tables).toHaveLength(13);
  const pivots = product.definition.schema.tables.filter(table => !table.keys.some(key => key.kind === "primary"));
  expect(pivots).toHaveLength(3);
  expect(pivots.every(table => table.keys.some(key => key.kind === "unique"))).toBe(true);
  expect(product.definition.schema.tables.some(table => table.indexes.some(index => index.predicate?.kind === "isNull"))).toBe(true);
  expect(product.definition.schema.capabilities.some(capability => capability.kind === "softDelete")).toBe(true);
  expect(candidate.applicationAnalysis.sourceArtifactRootSha256).toBe(rootSha256);
  expect(candidate.sources[0]?.definition).toMatchObject({ kind: "documents", indexes: [{ descriptor: "by_title", fields: ["title"] }] });

  const admission = makeLogicalSchemaAdmission({ controlDb: persistence.drizzle, session, deploymentId, scopeId: authority.scopeId });
  const identity = { schemaVersionId: decodeCatalogSchemaVersionId("shared-candidate-one"), version: decodeCatalogSchemaVersion(1) };
  const budget = async () => ({ initialDeadline: await Effect.runPromise(startCatalogControlDeadline("initial", 20_000)),
    lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
  const admit = async () => Effect.runPromise(admission.admit(prepared, identity, await budget()));
  const before = await persistence.query<{ name: string }>("select tablename as name from pg_tables where schemaname = current_schema() order by tablename");
  if (concurrent) {
    const results = await Promise.all([admit(), admit()]);
    expect(results.map(result => result.status).sort()).toEqual(["created", "existing"]);
  } else {
    expect((await admit()).status).toBe("created");
    expect((await admit()).status).toBe("existing");
  }
  const inspect = async () => Effect.runPromise(admission.inspect(identity.schemaVersionId,
    { deadline: await Effect.runPromise(startCatalogControlDeadline("read", 20_000)) }));
  const stored = await inspect();
  expect(stored.candidate).toEqual(candidate);
  expect(stored.tableBindings).toHaveLength(15);
  expect(stored.tableBindings.find(binding => binding.table.logicalName === table.logicalName)?.tableId).toBe(stable.table.tableId);
  expect(stored.tableBindings.some(binding => binding.table.logicalName === "cms_view")).toBe(false);
  expect((await persistence.drizzle.select().from(fxControlTables))).toHaveLength(15);
  expect((await persistence.query("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows).toEqual(before.rows);
  expect(Schema.decodeUnknownResult(ApplicationManifestSchema)(stored.artifact.manifestJson)).toMatchObject({ _tag: "Failure" });

  const otherPrepared = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...candidate, extensions: [] }));
  expect(await Effect.runPromise(Effect.result(admission.admit(otherPrepared, identity, await budget())))).toMatchObject({ _tag: "Failure" });
  expect((await inspect()).candidate).toEqual(candidate);
  const wrongScope = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...candidate, scopeId: "another-scope" }));
  expect(await Effect.runPromise(Effect.result(admission.admit(wrongScope, identity, await budget())))).toMatchObject({ _tag: "Failure", failure: { reason: "wrongTarget" } });
  expect(await Effect.runPromise(Effect.result(readPreparedLogicalSchemaCandidate({ ...prepared })))).toMatchObject({ _tag: "Failure", failure: { reason: "unpreparedCandidate" } });
  expect(await Effect.runPromise(Effect.result(prepareLogicalSchemaCandidate({ ...candidate,
    sources: candidate.sources.map(source => source.key === "medusa.product" ? { ...source, sourceSha256: "0".repeat(64) } : source),
  })))).toMatchObject({ _tag: "Failure", failure: { reason: "digestMismatch" } });
  expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, sources: [...candidate.sources, { ...product, key: "competing-owner" }] }))).toBe(true);
  expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, sources: candidate.sources.map(source => source.key === product.key
    ? { ...source, definition: { ...productDefinition, schema: { ...productDefinition.schema, tables: productDefinition.schema.tables.slice(1) } } } : source) }))).toBe(true);
  expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, extensions: [{ ...candidate.extensions[0], sourceKey: "payload" }] }))).toBe(true);
  expect(Result.isFailure(decodeLogicalSchemaCandidate({ ...candidate, extensions: [{ ...candidate.extensions[0], target: { table: { ...table, logicalName: "missing" }, field: "title" } }] }))).toBe(true);
  expect(await Effect.runPromise(Effect.result(compose({ ...request, payloadViews: [{ ...request.payloadViews[0],
    collections: [{ slug: "cms-view", fields: [{ name: "title", type: "number", required: true }] }],
  }] })))).toMatchObject({ _tag: "Failure" });

  // Corrupt only the JSON copy; the shared artifact reader checks bytes/digest.
  await persistence.query("update fx_control_schema_version set manifest_json = $1::jsonb where schema_version_id = $2",
    [JSON.stringify({ changed: true }), identity.schemaVersionId]);
  await expect(inspect()).rejects.toBeDefined();
}
