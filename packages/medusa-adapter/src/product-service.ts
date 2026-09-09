import { productInternalInput } from "./product-internal-input";
import { validateCategoryCommand } from "./product-category-input";
import { commerceInternalService, prepareCommerceModule } from "./commerce-module";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import { Product, ProductCategory, ProductCollection, ProductImage, ProductOption, ProductOptionValue, ProductTag, ProductType, ProductVariant, ProductVariantProductImage } from "@medusajs/product/models";
import { Modules } from "@medusajs/framework/utils/portable";
import type { FindConfig, ProductTypes, IEventBusModuleService, ModulePersistenceMutationService } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductRead, decodeProductNamedRead, decodeProductCollectionRead, decodeProductCategoryRead, decodeProductParentRead, decodeVariantImageInput, decodeProductFindConfig, decodeProductCreateInput, productReadFilters } from "./product-service-input";
import { decodeLocalEventOptions, decodeLocalEventBatch } from "./product-local-events";
import { captureProductTagUpsert } from "./product-tag-input";
import { captureCommerceInput } from "./commerce-input";
import { withCommerceService } from "./commerce-service-bridge";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureProductSchema } from "./product-schema";
import { productRepository, type ProductRepositoryProfile } from "./product-repository";
import { validateProductCreate } from "./product-graph";
import { decodeRelatedUpdate } from "./product-value-profile";
import { decodeProductLifecycleIds } from "./product-lifecycle";

function compose(ctx: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata, profile: ProductRepositoryProfile = "public") {
  const { repository, mutationPersistence, refuse, relatedRepository, categoryRepository, captureLocalEvent, rejectLocalEvent } = productRepository(ctx, owner, metadata, profile);
  const blocked = { ...repository, find: refuse, findAndCount: refuse, create: refuse, delete: refuse, softDelete: refuse, restore: refuse };
  const module = prepareCommerceModule(owner, { name: "flarex-product-local", baseRepository: repository,
    events: mutationPersistence, models: [
      { model: Product, repository },
      { model: ProductVariant, repository: relatedRepository(metadata.variant) },
      { model: ProductOption, repository: relatedRepository(metadata.option) },
      { model: ProductOptionValue, repository: relatedRepository(metadata.value) },
      { model: ProductImage, repository: relatedRepository(metadata.image) },
      { model: ProductCategory, repository: relatedRepository(metadata.category) },
      { model: ProductCollection, repository: relatedRepository(metadata.collection) },
      { model: ProductTag, repository: relatedRepository(metadata.tag) },
      { model: ProductType, repository: relatedRepository(metadata.type) },
      { model: ProductVariantProductImage, repository: relatedRepository(metadata.assignment) },
    ] });
  const { persistence, internalService: internal } = module;
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
  const categoryMutationService: ModulePersistenceMutationService = {
    interceptEntityMutationEvents: (event, args, context) => {
      // The pinned MedusaService mixin installs this method at runtime, but its
      // generated class declaration omits the inherited mutation contract.
      if (!("interceptEntityMutationEvents" in service) || typeof service.interceptEntityMutationEvents !== "function") throw new Error("Missing Product mutation service");
      service.interceptEntityMutationEvents(event, args, context);
    },
  };
  const categoryService = new ProductCategoryService({ productCategoryRepository: categoryRepository, modulePersistenceAdapter: persistence, productModuleService: categoryMutationService });
  const productService = internal(Product);
  const service: ProductModuleService = new ProductModuleService({
    // SAFETY: the pinned constructor type still requires the MikroORM-only
    // method. Its runtime hasDeepUpdate guard deliberately selects the portable
    // internal-service branch when that property is absent.
    baseRepository: module.baseRepository, productRepository: repository as ConstructorParameters<typeof ProductModuleService>[0]["productRepository"],
    productService,
    productVariantService: internal(ProductVariant),
    productOptionService: internal(ProductOption),
    productOptionValueService: internal(ProductOptionValue),
    productImageService: internal(ProductImage),
    productCategoryService: categoryService,
    productCollectionService: internal(ProductCollection),
    productTagService: internal(ProductTag), productTypeService: internal(ProductType),
    productImageProductService: commerceInternalService(ProductImage, blocked, persistence),
    productVariantProductImageService: internal(ProductVariantProductImage),
    [Modules.EVENT_BUS]: eventBus,
  }, { scope: "internal" });
  return { service, productService, categoryService, repository, eventBus, context: { manager: ctx.manager, transactionManager: ctx.manager } };
}

