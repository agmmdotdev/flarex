import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const flows = "packages/medusa-core-flows/src/fulfillment";

export const nativeServiceZoneSourceTargets = [
  ...["create", "update", "delete"].map(operation => {
    const workflow = `${operation}-service-zones`;
    return { name: workflow, specifier: `@medusajs/core-flows/fulfillment/${workflow}`,
      entry: `${flows}/workflows/${workflow}.ts`, imports: [`../steps/${workflow}`],
      leaf: `${flows}/steps/${workflow}.ts` };
  }),
  { name: "Fulfillment service", specifier: "@medusajs/fulfillment/services", entry: "packages/medusa-fulfillment/src/services/index.ts",
    imports: ["./fulfillment-module-service"], leaf: "packages/medusa-fulfillment/src/services/fulfillment-module-service.ts" },
  { name: "Native workflow runtime", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeServiceZoneSource: NativeSourceEvidence;
  }
}

export default async function nativeServiceZoneSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, { name: "Service Zone lifecycle",
    importer: "test/logical-service-zone-creation-workflow.test.ts", targets: nativeServiceZoneSourceTargets });
  project.provide("nativeServiceZoneSource", evidence);
}
