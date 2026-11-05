import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const workflow = "packages/medusa-core-flows/src/fulfillment/workflows/batch-shipping-option-rules.ts";
export const nativeShippingOptionRuleSourceTargets = [
  ...["create", "update", "delete"].map(operation => ({
    name: `${operation} Shipping Option Rules`,
    specifier: "@medusajs/core-flows/fulfillment/batch-shipping-option-rules",
    entry: workflow,
    imports: [`../steps/${operation}-shipping-option-rules`],
    leaf: `packages/medusa-core-flows/src/fulfillment/steps/${operation}-shipping-option-rules.ts`,
  })),
  { name: "Fulfillment service", specifier: "@medusajs/fulfillment/services",
    entry: "packages/medusa-fulfillment/src/services/index.ts", imports: ["./fulfillment-module-service"],
    leaf: "packages/medusa-fulfillment/src/services/fulfillment-module-service.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native",
    entry: "packages/medusa-workflows-sdk/src/runtime.ts", imports: [],
    leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeShippingOptionRuleSource: NativeSourceEvidence;
  }
}

export default async function nativeShippingOptionRuleSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Shipping Option Rule Batch",
    importer: "test/logical-shipping-option-rule-batch-workflow.test.ts", targets: nativeShippingOptionRuleSourceTargets });
  project.provide("nativeShippingOptionRuleSource", evidence);
}