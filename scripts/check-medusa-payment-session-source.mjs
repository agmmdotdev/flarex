// @ts-check
import ts from "@typescript/typescript6";

const prefix = "third_party/medusa/upstream/packages/core/core-flows/src/payment-collection/";
export const paymentSessionSourcePairs = Object.freeze([
  "workflows/create-payment-session.ts", "workflows/delete-payment-sessions.ts",
  "steps/create-payment-session.ts", "steps/create-payment-account-holder.ts",
  "steps/delete-payment-sessions.ts", "steps/validate-deleted-payment-sessions.ts",
].map(relative => Object.freeze({ source: prefix + relative,
  target: "packages/medusa-core-flows/src/payment-collection/" + relative, classification: "workflowFork" })));
export const paymentSessionTypeSourcePairs = Object.freeze([
  { source: "third_party/medusa/upstream/packages/core/types/src/payment/provider.ts", target: "packages/medusa-types/src/payment/provider.ts", classification: "importRelocation" },
  { source: "third_party/medusa/upstream/packages/core/types/src/payment/mutations.ts", target: "packages/medusa-types/src/payment/mutations.ts", classification: "paymentSessionTypeFork" },
]);

/** Only portable SDK/utility imports and explicit barrel expansion may differ.
 * Complete typed and emitted programs retain native branches, parallelism,
 * provider calls, logging, failure order and retained compensation.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyPaymentSessionSource(source, target, targetPath) {
  const pair = paymentSessionSourcePairs.find(pair => pair.target === targetPath);
  if (pair === undefined) throw new Error("Unknown native Payment session source pair");
  let expected = source.replaceAll("\r\n", "\n")
    .replaceAll('from "@medusajs/framework/workflows-sdk"', 'from "@medusajs/workflows-sdk"')
    .replaceAll('from "@medusajs/framework/utils"', 'from "@medusajs/framework/utils/portable"');
  const stepId = targetPath.endsWith("steps/create-payment-session.ts") ? "createPaymentSessionStepId"
    : targetPath.endsWith("steps/create-payment-account-holder.ts") ? "createPaymentAccountHolderStepId"
    : targetPath.endsWith("steps/delete-payment-sessions.ts") ? "deletePaymentSessionsStepId" : undefined;
  if (stepId !== undefined) expected = expected.replace("createStep(\n  " + stepId + ",",
    'createStep(\n  { name: ' + stepId + ', compensation: "transactionCovered" },');
  if (targetPath.endsWith("steps/create-payment-session.ts")) expected = expected
    .replace("context?: PaymentProviderContext", "context?: PaymentProviderContext | null | undefined")
    .replace("data?: Record<string, unknown>", "data?: Record<string, unknown> | undefined")
    .replace("metadata?: Record<string, unknown>", "metadata?: Record<string, unknown> | undefined");
  if (targetPath.endsWith("workflows/create-payment-session.ts")) expected = expected
    .replace('import { createRemoteLinkStep, useRemoteQueryStep } from "../../common"',
      'import { createRemoteLinkStep } from "../../common/steps/create-remote-links"\n' +
      'import { useRemoteQueryStep } from "../../common/steps/use-remote-query"')
    .replace('import {\n  createPaymentAccountHolderStep,\n  createPaymentSessionStep,\n} from "../steps"',
      'import { createPaymentAccountHolderStep } from "../steps/create-payment-account-holder"\n' +
      'import { createPaymentSessionStep } from "../steps/create-payment-session"');
  if (targetPath.endsWith("workflows/create-payment-session.ts")) expected = expected
    .replace("const customer: CustomerDTO & { account_holders: AccountHolderDTO[] } =", "const customer =")
    .replace("id: input.customer_id", "id: input.customer_id!")
    .replaceAll("data.customer.addresses", "data.customer!.addresses")
    .replace("data.customer.account_holders", "data.customer!.account_holders")
    .replace("...data.customer,", "...data.customer!,")
    .replace("data.paymentCollection.amount", "data.paymentCollection!.amount")
    .replace("data.paymentCollection.currency_code", "data.paymentCollection!.currency_code")
    .replace("paymentCustomer.id", "paymentCustomer!.id").replace("accountHolder.id", "accountHolder!.id");
  if (targetPath.endsWith("workflows/delete-payment-sessions.ts")) expected = expected
    .replace('import {\n  deletePaymentSessionsStep,\n  validateDeletedPaymentSessionsStep,\n} from "../steps"',
      'import { deletePaymentSessionsStep } from "../steps/delete-payment-sessions"\n' +
      'import { validateDeletedPaymentSessionsStep } from "../steps/validate-deleted-payment-sessions"');
  /** @param {string} text */
  const programs = text => {
    const output = ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
      newLine: ts.NewLineKind.LineFeed, moduleDetection: ts.ModuleDetectionKind.Force,
    } });
    if (output.diagnostics?.some(value => value.category === ts.DiagnosticCategory.Error))
      throw new Error("Invalid native Payment session syntax");
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    return [printer.printFile(ts.createSourceFile("payment.ts", text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)),
      printer.printFile(ts.createSourceFile("payment.js", output.outputText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS))];
  };
  const a = programs(expected), b = programs(target);
  if (a[0] !== b[0] || a[1] !== b[1]) throw new Error("Changed native Payment session source: " + targetPath);
}

/** @param {readonly {source?:string,target:string,classification:string}[]} files */
export function verifyPaymentSessionSelection(files) {
  const pairs = [...paymentSessionSourcePairs, ...paymentSessionTypeSourcePairs];
  for (const pair of pairs) if (files.filter(file => file.source === pair.source &&
    file.target === pair.target && file.classification === pair.classification).length !== 1)
    throw new Error("Changed native Payment session selection");
  for (const file of files) if ((file.classification === "paymentSessionTypeFork" || pairs.some(pair => pair.source === file.source || pair.target === file.target)) &&
    !pairs.some(pair => pair.source === file.source && pair.target === file.target && pair.classification === file.classification))
    throw new Error("Changed native Payment session selection");
}

/** Preserve only the native calls' own undefined optional values. No business
 * types, exports, callback bodies or runtime behavior may change.
 * @param {string} source @param {string} target @param {string} targetPath */
export function verifyPaymentSessionTypeSource(source, target, targetPath) {
  let expected = source.replaceAll("\r\n", "\n");
  if (targetPath.endsWith("/provider.ts")) expected = expected.replace('from "../address"', 'from "../address/common"')
    .replace("billing_address?: PaymentAddressDTO | null", "billing_address?: PaymentAddressDTO | null | undefined")
    .replace("account_holder?: PaymentAccountHolderDTO", "account_holder?: PaymentAccountHolderDTO | undefined")
    .replace("customer?: PaymentCustomerDTO", "customer?: PaymentCustomerDTO | undefined");
  else if (targetPath.endsWith("/mutations.ts")) expected = expected.replace("context?: PaymentProviderContext", "context?: PaymentProviderContext | null | undefined");
  else throw new Error("Unknown native Payment session type pair");
  if (expected !== target.replaceAll("\r\n", "\n")) throw new Error("Changed native Payment session types");
}
