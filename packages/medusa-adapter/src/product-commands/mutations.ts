import { Effect } from "effect";
import { commerceServiceCommands } from "../service-commands";
import type { ProductCommandServices } from "./services";
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

type Context = Parameters<ProductCommandServices["withService"]>[0];

// Medusa receives arrays for related writes; the command retains its admitted
// single/array return shape, including services that already return one value.
const relatedResult = (result: Json, input: { readonly many: boolean }): Json => input.many ? result : Array.isArray(result) ? result[0] : result;
const copyRelatedInput = (input: Json) => ({ many: Array.isArray(input), rows: structuredClone(Array.isArray(input) ? input : [input]) });

/** Ordinary writes bind actual service methods. Domain checks and alternate
 * profiles remain explicit, before Medusa normalization and event decorators. */
export function productMutationCommands({ metadata, withService, withCollectionService }:
  Pick<ProductCommandServices, "metadata" | "withService" | "withCollectionService">) {
  const commands = commerceServiceCommands(withService);
  const collections = commerceServiceCommands(withCollectionService);
  const createInput = (table: string) => Effect.fn("ProductAdapter.relatedCreateInput")(function* (ctx: Context, input: Json) {
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(table, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return copyRelatedInput(input);
  });
  const decodeUpdate = (table: string) => Effect.fn("ProductAdapter.relatedUpdateInput")(function* (ctx: Context, input: Json) {
    const decoded = yield* Effect.fromResult(decodeRelatedUpdate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(table, decoded.data))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return decoded;
  });
  const updateInput = (table: string) => {
    const decode = decodeUpdate(table);
    return Effect.fn("ProductAdapter.copyRelatedUpdate")((ctx: Context, input: Json) =>
      decode(ctx, input).pipe(Effect.map(decoded => ({ id: decoded.id, data: structuredClone(decoded.data) }))));
  };
  const upsertInput = (table: string) => Effect.fn("ProductAdapter.relatedUpsertInput")(function* (ctx: Context, input: Json) {
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedChange(table, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return copyRelatedInput(input);
  });
  const categoryCreate = createInput(metadata.category.table.name);
  const categoryUpdate = decodeUpdate(metadata.category.table.name);
  const categoryUpsert = upsertInput(metadata.category.table.name);
  const tagUpsert = upsertInput(metadata.tag.table.name);
  const createCategoryInput = Effect.fn("ProductAdapter.categoryCreateInput")(function* (ctx: Context, input: Json) {
    yield* validateCategoryCommand(ctx, metadata, input);
    return yield* categoryCreate(ctx, input);
  });
  const updateCategoryInput = Effect.fn("ProductAdapter.categoryUpdateInput")(function* (ctx: Context, input: Json) {
    const decoded = yield* categoryUpdate(ctx, input);
    yield* validateCategoryCommand(ctx, metadata, { ...decoded.data, id: decoded.id });
    return { id: decoded.id, data: structuredClone(decoded.data) };
  });
  const upsertCategoryInput = Effect.fn("ProductAdapter.categoryUpsertInput")(function* (ctx: Context, input: Json) {
    yield* validateCategoryCommand(ctx, metadata, input);
    return yield* categoryUpsert(ctx, input);
  });
  const upsertTagInput = Effect.fn("ProductAdapter.tagUpsertInput")(function* (ctx: Context, input: Json) {
    const admitted = yield* captureProductTagUpsert(ctx, metadata.tag, input);
    const prepared = yield* tagUpsert(ctx, admitted);
    return { ...prepared, many: Array.isArray(input) };
  });
  const upsertVariantInput = Effect.fn("ProductAdapter.variantUpsertInput")(function* (ctx: Context, input: Json) {
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedChange(metadata.variant.table.name, input))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const members = Array.isArray(input) ? input : [input];
    const claimed = members.filter(isJsonObject).filter(row => typeof row.id === "string" && row.product_id !== undefined);
    if (claimed.length) {
      const store = yield* ctx.table(metadata.variant.table.name);
      const existing = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: "id", direction: "asc" },
        predicate: { kind: "in", column: "id", values: claimed.map(row => row.id) },
      });
      if (claimed.some(row => !existing.some(value => value.id === row.id && value.product_id === row.product_id))) return yield* ctx.refuse(commerceError("invalidInput"));
    }
    return copyRelatedInput(input);
  });
  const lifecycleInput = Effect.fn("ProductAdapter.lifecycleInput")((ctx: Context, input: Json) =>
    Effect.fromResult(decodeProductLifecycleIds(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
  const create = defineCommerceCommand("productCreate", "write", Effect.fn("ProductAdapter.create")(function* (ctx, input) {
    yield* validateProductCreate(metadata, input).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    // SAFETY: the external graph is checked before the unchanged service, then its
    // normalized values are checked against DML columns by the DAL and core.
    const decoded = yield* Effect.fromResult(decodeProductCreateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return yield* withService(ctx, ({ service, context }) => Array.isArray(decoded)
      ? service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO[], context)
      : service.createProducts(structuredClone(decoded) as ProductTypes.CreateProductDTO, context));
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
  const removeImageFromVariant = defineCommerceCommand("productDeleteassignment", "write", Effect.fn("ProductAdapter.removeVariantImage")(function* (ctx, input) {
    const decoded = yield* Effect.fromResult(decodeVariantImageInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    const pairs = "variant_id" in decoded ? [{ ...decoded }] : decoded.map(pair => ({ ...pair }));
    return yield* withService(ctx, async ({ service, context }) => { await service.removeImageFromVariant(pairs, context); return null; });
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
  // SAFETY: DML-derived admission restricts fields before these framework DTO
  // assertions. The selected DAL/core still validate normalized rows and authority.
  return {
    create, update: productChange("update"), upsert: productChange("upsert"),
    removeImageFromVariant, softDeleteTags, updateTagsBySelector, updateVariantsBySelector,
    createTags: commands.write("productCreatetag", createInput(metadata.tag.table.name), ({ service, context }, args) => service.createProductTags(args.rows as ProductTypes.CreateProductTagDTO[], context), relatedResult),
    createTypes: commands.write("productCreatetype", createInput(metadata.type.table.name), ({ service, context }, args) => service.createProductTypes(args.rows as ProductTypes.CreateProductTypeDTO[], context), relatedResult),
    createCollections: collections.write("productCreatecollection", createInput(metadata.collection.table.name), ({ service, context }, args) => service.createProductCollections(args.rows as ProductTypes.CreateProductCollectionDTO[], context), relatedResult),
    createImages: commands.write("productCreateimage", createInput(metadata.image.table.name), ({ service, context }, args) => service.createProductImages(args.rows, context), relatedResult),
    createOptions: commands.write("productCreateoption", createInput(metadata.option.table.name), ({ service, context }, args) => service.createProductOptions(args.rows as ProductTypes.CreateProductOptionDTO[], context), relatedResult),
    createVariants: commands.write("productCreatevariant", createInput(metadata.variant.table.name), ({ service, context }, args) => service.createProductVariants(args.rows as ProductTypes.CreateProductVariantDTO[], context), relatedResult),
    createCategories: commands.write("productCreatecategory", createCategoryInput, ({ service, context }, args) => service.createProductCategories(args.rows as ProductTypes.CreateProductCategoryDTO[], context), relatedResult),
    addImageToVariant: commands.write("productCreateassignment", createInput(metadata.assignment.table.name), ({ service, context }, args) => service.addImageToVariant(args.rows as Parameters<typeof service.addImageToVariant>[0], context), relatedResult),
    updateTags: commands.write("productupdatetag", updateInput(metadata.tag.table.name), ({ service, context }, args) => service.updateProductTags(args.id, args.data as ProductTypes.UpdateProductTagDTO, context)),
    upsertTags: commands.write("productupserttag", upsertTagInput, ({ service, context }, args) => service.upsertProductTags(args.rows as ProductTypes.UpsertProductTagDTO[], context), relatedResult),
    updateTypes: commands.write("productupdatetype", updateInput(metadata.type.table.name), ({ service, context }, args) => service.updateProductTypes(args.id, args.data as ProductTypes.UpdateProductTypeDTO, context)),
    upsertTypes: commands.write("productupserttype", upsertInput(metadata.type.table.name), ({ service, context }, args) => service.upsertProductTypes(args.rows as ProductTypes.UpsertProductTypeDTO[], context), relatedResult),
    updateCollections: collections.write("productupdatecollection", updateInput(metadata.collection.table.name), ({ service, context }, args) => service.updateProductCollections(args.id, args.data as ProductTypes.UpdateProductCollectionDTO, context)),
    upsertCollections: collections.write("productupsertcollection", upsertInput(metadata.collection.table.name), ({ service, context }, args) => service.upsertProductCollections(args.rows as ProductTypes.UpsertProductCollectionDTO[], context), relatedResult),
    updateCategories: commands.write("productupdatecategory", updateCategoryInput, ({ service, context }, args) => service.updateProductCategories(args.id, args.data as ProductTypes.UpdateProductCategoryDTO, context)),
    upsertCategories: commands.write("productupsertcategory", upsertCategoryInput, ({ service, context }, args) => service.upsertProductCategories(args.rows as ProductTypes.UpsertProductCategoryDTO[], context), relatedResult),
    updateOptions: commands.write("productupdateoption", updateInput(metadata.option.table.name), ({ service, context }, args) => service.updateProductOptions(args.id, args.data as ProductTypes.UpdateProductOptionDTO, context)),
    upsertOptions: commands.write("productupsertoption", upsertInput(metadata.option.table.name), ({ service, context }, args) => service.upsertProductOptions(args.rows as ProductTypes.UpsertProductOptionDTO[], context), relatedResult),
    updateVariants: commands.write("productupdatevariant", updateInput(metadata.variant.table.name), ({ service, context }, args) => service.updateProductVariants(args.id, args.data as ProductTypes.UpdateProductVariantDTO, context)),
    upsertVariants: commands.write("productupsertvariant", upsertVariantInput, ({ service, context }, args) => service.upsertProductVariants(args.rows as ProductTypes.UpsertProductVariantDTO[], context), relatedResult),
    updateValues: commands.write("productupdatevalue", updateInput(metadata.value.table.name), ({ service, context }, args) => service.updateProductOptionValues(args.id, args.data as ProductTypes.UpdateProductOptionValueDTO, context)),
    delete: commands.write("productDeleteproduct", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProducts(ids, context); return null; }),
    deleteTags: commands.write("productDeletetag", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProductTags(ids, context); return null; }),
    deleteTypes: commands.write("productDeletetype", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProductTypes(ids, context); return null; }),
    deleteCategories: commands.write("productDeletecategory", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProductCategories(ids, context); return null; }),
    deleteCollections: commands.write("productDeletecollection", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProductCollections(ids, context); return null; }),
    deleteOptions: commands.write("productDeleteoption", lifecycleInput, async ({ service, context }, ids) => { await service.deleteProductOptions(ids, context); return null; }),
    softDelete: commands.write("productSoftDelete", lifecycleInput, async ({ service, context }, ids) => (await service.softDeleteProducts(ids, {}, context)) ?? null),
    restore: commands.write("productRestore", lifecycleInput, async ({ service, context }, ids) => (await service.restoreProducts(ids, {}, context)) ?? null),
    softDeleteVariants: commands.write("productSoftDeleteVariant", lifecycleInput, async ({ service, context }, ids) => (await service.softDeleteProductVariants(ids, {}, context)) ?? null),
  };
}
