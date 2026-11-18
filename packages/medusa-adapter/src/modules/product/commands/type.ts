import { Effect } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { ProductTypeCreateInput, ProductTypeReadInput, decodeProductTypeUpdateInput, decodeProductTypeIds } from "../type-input";

/** The workflow selector overload retains native selection, metadata merging
 * and array results. The Type DAL checks the complete selection before writes. */
export function productTypeCommands({ metadata, withTypeWorkflowService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withTypeWorkflowService);
  const prepare = commerceCommandPreparation("ProductTypeWorkflow.prepare");
  const decodeCreate = commerceDecoder(ProductTypeCreateInput, "invalidInput");
  const decodeRead = commerceDecoder(ProductTypeReadInput, "invalidInput");
  const createInput = Effect.fn("ProductTypeWorkflow.createInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeCreate>[0],
  ) {
    const rows = yield* Effect.fromResult(decodeCreate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.type.table.name, rows))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(rows);
  });
  const updateInput = Effect.fn("ProductTypeWorkflow.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeProductTypeUpdateInput>[0],
  ) {
    const decoded = yield* Effect.fromResult(decodeProductTypeUpdateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.type.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(decoded);
  });
  return {
    createTypes: commands.write("productCreateTypesForWorkflow", createInput, ({ service, context }, rows) => service.createProductTypes(rows, context)),
    // SAFETY: the shared native preimage config is checked before the DAL's
    // Type DML projection and relation admission; FindConfig's keyof DTO
    // annotation does not model native metadata.* preimage field paths.
    listTypes: commands.read("productTypeListForWorkflow", prepare(decodeRead), ({ service, context }, input) => service.listProductTypes(
      input.filters, input.config as FindConfig<ProductTypes.ProductTypeDTO>, context)),
    updateTypesBySelector: commands.write("productUpdateTypesBySelector", updateInput, ({ service, context }, input) =>
      service.updateProductTypes(input.selector, input.update, context)),
    softDeleteTypes: commands.write("productSoftDeleteTypesForWorkflow", prepare(decodeProductTypeIds), async ({ service, context }, ids) =>
      (await service.softDeleteProductTypes([...ids], {}, context)) ?? null),
  };
}
