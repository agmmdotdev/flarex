import { and, eq, getTableName, sql } from "drizzle-orm";
import { PgDialect, parsePgArray } from "drizzle-orm/pg-core";
import { Cause, Deferred, Effect, Exit, Result, Schema } from "effect";
import { expect, vi } from "vitest";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogIndexDefinitionId, decodeCatalogIndexId, decodeCatalogTableId } from "flarex-protocol/catalog";
import { canonicalizeAppIndexPhysicalSpecV1, canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes } from "flarex-protocol/index-definition";
import { APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1, lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  decodeOrderedIndexRowIdHexV1, orderedIndexValueFromFlarexValueV1,
  encodeAppOrderedIndexKeyV1, orderedIndexCreationTimeV1,
  type AppOrderedIndexPhysicalSpecV1 } from "flarex-protocol/ordered-index";
import { CatalogSchemaVersionSchema, SchemaManifestAppIndexDescriptorSchema, SchemaManifestAppIndexFieldPathSchema,
  decodeCatalogSchemaVersionId, decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 } from "flarex-protocol/schema-manifest";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { AppUniqueConstraintSetBuildAttemptFenceV1Schema } from "flarex-protocol/internal/app-unique-constraint-set-v1";
import { CommitSeqSchema, ReplacementScopeIdV1Schema, ScopeEpochSchema, SnapshotTokenSchema,
  FlarexDbV1StorageGenerationSchema, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { IndexBuildAttemptFenceSchema, IndexBuildCursorCodecVersionV1Schema } from "flarex-protocol/index-build-state";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { getAppRowAtSnapshotInTransactionEffect, readCurrentAppRowInTransactionEffect,
  AppRowStorageCorruptionError, prepareAppRowRevisionApplicationEffect,
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedLiveAppRowRevisionV1Input, type LiveAppRowRevisionV1 } from "../src/appRows";
import { locateAppIndexDefinitionByIdEffect, prepareOrderedIndexDefinitionBinding,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction, type LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import { ensureStableLogicalIndexIdentityInTransaction } from "../src/stableLogicalIndexCatalog";
import { ensureStableTableIdentityEffect } from "../src/stableTableCatalog";
import { runEffectTransaction } from "../src/effectTransaction";
import { projectPointCommitTransactionResult, runPointCommitInTransactionEffect } from "../src/pointCommitPromiseBoundary";
import { enterLogicalDocumentMaterialization, LogicalDocumentMaterializationError } from "../src/logicalDocuments/materialization";
import { PointCommitCorruptionV1Error } from "../src/pointCommitErrors";
import { createLocatedIndexBuildReconciliationTargetV1 } from "../src/indexBuildReconciliation";
import { getScopeMetadataByDeploymentId } from "../src/scopeMetadata";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { prepareAppIndexRevisionApplicationEffect, readAppIndexMembershipHeadsInTransactionEffect,
  appendAppIndexEntryRevisionsInTransactionEffect, InvalidAppIndexEntryInputError,
  AppIndexEntryStorageCorruptionError } from "../src/appIndexEntries";
import { lowerAppDeveloperIndexKeyV1 } from "../src/appDeveloperIndexCommitV1";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../src/appUniqueConstraintCommitV1";
import { prepareAppUniqueConstraintDefinitionBindingV1Effect, ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  locateAppUniqueConstraintDefinitionByIdEffect } from "../src/appUniqueConstraintDefinitions";
import { prepareAppUniqueMutationApplicationEffect, applyAppUniqueKeyMutationsInTransactionEffect,
  AppUniqueKeyParentRowError, AppUniqueKeyConflictError, AppUniqueKeyPreviousClaimMismatchError,
  AppUniqueKeyStorageCorruptionError } from "../src/appUniqueKeys";
import { decodeAppUniqueConstraintIdV1Result, type AppUniqueKeyProjectionV1 } from "../src/appUniqueKeyContract";
import { prepareLogicalSearchApplications, maintainLogicalSearchEntries, LogicalSearchMaintenanceError,
  type LogicalSearchDefinition } from "../src/logicalDocuments/searchEntries";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission,
  requireAdmittedTargetInstallationSchema } from "../src/installationLifecycle";
import { lockScopeClockForOrdinaryWriteInTransactionEffect, type ScopeClockRecord } from "../src/scopeClock";
import { loadPointCommitHeads, lockPointCommitIntrinsicIndexBuilds,
  materializeApplicationDocumentRows, applyPreparedApplicationMaterializationEffect,
  prepareApplicationDocumentSettlementEffect, lockPointCommitDeveloperIndexBuilds,
  acceptPreparedApplicationDeveloperTransitionsEffect,
  acceptPreparedApplicationUniqueOwnersEffect } from "../src/applicationDocumentMaterialization/materialization";
import type { ApplicationDocumentMaterializationCommand,
  ApplicationDocumentMaterializationOptions } from "../src/applicationDocumentMaterialization/model";
import { fxAppRowRevisions, fxAppRowCurrent, fxAppIndexEntryRevisions, fxAppIndexEntryCurrent, fxAppUniqueKeys,
  fxAppSearchEntryCurrent, fxAppJsonEntryCurrent, fxSystemSearchBuildStates,
  fxControlTables, fxControlIndexes, fxControlIndexDefinitions, fxSystemIndexBuildStates, fxSystemScopeClocks,
  fxSystemUniqueConstraintBuilds } from "../src/schema";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";
import { runEffect } from "./effectTestRuntime";
import { applicationDomainFailureDetail } from "../src/applicationDocumentMaterialization/domainApplication";
import { PointCommitPublicationObservation, type PointCommitPublicationEvent } from "../src/pointCommitPublicationObservation";

export type MaterializationCompositionPersistence = Pick<FlarexPersistence,
  "query" | "insertDeploymentMetadata" | "insertScopeMetadata" | "publishAppSchemaV1"> & Readonly<{ drizzle: FlarexMetadataDatabase }>;

async function admitted<Value>(database: FlarexMetadataDatabase,
  work: (tx: FlarexMetadataTransaction) => Promise<Value>): Promise<Value> {
  return database.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try { return await work(tx); }
    finally { closeInstallationAdmission(tx); }
  });
}

async function throughCompositor<Value>(tx: FlarexMetadataTransaction, work: () => Promise<Value>): Promise<Value> {
  const execute = vi.spyOn(tx, "execute");
  try { return await work(); }
  finally {
    const submitted = execute.mock.calls.some(([statement]) => {
      const text = typeof statement === "string" ? statement : new PgDialect().sqlToQuery(statement.getSQL()).sql;
      return text.includes(".fx_apply_app_materialization(");
    });
    execute.mockRestore();
    // Observe the actual execute method without replacing its SQL or result.
    // This distinguishes compositor coverage from the retained owner tests.
    expect(submitted).toBe(true);
  }
}

async function compositionFixture(persistence: MaterializationCompositionPersistence, ordinal: number,
  developerDeclarations: readonly Readonly<{ field: string; predicate?: AppOrderedIndexPhysicalSpecV1["predicate"] }>[] = [{ field: "title" }]) {
  const database = persistence.drizzle;
  const suffix = ordinal.toString().padStart(12, "0");
  const scopeId = ReplacementScopeIdV1Schema.make(`scope_6a410000-0000-4000-8000-${suffix}`);
  const writeEpoch = ScopeEpochSchema.make(`epoch_6a420000-0000-4000-8000-${suffix}`);
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(`materialization_composition_${ordinal}`);
  const schemaVersionId = decodeCatalogSchemaVersionId("materialization_composition");
  const tableId = decodeCatalogTableId(1);
  const intrinsicId = decodeCatalogIndexDefinitionId(1);
  const developerIds = developerDeclarations.map((_, index) => decodeCatalogIndexDefinitionId(index + 2));
  const logicalIndexIds = developerIds.map((_, index) => decodeCatalogIndexId(index + 1));
  const schemaName = await admitted(database, tx =>
    runEffect(Effect.fromResult(requireAdmittedTargetInstallationSchema(tx))));
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "materialization_composition" });
  await persistence.insertScopeMetadata({ deploymentId, scopeId,
    physicalLocator: { kind: "shared_database", databaseKey: "materialization_composition", schemaName } });
  await insertCurrentScopeClockFixture(database, { scopeId, epoch: writeEpoch });
  await database.insert(fxControlTables).values({ deploymentId, tableId, namespace: "app", logicalName: "documents" });
  await database.insert(fxControlIndexes).values(logicalIndexIds.map((logicalIndexId, index) =>
    ({ deploymentId, tableId, logicalIndexId, descriptor: index === 0 ? "by_title" : `by_title_${index}` })));
  const intrinsicSpec = await canonicalizeAppIndexPhysicalSpecV1(APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1);
  const developerSpecs = [];
  for (const declaration of developerDeclarations) {
    const lowered = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
      kind: "developerOrdered", specVersion: 1, fields: [declaration.field],
    }));
    developerSpecs.push(await canonicalizeAppIndexPhysicalSpecV1({ ...lowered,
      ...(declaration.predicate === undefined ? {} : { predicate: declaration.predicate }) }));
  }
  await database.insert(fxControlIndexDefinitions).values([
    { deploymentId, indexDefinitionId: intrinsicId, accessKind: "by_creation_time", accessIdentityId: tableId,
      tableId, logicalIndexId: null, physicalSpecCodecVersion: intrinsicSpec.codecVersion,
      physicalSpecJson: intrinsicSpec.physicalSpec,
      physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(intrinsicSpec.canonicalBytesHex),
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(intrinsicSpec.sha256Hex) },
    ...developerSpecs.map((developerSpec, index) => ({ deploymentId, indexDefinitionId: decodeCatalogIndexDefinitionId(index + 2), accessKind: "developer" as const,
      accessIdentityId: decodeCatalogIndexId(index + 1),
      tableId, logicalIndexId: decodeCatalogIndexId(index + 1), physicalSpecCodecVersion: developerSpec.codecVersion,
      physicalSpecJson: developerSpec.physicalSpec,
      physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(developerSpec.canonicalBytesHex),
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(developerSpec.sha256Hex) })),
  ]);
  const intrinsic = await runEffect(locateAppIndexDefinitionByIdEffect(database, scopeId, intrinsicId));
  const developers: LocatedAppIndexDefinitionV1[] = [];
  for (const developerId of developerIds) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(database, scopeId, developerId));
    if (definition === null) throw new Error("Missing genuine materialization developer definition");
    developers.push(definition);
  }
  const developer = developers[0];
  if (intrinsic === null || developer === undefined) throw new Error("Missing genuine materialization definitions");
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const row = async (rowOrdinal: number, sequence = 1n, previous: bigint | null = null,
    creation = 42): Promise<AppendPreparedLiveAppRowRevisionV1Input> => {
    const rowId = decodeAppRowIdHexV1(rowOrdinal.toString(16).padStart(32, "0"));
    const creationTime = decodeAppCreationTimeV1(creation);
    return { kind: "live", scopeId, tableId, rowId, writeEpoch,
      commitSeq: CommitSeqSchema.make(sequence),
      prevCommitSeq: previous === null ? null : CommitSeqSchema.make(previous), creationTime, schemaVersionId,
      document: await canonicalizeAppDocumentV1({ tableId, rowId, creationTime, fields: { title: `row_${rowOrdinal}` } }) };
  };
  const state = async () => ({
    rows: await database.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
    pointers: await database.select().from(fxAppRowCurrent).where(eq(fxAppRowCurrent.scopeUuid, scopeUuid))
      .orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId),
    indexes: await database.select().from(fxAppIndexEntryRevisions).where(eq(fxAppIndexEntryRevisions.scopeUuid, scopeUuid))
      .orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
    indexPointers: await database.select().from(fxAppIndexEntryCurrent).where(eq(fxAppIndexEntryCurrent.scopeUuid, scopeUuid))
      .orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId),
    unique: await database.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.scopeUuid, scopeUuid))
      .orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.tableId, fxAppUniqueKeys.rowId),
  });
  return { persistence, database, scopeId, scopeUuid, writeEpoch, deploymentId, schemaVersionId,
    tableId, schemaName, intrinsic, developer, developers, row, state };
}

