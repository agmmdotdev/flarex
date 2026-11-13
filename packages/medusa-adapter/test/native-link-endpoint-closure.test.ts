import { expect, it } from "vitest";
import { Effect, Result } from "effect";
import { RemoteQuery } from "@medusajs/modules-sdk/remote-query";
import { graphNativeConfiguration } from "../src/local-graph/native-metadata";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareCartPaymentCollectionLinkRead } from "../src/links/cart-payment-collection-service";
import { prepareCartPromotionLinkRead } from "../src/links/cart-promotion-service";
import { prepareCustomerAccountHolderLinkRead } from "../src/links/customer-account-holder-service";
import { prepareOrderCartLinkRead } from "../src/links/order-cart-service";
import { prepareOrderPaymentCollectionLinkRead } from "../src/links/order-payment-collection-service";
import { prepareLocalProductLinks } from "../src/links/product-service";
import { prepareProductSalesChannelLink } from "../src/links/product-sales-channel-service";
import { prepareSalesChannelLocationLink } from "../src/links/sales-channel-location-service";
import { prepareShippingProfileDeletionLinks } from "../src/links/shipping-profile-deletion";
import { prepareLocalVariantLinks } from "../src/links/variant-service";
import { prepareVariantPricingLink } from "../src/links/variant-pricing-service";
import { prepareLocationFulfillmentSetLinkRead } from "../src/links/location-fulfillment-set-service";
import { prepareLocationFulfillmentProviderLink } from "../src/links/location-fulfillment-provider-service";
import { prepareShippingOptionPriceSetLink } from "../src/links/shipping-option-price-set-service";

it("constructs native Query for isolated Link profiles using actual endpoint declarations and no endpoint reads", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const profiles = yield* Effect.all({
      cartPayment: prepareCartPaymentCollectionLinkRead(), cartPromotion: prepareCartPromotionLinkRead(),
      customerAccount: prepareCustomerAccountHolderLinkRead(), orderCart: prepareOrderCartLinkRead(),
      orderPayment: prepareOrderPaymentCollectionLinkRead(), product: prepareLocalProductLinks(),
      productSalesChannel: prepareProductSalesChannelLink(), salesChannelLocation: prepareSalesChannelLocationLink(),
      shippingProfile: prepareShippingProfileDeletionLinks().pipe(Effect.map(value => value.shipping)), variant: prepareLocalVariantLinks(), variantPricing: prepareVariantPricingLink(),
      locationSet: prepareLocationFulfillmentSetLinkRead(), locationProvider: prepareLocationFulfillmentProviderLink(),
      shippingPrice: prepareShippingOptionPriceSetLink(),
    });
    let reads = 0;
    for (const profile of Object.values(profiles)) {
      const graph = workflowModuleDefinition(profile.workflow)?.graph;
      if (graph?.native === undefined) throw new Error("Missing actual Link graph metadata");
      const metadata = Result.getOrThrow(graphNativeConfiguration(graph.native));
      expect(() => new RemoteQuery({ ...metadata, remoteFetchData: async () => { reads++; throw new Error("Unexpected endpoint read"); } })).not.toThrow();
      expect(graph.reads.every(read => read.model.startsWith("Link"))).toBe(true);
    }
    expect(reads).toBe(0);
  }));
});
