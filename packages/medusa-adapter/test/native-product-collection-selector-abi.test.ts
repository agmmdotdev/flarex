import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import type { DAL, IEventBusModuleService, ModulePersistenceAdapter } from "@medusajs/framework/types";
import { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import { Product, ProductCollection, ProductVariant, ProductTag, ProductType, ProductOption, ProductOptionValue,
  ProductImage, ProductVariantProductImage } from "@medusajs/product/models";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable";
import { createDrizzleEventSubscriber, registerDrizzleEventSubscriber, dispatchDrizzleMutationEvent,
  dispatchDrizzleMutationRows } from "@medusajs/drizzle/mutation-events";
import { prepareCommerceInternalService } from "../src/module/persistence";
import { captureCommerceInput } from "../src/value/input";

const decodePairs = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: Schema.JsonObject })));
const decodeMessages = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const unavailable = (): never => { throw new Error("Unselected fixed native ABI operation"); };
const unused: DAL.RepositoryService = {
  getFreshManager: unavailable, getActiveManager: unavailable, transaction: async () => unavailable(),
  serialize: async <Output extends object | object[]>(value: Output) => structuredClone(value),
  find: async () => unavailable(), findAndCount: async () => unavailable(), create: async () => unavailable(),
  update: async () => unavailable(), delete: async () => unavailable(), softDelete: async () => unavailable(),
  restore: async () => unavailable(), upsert: async () => unavailable(), upsertWithReplace: async () => unavailable(),
};

/** Fixed DAL responses characterize genuine native service batching and event
 * aggregation. This port neither applies mutations nor proves persistence,
 * isolation, constraints or final membership; database tests own those claims. */
