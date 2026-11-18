import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const modules = [
  { name: "Region", packageName: "region", models: ["region", "country"], service: "region-module" },
  { name: "Store", packageName: "store", models: ["store", "currency", "locale"], service: "store-module-service" },
  { name: "Sales Channel", packageName: "sales-channel", models: ["sales-channel"], service: "sales-channel-module" },
];
const steps = ["find-one-or-any-region", "find-sales-channel", "validate-sales-channel"];

export const nativeCartContextSourceTargets = [
  ...modules.flatMap(({ name, packageName, models, service }) => {
    const source = `packages/medusa-${packageName}/src`;
    const specifier = `@medusajs/${packageName}`;
    const manifest = `${source}/static-manifest.ts`;
    return [
      ...models.map(leaf => ({ name: `${name} model ${leaf}`, specifier: `${specifier}/models`,
        entry: `${source}/models/index.ts`, imports: [`./${leaf}`], leaf: `${source}/models/${leaf}.ts` })),
      { name: `${name} module service`, specifier: `${specifier}/services`, entry: `${source}/services/index.ts`,
        imports: [`./${service}`], leaf: `${source}/services/${service}.ts` },
      { name: `${name} static manifest`, specifier: `${specifier}/static-manifest`, entry: manifest, imports: [], leaf: manifest },
    ];
  }),
  ...steps.map(step => {
    const leaf = `packages/medusa-core-flows/src/cart/steps/${step}.ts`;
    return { name: `Cart step ${step}`, specifier: `@medusajs/core-flows/cart/${step}-step`, entry: leaf, imports: [], leaf };
  }),
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeCartContextSource: NativeSourceEvidence;
  }
}

export default async function nativeCartContextSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Cart context", importer: "test/native-cart-context-source-provenance.proof.ts", targets: nativeCartContextSourceTargets,
  });
  project.provide("nativeCartContextSource", evidence);
}