async function commandForRows(tx: FlarexMetadataTransaction,
  fixture: Awaited<ReturnType<typeof compositionFixture>>, clock: ScopeClockRecord,
  rows: readonly AppendPreparedLiveAppRowRevisionV1Input[]): Promise<ApplicationDocumentMaterializationCommand> {
  const snapshotToken = SnapshotTokenSchema.make({ scopeId: fixture.scopeId, epoch: clock.epoch, commitSeq: clock.lastCommitSeq });
  const rowIntents: ApplicationDocumentMaterializationCommand["rowIntents"][number][] = [];
  const dependencies: ApplicationDocumentMaterializationCommand["dependencies"][number][] = [];
  for (const row of rows) {
    const read = await runEffect(getAppRowAtSnapshotInTransactionEffect(tx,
      { tableId: row.tableId, rowId: row.rowId, snapshotToken }));
    const documentId = appDocumentIdV1FromRowIdentity(row);
    const dependency: ApplicationDocumentMaterializationCommand["dependencies"][number]["dependency"] = {
      kind: "appRowPoint", documentId, observed: read.dependency.kind === "present"
        ? { kind: "present", revisionCommitSeq: read.dependency.revisionCommitSeq }
        : { kind: "missing", basis: read.dependency.basis },
    };
    dependencies.push({ documentId, tableId: row.tableId, rowId: row.rowId, dependency });
    rowIntents.push({ kind: "live", documentId, tableId: row.tableId, rowId: row.rowId,
      dependency, creationTime: row.creationTime, document: row.document });
  }
  return { authorityPins: { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId,
    schemaVersionId: fixture.schemaVersionId, snapshotToken }, rowIntents, dependencies };
}

/** Seed through the actual row and membership writers; each original is then
 * captured by the row reader rather than fabricated from the requested input. */
async function seedIndexOriginals(fixture: Awaited<ReturnType<typeof compositionFixture>>,
  rows: readonly AppendPreparedLiveAppRowRevisionV1Input[], lifecycle: "enabled" | "building", memberships = true) {
  return admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, rows));
    if (memberships) {
      const positions = fixture.developers.flatMap(definition => rows.flatMap(row => {
        const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(definition, row.document, row.creationTime));
        return encodedKey === null ? [] : [{ definition, encodedKey, rowId: decodeOrderedIndexRowIdHexV1(row.rowId) }];
      }));
      const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
        { scopeId: fixture.scopeId, positions }));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, positions.map(position => ({
        ...position, kind: "live" as const, scopeId: fixture.scopeId, writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n), membershipHeadEvidence: selection.evidence,
      }))));
    }
    await tx.insert(fxSystemIndexBuildStates).values(fixture.developers.map(definition => ({
      scopeId: fixture.scopeId, indexDefinitionId: definition.indexDefinitionId,
      storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
      storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
      startCommitSeq: CommitSeqSchema.make(0n), coveredThroughCommitSeq: CommitSeqSchema.make(1n),
      firstReadableCommitSeq: lifecycle === "enabled" ? CommitSeqSchema.make(0n) : null,
      lifecycle, cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1),
      attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    })));
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
      .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    const originals: LiveAppRowRevisionV1[] = [];
    for (const row of rows) {
      const original = await runEffect(readCurrentAppRowInTransactionEffect(tx, row));
      if (original.kind !== "live") throw new Error("Genuine seeded original row is not live");
      originals.push(original);
    }
    return originals;
  });
}

async function applyFrozenIndexRows(fixture: Awaited<ReturnType<typeof compositionFixture>>,
  originals: readonly LiveAppRowRevisionV1[], rows: readonly AppendPreparedLiveAppRowRevisionV1Input[],
  expectedActions: number, profile: "activeApplication" | "sourceBound" = "sourceBound") {
  const command = await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    return commandForRows(tx, fixture, clock, rows);
  });
  // Canonical original-to-final planning has no live SQL transaction or
  // selected membership verdict. Fresh acceptance selects actual actions.
  const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, originals, fixture.developers, [], null, []));
  if (Exit.isFailure(prepared.developer)) throw new Error("Expected valid canonical index pairs", { cause: prepared.developer.cause });
  expect(prepared.developer.value).toHaveLength(rows.length * fixture.developers.length);
  return admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const context = { record: clock, scopeUuid: fixture.scopeUuid };
    const heads = await loadPointCommitHeads(tx, context, command, {});
    const builds = await lockPointCommitDeveloperIndexBuilds(tx, context, fixture.developers, command);
    const actions = await runEffect(acceptPreparedApplicationDeveloperTransitionsEffect(tx, prepared, builds));
    expect(actions).toHaveLength(expectedActions);
    await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: CommitSeqSchema.make(2n), clock,
      loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: actions, developerBuilds: builds,
      uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: profile, options: {} }));
  });
}

/** Stable table allocation precedes schema publication. Publishing the higher
 * table first makes real intrinsic definition order differ from table order. */
async function verifyFrozenIntrinsicAllocationOrder(persistence: MaterializationCompositionPersistence) {
  const originalFixture = await compositionFixture(persistence, 1131);
  const finalSchemaVersionId = decodeCatalogSchemaVersionId("inverted_intrinsic_complete");
  const fixture = { ...originalFixture, schemaVersionId: finalSchemaVersionId };
  const lower = await runEffect(ensureStableTableIdentityEffect(fixture.database,
    { deploymentId: fixture.deploymentId, namespace: "app", logicalName: "lower_source" }));
  const higher = await runEffect(ensureStableTableIdentityEffect(fixture.database,
    { deploymentId: fixture.deploymentId, namespace: "app", logicalName: "higher_source" }));
  expect(lower.table.tableId).toBeLessThan(higher.table.tableId);
  const declaration = (logicalName: string) => ({ logicalName, definition: { kind: "appDocument" as const,
    definitionVersion: 1 as const, documentType: { type: "object" as const,
      value: { title: { fieldType: { type: "string" as const }, optional: false } } } } });
  await persistence.publishAppSchemaV1({ deploymentId: fixture.deploymentId,
    schemaVersionId: decodeCatalogSchemaVersionId("inverted_intrinsic_higher"), version: CatalogSchemaVersionSchema.make(1),
    tables: [declaration(higher.table.logicalName)], indexes: [] });
  await persistence.publishAppSchemaV1({ deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.schemaVersionId, version: CatalogSchemaVersionSchema.make(2),
    tables: [declaration(lower.table.logicalName), declaration(higher.table.logicalName)], indexes: [] });
  const definitions: LocatedAppIndexDefinitionV1[] = [];
  for (const table of [lower.table, higher.table]) {
    const records = await fixture.database.select().from(fxControlIndexDefinitions).where(and(
      eq(fxControlIndexDefinitions.deploymentId, fixture.deploymentId),
      eq(fxControlIndexDefinitions.tableId, table.tableId), eq(fxControlIndexDefinitions.accessKind, "by_creation_time")));
    const record = records[0];
    expect(records).toHaveLength(1);
    if (record === undefined) throw new Error("Missing actually allocated intrinsic definition");
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(fixture.database, fixture.scopeId, record.indexDefinitionId));
    if (definition === null) throw new Error("Missing genuine inverted intrinsic definition");
    definitions.push(definition);
  }
  definitions.sort((left, right) => left.indexDefinitionId - right.indexDefinitionId);
  expect(definitions.map(definition => definition.access.tableId)).toEqual([higher.table.tableId, lower.table.tableId]);
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (const [ordinal, table] of [lower.table, higher.table].entries()) {
    const row = await fixture.row(ordinal + 1, 1n, null, 42 + ordinal);
    rows.push({ ...row, schemaVersionId: finalSchemaVersionId, tableId: table.tableId, document: await canonicalizeAppDocumentV1({
      tableId: table.tableId, rowId: row.rowId, creationTime: row.creationTime, fields: { title: table.logicalName } }) });
  }
  const command = await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await tx.insert(fxSystemIndexBuildStates).values(definitions.map(definition => ({ scopeId: fixture.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
      storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
      startCommitSeq: clock.lastCommitSeq, coveredThroughCommitSeq: clock.lastCommitSeq,
      firstReadableCommitSeq: clock.lastCommitSeq, lifecycle: "enabled" as const,
      cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), attemptFence: IndexBuildAttemptFenceSchema.make(1n) })));
    return commandForRows(tx, fixture, clock, rows);
  });
  const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, [], [], [], null, definitions));
  if (prepared.intrinsic === undefined || Exit.isFailure(prepared.intrinsic)) throw new Error("Invalid genuine two-table preparation");
  await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const context = { record: clock, scopeUuid: fixture.scopeUuid };
    const heads = await loadPointCommitHeads(tx, context, command, {});
    const builds = await lockPointCommitIntrinsicIndexBuilds(tx, context, definitions, command);
    expect(builds.map(build => build.definition.access.tableId)).toEqual([higher.table.tableId, lower.table.tableId]);
    await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: CommitSeqSchema.make(1n), clock,
      loadedHeads: heads, intrinsicBuilds: builds, developerIndexActions: [], developerBuilds: [],
      uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {},
      preparedIntrinsic: prepared.intrinsic }));
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
      .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
  });
  const stored = await fixture.state();
  const memberships = definitions.map(definition => {
    const row = rows.find(row => row.tableId === definition.access.tableId);
    if (row === undefined) throw new Error("Missing corresponding genuine intrinsic row");
    return { indexDefinitionId: definition.indexDefinitionId, tableId: row.tableId, rowId: row.rowId,
      encodedKey: encodeAppOrderedIndexKeyV1({ spec: definition.physicalSpec,
        values: [orderedIndexCreationTimeV1(row.creationTime)] }), commitSeq: 1n, isTombstone: false };
  });
  expect(stored.indexes.map(entry => ({ indexDefinitionId: entry.indexDefinitionId, tableId: entry.tableId,
    rowId: encodeBytesToLowercaseHex(entry.rowId), encodedKey: encodeBytesToLowercaseHex(entry.encodedKey),
    commitSeq: entry.commitSeq, isTombstone: entry.isTombstone }))).toEqual(memberships);
  expect(stored.indexPointers.map(entry => ({ indexDefinitionId: entry.indexDefinitionId,
    rowId: encodeBytesToLowercaseHex(entry.rowId), encodedKey: encodeBytesToLowercaseHex(entry.encodedKey), commitSeq: entry.commitSeq })))
    .toEqual(memberships.map(entry => ({ indexDefinitionId: entry.indexDefinitionId,
      rowId: entry.rowId, encodedKey: entry.encodedKey, commitSeq: entry.commitSeq })));
  expect((await fixture.database.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, fixture.scopeId))
    .orderBy(fxSystemIndexBuildStates.indexDefinitionId)).map(build => ({ indexDefinitionId: build.indexDefinitionId,
      coveredThroughCommitSeq: build.coveredThroughCommitSeq })))
    .toEqual(definitions.map(definition => ({ indexDefinitionId: definition.indexDefinitionId, coveredThroughCommitSeq: 1n })));
  await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    for (const row of rows) {
      const current = await runEffect(readCurrentAppRowInTransactionEffect(tx, row));
      if (current.kind !== "live") throw new Error("Committed intrinsic row is absent");
      expect(current.commitSeq).toBe(1n);
      expect(current.creationTime).toBe(row.creationTime);
      expect(current.document.canonicalBytes).toEqual(row.document.canonicalBytes);
      expect(current.document.sha256).toEqual(row.document.sha256);
    }
  });
}

/** Real foreign keys ordinarily prevent this orphan. Deliberately fault only
 * the catalog-authenticated fixture guards, then restore them after cleanup. */
