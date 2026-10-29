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
import { compileCartCreationDefinition } from "../../src/modules/cart/creation-schema";
import { compileCustomerDefinition } from "../../src/modules/customer/schema";
import { compileRegionDefinition } from "../../src/modules/region/schema";
import { compileStoreDefinition } from "../../src/modules/store/schema";
import { compilePromotionDefinition } from "../../src/modules/promotion/schema";
import { compileTaxDefinition } from "../../src/modules/tax/schema";
import { compilePaymentDefinition } from "../../src/modules/payment/schema";
import { compileProductDefinition } from "../../src/modules/product/definition";
import { compilePricingDefinition } from "../../src/modules/pricing/schema";
import { compileInventoryDefinition } from "../../src/modules/inventory/schema";
import { compileStockLocationDefinition } from "../../src/modules/stock-location/schema";
import { compileSalesChannelDefinition } from "../../src/modules/sales-channel/schema";
import { compileFulfillmentCreationDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import { compileProductLinksDefinition } from "../../src/links/product-definition";
import { compileVariantLinksDefinition } from "../../src/links/variant-definition";
import { compileSalesChannelLocationLinkDefinition } from "../../src/links/sales-channel-location-schema";
import { compileCartPromotionCreationLinkDefinition } from "../../src/links/cart-promotion-creation-schema";
import { compileCartPaymentCollectionLinkDefinition } from "../../src/links/cart-payment-collection-schema";

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

export async function cartCreationDefinitions() {
  return [
    { name: "cart", definition: await Effect.runPromise(compileCartCreationDefinition()) },
    { name: "customer", definition: await Effect.runPromise(compileCustomerDefinition()) },
    { name: "region", definition: await Effect.runPromise(compileRegionDefinition()) },
    { name: "store", definition: await Effect.runPromise(compileStoreDefinition()) },
    { name: "promotion", definition: await Effect.runPromise(compilePromotionDefinition()) },
    { name: "tax", definition: await Effect.runPromise(compileTaxDefinition()) },
    { name: "payment", definition: await Effect.runPromise(compilePaymentDefinition()) },
    { name: "product", definition: await Effect.runPromise(compileProductDefinition()) },
    { name: "pricing", definition: await Effect.runPromise(compilePricingDefinition()) },
    { name: "inventory", definition: await Effect.runPromise(compileInventoryDefinition()) },
    { name: "stock_location", definition: await Effect.runPromise(compileStockLocationDefinition()) },
    { name: "sales_channel", definition: await Effect.runPromise(compileSalesChannelDefinition()) },
    { name: "fulfillment", definition: await Effect.runPromise(compileFulfillmentCreationDefinition()) },
    { name: "product_links", definition: await Effect.runPromise(compileProductLinksDefinition({ salesChannel: true, shippingProfile: true })) },
    { name: "variant_links", definition: await Effect.runPromise(compileVariantLinksDefinition()) },
    { name: "sales_channel_locations", definition: await Effect.runPromise(compileSalesChannelLocationLinkDefinition()) },
    { name: "cart_promotion_links", definition: await Effect.runPromise(compileCartPromotionCreationLinkDefinition()) },
    { name: "cart_payment_collection_links", definition: await Effect.runPromise(compileCartPaymentCollectionLinkDefinition()) },
  ] as const;
}
