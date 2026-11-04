import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src";
const links = "packages/medusa-link-modules/src";
const programs = [
  ["payment-collection/create-payment-session", "payment-collection/workflows/create-payment-session"],
  ["payment-collection/create-payment-session-step", "payment-collection/steps/create-payment-session"],
  ["payment-collection/delete-payment-sessions", "payment-collection/workflows/delete-payment-sessions"],
  ["payment-collection/cancel-payment-collection", "payment-collection/workflows/cancel-payment-collection"],
  ["payment-collection/create-payment-account-holder-step", "payment-collection/steps/create-payment-account-holder"],
  ["cart/create-payment-collection-for-cart", "cart/workflows/create-payment-collection-for-cart"],
  ["cart/create-payment-collection-step", "cart/steps/create-payment-collection"],
  ["cart/refresh-payment-collection", "cart/workflows/refresh-payment-collection"],
  ["order/create-order-payment-collection", "order/workflows/create-order-payment-collection"],
  ["customer/create-addresses", "customer/workflows/create-addresses"],
  ["customer/update-addresses", "customer/workflows/update-addresses"],
  ["customer/delete-addresses", "customer/workflows/delete-addresses"],
] as const;

export const nativePaymentCollectionSourceTargets = [
  ...programs.map(([specifier, file]) => ({ name: specifier, specifier: `@medusajs/core-flows/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  ...["cart-payment-collection", "order-payment-collection", "customer-account-holder"].map(file => ({
    name: file, specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: [`./definitions/${file}`], leaf: `${links}/definitions/${file}.ts`,
  })),
  { name: "Payment service", specifier: "@medusajs/payment/services", entry: "packages/medusa-payment/src/services/index.ts",
    imports: ["./payment-module"], leaf: "packages/medusa-payment/src/services/payment-module.ts" },
  { name: "Cart service", specifier: "@medusajs/cart/services", entry: "packages/medusa-cart/src/services/index.ts",
    imports: ["./cart-module"], leaf: "packages/medusa-cart/src/services/cart-module.ts" },
  { name: "System Payment provider", specifier: "@medusajs/payment/providers/system", entry: "packages/medusa-payment/src/providers/system.ts",
    imports: [], leaf: "packages/medusa-payment/src/providers/system.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativePaymentCollectionSource: NativeSourceEvidence;
  }
}

export default async function nativePaymentCollectionSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Payment collections and Sessions",
    importer: "test/logical-payment-collection-workflows.test.ts", targets: nativePaymentCollectionSourceTargets });
  project.provide("nativePaymentCollectionSource", evidence);
}
