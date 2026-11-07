import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const workflow = "packages/medusa-core-flows/src/tax/workflows/create-tax-regions.ts";
const specifier = "@medusajs/core-flows/tax/create-tax-regions";

export const nativeTaxRegionSourceTargets = [
  { name: "Tax Region creation root", specifier, entry: workflow, imports: [], leaf: workflow },
  { name: "Tax Region creation and retained deletion", specifier, entry: workflow, imports: ["../steps/create-tax-regions"],
    leaf: "packages/medusa-core-flows/src/tax/steps/create-tax-regions.ts" },
  ...["tax-module-service", "tax-provider"].map(service => ({ name: `Tax native ${service}`, specifier: "@medusajs/tax/services",
    entry: "packages/medusa-tax/src/services/index.ts", imports: [`./${service}`],
    leaf: `packages/medusa-tax/src/services/${service}.ts` })),
  ...["tax-provider", "tax-rate", "tax-rate-rule", "tax-region"].map(model => ({ name: `Tax ${model}`, specifier: "@medusajs/tax/static-manifest",
    entry: "packages/medusa-tax/src/static-manifest.ts", imports: ["./models", `./${model}`],
    leaf: `packages/medusa-tax/src/models/${model}.ts` })),
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeTaxRegionSource: NativeSourceEvidence;
  }
}

export default async function nativeTaxRegionSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Tax Region creation",
    importer: "test/logical-tax-region-create-workflow.test.ts", targets: nativeTaxRegionSourceTargets });
  project.provide("nativeTaxRegionSource", evidence);
}
