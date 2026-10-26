// @ts-check
import ts from "@typescript/typescript6";

const prefix = "packages/medusa-core-flows/src/";
export const checkoutSourcePairs = Object.freeze([
  "order/steps/create-orders.ts",
  "cart/workflows/refund-payment-recreate-payment-session.ts",
  "cart/steps/compensate-payment-if-needed.ts",
  "cart/steps/update-carts.ts",
  "cart/workflows/complete-cart.ts",
  "cart/utils/prepare-checkout-order-data.ts",
  "cart/steps/validate-cart-payments.ts",
  "cart/steps/validate-shipping.ts",
  "cart/steps/reserve-inventory.ts",
  "promotion/steps/register-usage.ts",
].map(file => ({ source: "third_party/medusa/upstream/packages/core/core-flows/src/" +
  (file === "cart/utils/prepare-checkout-order-data.ts" ? "cart/workflows/complete-cart.ts" : file),
  target: prefix + file, classification: "workflowFork" })));

/** @param {string} source */
function checkoutPreparation(source) {
  const file = ts.createSourceFile("complete-cart.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  /** @type {ts.ArrowFunction[]} */
  const callbacks = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "cartToOrder" &&
      node.initializer !== undefined && ts.isCallExpression(node.initializer)) {
      const callback = node.initializer.arguments[1];
      if (callback !== undefined && ts.isArrowFunction(callback)) callbacks.push(callback);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const [callback] = callbacks;
  if (callbacks.length !== 1 || callback === undefined || !ts.isBlock(callback.body)) throw new Error("Missing native checkout preparation");
  return { callback: callback.getText(file), body: callback.body.getText(file) };
}

/** Exact finite-host seams only; native business code remains in its owner.
 * @param {string} source @param {string} targetPath */
export function adaptCheckoutSource(source, targetPath) {
  if (!checkoutSourcePairs.some(pair => pair.target === targetPath)) throw new Error("Unknown native checkout source");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"')
    .replaceAll('"@medusajs/framework/workflows-sdk"', '"@medusajs/workflows-sdk"');
  if (targetPath === prefix + "cart/utils/prepare-checkout-order-data.ts") return (
    'import type { CheckoutCartView } from "../../common/steps/checkout-query-views"\n' +
    'import { decodeCheckoutPreparedLineItem, decodeCheckoutPreparedAdjustments } from "../../common/steps/checkout-order-view"\n' +
    'import { OrderStatus } from "@medusajs/framework/utils/portable"\n' +
    'import { prepareLineItemData, prepareTaxLinesData, prepareAdjustmentsData } from "./prepare-line-item-data"\n' +
    'export function prepareCheckoutOrderData(cart: CheckoutCartView) ' + checkoutPreparation(expected).body
      .replace('const input: PrepareLineItemDataInput =', 'const input =')
      .replace('unitPrice: item.unit_price,', 'unitPrice: item.raw_unit_price ?? item.unit_price,')
      .replace('return prepareLineItemData(input)', 'const prepared: unknown = Reflect.apply(prepareLineItemData, undefined, [input])\n          return decodeCheckoutPreparedLineItem(prepared)')
      .replace('const shippingMethods = (cart.shipping_methods ?? []).map((sm) => {',
        'const shippingMethods = (cart.shipping_methods ?? []).map((sm) => {\n          const taxLines: unknown = Reflect.apply(prepareTaxLinesData, undefined, [sm.tax_lines ?? []])\n          const preparedAdjustments: unknown = Reflect.apply(prepareAdjustmentsData, undefined, [sm.adjustments ?? []])\n          const adjustments = decodeCheckoutPreparedAdjustments(preparedAdjustments)')
      .replace('prepareTaxLinesData(sm.tax_lines ?? [])', 'taxLines')
      .replace('prepareAdjustmentsData(sm.adjustments ?? [])', 'adjustments')
      .replace('(creditLine: CartCreditLineDTO)', '(creditLine)') + '\n');
  if (targetPath === prefix + "cart/workflows/complete-cart.ts") expected = expected
    .replace('import {\n  CartCreditLineDTO,\n  CartWorkflowDTO,\n  LinkDefinition,\n  PromotionDTO,\n  UsageComputedActions,\n} from "@medusajs/framework/types"',
      'import type { CartTypes, LinkDefinition, PromotionDTO, PromotionTypes } from "@medusajs/framework/types"\n' +
      'import { EventPriority } from "@medusajs/utils/event-bus/utils"\n' +
      'type CartCreditLineDTO = CartTypes.CartCreditLineDTO\ntype CartWorkflowDTO = CartTypes.CartWorkflowDTO\ntype UsageComputedActions = PromotionTypes.UsageComputedActions')
    .replace('  EventPriority,\n', '')
    .replace('import {\n  createRemoteLinkStep,\n  emitEventStep,\n  useQueryGraphStep,\n} from "../../common"',
      'import { createRemoteLinkStep } from "../../common/steps/create-remote-links"\n' +
      'import { emitEventStep } from "../../common/steps/emit-event"\n' +
      'import { useQueryGraphStep } from "../../common/steps/use-query-graph"')
    .replace('import {\n  updateCartsStep,\n  validateCartPaymentsStep,\n  validateShippingStep,\n} from "../steps"',
      'import { updateCartsStep } from "../steps/update-carts"\n' +
      'import { validateCartPaymentsStep } from "../steps/validate-cart-payments"\n' +
      'import { validateShippingStep } from "../steps/validate-shipping"')
    .replace(checkoutPreparation(expected).callback, '({ cart }) => prepareCheckoutOrderData(cart)')
    .replace('const THREE_DAYS = 60 * 60 * 24 * 3', 'const THREE_DAYS = 259200')
    .replace('type CartCreditLineDTO = CartTypes.CartCreditLineDTO\ntype CartWorkflowDTO = CartTypes.CartWorkflowDTO\n', '')
    .replace('import type { CartTypes, LinkDefinition, PromotionDTO, PromotionTypes }', 'import type { LinkDefinition, PromotionTypes }')
    .replace('import { EventPriority }', 'import { prepareCheckoutOrderData } from "../utils/prepare-checkout-order-data"\nimport type { CheckoutCartView } from "../../common/steps/checkout-query-views"\nimport { EventPriority }')
    .replace('import type { LinkDefinition, PromotionTypes }', 'import type { WorkflowDefinition, Hook } from "@medusajs/workflows-sdk"\nimport type { LinkDefinition, PromotionTypes }')
    .replace('export const completeCartWorkflow = createWorkflow(', 'export const completeCartWorkflow: WorkflowDefinition<\n  CompleteCartWorkflowInput, WorkflowData<CompleteCartWorkflowOutput>,\n  readonly [Hook<"validate", { input: CompleteCartWorkflowInput; cart: CheckoutCartView }>]\n> = createWorkflow(')
    .replace('import {\n  prepareAdjustmentsData,\n  prepareLineItemData,\n  PrepareLineItemDataInput,\n  prepareTaxLinesData,\n} from "../utils/prepare-line-item-data"\n', '')
    .replace('variantsMap[item.variant_id]', 'variantsMap[item.variant_id!]')
    .replace('({ cart }: { cart: CartWorkflowDTO })', '({ cart }: { cart: CheckoutCartView })')
    .replace('(promotion: PromotionDTO)', '(promotion)')
    .replace('return createdOrders[0]', 'return createdOrders[0]!')
    .replaceAll('paymentSessions[0].id', 'paymentSessions[0]!.id')
    .replaceAll('paymentSessions![0].id', 'paymentSessions![0]!.id')
    .replace('            sales_channel_id,\n            variants,', '            sales_channel_id: sales_channel_id!,\n            variants,')
    .replace('payment_collection_id: cart.payment_collection.id', 'payment_collection_id: cart.payment_collection!.id');
  if (targetPath === prefix + "cart/steps/validate-cart-payments.ts") expected = expected
    .replace('import type { CartWorkflowDTO } from "@medusajs/framework/types"',
      'import type { CheckoutCartView } from "../../common/steps/checkout-query-views"\n' +
      'type CartWorkflowDTO = Pick<CheckoutCartView, "total" | "credit_line_total" | "payment_collection">')
    .replace('MathBN.convert(credit_line_total)', 'MathBN.convert(credit_line_total!)')
    .replace('paymentCollection.payment_sessions', 'paymentCollection!.payment_sessions');
  if (targetPath === prefix + "cart/steps/validate-shipping.ts") expected = expected
    .replace('import {\n  CartLineItemDTO,\n  CartWorkflowDTO,\n  ProductVariantDTO,\n  ShippingOptionDTO,\n} from "@medusajs/framework/types"',
      'import type { ShippingOptionDTO } from "@medusajs/framework/types"\n' +
      'import type { CheckoutCartView } from "../../common/steps/checkout-query-views"\n' +
      'type CartLineItemDTO = CheckoutCartView["items"][number]\ntype CartWorkflowDTO = Pick<CheckoutCartView, "shipping_methods">')
    .replace('items: (CartLineItemDTO & {\n      /**\n       * The item\'s variant.\n       */\n      variant: ProductVariantDTO\n    })[]', 'items: CartLineItemDTO[]')
    .replace('shippingOptions: ShippingOptionDTO[]', 'shippingOptions: Pick<ShippingOptionDTO, "id" | "shipping_profile_id">[]')
    .replace('(item.variant.product as any)', '(item.variant!.product as any)');
  if (targetPath === prefix + "cart/steps/reserve-inventory.ts") expected = expected
    .replace('import type { BigNumberInput }', 'import type { ILockingModule } from "@medusajs/types/locking/index"\nimport type { BigNumberInput, IInventoryService, ReservationItemDTO }')
    .replace('createStep(\n', 'createStep<ReserveVariantInventoryStepInput, ReservationItemDTO[], { reservations: string[]; inventoryItemIds: string[] }>(\n')
    .replace('  reserveInventoryStepId,', '  { name: reserveInventoryStepId, compensation: "transactionCovered" },')
    .replaceAll('container.resolve(Modules.INVENTORY)', 'container.resolve<IInventoryService>(Modules.INVENTORY)')
    .replaceAll('container.resolve(Modules.LOCKING)', 'container.resolve<ILockingModule>(Modules.LOCKING)')
    .replace('line_item_id: item.id,', 'line_item_id: item.id!,')
    .replace('location_id: item.location_ids[0],', 'location_id: item.location_ids[0]!,')
    .replace('id?: string\n', 'id?: string | undefined\n')
    .replace('new StepResponse()', 'new StepResponse(undefined)');
  if (targetPath === prefix + "promotion/steps/register-usage.ts") expected = expected
    .replace('import {\n  CampaignBudgetUsageContext,\n  IPromotionModuleService,\n  UsageComputedActions,\n} from "@medusajs/framework/types"',
      'import type { PromotionTypes } from "@medusajs/framework/types"\n' +
      'type CampaignBudgetUsageContext = PromotionTypes.CampaignBudgetUsageContext\ntype IPromotionModuleService = PromotionTypes.IPromotionModuleService\ntype UsageComputedActions = PromotionTypes.UsageComputedActions')
    .replace('  registerUsageStepId,', '  { name: registerUsageStepId, compensation: "transactionCovered" },');
  if (targetPath === prefix + "order/steps/create-orders.ts") expected =
    'import { decodeCheckoutCreatedOrders } from "../../common/steps/checkout-order-view"\n' +
    'import type { prepareCheckoutOrderData } from "../../cart/utils/prepare-checkout-order-data"\n' + expected
    .replace('export type CreateOrdersStepInput = CreateOrderDTO[]', 'export type CreateOrdersStepInput = (CreateOrderDTO | ReturnType<typeof prepareCheckoutOrderData>)[]')
    .replace("  createOrdersStepId,", '  { name: createOrdersStepId, compensation: "transactionCovered" },')
    .replace('async (data: CreateOrderDTO[],', 'async (data: CreateOrdersStepInput,')
    .replace('const created = await service.createOrders(data)', 'const result: unknown = await Reflect.apply(service.createOrders, service, [data])\n    const created = decodeCheckoutCreatedOrders(result)')
    // The finite host exposes no native shared manager context. The genuine
    // callback therefore receives exactly the native omitted-context behavior.
    .replace("async (createdIds, { container, context })", "async (createdIds, { container })")
    .replace("service.deleteOrders(createdIds, context)", "service.deleteOrders(createdIds)");
  if (targetPath === prefix + "cart/steps/update-carts.ts") expected = expected
    .replace('import {\n  ICartModuleService,\n  UpdateAddressDTO,\n  UpdateCartDTO,\n  UpdateCartWorkflowInputDTO,\n} from "@medusajs/framework/types"',
      'import type { ICartModuleService } from "@medusajs/framework/types"\n' +
      'import type { UpdateAddressDTO } from "@medusajs/types/cart/mutations"\n' +
      'import type { UpdateCartWorkflowInputDTO } from "@medusajs/types/cart/workflows"')
    .replace("  updateCartsStepId,", '  { name: updateCartsStepId, compensation: "transactionCovered" },')
    .replace("const addressesToUpdate: UpdateAddressDTO[] = []", "const addressesToUpdate = []")
    .replace("const dataToUpdate: UpdateCartDTO[] = []", "const dataToUpdate = []")
    .replaceAll("await cartModule.updateAddresses(addressesToUpdate)", "await Reflect.apply(cartModule.updateAddresses, cartModule, [addressesToUpdate])")
    .replace("return await cartModule.updateCarts(dataToUpdate)",
      "const restored: unknown = await Reflect.apply(cartModule.updateCarts, cartModule, [dataToUpdate])\n    return restored");
  if (targetPath === prefix + "cart/workflows/refund-payment-recreate-payment-session.ts") expected = expected
    .replace("  {\n    name: refundPaymentAndRecreatePaymentSessionWorkflowId,\n  },", "  refundPaymentAndRecreatePaymentSessionWorkflowId,")
    .replace("customer_id?: string", "customer_id?: string | undefined")
    .replace("note: input.note,", "note: input.note!,")
    .replace("customer_id: input.customer_id,", "customer_id: input.customer_id!,")
    .replace("data: input.data,", "data: input.data!,");
  if (targetPath === prefix + "cart/steps/compensate-payment-if-needed.ts") expected =
    'import { Result } from "effect"\nimport { decodeCheckoutPaymentSessions, type CheckoutPaymentQueryResource } from "../../common/steps/checkout-payment-query-view"\n' + expected
      .replace("  compensatePaymentIfNeededStepId,", '  { name: compensatePaymentIfNeededStepId, compensation: "transactionCovered", invokedWorkflows: [refundPaymentAndRecreatePaymentSessionWorkflow] },')
      .replace("container.resolve(ContainerRegistrationKeys.QUERY)", "container.resolve<CheckoutPaymentQueryResource>(ContainerRegistrationKeys.QUERY)")
      .replace("const { data: paymentSessions }", "const { data: selectedPaymentSessions }")
      .replace('        "data",', '        "data",\n        "context",')
      .replace('        "payment.customer.id",\n', "")
      .replace("    const paymentSession = paymentSessions[0]", "    const paymentSessions = Result.getOrThrow(decodeCheckoutPaymentSessions(selectedPaymentSessions))\n    const paymentSession = paymentSessions[0]")
      .replace("paymentSession.payment?.customer?.id", "paymentSession.context?.customer?.id");
  return expected;
}
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** @param {string} value */
function forms(value) {
  const parse = (/** @type {string} */ text) => ts.createSourceFile("checkout.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const emitted = ts.transpileModule(value, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
  } });
  if (emitted.diagnostics?.some(issue => issue.category === ts.DiagnosticCategory.Error)) throw new Error("Invalid checkout source syntax");
  return [printer.printFile(parse(value)), printer.printFile(parse(emitted.outputText))];
}
/** @param {string} source @param {string} target @param {string} targetPath */
export function verifyCheckoutSource(source, target, targetPath) {
  const expected = forms(adaptCheckoutSource(source, targetPath)), actual = forms(target);
  if (expected.some((value, index) => value !== actual[index])) throw new Error("Changed native checkout source");
}
/** @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyCheckoutSelection(files) {
  for (const pair of checkoutSourcePairs) {
    if (files.filter(file => file.target === pair.target).length !== 1 ||
      !files.some(file => file.source === pair.source && file.target === pair.target && file.classification === pair.classification))
      throw new Error("Redirected native checkout source");
  }
  for (const file of files) if (checkoutSourcePairs.some(pair => pair.source === file.source) &&
    !checkoutSourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
    throw new Error("Redirected native checkout source");
}
