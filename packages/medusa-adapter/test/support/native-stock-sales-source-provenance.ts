import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";
import type { TestProject } from "vitest/node";

export const nativeSourceTargets = [
  { name: "Stock Location", package: "stock-location", leaf: "stock-location-module" },
  { name: "Sales Channel", package: "sales-channel", leaf: "sales-channel-module" },
  { name: "Store guard", package: "store", leaf: "store-module-service" },
  { name: "Product", package: "product", leaf: "product-module-service" },
  { name: "Pricing", package: "pricing", leaf: "pricing-module" },
  { name: "Inventory", package: "inventory", leaf: "inventory-module" },
  { name: "Fulfillment", package: "fulfillment", leaf: "fulfillment-module-service" },
  { name: "Fulfillment provider service", package: "fulfillment", leaf: "fulfillment-provider" },
] as const;

export const NativeSourceEvidenceSchema = Schema.Struct({
  environment: Schema.Literal("ssr"),
  entries: Schema.Array(Schema.Struct({
    name: Schema.String,
    specifier: Schema.String,
    entry: Schema.String,
    leaf: Schema.String,
    entrySha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
    leafSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
    external: Schema.Literal(false),
  })),
});
export type NativeSourceEvidence = typeof NativeSourceEvidenceSchema.Type;

declare module "vitest" {
  interface ProvidedContext {
    nativeStockSalesSource: NativeSourceEvidence;
  }
}

/** Use the environment running the tests, rather than another resolver or a
 * separate Vite server. Fail closed if the installed runner changes that seam. */
export default async function nativeSourceEvidence(project: TestProject): Promise<void> {
  if (project.config.environment !== "node") throw new Error("Native Source proof requires the configured Node test environment");
  const environment = project.vite.environments.ssr;
  if (environment === undefined) throw new Error("Native Source proof requires the actual Vitest module-runner environment");
  const workspace = path.resolve(project.config.root, "../..");
  const importer = path.resolve(project.config.root, "test/native-stock-sales-source-provenance.proof.ts");
  const entries: NativeSourceEvidence["entries"][number][] = [];
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const physical = (id: string) => realpathSync(id.split("?")[0] ?? id);
  for (const target of nativeSourceTargets) {
    const specifier = `@medusajs/${target.package}/services`;
    const entry = await environment.pluginContainer.resolveId(specifier, importer);
    if (entry === null || entry.external) throw new Error(`Native Source export is unresolved or external: ${specifier}`);
    const leaf = await environment.pluginContainer.resolveId(`./${target.leaf}`, entry.id);
    if (leaf === null || leaf.external) throw new Error(`Native Source implementation is unresolved or external: ${specifier}`);
    const entryFile = physical(entry.id), leafFile = physical(leaf.id);
    const expectedEntry = `packages/medusa-${target.package}/src/services/index.ts`;
    const expectedLeaf = `packages/medusa-${target.package}/src/services/${target.leaf}.ts`;
    if (entryFile !== realpathSync(path.resolve(workspace, expectedEntry)) ||
      leafFile !== realpathSync(path.resolve(workspace, expectedLeaf))) {
      throw new Error(`Native test resolution did not select the promoted Source implementation: ${specifier}; entry=${entryFile}; leaf=${leafFile}; workspace=${workspace}`);
    }
    entries.push({ name: target.name, specifier, entry: expectedEntry, leaf: expectedLeaf,
      entrySha256: digest(entryFile), leafSha256: digest(leafFile), external: false });
  }
  project.provide("nativeStockSalesSource", Schema.decodeUnknownSync(NativeSourceEvidenceSchema)({ environment: "ssr", entries }));
}
