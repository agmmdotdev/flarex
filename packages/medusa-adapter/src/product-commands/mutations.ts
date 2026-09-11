import { Effect } from "effect";
import type { ProductCommandServices } from "./services";
import type { ProductModuleService } from "@medusajs/product/services";
import type { ProductTypes } from "@medusajs/framework/types";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { validateCategoryCommand } from "../product-category-input";
import { decodeVariantImageInput, decodeProductCreateInput } from "../product-service-input";
import { captureProductTagUpsert } from "../product-tag-input";
import { decodeProductTagUpdateInput } from "../product-tag-update-input";
import { decodeVariantThumbnailUpdate } from "../product-variant-workflow-input";
import { validateProductCreate } from "../product-graph";
import { decodeRelatedUpdate } from "../product-value-profile";
import { decodeProductLifecycleIds } from "../product-lifecycle";

/** Product mutation admission precedes the unchanged Medusa services. Collection
 * membership and pre-normalization parent checks remain explicit policies. */
export function productMutationCommands({ metadata, withService, withCollectionService }:
  Pick<ProductCommandServices, "metadata" | "withService" | "withCollectionService">) {
  const create = defineCommerceCommand("productCreate", "write", Effect.fn("ProductAdapter.create")(function* (ctx, input) {
    yield* validateProductCreate(metadata, input).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    // SAFETY: the external graph is checked before the unchanged service, then its
    // normalized values are checked against DML columns by the DAL and core.
    const decoded = yield* Effect.fromResult(decodeProductCreateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, ({ service, context }) => Array.isArray(decoded)
      ? service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO[], context)
      : service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO, context));
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
  const softDeleteTags = defineCommerceCommand("productSoftDeleteTag", "write", Effect.fn("ProductAdapter.softDeleteTags")(function* (ctx, input) {
    const ids = yield* Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    if (Array.isArray(ids) && new Set(ids).size !== ids.length) return yield* ctx.refuse(commerceError("invalidInput"));
    return yield* withService(ctx, async ({ service, context }) => (await service.softDeleteProductTags(ids, {}, context)) ?? null);
  }));
  const updateTagsBySelector = defineCommerceCommand("productUpdateTagsBySelector", "write", Effect.fn("ProductAdapter.updateTagsBySelector")(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeProductTagUpdateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.tag.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const { id, ...scalars } = decoded.selector;
    const selector = { ...scalars, ...(id === undefined ? {} : { id: typeof id === "string" ? id : [...id] }) };
    return yield* withService(ctx, ({ service, context }) => service.updateProductTags(selector, { ...decoded.update }, context));
  }));
  const updateVariantsBySelector = defineCommerceCommand("productUpdateVariantsBySelector", "write", Effect.fn("ProductAdapter.updateVariantsBySelector")(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeVariantThumbnailUpdate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.variant.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, ({ service, context }) => service.updateProductVariants({ ...decoded.selector }, { ...decoded.update }, context));
  }));
  return { create, related, changeRelated, productChange, remove, lifecycle, removeImageFromVariant,
    softDeleteVariants, softDeleteTags, updateTagsBySelector, updateVariantsBySelector };
}
