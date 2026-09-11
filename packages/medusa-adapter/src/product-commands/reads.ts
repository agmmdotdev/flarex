import { Effect, type Result } from "effect";
import type { ProductCommandServices } from "./services";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands } from "../service-commands";
import { decodeProductRead, decodeProductNamedRead, decodeProductCollectionRead, decodeProductCategoryRead,
  decodeProductParentRead, decodeProductFindConfig, productReadFilters } from "../product-service-input";

type Context = Parameters<ProductCommandServices["withService"]>[0];
type NamedRead = Result.Result.Success<ReturnType<typeof decodeProductNamedRead>>;

/** Related reads share admission, not an entity-name dispatcher. Each decoder
 * still owns its exact fields; root Product and Image have different policies. */
function relatedReadInput<Read extends NamedRead>(decode: (input: unknown) => Result.Result<Read, ReturnType<typeof commerceError>>) {
  const read = Effect.fn("ProductAdapter.relatedReadInput")(function* (ctx: Context, input: Json) {
    const decoded = yield* Effect.fromResult(decode(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(decoded);
  });
  return {
    list: Effect.fn("ProductAdapter.relatedListInput")(function* (ctx: Context, input: Json) {
      const copied = yield* read(ctx, input);
      if (copied.id !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      const { id, ...scalars } = copied.filters ?? {};
      return { config: copied.config, filters: { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) } };
    }),
    retrieve: Effect.fn("ProductAdapter.relatedRetrieveInput")(function* (ctx: Context, input: Json) {
      const copied = yield* read(ctx, input);
      if (copied.id === undefined || copied.filters !== undefined) return yield* ctx.refuse(commerceError("invalidInput"));
      return { id: copied.id, config: copied.config };
    }),
  };
}

/** All bindings invoke the actual Medusa method on the command-owned receiver.
 * SAFETY: FindConfig and root filters are framework-boundary assertions only;
 * the existing selected DAL validates the normalized query before storage. */
export function productReadCommands({ withService, withCategoryReadService }:
  Pick<ProductCommandServices, "withService" | "withCategoryReadService">) {
  const commands = commerceServiceCommands(withService);
  const categories = commerceServiceCommands(withCategoryReadService);
  const rootInput = Effect.fn("ProductAdapter.readInput")(function* (ctx: Context, input: Json) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const filters = yield* Effect.fromResult(productReadFilters(decoded)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const copied = structuredClone({ ...decoded, filters });
    return { ...copied, config: copied.config as FindConfig<ProductTypes.ProductDTO> | undefined,
      filters: copied.filters as ProductTypes.FilterableProductProps | undefined };
  });
  const named = relatedReadInput(decodeProductNamedRead);
  const collection = relatedReadInput(decodeProductCollectionRead);
  const category = relatedReadInput(decodeProductCategoryRead);
  const parent = relatedReadInput(decodeProductParentRead);
  const imageInput = Effect.fn("ProductAdapter.imageReadInput")(function* (ctx: Context, input: Json) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (decoded.id !== undefined || decoded.deletedAfter !== undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    return structuredClone(decoded);
  });
  return {
    list: commands.read("productlist", rootInput, ({ service, context }, args) => service.listProducts(args.filters, args.config, context)),
    // Missing ID deliberately reaches Medusa's original missing-key error.
    retrieve: commands.read("productretrieve", rootInput, ({ service, context }, args) => service.retrieveProduct(args.id as string, args.config, context)),
    count: commands.read("productcount", rootInput, ({ service, context }, args) => service.listAndCountProducts(args.filters, args.config, context)),
    listTypes: commands.read("productTypelist", named.list, ({ service, context }, args) => service.listProductTypes(args.filters, args.config as FindConfig<ProductTypes.ProductTypeDTO> | undefined, context)),
    retrieveType: commands.read("productTyperetrieve", named.retrieve, ({ service, context }, args) => service.retrieveProductType(args.id, args.config as FindConfig<ProductTypes.ProductTypeDTO> | undefined, context)),
    countTypes: commands.read("productTypecount", named.list, ({ service, context }, args) => service.listAndCountProductTypes(args.filters, args.config as FindConfig<ProductTypes.ProductTypeDTO> | undefined, context)),
    listTags: commands.read("productTaglist", named.list, ({ service, context }, args) => service.listProductTags(args.filters, args.config as FindConfig<ProductTypes.ProductTagDTO> | undefined, context)),
    retrieveTag: commands.read("productTagretrieve", named.retrieve, ({ service, context }, args) => service.retrieveProductTag(args.id, args.config as FindConfig<ProductTypes.ProductTagDTO> | undefined, context)),
    countTags: commands.read("productTagcount", named.list, ({ service, context }, args) => service.listAndCountProductTags(args.filters, args.config as FindConfig<ProductTypes.ProductTagDTO> | undefined, context)),
    listCollections: commands.read("productCollectionlist", collection.list, ({ service, context }, args) => service.listProductCollections(args.filters, args.config as FindConfig<ProductTypes.ProductCollectionDTO> | undefined, context)),
    retrieveCollection: commands.read("productCollectionretrieve", collection.retrieve, ({ service, context }, args) => service.retrieveProductCollection(args.id, args.config as FindConfig<ProductTypes.ProductCollectionDTO> | undefined, context)),
    countCollections: commands.read("productCollectioncount", collection.list, ({ service, context }, args) => service.listAndCountProductCollections(args.filters, args.config as FindConfig<ProductTypes.ProductCollectionDTO> | undefined, context)),
    listCategories: categories.read("productCategorylist", category.list, ({ service, context }, args) => service.listProductCategories(args.filters, args.config as FindConfig<ProductTypes.ProductCategoryDTO> | undefined, context)),
    retrieveCategory: categories.read("productCategoryretrieve", category.retrieve, ({ service, context }, args) => service.retrieveProductCategory(args.id, args.config as FindConfig<ProductTypes.ProductCategoryDTO> | undefined, context)),
    countCategories: categories.read("productCategorycount", category.list, ({ service, context }, args) => service.listAndCountProductCategories(args.filters, args.config as FindConfig<ProductTypes.ProductCategoryDTO> | undefined, context)),
    listOptions: commands.read("productOptionlist", parent.list, ({ service, context }, args) => service.listProductOptions(args.filters, args.config as FindConfig<ProductTypes.ProductOptionDTO> | undefined, context)),
    retrieveOption: commands.read("productOptionretrieve", parent.retrieve, ({ service, context }, args) => service.retrieveProductOption(args.id, args.config as FindConfig<ProductTypes.ProductOptionDTO> | undefined, context)),
    countOptions: commands.read("productOptioncount", parent.list, ({ service, context }, args) => service.listAndCountProductOptions(args.filters, args.config as FindConfig<ProductTypes.ProductOptionDTO> | undefined, context)),
    listVariants: commands.read("productVariantlist", parent.list, ({ service, context }, args) => service.listProductVariants(args.filters, args.config as FindConfig<ProductTypes.ProductVariantDTO> | undefined, context)),
    retrieveVariant: commands.read("productVariantretrieve", parent.retrieve, ({ service, context }, args) => service.retrieveProductVariant(args.id, args.config as FindConfig<ProductTypes.ProductVariantDTO> | undefined, context)),
    countVariants: commands.read("productVariantcount", parent.list, ({ service, context }, args) => service.listAndCountProductVariants(args.filters, args.config as FindConfig<ProductTypes.ProductVariantDTO> | undefined, context)),
    countImages: commands.read("productImagecount", imageInput, ({ service, context }, args) => service.listAndCountProductImages(
      args.filters as Parameters<typeof service.listAndCountProductImages>[0], args.config as Parameters<typeof service.listAndCountProductImages>[1], context)),
  };
}
