import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { productLogicalCollectionCreateEventPolicy, productLogicalCreateEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { findCollectionMembershipProducts } from "../src/product-collection-membership";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;

async function prepareCreationHost() {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  const host = await Effect.runPromise(prepareProductCreateWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
      moduleEvents: productLogicalCreateEventPolicy(catalog) } },
    revision: createHash("sha256").update("logical-product-create-workflow").digest("hex"),
    subscribers: [{ id: "logical-product-create", revision: "a".repeat(64) }],
  }));
  return { catalog, host };
}

async function prepareCollectionCreationHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  const policy = productLogicalCollectionCreateEventPolicy(catalog);
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand("productCollectionCreateRoot", (ctx, input) =>
    ctx.call(participant, product.runtime.commands.createCollections, input));
  const revision = createHash("sha256").update("logical-product-collection-create").digest("hex");
  const contract = defineCommerceEventContract({ name: catalog.collection.createdEvent, revision,
    internal: true, decode: policy.capture });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-collection-create" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [product.runtime.commands.createCollections], validateLogical: policy.validateLogical,
      events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
    commands: [root], events: { producerRevision: revision, contracts: [contract],
      subscribers: [{ id: "logical-product-collection-create", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

describe("native Product creation on shared logical storage", () => {
  beforeAll(async () => {
    currency = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true });
    product = await prepareLogicalProductHost(currency);
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 180_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Logical Product fixture cleanup failed");
  }, 120_000);

  it("runs the native creation step, reads pending Products and publishes matched module events once", async () => {
    const { host } = await prepareCreationHost();
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      // Reverse ID order so the graph reader's ID ordering cannot replace the
      // native createProductsStep result order.
      const input = { products: [{ id: "prod_logical_beta", title: "Logical Beta" },
        { id: "prod_logical_alpha", title: "Logical Alpha" }] };
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, input))).toMatchObject({ products: input.products });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterRows).toHaveLength(beforeRows.length + 2);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual(["product.product.created", "product.product.created"]);
      expect(await Effect.runPromise(host.run(key, input))).toMatchObject({ products: input.products });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { products: [
        { id: "prod_logical_conflict", title: "Logical Alpha" },
      ] }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("creates a native Collection and Products linked by the shared logical foreign key", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const collection = await prepareCollectionCreationHost(catalog);
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieveCollection, product.runtime.commands.retrieve],
    }));
    try {
      const collectionKey = collection.host.newRequestKey();
      const collectionInput = { id: "pcol_logical_owned", title: "Logical Collection" };
      const createdCollection = await Effect.runPromise(collection.host.run(collectionKey, collection.root, collectionInput));
      expect(createdCollection).toMatchObject({ id: collectionInput.id });
      const productKey = create.newRequestKey();
      const productId = "prod_logical_collection_owned";
      const productInput = { products: [{ id: productId, title: "Owned Collection Product",
        collection_id: collectionInput.id }] };
      const createdProduct = await Effect.runPromise(create.run(productKey, productInput));
      expect(createdProduct).toMatchObject({ products: [{ id: productId }] });
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieveCollection, {
        id: collectionInput.id, config: { select: ["id", "products.id"], relations: ["products"] },
      }))).toMatchObject({ id: collectionInput.id, products: [{ id: productId }] });
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: productId, config: { relations: ["collection"] },
      }))).toMatchObject({ id: productId, collection: { id: collectionInput.id } });
      const unassignedId = "prod_logical_collection_null";
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: unassignedId, title: "Unassigned Product", collection_id: null,
      }] }));
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: unassignedId, config: { relations: ["collection"] },
      }))).toMatchObject({ id: unassignedId, collection_id: null });
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieveCollection, {
        id: collectionInput.id, config: { select: ["id", "products.id"], relations: ["products"] },
      }))).toMatchObject({ id: collectionInput.id, products: [{ id: productId }] });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(await Effect.runPromise(collection.host.run(collectionKey, collection.root, collectionInput)))
        .toEqual(createdCollection);
      expect(await Effect.runPromise(create.run(productKey, productInput))).toEqual(createdProduct);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_collection_missing", title: "Missing Collection", collection_id: "pcol_missing",
      }] }))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      expect((await currency.persistence.query<{ name: string }>(
        "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(currency.physicalTablesBeforeCandidate);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(collection.host.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("creates an owned Product graph with authenticated entity events and one pivot", async () => {
    const { catalog, host } = await prepareCreationHost();
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const input = { products: [{ id: "prod_logical_graph", title: "Logical Graph",
        images: [{ id: "img_logical_graph", url: "logical-graph.png" }],
        options: [{ title: "Size", values: ["Small", "Large"] }],
        variants: [{ id: "pvar_logical_graph", title: "Small", sku: "logical-graph-small", options: { Size: "Small" } }],
      }] };
      const key = host.newRequestKey();
      const created = await Effect.runPromise(host.run(key, input));
      expect(created).toMatchObject({ products: [{ id: input.products[0]?.id, title: input.products[0]?.title,
        images: [{ id: "img_logical_graph", url: "logical-graph.png" }],
        options: [{ title: "Size", values: expect.arrayContaining([
          expect.objectContaining({ value: "Small" }), expect.objectContaining({ value: "Large" }),
        ]) }],
        variants: [{ id: "pvar_logical_graph", options: [{ value: "Small" }] }],
      }] });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterRows).toHaveLength(beforeRows.length + 7);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract).sort()).toEqual([
        catalog.product.createdEvent, catalog.image.createdEvent, catalog.option.createdEvent,
        catalog.value.createdEvent, catalog.value.createdEvent, catalog.variant.createdEvent,
      ].sort());
      expect(await Effect.runPromise(host.run(key, input))).toEqual(created);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { products: [{
        id: "prod_logical_graph_conflict", title: "Logical Graph Conflict",
        options: [{ title: "Size", values: ["Small"] }],
        variants: [{ title: "Small", sku: "logical-graph-small", options: { Size: "Small" } }],
      }] }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("serves native public filtered Product reads and owned population beyond unrelated rows", async () => {
    const { host: create } = await prepareCreationHost();
    const seed = defineCommerceCommand("logicalProductReadSeed", "write", Effect.fn("ProductTest.seedReadRows")(function* (ctx, input) {
      if (!isJsonObject(input) || (input.table !== "product" && input.table !== "image") ||
        !Array.isArray(input.values) || !input.values.every(isJsonObject)) return yield* ctx.refuse(commerceError("invalidInput"));
      return yield* (yield* ctx.table(input.table)).write(ctx.manager, "insert", input.values);
    }));
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [...product.hostInput.commands, product.runtime.commands.list,
        product.runtime.commands.retrieve, product.runtime.commands.count, seed],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_logical_public_read", title: "Public Read",
        images: [{ id: "img_logical_public_read", url: "selected.png" },
          { id: "img_logical_public_read_2", url: "selected-2.png" }],
        options: [{ title: "Size", values: ["Small"] }],
        variants: [{ id: "pvar_logical_public_read", title: "Small", options: { Size: "Small" } }],
      }] }));
      await Effect.runPromise(read.run(read.newRequestKey(), product.runtime.commands.internalProductCreate,
        { id: "prod_logical_unrelated_read", title: "Unrelated", handle: "unrelated-read" }));
      for (let start = 0; start < 130; start += 20) await Effect.runPromise(read.run(read.newRequestKey(), seed, {
        table: "product", values: Array.from({ length: Math.min(20, 130 - start) }, (_, index) => ({
          id: `prod_logical_unrelated_${start + index}`, title: "Unrelated Product",
          handle: `unrelated-product-${start + index}`,
        })),
      }));
      for (let start = 0; start < 130; start += 20) await Effect.runPromise(read.run(read.newRequestKey(), seed, {
        table: "image", values: Array.from({ length: Math.min(20, 130 - start) }, (_, index) => ({
          id: `img_logical_unrelated_${start + index}`, url: "unrelated.png", product_id: "prod_logical_unrelated_read",
        })),
      }));
      const selected = await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_public_read" }, config: { relations: ["images", "options.values", "variants.options"] },
      }));
      expect(selected).toMatchObject([{ id: "prod_logical_public_read", images: [{ id: "img_logical_public_read", rank: 0 },
        { id: "img_logical_public_read_2", rank: 1 }],
        options: [{ values: [{ value: "Small" }] }], variants: [{ options: [{ value: "Small" }] }] }]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: "prod_logical_public_read", config: { select: ["title"] },
      }))).toEqual({ title: "Public Read" });
      expect(await Effect.runPromise(read.read(product.runtime.commands.count, {
        filters: { id: "prod_logical_public_read" }, config: { take: 0, relations: ["images"] },
      }))).toEqual([[], 1]);
      const page = await Effect.runPromise(read.read(product.runtime.commands.count, {
        filters: { id: ["prod_logical_public_read", "prod_logical_unrelated_read"] },
        config: { take: 1, relations: ["images"] },
      }));
      expect(page).toMatchObject([[{ id: "prod_logical_public_read" }], 2]);
      await Effect.runPromise(read.run(read.newRequestKey(), product.runtime.commands.internalProductSoftDelete,
        "prod_logical_public_read"));
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_public_read" },
      }))).toEqual([]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.list, {
        filters: { id: "prod_logical_public_read" }, config: { withDeleted: true, relations: ["images"] },
      }))).toMatchObject([{ id: "prod_logical_public_read", deleted_at: expect.any(String),
        images: [{ deleted_at: expect.any(String) }, { deleted_at: expect.any(String) }] }]);
    } finally {
      await Effect.runPromise(read.close);
      await Effect.runPromise(create.close);
    }
  }, 120_000);

  it("selects a requested Collection member beside an unrelated Product catalog", async () => {
    const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const seed = defineCommerceCommand("logicalCollectionMembershipSeed", "write", (ctx, input) =>
      Effect.gen(function* () {
        if (!Array.isArray(input) || !input.every(isJsonObject)) return yield* ctx.refuse(commerceError("invalidInput"));
        return yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "insert", input);
      }));
    const members = defineCommerceCommand("logicalCollectionMembershipRead", "read", (ctx, input) =>
      findCollectionMembershipProducts(ctx, catalog, input));
    const host = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [seed, members],
    }));
    try {
      for (let start = 0; start < 260; start += 20) await Effect.runPromise(host.run(host.newRequestKey(), seed,
        Array.from({ length: 20 }, (_, index) => ({ id: `prod_member_unrelated_${start + index}`,
          title: "Unrelated Product", handle: `member-unrelated-${start + index}` }))));
      await Effect.runPromise(host.run(host.newRequestKey(), seed,
        [{ id: "prod_member_selected", title: "Selected Product", handle: "member-selected" }]));
      expect(await Effect.runPromise(host.read(members, { where: { id: { $in: ["prod_member_selected"] } },
        options: { populate: [] } }))).toMatchObject([{ id: "prod_member_selected" }]);
      expect(await Effect.runPromise(host.read(members, { where: { id: { $in: [] } },
        options: { populate: [] } }))).toEqual([]);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
