import { defineConfig } from "vitest/config";
import upstream from "./vitest.product-upstream.config";

/** The unchanged scale case, independently of the admitted-suite coverage gate. */
export default defineConfig({
  ...upstream,
  test: {
    ...upstream.test,
    include: ["test/product-scale.test.ts"],
    reporters: ["default"],
    testNamePattern: "should retrieve images in the correct order consistently$|Product scale checks",
  },
});
