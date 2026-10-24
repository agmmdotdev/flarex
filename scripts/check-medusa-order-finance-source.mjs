// @ts-check
import ts from "@typescript/typescript6";

const failure = "Changed native Order finance extraction";
const sourcePath = "third_party/medusa/upstream/packages/modules/order/src/services/order-module-service.ts";
const targetPath = "packages/medusa-order/src/services/order-module-service.ts";
export const orderFinanceHelperTargets = Object.freeze([
  "packages/medusa-order/src/utils/payment-accounting.ts", "packages/medusa-order/src/utils/totals-selection.ts",
  "packages/medusa-order/src/utils/preview-details.ts",
]);
/** @param {string} text */
const parse = text => ts.createSourceFile("order.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** @param {string} text */
function forms(text) {
  const emitted = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    experimentalDecorators: true, emitDecoratorMetadata: true,
  } });
  if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure + ": syntax");
  return [printer.printFile(parse(text)), printer.printFile(parse(emitted.outputText))];
}
/** @param {string} expected @param {string} actual */
function equal(expected, actual) {
  const left = forms(expected), right = forms(actual);
  if (left[0] !== right[0] || left[1] !== right[1]) throw new Error(failure);
}
/** @param {string} text @param {string} name */
function method(text, name) {
  const file = parse(text), owner = file.statements.filter(ts.isClassDeclaration).find(node => node.name?.text === "OrderModuleService");
  const candidates = owner?.members.filter(ts.isMethodDeclaration).filter(node => ts.isIdentifier(node.name) && node.name.text === name) ?? [];
  if (candidates.length !== 1 || candidates[0]?.body === undefined) throw new Error(failure + ": method " + name);
  return { file, node: candidates[0], body: candidates[0].body };
}
/** @param {string} text @param {string} before @param {string} after */
function replace(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(failure + ": extraction anchor");
  return text.replace(before, after);
}

const accountingHeader = `import type { BigNumberInput } from "@medusajs/framework/types"
import { BigNumber, createRawPropertiesFromBigNumber, MathBN, transformPropertiesToBigNumber, } from "@medusajs/framework/utils/portable"
type PaymentSummary = { order_id: string; totals: Record<"paid_total" | "refunded_total" | "transaction_total" | "pending_difference", BigNumberInput> }
type PaymentTransaction = { order_id: string; version: number; amount: BigNumberInput }
export function updateOrderPaymentSummaries(summaries: PaymentSummary[], transactionData: PaymentTransaction[], isRemoved: boolean) `;
const previewHeader = `import type { Context, IOrderModuleService } from "@medusajs/framework/types"
import { isDefined } from "@medusajs/framework/utils/portable"
type PreviewReads = Pick<IOrderModuleService, "listOrderLineItems" | "listOrderShippingMethods">
export async function includeOrderPreviewDetails(reads: PreviewReads, order, itemsToUpsert, shippingMethodsToUpsert, lineItemAdjustmentsToCreate, sharedContext: Context = {}) `;
/** Whole-module comparison includes both types/import closure and execution.
 * @param {string} original @param {string} accounting @param {string} totals @param {string} preview */
export function verifyOrderFinanceHelpers(original, accounting, totals, preview) {
  const arithmetic = method(original, "updateOrderPaidRefundableAmount_");
  if (arithmetic.body.statements.length !== 4) throw new Error(failure + ": accounting layout");
  equal(accountingHeader + "{\n" + arithmetic.body.statements.slice(1, 3).map(node => node.getText(arithmetic.file)).join("\n") + "\n}", accounting);
  const selection = method(original, "shouldIncludeTotals"), relations = method(original, "addRelationsToCalculateTotals");
  const selectionBody = replace(selection.body.getText(selection.file), "this.addRelationsToCalculateTotals(config, totalFields)", "addOrderRelationsForTotals(config, totalFields)");
  equal(`import type { FindConfig } from "@medusajs/framework/types"
import { deduplicate } from "@medusajs/framework/utils/portable"
export function includeOrderTotals(config: FindConfig<Record<string, unknown>>): boolean ${selectionBody}
function addOrderRelationsForTotals(config: FindConfig<Record<string, unknown>>, totalFields: readonly string[]) ${relations.body.getText(relations.file)}`, totals);
  const details = method(original, "includeTaxLinesAndAdjustmentsToPreview");
  const detailBody = replace(replace(details.body.getText(details.file), "this.listOrderLineItems(", "reads.listOrderLineItems("),
    "this.listOrderShippingMethods(", "reads.listOrderShippingMethods(");
  equal(previewHeader + detailBody, preview);
}

/** Apply after the independently owned cancellation correction. The native
 * orchestration, database calls, clock, events and version selection remain.
 * @param {string} correctedSource */
export function adaptOrderFinanceSource(correctedSource) {
  let expected = correctedSource.replaceAll("\r\n", "\n");
  const details = method(expected, "includeTaxLinesAndAdjustmentsToPreview");
  expected = expected.slice(0, details.body.getStart(details.file)) +
    "{ return includeOrderPreviewDetails(this, order, itemsToUpsert, shippingMethodsToUpsert, lineItemAdjustmentsToCreate, sharedContext) }" + expected.slice(details.body.end);
  for (const name of ["shouldIncludeTotals", "addRelationsToCalculateTotals"]) {
    const selected = method(expected, name);
    expected = expected.slice(0, selected.node.getFullStart()) + expected.slice(selected.node.end);
  }
  const selected = method(expected, "updateOrderPaidRefundableAmount_");
  const block = selected.body.statements;
  if (block.length !== 4 || block[1] === undefined || block[2] === undefined) throw new Error(failure + ": accounting layout");
  expected = expected.slice(0, block[1].getStart(selected.file)) + "updateOrderPaymentSummaries(summaries, transactionData, isRemoved)" + expected.slice(block[2].end);
  if (expected.split("this.shouldIncludeTotals(config)").length !== 13) throw new Error(failure + ": total-selection callers");
  expected = expected.replaceAll("this.shouldIncludeTotals(config)", "includeOrderTotals(config)");
  expected = replace(expected, "  transformPropertiesToBigNumber,\n", "");
  expected = replace(expected, "  isDefined,\n", "");
  expected = replace(expected, 'import * as BundledActions from "./actions"',
    'import { updateOrderPaymentSummaries } from "../utils/payment-accounting"\nimport { includeOrderTotals } from "../utils/totals-selection"\nimport { includeOrderPreviewDetails } from "../utils/preview-details"\nimport * as BundledActions from "./actions"');
  return expected;
}

/** The composition owner supplies its independently verified prefix.
 * @param {string} original @param {string} correctedSource @param {string} actual @param {string} accounting @param {string} totals @param {string} preview */
export function verifyOrderFinanceSource(original, correctedSource, actual, accounting, totals, preview) {
  verifyOrderFinanceHelpers(original, accounting, totals, preview);
  equal(adaptOrderFinanceSource(correctedSource), actual);
}

/** The class retains the cancellation owner's one source-pair record.
 * @param {readonly {source?: string, target: string, classification: string}[]} files */
export function verifyOrderFinanceSelection(files) {
  if (files.filter(file => file.source === sourcePath && file.target === targetPath && file.classification === "orderChangeCancellationRestoreFork").length !== 1) throw new Error(failure + ": native class identity");
  for (const target of orderFinanceHelperTargets) {
    const selected = files.filter(file => file.target === target);
    if (selected.length !== 1 || selected[0]?.source !== undefined || selected[0]?.classification !== "authored") throw new Error(failure + ": native helper ownership");
  }
}
