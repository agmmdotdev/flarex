// @ts-check
import ts from "@typescript/typescript6";

const native = "third_party/medusa/upstream/";
export const paymentLifecycleSourcePairs = Object.freeze([
  ...["authorize-payment-session", "capture-payment", "refund-payment", "refund-payments"].map(name => ({
    source: native + "packages/core/core-flows/src/payment/steps/" + name + ".ts",
    target: "packages/medusa-core-flows/src/payment/steps/" + name + ".ts", classification: "paymentLifecycleFork",
  })),
  ...["payment/workflows/capture-payment.ts", "payment/workflows/refund-payment.ts", "payment/workflows/refund-payments.ts",
    "order/steps/add-order-transaction.ts", "order/steps/create-order-change.ts", "order/steps/confirm-order-changes.ts",
    "order/workflows/create-order-change-actions.ts", "order/workflows/payments/create-order-refund-credit-lines.ts",
    "common/steps/create-entities.ts"].map(relative => ({ source: native + "packages/core/core-flows/src/" + relative,
      target: "packages/medusa-core-flows/src/" + relative, classification: "paymentLifecycleFork" })),
  { source: native + "packages/core/core-flows/src/order/utils/order-validation.ts",
    target: "packages/medusa-core-flows/src/order/utils/order-refund-validation.ts", classification: "orderRefundValidationFork" },
  { source: native + "packages/modules/link-modules/src/definitions/order-payment-collection.ts",
    target: "packages/medusa-link-modules/src/definitions/order-payment-collection.ts", classification: "importRelocation" },
  { source: native + "packages/modules/payment/src/services/payment-module.ts",
    target: "packages/medusa-payment/src/services/payment-module.ts", classification: "paymentAccountingFork" },
]);
const failure = "Changed native Payment lifecycle source";
export const paymentAccountingAuthoredTargets = Object.freeze(["packages/medusa-payment/src/utils/accounting.ts"]);
/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyPaymentLifecycleSelection(files) {
  for (const pair of paymentLifecycleSourcePairs) if (files.filter(file => file.source === pair.source &&
    file.target === pair.target && file.classification === pair.classification).length !== 1)
    throw new Error(failure + ": exact source pair " + pair.target);
  for (const file of files) {
    if (paymentAccountingAuthoredTargets.includes(file.target)) {
      if (file.source !== undefined || file.classification !== "authored") throw new Error(failure + ": accounting helper ownership");
      continue;
    }
    if (["paymentLifecycleFork", "paymentAccountingFork", "orderRefundValidationFork"].includes(file.classification) ||
      paymentLifecycleSourcePairs.some(pair => pair.source === file.source || pair.target === file.target)) {
      if (!paymentLifecycleSourcePairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
        throw new Error(failure + ": redirected source");
    }
  }
  for (const target of paymentAccountingAuthoredTargets) if (files.filter(file => file.target === target).length !== 1)
    throw new Error(failure + ": accounting helper selection");
}
/** @param {string} text */
function parse(text) { return ts.createSourceFile("payment.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS); }
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** Both typed and executable forms participate; comments grant no authority.
 * @param {string} text */
function program(text) {
  const output = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
    newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
  } });
  if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error(failure + ": syntax");
  return [printer.printFile(parse(text)), printer.printFile(parse(output.outputText))];
}
/** @param {string} expected @param {string} actual */
function equal(expected, actual) {
  const left = program(expected), right = program(actual);
  if (left[0] !== right[0] || left[1] !== right[1]) throw new Error(failure);
}
/** @param {string} source @param {string} target @param {string} targetPath */
export function verifyPaymentLifecycleSource(source, target, targetPath) {
  if (!paymentLifecycleSourcePairs.some(pair => pair.target === targetPath && pair.classification === "paymentLifecycleFork"))
    throw new Error(failure + ": unknown pair");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replaceAll('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  if (targetPath.endsWith("authorize-payment-session.ts")) expected = expected.replace("createStep(\n  authorizePaymentSessionStepId,",
    'createStep(\n  { name: authorizePaymentSessionStepId, compensation: "transactionCovered" },');
  for (const [suffix, step] of [["order/steps/add-order-transaction.ts", "addOrderTransactionStepId"],
    ["order/steps/create-order-change.ts", "createOrderChangeStepId"], ["order/steps/confirm-order-changes.ts", '"confirm-order-changes"'],
    ["common/steps/create-entities.ts", "createEntitiesStepId"]]) if (targetPath.endsWith(suffix))
    expected = expected.replace("createStep(\n  " + step + ",", 'createStep(\n  { name: ' + step + ', compensation: "transactionCovered" },');
  expected = expected.replace('import { emitEventStep, useRemoteQueryStep } from "../../common"',
    'import { emitEventStep } from "../../common/steps/emit-event"\nimport { useRemoteQueryStep } from "../../common/steps/use-remote-query"')
    .replace('import { useQueryGraphStep } from "../../common"', 'import { useQueryGraphStep } from "../../common/steps/use-query-graph"')
    .replace('import { useQueryGraphStep } from "../../../common"', 'import { useQueryGraphStep } from "../../../common/steps/use-query-graph"')
    .replace('from "../../utils/order-validation"', 'from "../../utils/order-refund-validation"');
  if (targetPath.endsWith("order/steps/add-order-transaction.ts")) expected = expected
    .replace('import type { CreateOrderTransactionDTO }', 'import type { CreateOrderTransactionDTO, IOrderModuleService }')
    .replaceAll('container.resolve(Modules.ORDER)', 'container.resolve<IOrderModuleService>(Modules.ORDER)');
  if (targetPath.endsWith("payment/steps/capture-payment.ts")) expected = expected
    .replace('  IPaymentModuleService,', '  IPaymentModuleService,\n  PaymentDTO,')
    .replace('import { StepResponse, createStep } from "@medusajs/workflows-sdk"',
      'import { StepResponse, createStep, WorkflowDefinitionError } from "@medusajs/workflows-sdk"\n' +
      'const hasCaptureRelations = (payment: PaymentDTO): payment is PaymentDTO & { captures: NonNullable<PaymentDTO["captures"]> } => Array.isArray(payment.captures)')
    .replace('const payment = await paymentModule.capturePayment(input)',
      'const payment = await paymentModule.capturePayment(input)\n' +
      'if (!hasCaptureRelations(payment)) { throw new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Native capture omitted its captures relation" }) }');
  if (targetPath.endsWith("payment/workflows/capture-payment.ts")) expected = expected.replace(
    'order_id: orderPayment.order.id,', 'order_id: orderPayment!.order!.id,');
  if (targetPath.endsWith("payment/steps/refund-payment.ts")) expected = expected
    .replace('  IPaymentModuleService,', '  IPaymentModuleService,\n  PaymentDTO,')
    .replace('import { createStep, StepResponse } from "@medusajs/workflows-sdk"',
      'import { createStep, StepResponse, WorkflowDefinitionError } from "@medusajs/workflows-sdk"\n' +
      'const hasRefundRelations = (payment: PaymentDTO): payment is PaymentDTO & { refunds: NonNullable<PaymentDTO["refunds"]> } => Array.isArray(payment.refunds)')
    .replace('const payment = await paymentModule.refundPayment(input)',
      'const payment = await paymentModule.refundPayment(input)\n' +
      'if (!hasRefundRelations(payment)) { throw new WorkflowDefinitionError({ reason: "invalidDefinition", detail: "Native refund omitted its refunds relation" }) }');
  if (targetPath.endsWith("payment/workflows/refund-payment.ts")) expected = expected
    .replace('import { BigNumberInput, PaymentDTO } from "@medusajs/framework/types"',
      'import { BigNumberInput } from "@medusajs/framework/types"\nimport type { RefundPaymentQueryView } from "../../common/steps/use-remote-query"')
    .replace('payment: PaymentDTO\n', 'payment: Pick<RefundPaymentQueryView, "captures" | "refunds">\n')
    .replace('variables: { id: input.refund_reason_id },', 'variables: { id: input.refund_reason_id! },')
    .replaceAll('orderPaymentCollection.order.id', 'orderPaymentCollection!.order!.id');
  if (targetPath.endsWith("order/steps/confirm-order-changes.ts")) expected = expected
    .replace('import type { OrderChangeDTO }', 'import type { OrderChangeDTO, IOrderModuleService }')
    .replace('changes: OrderChangeDTO[]', 'changes: Pick<OrderChangeDTO, "id" | "status">[]')
    .replace('import { createStep, StepResponse } from "@medusajs/workflows-sdk"',
      'import { createStep, StepResponse } from "@medusajs/workflows-sdk"\n' + "type ConfirmationUpdate = { id: OrderChangeDTO[\"id\"]; confirmed_by?: string | undefined }\ntype CurrentChange = ConfirmationUpdate & Pick<OrderChangeDTO, \"order_id\" | \"status\">\ntype ConfirmationPorts = {\n  confirmOrderChange(data: ConfirmationUpdate[]): ReturnType<IOrderModuleService[\"confirmOrderChange\"]>\n  undoLastChange(orderId: string, previous?: CurrentChange): ReturnType<IOrderModuleService[\"undoLastChange\"]>\n}")
    .replace('const currentChanges: Partial<OrderChangeDTO>[] = []', 'const currentChanges: CurrentChange[] = []')
    .replaceAll('container.resolve(Modules.ORDER)', 'container.resolve<ConfirmationPorts>(Modules.ORDER)')
    .replace('currentChanges[0].order_id!', 'currentChanges[0]!.order_id');
  if (targetPath.endsWith("order/steps/create-order-change.ts")) expected = expected
    .replace("  IOrderModuleService,", "  IOrderModuleService,\n  OrderChangeDTO,")
    .replace('export const createOrderChangeStepId', "type CreateOrderChangeStepInput = Omit<CreateOrderChangeDTO, \"created_by\"> & {\n  created_by?: CreateOrderChangeDTO[\"created_by\"] | undefined\n}\ntype CreateOrderChangePorts = Pick<IOrderModuleService, \"deleteOrderChanges\"> & {\n  createOrderChange(data: CreateOrderChangeStepInput): Promise<OrderChangeDTO>\n}\n\nexport const createOrderChangeStepId")
    .replace('async (data: CreateOrderChangeDTO,', 'async (data: CreateOrderChangeStepInput,')
    .replaceAll('container.resolve<IOrderModuleService>', 'container.resolve<CreateOrderChangePorts>');
  if (targetPath.endsWith("order/workflows/create-order-change-actions.ts")) expected = expected
    .replace('export const createOrderChangeActionsWorkflowId', "type CreateOrderChangeActionInput = Omit<CreateOrderChangeActionDTO, \"reference_id\"> & {\n  reference_id?: CreateOrderChangeActionDTO[\"reference_id\"] | undefined\n}\n\nexport const createOrderChangeActionsWorkflowId")
    .replace('input: WorkflowData<CreateOrderChangeActionDTO[]>', 'input: WorkflowData<CreateOrderChangeActionInput[]>');
  if (targetPath.endsWith("order/workflows/payments/create-order-refund-credit-lines.ts")) expected = expected
    .replace('order: OrderDTO', 'order: Pick<OrderDTO, "id" | "status">')
    .replace('reference?: string\n', 'reference?: string | undefined\n')
    .replace('referenceId?: string\n', 'referenceId?: string | undefined\n')
    .replace('created_by?: string\n', 'created_by?: string | undefined\n')
    .replace('orderQuery.data[0]', 'orderQuery.data[0]!')
    .replace('orderChangeQuery.data[0]', 'orderChangeQuery.data[0]!');
  if (targetPath.endsWith("payment/workflows/refund-payments.ts")) expected = expected
    .replace('payments: PaymentDTO[]', 'payments: readonly (Pick<PaymentDTO, "id"> & {\n' +
      'captures?: readonly Pick<NonNullable<PaymentDTO["captures"]>[number], "amount">[]\n' +
      'refunds?: readonly Pick<NonNullable<PaymentDTO["refunds"]>[number], "amount">[]\n})[]')
    .replace('const paymentsMap: Record<\n          string,\n          PaymentDTO & {\n' +
      '            payment_collection: { order: { id: string; currency_code: string } }\n          }\n        > = {}',
      'const paymentsMap: Record<string, (typeof payments)[number]> = {}');
  // Explicitly approved native business correction: per-Refund accounting
  // replaces the pinned Payment-level reference; all other source stays exact.
  if (targetPath.endsWith("payment/workflows/refund-payments.ts")) {
    expected = expected.replace("BigNumberInput, PaymentDTO", "BigNumberInput, CreateOrderTransactionDTO, PaymentDTO")
      .replace("isDefined, MathBN", "MathBN");
    const start = expected.indexOf("    const orderTransactionData = transform("),
      end = expected.indexOf("    addOrderTransactionStep(orderTransactionData)", start);
    if (start < 0 || end < 0) throw new Error(failure + ": native refund transaction boundary");
    expected = expected.slice(0, start) + "    const orderTransactionData = transform(\n      { payments, refundedPayments },\n      ({ payments, refundedPayments }) => {\n        const paymentsMap = new Map(payments.map((payment) => [payment.id, payment]))\n        const transactions: CreateOrderTransactionDTO[] = []\n        const seen = new Set<string>()\n\n        for (const payment of refundedPayments) {\n          const previous = paymentsMap.get(payment.id)\n          const order = previous?.payment_collection?.order\n          if (!previous || !order) {\n            continue\n          }\n          const previousRefunds = new Set(previous.refunds.map((refund) => refund.id))\n          for (const refund of payment.refunds ?? []) {\n            if (previousRefunds.has(refund.id) || seen.has(refund.id)) {\n              continue\n            }\n            seen.add(refund.id)\n            transactions.push({\n              order_id: order.id,\n              amount: MathBN.mult(refund.raw_amount ?? refund.amount, -1),\n              currency_code: previous.currency_code,\n              reference_id: refund.id,\n              reference: \"refund\",\n            })\n          }\n        }\n        return transactions\n      }\n    )\n\n" + expected.slice(end);
  }
  equal(expected, target);
}

