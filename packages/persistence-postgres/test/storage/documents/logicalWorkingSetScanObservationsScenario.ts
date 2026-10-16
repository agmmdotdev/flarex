import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { expect } from "vitest";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogIndexDefinitionId, decodeCatalogIndexId } from "flarex-protocol/catalog";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { CatalogSchemaVersionSchema, SchemaManifestAppIndexDescriptorSchema, decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 } from "flarex-protocol/schema-manifest";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerAppDeveloperOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { canonicalizeAppIndexPhysicalSpecV1, canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { deployments, fxControlScopes, fxControlIndexes, fxControlIndexDefinitions, fxSystemScopeClocks } from "../../../src/database/schema";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";
import { prepareSchemaManifestAppSchemaBindingsV1Effect,
  applySchemaManifestAppSchemaBindingsV1InTransactionEffect } from "../../../src/storage/catalog/schemaManifestAppSchemaBindings";
import { prepareSchemaVersionArtifactEffect, ensureSchemaVersionArtifactInTransactionEffect } from "../../../src/storage/catalog/schemaVersionArtifacts";
import { appendPreparedAppRowRevisionsInTransactionEffect } from "../../../src/storage/documents/appRows";
import { makeLogicalDocumentWorkingSet } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { locateAppIndexDefinitionByIdEffect } from "../../../src/storage/indexes/appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { appendAppIndexEntryRevisionsInTransactionEffect } from "../../../src/storage/indexes/appIndexEntries";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  locateAppUniqueConstraintDefinitionByIdEffect } from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { applyAppUniqueKeyMutationsInTransactionEffect } from "../../../src/storage/unique/appUniqueKeys";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { runEffect } from "../../support/effectTestRuntime";

/** Actual complete-table capture, followed by the same declared access owners
 * used without a scan. No test-issued scan-completeness state is installed. */
export async function logicalWorkingSetScanObservationsScenario(db: FlarexMetadataDatabase): Promise<void> {
  const scopeId = ScopeIdSchema.make("scope_62000000-0000-0000-0000-000000000001");
  const epoch = ScopeEpochSchema.make("epoch_62000000-0000-0000-0000-000000000002");
  const deploymentId = "deployment_scan_observations", schemaVersionId = decodeCatalogSchemaVersionId("schema_scan_observations");
  const creationTime = AppCreationTimeV1Schema.make(1), commitSeq = CommitSeqSchema.make(1n);
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const withInstallation = <A, E, R>(tx: FlarexMetadataTransaction, work: Effect.Effect<A, E, R>) =>
    lockInstallationForCurrentTransaction(tx).pipe(Effect.andThen(work),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))));
  await insertCurrentScopeClockFixture(db, { scopeId, epoch });
  await db.insert(deployments).values({ deploymentId, projectId: "project_scan_observations" });
  const bindings = await runEffect(prepareSchemaManifestAppSchemaBindingsV1Effect(db, { deploymentId,
    tables: [{ logicalName: "records", definition: { kind: "appDocument", definitionVersion: 1,
      documentType: { type: "object", value: {
        id: { fieldType: { type: "string" }, optional: false },
        bucket: { fieldType: { type: "string" }, optional: false },
        label: { fieldType: { type: "string" }, optional: false },
        deleted_at: { fieldType: { type: "null" }, optional: false },
      } } } }], indexes: [] }));
  const manifest = await db.transaction(tx => runEffect(applySchemaManifestAppSchemaBindingsV1InTransactionEffect(tx, bindings)));
  const bound = manifest.tableDefinitions.tables[0];
  if (bound === undefined) throw failure("Missing scan table");
  const tableId = bound.tableId;
  const artifact = await runEffect(prepareSchemaVersionArtifactEffect({ deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), manifest }));
  await db.transaction(tx => runEffect(ensureSchemaVersionArtifactInTransactionEffect(tx, artifact)));
  await db.insert(fxControlScopes).values({ scopeId, deploymentId, isolationKind: "shared_database",
    physicalLocator: { kind: "shared_database", databaseKey: "scan-observations", schemaName: "public" } });
  const origin = { kind: "synthetic", sourceId: "neutral.scan-observations" };
  const implicit = { kind: "implicit", sourceId: "neutral.scan-observations.lifecycle" };
  const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-scan-observations",
    capabilities: [{ capabilityId: "records.lifecycle", kind: "softDelete",
      deletedAtColumn: { tableId: "records", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "records", indexId: "records.active" }, origin: implicit }],
    tables: [{ tableId: "records", origin, columns: [
      ...["id", "bucket", "label"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
    ], keys: [{ keyId: "records.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "records.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
      { indexId: "records.bucket", kind: "btree", columns: ["bucket"], predicate: null, origin },
    ], constraints: [], relationships: [] }] }));
  const relational = schema.tables[0];
  if (relational === undefined) throw failure("Missing relational scan table");
  const preparedUnique = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(db, {
    deploymentId, schemaVersionId, tableId, descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_record_id"),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
      orderedFields: ["id"], sparse: true, localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }) }));
  const ensuredUnique = await db.transaction(tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, preparedUnique)));
  const unique = await runEffect(locateAppUniqueConstraintDefinitionByIdEffect(db, deploymentId,
    scopeId, schemaVersionId, ensuredUnique.definition.uniqueConstraintDefinitionId));
  if (unique === null) throw failure("Missing scan unique definition");
  const logicalIndexId = decodeCatalogIndexId(620), indexDefinitionId = decodeCatalogIndexDefinitionId(620);
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
    kind: "developerOrdered", specVersion: 1, fields: ["bucket"],
  }));
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await db.insert(fxControlIndexes).values({ deploymentId, logicalIndexId, tableId, descriptor: "by_bucket" });
  await db.insert(fxControlIndexDefinitions).values({ deploymentId, indexDefinitionId, accessKind: "developer",
    accessIdentityId: logicalIndexId, logicalIndexId, tableId, physicalSpecCodecVersion: canonical.codecVersion,
    physicalSpecJson: physicalSpec, physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(canonical.canonicalBytesHex),
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex) });
  const index = await runEffect(locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId));
  if (index === null) throw failure("Missing scan ordered definition");
  const fixtures = await Promise.all([
    { id: "A", bucket: "shared", label: "selected" },
    { id: "B", bucket: "shared", label: "excluded" },
    { id: "C", bucket: "other", label: "excluded" },
  ].map(async (fields, ordinal) => {
    const rowId = decodeAppRowIdHexV1((620 + ordinal).toString(16).padStart(32, "0"));
    const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { ...fields, deleted_at: null } });
    const key = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(index, document, creationTime));
    const claim = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(unique, document));
    if (key === null || claim.kind !== "claim") throw failure("Missing actual scan membership");
    return { rowId, document, key, claim, id: appDocumentIdV1FromRowIdentity({ tableId, rowId }) };
  }));
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.gen(function* () {
    yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    yield* appendPreparedAppRowRevisionsInTransactionEffect(tx, fixtures.map(row => ({ kind: "live", scopeId, tableId,
      rowId: row.rowId, writeEpoch: epoch, commitSeq, prevCommitSeq: null, schemaVersionId, creationTime, document: row.document })));
    yield* appendAppIndexEntryRevisionsInTransactionEffect(tx, fixtures.map(row => ({ kind: "live", scopeId, definition: index,
      encodedKey: row.key, rowId: row.rowId, writeEpoch: epoch, commitSeq })));
    yield* applyAppUniqueKeyMutationsInTransactionEffect(tx, fixtures.map(row => ({ scopeId, tableId, rowId: row.rowId,
      constraintId: unique.uniqueConstraintDefinitionId, writeEpoch: epoch, previous: null, next: row.claim.projection })));
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("fixtureStatement", cause));
  }))));
  await db.transaction(tx => runEffect(withInstallation(tx, Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const open = () => Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
        { calls: 32, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "scan-observations", "write"), owner => owner.close);
      const working = yield* makeLogicalDocumentWorkingSet({ scopeId, clock, lifetime, tx,
        tables: [{ tableId, logicalName: "records", relational }], relationalCapabilities: schema.capabilities,
        requireAdmission: Effect.void, readReadiness: { kind: "full" }, validateDocument: () => Effect.void,
        error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 8, identities: 8, documentBytes: 16_384 } }, creationTime, [unique], [index]);
      const id = yield* lifetime.begin(lifetime.context);
      return { lifetime, working, id };
    });
    const selected = fixtures[0];
    if (selected === undefined) throw failure("Missing selected scan row");
    const query = { where: { label: "selected" }, offset: 0, limit: 8 };
    // A real unindexed read hydrates three original bodies; the residual
    // returns only A. A repeated scan must retain all three actual candidates.
    const scanned = yield* open();
    for (let repeat = 0; repeat < 2; repeat++) {
      const cursor = scanned.working.activityCursor();
      expect(yield* scanned.working.documents.find(scanned.lifetime.context, scanned.id, "records", query))
        .toMatchObject({ docs: [{ id: "A" }], total: 1 });
      expect((yield* scanned.working.activitySnapshot(cursor)).observedRows.map(row => row.value.id).sort()).toEqual(["A", "B", "C"]);
    }
    // Selected key A is observed even when a residual rejects it. The cached
    // table's unrelated B/C remain absent from this call's evidence.
    const keyCursor = scanned.working.activityCursor();
    expect(yield* scanned.working.documents.find(scanned.lifetime.context, scanned.id, "records",
      { where: { id: "A", label: "excluded" }, offset: 0, limit: 8 })).toEqual({ docs: [], total: 0 });
    expect((yield* scanned.working.activitySnapshot(keyCursor)).observedRows.map(row => row.value.id)).toEqual(["A"]);
    // An unchanged restore uses A without producing a mutation attempt.
    const restoreCursor = scanned.working.activityCursor();
    expect(yield* scanned.working.relationalChange(scanned.lifetime.context, scanned.id, "records", "restore", [{ id: "A" }]))
      .toMatchObject([{ id: "A", deleted_at: null }]);
    const restored = yield* scanned.working.activitySnapshot(restoreCursor);
    expect(restored.observedRows.map(row => row.value.id)).toEqual(["A"]);
    expect(restored.attempts).toEqual([]); expect(restored.lifecycle).toHaveLength(1);
    // Fresh index and scan-backed index reads must report the same original
    // A/B prefix membership even when the full predicate returns A only.
    const fresh = yield* open();
    for (const owner of [fresh, scanned]) {
      const cursor = owner.working.activityCursor();
      expect(yield* owner.working.documents.find(owner.lifetime.context, owner.id, "records",
        { where: { bucket: "shared", label: "selected" }, offset: 0, limit: 8 }))
        .toMatchObject({ docs: [{ id: "A" }], total: 1 });
      expect((yield* owner.working.activitySnapshot(cursor)).observedRows.map(row => row.value.id).sort()).toEqual(["A", "B"]);
    }
    // Current pending membership joins the original anchor before residuals:
    // E belongs to shared but is excluded by label; unrelated D stays absent.
    // Cover retained-index, scan-backed and first-index-read selections.
    const firstIndexRead = yield* open();
    for (const owner of [fresh, scanned, firstIndexRead]) {
      yield* owner.working.documents.insert(owner.lifetime.context, owner.id, "records",
        { id: "D", bucket: "elsewhere", label: "pending", deleted_at: null });
      yield* owner.working.documents.insert(owner.lifetime.context, owner.id, "records",
        { id: "E", bucket: "shared", label: "excluded", deleted_at: null });
      for (let repeat = 0; repeat < 2; repeat++) {
        const cursor = owner.working.activityCursor();
        expect(yield* owner.working.documents.find(owner.lifetime.context, owner.id, "records",
          { where: { bucket: "shared", label: "selected" }, offset: 0, limit: 8 }))
          .toMatchObject({ docs: [{ id: "A" }], total: 1 });
        expect((yield* owner.working.activitySnapshot(cursor)).observedRows.map(row => row.value.id).sort()).toEqual(["A", "B", "E"]);
      }
      const pendingKeyCursor = owner.working.activityCursor();
      expect(yield* owner.working.documents.find(owner.lifetime.context, owner.id, "records",
        { where: { id: "E", label: "selected" }, offset: 0, limit: 8 })).toEqual({ docs: [], total: 0 });
      expect((yield* owner.working.activitySnapshot(pendingKeyCursor)).observedRows.map(row => row.value.id)).toEqual(["E"]);
      const fullScanCursor = owner.working.activityCursor();
      expect(yield* owner.working.documents.find(owner.lifetime.context, owner.id, "records", query))
        .toMatchObject({ docs: [{ id: "A" }], total: 1 });
      expect((yield* owner.working.activitySnapshot(fullScanCursor)).observedRows.map(row => row.value.id).sort())
        .toEqual(["A", "B", "C", "D", "E"]);
    }
    // Original B remains an anchor member after its pending value moves out.
    const moved = fixtures[1];
    if (moved === undefined) throw failure("Missing moved scan row");
    yield* scanned.working.documents.patch(scanned.lifetime.context, scanned.id, moved.id, { bucket: "moved" }, "records");
    const movedCursor = scanned.working.activityCursor();
    expect(yield* scanned.working.documents.find(scanned.lifetime.context, scanned.id, "records",
      { where: { bucket: "shared", label: "selected" }, offset: 0, limit: 8 }))
      .toMatchObject({ docs: [{ id: "A" }], total: 1 });
    expect((yield* scanned.working.activitySnapshot(movedCursor)).observedRows.map(row => row.value.id).sort()).toEqual(["A", "B", "E"]);
    const close = yield* scanned.working.activitySnapshot();
    expect(close.observedRows.map(row => row.value.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
    yield* scanned.lifetime.seal;
    const changes = yield* scanned.working.close();
    expect(changes.dependencies.filter(entry => entry.dependency.kind === "appRowPoint")).toHaveLength(3);
    expect(changes.dependencies.filter(entry => entry.dependency.kind === "generatedInsertion")).toHaveLength(2);
    expect(changes.scans).toHaveLength(1);
    expect(changes.observedRows.map(row => row.value.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
  })))));
}