async function verifyFrozenIntrinsicInitialMembership(persistence: MaterializationCompositionPersistence) {
  for (const membershipKind of ["live", "tombstone"] as const) {
    const fixture = await compositionFixture(persistence, membershipKind === "live" ? 1111 : 1112);
    const original = await fixture.row(1);
    const position = { definition: fixture.intrinsic,
      encodedKey: encodeAppOrderedIndexKeyV1({ spec: fixture.intrinsic.physicalSpec,
        values: [orderedIndexCreationTimeV1(original.creationTime)] }),
      rowId: decodeOrderedIndexRowIdHexV1(original.rowId) };
    await admitted(fixture.database, async tx => {
      const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
      await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [original]));
      const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
        { scopeId: fixture.scopeId, positions: [position] }));
      await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ ...position,
        kind: "live", scopeId: fixture.scopeId, writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n), membershipHeadEvidence: selection.evidence }]));
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
        .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    });
    await admitted(fixture.database, async tx => {
      const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
      const lastCommitSeq = CommitSeqSchema.make(membershipKind === "tombstone" ? 2n : 1n);
      if (membershipKind === "tombstone") {
        const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId: fixture.scopeId, positions: [position] }));
        await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{ ...position,
          kind: "tombstone", scopeId: fixture.scopeId, writeEpoch: clock.epoch,
          commitSeq: lastCommitSeq, membershipHeadEvidence: selection.evidence }]));
      }
      await tx.insert(fxSystemIndexBuildStates).values({ scopeId: fixture.scopeId,
        indexDefinitionId: fixture.intrinsic.indexDefinitionId,
        storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
        storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
        startCommitSeq: CommitSeqSchema.make(0n), coveredThroughCommitSeq: lastCommitSeq,
        firstReadableCommitSeq: CommitSeqSchema.make(0n), lifecycle: "enabled",
        cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1),
        attemptFence: IndexBuildAttemptFenceSchema.make(1n) });
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq })
        .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    });
    const decodeGuards = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
      table_name: Schema.Literals([getTableName(fxAppIndexEntryRevisions), getTableName(fxAppIndexEntryCurrent)]),
      constraint_name: Schema.String.check(Schema.isMinLength(1)),
      definition: Schema.String.check(Schema.isMinLength(1)),
      namespace: Schema.Literal(fixture.schemaName), referenced_table: Schema.Literal(getTableName(fxAppRowCurrent)),
      constraint_kind: Schema.Literal("f"),
    })), { onExcessProperty: "error" });
    const readGuards = async () => decodeGuards((await persistence.query(`
      select owner.relname as table_name, guard.conname as constraint_name,
        pg_catalog.pg_get_constraintdef(guard.oid) as definition, owner_namespace.nspname as namespace,
        referenced.relname as referenced_table, guard.contype::text as constraint_kind
      from pg_catalog.pg_constraint guard
      join pg_catalog.pg_class owner on owner.oid = guard.conrelid
      join pg_catalog.pg_namespace owner_namespace on owner_namespace.oid = owner.relnamespace
      join pg_catalog.pg_class referenced on referenced.oid = guard.confrelid
      join pg_catalog.pg_namespace referenced_namespace on referenced_namespace.oid = referenced.relnamespace
      where guard.contype = 'f' and owner_namespace.nspname = $1 and referenced_namespace.nspname = $1
        and owner.relname in ($2, $3) and referenced.relname = $4
      order by owner.relname, guard.conname`, [fixture.schemaName, getTableName(fxAppIndexEntryRevisions),
      getTableName(fxAppIndexEntryCurrent), getTableName(fxAppRowCurrent)])).rows);
    const guards = await readGuards();
    expect(guards.length).toBeGreaterThan(0);
    let guardsRemoved = false;
    try {
      await admitted(fixture.database, async tx => {
        for (const guard of guards) await tx.execute(sql`alter table ${sql.identifier(fixture.schemaName)}.${sql.identifier(guard.table_name)}
          drop constraint ${sql.identifier(guard.constraint_name)}`);
      });
      guardsRemoved = true;
      await admitted(fixture.database, async tx => {
        await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        // Exact fixture-only parent damage; membership history remains genuine.
        await tx.delete(fxAppRowCurrent).where(and(eq(fxAppRowCurrent.scopeUuid, fixture.scopeUuid),
          eq(fxAppRowCurrent.tableId, original.tableId), eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(original.rowId))));
        await tx.delete(fxAppRowRevisions).where(and(eq(fxAppRowRevisions.scopeUuid, fixture.scopeUuid),
          eq(fxAppRowRevisions.tableId, original.tableId), eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(original.rowId))));
      });
      const { command, commitSeq } = await admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
        const final = await fixture.row(1, commitSeq);
        return { command: await commandForRows(tx, fixture, clock, [final]), commitSeq };
      });
      expect(command.rowIntents[0]?.dependency.observed).toEqual({ kind: "missing", basis: { kind: "noVisibleRevision" } });
      const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, [], [], [], null, [fixture.intrinsic]));
      if (prepared.intrinsic === undefined || Exit.isFailure(prepared.intrinsic))
        throw new Error("Expected genuine initial creation-time preparation");
      const inventory = async () => ({ ...await fixture.state(),
        clock: await fixture.database.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId)),
        builds: await fixture.database.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, fixture.scopeId)) });
      const before = await inventory();
      const steps: string[] = [];
      await expect(admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        expect(commitSeq).toBe(clock.lastCommitSeq + 1n);
        const context = { record: clock, scopeUuid: fixture.scopeUuid };
        const heads = await loadPointCommitHeads(tx, context, command, {});
        const builds = await lockPointCommitIntrinsicIndexBuilds(tx, context, [fixture.intrinsic], command);
        return materializeApplicationDocumentRows(tx, { command, commitSeq, clock,
          loadedHeads: heads, intrinsicBuilds: builds, developerIndexActions: [], developerBuilds: [],
          uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound",
          options: { afterTransactionStep: async event => { steps.push(event.step); } }, preparedIntrinsic: prepared.intrinsic });
      })).rejects.toMatchObject({ reason: "intrinsicIndexTransitionInvalid" });
      expect(steps).toContain("intrinsicMembershipPreparing");
      expect(steps).not.toContain("rowBatchWriting");
      expect(await inventory()).toEqual(before);
    } finally {
      if (guardsRemoved) await admitted(fixture.database, async tx => {
        await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        await tx.delete(fxAppIndexEntryCurrent).where(and(eq(fxAppIndexEntryCurrent.scopeUuid, fixture.scopeUuid),
          eq(fxAppIndexEntryCurrent.indexDefinitionId, fixture.intrinsic.indexDefinitionId),
          eq(fxAppIndexEntryCurrent.rowId, appRowIdHexV1ToBytes(original.rowId))));
        await tx.delete(fxAppIndexEntryRevisions).where(and(eq(fxAppIndexEntryRevisions.scopeUuid, fixture.scopeUuid),
          eq(fxAppIndexEntryRevisions.indexDefinitionId, fixture.intrinsic.indexDefinitionId),
          eq(fxAppIndexEntryRevisions.rowId, appRowIdHexV1ToBytes(original.rowId))));
        for (const guard of guards) await tx.execute(sql`alter table ${sql.identifier(fixture.schemaName)}.${sql.identifier(guard.table_name)}
          add constraint ${sql.identifier(guard.constraint_name)} ${sql.raw(guard.definition)}`);
      });
      expect(await readGuards()).toEqual(guards);
    }
  }
}

/** A genuine live predecessor supplies deletion time before SQL. Actual current
 * intrinsic membership still decides refusal, same-key repair or no deletion. */
async function verifyFrozenIntrinsicMissingMembership(persistence: MaterializationCompositionPersistence) {
  for (const lifecycle of ["enabled", "building"] as const) {
    for (const finalKind of ["live", "deleted"] as const) {
      const fixture = await compositionFixture(persistence,
        1101 + (lifecycle === "building" ? 2 : 0) + (finalKind === "deleted" ? 1 : 0));
      const originalInput = await fixture.row(1);
      const originals = await seedIndexOriginals(fixture, [originalInput], lifecycle, false);
      await admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        await tx.insert(fxSystemIndexBuildStates).values({ scopeId: fixture.scopeId,
          indexDefinitionId: fixture.intrinsic.indexDefinitionId,
          storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
          storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
          startCommitSeq: CommitSeqSchema.make(0n), coveredThroughCommitSeq: clock.lastCommitSeq,
          firstReadableCommitSeq: lifecycle === "enabled" ? CommitSeqSchema.make(0n) : null,
          lifecycle, cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1),
          attemptFence: IndexBuildAttemptFenceSchema.make(1n) });
      });
      const updated = await fixture.row(1, 2n, 1n);
      const command = await admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        const live = await commandForRows(tx, fixture, clock, [updated]);
        if (finalKind === "live") return live;
        const row = live.rowIntents[0];
        if (row === undefined || row.dependency.observed.kind !== "present")
          throw new Error("Missing genuine deletion predecessor");
        return { ...live, rowIntents: [{ kind: "deleted" as const, documentId: row.documentId,
          tableId: row.tableId, rowId: row.rowId, dependency: row.dependency }] };
      });
      const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, originals, [], [], null, [fixture.intrinsic]));
      if (prepared.intrinsic === undefined || Exit.isFailure(prepared.intrinsic))
        throw new Error("Expected genuine original creation-time preparation");
      expect(prepared.intrinsic.value).toMatchObject([{ creationTime: originals[0]?.creationTime }]);
      const inventory = async () => ({ ...await fixture.state(),
        clock: await fixture.database.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId)),
        builds: await fixture.database.select().from(fxSystemIndexBuildStates).where(eq(fxSystemIndexBuildStates.scopeId, fixture.scopeId)) });
      const before = await inventory();
      const steps: string[] = [];
      const apply = () => admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        const context = { record: clock, scopeUuid: fixture.scopeUuid };
        const heads = await loadPointCommitHeads(tx, context, command, {});
        const builds = await lockPointCommitIntrinsicIndexBuilds(tx, context, [fixture.intrinsic], command);
        return materializeApplicationDocumentRows(tx, { command, commitSeq: CommitSeqSchema.make(2n), clock,
          loadedHeads: heads, intrinsicBuilds: builds, developerIndexActions: [], developerBuilds: [],
          uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "activeApplication",
          options: { afterTransactionStep: async event => { steps.push(event.step); } }, preparedIntrinsic: prepared.intrinsic });
      });
      if (lifecycle === "enabled") {
        await expect(apply()).rejects.toMatchObject({ reason: "intrinsicIndexTransitionInvalid" });
        expect(steps).toContain("intrinsicMembershipPreparing");
        expect(steps).not.toContain("rowBatchWriting");
        expect(await inventory()).toEqual(before);
      } else {
        await apply();
        const after = await fixture.state();
        expect(after.rows).toHaveLength(2);
        expect(after.rows[1]).toMatchObject({ commitSeq: 2n, prevCommitSeq: 1n,
          creationTime: originalInput.creationTime, isTombstone: finalKind === "deleted" });
        expect(after.pointers[0]?.commitSeq).toBe(2n);
        expect(after.indexes).toHaveLength(finalKind === "live" ? 1 : 0);
        expect(after.indexPointers).toHaveLength(finalKind === "live" ? 1 : 0);
        if (finalKind === "live") expect(after.indexes[0]).toMatchObject({
          indexDefinitionId: fixture.intrinsic.indexDefinitionId, commitSeq: 2n, isTombstone: false });
        expect(steps.indexOf("intrinsicMembershipPrepared")).toBeLessThan(steps.indexOf("rowBatchWriting"));
      }
    }
  }
}

/** The actual membership owner preserves enabled corruption versus a building
 * same-key repair; preparation alone cannot choose either current branch. */
async function verifyFrozenMissingMembership(persistence: MaterializationCompositionPersistence) {
  for (const lifecycle of ["enabled", "building"] as const) {
    const fixture = await compositionFixture(persistence, lifecycle === "enabled" ? 701 : 702);
    const original = await fixture.row(1);
    const originals = await seedIndexOriginals(fixture, [original], lifecycle, false);
    const updated = await fixture.row(1, 2n, 1n);
    const before = await fixture.state();
    if (lifecycle === "enabled") {
      await expect(applyFrozenIndexRows(fixture, originals, [updated], 0)).rejects
        .toMatchObject({ _tag: "PointCommitCorruptionV1Error", reason: "developerIndexTransitionInvalid" });
      expect(await fixture.state()).toEqual(before);
    } else {
      await applyFrozenIndexRows(fixture, originals, [updated], 1, "activeApplication");
      const stored = await fixture.state();
      const key = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(fixture.developer, updated.document, updated.creationTime));
      if (key === null) throw new Error("Expected canonical repaired membership key");
      expect(stored.rows).toHaveLength(2);
      expect(stored.indexes.map(entry => ({ indexDefinitionId: entry.indexDefinitionId,
        rowId: encodeBytesToLowercaseHex(entry.rowId), encodedKey: encodeBytesToLowercaseHex(entry.encodedKey),
        commitSeq: entry.commitSeq, isTombstone: entry.isTombstone })))
        .toEqual([{ indexDefinitionId: fixture.developer.indexDefinitionId, rowId: original.rowId,
          encodedKey: key, commitSeq: 2n, isTombstone: false }]);
      expect(stored.indexPointers).toHaveLength(1);
      expect(stored.indexPointers[0]?.commitSeq).toBe(2n);
    }
  }
}

/** Three genuine definitions produce 384 canonical pairs. Only native current
 * membership decisions count toward the established 256-action ceiling. */