/** Private command set. No request may select local policy, a manager or a table. */
export const makeLocalProductCommands = Effect.fn("ProductAdapter.commands")(function* () {
  const captured = yield* captureProductSchema("product-runtime-contract");
  const metadata = yield* productRuntimeMetadata(captured.metadata.frame);
  const withService = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner, metadata), work);
  const withCategoryReadService = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner, metadata, "categoryProjection"), work);
  const withCollectionService = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner, metadata, "collectionMembership"), work);
  // Direct internal calls intentionally have no EmitEvents aggregator. Capture
  // their raw entity representation before it crosses the JSON command boundary.
  const withInternalCategory = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => compose(ctx, owner, metadata, "categoryProjection"), async value =>
      value.repository.serialize(await work(value)));
  const validateInternalProduct = productInternalInput(metadata);
  const withInternalProduct = (ctx: CommerceCommandContext, work: (value: ReturnType<typeof compose>) => Promise<unknown>) =>
    withCommerceService(ctx, owner => ({
      ...compose(ctx, owner, metadata, "internalProduct"),
      capture: (value: unknown) => owner.run(Effect.fromResult(captureCommerceInput(value, ctx.resources))),
    }), async value => value.capture(await work(value)));
  const internalProductRead = (kind: "list" | "retrieve") => defineCommerceCommand("productInternalProduct" + kind, "read", Effect.fn("ProductAdapter.internalProduct." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const filters = yield* Effect.fromResult(productReadFilters(decoded));
    const copied = structuredClone({ ...decoded, filters });
    // SAFETY: generated Medusa signatures accept a wider entity type; the
    // request-owned DAL validates every query before accessing the scoped store.
    return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "retrieve"
      ? productService.retrieve(copied.id as string, copied.config as FindConfig<object>, context)
      : productService.list(copied.filters as object, copied.config as FindConfig<object>, context));
  }));
  const internalProductChange = (kind: "create" | "update" | "softDelete" | "restore") => defineCommerceCommand("productInternalProduct" + kind, "write", Effect.fn("ProductAdapter.internalProduct." + kind)(function* (ctx, input) {
    if (kind === "softDelete" || kind === "restore") {
      const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "softDelete"
        ? productService.softDelete(typeof ids === "string" ? [ids] : [...ids], context) : productService.restore(typeof ids === "string" ? [ids] : [...ids], context));
    }
    yield* Effect.fromResult(validateInternalProduct(input, kind === "update")).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withInternalProduct(ctx, ({ productService, context }) => kind === "create"
      ? productService.create(structuredClone(input), context) : productService.update(structuredClone(input), context));
  }));
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
  const readNamed = (entity: "type" | "tag", kind: "list" | "retrieve" | "count") => defineCommerceCommand("product" + (entity === "type" ? "Type" : "Tag") + kind, "read", Effect.fn("ProductAdapter." + entity + "." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductNamedRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: Medusa owns query normalization; the table-bound related reader
    // validates filters, fields, paging and relations before calling the store.
    const find = copied.config as FindConfig<ProductTypes.ProductTypeDTO> | undefined;
    const tagFind = copied.config as FindConfig<ProductTypes.ProductTagDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withService(ctx, ({ service, context }) => entity === "type" ? service.retrieveProductType(id, find, context) : service.retrieveProductTag(id, tagFind, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => entity === "type"
      ? kind === "count" ? service.listAndCountProductTypes(filters, find, context) : service.listProductTypes(filters, find, context)
      : kind === "count" ? service.listAndCountProductTags(filters, tagFind, context) : service.listProductTags(filters, tagFind, context));
  }));
  const readCollection = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productCollection" + kind, "read", Effect.fn("ProductAdapter.collection." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductCollectionRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: the DML-bound reader validates normalized fields and relations.
    const find = copied.config as FindConfig<ProductTypes.ProductCollectionDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withService(ctx, ({ service, context }) => service.retrieveProductCollection(id, find, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => kind === "count"
      ? service.listAndCountProductCollections(filters, find, context) : service.listProductCollections(filters, find, context));
  }));
  const readCategory = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productCategory" + kind, "read", Effect.fn("ProductAdapter.category." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductCategoryRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: the DML-bound reader validates normalized fields and relations.
    const find = copied.config as FindConfig<ProductTypes.ProductCategoryDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withCategoryReadService(ctx, ({ service, context }) => service.retrieveProductCategory(id, find, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withCategoryReadService(ctx, ({ service, context }) => kind === "count"
      ? service.listAndCountProductCategories(filters, find, context) : service.listProductCategories(filters, find, context));
  }));
  const internalCategoryRead = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productInternalCategory" + kind, "read", Effect.fn("ProductAdapter.internalCategory." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductCategoryRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (kind === "retrieve" ? decoded.filters !== undefined : decoded.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const copied = structuredClone(decoded);
    // SAFETY: pinned signatures promise full entities for partial reads. The DAL
    // validates every normalized query; an absent ID reaches its original error.
    const find = copied.config as Parameters<ProductCategoryService["retrieve"]>[1];
    const filters = copied.filters as Parameters<ProductCategoryService["list"]>[0];
    return yield* withInternalCategory(ctx, ({ categoryService, context }) => kind === "retrieve"
      ? categoryService.retrieve(copied.id as string, find, context)
      : kind === "count" ? categoryService.listAndCount(filters, find, context) : categoryService.list(filters, find, context));
  }));
  const internalCategoryChange = (kind: "create" | "update" | "delete") => defineCommerceCommand("productInternalCategory" + kind, "write", Effect.fn("ProductAdapter.internalCategory." + kind)(function* (ctx, input) {
    if (!Array.isArray(input) || input.length > 256) return yield* ctx.refuse(commerceError("invalidInput"));
    if (kind === "delete") {
      const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      if (typeof ids === "string") return yield* ctx.refuse(commerceError("invalidInput"));
      return yield* withInternalCategory(ctx, ({ categoryService, context }) => categoryService.delete([...ids], context));
    }
    yield* validateCategoryCommand(ctx, metadata, input);
    for (const row of input) {
      if (!isJsonObject(row)) return yield* ctx.refuse(commerceError("invalidInput"));
      if (kind === "update") {
        const { id, ...data } = row;
        if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
        yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.category.table.name, data)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      } else yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.category.table.name, row)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    }
    // SAFETY: validated external fields enter the real specialized service;
    // prepared DAL writes revalidate the resulting rank/path and scoped links.
    return yield* withInternalCategory(ctx, ({ categoryService, context }) => kind === "create"
      ? categoryService.create(structuredClone(input) as Parameters<ProductCategoryService["create"]>[0], context)
      : categoryService.update(structuredClone(input) as Parameters<ProductCategoryService["update"]>[0], context));
  }));
  const readOption = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productOption" + kind, "read", Effect.fn("ProductAdapter.option." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductParentRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: the DML-bound reader validates normalized fields and relations.
    const find = copied.config as FindConfig<ProductTypes.ProductOptionDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withService(ctx, ({ service, context }) => service.retrieveProductOption(id, find, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => kind === "count"
      ? service.listAndCountProductOptions(filters, find, context) : service.listProductOptions(filters, find, context));
  }));
  const readVariant = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("productVariant" + kind, "read", Effect.fn("ProductAdapter.variant." + kind)(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductParentRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(decoded);
    // SAFETY: the DML-bound reader validates normalized fields and relations.
    const find = copied.config as FindConfig<ProductTypes.ProductVariantDTO> | undefined;
    if (kind === "retrieve") {
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const id = copied.id;
      return yield* withService(ctx, ({ service, context }) => service.retrieveProductVariant(id, find, context));
    }
    if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    const { id, ...scalars } = copied.filters ?? {};
    const filters = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => kind === "count"
      ? service.listAndCountProductVariants(filters, find, context) : service.listProductVariants(filters, find, context));
  }));
  const related = (kind: "tag" | "type" | "collection" | "image" | "option" | "variant" | "category" | "assignment") => defineCommerceCommand("productCreate" + kind, "write", Effect.fn("ProductAdapter.createRelated")(function* (ctx, input) {
    if (kind === "category") yield* validateCategoryCommand(ctx, metadata, input);
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata[kind].table.name, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone(Array.isArray(input) ? input : [input]);
    // SAFETY: the DML-derived command decoder restricts fields before Medusa;
    // the selected repository and core validate normalized rows and authority.
    const result = yield* (kind === "collection" ? withCollectionService : withService)(ctx, ({ service, context }) => {
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
      if (kind === "category") yield* validateCategoryCommand(ctx, metadata, { ...decoded.data, id: decoded.id });
      const data = structuredClone(decoded.data);
      // SAFETY: DML-derived data fields exclude identity and managed columns;
      // repository pairs and the core revalidate normalized values before SQL.
      return yield* (kind === "collection" ? withCollectionService : withService)(ctx, ({ service, context }) => {
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
    if (kind === "category") yield* validateCategoryCommand(ctx, metadata, input);
    const admitted = kind === "tag" ? yield* captureProductTagUpsert(ctx, metadata.tag, input) : input;
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedChange(metadata[kind].table.name, admitted))
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
    const copied = structuredClone(Array.isArray(admitted) ? admitted : [admitted]);
    // SAFETY: same DML-derived scalar boundary as creation; the unchanged
    // service partitions creates/updates and owns missing-ID and metadata rules.
    const result = yield* (kind === "collection" ? withCollectionService : withService)(ctx, ({ service, context }) => {
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
  const remove = (kind: "product" | "tag" | "type" | "category" | "collection" | "option") => defineCommerceCommand("productDelete" + kind, "write", Effect.fn("ProductAdapter.delete")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, async ({ service, context }) => {
      switch (kind) {
        case "product": await service.deleteProducts(ids, context); break;
        case "tag": await service.deleteProductTags(ids, context); break;
        case "type": await service.deleteProductTypes(ids, context); break;
        case "category": await service.deleteProductCategories(ids, context); break;
        case "collection": await service.deleteProductCollections(ids, context); break;
        case "option": await service.deleteProductOptions(ids, context); break;
      }
      return null;
    });
  }));
  const lifecycle = (operation: "softDelete" | "restore") => defineCommerceCommand(operation === "restore" ? "productRestore" : "productSoftDelete", "write", Effect.fn("ProductAdapter.lifecycleCommand")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, async ({ service, context }) => (operation === "restore"
      ? await service.restoreProducts(ids, {}, context) : await service.softDeleteProducts(ids, {}, context)) ?? null);
  }));
  const removeImageFromVariant = defineCommerceCommand("productDeleteassignment", "write", Effect.fn("ProductAdapter.removeVariantImage")(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeVariantImageInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const pairs = "variant_id" in decoded ? [{ ...decoded }] : decoded.map(pair => ({ ...pair }));
    return yield* withService(ctx, async ({ service, context }) => { await service.removeImageFromVariant(pairs, context); return null; });
  }));
  const softDeleteVariants = defineCommerceCommand("productSoftDeleteVariant", "write", Effect.fn("ProductAdapter.softDeleteVariants")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, async ({ service, context }) => (await service.softDeleteProductVariants(ids, {}, context)) ?? null);
  }));
  return { commands: Object.freeze({
    internalProductList: internalProductRead("list"), internalProductRetrieve: internalProductRead("retrieve"),
    internalProductCreate: internalProductChange("create"), internalProductUpdate: internalProductChange("update"),
    internalProductSoftDelete: internalProductChange("softDelete"), internalProductRestore: internalProductChange("restore"),
    internalCategoryList: internalCategoryRead("list"), internalCategoryRetrieve: internalCategoryRead("retrieve"), internalCategoryCount: internalCategoryRead("count"),
    internalCategoryCreate: internalCategoryChange("create"), internalCategoryUpdate: internalCategoryChange("update"), internalCategoryDelete: internalCategoryChange("delete"), create, list: read("list"), retrieve: read("retrieve"), count: read("count"),
    listCategories: readCategory("list"), retrieveCategory: readCategory("retrieve"), countCategories: readCategory("count"),
    listTypes: readNamed("type", "list"), retrieveType: readNamed("type", "retrieve"), countTypes: readNamed("type", "count"),
    listVariants: readVariant("list"), retrieveVariant: readVariant("retrieve"), countVariants: readVariant("count"), removeImageFromVariant, softDeleteVariants,
    listOptions: readOption("list"), retrieveOption: readOption("retrieve"), countOptions: readOption("count"), deleteOptions: remove("option"),
    listCollections: readCollection("list"), retrieveCollection: readCollection("retrieve"), countCollections: readCollection("count"),
    listTags: readNamed("tag", "list"), retrieveTag: readNamed("tag", "retrieve"), countTags: readNamed("tag", "count"),
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
