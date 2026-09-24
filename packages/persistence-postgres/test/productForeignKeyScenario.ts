import { Effect } from "effect";
import { expect } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
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
import { fxAppRowCurrent, fxAppRowRevisions, fxSystemScopeClocks } from "../src/schema";
import { validateLogicalDocumentChanges } from "../src/logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization } from "../src/logicalDocuments/materialization";

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
  const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, schemaVersionId });
  if (reconciled.status !== "reconciled") throw new Error("Product index reconciliation refused");
  for (const indexDefinitionId of reconciled.definitionIds) {
    const definition = yield* locateAppIndexDefinitionByIdEffect(db, scopeId, indexDefinitionId);
    if (definition === null) throw new Error("Missing Product candidate index");
    let enabled = false;
    for (let step = 0; step < 20; step++) {
      const result = definition.access.kind === "by_creation_time"
        ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports, { deploymentId, indexDefinitionId, pageSize: 10 })
        : yield* buildAppDeveloperOrderedIndexV1Effect(ports, { deploymentId, indexDefinitionId, pageSize: 10 });
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
  const unique = yield* reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, { deploymentId, schemaVersionId });
  expect(unique.status).toBe("reconciled");
  let uniqueEnabled = false;
  for (let step = 0; step < 128; step++) {
    const advanced = yield* advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts,
      { deploymentId, schemaVersionId, pageSize: 10 });
    if (advanced.lifecycle === "enabled" && advanced.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
  }
  expect(uniqueEnabled).toBe(true);
  const uniqueEligibility = createAppUniqueConstraintSetEligibilityPortV1(uniquePorts,
    createAppUniqueConstraintDefinitionPortV1(db));
  expect((yield* prepareLogicalStorageReadiness(uniquePorts, uniqueEligibility,
    { deploymentId, scopeId, schemaVersionId })).status).toBe("prepared");
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
      if (scenario !== "missing") yield* (yield* table("product")).write(lifetime.context, "insert", [product]);
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
          closed.success.changes.length).toBe(scenario === "selfCascade" ? 3 : scenario === "unchangedParent" ? 1 : 2);
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
});
