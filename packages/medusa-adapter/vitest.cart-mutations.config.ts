import { defineConfig } from "vitest/config";
import native from "./vitest.native-cart-creation.config.ts";

export default defineConfig({ ...native, test: { ...native.test,
  include: ["test/logical-cart-mutations.test.ts", "test/cart-native-scalar-projection.test.ts", "test/pricing-variant-item-calculation-contracts.test.ts"], hookTimeout: 240_000, testTimeout: 180_000,
} });
