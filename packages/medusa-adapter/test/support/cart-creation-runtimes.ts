import { Effect } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { makeCartCreationWorkflowCommands } from "../../src/modules/cart/refresh-service";
import { makeCustomerCartCreationCommands } from "../../src/modules/customer/cart-creation-service";
import { makeLocalRegionCartReadCommands } from "../../src/modules/region/cart-read-service";
import { makeStoreCartReadCommands } from "../../src/modules/store/cart-read-service";
import { makePromotionComputeCommands } from "../../src/modules/promotion/compute-service";
import { makeTaxLinesCommands } from "../../src/modules/tax/service";
import { makePaymentLifecycleCommands } from "../../src/modules/payment/lifecycle-service";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import { makeLocalPricingCommands } from "../../src/modules/pricing/service";
import { makeLocalInventoryCommands } from "../../src/modules/inventory/service";
import { makeStockLocationCommands } from "../../src/modules/stock-location/service";
import { makeLocalSalesChannelCommands } from "../../src/modules/sales-channel/service";
import { makeFulfillmentCheckoutReadCommands } from "../../src/modules/fulfillment/checkout-read-service";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { prepareLocalVariantLinks } from "../../src/links/variant-service";
import { prepareSalesChannelLocationLink } from "../../src/links/sales-channel-location-service";
import { prepareCartPromotionPreimageLinks } from "../../src/links/cart-promotion-preimages";
import { prepareCartPaymentCollectionLinkRead } from "../../src/links/cart-payment-collection-service";
import { compileCartCoreDefinition } from "../../src/modules/cart/creation-schema";
import { compileCustomerCoreDefinition } from "../../src/modules/customer/schema";
import { compileRegionCoreDefinition } from "../../src/modules/region/schema";
import { compileStoreCoreDefinition } from "../../src/modules/store/schema";
import { compilePromotionCoreDefinition } from "../../src/modules/promotion/schema";
import { compileTaxCoreDefinition } from "../../src/modules/tax/schema";
import { compilePaymentCoreDefinition } from "../../src/modules/payment/schema";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { compilePricingCoreDefinition } from "../../src/modules/pricing/schema";
import { compileInventoryCoreDefinition } from "../../src/modules/inventory/schema";
import { compileStockLocationCoreDefinition } from "../../src/modules/stock-location/schema";
import { compileSalesChannelCoreDefinition } from "../../src/modules/sales-channel/schema";
import { compileFulfillmentCreationCoreDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { compileVariantLinksCoreDefinition } from "../../src/links/variant-definition";
import { compileSalesChannelLocationLinkCoreDefinition } from "../../src/links/sales-channel-location-schema";
import { compileCartPromotionCreationLinkCoreDefinition } from "../../src/links/cart-promotion-creation-schema";
import { compileCartPaymentCollectionLinkCoreDefinition } from "../../src/links/cart-payment-collection-schema";

/** These are actual native module constructions, shared by graph-only and
 * connected root tests. No Cart business response is supplied by the fixture. */
export async function cartCreationRuntimes() {
  const errors: string[] = [];
  const logger: Logger = { panic() {}, shouldLog: () => false, setLogLevel() {}, unsetLogLevel() {}, activity: value => value,
    progress() {}, error: value => { errors.push(String(value)); }, failure() {}, success: () => ({}), silly() {}, debug() {}, verbose() {}, http() {}, info() {}, warn() {}, log() {} };
  const payment = await Effect.runPromise(makePaymentLifecycleCommands(logger));
  const sales = await Effect.runPromise(makeLocalSalesChannelCommands());
  const promotionLinks = await Effect.runPromise(prepareCartPromotionPreimageLinks());
  const workflows = {
    cart: (await Effect.runPromise(makeCartCreationWorkflowCommands())).workflow,
    customer: (await Effect.runPromise(makeCustomerCartCreationCommands())).workflow,
    region: (await Effect.runPromise(makeLocalRegionCartReadCommands())).workflow,
    store: (await Effect.runPromise(makeStoreCartReadCommands())).workflow,
    promotion: (await Effect.runPromise(makePromotionComputeCommands())).workflow,
    tax: (await Effect.runPromise(makeTaxLinesCommands(logger))).workflow, payment: payment.workflow,
    product: (await Effect.runPromise(makeLocalProductCommands())).workflow,
    pricing: (await Effect.runPromise(makeLocalPricingCommands("cart-creation"))).workflow,
    inventory: (await Effect.runPromise(makeLocalInventoryCommands("variant-price-calculation"))).workflow,
    stock_location: (await Effect.runPromise(makeStockLocationCommands())).workflow,
    sales_channel: sales.workflow, fulfillment: (await Effect.runPromise(makeFulfillmentCheckoutReadCommands())).workflow,
    product_links: (await Effect.runPromise(prepareLocalProductLinks())).workflow,
    variant_links: (await Effect.runPromise(prepareLocalVariantLinks())).workflow,
    sales_channel_locations: (await Effect.runPromise(prepareSalesChannelLocationLink())).workflow,
    cart_promotion_links: promotionLinks.workflow,
    cart_payment_collection_links: (await Effect.runPromise(prepareCartPaymentCollectionLinkRead())).workflow,
  };
  return { workflows, salesChannelRead: sales.cartReadWorkflow, link: promotionLinks.resource, logger: payment.loggerResource, errors };
}

export function cartCreationCoreDefinitions(target: Readonly<{ scopeUuid: string; epochUuid: string }>) {
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
}
