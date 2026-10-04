import { eq } from "drizzle-orm";
import { Effect, Option, Result, Schema, Tracer } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "../../analysis/src/logicalSchemaCandidate";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, SchemaManifestAppIndexDeclarationV1Schema } from "flarex-protocol/schema-manifest";
import type { LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { expect, it, vi } from "vitest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { logicalCurrencyFixture } from "../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalSourceEvidence } from "../src/logicalDocuments/sourceAdmission";
import { prepareLogicalStorageReadiness } from "../src/logicalStorageReadiness";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { makeLogicalSchemaAdmission } from "../src/logicalSchemaAdmission";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { ensureLogicalStorageDefinitions } from "../src/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../src/appUniqueConstraintSetClosureV1";
import { loadPublishedPhysicalRequirementSnapshotV1, reconcilePublishedIndexBuildsV1Effect } from "../src/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../src/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../src/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../src/appUniqueConstraintSetBuildV1";
import { makeDataBindingHost, dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../src/frameworkSchema/binding/repository";
import { captureFiniteMetadataDependency, finiteMetadataTableKey, validateConsumedMetadataDependencies } from "../src/finiteMetadataDependencies";
import { fxSystemScopeClocks } from "../src/schema";
import { postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

async function verifyCurrentBindingClosure(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
    const deploymentId = Schema.decodeUnknownSync(TransactionGrantDeploymentIdV1Schema)(fixture.deploymentId);
    const scopeId = decodeReplacementScopeIdV1(fixture.application.authority.scopeId);
    const active = await runEffect(fixture.application.activation.readActive());
    expect(active.basis.schemaVersionId).not.toBe(fixture.schemaVersionId);
    const logical = fixture.hostInput.logicalStorage;
    const location = { deploymentId, scopeId, schemaVersionId: fixture.schemaVersionId };
    const catalog = await runEffect(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
    if (catalog.status !== "prepared") throw new Error("Expected genuine binding catalog");
    const currency = await runEffect(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
      { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
        definition: { kind: "relational", schema: fixture.currencyDefinition.schema },
        evidence: fixture.currencyDefinition.provenance }, "medusa", "relational", { kind: "prepared", catalog }));
    const resolved = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(deploymentId, fixture.application.authorityPorts));
    const spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    // The Promise-owned control transaction starts its own Effect runtime, so
    // its catalog spans do not inherit this tracer. Observe the real control
    // transaction without replacing its implementation or catalog work.
    const controlTransactions = vi.spyOn(logical.ports.controlDb, "transaction");
    cleanup.push(async () => { controlTransactions.mockRestore(); });
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* currency.readFiniteCommitClosure(tx, resolved.authority, clock, []);
      expect(current).toEqual({ indexes: [], unique: [] });
      expect(currency.indexes.length).toBeGreaterThan(0);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("LogicalSourceAdmission.readFiniteCommitClosure");
    expect(spans).not.toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).not.toHaveBeenCalled();
    spans.length = 0;
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* currency.readFiniteCommitClosure(tx, resolved.authority, clock,
        currency.tables.map(table => table.tableId));
      expect(current.indexes.map(index => index.indexDefinitionId).toSorted())
        .toEqual(currency.indexes.map(index => index.indexDefinitionId).toSorted());
      expect(current.unique.map(unique => unique.uniqueConstraintDefinitionId).toSorted())
        .toEqual(currency.unique.map(unique => unique.uniqueConstraintDefinitionId).toSorted());
      expect(current.indexes.length).toBeGreaterThan(0);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).toHaveBeenCalled();
    expect(spans).not.toContain("IndexBuildState.readCoverageContext");

    // Currency is search-bearing. Evolve the real bound Application document
    // source instead; its ordered definitions have no search-build transition.
    const candidate = catalog.requirements.evidence.candidate;
    const applicationSource = candidate.sources.find(source => source.key === "application");
    if (applicationSource?.definition.kind !== "documents") throw new Error("Missing actual Application document source");
    const application = await runEffect(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
      { sourceKey: applicationSource.key, writeProfile: applicationSource.writeProfile,
        definition: applicationSource.definition, evidence: applicationSource.evidence },
      "application", "documents", { kind: "prepared", catalog }));
    const table = application.tables.find(member => member.localName === "users");
    if (table === undefined) throw new Error("Missing genuine Application users table");
    const [clock] = await fixture.persistence.drizzle.select({ sequence: fxSystemScopeClocks.lastMetadataSequence })
      .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, scopeId));
    if (clock === undefined) throw new Error("Missing actual metadata watermark");
    const closureKey = finiteMetadataTableKey(application.metadataProjection, table.tableId, "writeClosure");
    if (closureKey === null) throw new Error("Missing retained Application write closure");
    const consumed = Result.getOrThrow(captureFiniteMetadataDependency(application.metadataProjection, closureKey, clock.sequence));
    const tableKey = finiteMetadataTableKey(application.metadataProjection, table.tableId, "table");
    if (tableKey === null) throw new Error("Missing retained Application read table");
    const consumedRead = Result.getOrThrow(captureFiniteMetadataDependency(application.metadataProjection, tableKey, clock.sequence));
    const addedIndex = Schema.decodeUnknownSync(SchemaManifestAppIndexDeclarationV1Schema)({
      tableLogicalName: "users", descriptor: "by_finite_name", fields: ["name"] });
    const nextSource = await runEffect(captureLogicalSchemaSource({ key: applicationSource.key,
      owner: applicationSource.owner, writeProfile: applicationSource.writeProfile, evidence: applicationSource.evidence,
      bindings: applicationSource.bindings, definition: { ...applicationSource.definition,
        indexes: [...applicationSource.definition.indexes, addedIndex] } }));
    const prepared = await runEffect(prepareLogicalSchemaCandidate({ ...candidate,
      sources: candidate.sources.map(source => source.key === applicationSource.key ? nextSource : source) }));
    const nextVersion = decodeCatalogSchemaVersionId("finite-current-application-next");
    const control = fixture.control.drizzle;
    const controlSession = fixture.resource.kind === "postgres"
      ? makeCatalogControlSessionStarter({ controlDb: control,
        driver: makePostgresCatalogControlSessionDriver(fixture.resource.control.pool) })
      : makePGliteFrameworkSchemaArtifactAdmissionFixture(fixture.resource.control).controlSessionStarter;
    const admission = makeLogicalSchemaAdmission({ controlDb: control, session: controlSession,
      deploymentId, scopeId });
    await runEffect(Effect.gen(function* () {
      yield* admission.admit(prepared, { schemaVersionId: nextVersion, version: decodeCatalogSchemaVersion(101) }, {
        initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
        lockTimeoutMilliseconds: 5_000, recoveryTimeoutMilliseconds: 20_000 });
    }));
    const nextCatalog = await control.transaction(tx => runEffect(Effect.gen(function* () {
      const definitions = yield* ensureLogicalStorageDefinitions(tx, deploymentId, nextVersion);
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control, { deploymentId, schemaVersionId: nextVersion }, tx);
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
      return definitions;
    })));
    const ports = logical.ports;
    const reconciled = await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, scopeId, schemaVersionId: nextVersion }));
    if (reconciled.status !== "reconciled") throw new Error("Expected actual B2 index reconciliation");
    if (catalog.snapshot === null) throw new Error("Missing retained B1 physical requirements");
    const originalIds = new Set(catalog.snapshot.definitions.map(definition => definition.indexDefinitionId));
    const addedIds = reconciled.definitionIds.filter(id => !originalIds.has(id));
    expect(addedIds).toHaveLength(1);
    for (const indexDefinitionId of addedIds) {
      const definition = await runEffect(locateAppIndexDefinitionByIdEffect(control, scopeId, indexDefinitionId));
      if (definition === null) throw new Error("Missing admitted new index");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const input = { deploymentId, scopeId, indexDefinitionId, pageSize: 10 };
        const build = definition.access.kind === "by_creation_time"
          ? await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input))
          : await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input));
        if (build.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("New Application index did not become ready");
    }
    const uniques = await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(ports, { deploymentId, scopeId, schemaVersionId: nextVersion }));
    if (uniques.status !== "reconciled") throw new Error("Expected B2 unique reconciliation");
    let uniqueEnabled = false;
    for (let step = 0; step < (uniques.definitionCount + 1) * 4; step++) {
      const built = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(ports,
        { deploymentId, scopeId, schemaVersionId: nextVersion, pageSize: 16 }));
      if (built.lifecycle === "enabled" && built.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("B2 unique definitions did not become ready");
    const bindings = await runEffect(makeDataBindingHost({ database: fixture.persistence.drizzle,
      selection: { deploymentId, scopeId }, target: fixture.bindingTarget,
      authority: fixture.application.authorityPorts, application: fixture.application.activation,
      logicalStorage: { controlDb: control, schemaVersionId: nextVersion, unique: logical.unique } }));
    const reference = await runEffect(bindings.readApplicationReference());
    const nextBinding = await runEffect(bindings.prepare({ format: "flarex.data-binding-set", application: reference,
      logicalSchema: { schemaVersionId: nextVersion, manifestSha256: encodeBytesToLowercaseHex(nextCatalog.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] }));
    const previousHead = await fixture.persistence.drizzle.transaction(tx => runEffect(readBindingSelectedEvidence(tx, resolved.authority)));
    if (Option.isNone(previousHead)) throw new Error("Missing B1 head");
    await runEffect(bindings.activate(dataBindingActivationRequest(scopeId, reference.storageGeneration,
      "finite-current-application-next", nextBinding.sha256,
      { sequence: previousHead.value.head.frame.sequence, sha256: previousHead.value.head.sha256 })));
    spans.length = 0;
    controlTransactions.mockClear();
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const currentClock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* application.readFiniteCommitClosure(tx, resolved.authority, currentClock, []);
      expect(current).toEqual({ indexes: [], unique: [] });
      // B2 added a write obligation without changing the consumed table read.
      // Empty write closure never substitutes for actual metadata OCC checks.
      yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumedRead]);
      expect(yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumed]).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(application.indexes.some(index => addedIds.includes(index.indexDefinitionId))).toBe(false);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("LogicalSourceAdmission.readFiniteCommitClosure");
    expect(spans).not.toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).not.toHaveBeenCalled();
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const currentClock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* application.readFiniteCommitClosure(tx, resolved.authority, currentClock, [table.tableId]);
      expect(current.indexes.map(index => index.indexDefinitionId).toSorted())
        .toEqual([...application.indexes.filter(index => index.access.tableId === table.tableId)
          .map(index => index.indexDefinitionId), ...addedIds].toSorted());
      expect(yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumed]).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      yield* application.requirePrepared;
      expect(application.catalog.reference.schemaVersionId).toBe(fixture.schemaVersionId);
      expect(application.indexes.some(index => addedIds.includes(index.indexDefinitionId))).toBe(false);
      expect(application.metadataProjection).not.toBeNull();
    })));
    expect(controlTransactions).toHaveBeenCalled();

    // Exercise selected logical catalog capacity through its actual admission
    // owner. The separate native Application publisher has a 256-work-item
    // operational limit and cannot establish this serving boundary.
    // Preserve the real Application users/Currency sources. Independently
    // authored system declarations own their own artifact, not App analysis.
    // Each new table contributes an intrinsic and a primary-key definition.
    const boundaryTableCount = 8;
    const origin = { kind: "authored", sourceId: "test.finite-definition-boundary" };
    for (const total of [512, 513]) {
      const schemaVersionId = decodeCatalogSchemaVersionId(`finite-definition-boundary-${total}`);
      const declaredIndexes = total - catalog.snapshot.definitions.length - 2 * boundaryTableCount;
      if (declaredIndexes < 0) throw new Error("Original catalog exceeds the independent boundary profile");
      const captured = await runEffect(captureRelationalSchemaArtifact({ deploymentId,
        provenance: { kind: "synthetic", fixtureId: `finite-definition-boundary-${total}` },
        schema: { owner: "system", lineageId: "test.finite-definition-boundary", capabilities: [],
          tables: Array.from({ length: boundaryTableCount }, (_, ordinal) => {
            const tableId = `boundary_${ordinal}`;
            const indexCount = Math.floor(declaredIndexes / boundaryTableCount) +
              (ordinal < declaredIndexes % boundaryTableCount ? 1 : 0);
            return { tableId, origin, columns: ["id", "value"].map(columnId => ({ columnId,
              type: "text", nullable: false, default: { kind: "none" }, origin })),
              keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }],
              indexes: Array.from({ length: indexCount }, (_, index) => ({ indexId: `${tableId}.by_value_${index}`,
                kind: "btree", columns: ["value"], predicate: null, origin })), constraints: [], relationships: [] };
          }) } }));
      const boundarySource = await runEffect(captureLogicalSchemaSource({
        key: "system.finite-definition-boundary", owner: "system", writeProfile: "system.finite-definition-boundary",
        evidence: { artifact: { ...captured.artifact.identity }, provenance: captured.artifact.provenance },
        definition: { kind: "relational", schema: captured.schema },
        bindings: captured.schema.tables.map((table): LogicalSchemaSource["bindings"][number] => ({ kind: "definition",
          localName: table.identity.tableId, table: { namespace: "system",
            logicalName: `${captured.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
      const boundaryCandidate = await runEffect(prepareLogicalSchemaCandidate({ ...candidate,
        sources: [...candidate.sources, boundarySource] }));
      await runEffect(Effect.gen(function* () {
        yield* admission.admit(boundaryCandidate, { schemaVersionId, version: decodeCatalogSchemaVersion(total) }, {
          initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
          lockTimeoutMilliseconds: 5_000, recoveryTimeoutMilliseconds: 20_000 });
      }));
      if (total === 512) await control.transaction(tx => runEffect(ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId)));
      const outcome = await runEffect(loadPublishedPhysicalRequirementSnapshotV1(control, { deploymentId, schemaVersionId }).pipe(Effect.result));
      if (total === 512) {
        const selected = Result.getOrThrow(outcome);
        if (selected === null) throw new Error("Missing real 512-definition schema");
        expect(selected.definitions).toHaveLength(512);
      } else expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "definitionLimitExceeded" } });
    }
  } finally { for (const close of cleanup.reverse()) await close(); }
}

it("loads current binding B2 closure while retaining B1 preparation and conflicting consumed writes in PGlite",
  () => verifyCurrentBindingClosure("pglite"), 240_000);
it.skipIf(postgresUrl === null)("loads current binding B2 closure while retaining B1 preparation and conflicting consumed writes in PostgreSQL",
  () => verifyCurrentBindingClosure("postgres"), 240_000);
