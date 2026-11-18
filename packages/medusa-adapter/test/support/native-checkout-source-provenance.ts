import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src";
const links = "packages/medusa-link-modules/src";
const programs = [
  ["cart/complete-cart", "cart/workflows/complete-cart"],
  ["payment/authorize-payment-session-step", "payment/steps/authorize-payment-session"],
  ["payment/capture-payment-step", "payment/steps/capture-payment"],
  ["payment/refund-payment-step", "payment/steps/refund-payment"],
] as const;
const services = [
  ["order", "order-module-service"],
  ["payment", "payment-module"],
  ["inventory", "inventory-module"],
  ["customer", "customer-module"],
] as const;

export const nativeCheckoutSourceTargets = [
  ...programs.map(([specifier, file]) => ({ name: specifier, specifier: `@medusajs/core-flows/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  ...services.map(([name, file]) => ({ name: `${name} service`, specifier: `@medusajs/${name}/services`,
    entry: `packages/medusa-${name}/src/services/index.ts`, imports: [`./${file}`],
    leaf: `packages/medusa-${name}/src/services/${file}.ts` })),
  ...["order-cart", "order-payment-collection", "cart-promotion", "customer-account-holder"].map(name => ({
    name, specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: [`./definitions/${name}`], leaf: `${links}/definitions/${name}.ts`,
  })),
  { name: "Link entity generator", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./utils/generate-entity"], leaf: `${links}/utils/generate-entity.ts` },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeCheckoutSource: NativeSourceEvidence;
  }
}

export default async function nativeCheckoutSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Checkout", importer: "test/logical-checkout-workflow.test.ts", targets: nativeCheckoutSourceTargets,
  });
  project.provide("nativeCheckoutSource", evidence);
}
