import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const fulfillment = "packages/medusa-fulfillment/src";
const links = "packages/medusa-link-modules/src";
const flows = "packages/medusa-core-flows/src/cart";
const models = ["address", "fulfillment", "fulfillment-item", "fulfillment-label", "fulfillment-provider", "fulfillment-set",
  "geo-zone", "service-zone", "shipping-option", "shipping-option-rule", "shipping-option-type", "shipping-profile"];
const cartPrograms = [
  ["create-carts", "workflows/create-carts"],
  ["update-cart-promotions", "workflows/update-cart-promotions"],
  ["update-cart-promotions-step", "steps/update-cart-promotions"],
  ["refresh-payment-collection", "workflows/refresh-payment-collection"],
] as const;

export const nativeCartCreationSourceTargets = [
  { name: "Fulfillment models barrel", specifier: "@medusajs/fulfillment/static-manifest", entry: `${fulfillment}/static-manifest.ts`,
    imports: ["./models"], leaf: `${fulfillment}/models/index.ts` },
  ...models.map(model => ({ name: `Fulfillment model ${model}`, specifier: "@medusajs/fulfillment/static-manifest",
    entry: `${fulfillment}/static-manifest.ts`, imports: ["./models", `./${model}`], leaf: `${fulfillment}/models/${model}.ts` })),
  { name: "Fulfillment module service", specifier: "@medusajs/fulfillment/services", entry: `${fulfillment}/services/index.ts`,
    imports: ["./fulfillment-module-service"], leaf: `${fulfillment}/services/fulfillment-module-service.ts` },
  ...cartPrograms.map(([specifier, file]) => ({ name: `Cart ${specifier}`, specifier: `@medusajs/core-flows/cart/${specifier}`,
    entry: `${flows}/${file}.ts`, imports: [], leaf: `${flows}/${file}.ts` })),
  { name: "Cart Promotion Link", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./definitions/cart-promotion"], leaf: `${links}/definitions/cart-promotion.ts` },
  { name: "Cart Shipping Option endpoint", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./definitions/readonly/cart-shipping-option"], leaf: `${links}/definitions/readonly/cart-shipping-option.ts` },
  { name: "Product Shipping Profile Link", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./definitions/product-shipping-profile"], leaf: `${links}/definitions/product-shipping-profile.ts` },
  { name: "Link entity generator", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./utils/generate-entity"], leaf: `${links}/utils/generate-entity.ts` },
  { name: "Link workflow model selection", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./models/link-workflow-models"], leaf: `${links}/models/link-workflow-models.ts` },
  ...["link-workflow-operation", "link-pair-revision"].map(model => ({ name: `Link model ${model}`, specifier: "@medusajs/link-modules",
    entry: `${links}/index.ts`, imports: ["./models/link-workflow-models", `./${model}`], leaf: `${links}/models/${model}.ts` })),
  { name: "Link operation store", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./operations/store"], leaf: `${links}/operations/store.ts` },
  { name: "Link preimage contracts", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./operations/preimage-contracts"], leaf: `${links}/operations/preimage-contracts.ts` },
  { name: "Link preimage service", specifier: "@medusajs/link-modules", entry: `${links}/index.ts`,
    imports: ["./services/dynamic-service-class", "./link-module-service", "../operations/preimage-service"],
    leaf: `${links}/operations/preimage-service.ts` },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeCartCreationSource: NativeSourceEvidence;
  }
}

export default async function nativeCartCreationSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Cart creation", importer: "test/native-cart-creation-source-provenance.proof.ts", targets: nativeCartCreationSourceTargets,
  });
  project.provide("nativeCartCreationSource", evidence);
}
