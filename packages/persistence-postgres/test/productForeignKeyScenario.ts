import { Effect } from "effect";
import { expect } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import { isJsonObject } from "flarex-protocol/json";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { getScopeMetadataByDeploymentId } from "../src/scopeMetadata";
import { createLocatedIndexBuildReconciliationTargetV1, reconcilePublishedIndexBuildsV1Effect } from "../src/indexBuildReconciliation";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from "../src/intrinsicCreationTimeIndexBuildV1";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import { createLocatedAppUniqueConstraintSetBuildTargetV1, reconcileAppUniqueConstraintSetBuildV1Effect,
  advanceAppUniqueConstraintSetBackfillV1Effect, createAppUniqueConstraintSetEligibilityPortV1 } from "../src/appUniqueConstraintSetBuildV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { prepareLogicalStorageReadiness } from "../src/logicalStorageReadiness";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../src/appUniqueConstraintDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from "../src/appUniqueConstraintSetClosureV1";
import { prepareLogicalRelationalValueValidation } from "../src/logicalDocuments/relationalValues";
import { makeLogicalDocumentWorkingSet } from "../src/logicalDocuments/workingSet";
import { lockScopeClockForOrdinaryWriteInTransactionEffect } from "../src/scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryCurrent, fxAppIndexEntryRevisions, fxAppUniqueKeys,
  fxSystemScopeClocks, fxSystemIndexBuildStates, fxSystemUniqueConstraintBuilds } from "../src/schema";
import { validateLogicalDocumentChanges } from "../src/logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization } from "../src/logicalDocuments/materialization";
import { forEachLogicalReferencePage, forEachLogicalReferenceReplacementPage,
  selectLogicalReferenceReplacement } from "../src/logicalDocuments/referencePages";
import { forEachLogicalSetNullPage } from "../src/logicalDocuments/referencePages";
import { readBoundedCurrentAppRowsInTransactionEffect } from "../src/appRows";
import { readLogicalStorageRequirements } from "../src/logicalStorageDefinitions";

/** Whole-candidate Product index coverage and native row/FK execution through
 * the shared working set. The committed cases materialize row deltas; full
 * publication and native workflow selection retain separate gates. */
