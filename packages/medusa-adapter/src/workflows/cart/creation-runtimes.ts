import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { makeCartCreationWorkflowCommands } from "../../modules/cart/refresh-service";
import { makeCustomerCartCreationCommands } from "../../modules/customer/cart-creation-service";
import { makeLocalRegionCartReadCommands } from "../../modules/region/cart-read-service";
import { makeStoreCartReadCommands } from "../../modules/store/cart-read-service";
import { makePromotionComputeCommands } from "../../modules/promotion/compute-service";
import { makeTaxLinesCommands } from "../../modules/tax/service";
import { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import { makeLocalProductCommands } from "../../modules/product/service";
import { makeLocalPricingCommands } from "../../modules/pricing/service";
import { makeLocalInventoryCommands } from "../../modules/inventory/service";
import { makeStockLocationCommands } from "../../modules/stock-location/service";
import { makeLocalSalesChannelCommands } from "../../modules/sales-channel/service";
import { makeFulfillmentCheckoutReadCommands } from "../../modules/fulfillment/checkout-read-service";
import { prepareLocalProductLinks } from "../../links/product-service";
import { prepareLocalVariantLinks } from "../../links/variant-service";
import { prepareSalesChannelLocationLink } from "../../links/sales-channel-location-service";
import { prepareCartPromotionPreimageLinks } from "../../links/cart-promotion-preimages";
import { prepareCartPaymentCollectionLinkRead } from "../../links/cart-payment-collection-service";
import { compileCartCoreDefinition } from "../../modules/cart/creation-schema";
import { compileCustomerCoreDefinition } from "../../modules/customer/schema";
import { compileRegionCoreDefinition } from "../../modules/region/schema";
import { compileStoreCoreDefinition } from "../../modules/store/schema";
import { compilePromotionCoreDefinition } from "../../modules/promotion/schema";
import { compileTaxCoreDefinition } from "../../modules/tax/schema";
import { compilePaymentCoreDefinition } from "../../modules/payment/schema";
import { compileProductCoreDefinition } from "../../modules/product/schema";
import { compilePricingCoreDefinition } from "../../modules/pricing/schema";
import { compileInventoryCoreDefinition } from "../../modules/inventory/schema";
import { compileStockLocationCoreDefinition } from "../../modules/stock-location/schema";
import { compileSalesChannelCoreDefinition } from "../../modules/sales-channel/schema";
import { compileFulfillmentCreationCoreDefinition } from "../../modules/fulfillment/shipping-profile-schema";
import { compileProductLinksCoreDefinition } from "../../links/product-definition";
import { compileVariantLinksCoreDefinition } from "../../links/variant-definition";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../links/sales-channel-location-schema";
import { compileCartPromotionCreationLinkCoreDefinition } from "../../links/cart-promotion-creation-schema";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../../links/cart-payment-collection-schema";

/** Genuine native Cart module construction shared by hosts and fixtures. */
export const makeCartCreationRuntimes = Effect.fn("CartCreation.makeRuntimes")(function* (logger: Logger, pricingProfile: "cart-creation" | "cart-mutations" = "cart-creation") {
  const payment = yield* makePaymentLifecycleCommands(logger);
  const sales = yield* makeLocalSalesChannelCommands();
  const promotionLinks = yield* prepareCartPromotionPreimageLinks();
  const workflows = {
    cart: (yield* makeCartCreationWorkflowCommands()).workflow,
    customer: (yield* makeCustomerCartCreationCommands()).workflow,
    region: (yield* makeLocalRegionCartReadCommands()).workflow,
    store: (yield* makeStoreCartReadCommands()).workflow,
    promotion: (yield* makePromotionComputeCommands()).workflow,
    tax: (yield* makeTaxLinesCommands(logger)).workflow, payment: payment.workflow,
    product: (yield* makeLocalProductCommands()).workflow,
    pricing: (yield* makeLocalPricingCommands(pricingProfile)).workflow,
    inventory: (yield* makeLocalInventoryCommands("variant-price-calculation")).workflow,
    stock_location: (yield* makeStockLocationCommands()).workflow,
    sales_channel: sales.workflow, fulfillment: (yield* makeFulfillmentCheckoutReadCommands()).workflow,
    product_links: (yield* prepareLocalProductLinks()).workflow,
    variant_links: (yield* prepareLocalVariantLinks()).workflow,
    sales_channel_locations: (yield* prepareSalesChannelLocationLink()).workflow,
    cart_promotion_links: promotionLinks.workflow,
    cart_payment_collection_links: (yield* prepareCartPaymentCollectionLinkRead()).workflow,
  };
  return { workflows, salesChannelRead: sales.cartReadWorkflow, link: promotionLinks.resource, logger: payment.loggerResource };
});
export const cartCreationCoreDefinitions = Effect.fn("CartCreation.compileDefinitions")((target: Readonly<{ scopeUuid: string; epochUuid: string }>) => {
  return Effect.all({
    cart: compileCartCoreDefinition(target),
    customer: compileCustomerCoreDefinition(target),
    region: compileRegionCoreDefinition(target),
    store: compileStoreCoreDefinition(target),
    promotion: compilePromotionCoreDefinition(target),
    tax: compileTaxCoreDefinition(target),
    payment: compilePaymentCoreDefinition(target),
    product: compileProductCoreDefinition(target),
    pricing: compilePricingCoreDefinition(target),
    inventory: compileInventoryCoreDefinition(target),
    stock_location: compileStockLocationCoreDefinition(target),
    sales_channel: compileSalesChannelCoreDefinition(target),
    fulfillment: compileFulfillmentCreationCoreDefinition(target),
    product_links: compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true }),
    variant_links: compileVariantLinksCoreDefinition(target),
    sales_channel_locations: compileSalesChannelLocationLinkCoreDefinition(target),
    cart_promotion_links: compileCartPromotionCreationLinkCoreDefinition(target),
    cart_payment_collection_links: compileCartPaymentCollectionLinkCoreDefinition(target),
  });
});
