import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src";
const links = "packages/medusa-link-modules/src";
const programs = [
  ["payment/authorize-payment-session-step", "payment/steps/authorize-payment-session"],
  ["payment/capture-payment-step", "payment/steps/capture-payment"],
  ["payment/refund-payment-step", "payment/steps/refund-payment"],
  ["payment/refund-payments-step", "payment/steps/refund-payments"],
  ["payment/capture-payment", "payment/workflows/capture-payment"],
  ["payment/refund-payment", "payment/workflows/refund-payment"],
  ["payment/refund-payments", "payment/workflows/refund-payments"],
  ["order/add-order-transaction-step", "order/steps/add-order-transaction"],
  ["order/create-order-change-step", "order/steps/create-order-change"],
  ["order/confirm-order-changes-step", "order/steps/confirm-order-changes"],
  ["order/create-order-change-actions", "order/workflows/create-order-change-actions"],
  ["order/create-order-refund-credit-lines", "order/workflows/payments/create-order-refund-credit-lines"],
  ["cart/compensate-payment-if-needed-step", "cart/steps/compensate-payment-if-needed"],
  ["cart/refund-payment-recreate-payment-session", "cart/workflows/refund-payment-recreate-payment-session"],
] as const;

export const nativePaymentFinanceSourceTargets = [
  ...programs.map(([specifier, file]) => ({ name: specifier, specifier: `@medusajs/core-flows/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  { name: "Payment service", specifier: "@medusajs/payment/services", entry: "packages/medusa-payment/src/services/index.ts",
    imports: ["./payment-module"], leaf: "packages/medusa-payment/src/services/payment-module.ts" },
  { name: "Order service", specifier: "@medusajs/order/services", entry: "packages/medusa-order/src/services/index.ts",
    imports: ["./order-module-service"], leaf: "packages/medusa-order/src/services/order-module-service.ts" },
  { name: "System Payment provider", specifier: "@medusajs/payment/providers/system", entry: "packages/medusa-payment/src/providers/system.ts",
    imports: [], leaf: "packages/medusa-payment/src/providers/system.ts" },
  { name: "Order PaymentCollection Link", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./definitions/order-payment-collection"], leaf: `${links}/definitions/order-payment-collection.ts` },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativePaymentFinanceSource: NativeSourceEvidence;
  }
}

export default async function nativePaymentFinanceSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Payment finance",
    importer: "test/logical-payment-finance-workflows.test.ts", targets: nativePaymentFinanceSourceTargets });
  project.provide("nativePaymentFinanceSource", evidence);
}
