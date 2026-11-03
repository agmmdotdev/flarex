import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

/** Each chain follows real runtime imports from the selected package export.
 * Private implementation leaves do not need new package exports for this proof. */
export const nativeApiKeySourceTargets = [
  { name: "API Key service", specifier: "@medusajs/api-key/services", entry: "packages/medusa-api-key/src/services/index.ts",
    imports: ["./api-key-module-service"], leaf: "packages/medusa-api-key/src/services/api-key-module-service.ts" },
  { name: "API Key model", specifier: "@medusajs/api-key/models", entry: "packages/medusa-api-key/src/models/index.ts",
    imports: ["./api-key"], leaf: "packages/medusa-api-key/src/models/api-key.ts" },
  { name: "API Key static resources", specifier: "@medusajs/api-key/static-manifest", entry: "packages/medusa-api-key/src/static-manifest.ts",
    imports: [], leaf: "packages/medusa-api-key/src/static-manifest.ts" },
  { name: "Sales Channel service", specifier: "@medusajs/sales-channel/services", entry: "packages/medusa-sales-channel/src/services/index.ts",
    imports: ["./sales-channel-module"], leaf: "packages/medusa-sales-channel/src/services/sales-channel-module.ts" },
  { name: "Link root", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: [], leaf: "packages/medusa-link-modules/src/index.ts" },
  { name: "Link row service", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./services/link"], leaf: "packages/medusa-link-modules/src/services/link.ts" },
  { name: "Link module service", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./services/dynamic-service-class", "./link-module-service"], leaf: "packages/medusa-link-modules/src/services/link-module-service.ts" },
  { name: "Link operation service", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./services/dynamic-service-class", "./link-module-service", "../operations/service"], leaf: "packages/medusa-link-modules/src/operations/service.ts" },
  { name: "Link operation store", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./operations/store"], leaf: "packages/medusa-link-modules/src/operations/store.ts" },
  { name: "Link operation contracts", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./operations/contracts"], leaf: "packages/medusa-link-modules/src/operations/contracts.ts" },
  { name: "Link protocol model selection", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./models/link-workflow-models"], leaf: "packages/medusa-link-modules/src/models/link-workflow-models.ts" },
  { name: "Link operation model", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./models/link-workflow-models", "./link-workflow-operation"], leaf: "packages/medusa-link-modules/src/models/link-workflow-operation.ts" },
  { name: "Link pair-revision model", specifier: "@medusajs/link-modules", entry: "packages/medusa-link-modules/src/index.ts",
    imports: ["./models/link-workflow-models", "./link-pair-revision"], leaf: "packages/medusa-link-modules/src/models/link-pair-revision.ts" },
  { name: "Native SDK definition", specifier: "@medusajs/workflows-sdk", entry: "packages/medusa-workflows-sdk/src/index.ts",
    imports: ["./definition"], leaf: "packages/medusa-workflows-sdk/src/definition.ts" },
  { name: "Native SDK execution", specifier: "@medusajs/workflows-sdk/native", entry: "packages/medusa-workflows-sdk/src/runtime.ts",
    imports: [], leaf: "packages/medusa-workflows-sdk/src/runtime.ts" },
  { name: "Create API Keys workflow", specifier: "@medusajs/core-flows/api-key/create-api-keys", entry: "packages/medusa-core-flows/src/api-key/workflows/create-api-keys.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/api-key/workflows/create-api-keys.ts" },
  { name: "Update API Keys workflow", specifier: "@medusajs/core-flows/api-key/update-api-keys", entry: "packages/medusa-core-flows/src/api-key/workflows/update-api-keys.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/api-key/workflows/update-api-keys.ts" },
  { name: "Revoke API Keys workflow", specifier: "@medusajs/core-flows/api-key/revoke-api-keys", entry: "packages/medusa-core-flows/src/api-key/workflows/revoke-api-keys.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/api-key/workflows/revoke-api-keys.ts" },
  { name: "Delete API Keys workflow", specifier: "@medusajs/core-flows/api-key/delete-api-keys", entry: "packages/medusa-core-flows/src/api-key/workflows/delete-api-keys.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/api-key/workflows/delete-api-keys.ts" },
  { name: "Associate Sales Channels workflow", specifier: "@medusajs/core-flows/api-key/link-sales-channels-to-publishable-key", entry: "packages/medusa-core-flows/src/api-key/workflows/link-sales-channels-to-publishable-key.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/api-key/workflows/link-sales-channels-to-publishable-key.ts" },
] as const;

declare module "vitest" {
  interface ProvidedContext {
    nativeApiKeySource: NativeSourceEvidence;
  }
}

export default async function nativeApiKeySourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "API Key",
    importer: "test/native-api-key-source-provenance.proof.ts",
    targets: nativeApiKeySourceTargets,
  });
  project.provide("nativeApiKeySource", evidence);
}
