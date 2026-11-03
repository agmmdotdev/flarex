import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const modelLeaves = ["customer", "address", "customer-group", "customer-group-customer"];
const customerSelection = "packages/medusa-core-flows/src/cart/steps/find-or-create-customer.ts";

export const nativeCustomerSourceTargets = [
  ...modelLeaves.map(leaf => ({ name: `Customer model ${leaf}`, specifier: "@medusajs/customer/models",
    entry: "packages/medusa-customer/src/models/index.ts", imports: [`./${leaf}`],
    leaf: `packages/medusa-customer/src/models/${leaf}.ts` })),
  { name: "Customer module service", specifier: "@medusajs/customer/services", entry: "packages/medusa-customer/src/services/index.ts",
    imports: ["./customer-module"], leaf: "packages/medusa-customer/src/services/customer-module.ts" },
  { name: "Customer static manifest", specifier: "@medusajs/customer/static-manifest", entry: "packages/medusa-customer/src/static-manifest.ts",
    imports: [], leaf: "packages/medusa-customer/src/static-manifest.ts" },
  { name: "Cart find-or-create Customer step", specifier: "@medusajs/core-flows/cart/find-or-create-customer",
    entry: customerSelection, imports: [], leaf: customerSelection },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
];

declare module "vitest" {
  interface ProvidedContext {
    nativeCustomerSource: NativeSourceEvidence;
  }
}

export default async function nativeCustomerSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Customer", importer: "test/native-customer-source-provenance.proof.ts", targets: nativeCustomerSourceTargets,
  });
  project.provide("nativeCustomerSource", evidence);
}
