import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const modelLeaves = ["promotion", "application-method", "campaign", "campaign-budget", "campaign-budget-usage",
  "promotion-rule", "promotion-rule-value"];
const prefilter = "packages/medusa-promotion/src/utils/compute-actions/prefilter.ts";

export const nativePromotionSourceTargets = [
  ...modelLeaves.map(leaf => ({ name: `Promotion model ${leaf}`, specifier: "@medusajs/promotion/models",
    entry: "packages/medusa-promotion/src/models/index.ts", imports: [`./${leaf}`],
    leaf: `packages/medusa-promotion/src/models/${leaf}.ts` })),
  { name: "Promotion module service", specifier: "@medusajs/promotion/services", entry: "packages/medusa-promotion/src/services/index.ts",
    imports: ["./promotion-module"], leaf: "packages/medusa-promotion/src/services/promotion-module.ts" },
  { name: "Promotion static manifest", specifier: "@medusajs/promotion/static-manifest", entry: "packages/medusa-promotion/src/static-manifest.ts",
    imports: [], leaf: "packages/medusa-promotion/src/static-manifest.ts" },
  { name: "Promotion prefilter", specifier: "@medusajs/promotion/prefilter", entry: prefilter, imports: [], leaf: prefilter },
  { name: "Promotion prefilter program", specifier: "@medusajs/promotion/prefilter", entry: prefilter, imports: ["./prefilter-plan"],
    leaf: "packages/medusa-promotion/src/utils/compute-actions/prefilter-plan.ts" },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativePromotionSource: NativeSourceEvidence;
  }
}

export default async function nativePromotionSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Promotion", importer: "test/native-promotion-source-provenance.proof.ts", targets: nativePromotionSourceTargets,
  });
  project.provide("nativePromotionSource", evidence);
}
