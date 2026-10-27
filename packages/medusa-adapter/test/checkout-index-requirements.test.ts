import { Result } from "effect";
import { expect, it } from "vitest";
import { compileLogicalSourceIndexes } from "flarex-protocol/internal/logical-storage-requirements";
import { checkoutDefinitions, checkoutSources } from "./support/logical-checkout-fixture";

it("retains every genuine checkout table and ordered-index requirement", async () => {
  const sources = await checkoutSources(await checkoutDefinitions());
  const requirements = sources.map(source => ({ source: source.key,
    tables: source.bindings.length, indexes: Result.getOrThrow(compileLogicalSourceIndexes(source)).length }));
  expect(requirements).toMatchInlineSnapshot(`
    [
      {
        "indexes": 48,
        "source": "medusa.checkout.cart",
        "tables": 9,
      },
      {
        "indexes": 169,
        "source": "medusa.checkout.order",
        "tables": 23,
      },
      {
        "indexes": 33,
        "source": "medusa.checkout.payment",
        "tables": 9,
      },
      {
        "indexes": 15,
        "source": "medusa.checkout.customer",
        "tables": 4,
      },
      {
        "indexes": 6,
        "source": "medusa.checkout.region",
        "tables": 2,
      },
      {
        "indexes": 47,
        "source": "medusa.checkout.promotion",
        "tables": 10,
      },
      {
        "indexes": 46,
        "source": "medusa.checkout.fulfillment",
        "tables": 12,
      },
      {
        "indexes": 7,
        "source": "medusa.checkout.cart_payment_collection_links",
        "tables": 1,
      },
      {
        "indexes": 7,
        "source": "medusa.checkout.order_payment_collection_links",
        "tables": 1,
      },
      {
        "indexes": 7,
        "source": "medusa.checkout.order_cart_links",
        "tables": 1,
      },
      {
        "indexes": 7,
        "source": "medusa.checkout.cart_promotion_links",
        "tables": 1,
      },
      {
        "indexes": 60,
        "source": "medusa.checkout.product",
        "tables": 13,
      },
      {
        "indexes": 16,
        "source": "medusa.checkout.inventory",
        "tables": 3,
      },
      {
        "indexes": 6,
        "source": "medusa.checkout.stock_location",
        "tables": 2,
      },
      {
        "indexes": 4,
        "source": "medusa.checkout.sales_channel",
        "tables": 1,
      },
      {
        "indexes": 14,
        "source": "medusa.checkout.product_links",
        "tables": 2,
      },
      {
        "indexes": 14,
        "source": "medusa.checkout.variant_links",
        "tables": 2,
      },
      {
        "indexes": 7,
        "source": "medusa.checkout.sales_channel_locations",
        "tables": 1,
      },
    ]
  `);
});