describe("native Collection selector membership ABI", () => {
  it("retains four-target order, scalar/metadata-first writes and repeated Product pairs with first-touch events", async () => {
    const order = ["collection-c", "collection-a", "collection-d", "collection-b"];
    const before = order.map((id, index) => ({ id, title: id, handle: id,
      metadata: { retained: index, removed: true, nested: { old: true } }, deleted_at: null }));
    const after = before.map((row, index) => ({ ...row, title: "Changed",
      metadata: { retained: index, nested: { next: true } } }));
    const desired = ["product-b", "missing", "product-a", "product-b"];
    const present = [
      { id: "product-a", collection_id: "collection-c", deleted_at: null },
      { id: "product-b", collection_id: "outside", deleted_at: null },
    ];
    const previous = order.map((collection_id, index) => ({ id: `prior-${index}`, collection_id, deleted_at: null }));
    const stages: string[] = [], collectionReads: unknown[] = [], productReads: unknown[] = [];
    let collectionPairs: ReturnType<typeof decodePairs> = [], productPairs: ReturnType<typeof decodePairs> = [];
    let messages: ReturnType<typeof decodeMessages> = [];
    const persistence: ModulePersistenceAdapter = {
      name: "native-fixed-collection-abi", prepareModels: models => models,
      createBaseRepository: unavailable, createRepository: unavailable, createConnectionLoader: unavailable,
      createEventSubscriber: createDrizzleEventSubscriber, registerEventSubscriber: registerDrizzleEventSubscriber,
      dispatchMutationEvent: dispatchDrizzleMutationEvent,
    };
    const collectionRepository: DAL.RepositoryService = { ...unused,
      async find(input) { stages.push("collection.read"); collectionReads.push(structuredClone(input)); return structuredClone(before); },
      async update(input, context = {}) {
        stages.push("collection.write"); collectionPairs = decodePairs(input);
        await dispatchDrizzleMutationRows("afterUpdate", "ProductCollection", after, context);
        return structuredClone(after);
      },
    };
    const productRepository: DAL.RepositoryService = { ...unused,
      async find(input) {
        stages.push("product.read"); const position = productReads.length; productReads.push(structuredClone(input));
        // Every selector finishes before the one Product update call. These
        // predetermined rows represent each native selector's initial view.
        return structuredClone(position % 2 === 0 ? [previous[Math.floor(position / 2)]] : present);
      },
      async update(input, context = {}) {
        stages.push("product.write"); productPairs = decodePairs(input);
        const fixedRows = order.flatMap((_id, index) => [previous[index], ...present]);
        for (const row of fixedRows) {
          if (row === undefined) throw new Error("Missing fixed native Product response");
          await dispatchDrizzleMutationRows("afterUpdate", "Product", [row], context);
        }
        return structuredClone(fixedRows);
      },
    };
    const eventBus: IEventBusModuleService = {
      // The native bus carries own undefined options. Use the same private
      // JSON capture boundary as the real module bus before decoding events.
      async emit(input) { stages.push("events"); messages = decodeMessages(Result.getOrThrow(captureCommerceInput(input))); },
      subscribe: unavailable, unsubscribe: unavailable, releaseGroupedEvents: async () => unavailable(), clearGroupedEvents: async () => unavailable(),
    };
    const category = new ProductCategoryService({ productCategoryRepository: { ...unused, find: async () => unavailable(),
      findAndCount: async () => unavailable() }, productModuleService: { interceptEntityMutationEvents: unavailable } });
    const bind = <Model extends Parameters<typeof prepareCommerceInternalService>[0]>(model: Model, repository = unused) =>
      prepareCommerceInternalService(model)(repository, persistence);
    const dependencies = { baseRepository: unused,
      productRepository: { ...productRepository, deepUpdate: async () => unavailable() },
      productService: bind(Product, productRepository), productCollectionService: bind(ProductCollection, collectionRepository),
      productVariantService: bind(ProductVariant), productTagService: bind(ProductTag), productTypeService: bind(ProductType),
      productOptionService: bind(ProductOption), productOptionValueService: bind(ProductOptionValue),
      productImageService: bind(ProductImage), productImageProductService: bind(Product),
      productVariantProductImageService: bind(ProductVariantProductImage), productCategoryService: category,
      [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence, [Modules.EVENT_BUS]: eventBus,
    };
    const service = new ProductModuleService(dependencies, { scope: "internal" });
    const result = await service.updateProductCollections({ id: [...order] }, { title: "Changed",
      metadata: { removed: "", nested: { next: true } }, product_ids: [...desired] }, { manager: {}, transactionManager: {} });
    expect(collectionReads).toHaveLength(2);
    expect(collectionPairs.map(pair => pair.entity.id)).toEqual(order);
    expect(collectionPairs.map(pair => pair.update)).toEqual(after.map(row => ({ id: row.id, title: "Changed", metadata: row.metadata })));
    expect(stages).toEqual(["collection.read", "collection.read", "collection.write", ...Array.from({ length: 8 }, () => "product.read"), "product.write", "events"]);
    expect(productReads).toEqual(order.flatMap(collection_id => [
      { where: { collection_id, id: { $nin: ["product-b", "missing", "product-a"] } }, options: { populate: [], fields: undefined,
        limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
      { where: { id: { $in: ["product-b", "missing", "product-a"] } }, options: { populate: [], fields: undefined,
        limit: undefined, offset: undefined, orderBy: { id: "ASC" } } },
    ]));
    expect(productPairs.map(pair => ({ id: pair.entity.id, update: pair.update }))).toEqual(order.flatMap((collection_id, index) => [
      { id: `prior-${index}`, update: { collection_id: null } },
      { id: "product-a", update: { collection_id } }, { id: "product-b", update: { collection_id } },
    ]));
    expect(result.map(row => ({ id: row.id, products: row.products }))).toEqual(order.map(id => ({ id, products: desired.map(id => ({ id })) })));
    expect(messages.map(message => ({ name: message.name, data: message.data }))).toEqual([
      ...order.map(id => ({ name: "product.product-collection.updated", data: { id } })),
      ...["prior-0", "product-a", "product-b", "prior-1", "prior-2", "prior-3"].map(id => ({ name: "product.product.updated", data: { id } })),
    ]);
  });
});
