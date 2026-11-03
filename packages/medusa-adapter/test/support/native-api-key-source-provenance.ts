import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import type { TestProject } from "vitest/node";
import { NativeSourceEvidenceSchema, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

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

/** Resolve through the SSR environment that actually runs these tests. */
export default async function nativeApiKeySourceEvidence(project: TestProject): Promise<void> {
  if (project.config.environment !== "node") throw new Error("API Key Source proof requires the Node test environment");
  const environment = project.vite.environments.ssr;
  if (environment === undefined) throw new Error("API Key Source proof requires the actual Vitest module-runner environment");
  const workspace = path.resolve(project.config.root, "../..");
  const importer = path.resolve(project.config.root, "test/native-api-key-source-provenance.proof.ts");
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const physical = (id: string) => realpathSync(id.split("?")[0] ?? id);
  const entries: NativeSourceEvidence["entries"][number][] = [];
  for (const target of nativeApiKeySourceTargets) {
    const entry = await environment.pluginContainer.resolveId(target.specifier, importer);
    if (entry === null || entry.external) throw new Error(`API Key Source export is unresolved or external: ${target.specifier}`);
    let leaf = entry;
    for (const specifier of target.imports) {
      const resolved = await environment.pluginContainer.resolveId(specifier, leaf.id);
      if (resolved === null || resolved.external) throw new Error(`API Key Source implementation is unresolved or external: ${target.name}/${specifier}`);
      leaf = resolved;
    }
    const entryFile = physical(entry.id), leafFile = physical(leaf.id);
    if (entryFile !== realpathSync(path.resolve(workspace, target.entry)) || leafFile !== realpathSync(path.resolve(workspace, target.leaf)))
      throw new Error(`API Key test resolution did not select Source: ${target.name}; entry=${entryFile}; leaf=${leafFile}`);
    entries.push({ name: target.name, specifier: target.specifier, entry: target.entry, leaf: target.leaf,
      entrySha256: digest(entryFile), leafSha256: digest(leafFile), external: false });
  }
  project.provide("nativeApiKeySource", Schema.decodeUnknownSync(NativeSourceEvidenceSchema)({ environment: "ssr", entries }));
}
