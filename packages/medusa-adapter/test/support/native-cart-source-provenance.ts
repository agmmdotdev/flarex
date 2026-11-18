import type { TestProject } from "vitest/node";
import { captureNativeSourceEvidence, type NativeSourceEvidence } from "./native-stock-sales-source-provenance";

const cartModelLeaves = [
  "cart", "address", "credit-line", "line-item", "line-item-adjustment", "line-item-tax-line",
  "shipping-method", "shipping-method-adjustment", "shipping-method-tax-line",
] as const;

export const nativeCartSourceTargets = [
  ...cartModelLeaves.map(leaf => ({ name: `Cart model ${leaf}`, specifier: "@medusajs/cart/models",
    entry: "packages/medusa-cart/src/models/index.ts", imports: [`./${leaf}`],
    leaf: `packages/medusa-cart/src/models/${leaf}.ts` })),
  { name: "Cart module service", specifier: "@medusajs/cart/services", entry: "packages/medusa-cart/src/services/index.ts",
    imports: ["./cart-module"], leaf: "packages/medusa-cart/src/services/cart-module.ts" },
  { name: "Cart static manifest", specifier: "@medusajs/cart/static-manifest", entry: "packages/medusa-cart/src/static-manifest.ts",
    imports: [], leaf: "packages/medusa-cart/src/static-manifest.ts" },
  { name: "Cart creation models", specifier: "@medusajs/cart/creation-models", entry: "packages/medusa-cart/src/creation/models.ts",
    imports: [], leaf: "packages/medusa-cart/src/creation/models.ts" },
  { name: "Cart creation ownership store", specifier: "@medusajs/cart/creation", entry: "packages/medusa-cart/src/creation/index.ts",
    imports: ["./store"], leaf: "packages/medusa-cart/src/creation/store.ts" },
  { name: "DML schema compiler", specifier: "@medusajs/drizzle/schema", entry: "packages/medusa-drizzle/src/schema.ts",
    imports: [], leaf: "packages/medusa-drizzle/src/schema.ts" },
  { name: "Update Carts step", specifier: "@medusajs/core-flows/cart/update-carts-step",
    entry: "packages/medusa-core-flows/src/cart/steps/update-carts.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/cart/steps/update-carts.ts" },
  { name: "Create Carts step", specifier: "@medusajs/core-flows/cart/create-carts-step",
    entry: "packages/medusa-core-flows/src/cart/steps/create-carts.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/cart/steps/create-carts.ts" },
  { name: "Set Cart Tax Lines step", specifier: "@medusajs/core-flows/cart/set-tax-lines-for-items-step",
    entry: "packages/medusa-core-flows/src/cart/steps/set-tax-lines-for-items.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/cart/steps/set-tax-lines-for-items.ts" },
  { name: "Create Cart Line Item Adjustments step", specifier: "@medusajs/core-flows/cart/create-line-item-adjustments-step",
    entry: "packages/medusa-core-flows/src/cart/steps/create-line-item-adjustments.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/cart/steps/create-line-item-adjustments.ts" },
  { name: "Checkout Order data transform", specifier: "@medusajs/core-flows/cart/prepare-checkout-order-data",
    entry: "packages/medusa-core-flows/src/cart/utils/prepare-checkout-order-data.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/cart/utils/prepare-checkout-order-data.ts" },
  { name: "Checkout Create Orders step", specifier: "@medusajs/core-flows/order/create-orders-step",
    entry: "packages/medusa-core-flows/src/order/steps/create-orders.ts",
    imports: [], leaf: "packages/medusa-core-flows/src/order/steps/create-orders.ts" },
] as const;

declare module "vitest" {
  interface ProvidedContext {
    nativeCartSource: NativeSourceEvidence;
  }
}

export default async function nativeCartSourceEvidence(project: TestProject): Promise<void> {
  const evidence = await captureNativeSourceEvidence(project, {
    name: "Cart",
    importer: "test/native-cart-source-provenance.proof.ts",
    targets: nativeCartSourceTargets,
  });
  project.provide("nativeCartSource", evidence);
}