/** One unchanged native function, with only its actual imports selected.
 * @param {string} source @param {string} target */
export function verifyOrderRefundValidationSource(source, target) {
  const file = parse(source), declarations = file.statements.filter(statement => ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "throwIfOrderIsCancelled");
  if (declarations.length !== 1) throw new Error(failure + ": native validation selection");
  equal('import type { OrderDTO } from "@medusajs/framework/types"\n' +
    'import { MedusaError, OrderStatus } from "@medusajs/framework/utils/portable"\n' +
    declarations[0].getText(file).replace('order: OrderDTO', 'order: Pick<OrderDTO, "id" | "status">'), target);
}

/** @param {string} source */
function nativeMethods(source) {
  const file = parse(source), result = new Map();
  /** @param {import("@typescript/typescript6").Node} node */
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.body !== undefined) result.set(node.name.getText(file), node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  /** @param {string} name */
  const method = name => {
    const node = result.get(name);
    if (node?.body === undefined) throw new Error(failure + ": missing native method " + name);
    return node;
  };
  return { file, method };
}

/** Exact extraction of four native decision bodies. Remaining native service
 * statements, reads, providers, catches, event decorators and inverses retain
 * their complete programs. Rounding keeps protected-method dispatch.
 * @param {string} source @param {string} target @param {string} helper */
