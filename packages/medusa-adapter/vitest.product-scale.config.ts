import { defineConfig } from "vitest/config";
import upstream, { productCoverage } from "./vitest.product-upstream.config";

/** The unchanged scale case, independently of the admitted-suite coverage gate. */
export default defineConfig({
  ...upstream,
  test: {
    ...upstream.test,
    include: ["test/product-scale.test.ts"],
    reporters: ["default", productCoverage([
      "Product service > ProductModuleService products > images > should retrieve images in the correct order consistently",
      "Product service > Product scale checks > retains every row, ordinal and scalar event and replays without another publication",
      ...[255, 256, 257].map(count => `Product service > Product scale checks > preserves complete results across the ${count}-image write boundary`),
      "Product service > Product scale checks > rolls back the earlier image batch when the final batch fails",
      "Product service > Product scale checks > rolls back native Product rows and pending events when cancelled after a nested write",
      "Product service > Product scale checks > refuses an oversized command result without publication",
      "Product service > Product scale checks > refuses an oversized image and native graph beyond the shared budget atomically",
      "Product service > Product scale checks > refuses an event-free graph beyond the native identity budget",
    ])],
    testNamePattern: "should retrieve images in the correct order consistently$|Product scale checks",
  },
});
