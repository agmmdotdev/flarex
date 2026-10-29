import { expect, it } from "vitest";
import { Result } from "effect";
import { CartProduct, CartShippingOption } from "@medusajs/link-modules";
import { joinerConfig as product } from "@medusajs/product/joiner-config";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { nativeLinkGraphDirectPaths } from "../src/local-graph/direct-paths";

const bounds = { root: "Cart", maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 };

it("resolves omitted native target entities from their genuine service and method aliases", () => {
  expect(Result.getOrThrow(nativeLinkGraphDirectPaths(CartProduct, [{ ...bounds, path: "items.product" }], "LineItem", product)))
    .toMatchObject([{ sourceKey: "product_id", targetModel: "Product", targetKey: "id" }]);
  const target = fulfillmentStaticResources.joinerConfig;
  if (target === undefined) throw new Error("Missing genuine Fulfillment joiner");
  expect(Result.getOrThrow(nativeLinkGraphDirectPaths(CartShippingOption,
    [{ ...bounds, path: "shipping_methods.shipping_option" }], "ShippingMethod", target)))
    .toMatchObject([{ sourceKey: "shipping_option_id", targetModel: "ShippingOption", targetKey: "id" }]);
});

it("refuses missing, foreign, ambiguous or mismatched target declarations", () => {
  const select = [{ ...bounds, path: "items.product" }];
  expect(Result.isFailure(nativeLinkGraphDirectPaths(CartProduct, select, "LineItem"))).toBe(true);
  for (const target of [
    { ...product, serviceName: "foreign" },
    { ...product, primaryKeys: ["foreign"] },
    { ...product, alias: [] },
    { ...product, alias: [{ name: "one", entity: "Product", args: { methodSuffix: "Products" } },
      { name: "two", entity: "Other", args: { methodSuffix: "Products" } }] },
  ]) expect(Result.isFailure(nativeLinkGraphDirectPaths(CartProduct, select, "LineItem", target))).toBe(true);
});