export function verifyPaymentAccountingSource(source, target, helper) {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll('from "@medusajs/framework/utils"',
    'from "@medusajs/framework/utils/portable"');
  const { file, method } = nativeMethods(normalized);
  const rounding = method("roundToCurrencyPrecision"), capture = method("capturePayment_"),
    refund = method("refundPayment_"), collection = method("maybeUpdatePaymentCollection_");
  /** @param {import("@typescript/typescript6").MethodDeclaration} node */
  const body = node => {
    if (node.body === undefined) throw new Error(failure + ": missing body");
    return node.body.statements.map(statement => statement.getText(file));
  };
  const cap = body(capture), ref = body(refund), col = body(collection);
  const capIndex = cap.findIndex(statement => statement.startsWith("const capture =")),
    refIndex = ref.findIndex(statement => statement.startsWith("const refund ="));
  if (capIndex < 1 || refIndex < 1 || col.length < 3) throw new Error(failure + ": extraction anchors");
  const helperBodies = new Map([
    ["roundToCurrencyPrecision", body(rounding).join("\n")],
    ["validatePaymentCapture", cap.slice(0, capIndex).join("\n").replaceAll("this.roundToCurrencyPrecision", "round") + "\nreturn { isFullyCaptured }"],
    ["validatePaymentRefund", ref.slice(0, refIndex).join("\n")],
    ["paymentCollectionUpdate", col.slice(1, -1).join("\n").replaceAll("this.roundToCurrencyPrecision", "round")
      .replace("completedAt = new Date()", "completedAt = now()") +
      "\nreturn { status, authorized_amount: authorizedAmount, captured_amount: capturedAmount, refunded_amount: refundedAmount, completed_at: completedAt }"],
  ]);
  const signatures = new Map([
    ["roundToCurrencyPrecision", "export function roundToCurrencyPrecision(amount: BigNumberInput, currencyCode: string): BigNumberInput"],
    ["paymentCollectionUpdate", "export function paymentCollectionUpdate(paymentCollection: PaymentCollectionAccountingInput, now: () => Date = () => new Date(), round: typeof roundToCurrencyPrecision = roundToCurrencyPrecision)"],
    ["validatePaymentCapture", "export function validatePaymentCapture(data: CreateCaptureDTO, payment: PaymentCaptureAccountingInput, round: typeof roundToCurrencyPrecision = roundToCurrencyPrecision)"],
    ["validatePaymentRefund", "export function validatePaymentRefund(payment: PaymentRefundAccountingInput, data: CreateRefundDTO)"],
  ]);
  const seen = new Set(), helperFile = parse(helper);
  equal('import type { BigNumberInput, CreateCaptureDTO, CreateRefundDTO } from "@medusajs/framework/types"\n' +
    'import { BigNumber, MathBN, MedusaError, PaymentCollectionStatus, PaymentSessionStatus } from "@medusajs/framework/utils/portable"',
    helperFile.statements.filter(ts.isImportDeclaration).map(statement => statement.getText(helperFile)).join("\n"));
  const interfaces = helperFile.statements.filter(ts.isInterfaceDeclaration).map(statement => statement.name.text).sort();
  if (JSON.stringify(interfaces) !== JSON.stringify(["PaymentCaptureAccountingInput", "PaymentCollectionAccountingInput", "PaymentRefundAccountingInput"]))
    throw new Error(failure + ": helper type closure");
  for (const statement of helperFile.statements) {
    if (ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.body === undefined)
      throw new Error(failure + ": helper executable closure");
    const name = statement.name.text, expected = helperBodies.get(name), signature = signatures.get(name);
    if (expected === undefined || signature === undefined || seen.has(name)) throw new Error(failure + ": helper selection");
    seen.add(name); equal(signature + " {" + expected + "}", statement.getText(helperFile));
  }
  if (seen.size !== helperBodies.size) throw new Error(failure + ": incomplete helper extraction");
  const replacements = [
    { node: rounding, text: "return roundToCurrencyPrecision(amount, currencyCode)" },
    { node: capture, text: "const { isFullyCaptured } = validatePaymentCapture(data, payment, this.roundToCurrencyPrecision.bind(this))\n" +
      "if (payment.captured_at) return { isFullyCaptured }\n" + cap.slice(capIndex).join("\n") },
    { node: refund, text: "validatePaymentRefund(payment, data)\n" + ref.slice(refIndex).join("\n") },
    { node: collection, text: col[0] + "\nconst update = paymentCollectionUpdate(paymentCollection, undefined, this.roundToCurrencyPrecision.bind(this))\n" +
      col[col.length - 1].replace(/status,\s*authorized_amount: authorizedAmount,\s*captured_amount: capturedAmount,\s*refunded_amount: refundedAmount,\s*completed_at: completedAt,/, "...update,") },
  ];
  let expected = normalized;
  for (const replacement of replacements.sort((left, right) => (right.node.body?.pos ?? 0) - (left.node.body?.pos ?? 0))) {
    const selected = replacement.node.body;
    if (selected === undefined) throw new Error(failure + ": missing replacement body");
    expected = expected.slice(0, selected.getStart(file)) + "{\n" + replacement.text + "\n}" + expected.slice(selected.end);
  }
  expected = expected.replace("  BigNumber,\n", "").replace("  MathBN,\n", "").replace("  PaymentCollectionStatus,\n", "")
    .replace('import PaymentProviderService from "./payment-provider"', 'import PaymentProviderService from "./payment-provider"\n' +
      'import { paymentCollectionUpdate, roundToCurrencyPrecision, validatePaymentCapture, validatePaymentRefund } from "../utils/accounting"');
  expected = expected.replace(/(protected async (?:capturePaymentFromProvider_|refundPaymentFromProvider_)\([\s\S]*?\n  \)) \{/g,
    "$1: Promise<InferEntityType<typeof Payment>> {");
  // Approved native owner correction: selector updates return arrays, ID
  // updates return singletons. The patch object's shape cannot choose this ABI.
  expected = expected.replace("Array.isArray(data) ? result : result[0]", "isString(idOrSelector) ? result[0] : result");
  equal(expected, target);
}