export const productForeignKeyScenario: (
  db: FlarexMetadataDatabase, deploymentId: string, scopeId: ScopeId, schemaVersionId: CatalogSchemaVersionId,
  schema: RelationalSchema, bindings: readonly Readonly<{ localName: string; tableId: CatalogTableId }>[],
) => Effect.Effect<void, unknown> = Effect.fn("ProductForeignKey.scenario")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, scopeId: ScopeId, schemaVersionId: CatalogSchemaVersionId,
  schema: RelationalSchema, bindings: readonly Readonly<{ localName: string; tableId: CatalogTableId }>[],
) {
  const target = createLocatedIndexBuildReconciliationTargetV1(db,
    { kind: "shared_database", databaseKey: "test", schemaName: "public" });
  const authority = { scopeMetadata: { getScopeMetadataByDeploymentId: (id: string) => getScopeMetadataByDeploymentId(db, id) },
    provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => null },
    scopeClockTargets: { resolve: async () => target } };
  const ports = { controlDb: db, authority };
  const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, scopeId, schemaVersionId });
  if (reconciled.status !== "reconciled") throw new Error("Product index reconciliation refused");
  for (const indexDefinitionId of reconciled.definitionIds) {
    const definition = yield* locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId);
    if (definition === null) throw new Error("Missing Product candidate index");
    let enabled = false;
    for (let step = 0; step < 20; step++) {
      const result = definition.access.kind === "by_creation_time"
        ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, { deploymentId, scopeId, indexDefinitionId, pageSize: 10 })
        : yield* buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, scopeId, indexDefinitionId, pageSize: 10 });
      if (result.lifecycle === "enabled") { enabled = true; break; }
    }
    expect(enabled).toBe(true);
  }
  const uniqueTarget = createLocatedAppUniqueConstraintSetBuildTargetV1(db,
    { kind: "shared_database", databaseKey: "test", schemaName: "public" });
  const uniquePorts = { controlDb: db, authority: { ...authority, scopeClockTargets: { resolve: async () => uniqueTarget } } };
  yield* runEffectTransaction(callback => db.transaction(callback), "Close Product unique requirements",
    (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
      const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(tx, { deploymentId, schemaVersionId });
      yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
    }), cause => new Error("Product unique closure transaction", { cause }));
  const unique = yield* reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, { deploymentId, scopeId, schemaVersionId });
  expect(unique.status).toBe("reconciled");
  let uniqueEnabled = false;
  for (let step = 0; step < 128; step++) {
    const advanced = yield* advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts,
      { deploymentId, scopeId, schemaVersionId, pageSize: 10 });
    if (advanced.lifecycle === "enabled" && advanced.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  expect(uniqueEnabled).toBe(true);
  const uniqueEligibility = createAppUniqueConstraintSetEligibilityPortV1(uniquePorts,
    createAppUniqueConstraintDefinitionPortV1(db));
  const readiness = yield* prepareLogicalStorageReadiness(uniquePorts, uniqueEligibility,
    { deploymentId, scopeId, schemaVersionId });
  expect(readiness.status).toBe("prepared");
  if (readiness.status !== "prepared") throw new Error("Missing Product readiness preparation");
  const selectedProduct = yield* readiness.selectSources(["medusa.product"]);
  const selectedApplication = yield* readiness.selectSources(["application"]);
  // The configured graph has references in both directions. Product reads
  // require Application targets and Application reverse/delete dependencies;
  // the read-only view must select its definition owner's complete source.
  expect(selectedProduct.sourceKeys).toContain("application");
  expect(selectedApplication.sourceKeys).toContain("medusa.product");
  expect(selectedProduct.tableIds).toEqual(selectedApplication.tableIds);
  expect(selectedProduct.tableIds).toEqual(expect.arrayContaining(bindings.map(binding => binding.tableId)));
  const requirements = yield* readLogicalStorageRequirements(db, deploymentId, schemaVersionId);
  const view = requirements.evidence.candidate.sources.find(source => source.bindings.some(binding => binding.kind === "view"));
  if (view === undefined) throw new Error("Missing configured read-only view source");
  const selectedView = yield* readiness.selectSources([view.key]);
  expect(selectedView.sourceKeys).toContain("application");
  expect(selectedView.sourceKeys).toContain("medusa.product");
  expect(selectedView.tableIds).toEqual(selectedProduct.tableIds);
  const selectedUnion = yield* readiness.selectSources([view.key, "medusa.product", "application"]);
  const reorderedUnion = yield* readiness.selectSources(["application", "medusa.product", view.key]);
  expect(selectedUnion.sourceKeys).toEqual(selectedProduct.sourceKeys);
  expect(selectedUnion.tableIds).toEqual(selectedProduct.tableIds);
  expect(reorderedUnion.sourceKeys).toEqual(selectedUnion.sourceKeys);
  expect(reorderedUnion.tableIds).toEqual(selectedUnion.tableIds);
  expect(selectedProduct.sourceKeys).not.toContain("medusa.currency");
  const nativeTables = bindings.map(binding => {
    const relational = schema.tables.find(table => table.identity.tableId === binding.localName);
    if (relational === undefined) throw new Error("Missing Product binding definition");
    return { tableId: binding.tableId, logicalName: binding.localName, relational };
  });
  expect(nativeTables).toHaveLength(13);
  const tableIds = nativeTables.map(table => table.tableId);
  const constraints = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(db, deploymentId, scopeId,
    schemaVersionId, tableIds, 24);
  if (constraints === null) throw new Error("Missing Product unique constraints");
  expect(constraints).toHaveLength(24);
  const indexes = yield* Effect.forEach(reconciled.definitionIds, id => locateAppIndexDefinitionByIdEffect(db, scopeId, id));
  const selectedIndexes = indexes.filter((index): index is LocatedAppIndexDefinitionV1 => index !== null)
    .filter(index => tableIds.includes(index.access.tableId));
  expect(selectedIndexes.length).toBeGreaterThanOrEqual(59);
  const values = yield* prepareLogicalRelationalValueValidation(db, deploymentId, schemaVersionId);
  const resolved = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId));
  const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const transact = <Value, Failure>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) =>
    runEffectTransaction(callback => db.transaction(callback), "Product FK working set fixture", work,
      cause => new Error("Product FK fixture transaction", { cause }));
  for (const scenario of ["childFirst", "missing", "requiredMissing", "cascade", "selfCascade", "replacement",
    "noAction", "persist", "unchangedParent", "deletePersisted"] as const)
    yield* transact(tx => Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 32, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, `product-fk-${scenario}`, "write"),
    lifetime => lifetime.close);
    const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock, lifetime,
      tables: nativeTables, relationalCapabilities: schema.capabilities,
      requireAdmission: Effect.void,
      validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)).pipe(
        Effect.mapError(cause => failure("documentInvalid", cause))),
      error: failure, uniqueConflict: () => failure("uniqueConflict"),
      limits: { pageRows: 32, identities: 64, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(10), constraints, selectedIndexes);
    const id = yield* lifetime.begin(lifetime.context);
    const table = (name: string) => working.relationalTable(lifetime.context, id, name);
    const product = { id: "prod_fk", handle: "prod-fk", title: "Product FK" };
    const variant = { id: "variant_fk", product_id: "prod_fk", title: "Variant FK" };
    if (scenario === "childFirst" || scenario === "missing" || scenario === "persist") {
      yield* (yield* table("product_variant")).write(lifetime.context, "insert", [variant]);
      if (scenario === "persist")
        yield* (yield* table("product_type")).write(lifetime.context, "insert", [{ id: "batch_type", value: "Batch Type" }]);
      if (scenario !== "missing") yield* (yield* table("product")).write(lifetime.context, "insert",
        [{ ...product, ...(scenario === "persist" ? { type_id: "batch_type" } : {}) }]);
    } else if (scenario === "cascade") {
      yield* (yield* table("product")).write(lifetime.context, "insert", [product]);
      yield* (yield* table("product_variant")).write(lifetime.context, "insert", [variant]);
      yield* (yield* table("product")).delete(lifetime.context, [product.id]);
    } else if (scenario === "requiredMissing") {
      yield* (yield* table("product_option")).write(lifetime.context, "insert",
        [{ id: "option_fk", product_id: "missing_product", title: "Option FK" }]);
    } else if (scenario === "selfCascade") {
      const category = (id: string, parent_category_id: string | null) =>
        ({ id, handle: id, name: id, mpath: id, parent_category_id });
      const categories = yield* table("product_category");
      yield* categories.write(lifetime.context, "insert", [category("cat_grand", "cat_child")]);
      yield* categories.write(lifetime.context, "insert", [category("cat_child", "cat_parent")]);
      yield* categories.write(lifetime.context, "insert", [category("cat_parent", null)]);
      yield* categories.delete(lifetime.context, ["cat_parent"]);
    } else if (scenario === "replacement") {
      const products = yield* table("product");
      yield* products.write(lifetime.context, "insert", [product]);
      yield* (yield* table("product_variant")).write(lifetime.context, "insert", [variant]);
      yield* products.delete(lifetime.context, [product.id]);
      yield* products.write(lifetime.context, "insert", [product]);
    } else if (scenario === "deletePersisted") {
      yield* (yield* table("product")).delete(lifetime.context, [product.id]);
    } else if (scenario === "unchangedParent") {
      yield* (yield* table("product_variant")).write(lifetime.context, "insert",
        [{ ...variant, id: "variant_fk_observed" }]);
    } else {
      yield* (yield* table("product_type")).write(lifetime.context, "insert", [{ id: "type_fk", value: "Type FK" }]);
      yield* (yield* table("product")).write(lifetime.context, "insert", [{ ...product, type_id: "type_fk" }]);
      yield* (yield* table("product_type")).delete(lifetime.context, ["type_fk"]);
    }
    yield* lifetime.seal;
    const closed = yield* Effect.result(working.close());
    if (scenario === "missing" || scenario === "requiredMissing" || scenario === "noAction")
      expect(closed).toMatchObject({ _tag: "Failure", failure: { message: "documentInvalid" } });
    else {
      expect(closed).toMatchObject({ _tag: "Success" });
      if (closed._tag === "Success") {
        expect(scenario === "cascade" || scenario === "selfCascade" ? closed.success.noFinalRows.length :
          closed.success.changes.length).toBe(scenario === "selfCascade" || scenario === "persist" ? 3 :
            scenario === "unchangedParent" ? 1 : 2);
        if (scenario === "replacement") expect(closed.success.noFinalRows).toHaveLength(1);
        if (scenario === "unchangedParent") {
          expect(closed.success.attempts.map(attempt => attempt.tableName)).toEqual(["product_variant"]);
          expect(closed.success.observedRows.map(row => [row.tableName, row.value.id])).toEqual([
            ["product", "prod_fk"], ["product_variant", "variant_fk_observed"],
          ]);
          expect(closed.success.dependencies.some(row => row.tableId === nativeTables.find(table =>
            table.logicalName === "product")?.tableId && row.dependency.observed.kind === "present")).toBe(true);
        }
        if (scenario === "persist" || scenario === "deletePersisted") {
          const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId, tables: new Set(tableIds),
            maximumIndexEntries: 64, error: failure }, closed.success);
          const materialization = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound",
            command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
              scopeId: scope.scopeId, schemaVersionId }, rowIntents: tableIds.map(tableId => ({ tableId })) },
            intrinsic: selectedIndexes.filter(index => index.access.kind === "by_creation_time"),
            developer: selectedIndexes.filter(index => index.access.kind === "developer"), unique: constraints,
            relations: null, options: {}, requireAdmission: Effect.void,
            validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "deleted" ? Effect.void :
              Effect.fromResult(values.validate(change.tableId, change.document)), { discard: true }),
          }, tx, resolved.authority, clock);
          const delta = yield* materialization.prepareDelta(contribution.changes, contribution.dependencies);
          const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
          yield* delta.lower(commitSeq);
          yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
            .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("statementFailure", cause));
        }
      }
    }
  })));
  const stored = yield* runDrizzleStatementEffect(db.select({ tableId: fxAppRowCurrent.tableId,
    isTombstone: fxAppRowRevisions.isTombstone }).from(fxAppRowCurrent).innerJoin(fxAppRowRevisions, and(
    eq(fxAppRowCurrent.scopeUuid, fxAppRowRevisions.scopeUuid),
    eq(fxAppRowCurrent.tableId, fxAppRowRevisions.tableId),
    eq(fxAppRowCurrent.rowId, fxAppRowRevisions.rowId),
    eq(fxAppRowCurrent.commitSeq, fxAppRowRevisions.commitSeq),
  )).where(and(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid), inArray(fxAppRowCurrent.tableId,
    nativeTables.filter(table => table.logicalName === "product" || table.logicalName === "product_variant")
      .map(table => table.tableId)))), cause => failure("Read Product cascade result", cause));
  expect(stored).toHaveLength(2);
  expect(stored.every(row => row.isTombstone)).toBe(true);

  // The neutral materializer must settle more than one point-command page at
  // one sequence. A late failure rolls back earlier lowered pages as well.
  const inventory = Effect.gen(function* () {
    return {
      rows: yield* runDrizzleStatementEffect(db.select().from(fxAppRowCurrent)
        .orderBy(fxAppRowCurrent.scopeUuid, fxAppRowCurrent.tableId, fxAppRowCurrent.rowId), cause => failure("statementFailure", cause)),
      revisions: yield* runDrizzleStatementEffect(db.select().from(fxAppRowRevisions)
        .orderBy(fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq),
      cause => failure("statementFailure", cause)),
      indexes: yield* runDrizzleStatementEffect(db.select().from(fxAppIndexEntryCurrent)
        .orderBy(fxAppIndexEntryCurrent.scopeUuid, fxAppIndexEntryCurrent.indexDefinitionId,
          fxAppIndexEntryCurrent.encodedKey, fxAppIndexEntryCurrent.rowId), cause => failure("statementFailure", cause)),
      indexRevisions: yield* runDrizzleStatementEffect(db.select().from(fxAppIndexEntryRevisions)
        .orderBy(fxAppIndexEntryRevisions.scopeUuid, fxAppIndexEntryRevisions.indexDefinitionId,
          fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq),
      cause => failure("statementFailure", cause)),
      unique: yield* runDrizzleStatementEffect(db.select().from(fxAppUniqueKeys)
        .orderBy(fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.constraintId, fxAppUniqueKeys.localeKey,
          fxAppUniqueKeys.canonicalKeySha256), cause => failure("statementFailure", cause)),
      indexBuilds: yield* runDrizzleStatementEffect(db.select().from(fxSystemIndexBuildStates)
        .orderBy(fxSystemIndexBuildStates.scopeId, fxSystemIndexBuildStates.indexDefinitionId), cause => failure("statementFailure", cause)),
      uniqueBuilds: yield* runDrizzleStatementEffect(db.select().from(fxSystemUniqueConstraintBuilds)
        .orderBy(fxSystemUniqueConstraintBuilds.scopeId, fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId),
      cause => failure("statementFailure", cause)),
      clocks: yield* runDrizzleStatementEffect(db.select().from(fxSystemScopeClocks)
        .orderBy(fxSystemScopeClocks.scopeId), cause => failure("statementFailure", cause)),
    };
  });
  const beforeBatches = yield* inventory;
  let lateReached = false;
  const runBatches = (failLate: boolean) => transact(tx => Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 64, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "product-fk-batches", "write"),
    lifetime => lifetime.close);
    const id = yield* lifetime.begin(lifetime.context);
    const batches: Array<ReturnType<Effect.Success<ReturnType<typeof makeLogicalDocumentWorkingSet>>["close"]>> = [];
    for (let page = 0; page < 9; page++) {
      const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock, lifetime,
        tables: nativeTables, relationalCapabilities: schema.capabilities, requireAdmission: Effect.void,
        validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)).pipe(
          Effect.mapError(cause => failure("documentInvalid", cause))),
        error: failure, uniqueConflict: () => failure("uniqueConflict"),
        limits: { pageRows: 32, identities: 32, documentBytes: 65_536 },
      }, AppCreationTimeV1Schema.make(1000 + page * 16), constraints, selectedIndexes);
      const products = yield* working.relationalTable(lifetime.context, id, "product");
      yield* products.write(lifetime.context, "insert", Array.from({ length: 16 }, (_, ordinal) => {
        const number = page * 16 + ordinal;
        return { id: `batch_product_${number}`, handle: `batch-product-${number}`,
          title: `Batch ${number}`, type_id: "batch_type" };
      }));
      batches.push(working.close());
    }
    yield* lifetime.seal;
    const materialization = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound", batch: true,
      command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
        scopeId: scope.scopeId, schemaVersionId }, rowIntents: tableIds.map(tableId => ({ tableId })) },
      intrinsic: selectedIndexes.filter(index => index.access.kind === "by_creation_time"),
      developer: selectedIndexes.filter(index => index.access.kind === "developer"), unique: constraints,
      relations: null, options: {}, requireAdmission: Effect.void,
      validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "deleted" ? Effect.void :
        Effect.fromResult(values.validate(change.tableId, change.document)), { discard: true }),
    }, tx, resolved.authority, clock);
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    for (const [page, close] of batches.entries()) {
      const closed = yield* close;
      const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId, tables: new Set(tableIds),
        maximumIndexEntries: 64, error: failure }, closed);
      const delta = yield* materialization.prepareDelta(contribution.changes, contribution.dependencies);
      yield* delta.lower(commitSeq);
      if (failLate && page === 1) {
        lateReached = true;
        return yield* Effect.fail(failure("injectedLateFailure"));
      }
    }
    yield* materialization.completeBatch();
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("statementFailure", cause));
  })));
  const failedBatches = yield* Effect.result(runBatches(true));
  expect(failedBatches._tag, JSON.stringify(failedBatches)).toBe("Failure");
  if (!lateReached) throw new Error(`Batch failed before late point: ${JSON.stringify(failedBatches)}`);
  expect(lateReached).toBe(true);
  expect(yield* inventory).toEqual(beforeBatches);
  yield* runBatches(false);
  const afterBatches = yield* inventory;
  expect(afterBatches.rows).toHaveLength(beforeBatches.rows.length + 144);
  expect(afterBatches.revisions).toHaveLength(beforeBatches.revisions.length + 144);
  expect(afterBatches.indexRevisions.length).toBeGreaterThan(beforeBatches.indexRevisions.length + 144);
  expect(afterBatches.unique.length).toBeGreaterThan(beforeBatches.unique.length + 144);
  const previousClock = beforeBatches.clocks.find(row => row.scopeId === scopeId)?.lastCommitSeq;
  if (previousClock === undefined) throw new Error("Missing Product batch scope clock");
  expect(afterBatches.clocks.find(row => row.scopeId === scopeId)?.lastCommitSeq)
    .toBe(CommitSeqSchema.make(previousClock + 1n));
  const committedSeq = CommitSeqSchema.make(previousClock + 1n);
  const productTableId = nativeTables.find(table => table.logicalName === "product")?.tableId;
  if (productTableId === undefined) throw new Error("Missing Product table identity");
  expect(afterBatches.rows.filter(row => row.tableId === productTableId && row.commitSeq === committedSeq)).toHaveLength(144);
  expect(afterBatches.revisions.filter(row => row.tableId === productTableId && row.commitSeq === committedSeq)).toHaveLength(144);
  expect(afterBatches.indexRevisions.filter(row => row.tableId === productTableId && row.commitSeq === committedSeq).length)
    .toBeGreaterThan(144);
  for (const definition of selectedIndexes.filter(index => index.access.tableId === productTableId)) {
    expect(afterBatches.indexBuilds.find(build => build.indexDefinitionId === definition.indexDefinitionId)?.coveredThroughCommitSeq)
      .toBe(committedSeq);
  }
  for (const definition of constraints.filter(unique => unique.tableId === productTableId)) {
    expect(afterBatches.uniqueBuilds.find(build => build.uniqueConstraintDefinitionId === definition.uniqueConstraintDefinitionId)?.coveredThroughCommitSeq)
      .toBe(committedSeq);
  }
  const referenced = new Set<string>();
  const typeTableId = nativeTables.find(table => table.logicalName === "product_type")?.tableId;
  if (typeTableId === undefined) throw new Error("Missing Product Type table identity");
  const references = {
    sourceTableId: productTableId, sourceColumn: "type_id",
    targetTableId: typeTableId, targetColumn: "id", targetKey: "batch_type",
    error: failure } as const;
  const boundTables = nativeTables.map(table => ({ tableId: table.tableId,
    localName: table.logicalName, definition: table.relational }));
  const referenceInput = (tx: FlarexMetadataTransaction) => ({ tx, ...references,
    requireAdmission: Effect.succeed(Object.freeze({ tx, authority: resolved.authority,
      schema, tables: boundTables, indexes: selectedIndexes.filter(index => index.access.kind === "developer"),
      unique: constraints })) });
  const count = yield* transact(tx => forEachLogicalReferencePage(referenceInput(tx),
    rows => Effect.sync(() => { for (const row of rows) referenced.add(row.rowId); })));
  expect(count).toBe(144);
  expect(referenced.size).toBe(144);
  const replacementPages: Array<{ readonly count: number; readonly reference: unknown }> = [];
  const replacement = yield* transact(tx => Effect.gen(function* () {
    const selected = yield* selectLogicalReferenceReplacement({ ...referenceInput(tx),
      pendingChanges: [], desiredKeys: ["batch_product_0", "batch_missing"] });
    const forged = yield* Effect.result(forEachLogicalReferenceReplacementPage({ ...referenceInput(tx),
      selection: { detach: selected.detach, associate: selected.associate, pendingChanges: [] } }, () => Effect.void));
    expect(forged).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
    const replacementCount = yield* forEachLogicalReferenceReplacementPage({ ...referenceInput(tx),
      selection: selected }, (changes, keys) => Effect.sync(() => {
      const live = changes.filter(change => change.kind === "live");
      expect(live).toHaveLength(keys.length);
      expect(live.map(change => isJsonObject(change.document.valueJson) ? change.document.valueJson.id : undefined)).toEqual(keys);
      const first = live[0]?.document.valueJson;
      replacementPages.push({ count: changes.length,
        reference: first !== undefined && isJsonObject(first) ? first.type_id : undefined });
    }));
    expect(replacementCount).toBe(144);
    return selected;
  }));
  expect(replacement.detach).toHaveLength(143);
  expect(replacement.associate.map(row => row.key)).toEqual(["batch_product_0"]);
  expect(new Set(replacement.detach.map(row => row.key)).has("batch_product_0")).toBe(false);
  expect(replacementPages.length).toBeGreaterThan(1);
  expect(replacementPages.reduce((count, page) => count + page.count, 0)).toBe(144);
  expect(replacementPages.every(page => page.count > 0 && page.count <= 32)).toBe(true);
  expect(replacementPages.at(-1)?.count).toBe(1);
  expect(replacementPages.slice(0, -1).every(page => page.reference === null)).toBe(true);
  expect(replacementPages.at(-1)?.reference).toBe("batch_type");
  const planned = yield* transact(tx => Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(failure,
      { calls: 16, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "product-fk-planned-null", "write"),
    member => member.close);
    const working = yield* makeLogicalDocumentWorkingSet({ tx, scopeId, clock, lifetime,
      tables: nativeTables, relationalCapabilities: schema.capabilities, requireAdmission: Effect.void,
      validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document)).pipe(
        Effect.mapError(cause => failure("documentInvalid", cause))),
      error: failure, uniqueConflict: () => failure("uniqueConflict"),
      limits: { pageRows: 32, identities: 16, documentBytes: 65_536 },
    }, AppCreationTimeV1Schema.make(1800), constraints, selectedIndexes);
    const id = yield* lifetime.begin(lifetime.context);
    yield* (yield* working.relationalTable(lifetime.context, id, "product_type"))
      .delete(lifetime.context, ["batch_type"]);
    yield* working.planSetNull(lifetime.context, id, { sourceTableId: productTableId,
      sourceColumn: "type_id", targetTableId: typeTableId, targetColumn: "id", targetKey: "batch_type" });
    yield* lifetime.seal;
    const closed = yield* working.close();
    const rejected = yield* Effect.result(validateLogicalDocumentChanges({ tx, scopeId,
      tables: new Set(tableIds), maximumIndexEntries: 128, error: failure }, closed));
    return { closed, rejected };
  })));
  expect(planned.closed.setNull).toEqual([{ sourceTableId: productTableId, sourceColumn: "type_id",
    targetTableId: typeTableId, targetColumn: "id", targetKey: "batch_type" }]);
  expect(planned.closed.changes).toMatchObject([{ kind: "deleted", tableId: typeTableId }]);
  expect(planned.rejected).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  const undeclared = yield* Effect.result(transact(tx => forEachLogicalReferencePage({ ...referenceInput(tx),
    sourceColumn: "handle" }, () => Effect.void)));
  expect(undeclared).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
  const unstableAdmission = yield* Effect.result(transact(tx => forEachLogicalSetNullPage({
    ...referenceInput(tx), requireAdmission: Effect.sync(() => Object.freeze({ tx, authority: resolved.authority,
      schema, tables: boundTables, indexes: selectedIndexes, unique: constraints })),
  }, () => Effect.void)));
  expect(unstableAdmission).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });

  // The shared row owner normalizes and lowers each derived update, with one
  // commit sequence and one rollback boundary for all reference pages.
  const beforeDetach = yield* inventory;
  const beforeProductRows = yield* transact(tx => readBoundedCurrentAppRowsInTransactionEffect(tx, {
    scopeId, tableId: productTableId, minimumCommitSeq: committedSeq,
    maximumIdentities: 200, maximumDocumentBytes: 65_536, maximumTotalValueBytes: 1_048_576,
  }));
  const priorProduct = beforeProductRows.rows.find(row => row.kind === "live" &&
    isJsonObject(row.document.valueJson) && row.document.valueJson.id === "batch_product_0");
  if (priorProduct?.kind !== "live" || !isJsonObject(priorProduct.document.valueJson))
    throw new Error("Missing reference Product before detach");
  const omitted = yield* Effect.result(transact(tx => forEachLogicalSetNullPage(referenceInput(tx), () => Effect.void)));
  expect(omitted).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
  expect(yield* inventory).toEqual(beforeDetach);
  let detachedPages = 0;
  const detach = (failLate: boolean) => transact(tx => Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const core = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound", batch: true,
      command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
        scopeId: scope.scopeId, schemaVersionId }, rowIntents: tableIds.map(tableId => ({ tableId })) },
      intrinsic: selectedIndexes.filter(index => index.access.kind === "by_creation_time"),
      developer: selectedIndexes.filter(index => index.access.kind === "developer"), unique: constraints,
      relations: null, options: {}, requireAdmission: Effect.void,
      validateWrites: (_, changes) => Effect.forEach(changes, change => change.kind === "deleted" ? Effect.void :
        Effect.fromResult(values.validate(change.tableId, change.document)), { discard: true }),
    }, tx, resolved.authority, clock);
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const changed = yield* forEachLogicalSetNullPage(referenceInput(tx),
      changes => Effect.gen(function* () {
        yield* (yield* core.prepareDelta(changes, changes)).lower(commitSeq);
        detachedPages++;
        if (failLate && detachedPages === 2) return yield* Effect.fail(failure("injectedDetachFailure"));
      }));
    const remaining = yield* forEachLogicalReferencePage(referenceInput(tx), () => Effect.void);
    expect(remaining).toBe(0);
    yield* core.completeBatch();
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => failure("statementFailure", cause));
    return changed;
  }));
  expect((yield* Effect.result(detach(true)))._tag).toBe("Failure");
  expect(detachedPages).toBe(2);
  expect(yield* inventory).toEqual(beforeDetach);
  detachedPages = 0;
  expect(yield* detach(false)).toBe(144);
  expect(detachedPages).toBeGreaterThan(1);
  const afterDetach = yield* inventory;
  expect(afterDetach.rows).toHaveLength(beforeDetach.rows.length);
  expect(afterDetach.revisions).toHaveLength(beforeDetach.revisions.length + 144);
  expect(afterDetach.clocks.find(row => row.scopeId === scopeId)?.lastCommitSeq)
    .toBe(CommitSeqSchema.make(committedSeq + 1n));
  const detachedRows = yield* transact(tx => readBoundedCurrentAppRowsInTransactionEffect(tx, {
    scopeId, tableId: productTableId, minimumCommitSeq: CommitSeqSchema.make(committedSeq + 1n),
    maximumIdentities: 200, maximumDocumentBytes: 65_536, maximumTotalValueBytes: 1_048_576,
  }));
  expect(detachedRows.rows.filter(row => row.kind === "live" && isJsonObject(row.document.valueJson) &&
    row.document.valueJson.type_id === null)).toHaveLength(144);
  const updatedProduct = detachedRows.rows.find(row => row.kind === "live" &&
    isJsonObject(row.document.valueJson) && row.document.valueJson.id === "batch_product_0");
  if (updatedProduct?.kind !== "live" || !isJsonObject(updatedProduct.document.valueJson))
    throw new Error("Missing reference Product after detach");
  expect(updatedProduct.document.valueJson.updated_at).not.toBe(priorProduct.document.valueJson.updated_at);
  expect(updatedProduct.document.valueJson._creationTime).toBe(priorProduct.document.valueJson._creationTime);
});
