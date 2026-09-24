import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { applicationSchemaDefinition, applicationTableDefinition, applicationTableDefinitionWithIndex } from "@flarex/application-schema-definition/application-schema";
import { applicationObjectValidatorJson } from "@flarex/application-schema-definition/validator-json";
import { makeApplicationManifestV1, ApplicationManifestSchema } from "@flarex/analysis/application-analysis";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate, readPreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { decodeLogicalSchemaCandidate } from "flarex-protocol/internal/logical-schema-candidate";
import { canonicalizeSchemaManifestV1, decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
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
import { deployments, fxControlScopes, fxControlTables, fxControlSchemaVersions, fxControlIndexDefinitions, fxControlUniqueConstraintDefinitions } from "../../persistence-postgres/src/schema";
import type { FlarexMetadataDatabase } from "../../persistence-postgres/src/deployments";
import type { FlarexSqlClient } from "../../persistence-postgres/src/index";
import { readPreviouslyApplicationWritableTables } from "../../persistence-postgres/src/applicationWriteOwnership/History";
import { ApplicationWriteOwnershipHistoryBudget } from "../../persistence-postgres/src/applicationWriteOwnership/Policy";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { publishApplicationRelationBindingEffect } from "../../persistence-postgres/src/applicationRelationBinding";
import { policyManifestFixture } from "../../persistence-postgres/test/applicationWritePolicyFixture";
import { currencyCatalogWitness } from "../../persistence-postgres/test/currencyCatalogPreparationScenario";
import { readSchemaVersionTableBindings } from "../../persistence-postgres/src/schemaVersionTableBindings";
import { relationalPartialIndexScenario } from "../../persistence-postgres/test/relationalPartialIndexScenario";
import { currencyInitialization } from "../../medusa-adapter/src/currency-contract";
import { relationalValueAdmissionScenario } from "../../persistence-postgres/test/relationalValueAdmissionScenario";
import { ensureLogicalStorageDefinitions } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { productForeignKeyScenario } from "../../persistence-postgres/test/productForeignKeyScenario";

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
  it("persists native outputs, shared views and Product definitions on PGlite", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence);
    await witness(persistence, fixture.controlSessionStarter, false, "created", null, true);
    expect(fixture.isTransactionActive()).toBe(false);
  });

  it("retains uncertainty when quarantine fails after COMMIT", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence, {
      uncertainAfterCommit: { initialSettlementCause: new Error("lost acknowledgement"), quarantineCause: new Error("quarantined") },
    });
    await expect(witness(persistence, fixture.controlSessionStarter, false)).rejects.toMatchObject({
      _tag: "CatalogControlSessionDecisionUncertainIssue", stage: "settle",
    });
    expect(fixture.events).toContain("initial:quarantine");
    expect(fixture.isTransactionActive()).toBe(false);
  });

  it.skipIf(postgresUrl === null)("converges and rejects conflicting candidates on ordinary-role PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const role = await persistence.query<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>(
        "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user");
      expect(role.rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
      const session = makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) });
      await witness(persistence, session, true, "created", null, true);
    });
  });

  it.skipIf(postgresUrl === null)("recovers committed candidates without allocating another identity on PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      let injected = false;
      const session = makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool, { lifecycleFault: ({ phase, edge }) => {
          if (!injected && phase === "commit" && edge === "after") {
            injected = true;
            throw new Error("COMMIT acknowledgement lost");
          }
        } }) });
      await witness(persistence, session, false, "existing");
      expect(injected).toBe(true);
    });
  });

  it("keeps candidate history separate from serving history and refuses the 65th artifact on PGlite", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await witness(persistence, makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).controlSessionStarter, false, "created", "records");
  });

  it.skipIf(postgresUrl === null)("preserves history budget boundaries on PostgreSQL", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const session = makeCatalogControlSessionStarter({ controlDb: persistence.drizzle,
        driver: makePostgresCatalogControlSessionDriver(persistence.pool) });
      await witness(persistence, session, false, "created", "records");
    });
  });

  it("refuses a candidate whose resulting history exceeds the byte ceiling", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await witness(persistence, makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).controlSessionStarter, false, "created", "bytes");
  });
});

