import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCollectionCreateEventPolicy, productLogicalCollectionDeleteEventPolicy,
  productLogicalCollectionUpdateEventPolicy, productLogicalCollectionUpsertEventPolicy,
  productLogicalCreateEventPolicy } from "../src/product-local-events";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Collection test driver");
const cleanup: Array<() => Promise<void>> = [];

describe("native Collection service on shared logical Product storage", () => {
  let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
  let catalog: Effect.Success<ReturnType<typeof productRuntimeMetadata>>;
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(product.host.initialize([]));
    catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  }, 180_000);
  afterAll(async () => {
    await Effect.runPromise(product.host.close);
    for (const close of cleanup.reverse()) await close();
  }, 120_000);

  async function command(operation: "createCollection" | "updateCollection" | "upsertCollection" | "deleteCollection" | "createProduct",
    selectedFixture = fixture, selectedProduct = product, rejectReceipt = false) {
    const native = operation === "createCollection" ? selectedProduct.runtime.commands.createCollections
      : operation === "updateCollection" ? selectedProduct.runtime.commands.updateCollections
        : operation === "upsertCollection" ? selectedProduct.runtime.commands.upsertCollections
      : operation === "deleteCollection" ? selectedProduct.runtime.commands.deleteCollections
        : selectedProduct.runtime.commands.create;
    const policy = operation === "createCollection" ? productLogicalCollectionCreateEventPolicy(catalog)
      : operation === "updateCollection" ? productLogicalCollectionUpdateEventPolicy(catalog)
        : operation === "upsertCollection" ? productLogicalCollectionUpsertEventPolicy(catalog)
      : operation === "deleteCollection" ? productLogicalCollectionDeleteEventPolicy(catalog)
        : productLogicalCreateEventPolicy(catalog);
    const eventNames = operation === "createCollection" ? [catalog.collection.createdEvent]
      : operation === "updateCollection" ? [catalog.collection.updatedEvent]
        : operation === "upsertCollection" ? [catalog.collection.createdEvent, catalog.collection.updatedEvent]
          : operation === "deleteCollection" ? [catalog.collection.deletedEvent] : [catalog.product.createdEvent];
    const revision = createHash("sha256").update(`logical-product-${operation}`).digest("hex");
    const namedContracts = eventNames.map(name => ({ name,
      token: defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture }) }));
    const contracts = namedContracts.map(entry => entry.token);
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`native${operation}`, (ctx, input) => ctx.call(participant, native, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: `logical-product-${operation}` },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [native], validateLogical: rejectReceipt
          ? (...args) => policy.validateLogical(...args).pipe(Effect.andThen(Effect.fail(commerceError("receiptMismatch"))))
          : policy.validateLogical,
        ...(operation === "deleteCollection" ? { allowSetNull: true as const } : {}),
        events: { contracts, select: event => {
          const contract = isJsonObject(event) && typeof event.name === "string"
            ? namedContracts.find(candidate => candidate.name === event.name)?.token : undefined;
          return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
        } } }],
      commands: [root], events: { producerRevision: revision, contracts,
        subscribers: [{ id: `logical-product-${operation}`, revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

  it("runs native scalar create, update and mixed upsert with shared reads and exact events", async () => {
    const created = await command("createCollection");
    const updated = await command("updateCollection");
    const upserted = await command("upsertCollection");
    const rejectedUpsert = await command("upsertCollection", fixture, product, true);
    const reads = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.retrieveCollection,
        product.runtime.commands.listCollections, product.runtime.commands.countCollections],
    }));
    try {
      const before = await logicalCurrencyInventory(fixture);
      const first = { id: "pcol_scalar_a", title: "First", handle: "scalar-first" };
      const key = created.host.newRequestKey();
      expect(await Effect.runPromise(created.host.run(key, created.root, first))).toMatchObject(first);
      const afterCreate = await logicalCurrencyInventory(fixture);
      expect(afterCreate.rows).toHaveLength(before.rows.length + 1);
      expect(afterCreate.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(afterCreate.events.slice(before.events.length).map(event => event.envelope.contract))
        .toEqual([catalog.collection.createdEvent]);
      expect(await Effect.runPromise(created.host.run(key, created.root, first))).toMatchObject(first);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterCreate);

      expect(await Effect.runPromise(updated.host.run(updated.host.newRequestKey(), updated.root,
        { id: first.id, data: { title: "Updated" } }))).toMatchObject({ id: first.id, title: "Updated" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: first.id }))).toMatchObject({ id: first.id, title: "Updated" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.listCollections,
        { filters: { handle: first.handle }, config: { take: 1 } })))
        .toMatchObject([{ id: first.id, title: "Updated" }]);

      const beforeUpsert = await logicalCurrencyInventory(fixture);
      const mixed = [{ id: first.id, title: "Upserted" }, { title: "Second", handle: "scalar-second" }];
      const upsertKey = upserted.host.newRequestKey();
      const result = await Effect.runPromise(upserted.host.run(upsertKey, upserted.root, mixed));
      expect(result).toHaveLength(2);
      const afterUpsert = await logicalCurrencyInventory(fixture);
      expect(afterUpsert.rows).toHaveLength(beforeUpsert.rows.length + 1);
      expect(afterUpsert.rowChanges).toHaveLength(beforeUpsert.rowChanges.length + 2);
      expect(new Set(afterUpsert.rowChanges.slice(beforeUpsert.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      expect(afterUpsert.events.slice(beforeUpsert.events.length).map(event => event.envelope.contract).sort())
        .toEqual([catalog.collection.createdEvent, catalog.collection.updatedEvent].sort());
      expect(await Effect.runPromise(upserted.host.run(upsertKey, upserted.root, mixed))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(afterUpsert);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.countCollections,
        { filters: {}, config: { take: 1, skip: 1 } })))
        .toMatchObject([[{ id: expect.any(String) }], 2]);
      expect(await Effect.runPromise(reads.read(product.runtime.commands.retrieveCollection,
        { id: first.id }))).toMatchObject({ id: first.id, title: "Upserted" });
      expect(await Effect.runPromise(reads.read(product.runtime.commands.listCollections,
        { filters: { handle: "scalar-second" }, config: { take: 1 } })))
        .toMatchObject([{ title: "Second" }]);

      const beforeRefusals = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejectedUpsert.host.run(rejectedUpsert.host.newRequestKey(), rejectedUpsert.root,
        [{ id: first.id, title: "Must not publish" }]))).rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await Effect.runPromise(Effect.result(upserted.host.run(upserted.host.newRequestKey(), upserted.root,
        [{ title: "Must roll back" }, { id: "pcol_scalar_missing", title: "Missing" }]))))
        .toMatchObject({ _tag: "Failure" });
      expect(await Effect.runPromise(Effect.result(created.host.run(created.host.newRequestKey(), created.root,
        { title: "Duplicate", handle: first.handle })))).toMatchObject({ _tag: "Failure" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(beforeRefusals);
    } finally {
      await Effect.runPromise(reads.close);
      await Effect.runPromise(created.host.close);
      await Effect.runPromise(updated.host.close);
      await Effect.runPromise(upserted.host.close);
      await Effect.runPromise(rejectedUpsert.host.close);
    }
  }, 180_000);

  it("refuses native Collection membership changes in the scalar host without publication", async () => {
    const createCollection = await command("createCollection");
    const updateCollection = await command("updateCollection");
    const upsertCollection = await command("upsertCollection");
    const createProduct = await command("createProduct");
    try {
      await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
        { id: "prod_collection_scalar_member", title: "Member" }));
      await Effect.runPromise(createCollection.host.run(createCollection.host.newRequestKey(), createCollection.root,
        { id: "pcol_scalar_existing", title: "Existing" }));
      const before = await logicalCurrencyInventory(fixture);
      for (const [host, root, input] of [
        [createCollection.host, createCollection.root,
          { id: "pcol_scalar_empty", title: "Empty", product_ids: [] }],
        [updateCollection.host, updateCollection.root,
          { id: "pcol_scalar_existing", data: { product_ids: [] } }],
        [upsertCollection.host, upsertCollection.root,
          [{ id: "pcol_scalar_existing", product_ids: [] }]],
      ] as const) {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), root, input)))
          .rejects.toMatchObject({ reason: "receiptMismatch" });
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
      const refusal = await Effect.runPromise(Effect.result(createCollection.host.run(createCollection.host.newRequestKey(), createCollection.root,
        { id: "pcol_scalar_membership", title: "Unsupported Membership", product_ids: ["prod_collection_scalar_member"] })));
      expect(refusal).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    } finally {
      await Effect.runPromise(createCollection.host.close);
      await Effect.runPromise(updateCollection.host.close);
      await Effect.runPromise(upsertCollection.host.close);
      await Effect.runPromise(createProduct.host.close);
    }
  }, 120_000);

  it("rejects an unaccounted lifecycle observation in a Collection update receipt", async () => {
    const policy = productLogicalCollectionUpdateEventPolicy(catalog);
    expect(await Effect.runPromise(Effect.result(policy.validateLogical([{
      commandName: "productupdatecollection", mode: "write", input: { id: "pcol_receipt", data: { title: "After" } },
      result: { id: "pcol_receipt" }, events: [], fromAttempt: 0, toAttempt: 0,
      fromLifecycle: 0, toLifecycle: 1,
    }], [], [{ table: catalog.collection.table.name, key: { id: "pcol_receipt" }, operation: "softDelete",
      beforeDeletedAt: null, afterDeletedAt: "2025-01-01T00:00:00.000Z", attemptOrdinal: null,
      rowAtOperation: null }], [], []))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });

  it("detaches 160 Products with one root event, replay, rollback and shop isolation", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource, includeProduct: true,
      fixtureIdentity: { deploymentId: "deployment_collection_delete_shop_b",
        projectId: "project_collection_delete_shop_b", uuidOffset: 15_000 },
    });
    const otherProduct = await prepareLogicalProductHost(other);
    await Effect.runPromise(otherProduct.host.initialize([]));
    const create = await command("createCollection");
    const createOther = await command("createCollection", other, otherProduct);
    const createProduct = await command("createProduct");
    const createOtherProduct = await command("createProduct", other, otherProduct);
    const deleted = await command("deleteCollection");
    const rejected = await command("deleteCollection", fixture, product, true);
    const collectionId = "pcol_shared_detach";
    try {
      await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
        { id: collectionId, title: "First Collection" }));
      await Effect.runPromise(createOther.host.run(createOther.host.newRequestKey(), createOther.root,
        { id: collectionId, title: "Second Collection" }));
      await Effect.runPromise(createOtherProduct.host.run(createOtherProduct.host.newRequestKey(), createOtherProduct.root,
        { id: "prod_collection_shop_b", title: "Other shop", collection_id: collectionId }));
      for (let batch = 0; batch < 5; batch++) {
        const rows = Array.from({ length: 32 }, (_, index) => ({
          id: `prod_collection_fanout_${batch * 32 + index}`,
          title: `Collection fan-out ${batch * 32 + index}`,
          handle: `collection-fanout-${batch * 32 + index}`, collection_id: collectionId,
        }));
        expect(await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root, rows)))
          .toMatchObject(rows);
      }
      const before = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(rejected.host.run(rejected.host.newRequestKey(), rejected.root, [collectionId])))
        .rejects.toMatchObject({ reason: "receiptMismatch" });
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      const key = deleted.host.newRequestKey();
      const result = await Effect.runPromise(deleted.host.run(key, deleted.root, [collectionId]));
      const after = await logicalCurrencyInventory(fixture);
      expect(after.rows).toHaveLength(before.rows.length);
      expect(after.revisions).toHaveLength(before.revisions.length + 161);
      expect(after.indexRevisions.length).toBeGreaterThan(before.indexRevisions.length + 160);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 161);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract))
        .toEqual([catalog.collection.deletedEvent]);
      expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      for (const index of [0, 31, 32, 63, 64, 95, 96, 127, 128, 159]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: `prod_collection_fanout_${index}` })))
          .toMatchObject({ id: `prod_collection_fanout_${index}`, collection_id: null });
      }
      expect(await Effect.runPromise(otherProduct.host.read(otherProduct.runtime.commands.internalProductRetrieve,
        { id: "prod_collection_shop_b" }))).toMatchObject({ collection_id: collectionId });
      expect(await Effect.runPromise(deleted.host.run(key, deleted.root, [collectionId]))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(after);
    } finally {
      await Effect.runPromise(create.host.close);
      await Effect.runPromise(createOther.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(createOtherProduct.host.close);
      await Effect.runPromise(deleted.host.close);
      await Effect.runPromise(rejected.host.close);
      await Effect.runPromise(otherProduct.host.close);
    }
  }, 240_000);

  it("seals two Collection references in one native delete", async () => {
    const create = await command("createCollection");
    const createProduct = await command("createProduct");
    const deleted = await command("deleteCollection");
    const ids = ["pcol_multi_a", "pcol_multi_b"];
    try {
      for (const [index, id] of ids.entries()) {
        await Effect.runPromise(create.host.run(create.host.newRequestKey(), create.root,
          { id, title: `Multiple Collection ${index}` }));
        await Effect.runPromise(createProduct.host.run(createProduct.host.newRequestKey(), createProduct.root,
          { id: `prod_multi_${index}`, title: `Multiple Product ${index}`, collection_id: id }));
      }
      const before = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(deleted.host.run(deleted.host.newRequestKey(), deleted.root, ids));
      const after = await logicalCurrencyInventory(fixture);
      expect(after.revisions).toHaveLength(before.revisions.length + 4);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      expect(new Set(after.rowChanges.slice(before.rowChanges.length).map(change => change.commitSeq)).size).toBe(1);
      for (const index of [0, 1]) {
        expect(await Effect.runPromise(product.host.read(product.runtime.commands.internalProductRetrieve,
          { id: `prod_multi_${index}` }))).toMatchObject({ collection_id: null });
      }
    } finally {
      await Effect.runPromise(create.host.close);
      await Effect.runPromise(createProduct.host.close);
      await Effect.runPromise(deleted.host.close);
    }
  }, 120_000);
});
