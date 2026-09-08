import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { Product, ProductCategory, ProductCollection, ProductImage, ProductOption, ProductOptionValue, ProductTag, ProductType, ProductVariant, ProductVariantProductImage } from "@medusajs/product/models";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable";
import type { DAL, FindConfig, ProductTypes, IEventBusModuleService } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductRead, decodeProductTypeRead, decodeProductFindConfig, decodeProductCreateInput, productReadFilters } from "./product-service-input";
import { decodeLocalEventOptions, decodeLocalEventBatch } from "./product-local-events";
import { captureCommerceInput } from "./commerce-input";
import { withCommerceService } from "./commerce-service-bridge";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureProductSchema } from "./product-schema";
import { productRepository } from "./product-repository";
import { validateProductCreate } from "./product-graph";
import { decodeRelatedUpdate } from "./product-value-profile";
import { decodeProductLifecycleIds } from "./product-lifecycle";

function compose(ctx: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata) {
  const { repository, persistence, refuse, relatedRepository, captureLocalEvent, rejectLocalEvent } = productRepository(ctx, owner, metadata);
  const blocked = { ...repository, find: refuse, findAndCount: refuse, create: refuse, delete: refuse, softDelete: refuse, restore: refuse };
  const internal = <Model extends { readonly name: string }>(model: Model, selected: DAL.RepositoryService = blocked) => new (MedusaInternalService(model))<object, Model>({
    [lowerCaseFirst(model.name) + "Repository"]: selected, [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence,
  });
  const eventBus: IEventBusModuleService = {
    emit: (input, options) => owner.run(Effect.gen(function* () {
      const settings = yield* Effect.fromResult(captureCommerceInput(options));
      yield* Effect.fromResult(decodeLocalEventOptions(settings));
      const messages = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
      for (const message of yield* Effect.fromResult(decodeLocalEventBatch(messages))) yield* captureLocalEvent(message);
    }).pipe(Effect.catchTag("CommerceTransactionError", rejectLocalEvent))),
    subscribe: () => owner.reject(commerceError("unsupportedProfile")),
    unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
    releaseGroupedEvents: refuse, clearGroupedEvents: refuse,
  };
  const service = new ProductModuleService({
    // SAFETY: the pinned constructor type still requires the MikroORM-only
    // method. Its runtime hasDeepUpdate guard deliberately selects the portable
    // internal-service branch when that property is absent.
    baseRepository: repository, productRepository: repository as ConstructorParameters<typeof ProductModuleService>[0]["productRepository"],
    productService: internal(Product, repository),
    productVariantService: internal(ProductVariant, relatedRepository(metadata.variant)),
    productOptionService: internal(ProductOption, relatedRepository(metadata.option)),
    productOptionValueService: internal(ProductOptionValue, relatedRepository(metadata.value)),
    productImageService: internal(ProductImage, relatedRepository(metadata.image)),
    productCategoryService: internal(ProductCategory, relatedRepository(metadata.category)),
    productCollectionService: internal(ProductCollection, relatedRepository(metadata.collection)),
    productTagService: internal(ProductTag, relatedRepository(metadata.tag)), productTypeService: internal(ProductType, relatedRepository(metadata.type)),
    productImageProductService: internal(ProductImage),
    productVariantProductImageService: internal(ProductVariantProductImage, relatedRepository(metadata.assignment)),
    [Modules.EVENT_BUS]: eventBus,
  }, { scope: "internal" });
  return { service, repository, eventBus, context: { manager: ctx.manager, transactionManager: ctx.manager } };
}

/** Private command set. No request may select local policy, a manager or a table. */
export const makeLocalProductCommands = Effect.fn("ProductAdapter.commands")(function* () {
  const captured = yield* captureProductSchema("product-runtime-contract");
  const metadata = yield* productRuntimeMetadata(captured.metadata.frame);
  const withService = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner, metadata), work);
  const create = defineCommerceCommand("productCreate", "write", Effect.fn("ProductAdapter.create")(function* (ctx, input) {
    yield* validateProductCreate(metadata, input).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    // SAFETY: the external graph is checked before the unchanged service, then its
    // normalized values are checked against DML columns by the DAL and core.
    const decoded = yield* Effect.fromResult(decodeProductCreateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, ({ service, context }) => Array.isArray(decoded)
      ? service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO[], context)
      : service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO, context));
  }));
  const read = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("product" + kind, "read", Effect.fn("ProductAdapter." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const filtersInput = yield* Effect.fromResult(productReadFilters(decoded)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone({ ...decoded, filters: filtersInput });
    // SAFETY: the selected DAL decoder validates all filters, projections,
    // pagination and relations after Medusa builds its query and before SQL.
    const find = copied.config as FindConfig<ProductTypes.ProductDTO> | undefined;
    const filters = copied.filters as ProductTypes.FilterableProductProps | undefined;
    return yield* withService(ctx, ({ service, context }) => kind === "retrieve"
      ? service.retrieveProduct(copied.id as string, find, context)
      : kind === "count" ? service.listAndCountProducts(filters, find, context) : service.listProducts(filters, find, context));
  }));
  const readType = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productType" + kind, "read", Effect.fn("ProductAdapter.type." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductTypeRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: Medusa owns query normalization; the table-bound related reader
    // validates filters, fields, paging and relations before calling the store.
    const find = copied.config as FindConfig<ProductTypes.ProductTypeDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withService(ctx, ({ service, context }) => service.retrieveProductType(id, find, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => kind === "count"
      ? service.listAndCountProductTypes(filters, find, context) : service.listProductTypes(filters, find, context));
  }));
  const related = (kind: "tag" | "type" | "collection" | "image" | "option" | "variant" | "category" | "assignment") => defineCommerceCommand("productCreate" + kind, "write", Effect.fn("ProductAdapter.createRelated")(function* (ctx, input) {
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata[kind].table.name, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(Array.isArray(input) ? input : [input]);
    // SAFETY: the DML-derived command decoder restricts fields before Medusa;
    // the selected repository and core validate normalized rows and authority.
    const result = yield* withService(ctx, ({ service, context }) => {
      switch (kind) {
        case "tag": return service.createProductTags(copied as ProductTypes.CreateProductTagDTO[], context);
        case "type": return service.createProductTypes(copied as ProductTypes.CreateProductTypeDTO[], context);
        case "collection": return service.createProductCollections(copied as ProductTypes.CreateProductCollectionDTO[], context);
        case "image": return service.createProductImages(copied, context);
        case "option": return service.createProductOptions(copied as ProductTypes.CreateProductOptionDTO[], context);
        case "variant": return service.createProductVariants(copied as ProductTypes.CreateProductVariantDTO[], context);
        case "category": return service.createProductCategories(copied as ProductTypes.CreateProductCategoryDTO[], context);
        case "assignment": return service.addImageToVariant(copied as Parameters<ProductModuleService["addImageToVariant"]>[0], context);
      }
    });
    return Array.isArray(input) ? result : Array.isArray(result) ? result[0] : result;
  }));
  const changeRelated = (kind: "tag" | "type" | "collection" | "category" | "option" | "variant" | "value", operation: "update" | "upsert") => defineCommerceCommand("product" + operation + kind, "write", Effect.fn("ProductAdapter.changeRelated")(function* (ctx, input) {
    if (operation === "update") {
      const decoded = yield* Effect.fromResult(decodeRelatedUpdate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata[kind].table.name, decoded.data))
        .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      const data = structuredClone(decoded.data);
      // SAFETY: DML-derived data fields exclude identity and managed columns;
      // repository pairs and the core revalidate normalized values before SQL.
      return yield* withService(ctx, ({ service, context }) => {
        switch (kind) {
          case "tag": return service.updateProductTags(decoded.id, data as ProductTypes.UpdateProductTagDTO, context);
          case "type": return service.updateProductTypes(decoded.id, data as ProductTypes.UpdateProductTypeDTO, context);
          case "collection": return service.updateProductCollections(decoded.id, data as ProductTypes.UpdateProductCollectionDTO, context);
          case "category": return service.updateProductCategories(decoded.id, data as ProductTypes.UpdateProductCategoryDTO, context);
          case "option": return service.updateProductOptions(decoded.id, data as ProductTypes.UpdateProductOptionDTO, context);
          case "variant": return service.updateProductVariants(decoded.id, data as ProductTypes.UpdateProductVariantDTO, context);
          case "value": return service.updateProductOptionValues(decoded.id, data as ProductTypes.UpdateProductOptionValueDTO, context);
        }
      });
    }
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedChange(metadata[kind].table.name, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (kind === "variant") {
      const members = Array.isArray(input) ? input : [input];
      const claimed = members.filter(isJsonObject).filter(row => typeof row.id === "string" && row.product_id !== undefined);
      if (claimed.length) {
        const store = yield* ctx.table(metadata.variant.table.name);
        const existing = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: "id", direction: "asc" },
          predicate: { kind: "in", column: "id", values: claimed.map(row => row.id) },
        });
        if (claimed.some(row => !existing.some(value => value.id === row.id && value.product_id === row.product_id))) return yield* ctx.refuse(commerceError("invalidInput"));
      }
    }
    const copied = structuredClone(Array.isArray(input) ? input : [input]);
    // SAFETY: same DML-derived scalar boundary as creation; the unchanged
    // service partitions creates/updates and owns missing-ID and metadata rules.
    const result = yield* withService(ctx, ({ service, context }) => {
      switch (kind) {
        case "tag": return service.upsertProductTags(copied as ProductTypes.UpsertProductTagDTO[], context);
        case "type": return service.upsertProductTypes(copied as ProductTypes.UpsertProductTypeDTO[], context);
        case "collection": return service.upsertProductCollections(copied as ProductTypes.UpsertProductCollectionDTO[], context);
        case "category": return service.upsertProductCategories(copied as ProductTypes.UpsertProductCategoryDTO[], context);
        case "option": return service.upsertProductOptions(copied as ProductTypes.UpsertProductOptionDTO[], context);
        case "variant": return service.upsertProductVariants(copied as ProductTypes.UpsertProductVariantDTO[], context);
        default: return Promise.reject(commerceError("unsupportedProfile"));
      }
    });
    return Array.isArray(input) ? result : Array.isArray(result) ? result[0] : result;
  }));
  const productChange = (operation: "update" | "upsert") => defineCommerceCommand("product" + (operation === "update" ? "Update" : "Upsert"), "write", Effect.fn("ProductAdapter.change")(function* (ctx, input) {
    const selected = operation === "upsert" ? undefined : yield* Effect.fromResult(decodeRelatedUpdate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (selected !== undefined && selected.data.id !== undefined && selected.data.id !== selected.id) return yield* ctx.refuse(commerceError("invalidInput"));
    const products: Json = selected === undefined ? input : [{ ...selected.data, id: selected.id }];
    yield* Effect.fromResult(metadata.valueProfile.validateUpdate(products)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    // normalizeUpdateProductInput matches options by title and can replace a
    // supplied ID. Authenticate that ID's existing parent before normalization.
    for (const product of Array.isArray(products) ? products : [products]) {
      if (!isJsonObject(product) || !Array.isArray(product.options)) continue;
      const ids = product.options.flatMap(option => isJsonObject(option) && typeof option.id === "string" ? [option.id] : []);
      if (ids.length === 0) continue;
      const store = yield* ctx.table(metadata.option.table.name);
      const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: "id", direction: "asc" }, predicate: { kind: "in", column: "id", values: ids } });
      if (new Set(ids).size !== ids.length || rows.length !== ids.length || rows.some(row => row.product_id !== product.id || row.deleted_at !== null)) return yield* ctx.refuse(commerceError("invalidInput"));
    }
    // SAFETY: DML-derived external graph validation precedes the actual service's
    // normalization; the replacement planner rechecks normalized ownership.
    return yield* withService(ctx, ({ service, context }) => selected === undefined
      ? service.upsertProducts(structuredClone(Array.isArray(products) ? products : [products]) as ProductTypes.UpsertProductDTO[], context)
      : service.updateProducts(selected.id, structuredClone(selected.data) as ProductTypes.UpdateProductDTO, context));
  }));
  const remove = (kind: "product" | "tag" | "type" | "category" | "collection") => defineCommerceCommand("productDelete" + kind, "write", Effect.fn("ProductAdapter.delete")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, async ({ service, context }) => {
      switch (kind) {
        case "product": await service.deleteProducts(ids, context); break;
        case "tag": await service.deleteProductTags(ids, context); break;
        case "type": await service.deleteProductTypes(ids, context); break;
        case "category": await service.deleteProductCategories(ids, context); break;
        case "collection": await service.deleteProductCollections(ids, context); break;
      }
      return null;
    });
  }));
  const lifecycle = (operation: "softDelete" | "restore") => defineCommerceCommand(operation === "restore" ? "productRestore" : "productSoftDelete", "write", Effect.fn("ProductAdapter.lifecycleCommand")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, async ({ service, context }) => (operation === "restore"
      ? await service.restoreProducts(ids, {}, context) : await service.softDeleteProducts(ids, {}, context)) ?? null);
  }));
  return { commands: Object.freeze({ create, list: read("list"), retrieve: read("retrieve"), count: read("count"),
    listTypes: readType("list"), retrieveType: readType("retrieve"), countTypes: readType("count"),
    delete: remove("product"), deleteTags: remove("tag"), deleteTypes: remove("type"), deleteCategories: remove("category"), deleteCollections: remove("collection"),
    softDelete: lifecycle("softDelete"), restore: lifecycle("restore"),
    createTags: related("tag"), createTypes: related("type"), createCollections: related("collection"), createImages: related("image"),
    updateTags: changeRelated("tag", "update"), updateTypes: changeRelated("type", "update"),
    upsertTags: changeRelated("tag", "upsert"), upsertTypes: changeRelated("type", "upsert"),
    update: productChange("update"), upsert: productChange("upsert"), createOptions: related("option"), createVariants: related("variant"), createCategories: related("category"), addImageToVariant: related("assignment"),
    updateOptions: changeRelated("option", "update"), updateVariants: changeRelated("variant", "update"), updateValues: changeRelated("value", "update"),
    updateCollections: changeRelated("collection", "update"), updateCategories: changeRelated("category", "update"),
    upsertOptions: changeRelated("option", "upsert"), upsertVariants: changeRelated("variant", "upsert"), upsertCollections: changeRelated("collection", "upsert"), upsertCategories: changeRelated("category", "upsert") }), withService };
});
