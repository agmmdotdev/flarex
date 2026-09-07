import { lowerCaseFirst } from "@medusajs/utils/common/lower-case-first";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { Product, ProductCategory, ProductCollection, ProductImage, ProductOption, ProductOptionValue, ProductTag, ProductType, ProductVariant, ProductVariantProductImage } from "@medusajs/product/models";
import { MedusaInternalService } from "@medusajs/utils/modules-sdk/medusa-internal-service";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils/portable";
import type { DAL, FindConfig, ProductTypes, IEventBusModuleService } from "@medusajs/framework/types";
import { defineCommerceCommand, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { withCommerceService } from "./commerce-service-bridge";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { captureProductSchema } from "./product-schema";
import { productRepository } from "./product-repository";
import { validateProductCreate } from "./product-graph";

function compose(ctx: CommerceCommandContext, owner: CommercePromiseOwner, metadata: ProductRuntimeMetadata) {
  const { repository, persistence, refuse, captureLocalEvent, rejectLocalEvent } = productRepository(ctx, owner, metadata);
  const blocked = { ...repository, find: refuse, findAndCount: refuse, create: refuse };
  const internal = <Model extends { readonly name: string }>(model: Model, selected: DAL.RepositoryService = blocked) => new (MedusaInternalService(model))<object, Model>({
    [lowerCaseFirst(model.name) + "Repository"]: selected, [ContainerRegistrationKeys.MODULE_PERSISTENCE_ADAPTER]: persistence,
  });
  const eventBus: IEventBusModuleService = {
    emit: (input, options) => owner.run(Effect.gen(function* () {
      const settings = yield* Effect.fromResult(captureCommerceInput(options));
      if (!isJsonObject(settings) || Object.keys(settings).length !== 1 || settings.internal !== true) return yield* rejectLocalEvent(commerceError("unadmittedEvent"));
      const messages = yield* Effect.fromResult(captureCommerceInput(input));
      if (!Array.isArray(messages)) return yield* rejectLocalEvent(commerceError("unadmittedEvent"));
      for (const message of messages) yield* captureLocalEvent(message);
    }).pipe(Effect.catchTag("CommerceTransactionError", rejectLocalEvent))),
    subscribe: () => owner.reject(commerceError("unsupportedProfile")),
    unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
    releaseGroupedEvents: refuse, clearGroupedEvents: refuse,
  };
  const service = new ProductModuleService({
    baseRepository: repository, productRepository: { ...repository, deepUpdate: refuse },
    productService: internal(Product, repository),
    productVariantService: internal(ProductVariant),
    productOptionService: internal(ProductOption),
    productOptionValueService: internal(ProductOptionValue),
    productImageService: internal(ProductImage),
    productCategoryService: internal(ProductCategory),
    productCollectionService: internal(ProductCollection),
    productTagService: internal(ProductTag), productTypeService: internal(ProductType),
    productImageProductService: internal(ProductImage),
    productVariantProductImageService: internal(ProductVariantProductImage),
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
    if (!Array.isArray(input) && !isJsonObject(input)) return yield* ctx.refuse(commerceError("invalidInput"));
    if (isJsonObject(input) && typeof input.title !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
    return yield* withService(ctx, ({ service, context }) => Array.isArray(input)
      ? service.createProducts(structuredClone(input) as ProductTypes.CreateProductDTO[], context)
      : service.createProducts({ ...structuredClone(input), title: input.title } as ProductTypes.CreateProductDTO, context));
  }));
  const read = (kind: "list" | "retrieve" | "count") => defineCommerceCommand("product" + kind, "read", Effect.fn("ProductAdapter." + kind)(function* (ctx, input) {
    if (!isJsonObject(input) || Object.keys(input).some(key => !["id", "filters", "config"].includes(key)) || (input.id !== undefined && typeof input.id !== "string")) return yield* ctx.refuse(commerceError("invalidInput"));
    const config = input.config ?? {};
    if (!isJsonObject(config) || Object.keys(config).some(key => !["select", "relations", "skip", "take", "order"].includes(key)) ||
      [config.skip, config.take].some(value => value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value)))) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    const copied = structuredClone(input);
    // SAFETY: the selected DAL decoder validates all filters, projections,
    // pagination and relations after Medusa builds its query and before SQL.
    const find = copied.config as FindConfig<ProductTypes.ProductDTO> | undefined;
    const filters = copied.filters as ProductTypes.FilterableProductProps | undefined;
    return yield* withService(ctx, ({ service, context }) => kind === "retrieve"
      ? service.retrieveProduct(copied.id as string, find, context)
      : kind === "count" ? service.listAndCountProducts(filters, find, context) : service.listProducts(filters, find, context));
  }));
  return { commands: Object.freeze({ create, list: read("list"), retrieve: read("retrieve"), count: read("count") }), withService };
});
