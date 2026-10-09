import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Result, Schema } from "effect";
import { Modules, CommonEvents } from "@medusajs/framework/utils/portable";
import { createStep, createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { productCallReceipts } from "../src/product-local-events";
import { decodeCategoryProjection } from "../src/product-category-projection";
import { prepareProductCreateWorkflow } from "../src/product-create-workflow";
import { prepareProductCollectionMembershipWorkflow } from "../src/product-collection-workflow";
import { prepareProductCategoryMembershipWorkflow } from "../src/product-category-workflow";
import { prepareProductRelationshipsWorkflow, productRelationshipsWorkflow } from "../src/product-relationships-workflow";
import { ProductRelationshipsInput, ProductRelationshipsOutput } from "../src/product-relationship-workflow-input";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { defineWorkflowMethod, defineWorkflowModule, workflowMethodDefinition,
  workflowModuleDefinition } from "../src/workflow/module";
import { commerceDecoder } from "../src/commerce-decoder";
import { findCollectionMembershipProducts } from "../src/product-collection-membership";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { fxAppRowCurrent } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product test driver");
const cleanup: Array<() => Promise<void>> = [];
let currency: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;

async function committedCollection(id: string) {
  const host = await Effect.runPromise(makeCommerceHost({ ...product.hostInput, commands: [product.runtime.commands.retrieveCollection] }));
  try {
    const value = await Effect.runPromise(host.read(product.runtime.commands.retrieveCollection, {
      id, config: { select: ["id", "products.id"], relations: ["products"] },
    }));
    if (!isJsonObject(value) || !Array.isArray(value.products)) throw new Error("Missing committed Collection");
    return value.products.map(row => {
      if (!isJsonObject(row) || typeof row.id !== "string") throw new Error("Missing committed Product ID");
      return row.id;
    }).sort();
  } finally { await Effect.runPromise(host.close); }
}

async function prepareCreationHost() {
  const catalog = await Effect.runPromise(captureProductSchema("atomic-commerce")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
  const host = await Effect.runPromise(prepareProductCreateWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-create-workflow").digest("hex"),
    subscribers: [{ id: "logical-product-create", revision: "a".repeat(64) }],
  }));
  return { catalog, host };
}

async function prepareCollectionCreationHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  const policy = product.runtime.logicalPolicy;
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand("productCollectionCreateRoot", (ctx, input) =>
    ctx.call(participant, product.runtime.commands.createCollections, input));
  const revision = createHash("sha256").update("logical-product-collection-create").digest("hex");
  const contract = defineCommerceEventContract({ name: catalog.collection.createdEvent, revision,
    internal: true, decode: policy.capture });
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-collection-create" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [product.runtime.commands.createCollections], validateLogicalCall: policy.validateLogicalCall,
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
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-collection-membership").digest("hex"),
    subscribers: [{ id: "logical-product-collection-membership", revision: "a".repeat(64) }],
  }));
}

async function prepareCategoryCreationHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  const policy = product.runtime.logicalPolicy;
  const participant = defineAtomicCommerceParticipant("product");
  const root = defineAtomicCommerceCommand("productCategoryCreateRoot", (ctx, input) =>
    ctx.call(participant, product.runtime.commands.createCategories, input));
  const revision = createHash("sha256").update("logical-product-category-create").digest("hex");
  const created = defineCommerceEventContract({ name: catalog.category.createdEvent, revision,
    internal: true, decode: policy.capture });
  const updated = defineCommerceEventContract({ name: catalog.category.updatedEvent, revision,
    internal: true, decode: policy.capture });
  const contracts = [created, updated];
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
    identityAndAccessPolicy: { profile: "logical-product-category-create" },
    participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
      commands: [product.runtime.commands.createCategories], validateLogicalCall: policy.validateLogicalCall,
      events: { contracts, select: (message: Json) => isJsonObject(message) && message.name === catalog.category.updatedEvent
        ? Effect.succeed(updated) : Effect.succeed(created) } }],
    commands: [root], events: { producerRevision: revision, contracts,
      subscribers: [{ id: "logical-product-category-create", revision: "a".repeat(64) }],
      validate: events => events.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, root };
}

async function prepareCategoryMembershipHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  return Effect.runPromise(prepareProductCategoryMembershipWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-category-membership").digest("hex"),
    subscribers: [{ id: "logical-product-category-membership", revision: "a".repeat(64) }],
  }));
}

