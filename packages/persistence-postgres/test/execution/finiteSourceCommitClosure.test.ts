import { and, eq } from "drizzle-orm";
import { Effect, Option, Result, Schema, Tracer } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { captureLogicalSchemaSource, prepareLogicalSchemaCandidate } from "../../../analysis/src/logicalSchemaCandidate";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId, SchemaManifestAppIndexDeclarationV1Schema } from "flarex-protocol/schema-manifest";
import type { LogicalSchemaSource } from "flarex-protocol/internal/logical-schema-candidate";
import { expect, it, vi } from "vitest";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { logicalCurrencyFixture } from "../../../medusa-adapter/test/support/logical-currency-fixture";
import { prepareLogicalSourceEvidence, withSharedLogicalSourceBindingChecks } from "../../src/storage/documents/logicalDocuments/sourceAdmission";
import { prepareLogicalStorageReadiness, requirePreparedLogicalStorageCatalog } from "../../src/storage/catalog/logicalStorageReadiness";
import * as hostPreparation from "../../src/execution/preparation/preparedHostRuntime";
import { captureRelationalSchemaArtifact } from "../../src/storage/relationalSchema/artifact";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../src/scope/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from "../../src/scope/scopeClock";
import { makeLogicalSchemaAdmission } from "../../src/storage/catalog/logicalSchemaAdmission";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from "../../src/database/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../src/database/postgresCatalogControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { ensureLogicalStorageDefinitions } from "../../src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../../src/storage/unique/appUniqueConstraintSetClosureV1";
import { loadPublishedPhysicalRequirementSnapshotV1, reconcilePublishedIndexBuildsV1Effect } from "../../src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect, locatePublishedAppIndexDefinitionsEffect, isLocatedAppIndexDefinitionV1 } from "../../src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from "../../src/storage/unique/appUniqueConstraintSetBuildV1";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../src/installation/frameworkSchema/binding/host";
import { readBindingSelectedEvidence } from "../../src/installation/frameworkSchema/binding/repository";
import { captureFiniteMetadataDependency, finiteMetadataTableKey, initializeCurrentFiniteMetadataProjection,
  requireFiniteTableWriteClosures, validateConsumedMetadataDependencies } from "../../src/execution/finiteMetadataDependencies";
import { fxSystemMetadataContractObservations, fxSystemScopeClocks } from "../../src/database/schema";
import { postgresUrl } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";

