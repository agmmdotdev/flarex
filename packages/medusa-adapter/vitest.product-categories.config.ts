import { defineConfig } from "vitest/config";
import upstream, { productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-categories-upstream.test.ts"],
  reporters: ["default", productCoverage([
    "Product service > Product Category boundary > isolates inverse products and tree reads from colliding foreign scope rows",
    "Product service > Product Category boundary > rolls back a native tree move after a late materialization failure and replays",
    "Product service > Product Category boundary > preserves the Product while deleting leaf membership and closing sibling ranks",
    "Product service > Product Category boundary > records final rank facts and authenticated batch events on replay",
    "Product service > Product Category boundary > refuses cycles, forged paths, invalid ranks and foreign inputs without publication",
  ])],
} });