async function prepareRelationshipsHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  return Effect.runPromise(prepareProductRelationshipsWorkflow({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-relationships").digest("hex"),
    subscribers: [{ id: "logical-product-relationships", revision: "a".repeat(64) }],
  }));
}

async function prepareDefaultBudgetRelationshipsHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"]) {
  const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: product.runtime.workflow,
    methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true,
  } }, true));
  return Effect.runPromise(prepareAtomicWorkflowHost({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update("logical-product-relationships-default-budget").digest("hex"),
    subscribers: [{ id: "logical-product-relationships", revision: "a".repeat(64) }],
    workflow: { name: "productRelationships", resources, prepared: Result.getOrThrow(productRelationshipsWorkflow.prepare()),
      input: ProductRelationshipsInput, output: ProductRelationshipsOutput, events: internalModuleWorkflowEvents },
  }));
}

async function prepareRelationshipScenario(prefix: string) {
  const { catalog, host: create } = await prepareCreationHost();
  const collection = await prepareCollectionCreationHost(catalog);
  const category = await prepareCategoryCreationHost(catalog);
  const relationships = await prepareRelationshipsHost(catalog);
  await Effect.runPromise(collection.host.run(collection.host.newRequestKey(), collection.root, [
    { id: `${prefix}-target`, title: `${prefix} Target Collection` },
    { id: `${prefix}-other`, title: `${prefix} Other Collection` },
  ]));
  await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
    { id: `${prefix}-category`, name: `${prefix} Target Category` }));
  await Effect.runPromise(create.run(create.newRequestKey(), { products: [
    { id: `${prefix}-add`, title: `${prefix} Add Product`, collection_id: `${prefix}-other` },
    { id: `${prefix}-remove`, title: `${prefix} Remove Product`, collection_id: `${prefix}-target`,
      category_ids: [`${prefix}-category`] },
    { id: `${prefix}-keep`, title: `${prefix} Keep Product`, collection_id: `${prefix}-target` },
  ] }));
  const input = { collection: { id: `${prefix}-target`, add: [`${prefix}-add`], remove: [`${prefix}-remove`] },
    category: { id: `${prefix}-category`, add: [`${prefix}-add`], remove: [`${prefix}-remove`] } };
  const close = async () => {
    await Effect.runPromise(create.close);
    await Effect.runPromise(collection.host.close);
    await Effect.runPromise(category.host.close);
    await Effect.runPromise(relationships.close);
  };
  return { catalog, create, collection, category, relationships, input, close };
}

async function prepareObservedRelationshipsHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"],
  mode: "lateFailure" | "invalidOutput" | "pause", onObserve?: () => Promise<void>) {
  const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: product.runtime.workflow,
    methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true,
  } }, true));
  const definition = createWorkflow(`observed-logical-relationships-${mode}`,
    (input: WorkflowData<typeof ProductRelationshipsInput.Type>) => {
      const related = productRelationshipsWorkflow.runAsStep({ input });
      const observe = createStep(`after-logical-relationships-${mode}`, resources.callback(async (value: unknown) => {
        if (mode === "lateFailure") throw new Error("Late relationship observer failure");
        if (mode === "pause") await onObserve?.();
        return value;
      }));
      return new WorkflowResponse(observe(related));
    });
  return Effect.runPromise(prepareAtomicWorkflowHost({
    execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition, requestCallLimit: 128 }) },
    modules: { product: { module: product.runtime.workflow, logicalStorage: product.hostInput.logicalStorage } },
    revision: createHash("sha256").update(`logical-relationships-${mode}`).digest("hex"),
    subscribers: [{ id: "logical-product-relationships", revision: "a".repeat(64) }],
    workflow: { name: `observedRelationships${mode}`, resources,
      prepared: Result.getOrThrow(definition.prepare()), input: ProductRelationshipsInput,
      output: mode === "invalidOutput" ? Schema.Null : ProductRelationshipsOutput,
      events: internalModuleWorkflowEvents },
  }));
}