async function verifyFrozenActualIndexActionLimit(persistence: MaterializationCompositionPersistence) {
  for (const actionCount of [0, 256, 257] as const) {
    const fixture = await compositionFixture(persistence, 710 + actionCount, [
      { field: "title" }, { field: "fixed" },
      { field: "fixed", predicate: { kind: "fieldIsNull", field: Schema.decodeUnknownSync(SchemaManifestAppIndexFieldPathSchema)("gate") } },
    ]);
    const originalRows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
    const finalRows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
    for (let ordinal = 0; ordinal < 128; ordinal++) {
      const original = await fixture.row(ordinal);
      originalRows.push({ ...original, document: await canonicalizeAppDocumentV1({ tableId: original.tableId,
        rowId: original.rowId, creationTime: original.creationTime,
        fields: { title: `old_${ordinal}`, fixed: "stable", gate: ordinal === 0 ? null : "excluded" } }) });
      const final = await fixture.row(ordinal, 2n, 1n);
      finalRows.push({ ...final, document: await canonicalizeAppDocumentV1({ tableId: final.tableId,
        rowId: final.rowId, creationTime: final.creationTime,
        fields: { title: actionCount === 0 ? `old_${ordinal}` : `new_${ordinal}`, fixed: "stable",
          gate: ordinal === 0 && actionCount !== 257 ? null : "excluded" } }) });
    }
    const originals = await seedIndexOriginals(fixture, originalRows, "enabled");
    const before = await fixture.state();
    expect(before.indexes).toHaveLength(257);
    if (actionCount === 257) {
      await expect(applyFrozenIndexRows(fixture, originals, finalRows, actionCount)).rejects.toMatchObject({
        _tag: "PointCommitDeveloperIndexMaintenanceUnavailableV1Error", reason: "entryRevisionLimitExceeded",
        observed: 257, maximum: 256,
      });
      expect(await fixture.state()).toEqual(before);
    } else {
      await applyFrozenIndexRows(fixture, originals, finalRows, actionCount);
      const stored = await fixture.state();
      expect(stored.rows).toHaveLength(256);
      expect(stored.pointers.every(pointer => pointer.commitSeq === 2n)).toBe(true);
      expect(stored.indexes).toHaveLength(before.indexes.length + actionCount);
      expect(stored.indexPointers).toHaveLength(257);
      if (actionCount === 0) {
        expect(stored.indexes).toEqual(before.indexes);
        expect(stored.indexPointers).toEqual(before.indexPointers);
      } else {
        expect(stored.indexes.filter(entry => entry.commitSeq === 2n && entry.isTombstone)).toHaveLength(128);
        expect(stored.indexes.filter(entry => entry.commitSeq === 2n && !entry.isTombstone)).toHaveLength(128);
        expect(stored.indexPointers.filter(pointer => pointer.indexDefinitionId === fixture.developer.indexDefinitionId)
          .every(pointer => pointer.commitSeq === 2n)).toBe(true);
        expect(stored.indexPointers.filter(pointer => pointer.indexDefinitionId !== fixture.developer.indexDefinitionId))
          .toEqual(before.indexPointers.filter(pointer => pointer.indexDefinitionId !== fixture.developer.indexDefinitionId));
      }
    }
  }
}

/** Native/private ordered-index capacity, beyond standard Application's
 * per-table declaration limit. Every identity and schema binding is issued by
 * its actual catalog owner; this does not claim Application source-closure
 * reachability for 512 indexes on one table. */
async function verifyNativeOrderedIndexPairCapacity(persistence: MaterializationCompositionPersistence) {
  const originalFixture = await compositionFixture(persistence, 1151);
  const schemaVersionId = decodeCatalogSchemaVersionId("native_ordered_index_capacity");
  await persistence.publishAppSchemaV1({ deploymentId: originalFixture.deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1), tables: [{ logicalName: "documents", definition: {
      kind: "appDocument", definitionVersion: 1, documentType: { type: "object",
        value: { title: { fieldType: { type: "string" }, optional: false } } } } }], indexes: [] });
  const allocated = await admitted(originalFixture.database, async tx => {
    const definitions = [];
    for (let ordinal = 0; ordinal < 512; ordinal++) {
      const logical = await runEffect(ensureStableLogicalIndexIdentityInTransaction(tx, {
        deploymentId: originalFixture.deploymentId, tableId: originalFixture.tableId, descriptor: `native_capacity_${ordinal}` }));
      const lowered = lowerAppDeveloperOrderedIndexPhysicalSpecV1(decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
        kind: "developerOrdered", specVersion: 1, fields: [`missing_${ordinal}`] }));
      const prepared = await runEffect(prepareOrderedIndexDefinitionBinding({ deploymentId: originalFixture.deploymentId,
        schemaVersionId, tableId: logical.index.tableId, logicalIndexId: logical.index.logicalIndexId,
        physicalSpec: { ...lowered, predicate: { kind: "fieldIsNull",
          field: Schema.decodeUnknownSync(SchemaManifestAppIndexFieldPathSchema)("gate") } } }));
      definitions.push(await runEffect(ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared)));
    }
    return definitions;
  });
  expect(new Set(allocated.map(entry => entry.definition.indexDefinitionId)).size).toBe(512);
  expect(new Set(allocated.map(entry => entry.binding.logicalIndexId)).size).toBe(512);
  const developers: LocatedAppIndexDefinitionV1[] = [];
  for (const entry of allocated) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(originalFixture.database,
      originalFixture.scopeId, entry.definition.indexDefinitionId));
    if (definition === null) throw new Error("Missing actual native capacity definition");
    expect(definition.access).toMatchObject({ kind: "developer", tableId: originalFixture.tableId,
      logicalIndexId: entry.binding.logicalIndexId });
    developers.push(definition);
  }
  const firstDefinition = developers[0];
  if (firstDefinition === undefined) throw new Error("Missing first native capacity definition");
  const fixture = { ...originalFixture, schemaVersionId, developers, developer: firstDefinition };
  const initialRows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  const finalRows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (let ordinal = 0; ordinal < 128; ordinal++) {
    const initial = { ...await fixture.row(ordinal), schemaVersionId };
    initialRows.push(initial);
    const final = { ...await fixture.row(ordinal, 2n, 1n), schemaVersionId };
    finalRows.push({ ...final, document: await canonicalizeAppDocumentV1({ tableId: final.tableId,
      rowId: final.rowId, creationTime: final.creationTime, fields: { title: `changed_${ordinal}` } }) });
  }
  const originals = await seedIndexOriginals(fixture, initialRows, "enabled", false);
  const before = await fixture.state();
  const buildRows = () => fixture.database.select().from(fxSystemIndexBuildStates)
    .where(eq(fxSystemIndexBuildStates.scopeId, fixture.scopeId)).orderBy(fxSystemIndexBuildStates.indexDefinitionId);
  const beforeBuilds = await buildRows();
  expect(beforeBuilds).toHaveLength(512);
  expect(before.indexes).toEqual([]);
  expect(before.indexPointers).toEqual([]);
  const command = await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    return commandForRows(tx, fixture, clock, finalRows);
  });
  const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, originals, developers, [], null, []));
  if (Exit.isFailure(prepared.developer)) throw new Error("Invalid native capacity preparation", { cause: prepared.developer.cause });
  expect(prepared.developer.value).toHaveLength(65_536);
  expect(prepared.developer.value.every(pair => pair.priorKey === null && pair.finalKey === null && pair.priorCommitSeq === 1n)).toBe(true);
  for (const definition of developers)
    expect(prepared.developer.value.filter(pair => pair.definition === definition).map(pair => pair.rowId))
      .toEqual(finalRows.map(row => decodeOrderedIndexRowIdHexV1(row.rowId)));
  const events: PointCommitPublicationEvent[] = [];
  const observation = new PointCommitPublicationObservation({ detail: true, record: event => events.push(event) });
  await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const context = { record: clock, scopeUuid: fixture.scopeUuid };
    const heads = await loadPointCommitHeads(tx, context, command, {});
    const builds = await lockPointCommitDeveloperIndexBuilds(tx, context, developers, command);
    expect(builds.map(build => build.definition.indexDefinitionId)).toEqual(developers.map(definition => definition.indexDefinitionId));
    const execute = vi.spyOn(tx, "execute");
    try {
      const actions = await runEffect(acceptPreparedApplicationDeveloperTransitionsEffect(tx, prepared, builds));
      expect(actions).toEqual([]);
      await materializeApplicationDocumentRows(tx, { command, commitSeq: CommitSeqSchema.make(2n), clock,
        loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: actions, developerBuilds: builds,
        uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound",
        options: { publicationObservation: observation } });
      // Observe real driver submissions without replacing SQL or native proofs.
      const queries = execute.mock.calls.map(([statement]) => {
        if (typeof statement === "string") throw new Error("Expected typed native capacity statements");
        return new PgDialect().sqlToQuery(statement.getSQL());
      });
      const acceptance = queries.filter(query => query.sql.includes(".fx_accept_app_index_transitions("));
      expect(acceptance).toHaveLength(1);
      const acceptedQuery = acceptance[0];
      if (acceptedQuery === undefined) throw new Error("Missing actual native capacity acceptance submission");
      expect(acceptedQuery.params).toHaveLength(17);
      expect(acceptedQuery.params[0]).toBe(fixture.scopeId);
      expect(acceptedQuery.params[1]).toBe(fixture.scopeUuid);
      expect(acceptedQuery.params[16]).toBe(256);
      expect(acceptedQuery.sql.match(/::(?:integer|text|bigint|bytea)\[\]/g)).toHaveLength(14);
      // Zero-based driver ordinals correspond to the actual named SQL arguments.
      for (const [name, ordinal] of [["p_indexes", 2], ["p_access", 3], ["p_tables", 4], ["p_codecs", 5],
        ["p_specs", 6], ["p_ids", 7], ["p_previous", 8], ["p_previous_sha", 9], ["p_final", 10],
        ["p_final_sha", 11], ["p_row_previous", 12], ["p_attempts", 13], ["p_epochs", 14], ["p_fences", 15]] as const) {
        const parameter = acceptedQuery.params[ordinal];
        if (typeof parameter !== "string") throw new Error(`Native capacity ${name} is not an encoded PostgreSQL array`);
        const values: readonly unknown[] = parsePgArray(parameter);
        expect(values, `Actual ${name} driver array cardinality`).toHaveLength(65_536);
      }
      const materialization = queries.filter(query => query.sql.includes(".fx_apply_app_materialization("));
      expect(materialization).toHaveLength(1);
      expect(materialization[0]?.params.length).toBeLessThanOrEqual(65_535);
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(2n) })
        .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    } finally { execute.mockRestore(); }
  });
  observation.assertHealthy();
  for (const [owner, expected] of [["rowRevisions", 128], ["indexRevisions", 0], ["indexCoverage", 512]] as const)
    expect(events.filter(event => event.kind === "batch" && event.owner === owner)
      .reduce((count, event) => count + (event.kind === "batch" ? event.counts.rows ?? 0 : 0), 0)).toBe(expected);
  const stored = await fixture.state();
  expect(stored.rows).toHaveLength(256);
  expect(stored.rows.filter(row => row.commitSeq === 1n)).toEqual(before.rows);
  expect(stored.pointers).toHaveLength(128);
  expect(stored.pointers.every(row => row.commitSeq === 2n)).toBe(true);
  expect(stored.indexes).toEqual(before.indexes);
  expect(stored.indexPointers).toEqual(before.indexPointers);
  const afterBuilds = await buildRows();
  expect(afterBuilds).toHaveLength(512);
  for (const [ordinal, build] of afterBuilds.entries()) {
    const previous = beforeBuilds[ordinal];
    if (previous === undefined) throw new Error("Missing original capacity build");
    const { updatedAt: previousUpdatedAt, coveredThroughCommitSeq: previousCoverage, ...previousState } = previous;
    const { updatedAt, coveredThroughCommitSeq, ...currentState } = build;
    expect(previousCoverage).toBe(1n);
    expect(coveredThroughCommitSeq).toBe(2n);
    expect(currentState).toEqual(previousState);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(previousUpdatedAt.getTime());
  }
  await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    expect(clock.lastCommitSeq).toBe(2n);
    for (const row of finalRows) {
      const current = await runEffect(readCurrentAppRowInTransactionEffect(tx, row));
      if (current.kind !== "live") throw new Error("Missing committed capacity row");
      expect(current.commitSeq).toBe(2n);
      expect(current.creationTime).toBe(row.creationTime);
      expect(current.document.canonicalBytes).toEqual(row.document.canonicalBytes);
      expect(current.document.sha256).toEqual(row.document.sha256);
    }
  });
}

/** Actual SQL refusal must win even when a later owner's preparation has
 * already produced a genuine typed failure. No failure is manufactured here. */
