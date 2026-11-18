import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const payment = "packages/medusa-payment/src";
const links = "packages/medusa-link-modules/src";
const flows = "packages/medusa-core-flows/src";
const models = ["payment-collection", "payment-session", "payment", "capture", "refund", "refund-reason", "account-holder", "payment-provider"];
const workflows = [
  ["cart/create-payment-collection-for-cart", "cart/workflows/create-payment-collection-for-cart"],
  ["cart/refresh-payment-collection", "cart/workflows/refresh-payment-collection"],
  ["payment-collection/create-payment-session", "payment-collection/workflows/create-payment-session"],
  ["payment-collection/delete-payment-sessions", "payment-collection/workflows/delete-payment-sessions"],
  ["payment-collection/create-payment-session-step", "payment-collection/steps/create-payment-session"],
  ["payment-collection/update-payment-collection-step", "payment-collection/steps/update-payment-collection"],
] as const;

export const nativeCartPaymentCollectionSourceTargets = [
  ...models.map(model => ({ name: `Payment model ${model}`, specifier: "@medusajs/payment/models",
    entry: `${payment}/models/index.ts`, imports: [`./${model}`], leaf: `${payment}/models/${model}.ts` })),
  { name: "Payment module service", specifier: "@medusajs/payment/services", entry: `${payment}/services/index.ts`,
    imports: ["./payment-module"], leaf: `${payment}/services/payment-module.ts` },
  { name: "Payment static manifest", specifier: "@medusajs/payment/static-manifest", entry: `${payment}/static-manifest.ts`,
    imports: [], leaf: `${payment}/static-manifest.ts` },
  { name: "System Payment Provider", specifier: "@medusajs/payment/providers/system", entry: `${payment}/providers/system.ts`,
    imports: [], leaf: `${payment}/providers/system.ts` },
  ...workflows.map(([specifier, file]) => ({ name: specifier, specifier: `@medusajs/core-flows/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  { name: "Cart PaymentCollection Link", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./definitions/cart-payment-collection"], leaf: `${links}/definitions/cart-payment-collection.ts` },
  { name: "Link entity generator", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./utils/generate-entity"], leaf: `${links}/utils/generate-entity.ts` },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeCartPaymentCollectionSource: NativeSourceEvidence;
  }
}

export default async function nativeCartPaymentCollectionSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Cart PaymentCollection", importer: "test/native-cart-payment-collection-source-provenance.proof.ts",
    targets: nativeCartPaymentCollectionSourceTargets,
  });
  project.provide("nativeCartPaymentCollectionSource", evidence);
}
