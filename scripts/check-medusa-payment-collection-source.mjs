// @ts-check
import { extendNativeCartCreationSource } from "./check-medusa-cart-creation-source.mjs";
import ts from "@typescript/typescript6";

const native = "third_party/medusa/upstream/";
const workflowFiles = ["cart/workflows/create-payment-collection-for-cart.ts", "cart/workflows/refresh-payment-collection.ts",
  "cart/steps/create-payment-collection.ts", "cart/steps/validate-cart.ts", "payment-collection/workflows/cancel-payment-collection.ts",
  "payment-collection/steps/update-payment-collection.ts", "payment-collection/steps/cancel-payment.ts", "order/workflows/create-order-payment-collection.ts",
  "locking/steps/acquire-lock.ts", "locking/steps/release-lock.ts"];
export const paymentCollectionSourcePairs = Object.freeze(workflowFiles.map(file => Object.freeze({
  source: native + "packages/core/core-flows/src/" + file, target: "packages/medusa-core-flows/src/" + file,
  classification: "paymentCollectionWorkflowFork",
})));
/** @param {readonly { source?: string, target: string, classification: string }[]} files */
export function verifyPaymentCollectionSelection(files) {
  for (const pair of paymentCollectionSourcePairs) {
    const selected = files.filter(file => file.target === pair.target);
    if (selected.length !== 1 || selected[0]?.source !== pair.source || selected[0]?.classification !== pair.classification)
      throw new Error("Missing or changed native payment collection selection: " + pair.target);
  }
}
/** @param {string} text */
const parse = text => ts.createSourceFile("native-collection.ts", text.replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
/** @param {string} text */
const program = text => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard,
    ts.createPrinter({ removeComments: true }).printFile(parse(text)));
  const tokens = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push([token, scanner.getTokenText()]);
  return JSON.stringify(tokens);
};
/** @param {string} expected @param {string} target */
function equal(expected, target) {
  if (program(expected) !== program(target)) throw new Error("Unapproved native payment collection change");
}
/** Exact native bodies; only imports, finite compensation declarations and
 * selected-view type adaptations change. Unchecked native indexes retain their
 * original runtime behavior; the views never assert a full module DTO.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyPaymentCollectionSource(source, target, targetPath) {
  const prefix = "packages/medusa-core-flows/src/", file = targetPath.slice(prefix.length);
  if (!targetPath.startsWith(prefix) || !workflowFiles.includes(file)) throw new Error("Unselected native collection source");
  let expected = source.replaceAll("\r\n", "\n").replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"')
    .replaceAll('"@medusajs/framework/workflows-sdk"', '"@medusajs/workflows-sdk"')
    .replaceAll('from "../../common"', 'from "../../common/steps/use-query-graph"')
    .replaceAll('from "../../locking"', 'from "../../locking/steps"')
    .replaceAll('from "../../payment-collection"', 'from "../../payment-collection/steps/update-payment-collection"')
    .replaceAll('from "../steps"', 'from "../steps/validate-cart"').replaceAll('from "../../cart"', 'from "../../cart/steps/create-payment-collection"');
  if (file.startsWith("cart/workflows/")) expected = expected.replace('import { acquireLockStep, releaseLockStep } from "../../locking/steps"',
    'import { acquireLockStep } from "../../locking/steps/acquire-lock"\nimport { releaseLockStep } from "../../locking/steps/release-lock"');
  if (file === "cart/workflows/create-payment-collection-for-cart.ts") expected =
    'import type { CreatePaymentCollectionForCartWorkflowInputDTO } from "@medusajs/types/cart/workflows"\n' + expected
      .replace("  CreatePaymentCollectionForCartWorkflowInputDTO,\n", "")
      .replace('cart: CartDTO & { payment_collection?: any }', 'cart: Pick<CartDTO, "id"> & { payment_collection?: { id: string } | null }')
      .replaceAll("data.created[0].id", "data.created[0]!.id").replace("new WorkflowResponse(created[0])", "new WorkflowResponse(created[0]!)");
  if (file === "cart/workflows/refresh-payment-collection.ts") expected =
    'import type { CartDTO } from "@medusajs/types"\nimport type { CartCollectionRefreshView } from "../../common/steps/payment-collection-query-views"\nimport type { WorkflowDefinition, Hook } from "@medusajs/workflows-sdk"\n' + expected
      .replace('export const refreshPaymentCollectionForCartWorkflow = createWorkflow(', 'export const refreshPaymentCollectionForCartWorkflow: WorkflowDefinition<\n  RefreshPaymentCollectionForCartWorklowInput, undefined,\n  readonly [Hook<"validate", { input: RefreshPaymentCollectionForCartWorklowInput; cart: NonNullable<RefreshPaymentCollectionForCartWorklowInput["cart"]> }>]\n> = createWorkflow(')
      .replace("cart?: any", "cart?: typeof CartCollectionRefreshView.Type | (CartDTO & { payment_collection?: undefined })").replace("return fetchCart ?? input.cart", "return (fetchCart ?? input.cart)!")
      .replace("filters: { id: cartId }", "filters: { id: cartId! }")
      .replace("return input.cart_id ?? input.cart?.id", "return (input.cart_id ?? input.cart?.id)!")
      .replace("selector: { id: cart.payment_collection.id }", "selector: { id: cart.payment_collection!.id }")
      .replace("cart.payment_collection.currency_code", "cart.payment_collection!.currency_code");
  if (file === "cart/steps/validate-cart.ts") expected = expected.replace('import type { CartDTO, CartWorkflowDTO }', 'import type { CartDTO }')
    .replace('cart: CartWorkflowDTO | CartDTO', 'cart: Pick<CartDTO, "id"> & { completed_at?: CartDTO["completed_at"] | string | null }');
  if (file === "order/workflows/create-order-payment-collection.ts") expected = expected
    .replace('import { createRemoteLinkStep, useQueryGraphStep } from "../../common/steps/use-query-graph"',
      'import { createRemoteLinkStep } from "../../common/steps/create-remote-links"\nimport { useQueryGraphStep } from "../../common/steps/use-query-graph"')
    .replace("createdPaymentCollections[0].id", "createdPaymentCollections[0]!.id");
  if (file === "payment-collection/workflows/cancel-payment-collection.ts") expected =
    'import type { CollectionCancellationView } from "../../common/steps/payment-collection-query-views"\n' + expected
      .replace("input: { paymentCollection: PaymentCollectionDTO }", "input: { paymentCollection: typeof CollectionCancellationView.Type }")
      .replace("paymentCollection.captured_amount > 0", "paymentCollection.captured_amount! > 0")
      .replace("paymentCollectionQuery.data[0]", "paymentCollectionQuery.data[0]!").replace("updatedPaymentCollections[0]", "updatedPaymentCollections[0]!");
  const compensated = file === "cart/steps/create-payment-collection.ts" ? "createPaymentCollectionsStepId"
    : file === "payment-collection/steps/update-payment-collection.ts" ? "updatePaymentCollectionStepId"
      : file === "locking/steps/acquire-lock.ts" ? "acquireLockStepId" : undefined;
  if (compensated !== undefined) expected = expected.replace("  " + compensated + ",\n", '  { name: ' + compensated + ', compensation: "transactionCovered" },\n');
  if (file === "payment-collection/steps/update-payment-collection.ts") expected = expected
    .replace("getSelectsAndRelationsFromObjectArray([\n      data.update,\n    ])", 'getSelectsAndRelationsFromObjectArray([\n      data.update,\n    ], { objectFields: ["amount"] })')
    .replace("amount: pc.amount,", 'amount: pc.amount === undefined ? undefined : ("raw_amount" in pc ? pc.raw_amount : undefined) ?? pc.amount,')
    .replace("async (data: UpdatePaymentCollectionStepInput,", "async (data: UpdatePaymentCollectionStepInput | undefined,")
    .replace("if (!isPresent(data) || !isPresent(data.selector))", "if (data === undefined || !isPresent(data) || !isPresent(data.selector))")
    .replace("await paymentModuleService.upsertPaymentCollections(\n      prevData.map((pc) => ({", "await Reflect.apply(paymentModuleService.upsertPaymentCollections, paymentModuleService, [\n      prevData.map((pc) => ({")
    .replace(/(metadata: pc.metadata,\s*\}\)\))\s*\)/, "$1\n    ])");
  if (file.startsWith("locking/steps/")) expected = expected
    .replaceAll("return StepResponse.skip() as any", "return StepResponse.skip()")
    .replaceAll("container.resolve(Modules.LOCKING)", "container.resolve<ILockingModule>(Modules.LOCKING)");
  if (file === "locking/steps/acquire-lock.ts") expected = expected.replace('import { setTimeout } from "timers/promises"',
    'import { sleep as setTimeout } from "@medusajs/orchestration/transaction/utils/sleep"\nimport type { ILockingModule } from "@medusajs/types/locking/index"')
    .replace("createStep(\n", "createStep<AcquireLockStepInput, undefined, { keys: string[]; ownerId: string | undefined; provider: string | undefined } | undefined>(\n")
    .replace("new StepResponse(void 0)", "new StepResponse<undefined, { keys: string[]; ownerId: string | undefined; provider: string | undefined } | undefined>(void 0)")
    .replace("async (data: any,", "async (data: { keys: string[]; ownerId: string | undefined; provider: string | undefined } | undefined,")
    .replace("await locking.acquire(data.key, {", "await Reflect.apply(locking.acquire, locking, [data.key, {")
    .replace(/(provider: data.provider,\s*)\}\)/g, "$1}])")
    .replace("await locking.release(data.keys, {", "await Reflect.apply(locking.release, locking, [data.keys, {")
    .replace("new StepResponse()", "new StepResponse(undefined)");
  if (file === "locking/steps/release-lock.ts") expected = expected
    .replace('import { createStep, StepResponse } from "@medusajs/workflows-sdk"', 'import { createStep, StepResponse } from "@medusajs/workflows-sdk"\nimport type { ILockingModule } from "@medusajs/types/locking/index"')
    .replace("await locking.release(keys, {", "await Reflect.apply(locking.release, locking, [keys, {")
    .replace(/(provider: data.provider,\s*)\}\)/g, "$1}])");
  equal(expected, target);
}

/** Derive the required public fields from the pinned calculation owner's type.
 * Optional detail totals are a separate capability. @param {string} source */