async function verifyEarlierRowRefusal(persistence: MaterializationCompositionPersistence) {
  for (const later of ["index", "search"] as const) {
    const fixture = await compositionFixture(persistence, later === "index" ? 101 : 102);
    const row = await fixture.row(1);
    const rowTable = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(fxAppRowRevisions))}`).sql;
    const functionName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.materialization_earlier_row_refusal`).sql;
    await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
      begin NEW."${fxAppRowRevisions.rowId.name}" := decode(repeat('ff',16),'hex'); return NEW; end $$`);
    try {
      await persistence.query(`create trigger materialization_earlier_row_refusal before insert on ${rowTable}
        for each row execute function ${functionName}()`);
      try {
        const before = await fixture.state();
        await expect(admitted(fixture.database, async tx => {
          const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
          const command = await commandForRows(tx, fixture, clock, [row]);
          const heads = await loadPointCommitHeads(tx, { record: clock, scopeUuid: fixture.scopeUuid }, command, {});
          if (later === "index") {
            const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(fixture.developer, row.document, row.creationTime));
            if (encodedKey === null) throw new Error("Missing genuine developer index key");
            const position = { definition: fixture.developer, encodedKey, rowId: decodeOrderedIndexRowIdHexV1(row.rowId) };
            const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
              { scopeId: fixture.scopeId, positions: [position] }));
            const action = { kind: "live", ...position, membershipHeadEvidence: selection.evidence } as const;
            const preparedFailure = await runEffect(Effect.result(prepareAppIndexRevisionApplicationEffect(tx,
              [{ ...action, scopeId: fixture.scopeId, writeEpoch: fixture.writeEpoch, commitSeq: row.commitSeq },
                { ...action, scopeId: fixture.scopeId, writeEpoch: fixture.writeEpoch, commitSeq: row.commitSeq }])));
            expect(Result.getOrThrow(Result.flip(preparedFailure))).toBeInstanceOf(InvalidAppIndexEntryInputError);
            await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: row.commitSeq, clock,
              loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: [action, action], developerBuilds: [],
              uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {} }));
          } else {
            const definition: LogicalSearchDefinition = { kind: "text", tableId: fixture.tableId,
              logicalIndexId: decodeCatalogIndexId(2), sourceSha256: "a".repeat(64), columns: ["missing_field"], nullPredicateField: null };
            const changes = [{ kind: "live", tableId: row.tableId, rowId: row.rowId, document: row.document }] as const;
            const preparation = prepareLogicalSearchApplications([definition], changes, fixture.scopeUuid, row.commitSeq).next().value;
            if (preparation === undefined) throw new Error("Missing genuine search preparation failure");
            expect(Result.getOrThrow(Result.flip(preparation))).toBeInstanceOf(LogicalSearchMaintenanceError);
            await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: row.commitSeq, clock,
              loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: [], developerBuilds: [],
              uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {},
              searchContribution: Result.succeed({ definitions: [definition], changes }) }));
          }
        })).rejects.toBeInstanceOf(AppRowStorageCorruptionError);
        expect(await fixture.state()).toEqual(before);
      } finally {
        await persistence.query(`drop trigger materialization_earlier_row_refusal on ${rowTable}`);
      }
    } finally { await persistence.query(`drop function ${functionName}()`); }
  }
}

/** Immediate RETURNING proof is a write barrier: a later same-page trigger
 * must never replace the first row or index corruption with its own failure. */
async function verifySamePageReturningOrder(persistence: MaterializationCompositionPersistence) {
  for (const family of ["row", "index"] as const) {
    const fixture = await compositionFixture(persistence, family === "row" ? 402 : 403);
    const first = await fixture.row(0);
    const later = await fixture.row(1);
    const target = family === "row" ? fxAppRowRevisions : fxAppIndexEntryRevisions;
    const targetTable = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(target))}`).sql;
    const functionName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.materialization_same_page_returning`).sql;
    const corrupt = family === "row"
      ? `NEW."${fxAppRowRevisions.creationTime.name}" := NEW."${fxAppRowRevisions.creationTime.name}" + 1;`
      : `NEW."${fxAppIndexEntryRevisions.isTombstone.name}" := true;`;
    await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
      begin
        if NEW."${target.rowId.name}" = decode('${first.rowId}','hex') then ${corrupt}
        elsif NEW."${target.rowId.name}" = decode('${later.rowId}','hex') then
          raise exception 'later same-page trigger must not win';
        end if;
        return NEW;
      end $$`);
    try {
      await persistence.query(`create trigger materialization_same_page_returning before insert on ${targetTable}
        for each row execute function ${functionName}()`);
      try {
        const before = await fixture.state();
        await admitted(fixture.database, async tx => {
          const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
          const command = await commandForRows(tx, fixture, clock, [first, later]);
          const heads = await loadPointCommitHeads(tx, { record: clock, scopeUuid: fixture.scopeUuid }, command, {});
          const positions = [first, later].map(revision => {
            const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(fixture.developer, revision.document, revision.creationTime));
            if (encodedKey === null) throw new Error("Missing genuine same-page developer index key");
            return { definition: fixture.developer, encodedKey, rowId: decodeOrderedIndexRowIdHexV1(revision.rowId) };
          });
          const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
            { scopeId: fixture.scopeId, positions }));
          const actions = positions.map(position => ({ kind: "live", ...position, membershipHeadEvidence: selection.evidence } as const));
          const result = await throughCompositor(tx, () => materializeApplicationDocumentRows(tx,
            { command, commitSeq: first.commitSeq, clock, loadedHeads: heads, intrinsicBuilds: [],
              developerIndexActions: family === "index" ? actions : [], developerBuilds: [], uniqueKeyActions: [],
              uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {} }))
            .then(() => Result.succeed(undefined), (cause: unknown) => Result.fail(cause));
          if (Result.isSuccess(result)) throw new Error("Composed materialization accepted same-page RETURNING corruption");
          if (family === "row") {
            if (!(result.failure instanceof AppRowStorageCorruptionError)) throw result.failure;
            expect(result.failure.identity).toEqual({ scopeId: fixture.scopeId, tableId: first.tableId, rowId: first.rowId });
          } else {
            if (!(result.failure instanceof AppIndexEntryStorageCorruptionError)) throw result.failure;
          }
          await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
        });
        expect(await fixture.state()).toEqual(before);
      } finally { await persistence.query(`drop trigger materialization_same_page_returning on ${targetTable}`); }
    } finally { await persistence.query(`drop function ${functionName}()`); }
  }
}

/** The last server page leaves its own tuple intact and changes an earlier
 * input. Catching the translated proof cannot make the transaction writable. */
async function verifyCompositionEarlierPageProof(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 401);
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (let ordinal = 0; ordinal < 33; ordinal++) rows.push(await fixture.row(ordinal));
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) throw new Error("Missing cross-page materialization rows");
  const rowTable = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(fxAppRowRevisions))}`).sql;
  const functionName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.materialization_prior_page_after`).sql;
  await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
    begin
      if NEW."${fxAppRowRevisions.rowId.name}" = decode('${last.rowId}','hex') then
        update ${rowTable} set "${fxAppRowRevisions.creationTime.name}" = "${fxAppRowRevisions.creationTime.name}" + 1
          where "${fxAppRowRevisions.scopeUuid.name}" = NEW."${fxAppRowRevisions.scopeUuid.name}"
            and "${fxAppRowRevisions.tableId.name}" = NEW."${fxAppRowRevisions.tableId.name}"
            and "${fxAppRowRevisions.rowId.name}" = decode('${first.rowId}','hex')
            and "${fxAppRowRevisions.commitSeq.name}" = NEW."${fxAppRowRevisions.commitSeq.name}";
      end if;
      return NEW;
    end $$`);
  try {
    await persistence.query(`create trigger materialization_prior_page_after after insert on ${rowTable}
      for each row execute function ${functionName}()`);
    try {
      const before = await fixture.state();
      await admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        const command = await commandForRows(tx, fixture, clock, rows);
        const heads = await loadPointCommitHeads(tx, { record: clock, scopeUuid: fixture.scopeUuid }, command, {});
        const result = await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: first.commitSeq, clock,
          loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: [], developerBuilds: [],
          uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {} }))
          .then(() => Result.succeed(undefined), (cause: unknown) => Result.fail(cause));
        if (Result.isSuccess(result)) throw new Error("Composed materialization accepted prior-page corruption");
        if (!(result.failure instanceof AppRowStorageCorruptionError)) throw result.failure;
        expect(result.failure.identity).toEqual({ scopeId: fixture.scopeId, tableId: first.tableId, rowId: first.rowId });
        await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
      });
      expect(await fixture.state()).toEqual(before);
    } finally { await persistence.query(`drop trigger materialization_prior_page_after on ${rowTable}`); }
  } finally { await persistence.query(`drop function ${functionName}()`); }
}

/** A later index page changes a non-key field of an earlier revision. The
 * invocation-wide proof must compare full tuples, not just current pointers. */
async function verifyCompositionEarlierIndexPageProof(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 404);
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (let ordinal = 0; ordinal < 33; ordinal++) rows.push(await fixture.row(ordinal));
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) throw new Error("Missing cross-page materialization index rows");
  const indexTable = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(fxAppIndexEntryRevisions))}`).sql;
  const functionName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.materialization_prior_index_page_after`).sql;
  await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
    begin
      if NEW."${fxAppIndexEntryRevisions.rowId.name}" = decode('${last.rowId}','hex') then
        update ${indexTable} set "${fxAppIndexEntryRevisions.physicalSpecSha256.name}" = decode(repeat('ff',32),'hex')
          where "${fxAppIndexEntryRevisions.scopeUuid.name}" = NEW."${fxAppIndexEntryRevisions.scopeUuid.name}"
            and "${fxAppIndexEntryRevisions.indexDefinitionId.name}" = NEW."${fxAppIndexEntryRevisions.indexDefinitionId.name}"
            and "${fxAppIndexEntryRevisions.rowId.name}" = decode('${first.rowId}','hex')
            and "${fxAppIndexEntryRevisions.commitSeq.name}" = NEW."${fxAppIndexEntryRevisions.commitSeq.name}";
      end if;
      return NEW;
    end $$`);
  try {
    await persistence.query(`create trigger materialization_prior_index_page_after after insert on ${indexTable}
      for each row execute function ${functionName}()`);
    try {
      const before = await fixture.state();
      await admitted(fixture.database, async tx => {
        const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
        const command = await commandForRows(tx, fixture, clock, rows);
        const heads = await loadPointCommitHeads(tx, { record: clock, scopeUuid: fixture.scopeUuid }, command, {});
        const positions = rows.map(revision => {
          const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(fixture.developer, revision.document, revision.creationTime));
          if (encodedKey === null) throw new Error("Missing genuine cross-page developer index key");
          return { definition: fixture.developer, encodedKey, rowId: decodeOrderedIndexRowIdHexV1(revision.rowId) };
        });
        const selection = await runEffect(readAppIndexMembershipHeadsInTransactionEffect(tx,
          { scopeId: fixture.scopeId, positions }));
        const actions = positions.map(position => ({ kind: "live", ...position, membershipHeadEvidence: selection.evidence } as const));
        const result = await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: first.commitSeq, clock,
          loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: actions, developerBuilds: [],
          uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options: {} }))
          .then(() => Result.succeed(undefined), (cause: unknown) => Result.fail(cause));
        if (Result.isSuccess(result)) throw new Error("Composed materialization accepted prior index-page corruption");
        if (!(result.failure instanceof AppIndexEntryStorageCorruptionError)) throw result.failure;
        expect(result.failure.reason).toBe("index revision or current membership differs after application");
        expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
          family: Schema.Literal("index"), pageOffset: Schema.Literal(32),
          detail: Schema.fromJsonString(Schema.Struct({
            reason: Schema.Literal("storedCorruption"), phase: Schema.Literal("verify"), ordinal: Schema.Literal(0),
          })),
        })))(applicationDomainFailureDetail(result.failure.cause, "fx_apply_app_materialization"))).toEqual({
          family: "index", pageOffset: 32, detail: { reason: "storedCorruption", phase: "verify", ordinal: 0 },
        });
        await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
      });
      expect(await fixture.state()).toEqual(before);
    } finally { await persistence.query(`drop trigger materialization_prior_index_page_after on ${indexTable}`); }
  } finally { await persistence.query(`drop function ${functionName}()`); }
}

const uniqueKey = (value: string): AppUniqueKeyProjectionV1 => ({ sparse: false, localeKey: null,
  values: [orderedIndexValueFromFlarexValueV1(value)] });

/** An awaited release callback changes an omitted selected owner. The final
 * proof must cover that absence even though it emitted no release or claim. */
