import { Effect, Schema } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { VariantImagePairs, VariantThumbnailSelector, decodeVariantThumbnailUpdate } from "../variant-workflow-input";
import { decodeProductFindConfig } from "../service-input";

/** Named repository admission belongs only to the inverse Image workflow.
 * Native methods still own assignment creation/removal and thumbnail updates. */
export function productImageVariantCommands({ metadata, withImageVariantWorkflowService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withImageVariantWorkflowService);
  const prepare = commerceCommandPreparation("ProductImageVariants.prepare");
  const decodePairs = commerceDecoder(VariantImagePairs.check(Schema.isMaxLength(4)), "invalidInput");
  const decodeRead = commerceDecoder(Schema.Struct({ filters: VariantThumbnailSelector, config: Schema.JsonObject }), "invalidInput");
  const pairsInput = Effect.fn("ProductImageVariants.pairsInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const pairs = yield* prepare(decodePairs)(ctx, input);
    if (new Set(pairs.map(pair => pair.image_id)).size > 1) return yield* ctx.refuse(commerceError("unsupportedProfile"));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.assignment.table.name, pairs))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return pairs.map(pair => ({ ...pair }));
  });
  const readInput = Effect.fn("ProductImageVariants.readInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const decoded = yield* prepare(decodeRead)(ctx, input);
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return { config: structuredClone(decoded.config), filters: { ...decoded.filters,
      id: typeof decoded.filters.id === "string" ? decoded.filters.id : [...decoded.filters.id],
    } };
  });
  const updateInput = Effect.fn("ProductImageVariants.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Json,
  ) {
    const decoded = yield* prepare(decodeVariantThumbnailUpdate)(ctx, input);
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.variant.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return { update: { ...decoded.update }, selector: { ...decoded.selector,
      id: typeof decoded.selector.id === "string" ? decoded.selector.id : [...decoded.selector.id],
    } };
  });
  return {
    addImageToVariant: commands.write("productImageWorkflowCreateAssignment", pairsInput, ({ service, context }, pairs) =>
      service.addImageToVariant(pairs, context)),
    removeImageFromVariant: commands.write("productImageWorkflowDeleteAssignment", pairsInput, async ({ service, context }, pairs) => {
      await service.removeImageFromVariant(pairs, context); return null;
    }),
    // SAFETY: checked native selects use the existing bounded FindConfig/DAL.
    listVariants: commands.read("productImageWorkflowListVariants", readInput, ({ service, context }, input) =>
      service.listProductVariants(input.filters, input.config as FindConfig<ProductTypes.ProductVariantDTO>, context)),
    updateVariantsBySelector: commands.write("productImageWorkflowUpdateVariantsBySelector", updateInput, ({ service, context }, input) =>
      service.updateProductVariants(input.selector, input.update, context)),
  };
}
