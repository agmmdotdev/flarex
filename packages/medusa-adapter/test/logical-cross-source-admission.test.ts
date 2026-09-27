import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { prepareLogicalApplicationSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/applicationAdmission";
import { prepareLogicalDocumentSourceAdmission } from "../../persistence-postgres/src/logicalDocuments/documentAdmission";
import { defineCmsCommand, makeCmsHost } from "../../persistence-postgres/src/cmsTransaction/host";
import { makeCurrencyAnnouncementHost } from "../../persistence-postgres/src/crossDomainCommand/host";
import { preparedHostTestRuntime } from "../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { currencyAnnouncementWrite } from "../src/currency-service";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { readLogicalStorageRequirements } from "../../persistence-postgres/src/logicalStorageDefinitions";
import { requireStrongReferencePublication } from "../../persistence-postgres/src/commitPublication/strongReferenceAdmission";
import { readBindingActiveReferenceProjection, readBindingHeadProjection } from "../../persistence-postgres/src/frameworkSchema/binding/repository";
import { requireSafeStrongReferenceActivation } from "../../persistence-postgres/src/frameworkSchema/binding/host";
import { runEffectTransaction } from "../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../persistence-postgres/src/metadataTransaction";
import { logicalTableKey, type QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import { projectScopeEpochUuidV1, projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { prepareNativeApplicationJournalOnLogicalScope } from "../../persistence-postgres/test/nativeApplicationJournalOnLogicalScope";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid cross-source admission driver");
const cleanup: Array<() => Promise<void>> = [];
const payloadCollections = [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }] as const;
const product = { namespace: "medusa", logicalName: "commerce.product/product" } as const;
const extensions = [{ name: "user_product", sourceKey: "application",
  source: { table: { namespace: "app", logicalName: "users" }, field: "name" },
  target: { table: product, field: "id" }, policy: "strongReference",
  liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } }, onTargetDelete: "restrict" },
{ name: "news_product", sourceKey: "payload",
  source: { table: { namespace: "app", logicalName: "news" }, field: "title" },
  target: { table: product, field: "id" }, policy: "strongReference",
  liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } }, onTargetDelete: "restrict" }] as const;