async function verifyCurrentBindingClosure(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { finiteStorageCapture: true });
    const deploymentId = Schema.decodeUnknownSync(TransactionGrantDeploymentIdV1Schema)(fixture.deploymentId);
    const scopeId = decodeReplacementScopeIdV1(fixture.application.authority.scopeId);
    const active = await runEffect(fixture.application.activation.readActive());
    expect(active.basis.schemaVersionId).not.toBe(fixture.schemaVersionId);
    const logical = fixture.hostInput.logicalStorage;
    const location = { deploymentId, scopeId, schemaVersionId: fixture.schemaVersionId };
    const catalog = await runEffect(prepareLogicalStorageReadiness(logical.ports, logical.unique, location));
    if (catalog.status !== "prepared") throw new Error("Expected genuine binding catalog");
    if (catalog.snapshot === null) throw new Error("Missing authentic published physical requirements");
    const clonedSnapshot = await runEffect(locatePublishedAppIndexDefinitionsEffect(logical.ports.controlDb,
      { ...catalog.snapshot }, scopeId).pipe(Effect.result));
    expect(clonedSnapshot).toMatchObject({ _tag: "Failure", failure: {
      _tag: "InvalidIndexBuildReconciliationInputV1Error", reason: "invalidInputShape",
    } });
    const foreignDatabase = await runEffect(locatePublishedAppIndexDefinitionsEffect(fixture.persistence.drizzle,
      catalog.snapshot, scopeId).pipe(Effect.result));
    expect(foreignDatabase).toMatchObject({ _tag: "Failure", failure: {
      _tag: "InvalidIndexBuildReconciliationInputV1Error", reason: "invalidInputShape",
    } });
    const locatedPublished = await runEffect(locatePublishedAppIndexDefinitionsEffect(logical.ports.controlDb, catalog.snapshot, scopeId));
    expect(locatedPublished.map(index => index.indexDefinitionId).toSorted())
      .toEqual(catalog.snapshot.definitions.map(index => index.indexDefinitionId).toSorted());
    expect(locatedPublished.every(isLocatedAppIndexDefinitionV1)).toBe(true);
    expect(locatedPublished.every(index => !isLocatedAppIndexDefinitionV1({ ...index }))).toBe(true);
    const currency = await runEffect(prepareLogicalSourceEvidence(logical.ports, logical.unique, location,
      { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
        definition: { kind: "relational", schema: fixture.currencyDefinition.schema },
        evidence: fixture.currencyDefinition.provenance }, "medusa", "relational", { kind: "prepared", catalog }));
    const resolved = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(deploymentId, fixture.application.authorityPorts));
    const spans: string[] = [];
    const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
    // The Promise-owned control transaction starts its own Effect runtime, so
    // its catalog spans do not inherit this tracer. Observe the real control
    // transaction and direct catalogue reads without replacing their actual
    // implementations or catalogue work.
    const controlTransactions = vi.spyOn(logical.ports.controlDb, "transaction");
    const controlSelections = vi.spyOn(logical.ports.controlDb, "select");
    const controlExecutions = vi.spyOn(logical.ports.controlDb, "execute");
    cleanup.push(async () => { controlTransactions.mockRestore(); });
    cleanup.push(async () => { controlSelections.mockRestore(); });
    cleanup.push(async () => { controlExecutions.mockRestore(); });
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* currency.readFiniteCommitClosure(tx, resolved.authority, clock, []);
      expect(current).toEqual({ indexes: [], unique: [] });
      expect(currency.indexes.length).toBeGreaterThan(0);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("LogicalSourceAdmission.consumeFiniteCommitClosure");
    expect(spans).not.toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).not.toHaveBeenCalled();
    expect(controlSelections).not.toHaveBeenCalled();
    expect(controlExecutions).not.toHaveBeenCalled();
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
      expect(current.indexes.every(index => currency.indexes.includes(index))).toBe(true);
      expect(current.unique.every(unique => currency.unique.includes(unique))).toBe(true);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("FiniteMetadata.requireTableWriteClosures");
    expect(spans).not.toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).not.toHaveBeenCalled();
    expect(controlSelections).not.toHaveBeenCalled();
    expect(controlExecutions).not.toHaveBeenCalled();
    expect(spans).not.toContain("IndexBuildState.readCoverageContext");

    const currencyTable = currency.tables[0];
    if (currencyTable === undefined) throw new Error("Missing genuine Currency table");
    const currencyClosure = finiteMetadataTableKey(currency.metadataProjection, currencyTable.tableId, "writeClosure");
    if (currencyClosure === null) throw new Error("Missing genuine Currency closure");
    await fixture.persistence.drizzle.transaction(tx => runEffect(withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
      const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const demanded = currency.tables.map(table => table.tableId);
      const prepared = yield* Effect.fromResult(currency.prepareFiniteCommitClosureObservation(tx, resolved.authority, clock, demanded));
      const expected = prepared.pages[0]?.[0];
      if (expected === undefined) throw new Error("Missing actual uncached closure expectation");
      expect(Object.isFrozen(prepared.pages)).toBe(true);
      expect(Object.isFrozen(prepared.pages[0])).toBe(true);
      expect(Reflect.set(expected, "ownerKey", "escaped-owner")).toBe(false);
      // Populate the actual transaction cache after preparation. Consumption
      // must retain the original uncached demand and its ordered refusal.
      yield* currency.readFiniteCommitClosure(tx, resolved.authority, clock, demanded);
      const cached = yield* Effect.fromResult(currency.prepareFiniteCommitClosureObservation(tx, resolved.authority, clock, demanded));
      expect(cached.pages).toEqual([]);
      expect(yield* cached.accept([])).toMatchObject({ indexes: currency.indexes, unique: currency.unique });
      const refused = yield* prepared.accept([{ reason: "projectionMissing", ordinal: 0, currentObservation: null }]).pipe(Effect.result);
      expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "sourceMismatch", cause: {
        reason: "projectionMissing", dependency: { namespace: expected.namespace, ownerKey: expected.ownerKey,
          contractKey: expected.contractKey },
      } } });
    }))));
    const closureWhere = and(eq(fxSystemMetadataContractObservations.scopeId, scopeId),
      eq(fxSystemMetadataContractObservations.namespace, currencyClosure.namespace),
      eq(fxSystemMetadataContractObservations.ownerKey, currencyClosure.ownerKey),
      eq(fxSystemMetadataContractObservations.contractKey, currencyClosure.contractKey));
    const [originalClosure] = await fixture.persistence.drizzle.select().from(fxSystemMetadataContractObservations).where(closureWhere);
    if (originalClosure?.semanticBytes === null || originalClosure === undefined) throw new Error("Missing actual canonical closure bytes");
    // Keep the authentic digest and size while changing actual canonical bytes.
    // Full SQL equality must reject this before lending any original capability.
    const corruptedBytes = new Uint8Array(originalClosure.semanticBytes);
    corruptedBytes[corruptedBytes.length - 1] = (corruptedBytes[corruptedBytes.length - 1] ?? 0) ^ 1;
    await fixture.persistence.drizzle.update(fxSystemMetadataContractObservations).set({ semanticBytes: corruptedBytes }).where(closureWhere);
    const mismatched = await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [currencyTable.tableId]).pipe(Effect.result)));
    expect(mismatched).toMatchObject({ _tag: "Failure", failure: { reason: "projectionMissing" } });
    const unroutedTable = decodeCatalogTableId(2_147_483_647);
    expect(currency.tables.some(table => table.tableId === unroutedTable)).toBe(false);
    const mismatchBeforeUnrouted = await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [currencyTable.tableId, unroutedTable]).pipe(Effect.result)));
    expect(mismatchBeforeUnrouted).toMatchObject({ _tag: "Failure", failure: { reason: "projectionMissing", dependency: currencyClosure } });
    const unroutedBeforeMismatch = await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [unroutedTable, currencyTable.tableId]).pipe(Effect.result)));
    expect(unroutedBeforeMismatch).toMatchObject({ _tag: "Failure", failure: { reason: "invalidProjection" } });
    await fixture.persistence.drizzle.update(fxSystemMetadataContractObservations).set({ semanticBytes: originalClosure.semanticBytes }).where(closureWhere);
    const matchingPrefixBeforeUnrouted = await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [currencyTable.tableId, currencyTable.tableId, unroutedTable]).pipe(Effect.result)));
    expect(matchingPrefixBeforeUnrouted).toMatchObject({ _tag: "Failure", failure: { reason: "invalidProjection" } });
    await fixture.persistence.drizzle.update(fxSystemMetadataContractObservations).set({ semanticBytes: null }).where(closureWhere);
    const incomplete = await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [currencyTable.tableId]).pipe(Effect.result)));
    expect(incomplete).toMatchObject({ _tag: "Failure", failure: { reason: "projectionMissing" } });
    await fixture.persistence.drizzle.transaction(tx => runEffect(initializeCurrentFiniteMetadataProjection(tx, scopeId,
      currency.metadataProjection, [{ namespace: currencyClosure.namespace, ownerKey: currencyClosure.ownerKey }])));
    await fixture.persistence.drizzle.transaction(tx => runEffect(requireFiniteTableWriteClosures(tx, scopeId,
      currency.metadataProjection, [currencyTable.tableId])));
    const [restored] = await fixture.persistence.drizzle.select().from(fxSystemMetadataContractObservations).where(closureWhere);
    if (restored?.semanticBytes === null || restored === undefined) throw new Error("Missing restored complete closure");
    expect(encodeBytesToLowercaseHex(restored.semanticBytes)).toBe(encodeBytesToLowercaseHex(originalClosure.semanticBytes));

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
    const currencyReadKey = finiteMetadataTableKey(currency.metadataProjection, currencyTable.tableId, "table");
    if (currencyReadKey === null) throw new Error("Missing retained Currency read table");
    const currencyRead = Result.getOrThrow(captureFiniteMetadataDependency(currency.metadataProjection, currencyReadKey, clock.sequence));
    const currencyWrite = Result.getOrThrow(captureFiniteMetadataDependency(currency.metadataProjection, currencyClosure, clock.sequence));
    const payloadSource = candidate.sources.find(source => source.owner === "payload");
    const payloadBinding = payloadSource?.bindings.find(binding => binding.kind === "definition" && binding.localName === "news");
    const currencySource = candidate.sources.find(source => source.key === "medusa.currency");
    const currencyBinding = currencySource?.bindings.find(binding => binding.kind === "definition" && binding.localName === "currency");
    if (payloadSource === undefined || payloadBinding === undefined || currencyBinding === undefined)
      throw new Error("Missing genuine incoming reference endpoints");
    const addedIndex = Schema.decodeUnknownSync(SchemaManifestAppIndexDeclarationV1Schema)({
      tableLogicalName: "users", descriptor: "by_finite_name", fields: ["name"] });
    const nextSource = await runEffect(captureLogicalSchemaSource({ key: applicationSource.key,
      owner: applicationSource.owner, writeProfile: applicationSource.writeProfile, evidence: applicationSource.evidence,
      bindings: applicationSource.bindings, definition: { ...applicationSource.definition,
        indexes: [...applicationSource.definition.indexes, addedIndex] } }));
    const prepared = await runEffect(prepareLogicalSchemaCandidate({ ...candidate,
      sources: candidate.sources.map(source => source.key === applicationSource.key ? nextSource : source),
      extensions: [...candidate.extensions, { name: "news_currency", sourceKey: payloadSource.key,
        source: { table: payloadBinding.table, field: "title" }, target: { table: currencyBinding.table, field: "code" },
        policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
        onTargetDelete: "restrict" }] }));
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
    controlSelections.mockClear();
    controlExecutions.mockClear();
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const currentClock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* application.readFiniteCommitClosure(tx, resolved.authority, currentClock, []);
      expect(current).toEqual({ indexes: [], unique: [] });
      // B2 added a write obligation without changing the consumed table read.
      // Empty write closure never substitutes for actual metadata OCC checks.
      yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumedRead]);
      // An incoming extension changes Currency's complete write closure even
      // though the Currency source, table and all its definitions are unchanged.
      yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [currencyRead]);
      expect(yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [currencyWrite]).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumed]).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      expect(application.indexes.some(index => addedIds.includes(index.indexDefinitionId))).toBe(false);
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))));
    expect(spans).toContain("LogicalSourceAdmission.consumeFiniteCommitClosure");
    expect(spans).not.toContain("DataBindingRepository.readSelectedEvidence");
    expect(controlTransactions).not.toHaveBeenCalled();
    expect(controlSelections).not.toHaveBeenCalled();
    expect(controlExecutions).not.toHaveBeenCalled();
    await fixture.persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
      const currentClock = yield* lockScopeClockForUpdateInTransactionEffect(tx, scopeId);
      const current = yield* application.readFiniteCommitClosure(tx, resolved.authority, currentClock, [table.tableId]).pipe(Effect.result);
      // Changed complete maintenance semantics invalidate the old retained
      // closure before any definition acquisition; fresh entry owns B2 replay.
      expect(current).toMatchObject({ _tag: "Failure", failure: { reason: "sourceMismatch" } });
      expect(yield* validateConsumedMetadataDependencies(tx, scopeId, clock.sequence, [consumed]).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "writeConflict" } });
      yield* application.requirePrepared;
      expect(application.catalog.reference.schemaVersionId).toBe(fixture.schemaVersionId);
      expect(application.indexes.some(index => addedIds.includes(index.indexDefinitionId))).toBe(false);
      expect(application.metadataProjection).not.toBeNull();
    })));
    expect(controlTransactions).not.toHaveBeenCalled();
    expect(controlSelections).not.toHaveBeenCalled();
    expect(controlExecutions).not.toHaveBeenCalled();

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
      if (total === 512) await control.transaction(tx => runEffect(Effect.gen(function* () {
        yield* ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId);
        const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control, { deploymentId, schemaVersionId }, tx);
        yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
      })));
      const outcome = await runEffect(loadPublishedPhysicalRequirementSnapshotV1(control, { deploymentId, schemaVersionId }).pipe(Effect.result));
      if (total === 512) {
        const selected = Result.getOrThrow(outcome);
        if (selected === null) throw new Error("Missing real 512-definition schema");
        expect(selected.definitions).toHaveLength(512);
        // The cold reader boundary also owns the complete preparation DTO. Use
        // the real issuer and host meter, rather than a digest-only substitute.
        await runEffect(Effect.scoped(Effect.gen(function* () {
          const boundaryLocation = { deploymentId, scopeId, schemaVersionId };
          const actualCharge = hostPreparation.chargeHostPreparation;
          const payloads: unknown[] = [];
          let observing = true;
          yield* Effect.acquireRelease(Effect.sync(() => vi.spyOn(hostPreparation, "chargeHostPreparation")
            .mockImplementation(value => {
              if (observing) payloads.push(value);
              return actualCharge(value);
            })), spy => Effect.sync(() => spy.mockRestore()));
          const runtime = yield* hostPreparation.makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 134_217_728 });
          const retained = yield* hostPreparation.retainPreparedHost(runtime,
            prepareLogicalStorageReadiness(logical.ports, logical.unique, boundaryLocation));
          const prepared = yield* retained.use(value => Effect.succeed(value));
          expect(prepared.status).toBe("prepared");
          if (prepared.status !== "prepared") return yield* Effect.die("512-definition cold preparation was not issued");
          expect(prepared.snapshot.definitions).toHaveLength(512);
          expect(yield* requirePreparedLogicalStorageCatalog(prepared, logical.ports, logical.unique, boundaryLocation)).toBe(prepared);
          expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(0);
          const completeDto = JSON.stringify({ manifest: selected.manifest, definitions: selected.definitions },
            (_, value: unknown) => typeof value === "bigint" ? value.toString() : value);
          const actualDto = payloads[0];
          expect(actualDto).toBe(completeDto);
          const decodeDto = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
            manifest: Schema.Unknown, definitions: Schema.Array(Schema.Unknown),
          })));
          const chargedDto = decodeDto(actualDto);
          expect(chargedDto).toEqual(decodeDto(completeDto));
          expect(chargedDto.definitions).toHaveLength(512);
          yield* retained.close;
          expect(yield* requirePreparedLogicalStorageCatalog(prepared, logical.ports, logical.unique, boundaryLocation)
            .pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
          expect(yield* retained.use(() => Effect.void).pipe(Effect.result))
            .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });

          // Read the existing meter's charge for the authentic first payload.
          // No test implementation of its byte accounting participates.
          observing = false;
          const calibration = yield* hostPreparation.retainPreparedHost(runtime,
            actualCharge(actualDto).pipe(Effect.as(Object.freeze({}))));
          const catalogCharge = Result.getOrThrow(calibration.readUsage()).chargedBytes;
          expect(catalogCharge).toBeGreaterThan(1);
          yield* calibration.close;
          const undersized = yield* hostPreparation.makePreparedHostRuntime({ maximumHosts: 1,
            maximumPreparedBytes: catalogCharge - 1 });
          let usable = false;
          payloads.length = 0;
          observing = true;
          const refused = yield* hostPreparation.retainPreparedHost(undersized, Effect.gen(function* () {
            const lifetime = yield* hostPreparation.captureHostPreparationLifetime();
            if (lifetime === undefined) return yield* Effect.die("Missing actual cold preparation lease");
            return yield* prepareLogicalStorageReadiness(logical.ports, logical.unique, boundaryLocation).pipe(
              Effect.tapError(() => Effect.sync(() => {
                expect(lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
                expect(lifetime.charge({})).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
              })),
              Effect.tap(() => Effect.sync(() => { usable = true; })));
          })).pipe(Effect.result);
          expect(refused).toMatchObject({ _tag: "Failure", failure: {
            _tag: "PreparedHostRuntimeError", reason: "capacityExceeded",
          } });
          expect(usable).toBe(false);
          expect(payloads).toEqual([completeDto]);
          // Failed construction returns both the sole reservation and bytes.
          const replacement = yield* hostPreparation.retainPreparedHost(undersized, Effect.succeed(Object.freeze({})));
          expect(Result.getOrThrow(replacement.readUsage()).chargedBytes).toBe(0);
          yield* replacement.use(() => Effect.void);
          yield* replacement.close;
        })));

      } else {
        expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "definitionLimitExceeded" } });
        await runEffect(Effect.scoped(Effect.gen(function* () {
          const runtime = yield* hostPreparation.makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 134_217_728 });
          let usable = false;
          const refused = yield* hostPreparation.retainPreparedHost(runtime,
            prepareLogicalStorageReadiness(logical.ports, logical.unique, { deploymentId, scopeId, schemaVersionId })
              .pipe(Effect.tap(() => Effect.sync(() => { usable = true; })))).pipe(Effect.result);
          expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "definitionLimitExceeded" } });
          expect(usable).toBe(false);
        })));
      }
    }
  } finally { for (const close of cleanup.reverse()) await close(); }
}

it("loads current binding B2 closure while retaining B1 preparation and conflicting consumed writes in PGlite",
  () => verifyCurrentBindingClosure("pglite"), 240_000);
it.skipIf(postgresUrl === null)("loads current binding B2 closure while retaining B1 preparation and conflicting consumed writes in PostgreSQL",
  () => verifyCurrentBindingClosure("postgres"), 240_000);
