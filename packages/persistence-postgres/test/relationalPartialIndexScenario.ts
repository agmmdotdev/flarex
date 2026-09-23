import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, appRowIdHexV1ToBytes, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CommitSeqSchema, StorageGenerationFenceSchema, projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { JsonObject } from "flarex-protocol/json";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import { locateAppIndexDefinitionByIdEffect, type AppIndexDefinitionRecord } from "../src/appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from "../src/appRows";
import { createLocatedIndexBuildReconciliationTargetV1, reconcilePublishedIndexBuildsV1Effect } from "../src/indexBuildReconciliation";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createLocatedAppUniqueConstraintSetBuildTargetV1, reconcileAppUniqueConstraintSetBuildV1Effect,
  advanceAppUniqueConstraintSetBackfillV1Effect, createAppUniqueConstraintSetEligibilityPortV1,
  loadAppUniqueConstraintSetEligibilityForReadinessV1Effect } from "../src/appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../src/appUniqueConstraintDefinitions";
import { getScopeMetadataByDeploymentId } from "../src/scopeMetadata";
import { getScopeClock, lockScopeClockForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import { fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppRowCurrent, fxAppRowRevisions, fxAppUniqueKeys, fxSystemUniqueConstraintBuilds, fxSystemScopeClocks, fxControlSchemaVersionIndexBindings, fxSystemIndexBuildStates } from "../src/schema";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { enterLogicalDocumentMaterialization } from "../src/logicalDocuments/materialization";
import { ensureLogicalStorageDefinitions, readLogicalStorageRequirements } from "../src/logicalStorageDefinitions";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import { validateLogicalDocumentChanges } from "../src/logicalDocuments/contribution";
import { prepareLogicalRelationalValueValidation } from "../src/logicalDocuments/relationalValues";
import { prepareLogicalStorageReadiness } from "../src/logicalStorageReadiness";

/** Actual complete-candidate reconciliation plus a native partial-index build.
 * Row revisions are fixture data; this is not serving or native initialization. */
export const relationalPartialIndexScenario = Effect.fn("RelationalPartialIndex.scenario")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, scopeId: ScopeId, schemaVersionId: CatalogSchemaVersionId,
  definition: AppIndexDefinitionRecord, nativeRows: readonly JsonObject[],
) {
  const clock = yield* Effect.tryPromise({ try: () => getScopeClock(db, scopeId), catch: cause => new Error("Read fixture clock", { cause }) });
  if (clock === null || nativeRows.length !== 123) throw new Error("Expected clock and complete native Currency seed");
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId));
  const transact = <Value, Failure>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) =>
    runEffectTransaction(callback => db.transaction(callback), "Partial index fixture rollback", work,
      cause => new Error("Partial index transaction failed", { cause }));
  const rowIds: AppRowIdHexV1[] = [];
  const writeNative = Effect.fn("RelationalPartialIndex.writeFixtureRevision")(function* (
    position: number, seq: bigint, deletedAt: string | null, previous: bigint | null,
  ) {
    const row = nativeRows[position];
    if (row === undefined) throw new Error("Missing native row");
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(new Uint8Array(16).fill(position + 1)));
    const creationTime = AppCreationTimeV1Schema.make(position + 1);
    const document = yield* Effect.tryPromise({ try: () => canonicalizeAppDocumentV1({
      tableId: definition.access.tableId, rowId, creationTime, fields: { ...row,
        created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z",
        deleted_at: deletedAt },
    }), catch: cause => new Error("Canonicalize native fixture row", { cause }) });
    const commitSeq = CommitSeqSchema.make(seq);
    yield* transact(tx => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live", scopeId, tableId: definition.access.tableId, rowId, writeEpoch: clock.epoch,
        commitSeq, prevCommitSeq: previous === null ? null : CommitSeqSchema.make(previous), schemaVersionId, creationTime,
        value: { codecVersion: document.codecVersion, valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes, sha256: document.sha256 },
      }), catch: cause => new Error("Insert native fixture row", { cause }) });
      yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(eq(fxSystemScopeClocks.scopeId, scopeId)),
        cause => new Error("Advance fixture clock", { cause }));
    }));
    return rowId;
  });
  rowIds.push(yield* writeNative(0, 1n, null, null));
  rowIds.push(yield* writeNative(1, 2n, "2026-09-20T00:00:00.000Z", null));
  const target = createLocatedIndexBuildReconciliationTargetV1(db, { kind: "shared_database", databaseKey: "test", schemaName: "public" });
  const ports = { controlDb: db, authority: {
    scopeMetadata: { getScopeMetadataByDeploymentId: (id: string) => getScopeMetadataByDeploymentId(db, id) },
    provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => null },
    scopeClockTargets: { resolve: async () => target },
  } };
  // An incomplete catalog must not declare even the otherwise valid Currency
  // build. Restore through the real preparation owner before replaying.
  yield* transact(tx => runDrizzleStatementEffect(tx.delete(fxControlSchemaVersionIndexBindings).where(and(
    eq(fxControlSchemaVersionIndexBindings.deploymentId, deploymentId),
    eq(fxControlSchemaVersionIndexBindings.schemaVersionId, schemaVersionId),
    eq(fxControlSchemaVersionIndexBindings.indexDefinitionId, definition.indexDefinitionId),
  )), cause => new Error("Arrange missing required binding", { cause })));
  expect(yield* Effect.result(reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, schemaVersionId })))
    .toMatchObject({ _tag: "Failure", failure: { reason: "publishedProjectionIncomplete" } });
  expect(yield* runDrizzleStatementEffect(db.select().from(fxSystemIndexBuildStates),
    cause => new Error("Read refused build declarations", { cause }))).toHaveLength(0);
  yield* transact(tx => ensureLogicalStorageDefinitions(tx, deploymentId, schemaVersionId));
  const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, schemaVersionId });
  expect(reconciled.status).toBe("reconciled");
  if (reconciled.status !== "reconciled") throw new Error("Native candidate did not reconcile");
  expect(reconciled.definitionIds).toContain(definition.indexDefinitionId);
  expect(reconciled.createdCount).toBe(reconciled.definitionIds.length);
  expect(reconciled.createdCount).toBe(6);
  expect(yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, schemaVersionId }))
    .toMatchObject({ status: "reconciled", createdCount: 0, replayedCount: reconciled.createdCount });
  let enabled = false;
  let changedDuringBuild = false;
  for (let step = 0; step < 16; step++) {
    const result = yield* buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, indexDefinitionId: definition.indexDefinitionId, pageSize: 1 });
    if (result.lifecycle === "validating" && !changedDuringBuild) {
      // Move both sides of the predicate after backfill. Validation must delete
      // the old active position and create the newly active position before enable.
      expect(result.replayedRows).toBe(0);
      yield* writeNative(0, 3n, "2026-09-20T01:00:00.000Z", 1n);
      yield* writeNative(1, 4n, null, 2n);
      changedDuringBuild = true;
    }
    if (result.lifecycle === "enabled") { enabled = true; break; }
  }
  expect(changedDuringBuild).toBe(true);
  expect(enabled).toBe(true);
  // Finish every configured index through the same build owners. The separate
  // native partial build above also exercises membership changes during build.
  for (const indexDefinitionId of reconciled.definitionIds.filter(id => id !== definition.indexDefinitionId)) {
    const other = yield* locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId);
    if (other === null) throw new Error("Missing required build definition");
    let complete = false;
    for (let step = 0; step < 20; step++) {
      const result = other.access.kind === "by_creation_time"
        ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, { deploymentId, indexDefinitionId, pageSize: 1 })
        : yield* buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, indexDefinitionId, pageSize: 1 });
      if (result.lifecycle === "enabled") { complete = true; break; }
    }
    expect(complete).toBe(true);
  }
  const uniqueTarget = createLocatedAppUniqueConstraintSetBuildTargetV1(db, { kind: "shared_database", databaseKey: "test", schemaName: "public" });
  const uniquePorts = { controlDb: db, authority: { ...ports.authority, scopeClockTargets: { resolve: async () => uniqueTarget } } };
  const uniqueInput = { deploymentId, schemaVersionId };
  expect(yield* reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput))
    .toMatchObject({ status: "reconciled", disposition: "created", definitionCount: 2 });
  expect(yield* reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput))
    .toMatchObject({ status: "reconciled", disposition: "replayed", definitionCount: 2 });
  let uniqueEnabled = false;
  for (let step = 0; step < 32; step++) {
    const result = yield* advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts, { ...uniqueInput, pageSize: 1 });
    if (result.lifecycle === "enabled" && result.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  expect(uniqueEnabled).toBe(true);
  const uniqueEligibility = createAppUniqueConstraintSetEligibilityPortV1(uniquePorts, createAppUniqueConstraintDefinitionPortV1(db));
  expect(yield* loadAppUniqueConstraintSetEligibilityForReadinessV1Effect(uniqueEligibility, { ...uniqueInput, scopeId }))
    .toMatchObject({ status: "eligible" });
  const currencyConstraints = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(db, deploymentId, scopeId, schemaVersionId,
    [definition.access.tableId], 1);
  if (currencyConstraints === null || currencyConstraints.length !== 1) throw new Error("Missing Currency primary key definition");
  const rows = yield* runDrizzleStatementEffect(db.select().from(fxAppIndexEntryCurrent).where(and(
    eq(fxAppIndexEntryCurrent.scopeUuid, scope.scopeUuid), eq(fxAppIndexEntryCurrent.indexDefinitionId, definition.indexDefinitionId),
  )), cause => new Error("Read built membership", { cause }));
  expect(rows).toHaveLength(1);
  const active = rowIds[1];
  if (active === undefined) throw new Error("Missing fixture identity");
  const indexedRow = rows[0];
  if (indexedRow === undefined) throw new Error("Missing indexed native row");
  expect(Array.from(indexedRow.rowId)).toEqual(Array.from(appRowIdHexV1ToBytes(active)));
  const excluded = rowIds[0];
  if (excluded === undefined) throw new Error("Missing excluded fixture identity");
  const located = yield* locateAppIndexDefinitionByIdEffect(db, scopeId, definition.indexDefinitionId);
  if (located === null) throw new Error("Missing located native definition");
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const values = yield* prepareLogicalRelationalValueValidation(db, deploymentId, schemaVersionId);
  const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, ports.authority);
  expect(yield* Effect.result(prepareLogicalStorageReadiness({ ...uniquePorts, authority: { ...uniquePorts.authority } }, uniqueEligibility,
    { deploymentId, scopeId, schemaVersionId }))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition" } });
  expect(yield* Effect.result(prepareLogicalStorageReadiness(uniquePorts, { ...uniqueEligibility },
    { deploymentId, scopeId, schemaVersionId }))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidComposition" } });
  const readiness = yield* prepareLogicalStorageReadiness(uniquePorts, uniqueEligibility, { deploymentId, scopeId, schemaVersionId });
  if (readiness.status !== "prepared") throw new Error("Expected complete structural preparation");
  const definitions = yield* Effect.forEach(reconciled.definitionIds, id => locateAppIndexDefinitionByIdEffect(db, scopeId, id));
  const currencyIndexes = definitions.filter(value => value !== null).filter(value => value.access.tableId === definition.access.tableId);
  const inventory = Effect.gen(function* () {
    const current = yield* runDrizzleStatementEffect(db.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId), cause => failure("Read row inventory", cause));
    const entries = yield* runDrizzleStatementEffect(db.select().from(fxAppIndexEntryCurrent).orderBy(fxAppIndexEntryCurrent.indexDefinitionId, fxAppIndexEntryCurrent.rowId), cause => failure("Read index inventory", cause));
    const claims = yield* runDrizzleStatementEffect(db.select().from(fxAppUniqueKeys).orderBy(fxAppUniqueKeys.constraintId, fxAppUniqueKeys.rowId), cause => failure("Read claim inventory", cause));
    const clocks = yield* runDrizzleStatementEffect(db.select().from(fxSystemScopeClocks), cause => failure("Read clock inventory", cause));
    const revisions = yield* runDrizzleStatementEffect(db.select().from(fxAppRowRevisions).orderBy(fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq), cause => failure("Read revision inventory", cause));
    const indexRevisions = yield* runDrizzleStatementEffect(db.select().from(fxAppIndexEntryRevisions).orderBy(fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq, fxAppIndexEntryRevisions.encodedKey), cause => failure("Read index revision inventory", cause));
    const builds = yield* runDrizzleStatementEffect(db.select().from(fxSystemIndexBuildStates).orderBy(fxSystemIndexBuildStates.indexDefinitionId), cause => failure("Read index coverage inventory", cause));
    const uniqueBuilds = yield* runDrizzleStatementEffect(db.select().from(fxSystemUniqueConstraintBuilds).orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId), cause => failure("Read unique coverage inventory", cause));
    return { current, entries, claims, clocks, revisions, indexRevisions, builds, uniqueBuilds };
  });
  const beforeMaterialization = yield* inventory;
  const rejected = new Error("fixture semantic or settlement refusal");
  const execute = (fault: "admission" | "revoked" | "validation" | "nativeValue" | "nativeCompanion" | "late" | null) => transact(tx => Effect.scoped(Effect.gen(function* () {
    const currentClock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    expect(yield* readiness.inspect(tx, resolved.authority, currentClock)).toMatchObject({ status: "ready", schemaVersionId });
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 20, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-partial", "write"), lifetime => lifetime.close);
    const reads: string[] = [];
    const tableName = "commerce.currency/currency";
    // This witness supplies trusted row validation; framework admission and
    // serving are separate gates. Exercise the actual shared working set.
    const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock: currentClock,
      tables: [{ tableId: definition.access.tableId, logicalName: tableName }], lifetime,
      requireAdmission: Effect.void, validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)), error: failure,
      uniqueConflict: () => failure("uniqueConflict"), limits: { pageRows: 10, identities: 10, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(3), currencyConstraints, [located], { beforeRead: kind => Effect.sync(() => { reads.push(kind); }) });
    const id = yield* lifetime.begin(lifetime.context);
    const nativeCode = nativeRows[0]?.code;
    if (typeof nativeCode !== "string") throw new Error("Missing native Currency code");
    const byCode = yield* working.documents.find(lifetime.context, id, tableName, { where: { code: nativeCode }, offset: 0, limit: 1 });
    expect(byCode.total).toBe(1);
    expect(byCode.docs[0]?._id).toBe(appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId: excluded }));
    expect(reads).toContain("point");
    expect(reads).not.toContain("index");
    expect(reads).not.toContain("scan");
    if (fault === "nativeValue") yield* working.documents.patch(lifetime.context, id,
      appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId: excluded }), { decimal_digits: 1.5 }, tableName);
    if (fault === "nativeCompanion") yield* working.documents.patch(lifetime.context, id,
      appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId: excluded }),
      { rounding: "1", raw_rounding: { value: "2", precision: 20 } }, tableName);
    const query = { where: { deleted_at: null }, offset: 0, limit: 10 };
    expect((yield* working.documents.find(lifetime.context, id, tableName, query)).total).toBe(1);
    yield* working.documents.patch(lifetime.context, id, appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId: active }),
      { deleted_at: "2026-09-20T01:00:00.000Z" }, tableName);
    expect((yield* working.documents.find(lifetime.context, id, tableName, query)).total).toBe(0);
    yield* working.documents.patch(lifetime.context, id, appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId: excluded }),
      { deleted_at: null, code: `${nativeCode}_updated` }, tableName);
    const pending = yield* working.documents.find(lifetime.context, id, tableName, query);
    expect(pending.total).toBe(1);
    expect(pending.docs[0]?.code).toBe(`${nativeCode}_updated`);
    expect((yield* working.documents.find(lifetime.context, id, tableName, { where: { code: nativeCode }, offset: 0, limit: 1 })).total).toBe(0);
    expect((yield* working.documents.find(lifetime.context, id, tableName, { where: { code: `${nativeCode}_updated` }, offset: 0, limit: 1 })).total).toBe(1);
    expect(reads).toContain("index");
    expect(reads).not.toContain("scan");
    // The partial index cannot answer a query that did not require its predicate.
    expect((yield* working.documents.find(lifetime.context, id, tableName, { where: {}, offset: 0, limit: 10 })).total).toBe(2);
    expect(reads).toContain("scan");
    yield* lifetime.seal;
    const changes = yield* working.close();
    expect(changes.changes).toHaveLength(2);
    expect(changes.indexReads).toHaveLength(1);
    expect(changes.uniqueReads.length).toBeGreaterThan(0);
    const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId, tables: new Set([definition.access.tableId]),
      maximumIndexEntries: 10, error: failure }, changes);
    // This is a kernel witness with fixture semantic gates, not native serving
    // authority. Actual CMS callers exercise the production publication owner.
    let admitted = fault !== "admission";
    const materialization = yield* enterLogicalDocumentMaterialization({
      coverage: "sourceBound",
      command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId), scopeId: scope.scopeId, schemaVersionId },
        rowIntents: [{ tableId: definition.access.tableId }] },
      intrinsic: currencyIndexes.filter(index => index.access.kind === "by_creation_time"),
      developer: currencyIndexes.filter(index => index.access.kind === "developer"), unique: currencyConstraints,
      relations: null, options: {}, requireAdmission: Effect.suspend(() => admitted ? Effect.void : Effect.fail(rejected)),
      validateWrites: (_, changes) => fault === "validation" ? Effect.fail(rejected) :
        Effect.forEach(changes, change => change.kind === "live" ? Effect.fromResult(values.validate(change.tableId, change.document)) : Effect.void, { discard: true }),
    }, tx, resolved.authority, currentClock);
    const delta = yield* materialization.prepareDelta(contribution.changes, contribution.dependencies);
    if (fault === "revoked") admitted = false;
    yield* delta.lower(CommitSeqSchema.make(5n));
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(5n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("Advance fixture settlement clock", cause));
    if (fault === "late") return yield* Effect.fail(rejected);
  })));
  for (const fault of ["admission", "revoked", "validation", "late"] as const) {
    expect(yield* Effect.result(execute(fault))).toMatchObject({ _tag: "Failure", failure: rejected });
    expect(yield* inventory).toEqual(beforeMaterialization);
  }
  expect(yield* Effect.result(execute("nativeValue"))).toMatchObject({ _tag: "Failure", failure: {
    _tag: "LogicalRelationalValueError", reason: "invalidDocument", cause: { reason: "invalidValue", column: "decimal_digits" },
  } });
  expect(yield* inventory).toEqual(beforeMaterialization);
  expect(yield* Effect.result(execute("nativeCompanion"))).toMatchObject({ _tag: "Failure", failure: {
    _tag: "LogicalRelationalValueError", reason: "invalidDocument",
  } });
  expect(yield* inventory).toEqual(beforeMaterialization);
  yield* execute(null);
  const after = yield* inventory;
  expect(after.current.map(row => row.commitSeq)).toEqual([5n, 5n]);
  expect(after.claims).not.toEqual(beforeMaterialization.claims);
  expect(after.clocks[0]?.lastCommitSeq).toBe(5n);
  expect(after.entries.filter(entry => entry.indexDefinitionId === definition.indexDefinitionId).map(entry => Array.from(entry.rowId)))
    .toEqual([Array.from(appRowIdHexV1ToBytes(excluded))]);

  // Replace only these two fixture rows with the complete authentic seed in one
  // transaction. This proves the shared storage budget and rollback, not native
  // initialization admission, idempotency or recovery.
  const replaceFixtureWithSeed = (lateFailure: boolean) => transact(tx => Effect.scoped(Effect.gen(function* () {
    const currentClock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    expect(yield* readiness.inspect(tx, resolved.authority, currentClock)).toMatchObject({ status: "ready", schemaVersionId });
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 256, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-seed-storage", "write"), lifetime => lifetime.close);
    const tableName = "commerce.currency/currency";
    const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock: currentClock,
      tables: [{ tableId: definition.access.tableId, logicalName: tableName }], lifetime,
      requireAdmission: Effect.void, validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)), error: failure,
      uniqueConflict: () => failure("uniqueConflict"),
      limits: { pageRows: MAX_POINT_COMMIT_MATERIAL_ROWS_V1, identities: MAX_POINT_COMMIT_MATERIAL_ROWS_V1, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(4), currencyConstraints, currencyIndexes);
    const id = yield* lifetime.begin(lifetime.context);
    for (const rowId of rowIds) yield* working.documents.delete(lifetime.context, id,
      appDocumentIdV1FromRowIdentity({ tableId: definition.access.tableId, rowId }), tableName);
    for (const row of nativeRows) yield* working.documents.insert(lifetime.context, id, tableName,
      { ...row, created_at: "2026-09-20T00:00:00.000Z", updated_at: "2026-09-20T00:00:00.000Z", deleted_at: null });
    yield* lifetime.seal;
    const changes = yield* working.close();
    expect(changes.changes).toHaveLength(125);
    const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId, tables: new Set([definition.access.tableId]),
      maximumIndexEntries: 256, error: failure }, changes);
    const materialization = yield* enterLogicalDocumentMaterialization({
      coverage: "sourceBound",
      command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId), scopeId: scope.scopeId, schemaVersionId },
        rowIntents: [{ tableId: definition.access.tableId }] },
      intrinsic: currencyIndexes.filter(index => index.access.kind === "by_creation_time"),
      developer: currencyIndexes.filter(index => index.access.kind === "developer"), unique: currencyConstraints,
      relations: null, options: {}, requireAdmission: Effect.void,
      validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "live"
        ? Effect.fromResult(values.validate(change.tableId, change.document)) : Effect.void, { discard: true }),
    }, tx, resolved.authority, currentClock);
    const delta = yield* materialization.prepareDelta(contribution.changes, contribution.dependencies);
    yield* delta.lower(CommitSeqSchema.make(6n));
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(6n) })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("Advance seed fixture clock", cause));
    if (lateFailure) return yield* Effect.fail(rejected);
  })));
  expect(yield* Effect.result(replaceFixtureWithSeed(true))).toMatchObject({ _tag: "Failure", failure: rejected });
  expect(yield* inventory).toEqual(after);
  yield* replaceFixtureWithSeed(false);
  const seeded = yield* inventory;
  expect(seeded.claims).toHaveLength(123);
  expect(seeded.clocks[0]?.lastCommitSeq).toBe(6n);
  expect(seeded.revisions.filter(row => row.commitSeq === 6n)).toHaveLength(125);
  for (const index of currencyIndexes)
    expect(seeded.entries.filter(entry => entry.indexDefinitionId === index.indexDefinitionId)).toHaveLength(123);
  const requirements = yield* readLogicalStorageRequirements(db, deploymentId, schemaVersionId);
  const source = requirements.evidence.candidate.sources.find(source => source.key === "medusa.currency");
  const nativeSchema = source?.definition.kind === "relational" ? source.definition.schema : undefined;
  if (nativeSchema === undefined) throw new Error("Missing native Currency source");
  const nativeTable = nativeSchema.tables[0];
  if (nativeTable === undefined) throw new Error("Missing native Currency table");
  // 123 durable rows exceed this reader's ten-identity work budget. A selected
  // native key still succeeds; a complete list/count must refuse instead of
  // truncating its answer or measuring the whole catalog before every lookup.
  yield* transact(tx => Effect.scoped(Effect.gen(function* () {
    const currentClock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 10, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "native-indexed-read", "write"), lifetime => lifetime.close);
    const reads: string[] = [];
    const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock: currentClock,
      tables: [{ tableId: definition.access.tableId, logicalName: "native", relational: nativeTable }], lifetime,
      relationalCapabilities: nativeSchema.capabilities,
      requireAdmission: Effect.void, validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)), error: failure,
      uniqueConflict: () => failure("uniqueConflict"), limits: { pageRows: 10, identities: 10, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(1), currencyConstraints, currencyIndexes,
    { beforeRead: kind => Effect.sync(() => { reads.push(kind); }) });
    const id = yield* lifetime.begin(lifetime.context);
    const code = nativeRows[0]?.code;
    if (typeof code !== "string") throw new Error("Missing native code");
    const order = { column: "code", direction: "asc" };
    const predicate = { kind: "and", children: [{ kind: "in", column: "code", values: [code] }, { kind: "isNull", column: "deleted_at" }] };
    const found = yield* working.relationalFind(lifetime.context, id, "native", { fields: ["code"], order, predicate });
    expect(found).toEqual({ docs: [{ code }], total: 1 });
    const row = (yield* working.documents.find(lifetime.context, id, "native", { where: { code }, limit: 1, offset: 0 })).docs[0];
    if (typeof row?._id !== "string") throw new Error("Missing internal native identity");
    yield* working.documents.patch(lifetime.context, id, row._id, { deleted_at: "2026-09-21T00:00:00.000Z" }, "native");
    expect(yield* working.relationalFind(lifetime.context, id, "native", { fields: ["code"], order, predicate })).toEqual({ docs: [], total: 0 });
    expect(reads).toEqual(["point"]);
    const oversized = yield* Effect.result(working.relationalFind(lifetime.context, id, "native", { fields: ["code"], order, take: 1 }));
    expect(oversized).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
    expect(reads).not.toContain("scan");
  })));
  expect(yield* inventory).toEqual(seeded);
  // Reuse the same immutable preparation after writes. Readiness must observe
  // fresh full-candidate state, including unrelated Application/Payload members.
  const unrelated = definitions.find(index => index !== null && index.access.tableId !== definition.access.tableId);
  const currencyKey = currencyConstraints[0];
  const otherUnique = seeded.uniqueBuilds.find(build => build.uniqueConstraintDefinitionId !== currencyKey?.uniqueConstraintDefinitionId);
  if (unrelated === undefined || unrelated === null || currencyKey === undefined || otherUnique === undefined) throw new Error("Missing joint readiness members");
  for (const fault of ["missing", "disabled", "fenced", "coverage", "unique", "uniqueCoverage"] as const) {
    const discarded = new Error("Discard readiness fault fixture");
    expect(yield* Effect.result(transact(tx => Effect.gen(function* () {
      const currentClock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
      expect(yield* readiness.inspect(tx, resolved.authority, currentClock)).toMatchObject({ status: "ready", snapshotCommitSeq: 6n });
      const selected = and(eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, unrelated.indexDefinitionId));
      if (fault === "missing") yield* runDrizzleStatementEffect(tx.delete(fxSystemIndexBuildStates).where(selected), cause => failure("Remove fixture build", cause));
      else if (fault === "disabled") yield* runDrizzleStatementEffect(tx.update(fxSystemIndexBuildStates).set({ lifecycle: "validating" }).where(selected), cause => failure("Disable fixture build", cause));
      else if (fault === "fenced") yield* runDrizzleStatementEffect(tx.update(fxSystemIndexBuildStates).set({ storageGenerationFence: StorageGenerationFenceSchema.make(currentClock.storageGenerationFence + 1n) }).where(selected), cause => failure("Fence fixture build", cause));
      else if (fault === "coverage") yield* runDrizzleStatementEffect(tx.update(fxSystemIndexBuildStates).set({ coveredThroughCommitSeq: CommitSeqSchema.make(5n) }).where(and(
        eq(fxSystemIndexBuildStates.scopeId, scopeId), eq(fxSystemIndexBuildStates.indexDefinitionId, definition.indexDefinitionId),
      )), cause => failure("Stale fixture coverage", cause));
      else yield* runDrizzleStatementEffect(tx.update(fxSystemUniqueConstraintBuilds).set(fault === "unique" ? { lifecycle: "validating" } : { coveredThroughCommitSeq: CommitSeqSchema.make(5n) }).where(and(
        eq(fxSystemUniqueConstraintBuilds.scopeId, scopeId), eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
          fault === "unique" ? otherUnique.uniqueConstraintDefinitionId : currencyKey.uniqueConstraintDefinitionId),
      )), cause => failure("Invalidate fixture unique build", cause));
      expect(yield* readiness.inspect(tx, resolved.authority, currentClock)).toMatchObject({ status: "not_ready",
        kind: fault === "unique" || fault === "uniqueCoverage" ? "unique" : "index",
        reason: fault === "missing" ? "missing" : fault === "disabled" ? "notEnabled" : fault === "fenced" ? "stale" :
          fault === "coverage" ? "notCovered" : fault === "unique" ? "buildNotEnabled" : "buildStale",
      });
      return yield* Effect.fail(discarded);
    })))).toMatchObject({ _tag: "Failure", failure: discarded });
    expect(yield* inventory).toEqual(seeded);
  }
});