async function witness(
  persistence: Pick<FlarexSqlClient, "query"> & { readonly drizzle: FlarexMetadataDatabase },
  session: CatalogControlSessionStarter,
  concurrent: boolean,
  initialStatus: "created" | "existing" = "created",
  historyLimits: "records" | "bytes" | null = null,
  proveForeignKeys = false,
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
  const medusaModules = ["product", "currency"] as const;
  const compose = makeSchemaComposer({ deploymentId, authority, applicationAnalyses: analyses, medusaModules });
  const request = {
    applicationCandidateId: pending.candidateId,
    payloadCollections: [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }],
    payloadViews: [{ collections: [{ slug: "cms-view", fields: [
      { name: "title", type: "text", required: true }, { name: "commerceId", type: "text", required: true },
    ] }], bindings: [{ localName: "cms_view", table }] }],
    extensions: [
      { name: "page_product", sourceKey: "application", source: { table, field: "commerceId" }, target: { table: productTable, field: "id" }, policy: "strongReference", onTargetDelete: "restrict" },
      { name: "product_page", sourceKey: "medusa.product", source: { table: productTable, field: "handle" }, target: { table, field: "title" }, policy: "strongReference", onTargetDelete: "restrict" },
    ],
  };
  const linkWithoutEndpoints = makeSchemaComposer({ deploymentId, authority, applicationAnalyses: analyses,
    medusaModules: ["variantPricingLink"] });
  expect(await Effect.runPromise(Effect.result(linkWithoutEndpoints({ ...request, extensions: [] })))).toMatchObject({
    _tag: "Failure", failure: { reason: "missingModuleDependency" },
  });
  const linkWithoutPricing = makeSchemaComposer({ deploymentId, authority, applicationAnalyses: analyses,
    medusaModules: ["product", "variantPricingLink"] });
  expect(await Effect.runPromise(Effect.result(linkWithoutPricing({ ...request, extensions: [] })))).toMatchObject({
    _tag: "Failure", failure: { reason: "missingModuleDependency" },
  });
  // A purported producer definition is not accepted as a compilation request.
  expect(await Effect.runPromise(Effect.result(compose({ ...request, medusaSchema: {} })))).toMatchObject({ _tag: "Failure" });
  const prepared = await Effect.runPromise(compose(request));
  const partitioned = await Effect.runPromise(makeApplicationManifestV1({
    schema: { ...manifest.manifest.schema, tables: manifest.manifest.schema.tables.map(table => ({ ...table, placement: { kind: "partitionBy", field: "_id" } })) },
    functions: [],
  }, sourceArtifact));
  const placementPending = await Effect.runPromise(analyses.begin({ authority, requestKey: "partitioned-source", sourceArtifactRootSha256: rootSha256,
    analyzerIdentity: "test-native-analyzer", analyzerPolicyIdentity: "test-policy" }));
  await Effect.runPromise(analyses.settle(authority, { kind: "analyzed", candidateId: placementPending.candidateId,
    sourceArtifactRootSha256: rootSha256, analyzerIdentity: "test-native-analyzer", analyzerPolicyIdentity: "test-policy",
    canonicalManifest: partitioned.canonicalText }));
  expect(await Effect.runPromise(Effect.result(compose({ ...request, applicationCandidateId: placementPending.candidateId })))).toMatchObject({
    _tag: "Failure", failure: { reason: "unsupportedPlacement" },
  });
  const candidate = await Effect.runPromise(readPreparedLogicalSchemaCandidate(prepared));
  const mutableConfig = { deploymentId, authority: { ...authority }, applicationAnalyses: analyses, medusaModules };
  mutableConfig.applicationAnalyses = { ...analyses, inspect: (scope, id) => analyses.inspect(scope, id).pipe(Effect.tap(() => Effect.sync(() => {
    mutableConfig.deploymentId = "mutated-deployment";
    mutableConfig.authority.scopeId = ScopeIdSchema.make("mutated-scope");
  }))) };
  const capturedComposer = makeSchemaComposer(mutableConfig);
  const captured = await Effect.runPromise(capturedComposer(request).pipe(Effect.flatMap(readPreparedLogicalSchemaCandidate)));
  expect(captured).toEqual(candidate);
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
  const currency = candidate.sources.find(source => source.key === "medusa.currency");
  expect(currency?.definition).toMatchObject({ kind: "relational", schema: { coordinate: { lineageId: "commerce.currency" },
    tables: [{ identity: { tableId: "currency" }, keys: [{ kind: "primary", columns: [{ columnId: "code" }] }] }] } });
  expect(candidate.applicationAnalysis.sourceArtifactRootSha256).toBe(rootSha256);
  expect(candidate.sources[0]?.definition).toMatchObject({ kind: "documents", indexes: [{ descriptor: "by_title", fields: ["title"] }] });
  expect(candidate.sources.find(source => source.key === "payload")?.definition).toMatchObject({
    kind: "documents", uniqueConstraints: [{ tableLogicalName: "news", fields: ["title"], nullsDistinct: false, sparse: false }],
  });

  const admission = makeLogicalSchemaAdmission({ controlDb: persistence.drizzle, session, deploymentId, scopeId: authority.scopeId });
  const identity = { schemaVersionId: decodeCatalogSchemaVersionId("shared-candidate-one"), version: decodeCatalogSchemaVersion(1) };
  const budget = async () => ({ initialDeadline: await Effect.runPromise(startCatalogControlDeadline("initial", 20_000)),
    lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000 });
  const admit = async () => Effect.runPromise(admission.admit(prepared, identity, await budget()));
  const pollutedIdentity = { ...identity, deploymentId: "other-deployment" };
  expect(await Effect.runPromise(Effect.result(admission.admit(prepared, pollutedIdentity, await budget())))).toMatchObject({
    _tag: "Failure", failure: { reason: "invalidIdentity" },
  });
  const before = await persistence.query<{ name: string }>("select tablename as name from pg_tables where schemaname = current_schema() order by tablename");
  if (concurrent) {
    const results = await Promise.all([admit(), admit()]);
    expect(results.map(result => result.status).sort()).toEqual(["created", "existing"]);
  } else {
    expect((await admit()).status).toBe(initialStatus);
    expect((await admit()).status).toBe("existing");
  }
  const inspect = async () => Effect.runPromise(admission.inspect(identity.schemaVersionId,
    { deadline: await Effect.runPromise(startCatalogControlDeadline("read", 20_000)) }));
  const stored = await inspect();
  expect(stored.candidate).toEqual(candidate);
  expect(stored.tableBindings).toHaveLength(16);
  expect(stored.tableBindings.find(binding => binding.table.logicalName === table.logicalName)?.tableId).toBe(stable.table.tableId);
  expect(stored.tableBindings.some(binding => binding.table.logicalName === "cms_view")).toBe(false);
  expect((await persistence.drizzle.select().from(fxControlTables))).toHaveLength(16);
  expect((await persistence.query("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows).toEqual(before.rows);
  expect(Schema.decodeUnknownResult(ApplicationManifestSchema)(stored.artifact.manifestJson)).toMatchObject({ _tag: "Failure" });
  if (historyLimits === null) {
    const currencyTable = stored.tableBindings.find(binding => binding.table.logicalName === "commerce.currency/currency");
    if (currencyTable === undefined) throw new Error("Missing native Currency binding");
    // A separately configured Currency candidate has its own complete artifact.
    // This does not activate or partially reinterpret the Product candidate.
    const currencyComposer = makeSchemaComposer({ deploymentId, authority, applicationAnalyses: analyses, medusaModules: ["currency"] });
    const currencyCandidate = await Effect.runPromise(currencyComposer({ ...request, extensions: [] }));
    const currencyIdentity = { schemaVersionId: decodeCatalogSchemaVersionId("currency-candidate"), version: decodeCatalogSchemaVersion(4) };
    await Effect.runPromise(admission.admit(currencyCandidate, currencyIdentity, await budget()));
    const activeIndex = await Effect.runPromise(currencyCatalogWitness(persistence, deploymentId, currencyIdentity.schemaVersionId, currencyTable.tableId, concurrent));
    const seed = await Effect.runPromise(currencyInitialization());
    await Effect.runPromise(relationalPartialIndexScenario(persistence.drizzle, deploymentId, authority.scopeId,
      currencyIdentity.schemaVersionId, activeIndex, seed.rows));
    await Effect.runPromise(relationalValueAdmissionScenario(persistence.drizzle, deploymentId, currencyIdentity.schemaVersionId));
    expect((await persistence.query("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows).toEqual(before.rows);
    // The Currency-only fixture has now exercised first installation. The
    // complete Product/Currency candidate can reuse that shared Currency
    // identity and install all 13 Product tables' definitions without DDL.
    const definitions = await Effect.runPromise(runEffectTransaction(callback => persistence.drizzle.transaction(callback),
      "Install shared candidate definitions", (tx: FlarexMetadataTransaction) =>
        ensureLogicalStorageDefinitions(tx, deploymentId, identity.schemaVersionId),
      cause => new Error("Candidate definition transaction failed", { cause })));
    const productTableIds = new Set(stored.tableBindings.filter(binding =>
      binding.table.namespace === "medusa" && binding.table.logicalName.startsWith("commerce.product/"))
      .map(binding => binding.tableId));
    expect(productTableIds.size).toBe(13);
    expect(definitions.requirements.ordered.filter(index => productTableIds.has(index.tableId))).toHaveLength(59);
    expect(definitions.requirements.unique.filter(unique => productTableIds.has(unique.tableId))).toHaveLength(24);
    if (proveForeignKeys) await Effect.runPromise(productForeignKeyScenario(persistence.drizzle, deploymentId,
      authority.scopeId, identity.schemaVersionId, productDefinition.schema,
      stored.tableBindings.filter(binding => binding.table.namespace === "medusa" &&
        binding.table.logicalName.startsWith("commerce.product/")).map(binding => ({
        localName: binding.table.logicalName.slice("commerce.product/".length), tableId: binding.tableId,
      }))));
    expect((await persistence.drizzle.select().from(fxControlIndexDefinitions)).length).toBeGreaterThan(59);
    expect((await persistence.drizzle.select().from(fxControlUniqueConstraintDefinitions)).length).toBeGreaterThanOrEqual(24);
    expect((await persistence.query("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(before.rows);
    const forgedSource = { ...stored.artifact.manifestJson, candidate: { ...candidate,
      sources: candidate.sources.map(source => source.key === "medusa.currency" ? { ...source, sourceSha256: "0".repeat(64) } : source) } };
    expect(await Effect.runPromise(Effect.result(readSchemaVersionTableBindings(forgedSource, deploymentId)))).toMatchObject({
      _tag: "Failure", failure: { _tag: "SchemaVersionTableBindingsError" },
    });
  }

  const takeoverSources = [];
  for (const { sourceSha256: _digest, ...source } of candidate.sources.filter(source => !source.bindings.some(binding => binding.kind === "view"))) {
    takeoverSources.push(await Effect.runPromise(captureLogicalSchemaSource(source.key === "application"
      ? { ...source, owner: "payload", writeProfile: "payload.scalar" } : source)));
  }
  const takeover = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...candidate, sources: takeoverSources }));
  expect(await Effect.runPromise(Effect.result(admission.admit(takeover,
    { schemaVersionId: decodeCatalogSchemaVersionId("takeover"), version: decodeCatalogSchemaVersion(2) }, await budget())))).toMatchObject({
    _tag: "Failure", failure: { reason: "ownershipChanged" },
  });
  // A candidate does not become prior Application write authority just because
  // it shares the immutable schema-artifact catalog.
  const readWritable = () => Effect.runPromise(runEffectTransaction(
    callback => persistence.drizzle.transaction(callback, { isolationLevel: "repeatable read" }),
    "Read candidate-only history", (tx: FlarexMetadataTransaction) => readPreviouslyApplicationWritableTables(tx, tx, {
      scopeId: authority.scopeId, deploymentId, revisionId: "future", schemaVersionId: decodeCatalogSchemaVersionId("future"),
    }, new ApplicationWriteOwnershipHistoryBudget()), cause => new Error("History read failed", { cause }),
  ));
  expect([...await readWritable()]).toEqual([]);

  const otherPrepared = await Effect.runPromise(prepareLogicalSchemaCandidate({ ...candidate, extensions: [] }));
  if (concurrent) {
    const raceIdentity = { schemaVersionId: decodeCatalogSchemaVersionId("conflicting-race"), version: decodeCatalogSchemaVersion(3) };
    const results = await Promise.all([prepared, otherPrepared].map(async input => Effect.runPromise(
      Effect.result(admission.admit(input, raceIdentity, await budget())),
    )));
    expect(results.filter(Result.isSuccess)).toHaveLength(1);
    expect(results.filter(Result.isFailure)).toHaveLength(1);
  }
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

  if (historyLimits === "bytes") {
    const paddedCandidate = async (bytes: number) => {
      const sources = [];
      for (const { sourceSha256: _digest, ...source } of candidate.sources) {
        sources.push(await Effect.runPromise(captureLogicalSchemaSource(source.key === "application"
          ? { ...source, evidence: { padding: "x".repeat(bytes) } } : source)));
      }
      return { ...candidate, sources };
    };
    const large = await Effect.runPromise(prepareLogicalSchemaCandidate(await paddedCandidate(3_000_000)));
    const largeIdentity = { schemaVersionId: decodeCatalogSchemaVersionId("large"), version: decodeCatalogSchemaVersion(10) };
    await Effect.runPromise(admission.admit(large, largeIdentity, await budget()));
    const largeStored = await Effect.runPromise(admission.inspect(largeIdentity.schemaVersionId,
      { deadline: await Effect.runPromise(startCatalogControlDeadline("read", 20_000)) }));
    await persistence.drizzle.insert(fxControlSchemaVersions).values(Array.from({ length: 4 }, (_, position) => ({
      ...largeStored.artifact, schemaVersionId: decodeCatalogSchemaVersionId(`large-retained-${position}`), version: decodeCatalogSchemaVersion(position + 11),
    })));
    expect([...await readWritable()]).toEqual([]);
    expect(await Effect.runPromise(Effect.result(admission.admit(large,
      { schemaVersionId: decodeCatalogSchemaVersionId("large-over-limit"), version: decodeCatalogSchemaVersion(1000) }, await budget())))).toMatchObject({
      _tag: "Failure", failure: { reason: "historyLimit" },
    });
    expect(await persistence.drizzle.select().from(fxControlSchemaVersions)).toHaveLength(6);
    const emptyPadding = await paddedCandidate(0);
    const emptyFrame = await canonicalizeSchemaManifestV1({ kind: "logicalSchemaAdmission", definitionVersion: 1,
      candidate: emptyPadding, tableBindings: stored.tableBindings });
    const exactPadding = 16_777_216 - stored.artifact.manifestBytes.byteLength - 5 * largeStored.artifact.manifestBytes.byteLength
      - emptyFrame.canonicalBytes.byteLength;
    expect(exactPadding).toBeGreaterThan(0);
    const plusOne = await Effect.runPromise(prepareLogicalSchemaCandidate(await paddedCandidate(exactPadding + 1)));
    const exactIdentity = { schemaVersionId: decodeCatalogSchemaVersionId("exact-byte-limit"), version: decodeCatalogSchemaVersion(1001) };
    expect(await Effect.runPromise(Effect.result(admission.admit(plusOne, exactIdentity, await budget())))).toMatchObject({
      _tag: "Failure", failure: { reason: "historyLimit" },
    });
    expect(await persistence.drizzle.select().from(fxControlSchemaVersions)).toHaveLength(6);
    const exact = await Effect.runPromise(prepareLogicalSchemaCandidate(await paddedCandidate(exactPadding)));
    expect((await Effect.runPromise(admission.admit(exact, exactIdentity, await budget()))).status).toBe("created");
    const retained = await persistence.drizzle.select().from(fxControlSchemaVersions);
    expect(retained.reduce((sum, artifact) => sum + artifact.manifestBytes.byteLength, 0)).toBe(16_777_216);
    expect([...await readWritable()]).toEqual([]);
    return;
  }
  if (historyLimits === "records") {
    // Copy canonical admitted evidence to construct retained catalog history;
    // all identity allocation, boundary admission and history reads use real owners.
    await persistence.drizzle.insert(fxControlSchemaVersions).values(Array.from({ length: 62 }, (_, position) => ({
      ...stored.artifact, schemaVersionId: decodeCatalogSchemaVersionId(`retained-${position}`), version: decodeCatalogSchemaVersion(position + 10),
    })));
    expect(stored.artifact.manifestBytes.byteLength * 63).toBeGreaterThan(1_048_576);
    expect([...await readWritable()]).toEqual([]);
    const lastIdentity = { schemaVersionId: decodeCatalogSchemaVersionId("last-admitted"), version: decodeCatalogSchemaVersion(1000) };
    expect((await Effect.runPromise(admission.admit(prepared, lastIdentity, await budget()))).status).toBe("created");
    expect(await Effect.runPromise(Effect.result(admission.admit(prepared,
      { schemaVersionId: decodeCatalogSchemaVersionId("over-limit"), version: decodeCatalogSchemaVersion(1001) }, await budget())))).toMatchObject({
      _tag: "Failure", failure: { reason: "historyLimit" },
    });
    expect(await persistence.drizzle.select().from(fxControlSchemaVersions)).toHaveLength(64);
    expect((await admit()).status).toBe("existing");
    expect([...await readWritable()]).toEqual([]);
    return;
  }

  // Authenticate the current V3 binding through its real publisher. The new
  // candidate path refuses this baseline until a connected ownership cutover.
  await Effect.runPromise(publishApplicationRelationBindingEffect({ db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run) }, { ...await policyManifestFixture(), deploymentId, decisions: [] }));
  expect(await Effect.runPromise(Effect.result(admission.admit(prepared,
    { schemaVersionId: decodeCatalogSchemaVersionId("after-v3"), version: decodeCatalogSchemaVersion(100) }, await budget())))).toMatchObject({
    _tag: "Failure", failure: { reason: "unsupportedOwnershipBaseline" },
  });
  expect((await admit()).status).toBe("existing");

  // Corrupt only the JSON copy; the shared artifact reader checks bytes/digest.
  await persistence.query("update fx_control_schema_version set manifest_json = $1::jsonb where schema_version_id = $2",
    [JSON.stringify({ changed: true }), identity.schemaVersionId]);
  await expect(inspect()).rejects.toBeDefined();
}
