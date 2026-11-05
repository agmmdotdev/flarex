import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const workflow = "packages/medusa-core-flows/src/fulfillment/workflows/create-shipping-options.ts";
const specifier = "@medusajs/core-flows/fulfillment/create-shipping-options";
const steps = ["upsert-shipping-options", "add-shipping-options-prices", "set-shipping-options-price-sets",
  "validate-fulfillment-providers", "validate-shipping-option-prices"];
const models = ["fulfillment_provider", "fulfillment_set", "service_zone", "geo_zone", "shipping_profile",
  "shipping_option", "shipping_option_rule", "shipping_option_type"];

export const nativeShippingOptionCreationSourceTargets = [
  ...steps.map(step => ({ name: `Shipping Option ${step}`, specifier, entry: workflow,
    imports: [`../steps/${step}`], leaf: `packages/medusa-core-flows/src/fulfillment/steps/${step}.ts` })),
  { name: "Shipping Option external event", specifier, entry: workflow, imports: ["../../common/steps/emit-event"],
    leaf: "packages/medusa-core-flows/src/common/steps/emit-event.ts" },
  ...([
    ["fulfillment", "fulfillment-module-service"], ["pricing", "pricing-module"],
    ["region", "region-module"], ["stock-location", "stock-location-module"],
  ] as const).map(([module, service]) => ({ name: `${module} native service`, specifier: `@medusajs/${module}/services`,
    entry: `packages/medusa-${module}/src/services/index.ts`, imports: [`./${service}`],
    leaf: `packages/medusa-${module}/src/services/${service}.ts` })),
  ...models.map(model => ({ name: `Fulfillment ${model}`, specifier: "@medusajs/fulfillment/static-manifest",
    entry: "packages/medusa-fulfillment/src/static-manifest.ts", imports: ["./models", `./${model.replaceAll("_", "-")}`],
    leaf: `packages/medusa-fulfillment/src/models/${model.replaceAll("_", "-")}.ts` })),
  ...["fulfillment-set-location", "fulfillment-provider-location", "shipping-option-price-set"].map(link => ({
    name: `Stored Link ${link}`, specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: [`./definitions/${link}`], leaf: `packages/medusa-link-modules/src/definitions/${link}.ts`,
  })),
  { name: "Link entity generator", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./utils/generate-entity"], leaf: "packages/medusa-link-modules/src/utils/generate-entity.ts" },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeShippingOptionCreationSource: NativeSourceEvidence;
  }
}

export default async function nativeShippingOptionCreationSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Shipping Option creation",
    importer: "test/logical-shipping-option-creation-workflow.test.ts", targets: nativeShippingOptionCreationSourceTargets });
  project.provide("nativeShippingOptionCreationSource", evidence);
}