async function prepareForgedCollectionMembershipHost(catalog: Awaited<ReturnType<typeof prepareCreationHost>>["catalog"],
  forged: "collectionScalar" | "productScalar" | "foreignCollection" | "foreignProduct" | "repeatValid" | "omission") {
  const policy = product.runtime.logicalPolicy;
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
  const root = defineAtomicCommerceCommand("forgedCollectionMembership", (ctx, input) => Effect.gen(function* () {
    yield* ctx.call(participant, product.runtime.commands.retrieveCollection, {
      id: "pcol_members_target", config: { select: ["id", "products.id"], relations: ["products"] },
    });
    if (forged === "repeatValid") yield* ctx.call(participant, command, input);
    return yield* ctx.call(participant, command, input);
  }));
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
      commands: [product.runtime.commands.retrieveCollection, command], validateLogicalCall: policy.validateLogicalCall, events: selected }],
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
      if (result.kind !== "replacementRequested") throw new Error("Expected requested Collection replacement");
      expect(result).toMatchObject({ id: input.id,
        kind: "replacementRequested", requestedProductIds: expect.arrayContaining(["prod_members_move", "prod_members_keep"]) });
      expect(result.requestedProductIds.toSorted()).toEqual(["prod_members_keep", "prod_members_move"]);
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
        .toEqual({ kind: "skipped", id: "pcol_members_missing" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: "pcol_members_missing", add: ["prod_members_keep"],
      }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      for (const mode of ["collectionScalar", "productScalar", "foreignCollection", "foreignProduct", "repeatValid", "omission"] as const) {
        const forged = await prepareForgedCollectionMembershipHost(catalog, mode);
        try {
          await expect(Effect.runPromise(forged.host.run(forged.host.newRequestKey(), forged.root, {
            id: input.id, data: { product_ids: ["prod_members_keep", "prod_members_move"] },
          }))).rejects.toMatchObject({ reason: "invalidAuthority" });
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
      if (beyond.kind !== "replacementRequested") throw new Error("Expected requested Collection replacement");
      expect(beyond.requestedProductIds.toSorted()).toEqual(["prod_members_beyond", "prod_members_move"]);
      const duplicate = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: input.id, add: ["prod_members_move"],
      }));
      if (duplicate.kind !== "replacementRequested") throw new Error("Expected requested Collection replacement");
      expect(duplicate.requestedProductIds.toSorted()).toEqual(["prod_members_beyond", "prod_members_move"]);
      const overlap = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: input.id, add: ["prod_members_move"], remove: ["prod_members_move"],
      }));
      if (overlap.kind !== "replacementRequested") throw new Error("Expected requested Collection replacement");
      expect(overlap.requestedProductIds.toSorted()).toEqual(["prod_members_beyond", "prod_members_move"]);
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

  it("creates a native Category with requested Products and authenticates sibling maintenance", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const category = await prepareCategoryCreationHost(catalog);
    const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
      commands: [product.runtime.commands.countCategories],
    }));
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_category_create_a", title: "Category Product A" },
        { id: "prod_category_create_b", title: "Category Product B" },
      ] }));
      await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "pcat_create_first", name: "First", products: [{ id: "prod_category_create_a" }] }));
      const key = category.host.newRequestKey();
      const input = { id: "pcat_create_second", name: "Second", rank: 0,
        products: [{ id: "prod_category_create_b" }] };
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const result = await Effect.runPromise(category.host.run(key, category.root, input));
      expect(result).toMatchObject({ id: input.id, rank: 0 });
      const selected = await Effect.runPromise(read.read(product.runtime.commands.countCategories, {
        filters: { id: ["pcat_create_first", "pcat_create_second"] },
        config: { relations: ["products"], select: ["id", "rank", "products.title"] },
      }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
      expect(selected).toMatchObject([[
        { id: "pcat_create_first", rank: 1, products: [{ id: "prod_category_create_a", title: "Category Product A" }] },
        { id: "pcat_create_second", rank: 0, products: [{ id: "prod_category_create_b", title: "Category Product B" }] },
      ], 2]);
      const afterRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.category.updatedEvent, catalog.category.createdEvent]);
      expect(await Effect.runPromise(category.host.run(key, category.root, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      await expect(Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "pcat_create_missing_product", name: "Missing Product", products: [{ id: "missing" }] })))
        .rejects.toMatchObject({ reason: "invalidInput" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(category.host.close);
      await Effect.runPromise(read.close);
    }
  }, 120_000);

  it("refuses a public Category receipt with an unrequested Product pivot", async () => {
    const catalog = await Effect.runPromise(captureProductSchema("category-pivot-receipt")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productCallReceipts(catalog);
    const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
    if (relation?.join.type !== "manyToMany") throw new Error("Missing Category Product pivot");
    const [categoryColumn] = relation.join.sourceColumns;
    const [productColumn] = relation.join.targetColumns;
    if (categoryColumn === undefined || productColumn === undefined) throw new Error("Invalid Category Product pivot");
    const id = "pcat_pivot_receipt";
    const created = { name: catalog.category.createdEvent,
      metadata: { source: Modules.PRODUCT, object: catalog.category.eventObject, action: CommonEvents.CREATED },
      data: { id } };
    const call = { commandName: "productCreatecategory", mode: "write" as const,
      input: { id, name: "Receipt", products: [{ id: "requested" }] },
      result: { id, rank: 0 }, events: [created], fromAttempt: 0, toAttempt: 3,
      fromLifecycle: 0, toLifecycle: 0 };
    const mutations = [
      { ordinal: 0, table: catalog.category.table.name, operation: "insert" as const, before: null,
        after: { id, name: "Receipt", rank: 0, parent_category_id: null, mpath: id, deleted_at: null } },
      { ordinal: 1, table: relation.join.pivotTable, operation: "insert" as const, before: null,
        after: { [categoryColumn]: id, [productColumn]: "requested" } },
      { ordinal: 2, table: relation.join.pivotTable, operation: "insert" as const, before: null,
        after: { [categoryColumn]: id, [productColumn]: "unrequested" } },
    ];
    await expect(Effect.runPromise(policy.validateLogicalCall(call, { mutations: mutations, lifecycle: [], observedRows: [], setNull: [], referenceReplacements: [] })))
      .rejects.toMatchObject({ reason: "receiptMismatch" });
  });

  it("keeps native batch Category results and Product memberships in input order", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const category = await prepareCategoryCreationHost(catalog);
    try {
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_category_batch_a", title: "Batch A" },
        { id: "prod_category_batch_b", title: "Batch B" },
      ] }));
      const input = [
        { id: "pcat_batch_b", name: "Batch B", products: [{ id: "prod_category_batch_b" }] },
        { id: "pcat_batch_a", name: "Batch A", products: [{ id: "prod_category_batch_a" }] },
      ];
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const result = await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root, input));
      expect(result).toMatchObject([{ id: "pcat_batch_b" }, { id: "pcat_batch_a" }]);
      const events = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(events.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.category.createdEvent]);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(category.host.close);
    }
  }, 120_000);

  it("runs native Category membership over logical Product rows and pivots", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const category = await prepareCategoryCreationHost(catalog);
    const membership = await prepareCategoryMembershipHost(catalog);
    try {
      await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "pcat_logical_members", name: "Logical Members" }));
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_category_remove", title: "Remove Category", category_ids: ["pcat_logical_members"] },
        { id: "prod_category_add", title: "Add Category" },
      ] }));
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const input = { id: "pcat_logical_members", add: ["prod_category_add"], remove: ["prod_category_remove"] };
      const key = membership.newRequestKey();
      const result = await Effect.runPromise(membership.run(key, input));
      expect(result).toEqual([
        { id: "prod_category_add", categories: [{ id: "pcat_logical_members" }] },
        { id: "prod_category_remove", categories: [] },
      ]);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.updatedEvent, catalog.product.updatedEvent]);
      expect(await Effect.runPromise(membership.run(key, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
      const overlap = await Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: "pcat_logical_members", add: ["prod_category_add"], remove: ["prod_category_add"],
      }));
      expect(overlap).toEqual([{ id: "prod_category_add", categories: [] }]);
      expect(await Effect.runPromise(membership.run(membership.newRequestKey(),
        { id: "pcat_logical_members" }))).toEqual([]);
      expect(await Effect.runPromise(membership.run(membership.newRequestKey(),
        { id: "pcat_logical_members", add: ["prod_category_missing"] }))).toEqual([]);
      const beforeInvalidRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeInvalidEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      await expect(Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: "pcat_logical_members", add: Array(130).fill("prod_category_add"),
        remove: Array(130).fill("prod_category_add"),
      }))).rejects.toMatchObject({ reason: "invalidInput" });
      await expect(Effect.runPromise(membership.run(membership.newRequestKey(), {
        id: "pcat_category_missing", add: ["prod_category_add"],
      }))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeInvalidRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeInvalidEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(category.host.close);
      await Effect.runPromise(membership.close);
    }
  }, 120_000);

  it("rejects Category membership receipts with omitted links, unrelated scalars or pivot rows", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const category = await prepareCategoryCreationHost(catalog);
    try {
      await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "pcat_category_forged", name: "Forged Category Target" }));
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_category_forged", title: "Original Title" },
        { id: "prod_category_stale", title: "Stale Category", category_ids: ["pcat_category_forged"] },
      ] }));
      const relation = catalog.queryRelations.get(catalog.product.table.name)?.get("categories");
      if (relation?.join.type !== "manyToMany") throw new Error("Missing Category pivot");
      const pivotTable = relation.join.pivotTable;
      const productColumn = relation.join.sourceColumns[0], categoryColumn = relation.join.targetColumns[0];
      if (productColumn === undefined || categoryColumn === undefined) throw new Error("Invalid Category pivot");
      for (const mode of ["scalar", "pivot", "omission", "stalePivot", "rootless"] as const) {
        const policy = product.runtime.logicalPolicy;
        const participant = defineAtomicCommerceParticipant("product");
        const id = mode === "stalePivot" ? "prod_category_stale" : "prod_category_forged";
        const command = defineCommerceCommand("productUpsert", "write", Effect.fn("ProductTest.forgedCategoryMembership")(
          function* (ctx) {
            if (mode !== "rootless") yield* (yield* ctx.table(catalog.product.table.name)).write(ctx.manager, "update", [{
              id, ...(mode === "scalar" ? { title: "Forged Title" } : { updated_at: new Date().toISOString() }),
            }]);
            if (mode === "pivot") yield* (yield* ctx.table(pivotTable)).write(ctx.manager, "insert", [{
              [productColumn]: id, [categoryColumn]: "pcat_category_forged",
            }]);
            if (mode !== "rootless") yield* ctx.captureLocalEvent({ name: catalog.product.updatedEvent,
              metadata: { source: Modules.PRODUCT, object: catalog.product.eventObject, action: CommonEvents.UPDATED },
              data: { id } });
            return [{ id }];
          }));
        const root = defineAtomicCommerceCommand(`forgedCategoryMembership${mode}`, (ctx, input) =>
          Effect.gen(function* () {
            yield* ctx.call(participant, product.runtime.commands.list, {
              filters: { id: [id] }, config: { select: ["id"], relations: ["categories"], take: 256 },
            });
            return yield* ctx.call(participant, command, input);
          }));
        const revision = createHash("sha256").update(`forged-category-membership-${mode}`).digest("hex");
        const contract = defineCommerceEventContract({ name: catalog.product.updatedEvent, revision,
          internal: true, decode: policy.capture });
        const host = await Effect.runPromise(makeAtomicCommerceHost({ ...currency.hostInput,
          identityAndAccessPolicy: { profile: `forged-category-membership-${mode}` },
          participants: [{ participant, logicalStorage: product.hostInput.logicalStorage,
            commands: [product.runtime.commands.list, command], validateLogicalCall: policy.validateLogicalCall,
            events: { contracts: [contract], select: () => Effect.succeed(contract) } }],
          commands: [root], events: { producerRevision: revision, contracts: [contract],
            subscribers: [{ id: "forged-category-membership", revision: "a".repeat(64) }],
            validate: events => events.some(event => !event.internal)
              ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
        }));
        try {
          const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
          const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
          await expect(Effect.runPromise(host.run(host.newRequestKey(), root,
            [{ id, category_ids: mode === "omission" ? ["pcat_category_forged"] : [] }])))
            .rejects.toMatchObject({ reason: "invalidAuthority" });
          expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
          expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
        } finally { await Effect.runPromise(host.close); }
      }
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(category.host.close);
    }
  }, 120_000);

  it("settles native Collection and Category children with one pending logical relationship result", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const collection = await prepareCollectionCreationHost(catalog);
    const category = await prepareCategoryCreationHost(catalog);
    const ordinary = await prepareDefaultBudgetRelationshipsHost(catalog);
    const relationships = await prepareRelationshipsHost(catalog);
    try {
      await Effect.runPromise(collection.host.run(collection.host.newRequestKey(), collection.root, [
        { id: "pcol_combined_target", title: "Combined Target" },
        { id: "pcol_combined_other", title: "Combined Other" },
      ]));
      await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "pcat_combined_target", name: "Combined Target" }));
      await Effect.runPromise(create.run(create.newRequestKey(), { products: [
        { id: "prod_combined_add", title: "Combined Add", collection_id: "pcol_combined_other" },
        { id: "prod_combined_remove", title: "Combined Remove", collection_id: "pcol_combined_target",
          category_ids: ["pcat_combined_target"] },
        { id: "prod_combined_keep", title: "Combined Keep", collection_id: "pcol_combined_target" },
      ] }));
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const input = { collection: { id: "pcol_combined_target", add: ["prod_combined_add"],
        remove: ["prod_combined_remove"] },
      category: { id: "pcat_combined_target", add: ["prod_combined_add"], remove: ["prod_combined_remove"] } };
      const ordinaryExit = await Effect.runPromise(Effect.result(ordinary.run(ordinary.newRequestKey(), input)));
      if (!Result.isFailure(ordinaryExit)) throw new Error("Expected default composed-workflow limit");
      expect(ordinaryExit.failure.reason).toBe("rollbackOnly");
      if (!Cause.isCause(ordinaryExit.failure.cause)) throw new Error("Missing bounded refusal cause");
      expect(ordinaryExit.failure.cause.reasons.some(reason => Cause.isFailReason(reason) &&
        reason.error !== null && typeof reason.error === "object" && "reason" in reason.error &&
        reason.error.reason === "limitExceeded")).toBe(true);
      const key = relationships.newRequestKey();
      const result = await Effect.runPromise(relationships.run(key, input));
      expect(result.productsAfterCategory).toMatchObject([
        { id: "prod_combined_add",
          categories: [{ id: "pcat_combined_target" }] },
        { id: "prod_combined_remove", categories: [] },
      ]);
      expect(result.collection.kind === "replacementRequested" ? result.collection.requestedProductIds.toSorted() : [])
        .toEqual(["prod_combined_add", "prod_combined_keep"]);
      expect(await committedCollection(input.collection.id)).toEqual(["prod_combined_add", "prod_combined_keep"]);
      const afterEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(afterEvents.slice(beforeEvents.length).map(row => row.envelope.contract).sort()).toEqual([
        catalog.collection.updatedEvent, ...Array(5).fill(catalog.product.updatedEvent),
      ].sort());
      expect(new Set(afterEvents.slice(beforeEvents.length).map(row => row.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(relationships.run(key, input))).toEqual(result);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(afterEvents);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(collection.host.close);
      await Effect.runPromise(category.host.close);
      await Effect.runPromise(ordinary.close);
      await Effect.runPromise(relationships.close);
    }
  }, 120_000);

  it("keeps the distinct native overlap rules, no-ops and missing Product selection", async () => {
    const scenario = await prepareRelationshipScenario("rel_overlap");
    try {
      const overlap = await Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), {
        collection: { id: "rel_overlap-target", add: ["rel_overlap-remove"], remove: ["rel_overlap-remove"] },
        category: { id: "rel_overlap-category", add: ["rel_overlap-remove"], remove: ["rel_overlap-remove"] },
      }));
      expect(overlap.productsAfterCategory).toEqual([{ id: "rel_overlap-remove", categories: [] }]);
      expect(overlap.collection.kind === "replacementRequested" ? overlap.collection.requestedProductIds.toSorted() : [])
        .toEqual(["rel_overlap-keep", "rel_overlap-remove"]);
      const beforeNoOpEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(await Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), {
        collection: { id: "missing-collection" }, category: { id: "missing-category" },
      }))).toEqual({ productsAfterCategory: [], collection: { kind: "skipped", id: "missing-collection" } });
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeNoOpEvents);
      const missing = await Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), {
        collection: { id: "rel_overlap-target", add: ["missing-product"] },
        category: { id: "rel_overlap-category", add: ["missing-product"] },
      }));
      expect(missing.productsAfterCategory).toEqual([]);
      expect(missing.collection.kind === "replacementRequested" ? missing.collection.requestedProductIds.toSorted() : [])
        .toEqual(["missing-product", "rel_overlap-keep", "rel_overlap-remove"]);
      expect(await committedCollection("rel_overlap-target")).toEqual(["rel_overlap-keep", "rel_overlap-remove"]);
    } finally { await scenario.close(); }
  }, 120_000);

  it("rolls back both native children when the later Category or earlier Collection target is missing", async () => {
    const scenario = await prepareRelationshipScenario("rel_rollback");
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      for (const input of [
        { ...scenario.input, category: { id: "missing-category", add: ["rel_rollback-add"] } },
        { ...scenario.input, collection: { id: "missing-collection", add: ["rel_rollback-add"] } },
      ]) {
        await expect(Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), input)))
          .rejects.toMatchObject({ reason: "rollbackOnly" });
        expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
      }
    } finally { await scenario.close(); }
  }, 120_000);

  it("refuses an oversized composed relationship selection before either child executes", async () => {
    const scenario = await prepareRelationshipScenario("rel_bound");
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      for (const input of [
        { ...scenario.input, category: { id: "rel_bound-category",
          add: Array(130).fill("rel_bound-add"), remove: Array(130).fill("rel_bound-remove") } },
        { collection: { id: "rel_bound-target", add: Array.from({ length: 256 }, (_, i) => `selected_${i}`) },
          category: { id: "rel_bound-category", add: ["rel_bound-add"] } },
      ]) {
        await expect(Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), input)))
          .rejects.toMatchObject({ reason: "invalidInput" });
      }
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally { await scenario.close(); }
  }, 120_000);

  it("reads every selected Product beyond the default page in the composed workflow", async () => {
    const { catalog, host: create } = await prepareCreationHost();
    const category = await prepareCategoryCreationHost(catalog);
    const relationships = await prepareRelationshipsHost(catalog);
    const ids = Array.from({ length: 16 }, (_, index) => `rel_page_${index.toString().padStart(2, "0")}`);
    try {
      await Effect.runPromise(category.host.run(category.host.newRequestKey(), category.root,
        { id: "rel_page_category", name: "Relationship Page Category" }));
      for (let offset = 0; offset < ids.length; offset += 4)
        await Effect.runPromise(create.run(create.newRequestKey(), {
          products: ids.slice(offset, offset + 4).map(id => ({ id, title: id })),
        }));
      const result = await Effect.runPromise(relationships.run(relationships.newRequestKey(), {
        collection: { id: "absent-page-collection" }, category: { id: "rel_page_category", add: ids },
      }));
      expect(result.productsAfterCategory.map(row => row.id).sort()).toEqual(ids);
      expect(result.productsAfterCategory.every(row => row.categories.length === 1 &&
        row.categories[0]?.id === "rel_page_category")).toBe(true);
    } finally {
      await Effect.runPromise(create.close);
      await Effect.runPromise(category.host.close);
      await Effect.runPromise(relationships.close);
    }
  }, 120_000);

  it("rejects malformed relationship inputs before publishing", async () => {
    const scenario = await prepareRelationshipScenario("rel_invalid");
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      for (const input of [null, { ...scenario.input, scopeId: "foreign" },
        { ...scenario.input, collection: { id: "rel_invalid-target", add: [12] } }]) {
        await expect(Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(),
          // @ts-expect-error malformed external input exercises runtime decoding
          input))).rejects.toMatchObject({ reason: "invalidInput" });
      }
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally { await scenario.close(); }
  }, 120_000);

  it("rolls back both logical children after a late parent failure or invalid output", async () => {
    const scenario = await prepareRelationshipScenario("rel_late");
    const late = await prepareObservedRelationshipsHost(scenario.catalog, "lateFailure");
    const invalid = await prepareObservedRelationshipsHost(scenario.catalog, "invalidOutput");
    try {
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      await expect(Effect.runPromise(late.run(late.newRequestKey(), scenario.input))).rejects.toBeDefined();
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
      await expect(Effect.runPromise(invalid.run(invalid.newRequestKey(), scenario.input)))
        .rejects.toMatchObject({ reason: "storedCorruption" });
      expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
    } finally {
      await Effect.runPromise(late.close);
      await Effect.runPromise(invalid.close);
      await scenario.close();
    }
  }, 120_000);

  it("binds relation-only method events into replay identity", async () => {
    const scenario = await prepareRelationshipScenario("rel_identity");
    try {
      const key = scenario.relationships.newRequestKey();
      await Effect.runPromise(scenario.relationships.run(key, scenario.input));
      const beforeRows = await currency.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      const original = workflowMethodDefinition(product.runtime.workflow.methods.updateProductCollections);
      const source = workflowModuleDefinition(product.runtime.workflow);
      const upsert = workflowMethodDefinition(product.runtime.workflow.methods.upsertProducts);
      if (original === undefined || source?.logical === undefined || upsert === undefined)
        throw new Error("Missing Product workflow method contract");
      expect(Result.isFailure(upsert.input([[{ id: "rel_identity-add", title: "Not admitted" }]]))).toBe(true);
      const narrowed = Result.getOrThrow(defineWorkflowMethod({ command: original.command,
        arguments: commerceDecoder(Schema.Array(Schema.Json), "invalidInput"),
        encode: value => Result.getOrThrow(original.input(value)), output: original.output,
        moduleEvents: [...original.moduleEvents, scenario.catalog.collection.createdEvent],
      }));
      const replacement = Result.getOrThrow(defineWorkflowModule({ name: "product", source: source.source,
        methods: { ...product.runtime.workflow.methods, updateProductCollections: narrowed }, graph: source.graph, logical: source.logical }));
      const resources = Result.getOrThrow(prepareWorkflowResources({ product: { module: replacement,
        methods: ["listProducts", "retrieveProductCollection", "upsertProducts", "updateProductCollections"], graph: true,
      } }, true));
      const changed = await Effect.runPromise(prepareAtomicWorkflowHost({
        execution: { identityAndAccessPolicy: currency.hostInput.identityAndAccessPolicy,
          prepare: composition => makeAtomicCommerceHost({ ...currency.hostInput, ...composition, requestCallLimit: 128 }) },
        modules: { product: { module: replacement, logicalStorage: product.hostInput.logicalStorage } },
        revision: createHash("sha256").update("logical-product-relationships").digest("hex"),
        subscribers: [{ id: "logical-product-relationships", revision: "a".repeat(64) }],
        workflow: { name: "productRelationships", resources, prepared: Result.getOrThrow(productRelationshipsWorkflow.prepare()),
          input: ProductRelationshipsInput, output: ProductRelationshipsOutput, events: internalModuleWorkflowEvents },
      }));
      try {
        await expect(Effect.runPromise(changed.run(key, scenario.input)))
          .rejects.toMatchObject({ reason: "requestConflict" });
        expect(await currency.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await currency.persistence.drizzle.select().from(fxSystemCommitEvents)).toEqual(beforeEvents);
      } finally { await Effect.runPromise(changed.close); }
    } finally { await scenario.close(); }
  }, 120_000);

  it.skipIf(driver !== "postgres")("retries a stale composed relationship update without losing either membership", async () => {
    const scenario = await prepareRelationshipScenario("rel_competing");
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const first = await prepareObservedRelationshipsHost(scenario.catalog, "pause", async () => {
      reached();
      await waiting;
    });
    const firstInput = { collection: { id: "rel_competing-target", add: ["rel_competing-add"] },
      category: { id: "rel_competing-category", add: ["rel_competing-add"] } };
    const secondInput = { collection: { id: "rel_competing-target", add: ["rel_competing-remove"] },
      category: { id: "rel_competing-category", add: ["rel_competing-keep"] } };
    const beforeEvents = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
    const firstKey = first.newRequestKey();
    const firstRun = Effect.runPromise(first.run(firstKey, firstInput));
    let secondRun: Promise<unknown> | undefined;
    try {
      try {
        await Promise.race([entered, firstRun]);
        secondRun = Effect.runPromise(scenario.relationships.run(scenario.relationships.newRequestKey(), secondInput));
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([secondRun, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Competing logical workflow did not finish")), 8_000);
          })]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
      } finally { release(); }
      await expect(firstRun).rejects.toMatchObject({ reason: "writeConflict" });
      const afterConflict = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(new Set(afterConflict.slice(beforeEvents.length).map(row => row.commitSeq)).size).toBe(1);
      await Effect.runPromise(first.run(firstKey, firstInput));
      const afterRetry = await currency.persistence.drizzle.select().from(fxSystemCommitEvents);
      expect(new Set(afterRetry.slice(beforeEvents.length).map(row => row.commitSeq)).size).toBe(2);
      const read = await Effect.runPromise(makeCommerceHost({ ...product.hostInput,
        commands: [product.runtime.commands.retrieveCollection, product.runtime.commands.retrieve],
      }));
      try {
        const collection = await Effect.runPromise(read.read(product.runtime.commands.retrieveCollection, {
          id: "rel_competing-target", config: { select: ["id", "products.id"], relations: ["products"] },
        }));
        expect(collection).toMatchObject({ products: expect.arrayContaining([
          expect.objectContaining({ id: "rel_competing-add" }),
          expect.objectContaining({ id: "rel_competing-keep" }),
          expect.objectContaining({ id: "rel_competing-remove" }),
        ]) });
        for (const id of ["rel_competing-add", "rel_competing-keep", "rel_competing-remove"]) {
          const row = await Effect.runPromise(read.read(product.runtime.commands.retrieve, {
            id, config: { select: ["id", "categories.id"], relations: ["categories"] },
          }));
          expect(row).toMatchObject({ categories: expect.arrayContaining([
            expect.objectContaining({ id: "rel_competing-category" }),
          ]) });
        }
      } finally { await Effect.runPromise(read.close); }
    } finally {
      release();
      await Promise.allSettled([firstRun, ...(secondRun === undefined ? [] : [secondRun])]);
      await Effect.runPromise(first.close);
      await scenario.close();
    }
  }, 120_000);
});
