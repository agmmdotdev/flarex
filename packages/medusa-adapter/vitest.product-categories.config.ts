import { defineConfig } from "vitest/config";
import upstream, { admittedProductCategoryCases, productCoverage } from "./vitest.product-upstream.config";
export default defineConfig({ ...upstream, test: { ...upstream.test,
  include: ["test/product-categories-upstream.test.ts"],
  reporters: ["default", productCoverage([...admittedProductCategoryCases,
    "Product Category boundary > isolates inverse products and tree reads from colliding foreign scope rows",
    "Product Category boundary > rolls back sibling and descendant changes after a late move failure and replays",
    "Product Category boundary > preserves products while deleting leaf membership and closing sibling ranks",
    "Product Category boundary > retains repeated rank facts while authenticating aggregated batch events and replay",
    "Product Category boundary > refuses cycles, forged paths, invalid ranks and foreign inputs without publication",
  ])],
} });
