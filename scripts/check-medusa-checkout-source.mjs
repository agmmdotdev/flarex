// @ts-check
import ts from "@typescript/typescript6";

const prefix = "packages/medusa-core-flows/src/";
export const checkoutSourcePairs = Object.freeze([
  "order/steps/create-orders.ts",
  "cart/workflows/refund-payment-recreate-payment-session.ts",
  "cart/steps/compensate-payment-if-needed.ts",
].map(file => ({ source: "third_party/medusa/upstream/packages/core/core-flows/src/" + file,
  target: prefix + file, classification: "workflowFork" })));

/** Exact finite-host seams only; native business code remains in its owner.
 * @param {string} source @param {string} targetPath */
export function adaptCheckoutSource(source, targetPath) {
  if (!checkoutSourcePairs.some(pair => pair.target === targetPath)) throw new Error("Unknown native checkout source");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('"@medusajs/framework/utils"', '"@medusajs/framework/utils/portable"')
    .replaceAll('"@medusajs/framework/workflows-sdk"', '"@medusajs/workflows-sdk"');
  if (targetPath === prefix + "order/steps/create-orders.ts") expected = expected
    .replace("  createOrdersStepId,", '  { name: createOrdersStepId, compensation: "transactionCovered" },')
    // The finite host exposes no native shared manager context. The genuine
    // callback therefore receives exactly the native omitted-context behavior.
    .replace("async (createdIds, { container, context })", "async (createdIds, { container })")
    .replace("service.deleteOrders(createdIds, context)", "service.deleteOrders(createdIds)");
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
    if (files.filter(file => file.source === pair.source || file.target === pair.target).length !== 1 ||
      !files.some(file => file.source === pair.source && file.target === pair.target && file.classification === pair.classification))
      throw new Error("Redirected native checkout source");
  }
}