export function nativeLineItemTotalsFieldNames(source) {
  const ast = parse(source), declarations = ast.statements.filter(node => ts.isInterfaceDeclaration(node) && node.name.text === "GetItemTotalOutput");
  const declaration = declarations[0];
  if (declarations.length !== 1 || declaration === undefined || !ts.isInterfaceDeclaration(declaration)) throw new Error("Missing native Line Item totals contract");
  const fields = declaration.members.filter(node => ts.isPropertySignature(node) && node.questionToken === undefined).map(node => {
    if (!ts.isPropertySignature(node) || !ts.isIdentifier(node.name) || node.type?.getText(ast) !== "BigNumber") throw new Error("Changed native Line Item total field");
    return node.name.text;
  });
  if (fields.length === 0 || new Set(fields).size !== fields.length) throw new Error("Changed native Line Item total fields");
  return fields;
}
/** @param {string} source @param {string} target @param {string} helper @param {string} itemTotalsSource */
export function verifyCartPaymentTotalsSource(source, target, helper, itemTotalsSource) {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"');
  const ast = parse(normalized), declaration = ast.statements.find(ts.isClassDeclaration);
  if (declaration === undefined) throw new Error("Missing native Cart class");
  /** @param {string} name */
  const method = name => declaration.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(ast) === name);
  const include = method("shouldIncludeTotals"), add = method("addRelationsToCalculateTotals");
  if (include === undefined || add === undefined || !ts.isMethodDeclaration(include) || !ts.isMethodDeclaration(add) || !include.body || !add.body)
    throw new Error("Missing native Cart totals selection");
  const totalsStatement = include.body.statements[0];
  const totals = totalsStatement !== undefined && ts.isVariableStatement(totalsStatement) ? totalsStatement.declarationList.declarations[0] : undefined;
  if (totals?.name.getText(ast) !== "totalFields" || totals.initializer === undefined || !ts.isArrayLiteralExpression(totals.initializer))
    throw new Error("Missing native Cart totals field array");
  const helperExpected = 'import type { FindConfig } from "@medusajs/framework/types"\nimport { deduplicate } from "@medusajs/framework/utils/portable"\n' +
    'export function cartTotalsFields(): string[] { return ' + totals.initializer.getText(ast) + ' }\n' +
    'export function includeCartTotals(config: FindConfig<Record<string, unknown>>): boolean ' + include.body.getText(ast)
      .replace(totals.getText(ast), "totalFields = cartTotalsFields()")
      .replace("this.addRelationsToCalculateTotals(config, totalFields)", "addRelationsToCalculateTotals(config, totalFields)") +
    '\nfunction addRelationsToCalculateTotals(config: FindConfig<Record<string, unknown>>, totalFields: string[]) ' + add.body.getText(ast);
  equal(helperExpected + "\nexport function lineItemTotalsFields(): readonly string[] { return " +
    JSON.stringify(nativeLineItemTotalsFieldNames(itemTotalsSource)) + " }\n", helper);
  let expected = normalized.slice(0, add.getStart(ast)) + normalized.slice(add.end);
  expected = expected.slice(0, include.body.getStart(ast)) + "{ return includeCartTotals(config) }" + expected.slice(include.body.end);
  expected = 'import { includeCartTotals } from "../utils/totals-selection"\n' + expected.replace("  deduplicate,\n", "");
  expected = expected.replace(/(protected async updateCarts_\([\s\S]*?\n  \)) \{/, "$1: Promise<InferEntityType<typeof Cart>[]> {");
  equal(extendNativeCartCreationSource(expected), target);
}
