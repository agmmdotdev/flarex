import { Effect } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { ProductOptionCreateInput, ProductOptionReadInput, decodeProductOptionUpdateInput, decodeProductOptionIds } from "../option-input";

/** Native Product methods own string normalization and Value replacement;
 * the named repository profile bounds their complete preparation selections. */
export function productOptionCommands({ metadata, withOptionWorkflowService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withOptionWorkflowService);
  const prepare = commerceCommandPreparation("ProductOptionWorkflow.prepare");
  const decodeCreate = commerceDecoder(ProductOptionCreateInput, "invalidInput");
  const decodeRead = commerceDecoder(ProductOptionReadInput, "invalidInput");
  const createInput = Effect.fn("ProductOptionWorkflow.createInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeCreate>[0],
  ) {
    const rows = yield* Effect.fromResult(decodeCreate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.option.table.name, rows))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(rows);
  });
  const updateInput = Effect.fn("ProductOptionWorkflow.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeProductOptionUpdateInput>[0],
  ) {
    const decoded = yield* Effect.fromResult(decodeProductOptionUpdateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.option.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(decoded);
  });
  return {
    // SAFETY: the checked executing native method accepts omitted Values and
    // supplies its own empty relation; the published creation DTO requires it.
    createOptions: commands.write("productCreateOptionsForWorkflow", createInput, ({ service, context }, rows) =>
      service.createProductOptions(rows as ProductTypes.CreateProductOptionDTO[], context)),
    // SAFETY: native preimage selection and the Option DAL admit field paths
    // that the public FindConfig declaration does not represent.
    listOptions: commands.read("productOptionListForWorkflow", prepare(decodeRead), ({ service, context }, input) =>
      service.listProductOptions(input.filters, input.config as FindConfig<ProductTypes.ProductOptionDTO>, context)),
    updateOptionsBySelector: commands.write("productUpdateOptionsBySelector", updateInput, ({ service, context }, input) =>
      service.updateProductOptions(input.selector, input.update, context)),
    softDeleteOptions: commands.write("productSoftDeleteOptionsForWorkflow", prepare(decodeProductOptionIds), async ({ service, context }, ids) =>
      (await service.softDeleteProductOptions([...ids], {}, context)) ?? null),
  };
}
