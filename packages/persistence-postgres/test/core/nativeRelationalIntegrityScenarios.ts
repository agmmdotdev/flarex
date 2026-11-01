import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { prepareLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { DocumentObject } from "flarex-protocol/document-value";
import { compileProductCoreDefinition } from "../../../medusa-adapter/src/modules/product/schema";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { readDocumentObject } from "../../src/core/registry";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "73fb7e1b-7138-4e43-a7a0-318ad824ea65", epochUuid: "ec337725-b84c-457a-93c7-4f1820432e90" };
const product = (id: string) => ({ id, title: id, handle: id });
const variant = (id: string, productId: string | null, sku: string | null = null) => ({ id, title: id, product_id: productId, sku });
const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

/** Every case installs the genuine complete Product compiler output through
 * Core's real lifecycle; no reduced integrity fixture supplies the policy. */
const setup = Effect.fn("NativeRelationalIntegrity.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence, overrides: Partial<CoreDatabaseOptions> = {}, applicationReferences = false) {
  const definition = yield* compileProductCoreDefinition(target);
  const application = applicationReferences ? yield* prepareApplicationSchemaSource(defineSchema({
    article_links: defineTable({ product: v.union(v.string(), v.null()), note: v.string() }),
  })) : undefined;
  const candidate = application === undefined ? undefined : yield* prepareLogicalSchemaCandidate({ kind: "logicalSchemaCandidate", definitionVersion: 2,
    state: "candidate", deploymentId: TransactionGrantDeploymentIdV1Schema.make("native-application-product-integrity"),
    scopeId: ScopeIdSchema.make(`scope_${target.scopeUuid}`), applicationAnalysis: { candidateId: "native-application-product-integrity",
      analysisId: "native-application-product-integrity", manifestSha256: "a".repeat(64), sourceArtifactRootSha256: "b".repeat(64) },
    sources: [application.source, definition.source], extensions: [{ name: "application_article_product", sourceKey: application.source.key,
      source: { table: { namespace: "app", logicalName: "article_links" }, field: "product" },
      target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" }, policy: "strongReference",
      liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
      onTargetSoftDelete: "retain", onTargetDelete: "restrict" }] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition },
    ...(application === undefined ? [] : [{ kind: "application" as const, definition: application }])],
    ...(candidate === undefined ? {} : { candidate }) });
  const options: CoreDatabaseOptions = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
    randomBytes: length => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0, ...overrides };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Product schema ${status.state}`));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Product schema did not activate"));
  const binding = yield* database.bindNative({ definition, commands: [{ name: "integrity-write", mode: "write" }, { name: "integrity-read", mode: "read" }] });
  const table = (localName: string) => {
    const declaration = definition.tables.find(candidate => candidate.localName === localName);
    if (declaration === undefined) throw new Error(`Missing genuine Product table ${localName}`);
    return declaration.name;
  };
  const begin = () => database.beginNative(binding, { commandName: "integrity-write", ...coreNativeTestBudget() });
  const write = <A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) => Effect.acquireUseRelease(begin(),
    operation => Effect.gen(function* () {
      const value = yield* body(operation.operations);
      yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort());
  const read = (localName: string, where: Parameters<CoreNativeOperations["find"]>[1] = {}) => Effect.acquireUseRelease(
    database.beginNative(binding, { commandName: "integrity-read", ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
      const result = yield* operation.operations.find(table(localName), where);
      yield* operation.finishRead(); return result;
    }), operation => operation.abort());
  return { database, definition, bundle, table, begin, write, read };
});

export function registerNativeRelationalIntegrityScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("enforces active nullable SKU uniqueness, releases it on soft deletion and refuses conflicting restore without partial revival", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), p = graph.table("product"), v = graph.table("product_variant");
      expect(graph.definition.tables).toHaveLength(13);
      expect(graph.definition.foreignKeys).toHaveLength(15);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(p, "insert", [product("sku-parent")]);
        yield* operations.writeRows(v, "insert", [variant("nullable-a", "sku-parent"), variant("nullable-b", "sku-parent"), variant("old-sku", "sku-parent", "same-sku")]);
      }));
      yield* graph.write(operations => operations.lifecycle(v, "softDelete", ["old-sku"]));
      yield* graph.write(operations => operations.writeRows(v, "insert", [variant("new-sku", "sku-parent", "same-sku")]));
      const restore = yield* graph.begin();
      const refusal = yield* Effect.result(restore.operations.lifecycle(v, "restore", ["old-sku"]));
      expect(failed(refusal)).toMatchObject({ _tag: "CoreNativeUniqueConflict", fields: ["sku"] });
      expect((yield* restore.operations.find(v, { id: "old-sku" }))[0]?.deleted_at).not.toBeNull();
      yield* restore.abort();
      expect((yield* graph.read("product_variant", { id: "old-sku" }))[0]?.deleted_at).not.toBeNull();
      expect((yield* graph.read("product_variant", { id: "new-sku" }))[0]?.deleted_at).toBeNull();
    })), 120_000);

    it("accepts null FKs and soft-deleted native targets while preserving noAction until explicit detachment", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), p = graph.table("product"), t = graph.table("product_type"), v = graph.table("product_variant");
      yield* graph.write(operations => operations.writeRows(t, "insert", [{ id: "type", value: "type" }]));
      yield* graph.write(operations => operations.lifecycle(t, "softDelete", ["type"]));
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(p, "insert", [{ ...product("typed"), type_id: "type" }]);
        yield* operations.writeRows(v, "insert", [variant("unowned-variant", null)]);
      }));
      expect(failed(yield* Effect.result(graph.write(operations => operations.deleteRows(t, ["type"])))))
        .toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "deleteRestricted" });
      expect(yield* graph.read("product_type", { id: "type" })).toHaveLength(1);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(p, "update", [{ id: "typed", type_id: null }]);
        yield* operations.deleteRows(t, ["type"]);
      }));
      expect(yield* graph.read("product_type", { id: "type" })).toHaveLength(0);
    })), 120_000);

    it("keeps a surviving Variant when a scalar Product delete is replaced under the same native key", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), p = graph.table("product"), v = graph.table("product_variant");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(p, "insert", [product("replacement")]);
        yield* operations.writeRows(v, "insert", [variant("survivor", "replacement")]);
      }));
      const original = (yield* graph.read("product", { id: "replacement" }))[0]?._id;
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.deleteRows(p, ["replacement"]);
        yield* operations.writeRows(p, "insert", [{ ...product("replacement"), title: "replacement body" }]);
        expect((yield* operations.prepareDeleteClosure()).map(change => change.table)).toEqual([p]);
      }));
      expect((yield* graph.read("product", { id: "replacement" }))[0]?._id).not.toBe(original);
      expect(yield* graph.read("product_variant", { id: "survivor" })).toHaveLength(1);
    })), 120_000);

    it("prepares the complete actual cascade and preserves native tuple pivot identity", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("product"), "insert", [product("closure")]);
        yield* operations.writeRows(graph.table("product_variant"), "insert", [variant("closure-variant", "closure")]);
        yield* operations.writeRows(graph.table("image"), "insert", [{ id: "closure-image", product_id: "closure", url: "image" }]);
        yield* operations.writeRows(graph.table("product_option"), "insert", [{ id: "closure-option", product_id: "closure", title: "size" }]);
        yield* operations.writeRows(graph.table("product_option_value"), "insert", [{ id: "closure-value", option_id: "closure-option", value: "large" }]);
        yield* operations.writeRows(graph.table("product_variant_option"), "insert", [{ variant_id: "closure-variant", option_value_id: "closure-value" }]);
      }));
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.deleteRows(graph.table("product"), ["closure"]);
        const closure = yield* operations.prepareDeleteClosure();
        expect(closure).toHaveLength(6);
        expect(new Set(closure.map(change => change.table))).toEqual(new Set(["product", "product_variant", "image", "product_option", "product_option_value", "product_variant_option"].map(graph.table)));
      }));
      for (const table of ["product", "product_variant", "image", "product_option", "product_option_value", "product_variant_option"])
        expect(yield* graph.read(table)).toHaveLength(0);
    })), 120_000);

    it("conflicts on new incoming membership after closure preparation without widening the sealed deletion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), p = graph.table("product"), v = graph.table("product_variant");
      yield* graph.write(operations => operations.writeRows(p, "insert", [product("frozen")]));
      const deleting = yield* graph.begin();
      yield* deleting.operations.deleteRows(p, ["frozen"]);
      expect(yield* deleting.operations.prepareDeleteClosure()).toHaveLength(1);
      yield* graph.write(operations => operations.writeRows(v, "insert", [variant("racing-child", "frozen")]));
      expect(failed(yield* Effect.result(graph.database.commit(yield* deleting.finalize())))).toMatchObject({ reason: "conflict" });
      yield* deleting.abort();
      expect(yield* graph.read("product", { id: "frozen" })).toHaveLength(1);
      expect(yield* graph.read("product_variant", { id: "racing-child" })).toHaveLength(1);
    })), 120_000);

    it("refuses actual image noAction edges until the explicit native assignment row is removed", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("product"), "insert", [product("assignment-parent")]);
        yield* operations.writeRows(graph.table("product_variant"), "insert", [variant("assignment-variant", "assignment-parent")]);
        yield* operations.writeRows(graph.table("image"), "insert", [{ id: "assigned-image", product_id: "assignment-parent", url: "image" }]);
        yield* operations.writeRows(graph.table("product_variant_product_image"), "insert", [{ id: "assignment", variant_id: "assignment-variant", image_id: "assigned-image" }]);
      }));
      expect(failed(yield* Effect.result(graph.write(operations => operations.deleteRows(graph.table("image"), ["assigned-image"])))))
        .toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "deleteRestricted" });
      const removing = yield* graph.begin();
      yield* removing.operations.deleteRows(graph.table("product"), ["assignment-parent"]);
      expect(failed(yield* Effect.result(removing.operations.prepareDeleteClosure())))
        .toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "deleteRestricted" });
      // The failed complete preparation retains the caller's scalar parent
      // delete, and restores every tentative child removal before retry.
      expect(yield* removing.operations.find(graph.table("product"), { id: "assignment-parent" })).toHaveLength(0);
      expect(yield* removing.operations.find(graph.table("product_variant"), { id: "assignment-variant" })).toHaveLength(1);
      expect(yield* removing.operations.find(graph.table("image"), { id: "assigned-image" })).toHaveLength(1);
      expect(yield* removing.operations.find(graph.table("product_variant_product_image"), { id: "assignment" })).toHaveLength(1);
      yield* removing.operations.deleteRows(graph.table("product_variant_product_image"), ["assignment"]);
      expect(yield* removing.operations.prepareDeleteClosure()).toHaveLength(4);
      yield* graph.database.commit(yield* removing.finalize());
      yield* removing.abort();
      expect(yield* graph.read("product_variant_product_image")).toHaveLength(0);
    })), 120_000);

    it("authenticates the real self-hierarchy's explicit child-first deletion before sealing", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), category = graph.table("product_category");
      yield* graph.write(operations => operations.writeRows(category, "insert", [
        { id: "root", name: "root", handle: "root", mpath: "root", parent_category_id: null },
        { id: "child", name: "child", handle: "child", mpath: "root.child", parent_category_id: "root" },
        { id: "grandchild", name: "grandchild", handle: "grandchild", mpath: "root.child.grandchild", parent_category_id: "child" },
      ]));
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.deleteRows(category, ["grandchild", "child", "root"]);
        expect(yield* operations.prepareDeleteClosure()).toHaveLength(3);
      }));
      expect(yield* graph.read("product_category")).toHaveLength(0);
    })), 120_000);

    it("rolls back a late native bulk unique refusal without refunding its charged writes or dropping owner observations", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, { transactionLimits: { documentsWritten: 1 } });
      const p = graph.table("product"), v = graph.table("product_variant");
      yield* graph.write(operations => operations.writeRows(p, "insert", [product("bulk-rollback-parent")]));
      yield* graph.write(operations => operations.writeRows(v, "insert", [variant("owned-sku", "bulk-rollback-parent", "owned-sku")]));
      const attempting = yield* graph.begin();
      expect(failed(yield* Effect.result(attempting.operations.writeRows(v, "insert", [
        variant("tentative", "bulk-rollback-parent", "tentative-sku"), variant("duplicate", "bulk-rollback-parent", "owned-sku"),
      ])))).toMatchObject({ _tag: "CoreNativeUniqueConflict", fields: ["sku"] });
      expect(yield* attempting.operations.find(v, { id: "tentative" })).toHaveLength(0);
      expect((yield* attempting.operations.find(v, { sku: "owned-sku", deleted_at: null })).map(document => document.id)).toEqual(["owned-sku"]);
      expect(failed(yield* Effect.result(attempting.operations.writeRows(v, "insert", [variant("after-refusal", "bulk-rollback-parent", "another-sku")]))))
        .toMatchObject({ reason: "capacity", cause: { budget: "documentsWritten", actual: 2, limit: 1 } });
      expect(yield* attempting.operations.find(v, { id: "after-refusal" })).toHaveLength(0);
      yield* attempting.abort();
      expect((yield* graph.read("product_variant")).map(document => document.id)).toEqual(["owned-sku"]);
    })), 120_000);

    it("never saves a child whose native-key existence depends on an accepted parent save that fails", run(fixture => Effect.gen(function* () {
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), childAdmitting = yield* Deferred.make<void>();
      let armed = false, childAdmission = false;
      const savedChildren: DocumentObject[] = [];
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const documents = yield* Effect.forEach(batch.documents.filter(document => !document.deleted), document => Effect.fromResult(readDocumentObject(document)));
        if (armed && documents.some(document => document.id === "failed-parent")) {
          yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
          return yield* new CorePersistenceError({ reason: "unavailable" });
        }
        yield* fixture.persistence.write(lease, batch);
        savedChildren.push(...documents.filter(document => document.id === "dependent-child"));
      }) };
      const graph = yield* setup(fixture, persistence, { now: Effect.gen(function* () {
        if (childAdmission) { childAdmission = false; yield* Deferred.succeed(childAdmitting, undefined); }
        return 1_000_000_000n;
      }) });
      const parent = yield* graph.begin(), child = yield* graph.begin();
      yield* parent.operations.writeRows(graph.table("product"), "insert", [product("failed-parent")]);
      yield* child.operations.writeRows(graph.table("product_variant"), "insert", [variant("dependent-child", "failed-parent")]);
      const parentFinal = yield* parent.finalize(), childFinal = yield* child.finalize();
      yield* Effect.ensuring(Effect.gen(function* () {
        armed = true;
        const savingParent = yield* Effect.forkChild(Effect.result(graph.database.commit(parentFinal)));
        yield* Deferred.await(entered);
        childAdmission = true;
        const savingChild = yield* Effect.forkChild(Effect.result(graph.database.commit(childFinal)));
        yield* Deferred.await(childAdmitting);
        yield* Deferred.succeed(release, undefined);
        expect(failed(yield* Fiber.join(savingParent))).toMatchObject({ reason: "unavailable" });
        expect(failed(yield* Fiber.join(savingChild))).toMatchObject({ reason: "unavailable" });
        expect(savedChildren).toEqual([]);
      }).pipe(Effect.timeout("20 seconds")), Deferred.succeed(release, undefined));
    })), 120_000);

    it("enforces protected Product assignments and retention for ordinary Application OCC writers", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, {}, true);
      const insert = (nativeId: string | null, note: string) => Effect.acquireUseRelease(graph.database.begin(), transaction => Effect.gen(function* () {
        const id = yield* transaction.insert("article_links", { product: nativeId, note });
        yield* graph.database.commit(yield* transaction.finalize()); return id;
      }), transaction => transaction.abort());
      expect(failed(yield* Effect.result(insert("missing-product", "missing"))))
        .toMatchObject({ reason: "relationTargetMissing", targetId: "missing-product" });
      yield* graph.write(operations => operations.writeRows(graph.table("product"), "insert", [product("protected-a"), product("protected-race")]));
      const article = yield* insert("protected-a", "retained");
      yield* graph.write(operations => operations.lifecycle(graph.table("product"), "softDelete", ["protected-a"]));
      expect(failed(yield* Effect.result(insert("protected-a", "inactive assignment"))))
        .toMatchObject({ reason: "relationTargetMissing", targetId: "protected-a" });
      const editing = yield* graph.database.begin();
      yield* editing.patch(article, { note: "unrelated retained edit" });
      yield* graph.database.commit(yield* editing.finalize());
      const churning = yield* graph.database.begin();
      yield* churning.patch(article, { product: null });
      yield* churning.patch(article, { product: "protected-a", note: "must not publish" });
      expect(failed(yield* Effect.result(graph.database.commit(yield* churning.finalize()))))
        .toMatchObject({ reason: "relationTargetMissing", targetId: "protected-a" });
      yield* churning.abort();
      const retained = yield* graph.database.begin();
      expect(Option.getOrThrow(yield* retained.get(article))).toMatchObject({ product: "protected-a", note: "unrelated retained edit" });
      yield* retained.abort();
      expect(failed(yield* Effect.result(graph.write(operations => operations.deleteRows(graph.table("product"), ["protected-a"])))))
        .toMatchObject({ reason: "relationDeleteRestricted", targetId: "protected-a" });
      const clearing = yield* graph.database.begin();
      yield* clearing.patch(article, { product: null });
      yield* graph.database.commit(yield* clearing.finalize());
      yield* graph.write(operations => operations.deleteRows(graph.table("product"), ["protected-a"]));
      expect(yield* graph.read("product", { id: "protected-a" })).toHaveLength(0);

      const deleting = yield* graph.begin();
      yield* deleting.operations.deleteRows(graph.table("product"), ["protected-race"]);
      yield* deleting.operations.prepareDeleteClosure();
      const racingArticle = yield* insert("protected-race", "new incoming edge");
      expect(failed(yield* Effect.result(graph.database.commit(yield* deleting.finalize()))))
        .toMatchObject({ reason: "relationDeleteRestricted", targetId: "protected-race" });
      yield* deleting.abort();
      expect(yield* graph.read("product", { id: "protected-race" })).toHaveLength(1);
      const removing = yield* graph.database.begin();
      yield* removing.patch(racingArticle, { product: null });
      yield* graph.database.commit(yield* removing.finalize());
      yield* graph.write(operations => operations.deleteRows(graph.table("product"), ["protected-race"]));
    })), 120_000);
  });
}
