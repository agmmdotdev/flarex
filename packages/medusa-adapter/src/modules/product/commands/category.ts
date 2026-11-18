import { Effect } from "effect";
import type { FindConfig, ProductTypes } from "@medusajs/framework/types";
import { commerceServiceCommands, commerceCommandPreparation } from "../../../module/commands";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductCommandServices } from "./services";
import { ProductCategoryCreateInput, ProductCategoryReadInput, decodeProductCategoryUpdateInput, decodeProductCategoryIds } from "../category-input";

/** Invoke native Category tree operations; only the command boundary carries
 * the private projection envelope, after native serialization and events. */
export function productCategoryCommands({ metadata, withCategoryWorkflowService }: ProductCommandServices) {
  const commands = commerceServiceCommands(withCategoryWorkflowService);
  const prepare = commerceCommandPreparation("ProductCategoryWorkflow.prepare");
  const decodeCreate = commerceDecoder(ProductCategoryCreateInput, "invalidInput");
  const decodeRead = commerceDecoder(ProductCategoryReadInput, "invalidInput");
  const createInput = Effect.fn("ProductCategoryWorkflow.createInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeCreate>[0],
  ) {
    const rows = yield* Effect.fromResult(decodeCreate(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    // Native public creation defaults a nullish handle before persistence.
    // Validate its other DML fields without substituting an adapter default.
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(metadata.category.table.name,
      rows.map(row => row.handle === null ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== "handle")) : row)))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(rows);
  });
  const updateInput = Effect.fn("ProductCategoryWorkflow.updateInput")(function* (
    ctx: Parameters<ProductCommandServices["withService"]>[0], input: Parameters<typeof decodeProductCategoryUpdateInput>[0],
  ) {
    const decoded = yield* Effect.fromResult(decodeProductCategoryUpdateInput(input)).pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.category.table.name, decoded.update))
      .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
    return structuredClone(decoded);
  });
  return {
    // SAFETY: the native nullish-handle branch accepts the checked null value;
    // the DTO declaration is narrower than the executing service contract.
    createCategories: commands.write("productCreateCategoriesForWorkflow", createInput, async ({ service, context, captureCategory }, rows) =>
      captureCategory(await service.createProductCategories(rows as ProductTypes.CreateProductCategoryDTO[], context))),
    listCategories: commands.read("productCategoryListForWorkflow", prepare(decodeRead), async ({ service, context, captureCategory }, input) =>
      captureCategory(await service.listProductCategories(input.filters, input.config as FindConfig<ProductTypes.ProductCategoryDTO>, context))),
    updateCategoriesBySelector: commands.write("productUpdateCategoriesBySelector", updateInput, async ({ service, context, captureCategory }, input) =>
      captureCategory(await service.updateProductCategories(input.selector, input.update, context))),
    softDeleteCategories: commands.write("productSoftDeleteCategoriesForWorkflow", prepare(decodeProductCategoryIds), async ({ service, context }, ids) =>
      (await service.softDeleteProductCategories([...ids], {}, context)) ?? null),
  };
}
