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

type NativeSourceTarget = Pick<NativeSourceEvidence["entries"][number], "name" | "specifier" | "entry" | "leaf"> & {
  readonly imports: readonly string[];
};

declare module "vitest" {
  interface ProvidedContext {
    nativeStockSalesSource: NativeSourceEvidence;
  }
}

/** Resolve through the SSR environment executing the proof and fail closed if the runner changes that seam. */
export async function captureNativeSourceEvidence(project: TestProject, proof: {
  readonly name: string;
  readonly importer: string;
  readonly targets: readonly NativeSourceTarget[];
}): Promise<NativeSourceEvidence> {
  if (project.config.environment !== "node") throw new Error(`${proof.name} Source proof requires the Node test environment`);
  const environment = project.vite.environments.ssr;
  if (environment === undefined) throw new Error(`${proof.name} Source proof requires the actual Vitest module-runner environment`);
  const workspace = path.resolve(project.config.root, "../..");
  const importer = path.resolve(project.config.root, proof.importer);
  const entries: NativeSourceEvidence["entries"][number][] = [];
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  const physical = (id: string) => realpathSync(id.split("?")[0] ?? id);
  for (const target of proof.targets) {
    const entry = await environment.pluginContainer.resolveId(target.specifier, importer);
    if (entry === null || entry.external) throw new Error(`${proof.name} Source export is unresolved or external: ${target.specifier}`);
    let leaf = entry;
    for (const specifier of target.imports) {
      const resolved = await environment.pluginContainer.resolveId(specifier, leaf.id);
      if (resolved === null || resolved.external) throw new Error(`${proof.name} Source implementation is unresolved or external: ${target.name}/${specifier}`);
      leaf = resolved;
    }
    const entryFile = physical(entry.id);
    const leafFile = physical(leaf.id);
    if (entryFile !== realpathSync(path.resolve(workspace, target.entry)) ||
      leafFile !== realpathSync(path.resolve(workspace, target.leaf))) {
      throw new Error(`${proof.name} test resolution did not select the promoted Source implementation: ${target.name}; entry=${entryFile}; leaf=${leafFile}; workspace=${workspace}`);
    }
    entries.push({ name: target.name, specifier: target.specifier, entry: target.entry, leaf: target.leaf,
      entrySha256: digest(entryFile), leafSha256: digest(leafFile), external: false });
  }
  return Schema.decodeUnknownSync(NativeSourceEvidenceSchema)({ environment: "ssr", entries });
}

export default async function nativeSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Native",
    importer: "test/native-stock-sales-source-provenance.proof.ts",
    targets: nativeSourceTargets.map(target => ({
      name: target.name,
      specifier: `@medusajs/${target.package}/services`,
      entry: `packages/medusa-${target.package}/src/services/index.ts`,
      imports: [`./${target.leaf}`],
      leaf: `packages/medusa-${target.package}/src/services/${target.leaf}.ts`,
    })),
  });
  project.provide("nativeStockSalesSource", evidence);
}
