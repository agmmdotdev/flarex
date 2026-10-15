import { Effect, Schema } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { ProductLifecycleIds } from "../lifecycle";
import { decodeProductFindConfig } from "../service-input";

export const ProductDeletionIds = Schema.Array(ProductLifecycleIds.value).check(Schema.isMaxLength(4));
const decodeIds = commerceDecoder(ProductDeletionIds, "invalidInput");
const Read = Schema.Struct({ filters: Schema.Struct({ id: Schema.Union([ProductLifecycleIds.value,
  Schema.Array(ProductLifecycleIds.value).check(Schema.isMaxLength(32))]) }), config: Schema.optionalKey(Schema.JsonObject) });
const decodeRead = commerceDecoder(Read, "invalidInput");

/** Named native methods retain empty/missing/duplicate request semantics while
 * the deletion DAL admits the complete finite lifecycle closure. */
export function productDeletionCommands({ withDeletionService, withService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withDeletionService), reads = commerceServiceCommands(withService);
  const prepare = commerceCommandPreparation("ProductDeletion.prepare");
  const readInput = Effect.fn("ProductDeletion.readInput")(function* (ctx: Parameters<ProductCommandServices["withService"]>[0], input: unknown) {
    const decoded = yield* Effect.fromResult(decodeRead(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(decodeProductFindConfig(decoded.config ?? {})).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return decoded;
  });
  return {
    softDeleteProducts: commands.write("productSoftDeleteProductsForWorkflow", prepare(decodeIds), async ({ service, context }, ids) =>
      (await service.softDeleteProducts([...ids], {}, context)) ?? null),
    softDeleteVariants: commands.write("productSoftDeleteVariantsForWorkflow", prepare(decodeIds), async ({ service, context }, ids) =>
      (await service.softDeleteProductVariants([...ids], {}, context)) ?? null),
    countVariants: reads.read("productVariantDeletionCount", readInput, ({ service, context }, args) => service.listAndCountProductVariants(
      { id: typeof args.filters.id === "string" ? args.filters.id : [...args.filters.id] },
      args.config as FindConfig<ProductTypes.ProductVariantDTO> | undefined, context)),
  };
}
