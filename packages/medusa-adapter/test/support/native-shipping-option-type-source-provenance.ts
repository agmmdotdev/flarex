import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src";
const deletion = `${flows}/shipping-options/workflows/delete-shipping-option-types.ts`;
const deletionSpecifier = "@medusajs/core-flows/shipping-options/delete-shipping-option-types";
const programs = [
  ["shipping-options", "create-shipping-option-types"],
  ["shipping-options", "update-shipping-option-types"],
  ["shipping-options", "delete-shipping-option-types"],
  ["fulfillment", "create-service-zones"],
] as const;

export const nativeShippingOptionTypeSourceTargets = [
  ...programs.map(([area, workflow]) => ({
    name: `${area}/${workflow}`, specifier: `@medusajs/core-flows/${area}/${workflow}`,
    entry: `${flows}/${area}/workflows/${workflow}.ts`, imports: [`../steps/${workflow}`],
    leaf: `${flows}/${area}/steps/${workflow}.ts`,
  })),
  ...["use-query-graph", "remove-remote-links", "emit-event"].map(step => ({
    name: `Shipping Option Type ${step}`, specifier: deletionSpecifier, entry: deletion,
    imports: [`../../common/steps/${step}`], leaf: `${flows}/common/steps/${step}.ts`,
  })),
  { name: "Fulfillment service", specifier: "@medusajs/fulfillment/services", entry: "packages/medusa-fulfillment/src/services/index.ts",
    imports: ["./fulfillment-module-service"], leaf: "packages/medusa-fulfillment/src/services/fulfillment-module-service.ts" },
  { name: "Native Link router", specifier: "@medusajs/modules-sdk/link", entry: "packages/medusa-modules-sdk/src/link.ts",
    imports: [], leaf: "packages/medusa-modules-sdk/src/link.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeShippingOptionTypeSource: NativeSourceEvidence;
  }
}

export default async function nativeShippingOptionTypeSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Shipping Option Type lifecycle",
    importer: "test/logical-shipping-option-type-deletion-workflow.test.ts", targets: nativeShippingOptionTypeSourceTargets });
  project.provide("nativeShippingOptionTypeSource", evidence);
}
