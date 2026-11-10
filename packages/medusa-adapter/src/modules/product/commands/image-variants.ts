import { Effect, Schema } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { VariantImagePairs, ParentQualifiedVariantImagePairs, VariantThumbnailSelector, decodeVariantThumbnailUpdate } from "../variant-workflow-input";
import { decodeProductFindConfig } from "../service-input";

export function productImageVariantCommands(services: ProductCommandServices) {
  return imageAssociationCommands(services, "imageVariants");
}
export function productParentQualifiedVariantImageCommands(services: ProductCommandServices) {
  return imageAssociationCommands(services, "parentVariantImages");
}
/** These two native entry points share complete preparation bounds, with
 * separate repository views and pair axes. Native methods own every write. */
function imageAssociationCommands({ metadata, withImageVariantWorkflowService, withVariantImageWorkflowService }: ProductCommandServices,
  direction: "imageVariants" | "parentVariantImages") {
  const forward = direction === "parentVariantImages";
  const commands = commerceServiceCommands(forward ? withVariantImageWorkflowService : withImageVariantWorkflowService);
  const names = forward ? { create: "productParentVariantImageCreateAssignment", remove: "productParentVariantImageDeleteAssignment",
    list: "productParentVariantImageListVariants", update: "productParentVariantImageUpdateVariantsBySelector" }
    : { create: "productImageWorkflowCreateAssignment", remove: "productImageWorkflowDeleteAssignment",
      list: "productImageWorkflowListVariants", update: "productImageWorkflowUpdateVariantsBySelector" };
  const prepare = commerceCommandPreparation("ProductImageVariants.prepare");
  const decodePairs = commerceDecoder(forward ? ParentQualifiedVariantImagePairs : VariantImagePairs.check(Schema.isMaxLength(4)), "invalidInput");
  const decodeRead = commerceDecoder(Schema.Struct({ filters: VariantThumbnailSelector, config: Schema.JsonObject }), "invalidInput");
  const pairsInput = Effect.fn("ProductImageVariants.pairsInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const pairs = yield* prepare(decodePairs)(ctx, input);
    if (new Set(pairs.map(pair => forward ? pair.variant_id : pair.image_id)).size > 1) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.assignment.table.name,
      pairs.map(({ image_id, variant_id }) => ({ image_id, variant_id }))))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return pairs.map(pair => ({ ...pair }));
  });
  const readInput = Effect.fn("ProductImageVariants.readInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const decoded = yield* prepare(decodeRead)(ctx, input);
    if (forward && decoded.filters.product_id === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return { config: structuredClone(decoded.config), filters: { ...decoded.filters,
      id: typeof decoded.filters.id === "string" ? decoded.filters.id : [...decoded.filters.id],
    } };
  });
  const updateInput = Effect.fn("ProductImageVariants.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const decoded = yield* prepare(decodeVariantThumbnailUpdate)(ctx, input);
    if (forward && (typeof decoded.selector.id !== "string" || decoded.selector.product_id === undefined))
      return yield* ctx.refuse(commerceError("invalidInput"));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.variant.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return { update: { ...decoded.update }, selector: { ...decoded.selector,
      id: typeof decoded.selector.id === "string" ? decoded.selector.id : [...decoded.selector.id],
    } };
  });
  return {
    addImageToVariant: commands.write(names.create, pairsInput, ({ service, context }, pairs) =>
      service.addImageToVariant(pairs, context)),
    removeImageFromVariant: commands.write(names.remove, pairsInput, async ({ service, context }, pairs) => {
      await service.removeImageFromVariant(pairs, context); return null;
    }),
    // SAFETY: checked native selects use the existing bounded FindConfig/DAL.
    listVariants: commands.read(names.list, readInput, ({ service, context }, input) =>
      service.listProductVariants(input.filters, input.config as FindConfig<ProductTypes.ProductVariantDTO>, context)),
    updateVariantsBySelector: commands.write(names.update, updateInput, ({ service, context }, input) =>
      service.updateProductVariants(input.selector, input.update, context)),
  };
}