async function verifyFrozenUniqueCallbackAbsence(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 1121);
  const published = await persistence.publishAppSchemaV1({ deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.schemaVersionId, version: CatalogSchemaVersionSchema.make(1),
    tables: [{ logicalName: "documents", definition: { kind: "appDocument", definitionVersion: 1,
      documentType: { type: "object", value: {
        title: { fieldType: { type: "string" }, optional: false },
        handle: { fieldType: { type: "string" }, optional: true },
      } } } }], indexes: [] });
  expect(published.manifest.tableDefinitions.tables[0]?.tableId).toBe(fixture.tableId);
  const binding = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(fixture.database, {
    deploymentId: fixture.deploymentId, schemaVersionId: fixture.schemaVersionId, tableId: fixture.tableId,
    descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_handle"),
    physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({ kind: "appUniqueConstraint", specVersion: 1,
      orderedFields: ["handle"], sparse: true, localePolicy: { kind: "none" },
      keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1 }),
  }));
  const bound = await admitted(fixture.database, tx => runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, binding)));
  const definition = await runEffect(locateAppUniqueConstraintDefinitionByIdEffect(fixture.database,
    fixture.deploymentId, fixture.scopeId, fixture.schemaVersionId, bound.definition.uniqueConstraintDefinitionId));
  if (definition === null) throw new Error("Missing genuine callback unique definition");
  const first = await fixture.row(1);
  const claimed = { ...first, document: await canonicalizeAppDocumentV1({ tableId: first.tableId,
    rowId: first.rowId, creationTime: first.creationTime, fields: { title: "claimed", handle: "released" } }) };
  const omitted = await fixture.row(2);
  const originals = await seedIndexOriginals(fixture, [claimed, omitted], "enabled", false);
  const originalKey = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(definition, claimed.document));
  if (originalKey.kind !== "claim") throw new Error("Genuine original unique key is omitted");
  const contradictoryKey = Result.getOrThrow(lowerCanonicalAppUniqueConstraintV1Result(definition,
    await canonicalizeAppDocumentV1({ tableId: omitted.tableId, rowId: omitted.rowId,
      creationTime: omitted.creationTime, fields: { title: "callback", handle: "contradictory_callback" } })));
  if (contradictoryKey.kind !== "claim") throw new Error("Genuine callback unique key is omitted");
  await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId: fixture.scopeId,
      tableId: claimed.tableId, rowId: claimed.rowId, writeEpoch: clock.epoch,
      constraintId: definition.uniqueConstraintDefinitionId, previous: null, next: originalKey.projection }]));
    await tx.insert(fxSystemUniqueConstraintBuilds).values({ scopeId: fixture.scopeId,
      uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId,
      storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
      storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
      startCommitSeq: CommitSeqSchema.make(0n), coveredThroughCommitSeq: clock.lastCommitSeq,
      lifecycle: "enabled", attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(1n) });
  });
  const finals = [await fixture.row(1, 2n, 1n), await fixture.row(2, 2n, 1n)];
  const command = await admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    return commandForRows(tx, fixture, clock, finals);
  });
  const prepared = await runEffect(prepareApplicationDocumentSettlementEffect(command, originals, [], [definition], null, []));
  if (prepared.unique === undefined || Exit.isFailure(prepared.unique)) throw new Error("Expected genuine canonical unique pairs");
  const pairs = prepared.unique.value;
  expect(pairs).toHaveLength(2);
  expect(pairs[1]?.previousCanonical).toEqual({ kind: "omitted", reason: "sparseMissing", localeKey: "" });
  expect(pairs[1]?.nextCanonical).toEqual({ kind: "omitted", reason: "sparseMissing", localeKey: "" });
  const inventory = async () => ({ ...await fixture.state(),
    clock: await fixture.database.select().from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId)),
    builds: await fixture.database.select().from(fxSystemUniqueConstraintBuilds).where(eq(fxSystemUniqueConstraintBuilds.scopeId, fixture.scopeId)) });
  const before = await inventory();
  const steps: string[] = [];
  let injected = false;
  await expect(admitted(fixture.database, async tx => {
    const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const heads = await loadPointCommitHeads(tx, { record: clock, scopeUuid: fixture.scopeUuid }, command, {});
    const actions = await runEffect(acceptPreparedApplicationUniqueOwnersEffect(tx, prepared, clock.epoch));
    expect(actions).toHaveLength(1);
    expect(actions[0]?.phase).toBe("release");
    await materializeApplicationDocumentRows(tx, { command, commitSeq: CommitSeqSchema.make(2n), clock,
      loadedHeads: heads, intrinsicBuilds: [], developerIndexActions: [], developerBuilds: [],
      uniqueKeyActions: actions, uniqueDefinitions: [definition], canonicalUniquePairs: pairs, publicationProfile: "sourceBound",
      options: { afterTransactionStep: async event => {
        steps.push(event.step);
        if (event.step !== "uniqueKeyWritten") return;
        expect(injected).toBe(false);
        expect(await tx.select().from(fxAppUniqueKeys).where(eq(fxAppUniqueKeys.scopeUuid, fixture.scopeUuid))).toEqual([]);
        await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{ scopeId: fixture.scopeId,
          tableId: omitted.tableId, rowId: omitted.rowId, writeEpoch: clock.epoch,
          constraintId: definition.uniqueConstraintDefinitionId, previous: null, next: contradictoryKey.projection }]));
        injected = true;
      } }, preparedIntrinsic: prepared.intrinsic });
  })).rejects.toMatchObject({ reason: "uniqueKeyTransitionInvalid" });
  expect(injected).toBe(true);
  expect(steps.filter(step => step === "uniqueKeyWritten")).toHaveLength(1);
  expect(steps).not.toContain("uniqueKeyBatchWritten");
  expect(await inventory()).toEqual(before);
}

/** Preparation observes no parent. The same accepting statement writes the
 * parent, then requires that genuine live row for the new unique claim. */
