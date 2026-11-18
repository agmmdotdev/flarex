import { Effect } from "effect";
import { compileCartCoreDefinition } from "../../src/modules/cart/creation-schema";
import { compileOrderCoreDefinition } from "../../src/modules/order/schema";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { compileCustomerCoreDefinition } from "../../src/modules/customer/schema";
import { compileRegionCoreDefinition } from "../../src/modules/region/schema";
import { compilePromotionCoreDefinition } from "../../src/modules/promotion/schema";
import { compileFulfillmentCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../../src/links/cart-payment-collection-schema";
import { compileOrderPaymentCollectionLinkCoreDefinition } from "../../src/links/order-payment-collection-schema";
import { compileOrderCartLinkCoreDefinition } from "../../src/links/order-cart-schema";
import { compileCartPromotionLinkCoreDefinition } from "../../src/links/cart-promotion-schema";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { compileInventoryCoreDefinition } from "../../src/modules/inventory/schema";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { compileVariantLinksCoreDefinition } from "../../src/links/variant-definition";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../src/links/sales-channel-location-schema";
import { compileCustomerAccountHolderLinkCoreDefinition } from "../../src/links/customer-account-holder-schema";

export const checkoutCoreDefinitions = Effect.fn("Checkout.coreDefinitions")(function* (target: Readonly<{
  scopeUuid: string; epochUuid: string;
}>, customerContext: boolean) {
  const definitions = yield* Effect.all({
    cart: compileCartCoreDefinition(target),
    order: compileOrderCoreDefinition(target, "generate"),
    payment: compilePaymentCoreDefinition(target),
    customer: compileCustomerCoreDefinition(target),
    region: compileRegionCoreDefinition(target),
    promotion: compilePromotionCoreDefinition(target),
    fulfillment: compileFulfillmentCreationCoreDefinition(target),
    cart_payment_collection_links: compileCartPaymentCollectionLinkCoreDefinition(target),
    order_payment_collection_links: compileOrderPaymentCollectionLinkCoreDefinition(target),
    order_cart_links: compileOrderCartLinkCoreDefinition(target),
    cart_promotion_links: compileCartPromotionLinkCoreDefinition(target),
    product: compileProductCoreDefinition(target),
    inventory: compileInventoryCoreDefinition(target),
    stock_location: compileStockLocationCoreDefinition(target),
    sales_channel: compileSalesChannelCoreDefinition(target),
    product_links: compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true }),
    variant_links: compileVariantLinksCoreDefinition(target),
    sales_channel_locations: compileSalesChannelLocationLinkCoreDefinition(target),
  });
  const accountLink = customerContext ? yield* compileCustomerAccountHolderLinkCoreDefinition(target) : undefined;
  return { ...definitions, ...(accountLink === undefined ? {} : { customer_account_holder_links: accountLink }) };
});
