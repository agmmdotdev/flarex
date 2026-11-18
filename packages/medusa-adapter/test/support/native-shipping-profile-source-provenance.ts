import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src";
const deletion = `${flows}/shipping-profile/workflows/delete-shipping-profile.ts`;
const programs = [
  ["fulfillment/create-shipping-profiles", "fulfillment/workflows/create-shipping-profiles"],
  ["fulfillment/create-shipping-profiles-step", "fulfillment/steps/create-shipping-profiles"],
  ["fulfillment/update-shipping-profiles", "fulfillment/workflows/update-shipping-profiles"],
  ["fulfillment/update-shipping-profiles-step", "fulfillment/steps/update-shipping-profiles"],
  ["shipping-profile/delete-shipping-profile-step", "shipping-profile/steps/delete-shipping-profile"],
  ["fulfillment/create-service-zones", "fulfillment/workflows/create-service-zones"],
  ["fulfillment/create-service-zones-step", "fulfillment/steps/create-service-zones"],
  ["common/create-remote-links-step", "common/steps/create-remote-links"],
  ["product/create-products-step", "product/steps/create-products"],
] as const;

export const nativeShippingProfileSourceTargets = [
  ...programs.map(([specifier, file]) => ({ name: specifier, specifier: `@medusajs/core-flows/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  { name: "Shipping Profile Link removal", specifier: "@medusajs/core-flows/shipping-profile/delete-shipping-profile", entry: deletion,
    imports: ["../../common/steps/remove-remote-links"], leaf: `${flows}/common/steps/remove-remote-links.ts` },
  { name: "Shipping Profile Link read", specifier: "@medusajs/core-flows/shipping-profile/delete-shipping-profile", entry: deletion,
    imports: ["../../common/steps/use-query-graph"], leaf: `${flows}/common/steps/use-query-graph.ts` },
  { name: "Fulfillment service", specifier: "@medusajs/fulfillment/services", entry: "packages/medusa-fulfillment/src/services/index.ts",
    imports: ["./fulfillment-module-service"], leaf: "packages/medusa-fulfillment/src/services/fulfillment-module-service.ts" },
  { name: "Product service", specifier: "@medusajs/product/services", entry: "packages/medusa-product/src/services/index.ts",
    imports: ["./product-module-service"], leaf: "packages/medusa-product/src/services/product-module-service.ts" },
  { name: "Product Shipping Profile Link", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./definitions/product-shipping-profile"], leaf: "packages/medusa-link-modules/src/definitions/product-shipping-profile.ts" },
  { name: "Link service", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./services/link"], leaf: "packages/medusa-link-modules/src/services/link.ts" },
  { name: "Native Link router", specifier: "@medusajs/modules-sdk/link", entry: "packages/medusa-modules-sdk/src/link.ts",
    imports: [], leaf: "packages/medusa-modules-sdk/src/link.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeShippingProfileSource: NativeSourceEvidence;
  }
}

export default async function nativeShippingProfileSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Shipping Profile lifecycle",
    importer: "test/logical-shipping-profile-deletion-workflow.test.ts", targets: nativeShippingProfileSourceTargets });
  project.provide("nativeShippingProfileSource", evidence);
}
