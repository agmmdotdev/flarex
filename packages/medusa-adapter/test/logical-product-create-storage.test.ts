import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Result } from "effect";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { productLogicalCollectionCreateEventPolicy, productLogicalCollectionMembershipEventPolicy,
  productLogicalCreateEventPolicy } from "../src/product-local-events";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductCollectionMembershipWorkflow } from "../src/product-collection-workflow";
import { findCollectionMembershipProducts } from "../src/product-collection-membership";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
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

async function prepareCollectionMembershipHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  return Effect.runPromise(prepareProductCollectionMembershipWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage,
      moduleEvents: productLogicalCollectionMembershipEventPolicy(catalog) } },
    revision: createHash("sha256").update("logical-product-collection-membership").digest("hex"),
    subscribers: [{ id: "logical-product-collection-membership", revision: "a".repeat(64) }],
  }));
}

async function prepareForgedCollectionMembershipHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"],
  forged: "collectionScalar" | "productScalar" | "foreignCollection" | "foreignProduct" | "repeatValid") {
  const policy = productLogicalCollectionMembershipEventPolicy(catalog);
  const participant = defineAtomicCommerceParticipant("product");
  const command = defineCommerceCommand("productupdatecollection", "write", Effect.fn("ProductTest.forgedMembership")(function* (ctx, input) {
    if (!isJsonObject(input) || typeof input.id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    const id = input.id;
    const collectionId = forged === "foreignCollection" ? "pcol_members_other" : id;
    yield* (yield* ctx.table(catalog.collection.table.name)).write(ctx.manager, "update", [{
      id: collectionId, title: forged === "collectionScalar" ? "Forged Collection"
        : forged === "foreignCollection" ? "Other Collection" : "Target Collection",
    }]);
    yield* ctx.captureLocalEvent({ name: catalog.collection.updatedEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.collection.eventObject, action: CommonEvents.UPDATED },
      data: { id: collectionId } });
    if (forged === "productScalar" || forged === "foreignProduct") {
      const productId = forged === "foreignProduct" ? "prod_members_remove" : "prod_members_keep";
      yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "update",
        [forged === "foreignProduct" ? { id: productId, collection_id: id }
          : { id: productId, title: "Forged Product" }]);
      yield* ctx.captureLocalEvent({ name: catalog.product.updatedEvent,
        metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED },
        data: { id: productId } });
    }
    return { id };
  }));
  const root = defineAtomicCommerceCommand("forgedCollectionMembership", (ctx, input) => forged === "repeatValid"
    ? Effect.gen(function* () {
      yield* ctx.call(participant, command, input);
      return yield* ctx.call(participant, command, input);
    }) : ctx.call(participant, command, input));
  const revision = createHash("sha256").update(`forged-collection-membership-${forged}`).digest("hex");
  const contracts = new Map([catalog.collection.updatedEvent, catalog.product.updatedEvent].map(name =>
    [name, defineCommerceEventContract({ name, revision, internal: true, decode: policy.capture })] as const));
  const selected = { contracts: [...contracts.values()], select: (message: Json) => {
    const contract = isJsonObject(message) && typeof message.name === "string" ? contracts.get(message.name) : undefined;
    return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
  } };
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: `forged-collection-membership-${forged}` },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [command], validateLogical: policy.validateLogical, events: selected }],
    commands: [root], events: { producerRevision: revision, contracts: selected.contracts,
      subscribers: [{ id: "forged-collection-membership", revision: "a".repeat(64) }],
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

  it("runs native Collection membership changes over the pending logical Product graph", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const collection = await prepareCollectionCreationHost(catalog);
    const membership = await prepareCollectionMembershipHost(catalog);
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.retrieveCollection, product.runtime.commands.retrieve],
    }));
    try {
      await Effect.runPromise(collection.host.run(collection.host.newRequestKey(), collection.root, [
        { id: "pcol_members_target", title: "Target Collection" },
        { id: "pcol_members_other", title: "Other Collection" },
      ]));
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_members_move", title: "Move", collection_id: "pcol_members_other" },
        { id: "prod_members_remove", title: "Remove", collection_id: "pcol_members_target" },
        { id: "prod_members_keep", title: "Keep", collection_id: "pcol_members_target" },
      ] }));
      const input = { id: "pcol_members_target", add: ["prod_members_move"], remove: ["prod_members_remove"] };
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const key = membership.newRequestKey();
      const result = await Effect.runPromise(membership.run(key, input));
      if (result === null) throw new Error("Expected Collection membership result");
      expect(result).toMatchObject({ id: input.id,
        products: expect.arrayContaining([{ id: "prod_members_move" }, { id: "prod_members_keep" }]) });
      expect(result.products.map(row => row.id).sort()).toEqual(["prod_members_keep", "prod_members_move"]);
      const committed = await Effect.runPromise(read.read(product.runtime.commands.retrieveCollection, {
        id: input.id, config: { select: ["id", "products.id"], relations: ["products"] },
      }));
      if (!isJsonObject(committed) || !Array.isArray(committed.products)) throw new Error("Expected Collection members");
      expect(committed.id).toBe(input.id);
      expect(committed.products.map((row: unknown) => row !== null && typeof row === "object" && "id" in row &&
        typeof row.id === "string" ? row.id : null).sort())
        .toEqual(["prod_members_keep", "prod_members_move"]);
      expect(await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
        id: "prod_members_remove", config: { relations: ["collection"] },
      }))).toMatchObject({ id: "prod_members_remove", collection_id: null });
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const emitted = afterEvents.slice(beforeEvents.length);
      expect(emitted.filter(row => row.envelope.contract === catalog.collection.updatedEvent)).toHaveLength(1);
      expect(emitted.filter(row => row.envelope.contract === catalog.product.updatedEvent)).toHaveLength(3);
      expect(emitted).toHaveLength(4);
      expect(new Set(emitted.map(row => row.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(membership.run(key, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      expect(await Effect.runPromise(membership.run(membership.newRequestKey(), { id: input.id })))
        .toMatchObject({ id: input.id });
      expect(await Effect.runPromise(membership.run(membership.newRequestKey(), { id: "pcol_members_missing" })))
        .toBeNull();
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: "pcol_members_missing", add: ["prod_members_keep"],
      }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      for (const mode of ["collectionScalar", "productScalar", "foreignCollection", "foreignProduct", "repeatValid"] as const) {
        const forged = await prepareForgedCollectionMembershipHost(catalog, mode);
        try {
          await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, {
            id: input.id, data: { product_ids: ["prod_members_keep", "prod_members_move"] },
          }))).rejects.toMatchObject({ reason: "receiptMismatch" });
          expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
          expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
        } finally { await Effect.runPromise(forged.host.close); }
      }
      const seed = defineCommerceCommand("logicalCollectionUnrelatedSeed", "write", (ctx, value) =>
        Effect.gen(function* () {
          if (!Array.isArray(value) || !value.every(isJsonObject)) return yield* ctx.refuse(commerceError("invalidInput"));
          return yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "insert", value);
        }));
      const seedHost = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, commands: [seed] }));
      try {
        for (let start = 0; start < 260; start += 20) await Effect.runPromise(seedHost.run(seedHost.newRequestKey(), seed,
          Array.from({ length: 20 }, (_, index) => ({ id: `prod_collection_unrelated_${start + index}`,
            title: "Unrelated Product", handle: `collection-unrelated-${start + index}` }))));
      } finally { await Effect.runPromise(seedHost.close); }
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [{
        id: "prod_members_beyond", title: "Beyond Catalog", collection_id: "pcol_members_other",
      }] }));
      const beyond = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: input.id, add: ["prod_members_beyond"], remove: ["prod_members_keep"],
      }));
      if (beyond === null) throw new Error("Expected selected Collection");
      expect(beyond.products.map(row => row.id).sort()).toEqual(["prod_members_beyond", "prod_members_move"]);
      const duplicate = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: input.id, add: ["prod_members_move"],
      }));
      if (duplicate === null) throw new Error("Expected selected Collection");
      expect(duplicate.products.map(row => row.id).sort()).toEqual(["prod_members_beyond", "prod_members_move"]);
      const overlap = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: input.id, add: ["prod_members_move"], remove: ["prod_members_move"],
      }));
      if (overlap === null) throw new Error("Expected selected Collection");
      expect(overlap.products.map(row => row.id).sort()).toEqual(["prod_members_beyond", "prod_members_move"]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(collection.host.close);
      await Effect.runPromise(membership.close);
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

  it("refuses an oversized Collection membership without applying a partial native update", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const collection = await prepareCollectionCreationHost(catalog);
    const membership = await prepareCollectionMembershipHost(catalog);
    const seed = defineCommerceCommand("logicalCollectionOverflowSeed", "write", (ctx, input) =>
      Effect.gen(function* () {
        if (!Array.isArray(input) || !input.every(isJsonObject)) return yield* ctx.refuse(commerceError("invalidInput"));
        return yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "insert", input);
      }));
    const seedHost = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, commands: [seed] }));
    try {
      const collectionId = "pcol_members_overflow";
      await Effect.runPromise(collection.host.run(collection.host.newRequestKey(), collection.root,
        { id: collectionId, title: "Overflow Collection" }));
      for (let start = 0; start < 257; start += 20) await Effect.runPromise(seedHost.run(seedHost.newRequestKey(), seed,
        Array.from({ length: Math.min(20, 257 - start) }, (_, index) => ({
          id: `prod_collection_overflow_${start + index}`, title: "Overflow Product",
          handle: `collection-overflow-${start + index}`, collection_id: collectionId,
        }))));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const overflow = await Effect.runPromise(Effect.result(membership.run(membership.newRequestKey(), {
        id: collectionId, remove: ["prod_collection_overflow_0"],
      })));
      if (!Result.isFailure(overflow)) throw new Error("Expected bounded Collection refusal");
      expect(overflow.failure.reason).toBe("rollbackOnly");
      if (!Cause.isCause(overflow.failure.cause)) throw new Error("Missing bounded refusal cause");
      expect(overflow.failure.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error !== null && typeof reason.error === "object" && "reason" in reason.error &&
        reason.error.reason === "limitExceeded")).toBe(true);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(collection.host.close);
      await Effect.runPromise(membership.close);
      await Effect.runPromise(seedHost.close);
    }
  }, 120_000);
});
