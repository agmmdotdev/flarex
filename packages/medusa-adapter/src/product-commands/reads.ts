import { Effect } from "effect";
import type { ProductCommandServices } from "./services";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineGraphReadCommand } from "../local-graph/commands";
import { decodeProductRead, decodeProductNamedRead, decodeProductCollectionRead, decodeProductCategoryRead,
  decodeProductParentRead, decodeProductFindConfig, productReadFilters } from "../product-service-input";

/** Read admission belongs here; Category keeps its distinct projection profile. */
export function productReadCommands({ withService, withCategoryReadService }:
  Pick<ProductCommandServices, "withService" | "withCategoryReadService">) {
  const read = (kind: "list" | "retrieve" | "count") => defineGraphReadCommand("product" + kind, Effect.fn("ProductAdapter." + kind)(function* (ctx, input) {
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
  const readNamed = (entity: "type" | "tag", kind: "list" | "retrieve" | "count") => defineGraphReadCommand("product" + (entity === "type" ? "Type" : "Tag") + kind, Effect.fn("ProductAdapter." + entity + "." + kind)(function* (ctx, input) {
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
  const readCollection = (kind: "list" | "retrieve" | "count") => defineGraphReadCommand("productCollection" + kind, Effect.fn("ProductAdapter.collection." + kind)(function* (ctx, input) {
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
  const readCategory = (kind: "list" | "retrieve" | "count") => defineGraphReadCommand("productCategory" + kind, Effect.fn("ProductAdapter.category." + kind)(function* (ctx, input) {
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
  const readOption = (kind: "list" | "retrieve" | "count") => defineGraphReadCommand("productOption" + kind, Effect.fn("ProductAdapter.option." + kind)(function* (ctx, input) {
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
  const readVariant = (kind: "list" | "retrieve" | "count") => defineGraphReadCommand("productVariant" + kind, Effect.fn("ProductAdapter.variant." + kind)(function* (ctx, input) {
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
  const countImages = defineGraphReadCommand("productImagecount", Effect.fn("ProductAdapter.image.count")(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (decoded.id !== undefined || decoded.deletedAfter !== undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    const copied = structuredClone(decoded);
    // SAFETY: the existing Image DML read profile validates the actual generated
    // service query, including projection, filters, ordering and row bounds.
    return yield* withService(ctx, ({ service, context }) => service.listAndCountProductImages(
      copied.filters as Parameters<typeof service.listAndCountProductImages>[0],
      copied.config as Parameters<typeof service.listAndCountProductImages>[1], context));
  }));
  return { read, readNamed, readCollection, readCategory, readOption, readVariant, countImages };
}
