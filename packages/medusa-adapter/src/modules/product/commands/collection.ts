import { Effect } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { ProductCollectionCreateInput, ProductCollectionReadInput, decodeProductCollectionUpdateInput, decodeProductCollectionIds } from "../collection-input";

/** Native selectors, metadata merge, handle generation and membership DTOs
 * stay with the real ProductModuleService and its named Collection DAL. */
export function productCollectionCommands({ metadata, withCollectionWorkflowService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withCollectionWorkflowService);
  const prepare = commerceCommandPreparation("ProductCollectionWorkflow.prepare");
  const decodeCreate = commerceDecoder(ProductCollectionCreateInput, "invalidInput");
  const decodeRead = commerceDecoder(ProductCollectionReadInput, "invalidInput");
  const createInput = Effect.fn("ProductCollectionWorkflow.createInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeCreate>[0],
  ) {
    const rows = yield* Effect.fromResult(decodeCreate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.collection.table.name, rows))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(rows);
  });
  const updateInput = Effect.fn("ProductCollectionWorkflow.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeProductCollectionUpdateInput>[0],
  ) {
    const decoded = yield* Effect.fromResult(decodeProductCollectionUpdateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.collection.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(decoded);
  });
  return {
    createCollections: commands.write("productCreateCollectionsForWorkflow", createInput, ({ service, context }, rows) => service.createProductCollections(rows, context)),
    // SAFETY: shared native preimage selection and the selected Collection DAL
    // check fields and relations; keyof DTO omits native DTO-only field paths.
    listCollections: commands.read("productCollectionListForWorkflow", prepare(decodeRead), ({ service, context }, input) =>
      service.listProductCollections(input.filters, input.config as FindConfig<ProductTypes.ProductCollectionDTO>, context)),
    updateCollectionsBySelector: commands.write("productUpdateCollectionsBySelector", updateInput, ({ service, context }, input) =>
      service.updateProductCollections(input.selector, input.update, context)),
    softDeleteCollections: commands.write("productSoftDeleteCollectionsForWorkflow", prepare(decodeProductCollectionIds), async ({ service, context }, ids) =>
      (await service.softDeleteProductCollections([...ids], {}, context)) ?? null),
  };
}