async function verifyCompositionFreshUniqueParent(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 201);
  const row = await fixture.row(1);
  const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(71));
  const mutation = { scopeId: fixture.scopeId, tableId: row.tableId, rowId: row.rowId,
    writeEpoch: fixture.writeEpoch, constraintId, previous: null, next: uniqueKey("new_parent") };
  const before = await fixture.state();
  // A unique-only block must still perform its actual parent admission.
  await expect(admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const unique = await runEffect(prepareAppUniqueMutationApplicationEffect(tx, [mutation]));
    await throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
      { scopeUuid: fixture.scopeUuid, commitSeq: row.commitSeq, unique })));
  })).rejects.toBeInstanceOf(AppUniqueKeyParentRowError);
  expect(await fixture.state()).toEqual(before);
  await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    expect((await runEffect(readCurrentAppRowInTransactionEffect(tx, row))).kind).toBe("missing");
    const rows = await runEffect(prepareAppRowRevisionApplicationEffect(tx, [row]));
    const unique = await runEffect(prepareAppUniqueMutationApplicationEffect(tx, [mutation]));
    expect((await runEffect(readCurrentAppRowInTransactionEffect(tx, row))).kind).toBe("missing");
    await throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
      { scopeUuid: fixture.scopeUuid, commitSeq: row.commitSeq, rows, unique })));
    const parent = await runEffect(readCurrentAppRowInTransactionEffect(tx, row));
    if (parent.kind !== "live") throw new Error("Composed unique parent is not live");
    expect(parent.document.canonicalBytes).toEqual(row.document.canonicalBytes);
    const claims = await tx.select().from(fxAppUniqueKeys).where(and(
      eq(fxAppUniqueKeys.scopeUuid, fixture.scopeUuid), eq(fxAppUniqueKeys.constraintId, constraintId)));
    expect(claims).toHaveLength(1);
    expect(claims.map(claim => encodeBytesToLowercaseHex(claim.rowId))).toEqual([row.rowId]);
  });
  const after = await fixture.state();
  expect(after.rows).toHaveLength(1);
  expect(after.pointers).toHaveLength(1);
  expect(after.unique).toHaveLength(1);
  const nullableFaults = [
    { table: fxAppRowRevisions, column: fxAppRowRevisions.isTombstone, stage: "parent",
      selection: sql`${sql.identifier(fxAppRowRevisions.scopeUuid.name)} = ${fixture.scopeUuid}
        and ${sql.identifier(fxAppRowRevisions.tableId.name)} = ${row.tableId}
        and ${sql.identifier(fxAppRowRevisions.rowId.name)} = ${appRowIdHexV1ToBytes(row.rowId)}
        and ${sql.identifier(fxAppRowRevisions.commitSeq.name)} = ${row.commitSeq}` },
    { table: fxAppUniqueKeys, column: fxAppUniqueKeys.encodedKey, stage: "stored",
      selection: sql`${sql.identifier(fxAppUniqueKeys.scopeUuid.name)} = ${fixture.scopeUuid}
        and ${sql.identifier(fxAppUniqueKeys.constraintId.name)} = ${constraintId}
        and ${sql.identifier(fxAppUniqueKeys.tableId.name)} = ${row.tableId}
        and ${sql.identifier(fxAppUniqueKeys.rowId.name)} = ${appRowIdHexV1ToBytes(row.rowId)}` },
  ] as const;
  for (const fault of nullableFaults) {
    await admitted(fixture.database, async tx => {
      await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
      const targetTable = sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(fault.table))}`;
      // Admission must fail closed even when a privileged mutation defeats
      // the exact physical scalar constraint inside the same transaction.
      await tx.execute(sql`alter table ${targetTable} alter column ${sql.identifier(fault.column.name)} drop not null`);
      await tx.execute(sql`update ${targetTable} set ${sql.identifier(fault.column.name)} = null where ${fault.selection}`);
      const unique = await runEffect(prepareAppUniqueMutationApplicationEffect(tx,
        [{ ...mutation, previous: mutation.next }]));
      const result = await throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
        { scopeUuid: fixture.scopeUuid, commitSeq: row.commitSeq, unique })))
        .then(() => Result.succeed(undefined), (cause: unknown) => Result.fail(cause));
      if (Result.isSuccess(result)) throw new Error(`Composed unique admission accepted a null ${fault.column.name}`);
      if (!(result.failure instanceof AppUniqueKeyStorageCorruptionError)) throw result.failure;
      expect(result.failure.cause).toMatchObject({ cause: { code: "FX001" } });
      expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
        family: Schema.Literal("unique"), pageOffset: Schema.Literal(0),
        detail: Schema.fromJsonString(Schema.Struct({ kind: Schema.Literal("admission"),
          reason: Schema.Literal("storedCorruption"), stage: Schema.Literal(fault.stage), ordinal: Schema.Literal(0),
          actualTableId: Schema.Null, actualRowIdHex: Schema.Null })),
      })), { onExcessProperty: "error" })(applicationDomainFailureDetail(result.failure.cause, "fx_apply_app_materialization")))
        .toEqual({ family: "unique", pageOffset: 0, detail: { kind: "admission", reason: "storedCorruption",
          stage: fault.stage, ordinal: 0, actualTableId: null, actualRowIdHex: null } });
      await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
    });
    expect(await fixture.state()).toEqual(after);
    const restoredScalar = await persistence.query<{ required: boolean }>(`select attnotnull as required from pg_attribute
      where attrelid = format('%I.%I', $1::text, $2::text)::regclass and attname = $3`,
      [fixture.schemaName, getTableName(fault.table), fault.column.name]);
    expect(restoredScalar.rows).toEqual([{ required: true }]);
  }
}

/** Both refusals exist at once. Current destination conflict must win; once
 * its real owner releases it, the unchanged contradictory previous pin wins. */
async function verifyCompositionUniqueRefusalOrder(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 301);
  const first = await fixture.row(1);
  const second = await fixture.row(2);
  const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(72));
  const firstKey = uniqueKey("first_owner");
  const secondKey = uniqueKey("occupied_destination");
  const mutation = (row: AppendPreparedLiveAppRowRevisionV1Input,
    previous: AppUniqueKeyProjectionV1 | null, next: AppUniqueKeyProjectionV1 | null) => ({
    scopeId: fixture.scopeId, tableId: row.tableId, rowId: row.rowId, writeEpoch: fixture.writeEpoch,
    constraintId, previous, next,
  });
  await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [first, second]));
    await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx,
      [mutation(first, null, firstKey), mutation(second, null, secondKey)]));
  });
  const apply = (previous: AppUniqueKeyProjectionV1) => admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const unique = await runEffect(prepareAppUniqueMutationApplicationEffect(tx,
      [mutation(first, previous, secondKey)]));
    return throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
      { scopeUuid: fixture.scopeUuid, commitSeq: first.commitSeq, unique })));
  });
  const before = await fixture.state();
  const conflict = await apply(uniqueKey("contradictory_previous")).then(() => {
    throw new Error("Composed unique admission accepted an occupied destination and contradictory previous pin");
  }, (cause: unknown) => cause);
  if (!(conflict instanceof AppUniqueKeyConflictError)) throw conflict;
  expect(conflict.ownerTableId).toBe(second.tableId);
  expect(conflict.ownerRowId).toBe(second.rowId);
  expect(await fixture.state()).toEqual(before);
  await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [mutation(second, secondKey, null)]));
  });
  const released = await fixture.state();
  await expect(apply(uniqueKey("contradictory_previous"))).rejects.toBeInstanceOf(AppUniqueKeyPreviousClaimMismatchError);
  expect(await fixture.state()).toEqual(released);
  await apply(firstKey);
  const accepted = await fixture.state();
  expect(accepted.unique).toHaveLength(1);
  expect(accepted.unique.map(claim => encodeBytesToLowercaseHex(claim.rowId))).toEqual([first.rowId]);
  expect(accepted.rows).toEqual(released.rows);
  expect(accepted.pointers).toEqual(released.pointers);
}

/** Segmentation, accepted effect counts and complete earlier-input proofs
 * belong to the same row/search accepting operation on both drivers. */
async function verifyCompositionSearchPages(persistence: MaterializationCompositionPersistence) {
  const fixture = await compositionFixture(persistence, 601);
  const textId = decodeCatalogIndexId(11);
  const jsonId = decodeCatalogIndexId(12);
  const definitions: readonly LogicalSearchDefinition[] = [
    { kind: "text", tableId: fixture.tableId, logicalIndexId: textId,
      sourceSha256: "a".repeat(64), columns: ["title"], nullPredicateField: null },
    { kind: "jsonContainment", tableId: fixture.tableId, logicalIndexId: jsonId,
      sourceSha256: "b".repeat(64), columns: ["metadata"], nullPredicateField: null },
  ];
  await fixture.database.insert(fxControlIndexes).values([
    { deploymentId: fixture.deploymentId, tableId: fixture.tableId, logicalIndexId: textId, descriptor: "search_title" },
    { deploymentId: fixture.deploymentId, tableId: fixture.tableId, logicalIndexId: jsonId, descriptor: "json_metadata" },
  ]);
  const metadata = (ordinal: number, sequence: bigint) => ({ ordinal, revision: Number(sequence), tags: [`tag_${ordinal}`, "shared"] });
  const searchRow = async (ordinal: number, sequence = 1n,
    previous: bigint | null = null): Promise<AppendPreparedLiveAppRowRevisionV1Input> => {
    const row = await fixture.row(ordinal, sequence, previous);
    return { ...row, document: await canonicalizeAppDocumentV1({ tableId: row.tableId, rowId: row.rowId,
      creationTime: row.creationTime, fields: { title: `TITLE_${ordinal}_VERSION_${sequence}`, metadata: metadata(ordinal, sequence) } }) };
  };
  const changes = (rows: readonly AppendPreparedLiveAppRowRevisionV1Input[]) => rows.map(row => ({
    kind: "live", tableId: row.tableId, rowId: row.rowId, document: row.document,
  } as const));
  const sentinel = await searchRow(255);
  await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [sentinel]));
    await runEffect(maintainLogicalSearchEntries(tx, fixture.scopeUuid, sentinel.commitSeq, definitions, changes([sentinel])));
  });
  await fixture.database.insert(fxSystemSearchBuildStates).values(definitions.map(definition => ({
    scopeUuid: fixture.scopeUuid, tableId: definition.tableId, logicalIndexId: definition.logicalIndexId,
    sourceSha256: definition.sourceSha256, lifecycle: "ready" as const, coveredThroughCommitSeq: CommitSeqSchema.make(0n),
  })));
  const inventory = async () => ({
    domain: await fixture.state(),
    text: await fixture.database.select().from(fxAppSearchEntryCurrent)
      .where(eq(fxAppSearchEntryCurrent.scopeUuid, fixture.scopeUuid))
      .orderBy(fxAppSearchEntryCurrent.logicalIndexId, fxAppSearchEntryCurrent.fieldId, fxAppSearchEntryCurrent.rowId),
    json: await fixture.database.select().from(fxAppJsonEntryCurrent)
      .where(eq(fxAppJsonEntryCurrent.scopeUuid, fixture.scopeUuid))
      .orderBy(fxAppJsonEntryCurrent.logicalIndexId, fxAppJsonEntryCurrent.fieldId, fxAppJsonEntryCurrent.rowId),
    builds: await fixture.database.select().from(fxSystemSearchBuildStates)
      .where(eq(fxSystemSearchBuildStates.scopeUuid, fixture.scopeUuid)).orderBy(fxSystemSearchBuildStates.logicalIndexId),
  });
  const initial = await inventory();
  const rows: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (let ordinal = 0; ordinal < 33; ordinal++) rows.push(await searchRow(ordinal));
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) throw new Error("Missing paged search input");
  const proof = await admitted(fixture.database, async tx => {
    await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
    const preparedRows = await runEffect(prepareAppRowRevisionApplicationEffect(tx, rows));
    const search = Array.from(prepareLogicalSearchApplications(definitions, changes(rows), fixture.scopeUuid, first.commitSeq),
      stage => Result.getOrThrow(stage));
    return throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
      { scopeUuid: fixture.scopeUuid, commitSeq: first.commitSeq, rows: preparedRows, search })));
  });
  // This is the actual returned acceptance proof, not a guessed observation
  // based on how many definitions were submitted.
  expect(proof.search_count).toBe(66);
  expect(proof.search_build_count).toBe(2);
  const selectedIds = new Set(rows.map(row => row.rowId));
  const stored = await inventory();
  const selectedText = stored.text.filter(entry => selectedIds.has(decodeAppRowIdHexV1(encodeBytesToLowercaseHex(entry.rowId))));
  const selectedJson = stored.json.filter(entry => selectedIds.has(decodeAppRowIdHexV1(encodeBytesToLowercaseHex(entry.rowId))));
  expect(selectedText.map(entry => ({ rowId: encodeBytesToLowercaseHex(entry.rowId), logicalIndexId: entry.logicalIndexId,
    fieldId: entry.fieldId, foldedText: entry.foldedText, sourceSha256: entry.sourceSha256, commitSeq: entry.commitSeq })))
    .toEqual(rows.map((row, ordinal) => ({ rowId: row.rowId, logicalIndexId: textId, fieldId: "title",
      foldedText: `title_${ordinal}_version_1`, sourceSha256: "a".repeat(64), commitSeq: 1n })));
  expect(selectedJson.map(entry => ({ rowId: encodeBytesToLowercaseHex(entry.rowId), logicalIndexId: entry.logicalIndexId,
    fieldId: entry.fieldId, valueJson: entry.valueJson, sourceSha256: entry.sourceSha256, commitSeq: entry.commitSeq })))
    .toEqual(rows.map((row, ordinal) => ({ rowId: row.rowId, logicalIndexId: jsonId, fieldId: "metadata",
      valueJson: metadata(ordinal, 1n), sourceSha256: "b".repeat(64), commitSeq: 1n })));
  expect(stored.text.filter(entry => encodeBytesToLowercaseHex(entry.rowId) === sentinel.rowId)).toEqual(initial.text);
  expect(stored.json.filter(entry => encodeBytesToLowercaseHex(entry.rowId) === sentinel.rowId)).toEqual(initial.json);
  expect(stored.builds.map(build => ({ logicalIndexId: build.logicalIndexId, lifecycle: build.lifecycle,
    sourceSha256: build.sourceSha256, coveredThroughCommitSeq: build.coveredThroughCommitSeq }))).toEqual([
    { logicalIndexId: textId, lifecycle: "ready", sourceSha256: "a".repeat(64), coveredThroughCommitSeq: 1n },
    { logicalIndexId: jsonId, lifecycle: "ready", sourceSha256: "b".repeat(64), coveredThroughCommitSeq: 1n },
  ]);
  const updated: AppendPreparedLiveAppRowRevisionV1Input[] = [];
  for (let ordinal = 0; ordinal < 33; ordinal++) updated.push(await searchRow(ordinal, 2n, 1n));
  for (const family of ["text", "json"] as const) {
    const table = family === "text" ? fxAppSearchEntryCurrent : fxAppJsonEntryCurrent;
    const tableName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.${sql.identifier(getTableName(table))}`).sql;
    const functionName = new PgDialect().sqlToQuery(sql`${sql.identifier(fixture.schemaName)}.materialization_search_prior_page_after`).sql;
    const changedValue = family === "text"
      ? `"${fxAppSearchEntryCurrent.foldedText.name}" = "${fxAppSearchEntryCurrent.foldedText.name}" || '_tampered'`
      : `"${fxAppJsonEntryCurrent.valueJson.name}" = "${fxAppJsonEntryCurrent.valueJson.name}" || '{"tampered":true}'::jsonb`;
    await persistence.query(`create function ${functionName}() returns trigger language plpgsql as $$
      begin
        if NEW."${table.rowId.name}" = decode('${last.rowId}','hex') then
          update ${tableName} set ${changedValue}
            where "${table.scopeUuid.name}" = NEW."${table.scopeUuid.name}"
              and "${table.tableId.name}" = NEW."${table.tableId.name}"
              and "${table.logicalIndexId.name}" = NEW."${table.logicalIndexId.name}"
              and "${table.fieldId.name}" = NEW."${table.fieldId.name}"
              and "${table.rowId.name}" = decode('${first.rowId}','hex');
        end if;
        return NEW;
      end $$`);
    try {
      await persistence.query(`create trigger materialization_search_prior_page_after after insert on ${tableName}
        for each row execute function ${functionName}()`);
      try {
        await admitted(fixture.database, async tx => {
          await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
          const preparedRows = await runEffect(prepareAppRowRevisionApplicationEffect(tx, updated));
          const search = Array.from(prepareLogicalSearchApplications(definitions, changes(updated), fixture.scopeUuid, CommitSeqSchema.make(2n)),
            stage => Result.getOrThrow(stage));
          const result = await throughCompositor(tx, () => runEffect(applyPreparedApplicationMaterializationEffect(tx,
            { scopeUuid: fixture.scopeUuid, commitSeq: CommitSeqSchema.make(2n), rows: preparedRows, search })))
            .then(() => Result.succeed(undefined), (cause: unknown) => Result.fail(cause));
          if (Result.isSuccess(result)) throw new Error(`Composed ${family} search accepted prior-page corruption`);
          if (!(result.failure instanceof LogicalSearchMaintenanceError)) throw result.failure;
          expect(result.failure.reason).toBe("storedCorruption");
          expect(result.failure.cause).toMatchObject({ cause: { code: "FX001" } });
          await expect(tx.execute(sql`select 1`)).rejects.toMatchObject({ cause: { code: "25P02" } });
        });
        expect(await inventory()).toEqual(stored);
      } finally { await persistence.query(`drop trigger materialization_search_prior_page_after on ${tableName}`); }
    } finally { await persistence.query(`drop function ${functionName}()`); }
  }
}

/** The callback stays inside the original transaction and suspends before any
 * index effects. It observes real provisional rows through the existing reader. */
