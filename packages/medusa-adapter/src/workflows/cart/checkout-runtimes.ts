import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { makeCartCheckoutCommands } from "../../modules/cart/payment-service";
import { makeOrderCheckoutCommands } from "../../modules/order/finance-service";
import { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import { makeCustomerAddressCommands } from "../../modules/customer/address-service";
import { makeLocalRegionReadCommands } from "../../modules/region/service";
import { makePromotionCheckoutCommands } from "../../modules/promotion/checkout-service";
import { makeLocalProductCommands } from "../../modules/product/service";
import { makeInventoryCheckoutCommands } from "../../modules/inventory/checkout-service";
import { makeStockLocationCommands } from "../../modules/stock-location/service";
import { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import { makeFulfillmentCheckoutReadCommands } from "../../modules/fulfillment/checkout-read-service";
import { prepareCartPaymentCollectionLinkRead } from "../../links/cart-payment-collection-service";
import { prepareCartPromotionLinkRead } from "../../links/cart-promotion-service";
import { prepareLocalProductLinks } from "../../links/product-service";
import { prepareLocalVariantLinks } from "../../links/variant-service";
import { prepareSalesChannelLocationLink } from "../../links/sales-channel-location-service";
import { prepareCheckoutNativeLinkLifecycle } from "../../links/checkout-native-lifecycle";
import { prepareCustomerCheckoutPromotionNativeLinkResource } from "../../links/checkout-resource";
import type { WorkflowModule } from "../../workflow/module";
import { storeCheckoutModuleNames } from "./checkout-graph";

/** Genuine service profiles share the serving catalog's stored source identities.
 * This construction grants only the native complete-cart dependency closure. */
export const makeStoreCheckoutRuntimes = Effect.fn("Checkout.makeStoreRuntimes")(function* (logger: Logger) {
  const payment = yield* makePaymentLifecycleCommands(logger);
  const orderCart = yield* prepareCheckoutNativeLinkLifecycle("order-cart");
  const orderPayment = yield* prepareCheckoutNativeLinkLifecycle("order-payment");
  const orderPromotion = yield* prepareCheckoutNativeLinkLifecycle("order-promotion");
  const account = yield* prepareCheckoutNativeLinkLifecycle("customer-account");
  const link = yield* Effect.fromResult(prepareCustomerCheckoutPromotionNativeLinkResource([
    orderCart.native, orderPayment.native, orderPromotion.native, account.native,
  ]));
  const workflows = {
    cart: (yield* makeCartCheckoutCommands()).workflow,
    order: (yield* makeOrderCheckoutCommands("order-response")).workflow,
    payment: payment.workflow,
    customer: (yield* makeCustomerAddressCommands()).workflow,
    region: (yield* makeLocalRegionReadCommands()).workflow,
    promotion: (yield* makePromotionCheckoutCommands()).workflow,
    fulfillment: (yield* makeFulfillmentCheckoutReadCommands()).workflow,
    cart_payment_collection_links: (yield* prepareCartPaymentCollectionLinkRead()).workflow,
    order_payment_collection_links: orderPayment.workflow,
    order_cart_links: orderCart.workflow,
    order_promotion_links: orderPromotion.workflow,
    customer_account_holder_links: account.workflow,
    cart_promotion_links: (yield* prepareCartPromotionLinkRead()).workflow,
    product: (yield* makeLocalProductCommands()).workflow,
    inventory: (yield* makeInventoryCheckoutCommands()).workflow,
    stock_location: (yield* makeStockLocationCommands()).workflow,
    sales_channel: (yield* makeLocalSalesChannelCommands()).workflow,
    product_links: (yield* prepareLocalProductLinks()).workflow,
    variant_links: (yield* prepareLocalVariantLinks()).workflow,
    sales_channel_locations: (yield* prepareSalesChannelLocationLink()).workflow,
  } satisfies Readonly<Record<typeof storeCheckoutModuleNames[number], WorkflowModule>>;
  return { workflows, link, logger: payment.loggerResource };
});
