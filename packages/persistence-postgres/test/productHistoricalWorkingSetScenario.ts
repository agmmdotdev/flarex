import { Deferred, Effect, Fiber, Result } from "effect";
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { createLocatedIndexBuildReconciliationTargetV1, reconcilePublishedIndexBuildsV1Effect } from "../src/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect, type LocatedAppIndexDefinitionV1 } from "../src/appIndexDefinitions";
import { locateAppUniqueConstraintDefinitionsForSchemaEffect } from "../src/appUniqueConstraintDefinitions";
import { prepareLogicalRelationalValueValidation } from "../src/logicalDocuments/relationalValues";
import { makeLogicalDocumentWorkingSet, type LogicalDocumentReadTestHooks } from "../src/logicalDocuments/workingSet";
import type { LogicalDocumentWorkingSetInput } from "../src/logicalDocuments/model";
import { makeLogicalDocumentRootEvaluator } from "../src/logicalDocuments/rootEvaluator";
import type { SessionJournalAttempt } from "../src/sessionJournalStore";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { runEffectTransaction } from "../src/effectTransaction";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { lockScopeClockForOrdinaryWriteInTransactionEffect, lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../src/scopeAuthorityResolution";
import { getScopeMetadataByDeploymentId } from "../src/scopeMetadata";
import { validateLogicalDocumentChanges } from "../src/logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization } from "../src/logicalDocuments/materialization";
import { fxSystemScopeClocks } from "../src/schema";

/** Exercises the retained candidate reader and one pending view using the same
 * Product schema, indexes and physical materializer as standalone writers. */
export const productHistoricalWorkingSetScenario = Effect.fn("ProductHistoricalWorkingSet.scenario")(function* (
  db: FlarexMetadataDatabase, deploymentId: string, scopeId: ScopeId, schemaVersionId: CatalogSchemaVersionId,
  schema: RelationalSchema, bindings: readonly Readonly<{ localName: string; tableId: CatalogTableId }>[],
) {
  const error = (reason: string, cause?: unknown) => new Error(reason, { cause });
  const target = createLocatedIndexBuildReconciliationTargetV1(db,
    { kind: "shared_database", databaseKey: "test", schemaName: "public" });
  const authority = { scopeMetadata: { getScopeMetadataByDeploymentId: (id: string) =>
    getScopeMetadataByDeploymentId(db, id) },
    provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => null },
    scopeClockTargets: { resolve: async () => target } };
  const ports = { controlDb: db, authority };
  const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports, { deploymentId, scopeId, schemaVersionId });
  if (reconciled.status !== "reconciled") throw new Error("Missing Product index requirements");
  const indexRows = yield* Effect.forEach(reconciled.definitionIds,
    id => locateAppIndexDefinitionByIdEffect(db, scopeId, id));
  const indexes = indexRows.filter((row): row is LocatedAppIndexDefinitionV1 => row !== null);
  const tables = bindings.map(binding => {
    const relational = schema.tables.find(table => table.identity.tableId === binding.localName);
    if (relational === undefined) throw new Error(`Missing Product table ${binding.localName}`);
    return { tableId: binding.tableId, logicalName: binding.localName, relational };
  });
  const tableIds = tables.map(table => table.tableId);
  const unique = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(db, deploymentId, scopeId,
    schemaVersionId, tableIds, 24);
  if (unique === null) throw new Error("Missing Product unique definitions");
  const values = yield* prepareLogicalRelationalValueValidation(db, deploymentId, schemaVersionId, { kind: "fresh" });
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(deploymentId, authority);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId));
  const transact = <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
    runEffectTransaction(callback => db.transaction(callback), "Product historical working set", work,
      cause => error("statementFailure", cause));
  const make = (lifetime: BoundedRequestLifetime<Error>, clock:
    Effect.Success<ReturnType<typeof lockScopeClockForOrdinaryWriteInTransactionEffect>>,
    readSource: { readonly tx: FlarexMetadataTransaction } | { readonly readTransaction: typeof transact; readonly snapshotCommitSeq: typeof clock.lastCommitSeq },
    testHooks?: LogicalDocumentReadTestHooks<Error>,
    rootConfiguration: Pick<LogicalDocumentWorkingSetInput<Error>, "rootEvaluator" | "rootAttempt" | "rootAttemptFence"> = {},
  ) => makeLogicalDocumentWorkingSet<Error>({ ...readSource, ...rootConfiguration, scopeId, clock, lifetime, tables,
    relationalCapabilities: schema.capabilities, requireAdmission: Effect.void,
    validateDocument: write => Effect.fromResult(values.validate(write.tableId, write.document))
      .pipe(Effect.mapError(cause => error("documentInvalid", cause))),
    error, uniqueConflict: () => error("uniqueConflict"),
    limits: { pageRows: 32, identities: 64, documentBytes: 65_536 },
  }, AppCreationTimeV1Schema.make(1), unique, indexes, testHooks);
  const productId = "prod_historical_attempt", imageId = "img_historical_attempt";
  const residualProductId = "prod_residual_other";
  const optionId = "opt_historical_attempt";
  const oldHandle = "historical-before", committedHandle = "historical-after", pendingHandle = "historical-pending";
  const oldOptionTitle = "Historical size", committedOptionTitle = "Later size";
  const commit = (change: "seed" | "standalone") => transact(tx => Effect.scoped(Effect.gen(function* () {
    const clock = yield* lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId);
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
      { calls: 128, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, `product-${change}`, "write"),
    resource => resource.close);
    const working = yield* make(lifetime, clock, { tx });
    const id = yield* lifetime.begin(lifetime.context);
    const product = yield* working.relationalTable(lifetime.context, id, "product");
    const image = yield* working.relationalTable(lifetime.context, id, "image");
    const option = yield* working.relationalTable(lifetime.context, id, "product_option");
    if (change === "seed") {
      yield* product.write(lifetime.context, "insert", [{ id: productId, handle: oldHandle,
        title: "Historical Product", status: "draft" }, { id: residualProductId, handle: "residual-other",
        title: "Residual Product", status: "draft" }]);
      yield* image.write(lifetime.context, "insert", [{ id: imageId, product_id: productId,
        url: "https://example.invalid/historical-before.png", rank: 0,
        created_at: "2026-10-01T00:00:00.000Z" }]);
      yield* image.write(lifetime.context, "insert", Array.from({ length: 18 }, (_, position) => ({
        id: `img_residual_${String(position).padStart(2, "0")}`, product_id: residualProductId,
        url: `https://example.invalid/residual-${position}.png`, rank: position + 10,
        created_at: position === 17 ? "2026-10-01T01:00:00.000Z" : "2026-10-01T00:00:00.000Z",
      })));
      yield* option.write(lifetime.context, "insert", [{ id: optionId, product_id: productId,
        title: oldOptionTitle }]);
    } else {
      yield* product.write(lifetime.context, "update", [{ id: productId, handle: committedHandle,
        title: "Later standalone title", status: "published" }]);
      yield* image.delete(lifetime.context, [imageId]);
      yield* image.write(lifetime.context, "insert", [{ id: "img_later_attempt", product_id: productId,
        url: "https://example.invalid/later.png", rank: 1 }]);
      yield* option.write(lifetime.context, "update", [{ id: optionId, product_id: productId,
        title: committedOptionTitle }]);
    }
    yield* lifetime.seal;
    const closed = yield* working.close();
    const contribution = yield* validateLogicalDocumentChanges({ tx, scopeId, tables: new Set(tableIds),
      maximumIndexEntries: 128, error }, closed);
    const materialization = yield* enterLogicalDocumentMaterialization({ coverage: "sourceBound",
      command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(deploymentId),
        scopeId: scope.scopeId, schemaVersionId }, rowIntents: tableIds.map(tableId => ({ tableId })) },
      intrinsic: indexes.filter(index => index.access.kind === "by_creation_time"),
      developer: indexes.filter(index => index.access.kind === "developer"), unique,
      relations: null, options: {}, requireAdmission: Effect.void,
      validateWrites: (_, changes) => Effect.forEach(changes, row => row.kind === "deleted" ? Effect.void :
        Effect.fromResult(values.validate(row.tableId, row.document)), { discard: true }),
    }, tx, located.authority, clock);
    const delta = yield* materialization.prepareDelta(contribution.changes, contribution.dependencies);
    const sequence = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    yield* delta.lower(sequence);
    yield* runDrizzleStatementEffect(tx.update(fxSystemScopeClocks).set({ lastCommitSeq: sequence })
      .where(eq(fxSystemScopeClocks.scopeId, scopeId)), cause => error("statementFailure", cause));
    return sequence;
  })));
  const snapshotCommitSeq = yield* commit("seed");
  yield* commit("standalone");
  const currentClock = yield* transact(tx => lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
  // The current unique slot moved to committedHandle. The old owner must still
  // be found through the retained snapshot index before an attempted insert.
  yield* Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
      { calls: 32, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "product-historical-unique", "write"),
    resource => resource.close);
    const working = yield* make(lifetime, currentClock, { readTransaction: transact, snapshotCommitSeq });
    const id = yield* lifetime.begin(lifetime.context);
    const product = yield* working.relationalTable(lifetime.context, id, "product");
    expect(yield* Effect.flip(product.write(lifetime.context, "insert", [{ id: "prod_duplicate_attempt",
      handle: oldHandle, title: "Duplicate historical handle", status: "draft" }])))
      .toMatchObject({ message: "uniqueConflict" });
  }));
  for (const mode of ["body", "tail", "overlap", "interruption"] as const) {
    yield* Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
        { calls: 32, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, `frontier-${mode}`, "read"),
      resource => resource.close);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const cancelBody = yield* Deferred.make<Effect.Effect<unknown>>();
      const refusal = new Error(`frontier ${mode} refusal`);
      let activeRead = false;
      let checkedReads = 0;
      let branches = 0;
      let hydrated = 0;
      const checked: typeof transact = work => Effect.acquireUseRelease(
        Effect.sync(() => { checkedReads++; activeRead = true; }),
        () => transact(tx => mode === "interruption" ? Effect.scoped(Effect.gen(function* () {
          // The ordinary Promise fixture bridge waits for its transaction body
          // on caller cancellation. Interrupt the owned body fiber directly.
          const body = yield* Effect.forkScoped(work(tx));
          yield* Deferred.succeed(cancelBody, Fiber.interrupt(body));
          return yield* Fiber.join(body);
        })) : work(tx).pipe(Effect.flatMap(value => mode === "tail"
          ? Effect.fail(refusal) : Effect.succeed(value)))),
        () => Effect.sync(() => { activeRead = false; }));
      const working = yield* make(lifetime, currentClock, { readTransaction: checked, snapshotCommitSeq }, {
        // Test-owned suspension is inside the private frontier. No production
        // native callback receives its SQL transaction or spans this wait.
        beforeRead: kind => Effect.gen(function* () {
          if (kind !== "index") return;
          expect(activeRead).toBe(true);
          branches++;
          if (mode === "body") return yield* Effect.fail(refusal);
          if (mode === "overlap" || mode === "interruption") {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }
        }),
        observeQuery: () => { expect(activeRead).toBe(true); hydrated++; },
      });
      const id = yield* lifetime.begin(lifetime.context);
      const image = yield* working.relationalTable(lifetime.context, id, "image");
      const read = image.find(lifetime.context, { take: 32, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "product_id", values: [productId, residualProductId] } });
      if (mode === "overlap" || mode === "interruption") {
        const fiber = yield* Effect.forkScoped(read);
        yield* Deferred.await(entered).pipe(Effect.timeout(5000));
        if (mode === "overlap") {
          expect(yield* Effect.result(image.find(lifetime.context, { take: 1,
            order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "product_id", values: [residualProductId] } })))
            .toMatchObject({ _tag: "Failure", failure: { message: "overlappingOperation" } });
          expect(checkedReads).toBe(1);
          expect(branches).toBe(1);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.await(fiber);
        } else {
          yield* (yield* Deferred.await(cancelBody));
          yield* Fiber.await(fiber);
        }
      } else {
        expect(yield* Effect.result(read)).toMatchObject({ _tag: "Failure", failure: refusal });
        expect(branches).toBe(mode === "body" ? 1 : 2);
        expect(hydrated).toBe(mode === "body" ? 0 : 2);
      }
      expect(activeRead).toBe(false);
      expect(checkedReads).toBe(1);
      // Catching body/tail failures, interruption, or overlap never permits a
      // cached branch result or later local seal to escape this request.
      expect(yield* Effect.result(image.find(lifetime.context, { take: 1,
        order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "product_id", values: [productId] } })))
        .toMatchObject({ _tag: "Failure", failure: { message: "rollbackOnly" } });
      expect(checkedReads).toBe(1);
      expect((yield* Effect.result(lifetime.seal))._tag).toBe("Failure");
    }));
  }
  yield* Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
      { calls: 32, commandBytes: 262_144, commandMs: 60_000 }, {}, {}, "product-historical-compound-unique", "write"),
    resource => resource.close);
    const working = yield* make(lifetime, currentClock, { readTransaction: transact, snapshotCommitSeq });
    const id = yield* lifetime.begin(lifetime.context);
    const option = yield* working.relationalTable(lifetime.context, id, "product_option");
    expect(yield* Effect.flip(option.write(lifetime.context, "insert", [{ id: "opt_duplicate_attempt",
      product_id: productId, title: oldOptionTitle }])))
      .toMatchObject({ message: "uniqueConflict" });
  }));
  yield* Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error,
      { calls: 128, commandBytes: 1_048_576, commandMs: 60_000 }, {}, {}, "product-historical", "write"),
    resource => resource.close);
    let readTransactions = 0;
    let activeRead = false;
    // SAFETY: this direct owner fixture tests evaluator identity, not journal
    // issuance; production obtains this handle from the exact attempt owner.
    const attempt = Object.freeze({}) as SessionJournalAttempt;
    const root = makeLogicalDocumentRootEvaluator({ attempt, scopeId, snapshotCommitSeq, attemptFence: "1" },
      { identities: 64, workingBytes: 1_048_576 });
    const checkedReadTransaction: typeof transact = work => Effect.acquireUseRelease(
      Effect.sync(() => { readTransactions++; activeRead = true; }),
      () => transact(work), () => Effect.sync(() => { activeRead = false; }));
    const working = yield* make(lifetime, currentClock,
      { readTransaction: checkedReadTransaction, snapshotCommitSeq },
      { observeQuery: () => expect(activeRead).toBe(true) },
      { rootEvaluator: root, rootAttempt: attempt, rootAttemptFence: "1" });
    const id = yield* lifetime.begin(lifetime.context);
    const product = yield* working.relationalTable(lifetime.context, id, "product");
    const image = yield* working.relationalTable(lifetime.context, id, "image");
    const option = yield* working.relationalTable(lifetime.context, id, "product_option");
    const point = () => product.find(lifetime.context, { take: 1,
      order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "in", column: "id", values: [productId] }, { kind: "isNull", column: "deleted_at" }] } });
    const find = (handle: string) => product.find(lifetime.context, { take: 10,
      order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "in", column: "handle", values: [handle] }, { kind: "isNull", column: "deleted_at" }] } });
    const beforePoints = readTransactions;
    expect(yield* product.find(lifetime.context, { take: 10, order: { column: "id", direction: "asc" },
      predicate: { kind: "in", column: "id", values: [productId, residualProductId] } }))
      .toMatchObject([{ id: productId }, { id: residualProductId }]);
    expect(readTransactions - beforePoints).toBe(1);
    expect(yield* point()).toMatchObject([{ id: productId, title: "Historical Product", handle: oldHandle }]);
    expect(activeRead).toBe(false);
    expect(yield* find(oldHandle)).toMatchObject([{ id: productId, title: "Historical Product" }]);
    expect(yield* find(committedHandle)).toEqual([]);
    const beforeBranches = readTransactions;
    expect(yield* product.find(lifetime.context, { take: 10, order: { column: "id", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "or", children: [{ kind: "in", column: "handle", values: [oldHandle] },
          { kind: "in", column: "handle", values: ["residual-other", "absent-disjunction"] }] }] } }))
      .toMatchObject([{ id: productId }, { id: residualProductId }]);
    expect(readTransactions - beforeBranches).toBe(1);
    const beforePage = readTransactions;
    const page = yield* image.findPage(lifetime.context, { take: 1, order: { column: "rank", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "greaterThan", column: "created_at", value: "2026-10-01T00:30:00.000Z" }] } });
    expect(page).toMatchObject({ rows: [{ id: "img_residual_17" }], hasMore: false });
    expect(readTransactions - beforePage).toBe(1);
    expect(root.snapshot().pageReads.length).toBeGreaterThan(1);
    const originalPoint = root.snapshot().observedRows.find(row => row.value.id === productId);
    if (originalPoint === undefined) throw new Error("Missing cached native Product");
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(originalPoint.documentId));
    const overlay = yield* canonicalizeFlarexValueV1Effect({ ...originalPoint.value, handle: "app-overlay-handle" }, "appDocument");
    const originalObservation = root.snapshot().dependencies.find(row => row.documentId === identity.id);
    if (originalObservation === undefined || originalObservation.dependency.kind !== "appRowPoint")
      throw new Error("Missing original Product read observation");
    expect(Result.isSuccess(root.writePoint("product", originalObservation,
      { kind: "live", creationTime: AppCreationTimeV1Schema.make(Number(originalPoint.value._creationTime)), document: overlay }, "replace"))).toBe(true);

    const beforeSeed = readTransactions;
    // Old index and unique membership are cached; a new App seed must still
    // create a checked frontier and affect both cached and new membership.
    expect(yield* find(oldHandle)).toEqual([]);
    expect(readTransactions - beforeSeed).toBe(1);
    expect(yield* find("app-overlay-handle")).toMatchObject([{ id: productId }]);
    const images = () => image.find(lifetime.context, { take: 10,
      order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
        { kind: "in", column: "product_id", values: [productId] }, { kind: "isNull", column: "deleted_at" }] } });
    const beforeImageRead = readTransactions;
    expect(yield* images()).toMatchObject([{ id: imageId }]);
    expect(readTransactions - beforeImageRead).toBe(1);
    expect(activeRead).toBe(false);
    const beforeWrite = readTransactions;
    yield* product.write(lifetime.context, "update", [{ id: productId, handle: pendingHandle,
      title: "Pending native title", status: "published" }, { id: residualProductId,
      handle: "residual-pending", title: "Second pending title" }]);
    expect(readTransactions - beforeWrite).toBe(1);
    expect(yield* point()).toMatchObject([{ id: productId, title: "Pending native title", handle: pendingHandle }]);
    expect(yield* find(oldHandle)).toEqual([]);
    expect(yield* find(pendingHandle)).toMatchObject([{ id: productId, title: "Pending native title" }]);
    expect(yield* find(committedHandle)).toEqual([]);
    yield* image.write(lifetime.context, "insert", [{ id: "img_pending_attempt", product_id: productId,
      url: "https://example.invalid/pending.png", rank: 2 }]);
    yield* option.write(lifetime.context, "insert", [{ id: "opt_pending_attempt", product_id: productId,
      title: "Unseen size" }]);
    expect((yield* images()).map(row => row.id).sort()).toEqual([imageId, "img_pending_attempt"].sort());
    yield* lifetime.seal;
    const closed = yield* working.close();
    expect(closed.changes).toHaveLength(0);
    expect(closed.dependencies).toHaveLength(0);
    const frozen = root.snapshot();
    expect(frozen.scans).toHaveLength(0);
    expect(frozen.indexReads.length).toBeGreaterThan(0);
    expect(frozen.uniqueReads.some(read => read.owner === null)).toBe(true);
    expect(frozen.uniqueReads.some(read => read.owner === null && unique.some(definition =>
      definition.uniqueConstraintDefinitionId === read.constraintId &&
      definition.physicalSpec.orderedFields.length === 2))).toBe(true);
    expect(frozen.dependencies.some(row => row.dependency.kind === "appRowPoint" && row.dependency.observed.kind === "present")).toBe(true);
    expect(closed.attempts.some(row => row.tableName === "product")).toBe(true);
    root.close();
  }));
});
