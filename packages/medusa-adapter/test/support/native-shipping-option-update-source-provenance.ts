import type { TestProject } from "vitest/node";
import { nativeShippingOptionCreationSourceTargets } from "./native-shipping-option-creation-source-provenance";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const workflow = "packages/medusa-core-flows/src/fulfillment/workflows/update-shipping-options.ts";
const specifier = "@medusajs/core-flows/fulfillment/update-shipping-options";

export const nativeShippingOptionUpdateSourceTargets = [
  ...nativeShippingOptionCreationSourceTargets,
  { name: "Shipping Option update root", specifier, entry: workflow, imports: [], leaf: workflow },
  ...["upsert-shipping-options", "set-shipping-options-prices", "validate-fulfillment-providers", "validate-shipping-option-prices"].map(step => ({
    name: `Shipping Option update ${step}`, specifier, entry: workflow,
    imports: [`../steps/${step}`], leaf: `packages/medusa-core-flows/src/fulfillment/steps/${step}.ts`,
  })),
];

declare module "vitest" {
  interface ProvidedContext {
    nativeShippingOptionUpdateSource: NativeSourceEvidence;
  }
}

export default async function nativeShippingOptionUpdateSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Shipping Option update",
    importer: "test/core-shipping-option-update-workflow.test.ts", targets: nativeShippingOptionUpdateSourceTargets });
  project.provide("nativeShippingOptionUpdateSource", evidence);
}
