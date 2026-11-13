import { Result } from "effect";
import { expect, it } from "vitest";
import { OrderFulfillment } from "@medusajs/link-modules";
import { nativeLinkGraphEndpoints, nativeLinkGraphPaths } from "../src/local-graph/links";

it("admits explicit Link cohorts up to the shared complete-read ceiling", () => {
  for (const maximum of [4, 128, 200, 256]) {
    expect(Result.isSuccess(nativeLinkGraphEndpoints(OrderFulfillment, [
      { path: "fulfillments", maximumSources: maximum, maximumTargets: maximum },
    ]))).toBe(true);
    expect(Result.isSuccess(nativeLinkGraphPaths(OrderFulfillment, [{ root: "Order", path: "fulfillments",
      maximumSources: 50, maximumLinks: maximum, maximumTargets: maximum, maximumPerSource: 4 }]))).toBe(true);
  }
  for (const maximum of [0, 257, 1.5, Number.NaN]) {
    expect(Result.isFailure(nativeLinkGraphEndpoints(OrderFulfillment, [
      { path: "fulfillments", maximumSources: maximum, maximumTargets: maximum },
    ]))).toBe(true);
    expect(Result.isFailure(nativeLinkGraphPaths(OrderFulfillment, [{ root: "Order", path: "fulfillments",
      maximumSources: 50, maximumLinks: maximum, maximumTargets: maximum, maximumPerSource: 4 }]))).toBe(true);
  }
});
