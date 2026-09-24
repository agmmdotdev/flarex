import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCollectionCreateEventPolicy, productLogicalCollectionDeleteEventPolicy,
  productLogicalCreateEventPolicy } from "../src/product-local-events";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Collection test driver");
const cleanup: Array<() => Promise<void>> = [];

describe("native Collection deletion on shared logical Product storage", () => {
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

  async function command(operation: "createCollection" | "deleteCollection" | "createProduct",
    selectedFixture = fixture, selectedProduct = product, rejectReceipt = false) {
    const native = operation === "createCollection" ? selectedProduct.runtime.commands.createCollections
      : operation === "deleteCollection" ? selectedProduct.runtime.commands.deleteCollections
        : selectedProduct.runtime.commands.create;
    const policy = operation === "createCollection" ? productLogicalCollectionCreateEventPolicy(catalog)
      : operation === "deleteCollection" ? productLogicalCollectionDeleteEventPolicy(catalog)
        : productLogicalCreateEventPolicy(catalog);
    const eventName = operation === "createCollection" ? catalog.collection.createdEvent
      : operation === "deleteCollection" ? catalog.collection.deletedEvent : catalog.product.createdEvent;
    const revision = createHash("sha256").update(`logical-product-${operation}`).digest("hex");
    const contract = defineCommerceEventContract({ name: eventName, revision, internal: true, decode: policy.capture });
    const participant = defineAtomicCommerceParticipant("product");
    const root = defineAtomicCommerceCommand(`native${operation}`, (ctx, input) => ctx.call(participant, native, input));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
      identityAndAccessPolicy: { profile: `logical-product-${operation}` },
      participants: [{ participant, logicalStorage: selectedProduct.hostInput.logicalStorage,
        commands: [native], validateLogical: rejectReceipt
          ? (...args) => policy.validateLogical(...args).pipe(Effect.andThen(Effect.fail(commerceError("receiptMismatch"))))
          : policy.validateLogical,
        ...(operation === "deleteCollection" ? { allowSetNull: true as const } : {}),
        events: { contracts: [contract], select: event => isJsonObject(event) && event.name === eventName
          ? Effect.succeed(contract) : Effect.fail(commerceError("unadmittedEvent")) } }],
      commands: [root], events: { producerRevision: revision, contracts: [contract],
        subscribers: [{ id: `logical-product-${operation}`, revision: "a".repeat(64) }],
        validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    return { host, root };
  }

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