describe("cross-source relationship publication and source admission", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includeUserNameIndex: true, payloadCollections, extensions,
    });
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("prepares affected sources and serves unrelated native Currency", async () => {
    const ports = { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts };
    const input = { deploymentId: fixture.deploymentId, scopeId: fixture.application.authority.scopeId,
      schemaVersionId: fixture.schemaVersionId };
    const productHost = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(productHost.host.close);
    await Effect.runPromise(prepareLogicalApplicationSourceAdmission(ports,
      fixture.application.uniqueConstraintEligibility, input, fixture.applicationSource));
    const payload = await Effect.runPromise(compilePayloadCollections(payloadCollections));
    await Effect.runPromise(prepareLogicalDocumentSourceAdmission(ports,
      fixture.application.uniqueConstraintEligibility, input, payload.sourceContract));
    const composite = await Effect.runPromise(makeCurrencyAnnouncementHost({
      hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
      database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle,
      session: fixture.session, deploymentId: fixture.deploymentId,
      scopeId: fixture.application.authority.scopeId,
      authority: fixture.application.authorityPorts, application: fixture.application.activation,
      identityAndAccessPolicy: { profile: "cross-source-admission" }, materialization: {},
      expectedContentIdentity: payload.contentIdentity, currency: fixture.hostInput.logicalStorage,
      applicationSource: fixture.applicationSource, payloadSource: payload.sourceContract,
      currencyCommand: currencyAnnouncementWrite,
      cmsCommand: defineCmsCommand({ name: "payload-create", mode: "write", run: () => Effect.succeed(null) }),
      applicationTable: "users",
    }));
    await Effect.runPromise(composite.close);
    const value = { code: "csr", name: "Unrelated Currency", symbol: "C", symbol_native: "C" };
    expect(await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value)))
      .toMatchObject({ code: value.code, name: value.name });
  }, 120_000);

  it("records endpoint membership and checks actual unaffected Currency publication facts", async () => {
    const value = { code: "gate", name: "Streamed Currency Gate", symbol: "G", symbol_native: "G" };
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), currencyAnnouncementWrite, value));
    const requirements = await Effect.runPromise(readLogicalStorageRequirements(fixture.control.drizzle,
      fixture.deploymentId, fixture.schemaVersionId));
    const tableId = (table: QualifiedLogicalTable) => {
      const binding = requirements.evidence.tableBindings.find(member =>
        logicalTableKey(member.table) === logicalTableKey(table));
      if (binding === undefined) throw new Error("Missing bound logical table");
      return binding.tableId;
    };
    const productId = tableId(product);
    const currencyId = tableId({ namespace: "medusa", logicalName: "commerce.currency/currency" });
    const clock = await fixture.persistence.getScopeClock(fixture.application.authority.scopeId);
    if (clock === null) throw new Error("Missing scope clock");
    const scope = projectScopeIdUuidV1(clock.scopeId);
    const epoch = projectScopeEpochUuidV1(clock.epoch);
    const publicationClock = { record: clock, scopeUuid: scope.scopeUuid, epochUuid: epoch.epochUuid };
    const inspect = <Value, Failure>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<Value, Failure>) =>
      runEffectTransaction(txWork => fixture.persistence.drizzle.transaction(txWork),
        "Check shared strong-reference publication gate", work, cause => new Error("Publication gate transaction", { cause }));
    const head = await Effect.runPromise(inspect(tx => readBindingHeadProjection(tx, clock)));
    expect(head._tag).toBe("Some");
    if (head._tag !== "Some") throw new Error("Missing binding head");
    expect(head.value.frame.strongReferenceTableIds).toContain(productId);
    expect(head.value.frame.strongReferenceTableIds).not.toContain(currencyId);
    const projected = await Effect.runPromise(inspect(tx => readBindingActiveReferenceProjection(tx, clock, head.value)));
    expect(projected.map(reference => reference.name)).toEqual(["user_product", "news_product"]);
    const builds = await fixture.persistence.query<{ index_definition_id: number; maintenance_activation_sequence: string | null }>(
      "select index_definition_id, maintenance_activation_sequence::text as maintenance_activation_sequence " +
      "from fx_system_index_build_state where scope_id=$1 and index_definition_id=any($2::int[])",
      [clock.scopeId, projected.map(reference => reference.reverseIndex.indexDefinitionId)]);
    expect(builds.rows).toHaveLength(2);
    const userReference = projected.find(reference => reference.name === "user_product");
    const newsReference = projected.find(reference => reference.name === "news_product");
    if (userReference === undefined || newsReference === undefined) throw new Error("Missing projected references");
    const maintenanceById = new Map(builds.rows.map(row => [row.index_definition_id, row.maintenance_activation_sequence]));
    expect(maintenanceById.get(userReference.reverseIndex.indexDefinitionId)).not.toBeNull();
    expect(maintenanceById.get(newsReference.reverseIndex.indexDefinitionId)).toBeNull();
    for (const reference of projected) {
      expect(reference.targetTableId).toBe(productId);
      expect(reference.targetLiveness).toEqual({ kind: "softDeleteNull", field: "deleted_at" });
      expect(reference.targetIdentity.kind).toBe("textPrimaryKey");
      expect(reference.reverseIndex.indexDefinitionId).toBeGreaterThan(0);
      expect(reference.reverseIndex.physicalSpec.orderedFields[0]).toMatchObject({
        kind: "documentPath", path: reference.sourceField,
      });
    }
    const publishedTables = await fixture.persistence.query<{ table_id: number }>(
      "select table_id from fx_system_commit_app_row_change where scope_uuid=$1 and commit_seq=$2",
      [scope.scopeUuid, clock.lastCommitSeq]);
    expect(publishedTables.rows.map(row => row.table_id)).toContain(currencyId);
    const observations: string[] = [];
    await Effect.runPromise(inspect(tx => requireStrongReferencePublication(tx, publicationClock,
      clock.lastCommitSeq, { observeQuery: query => observations.push(query.name) })));
    expect(observations).toEqual(["readBindingHead", "readStrongReferenceFacts"]);
  }, 120_000);

  it("rolls back a standalone Application point commit whose target is missing", async () => {
    const native = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(fixture.application, "insert"));
    expect(await Effect.runPromise(Effect.flip(native.publish)))
      .toMatchObject({ reason: "targetNotLive", reference: "user_product" });
    await Effect.runPromise(native.verifyUnchanged);
  }, 120_000);

  it("enforces a Payload source against the same Product target", async () => {
    const productHost = await prepareLogicalProductHost(fixture);
    const compiled = await Effect.runPromise(compilePayloadCollections(payloadCollections));
    const create = defineCmsCommand({ name: "createReferencedNews", mode: "write", run: (ctx, args) =>
      ctx.documents.insert(ctx.context, ctx.transactionId, "news", args) });
    const cms = await Effect.runPromise(makeCmsHost({
      hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle), database: fixture.persistence.drizzle,
      controlDatabase: fixture.control.drizzle, session: fixture.session, deploymentId: fixture.deploymentId,
      scopeId: fixture.application.authority.scopeId,
      authority: fixture.application.authorityPorts, application: fixture.application.activation,
      commands: [create], identityAndAccessPolicy: { profile: "cross-source-payload" }, materialization: {},
      expectedContentIdentity: compiled.contentIdentity,
      logicalStorage: { ports: { controlDb: fixture.control.drizzle, authority: fixture.application.authorityPorts },
        unique: fixture.application.uniqueConstraintEligibility, schemaVersionId: fixture.schemaVersionId,
        source: compiled.sourceContract },
    }));
    try {
      await Effect.runPromise(productHost.host.initialize([]));
      await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductCreate,
        { id: "payload-reference-product", title: "Payload Target", handle: "payload-reference-product" }));
      expect(await Effect.runPromise(cms.run(cms.newRequestKey(), create, {
        title: "payload-reference-product", createdAt: "2026-09-23T00:00:00.000Z",
        updatedAt: "2026-09-23T00:00:00.000Z",
      }))).toMatchObject({ title: "payload-reference-product" });
      expect(await Effect.runPromise(Effect.flip(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductSoftDelete, "payload-reference-product"))))
        .toMatchObject({ reason: "invalidInput",
          cause: { reason: "targetDeleteRestricted", reference: "news_product" } });
    } finally {
      await Effect.runPromise(cms.close);
      await Effect.runPromise(productHost.host.close);
    }
  }, 150_000);

  it("settles Application and Payload references with Currency in one publication", async () => {
    const productHost = await prepareLogicalProductHost(fixture);
    const payload = await Effect.runPromise(compilePayloadCollections(payloadCollections));
    const cmsCommand = defineCmsCommand({ name: "payload-create", mode: "write", run: (ctx, args) =>
      ctx.documents.insert(ctx.context, ctx.transactionId, "news", args) });
    const composite = await Effect.runPromise(makeCurrencyAnnouncementHost({
      hostRuntime: preparedHostTestRuntime(fixture.persistence.drizzle),
      database: fixture.persistence.drizzle, controlDatabase: fixture.control.drizzle,
      session: fixture.session, deploymentId: fixture.deploymentId,
      scopeId: fixture.application.authority.scopeId,
      authority: fixture.application.authorityPorts, application: fixture.application.activation,
      identityAndAccessPolicy: { profile: "mixed-reference-publication" }, materialization: {},
      expectedContentIdentity: payload.contentIdentity, currency: fixture.hostInput.logicalStorage,
      applicationSource: fixture.applicationSource, payloadSource: payload.sourceContract,
      currencyCommand: currencyAnnouncementWrite, cmsCommand, applicationTable: "users",
    }));
    try {
      await Effect.runPromise(productHost.host.initialize([]));
      await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductCreate,
        { id: "mixed-reference-product", title: "Mixed reference target", handle: "mixed-reference-product" }));
      const args = { currency: { code: "mix", name: "Mixed reference Currency", symbol: "M", symbol_native: "M" },
        cms: { title: "mixed-reference-product", createdAt: "2026-09-23T00:00:00.000Z",
          updatedAt: "2026-09-23T00:00:00.000Z" },
        application: { name: "mixed-reference-product" } };
      const before = await logicalCurrencyInventory(fixture);
      const key = composite.newRequestKey();
      const result = await Effect.runPromise(composite.run(key, args));
      expect(result).toMatchObject({ currency: { code: "mix" },
        cms: { title: "mixed-reference-product" }, applicationId: expect.any(String) });
      const published = await logicalCurrencyInventory(fixture);
      expect(published.rows).toHaveLength(before.rows.length + 3);
      expect(published.rowChanges).toHaveLength(before.rowChanges.length + 3);
      expect(published.commits).toHaveLength(before.commits.length + 1);
      expect(published.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(await Effect.runPromise(composite.run(key, args))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(published);
      expect(await Effect.runPromise(Effect.flip(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductSoftDelete, "mixed-reference-product"))))
        .toMatchObject({ reason: "invalidInput",
          cause: { reason: "targetDeleteRestricted", reference: "user_product" } });
      const missing = { currency: { ...args.currency, code: "mis" },
        cms: { ...args.cms, title: "missing-reference-product" },
        application: { name: "missing-reference-product" } };
      const missingFailure = await Effect.runPromise(Effect.flip(composite.run(composite.newRequestKey(), missing)));
      expect(missingFailure)
        .toMatchObject({ reason: "invalidInput",
          cause: { reason: "targetNotLive", reference: "user_product" } });
      expect(await logicalCurrencyInventory(fixture)).toEqual(published);
      const missingPayload = { currency: { ...args.currency, code: "mip" },
        cms: { ...args.cms, title: "missing-payload-product" },
        application: { name: "mixed-reference-product" } };
      expect(await Effect.runPromise(Effect.flip(composite.run(composite.newRequestKey(), missingPayload))))
        .toMatchObject({ reason: "invalidInput",
          cause: { reason: "targetNotLive", reference: "news_product" } });
      expect(await logicalCurrencyInventory(fixture)).toEqual(published);
    } finally {
      await Effect.runPromise(composite.close);
      await Effect.runPromise(productHost.host.close);
    }
  }, 180_000);

  it("accepts a native Application source for a live Product and restricts Product soft deletion", async () => {
    const productHost = await prepareLogicalProductHost(fixture);
    try {
      await Effect.runPromise(productHost.host.initialize([]));
      await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductCreate,
        { id: "strong-reference-witness", title: "Referenced Product", handle: "strong-reference-witness" }));
      const native = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
        fixture.application, "insert", "with-target"));
      if (native.insertedDocumentId === undefined) throw new Error("Missing native source document identity");
      await Effect.runPromise(native.publish);
      await Effect.runPromise(native.verifyScrubbed);
      const activationClock = await fixture.persistence.getScopeClock(fixture.application.authority.scopeId);
      if (activationClock === null) throw new Error("Missing activation scope clock");
      const activationCheck = (inherit: boolean) => runEffectTransaction(
        work => fixture.persistence.drizzle.transaction(work), "Check strong-reference activation",
        (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
          const head = yield* readBindingHeadProjection(tx, activationClock);
          if (head._tag !== "Some") return yield* Effect.fail(new Error("Missing active reference head"));
          const references = yield* readBindingActiveReferenceProjection(tx, activationClock, head.value);
          yield* requireSafeStrongReferenceActivation(tx, activationClock.scopeId,
            inherit ? references : [], references);
        }), cause => new Error("Activation check transaction failed", { cause }));
      expect(await Effect.runPromise(Effect.flip(activationCheck(false))))
        .toMatchObject({ reason: "unsupportedProfile" });
      await Effect.runPromise(activationCheck(true));
      const deletion = await Effect.runPromise(Effect.flip(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductSoftDelete, "strong-reference-witness")));
      expect(deletion).toMatchObject({ reason: "invalidInput",
        cause: { reason: "targetDeleteRestricted", reference: "user_product" } });
      const current = await Effect.runPromise(productHost.host.read(
        productHost.runtime.commands.internalProductRetrieve,
        { id: "strong-reference-witness", config: { select: ["id", "deleted_at"] } }));
      expect(current).toMatchObject({ id: "strong-reference-witness", deleted_at: null });
      const detach = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
        fixture.application, "delete", "detach-source", native.insertedDocumentId));
      await Effect.runPromise(detach.publish);
      await Effect.runPromise(detach.verifyScrubbed);
      await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductSoftDelete, "strong-reference-witness"));
      expect(await Effect.runPromise(productHost.host.read(productHost.runtime.commands.internalProductRetrieve,
        { id: "strong-reference-witness", config: { select: ["id", "deleted_at"], withDeleted: true } })))
        .toMatchObject({ id: "strong-reference-witness", deleted_at: expect.any(String) });
      const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: fixture.resource, includeProduct: true, payloadCollections, extensions,
        fixtureIdentity: { deploymentId: "deployment_cross_reference_shop_b",
          projectId: "project_cross_reference_shop_b", uuidOffset: 10_000 },
      });
      const otherProduct = await prepareLogicalProductHost(other);
      try {
        expect(other.persistence).toBe(fixture.persistence);
        await Effect.runPromise(otherProduct.host.initialize([]));
        await Effect.runPromise(otherProduct.host.run(otherProduct.host.newRequestKey(),
          otherProduct.runtime.commands.internalProductCreate,
          { id: "strong-reference-witness", title: "Other Shop Product", handle: "other-shop-reference" }));
        const foreign = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
          fixture.application, "insert", "other-shop-only"));
        expect(await Effect.runPromise(Effect.flip(foreign.publish)))
          .toMatchObject({ reason: "targetNotLive", reference: "user_product" });
        await Effect.runPromise(foreign.verifyUnchanged);
      } finally { await Effect.runPromise(otherProduct.host.close); }
      if (driver === "postgres") {
        await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
          productHost.runtime.commands.internalProductRestore, "strong-reference-witness"));
        const racingSource = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
          fixture.application, "insert", "concurrent-insert-delete"));
        const [insert, remove] = await Promise.allSettled([
          Effect.runPromise(racingSource.publish),
          Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
            productHost.runtime.commands.internalProductSoftDelete, "strong-reference-witness")),
        ]);
        expect([insert.status, remove.status].sort()).toEqual(["fulfilled", "rejected"]);
        const after = await Effect.runPromise(productHost.host.read(
          productHost.runtime.commands.internalProductRetrieve,
          { id: "strong-reference-witness", config: { select: ["id", "deleted_at"], withDeleted: true } }));
        if (insert.status === "fulfilled") {
          await Effect.runPromise(racingSource.verifyScrubbed);
          expect(after).toMatchObject({ id: "strong-reference-witness", deleted_at: null });
        } else {
          await Effect.runPromise(racingSource.verifyUnchanged);
          expect(after).toMatchObject({ id: "strong-reference-witness", deleted_at: expect.any(String) });
        }
      }
    } finally { await Effect.runPromise(productHost.host.close); }
  }, 180_000);

  it("enforces a native Product source against an Application document identity", async () => {
    const productUser = [{ name: "product_user", sourceKey: "medusa.product",
      source: { table: product, field: "id" },
      target: { table: { namespace: "app", logicalName: "users" }, field: "_id" },
      policy: "strongReference",
      liveness: { source: { kind: "softDeleteNull", field: "deleted_at" }, target: { kind: "current" } },
      onTargetDelete: "restrict" }] as const;
    const origin = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true, payloadCollections, extensions: productUser,
      fixtureIdentity: { deploymentId: "deployment_medusa_reference_source",
        projectId: "project_medusa_reference_source", uuidOffset: 20_000 },
    });
    const productHost = await prepareLogicalProductHost(origin);
    try {
      await Effect.runPromise(productHost.host.initialize([]));
      const target = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
        origin.application, "insert", "medusa-reference-target"));
      if (target.insertedDocumentId === undefined) throw new Error("Missing Application target identity");
      await Effect.runPromise(target.publish);
      await Effect.runPromise(target.verifyScrubbed);
      const productId = target.insertedDocumentId;
      const input = { id: productId, title: "Application-owned target", handle: "medusa-reference-source" };
      const createKey = productHost.host.newRequestKey();
      const created = await Effect.runPromise(productHost.host.run(createKey,
        productHost.runtime.commands.internalProductCreate, input));
      expect(created).toMatchObject({ id: productId });
      expect(await Effect.runPromise(productHost.host.run(createKey,
        productHost.runtime.commands.internalProductCreate, input))).toEqual(created);
      const foreign = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: fixture.resource, includeProduct: true, payloadCollections, extensions: productUser,
        fixtureIdentity: { deploymentId: "deployment_medusa_reference_foreign",
          projectId: "project_medusa_reference_foreign", uuidOffset: 30_000 },
      });
      const foreignProduct = await prepareLogicalProductHost(foreign);
      try {
        await Effect.runPromise(foreignProduct.host.initialize([]));
        expect(await Effect.runPromise(Effect.flip(foreignProduct.host.run(foreignProduct.host.newRequestKey(),
          foreignProduct.runtime.commands.internalProductCreate, input))))
          .toMatchObject({ reason: "invalidInput",
            cause: { reason: "targetNotLive", reference: "product_user" } });
      } finally { await Effect.runPromise(foreignProduct.host.close); }
      const restricted = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
        origin.application, "delete", "medusa-reference-restricted", productId));
      expect(await Effect.runPromise(Effect.flip(restricted.publish)))
        .toMatchObject({ reason: "targetDeleteRestricted", reference: "product_user" });
      await Effect.runPromise(restricted.verifyUnchanged);
      await Effect.runPromise(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductSoftDelete, productId));
      const released = await Effect.runPromise(prepareNativeApplicationJournalOnLogicalScope(
        origin.application, "delete", "medusa-reference-released", productId));
      await Effect.runPromise(released.publish);
      await Effect.runPromise(released.verifyScrubbed);
      expect(await Effect.runPromise(Effect.flip(productHost.host.run(productHost.host.newRequestKey(),
        productHost.runtime.commands.internalProductRestore, productId))))
        .toMatchObject({ reason: "invalidInput",
          cause: { reason: "targetNotLive", reference: "product_user" } });
      expect(await Effect.runPromise(productHost.host.read(productHost.runtime.commands.internalProductRetrieve,
        { id: productId, config: { select: ["id", "deleted_at"], withDeleted: true } })))
        .toMatchObject({ id: productId, deleted_at: expect.any(String) });
    } finally { await Effect.runPromise(productHost.host.close); }
  }, 180_000);
});
