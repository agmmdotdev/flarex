// @ts-check

/** Exact erased ABI adaptations for the selected native creation closure.
 * Each replacement has a pinned count; no callback statement is replaced.
 * @param {string} source @param {string} target */
export function adaptCartCreateDeclarations(source, target) {
  let text = source;
  /** @param {string} before @param {string} after @param {number} [count] */
  const replace = (before, after, count = 1) => {
    if (text.split(before).length !== count + 1) throw new Error("Changed native Cart creation ABI anchor: " + target);
    text = text.split(before).join(after);
  };
  if (target.endsWith("/translations/apply-translations.ts")) {
    replace("container: MedusaContainer", 'container: Pick<MedusaContainer, "resolve">');
    replace("localeCode: string | undefined", "localeCode: string | null | undefined");
  } else if (target.endsWith("/translations/apply-translations-to-tax-lines.ts")) {
    replace("container: MedusaContainer", 'container: Pick<MedusaContainer, "resolve">');
    replace("locale: string | undefined", "locale: string | null | undefined");
  } else if (target.endsWith("/common/utils/apply-translations-to-items.ts")) {
    replace("  PRODUCT_COLLECTION_PREFIX,\n]", "  PRODUCT_COLLECTION_PREFIX,\n] as const");
    replace("(variant: ProductVariantDTO)", "(variant: Partial<ProductVariantDTO>)", 4);
  } else if (target.endsWith("/cart/steps/get-promotion-codes-to-apply.ts") ||
    target.endsWith("/cart/steps/prepare-adjustments-from-promotion-actions.ts")) {
    const query = `interface CartPromotionQuery {
  graph(input: { entity: "promotion"; fields: string[]; filters: { code: string[] } },
    options: { cache: { enable: true } }): Promise<{ data: Pick<PromotionDTO, "id" | "code">[] }>
}
`;
    if (target.endsWith("/get-promotion-codes-to-apply.ts"))
      text = 'import type { PromotionDTO } from "@medusajs/framework/types"\n' + text;
    text = query + text;
    replace("container.resolve(ContainerRegistrationKeys.QUERY)", "container.resolve<CartPromotionQuery>(ContainerRegistrationKeys.QUERY)");
    if (target.endsWith("/prepare-adjustments-from-promotion-actions.ts")) {
      replace("new Map<string, PromotionDTO>(", 'new Map<string, Pick<PromotionDTO, "id" | "code">>(');
      replace("promotion_id?: string", "promotion_id?: string | undefined", 2);
    }
  } else if (target.endsWith("/cart/workflows/update-tax-lines.ts")) {
    replace("cart_id?: string", "cart_id?: string | undefined");
    replace("force_tax_calculation?: boolean", "force_tax_calculation?: boolean | undefined");
    replace("): WorkflowData<void> =>", "): void =>");
    replace("filters: { id: input.cart_id }", "filters: { id: input.cart_id! }");
  } else if (target.endsWith("/cart/workflows/update-cart-promotions.ts")) {
    replace("cart_id?: string", "cart_id?: string | undefined");
    replace("promo_codes?: string[]", "promo_codes?: string[] | undefined");
    replace("filters: { id: input.cart_id }", "filters: { id: input.cart_id! }");
  } else if (target.endsWith("/cart/workflows/create-carts.ts")) {
    replace("  AdditionalData,", "  AdditionalData,\n  CartDTO,\n  RegionDTO,\n  SalesChannelDTO,");
    text = 'import type { WorkflowDefinition, Hook, NativePricingContext } from "@medusajs/workflows-sdk"\n' +
      'import type { FindOrCreateCustomerOutputStepOutput } from "../steps/find-or-create-customer"\n' + text;
    const hooks = `type CreateCartWorkflowHooks = readonly [
  Hook<"validate", { input: CreateCartDTO; cart: CreateCartDTO }>,
  Hook<"cartCreated", { cart: CartDTO; additional_data: AdditionalData["additional_data"] }>,
  Hook<"setPricingContext", { region: RegionDTO | null | undefined; variantIds: string[];
    salesChannel: SalesChannelDTO | null; customerData: FindOrCreateCustomerOutputStepOutput;
    additional_data: AdditionalData["additional_data"] }, NativePricingContext>
]
`;
    replace("export const createCartWorkflow = createWorkflow(", hooks +
      "export const createCartWorkflow: WorkflowDefinition<\n  CreateCartWorkflowInput, WorkflowData<CartDTO>, CreateCartWorkflowHooks\n> = createWorkflow(");
    replace("const cart = transform({ carts }", "const cart: WorkflowData<CartDTO> = transform({ carts }");
    // Prior native Channel validation and the one-Cart creation contract prove
    // these required identities before the dependent child is invoked.
    replace("sales_channel_id: salesChannel.id,", "sales_channel_id: salesChannel.id!,");
    replace("data.carts?.[0]", "data.carts?.[0]!");
    replace("cart_id: cart.id,", "cart_id: cart.id!,", 2);
    replace("data: { id: cart.id },", "data: { id: cart.id! },");
    replace("data.region.countries[0].iso_2", "data.region.countries[0]!.iso_2");
  } else if (target.endsWith("/common/steps/get-translated-tax-lines.ts")) {
    replace("locale: string", "locale: string | null | undefined");
  }
  return text;
}
