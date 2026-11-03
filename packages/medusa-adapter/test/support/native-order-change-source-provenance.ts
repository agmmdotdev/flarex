import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

/** Step leaves resolve from the actual workflow imports. */
export const nativeOrderChangeSourceTargets = [
  { name: "Order module service", specifier: "@medusajs/order/services", entry: "packages/medusa-order/src/services/index.ts",
    imports: ["./order-module-service"], leaf: "packages/medusa-order/src/services/order-module-service.ts" },
  { name: "Order service", specifier: "@medusajs/order/services", entry: "packages/medusa-order/src/services/index.ts",
    imports: ["./order-service"], leaf: "packages/medusa-order/src/services/order-service.ts" },
  { name: "Order static manifest", specifier: "@medusajs/order/static-manifest", entry: "packages/medusa-order/src/static-manifest.ts",
    imports: [], leaf: "packages/medusa-order/src/static-manifest.ts" },
  { name: "Order model", specifier: "@medusajs/order/models", entry: "packages/medusa-order/src/models/index.ts",
    imports: ["./order"], leaf: "packages/medusa-order/src/models/order.ts" },
  { name: "Order Change model", specifier: "@medusajs/order/models", entry: "packages/medusa-order/src/models/index.ts",
    imports: ["./order-change"], leaf: "packages/medusa-order/src/models/order-change.ts" },
  { name: "Order Change Action model", specifier: "@medusajs/order/models", entry: "packages/medusa-order/src/models/index.ts",
    imports: ["./order-change-action"], leaf: "packages/medusa-order/src/models/order-change-action.ts" },
  { name: "Update Order Changes workflow", specifier: "@medusajs/core-flows/order/update-order-changes",
    entry: "packages/medusa-core-flows/src/order/workflows/update-order-changes.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/order/workflows/update-order-changes.ts" },
  { name: "Update Order Changes step", specifier: "@medusajs/core-flows/order/update-order-changes",
    entry: "packages/medusa-core-flows/src/order/workflows/update-order-changes.ts",
    imports: ["../steps/update-order-changes"], leaf: "packages/medusa-core-flows/src/order/steps/update-order-changes.ts" },
  { name: "Cancel Order Change workflow", specifier: "@medusajs/core-flows/order/cancel-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/cancel-order-change.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/order/workflows/cancel-order-change.ts" },
  { name: "Cancel Order Change step", specifier: "@medusajs/core-flows/order/cancel-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/cancel-order-change.ts",
    imports: ["../steps/cancel-order-change"], leaf: "packages/medusa-core-flows/src/order/steps/cancel-order-change.ts" },
  { name: "Decline Order Change workflow", specifier: "@medusajs/core-flows/order/decline-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/decline-order-change.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/order/workflows/decline-order-change.ts" },
  { name: "Decline Order Change step", specifier: "@medusajs/core-flows/order/decline-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/decline-order-change.ts",
    imports: ["../steps/decline-order-change"], leaf: "packages/medusa-core-flows/src/order/steps/decline-order-change.ts" },
  { name: "Delete Order Change workflow", specifier: "@medusajs/core-flows/order/delete-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/delete-order-change.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/order/workflows/delete-order-change.ts" },
  { name: "Delete Order Changes step", specifier: "@medusajs/core-flows/order/delete-order-change",
    entry: "packages/medusa-core-flows/src/order/workflows/delete-order-change.ts",
    imports: ["../steps/delete-order-changes"], leaf: "packages/medusa-core-flows/src/order/steps/delete-order-changes.ts" },
  { name: "Native SDK definition", specifier: "@medusajs/workflows-sdk", entry: "packages/medusa-workflows-sdk/src/index.ts",
    imports: ["./definition"], leaf: "packages/medusa-workflows-sdk/src/definition.ts" },
  { name: "Native SDK execution", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
] as const;

declare module "vitest" {
  interface ProvidedContext {
    nativeOrderChangeSource: NativeSourceEvidence;
  }
}

export default async function nativeOrderChangeSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Order Change",
    importer: "test/native-order-change-source-provenance.proof.ts",
    targets: nativeOrderChangeSourceTargets,
  });
  project.provide("nativeOrderChangeSource", evidence);
}