async function verifyAwaitedMaterializationCallback(persistence: MaterializationCompositionPersistence) {
  const paused = await compositionFixture(persistence, 501);
  const uninterrupted = await compositionFixture(persistence, 502);
  const entered = await runEffect(Deferred.make<void>());
  const resume = await runEffect(Deferred.make<void>());
  const steps: string[] = [];
  let provisionalObserved = false;
  let completionObserved = false;
  const materialize = async (fixture: Awaited<ReturnType<typeof compositionFixture>>, callbacks: boolean) => {
    const revision = await fixture.row(1);
    return admitted(fixture.database, async tx => {
      const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
      await tx.insert(fxSystemIndexBuildStates).values({ scopeId: fixture.scopeId,
        indexDefinitionId: fixture.intrinsic.indexDefinitionId,
        storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
        storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
        startCommitSeq: clock.lastCommitSeq, coveredThroughCommitSeq: clock.lastCommitSeq,
        firstReadableCommitSeq: clock.lastCommitSeq, lifecycle: "enabled",
        cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), attemptFence: IndexBuildAttemptFenceSchema.make(1n) });
      const snapshotToken = SnapshotTokenSchema.make({ scopeId: fixture.scopeId, epoch: clock.epoch, commitSeq: clock.lastCommitSeq });
      const read = await runEffect(getAppRowAtSnapshotInTransactionEffect(tx,
        { tableId: revision.tableId, rowId: revision.rowId, snapshotToken }));
      if (read.dependency.kind !== "missing") throw new Error("Expected genuinely absent materialization row");
      const documentId = appDocumentIdV1FromRowIdentity(revision);
      const dependency = { kind: "appRowPoint", documentId,
        observed: { kind: "missing", basis: read.dependency.basis } } as const;
      const command: ApplicationDocumentMaterializationCommand = {
        authorityPins: { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId,
          schemaVersionId: fixture.schemaVersionId, snapshotToken },
        dependencies: [{ documentId, tableId: revision.tableId, rowId: revision.rowId, dependency }],
        rowIntents: [{ kind: "live", documentId, tableId: revision.tableId, rowId: revision.rowId,
          dependency, creationTime: revision.creationTime, document: revision.document }],
      };
      const context = { record: clock, scopeUuid: fixture.scopeUuid };
      const heads = await loadPointCommitHeads(tx, context, command, {});
      const builds = await lockPointCommitIntrinsicIndexBuilds(tx, context, [fixture.intrinsic], command);
      const options: ApplicationDocumentMaterializationOptions = callbacks ? { afterTransactionStep: async event => {
        steps.push(event.step);
        if (event.step !== "rowBatchWritten") return;
        const provisional = await runEffect(readCurrentAppRowInTransactionEffect(tx, revision));
        expect(provisional.kind).toBe("live");
        if (provisional.kind !== "live") throw new Error("Provisional row was not live");
        expect(provisional.document.canonicalBytes).toEqual(revision.document.canonicalBytes);
        expect(provisional.commitSeq).toBe(1n);
        expect(await tx.select().from(fxAppIndexEntryCurrent).where(and(
          eq(fxAppIndexEntryCurrent.scopeUuid, fixture.scopeUuid),
          eq(fxAppIndexEntryCurrent.indexDefinitionId, fixture.intrinsic.indexDefinitionId)))).toEqual([]);
        provisionalObserved = true;
        await runEffect(Deferred.succeed(entered, undefined));
        await runEffect(Deferred.await(resume));
      } } : {};
      await throughCompositor(tx, () => materializeApplicationDocumentRows(tx, { command, commitSeq: revision.commitSeq, clock,
        loadedHeads: heads, intrinsicBuilds: builds, developerIndexActions: [], developerBuilds: [],
        uniqueKeyActions: [], uniqueDefinitions: [], canonicalUniquePairs: [], publicationProfile: "sourceBound", options }));
    });
  };
  const writing = materialize(paused, true).then(() => { completionObserved = true; });
  // A failure before the callback must reject instead of leaving the witness
  // waiting for a signal which cannot arrive.
  const arrived = runEffect(Effect.raceFirst(Deferred.await(entered), Effect.tryPromise({
    try: () => writing, catch: cause => cause,
  }).pipe(Effect.andThen(Effect.fail(new Error("Materializer completed before its awaited row callback"))))));
  try {
    await arrived;
    expect(provisionalObserved).toBe(true);
    expect(completionObserved).toBe(false);
    expect(steps).toContain("rowBatchWritten");
    expect(steps).not.toContain("indexBatchWriting");
  } finally {
    await runEffect(Deferred.succeed(resume, undefined));
    await writing;
  }
  await materialize(uninterrupted, false);
  const normalized = (state: Awaited<ReturnType<typeof paused.state>>) => ({
    rows: state.rows.map(row => ({ tableId: row.tableId, rowId: row.rowId,
      commitSeq: row.commitSeq, prevCommitSeq: row.prevCommitSeq, creationTime: row.creationTime,
      valueBytes: row.valueBytes, valueSha256: row.valueSha256, isTombstone: row.isTombstone })),
    pointers: state.pointers.map(pointer => ({ tableId: pointer.tableId, rowId: pointer.rowId, commitSeq: pointer.commitSeq })),
    indexes: state.indexes.map(entry => ({ indexDefinitionId: entry.indexDefinitionId, rowId: entry.rowId,
      encodedKey: entry.encodedKey, commitSeq: entry.commitSeq, isTombstone: entry.isTombstone })),
    indexPointers: state.indexPointers.map(pointer => ({ indexDefinitionId: pointer.indexDefinitionId,
      rowId: pointer.rowId, encodedKey: pointer.encodedKey, commitSeq: pointer.commitSeq })),
  });
  expect(normalized(await paused.state())).toEqual(normalized(await uninterrupted.state()));
  expect((await paused.state()).rows).toHaveLength(1);
  expect((await paused.state()).indexes).toHaveLength(1);
  expect(steps.indexOf("rowBatchWritten")).toBeLessThan(steps.indexOf("indexBatchWriting"));
  expect(steps).toContain("intrinsicIndexEntryWritten");
}

/** A real row callback crosses the shared Promise bridge after the provisional
 * write. The logical owner translates only Fail while the transaction rolls back. */
async function verifyLogicalMaterializationCauseRollback(persistence: MaterializationCompositionPersistence) {
  const variants = ["failure and defect", "failure and interruption", "defect", "failure"] as const;
  for (const [ordinal, variant] of variants.entries()) {
    const fixture = await compositionFixture(persistence, 1141 + ordinal);
    const revision = await fixture.row(1);
    const target = createLocatedIndexBuildReconciliationTargetV1(fixture.database,
      { kind: "shared_database", databaseKey: "materialization_composition", schemaName: fixture.schemaName });
    const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(fixture.deploymentId, {
      scopeMetadata: { getScopeMetadataByDeploymentId: id => getScopeMetadataByDeploymentId(fixture.database, id) },
      provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => null },
      scopeClockTargets: { resolve: async () => target },
    }));
    await admitted(fixture.database, async tx => {
      const clock = await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId));
      await tx.insert(fxSystemIndexBuildStates).values({ scopeId: fixture.scopeId,
        indexDefinitionId: fixture.intrinsic.indexDefinitionId,
        storageGeneration: Schema.decodeUnknownSync(FlarexDbV1StorageGenerationSchema)(clock.storageGeneration),
        storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
        startCommitSeq: clock.lastCommitSeq, coveredThroughCommitSeq: clock.lastCommitSeq,
        firstReadableCommitSeq: clock.lastCommitSeq, lifecycle: "enabled",
        cursorCodecVersion: IndexBuildCursorCodecVersionV1Schema.make(1), attemptFence: IndexBuildAttemptFenceSchema.make(1n) });
    });
    const durableState = async () => ({ ...await fixture.state(),
      clock: await fixture.database.select().from(fxSystemScopeClocks)
        .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId)),
      builds: await fixture.database.select().from(fxSystemIndexBuildStates)
        .where(eq(fxSystemIndexBuildStates.scopeId, fixture.scopeId)).orderBy(fxSystemIndexBuildStates.indexDefinitionId),
      uniqueBuilds: await fixture.database.select().from(fxSystemUniqueConstraintBuilds)
        .where(eq(fxSystemUniqueConstraintBuilds.scopeId, fixture.scopeId)),
      search: await fixture.database.select().from(fxAppSearchEntryCurrent)
        .where(eq(fxAppSearchEntryCurrent.scopeUuid, fixture.scopeUuid)),
      json: await fixture.database.select().from(fxAppJsonEntryCurrent)
        .where(eq(fxAppJsonEntryCurrent.scopeUuid, fixture.scopeUuid)),
      searchBuilds: await fixture.database.select().from(fxSystemSearchBuildStates)
        .where(eq(fxSystemSearchBuildStates.scopeUuid, fixture.scopeUuid)),
    });
    const before = await durableState();
    const failure = new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" });
    const defect = new TypeError("Invalid stored materializer callback value");
    const interruptor = 711 + ordinal;
    const cause = variant === "failure and defect" ? Cause.combine(Cause.fail(failure), Cause.die(defect))
      : variant === "failure and interruption" ? Cause.combine(Cause.fail(failure), Cause.interrupt(interruptor))
        : variant === "defect" ? Cause.die(defect) : Cause.fail(failure);
    const steps: string[] = [];
    let provisionalObserved = false;
    let laterWriteReached = false;
    const exit = await Effect.runPromiseExit(runEffectTransaction(
      callback => fixture.database.transaction(callback), "Materializer callback Cause rollback",
      tx => Effect.gen(function* () {
        const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, fixture.scopeId);
        const command = yield* Effect.tryPromise({ try: () => commandForRows(tx, fixture, clock, [revision]),
          catch: cause => new Error("Capture genuine row observation", { cause }) });
        const intent = command.rowIntents[0];
        if (intent === undefined) throw new Error("Missing genuine row intent");
        // The logical owner requires the changed observation itself in the
        // dependency set. Its dependency was acquired by the real snapshot reader.
        const change = { ...intent, readAt: clock.lastCommitSeq };
        const materialization = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound",
          command: { authorityPins: { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId,
            schemaVersionId: fixture.schemaVersionId }, rowIntents: [{ tableId: revision.tableId }] },
          intrinsic: [fixture.intrinsic], developer: [], unique: [], relations: null,
          requireAdmission: Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)).pipe(Effect.asVoid),
          validateWrites: () => Effect.void,
          options: { afterTransactionStep: async event => {
            steps.push(event.step);
            if (event.step !== "rowBatchWritten") return;
            const provisional = await runEffect(readCurrentAppRowInTransactionEffect(tx, revision));
            if (provisional.kind !== "live") throw new Error("Missing actual provisional callback row");
            expect(provisional.document.canonicalBytes).toEqual(revision.document.canonicalBytes);
            expect(provisional.commitSeq).toBe(clock.lastCommitSeq + 1n);
            expect(await tx.select().from(fxAppIndexEntryCurrent)
              .where(eq(fxAppIndexEntryCurrent.scopeUuid, fixture.scopeUuid))).toEqual([]);
            provisionalObserved = true;
            const result = await runPointCommitInTransactionEffect(Effect.failCause(cause));
            projectPointCommitTransactionResult(result);
          } },
        }, tx, located.authority, clock);
        const delta = yield* materialization.prepareDelta([change], [change]);
        yield* delta.lower(CommitSeqSchema.make(clock.lastCommitSeq + 1n));
        laterWriteReached = true;
        yield* Effect.tryPromise({ try: () => tx.update(fxSystemScopeClocks)
          .set({ lastCommitSeq: CommitSeqSchema.make(clock.lastCommitSeq + 1n) })
          .where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId)), catch: cause => new Error("Later clock write", { cause }) });
      }), cause => new Error("Materializer transaction settlement", { cause }),
    ));
    expect(provisionalObserved).toBe(true);
    expect(laterWriteReached).toBe(false);
    expect(steps).toContain("rowBatchWritten");
    expect(steps).not.toContain("indexBatchWriting");
    expect(steps).not.toContain("intrinsicIndexEntryWritten");
    if (Exit.isSuccess(exit)) throw new Error("Expected the complete callback Cause to refuse publication");
    const failures = exit.cause.reasons.filter(Cause.isFailReason);
    expect(failures).toHaveLength(variant === "defect" ? 0 : 1);
    for (const reason of failures) {
      expect(reason.error).toBeInstanceOf(LogicalDocumentMaterializationError);
      if (!(reason.error instanceof LogicalDocumentMaterializationError)) throw new Error("Missing logical Fail translation");
      expect(reason.error.reason).toBe("storedCorruption");
      expect(reason.error.cause).toBe(failure);
    }
    const defects = exit.cause.reasons.filter(Cause.isDieReason);
    expect(defects).toHaveLength(variant === "failure and defect" || variant === "defect" ? 1 : 0);
    for (const reason of defects) expect(reason.defect).toBe(defect);
    expect(exit.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
      .toEqual(variant === "failure and interruption" ? [interruptor] : []);
    expect(exit.cause.reasons).toHaveLength(cause.reasons.length);
    expect(await durableState()).toEqual(before);
  }
}

export const materializationCompositionCases = [
  { name: "logical materializer preserves mixed Causes and rolls back awaited provisional row writes", run: verifyLogicalMaterializationCauseRollback },
  { name: "frozen intrinsic membership follows real table identity across inverted definition allocation", run: verifyFrozenIntrinsicAllocationOrder },
  { name: "awaited unique release callback cannot contradict an omitted selected final owner", run: verifyFrozenUniqueCallbackAbsence },
  { name: "frozen initial intrinsic membership refuses both existing live and tombstone history", run: verifyFrozenIntrinsicInitialMembership },
  { name: "frozen intrinsic live and deleted rows retain enabled refusal and building missing-membership repair", run: verifyFrozenIntrinsicMissingMembership },
  { name: "frozen index pairs preserve enabled refusal and building same-key membership repair", run: verifyFrozenMissingMembership },
  { name: "native current membership counts actual 256 and 257 actions while accepting 384 no-op pairs", run: verifyFrozenActualIndexActionLimit },
  { name: "native private ordered-index capacity accepts 65,536 sparse pairs with zero actions and complete coverage", run: verifyNativeOrderedIndexPairCapacity },
  { name: "real row refusal precedes retained index and search preparation failures", run: verifyEarlierRowRefusal },
  { name: "same-page row and index RETURNING corruption precedes a later trigger failure", run: verifySamePageReturningOrder },
  { name: "unique admission reads its new parent after composed row writes", run: verifyCompositionFreshUniqueParent },
  { name: "actual unique destination conflict precedes contradictory previous ownership", run: verifyCompositionUniqueRefusalOrder },
  { name: "composed text and JSON search preserve selection, build counts and earlier-page proofs", run: verifyCompositionSearchPages },
  { name: "later-page AFTER corruption verifies full earlier materialization input and aborts", run: verifyCompositionEarlierPageProof },
  { name: "later index-page AFTER corruption verifies full earlier revision with ordinal zero and aborts", run: verifyCompositionEarlierIndexPageProof },
  { name: "awaited callbacks observe original provisional rows before index effects", run: verifyAwaitedMaterializationCallback },
] as const;
