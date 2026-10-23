import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";

/** Named trusted workflow selections. The core captures and caps these at
 * composition; business inputs cannot raise them. Keep distinct workload names
 * even when today's allowances are equal. */
export const productRelationshipsPolicy = Object.freeze({ calls: 128, queryRows: 256 });
export const productReferenceReplacementEventLimit = 256;
/** Four native Product Type roots, including hooks and empty native Link routing. */
export const productTypeResources = Object.freeze({ ...defaultCommerceResources, calls: 64, eventMessages: 64 });
/** Four Collection roots with ordered membership replacement and native hooks. */
export const productCollectionResources = Object.freeze({ ...defaultCommerceResources, calls: 64, eventMessages: 64 });
/** Native four-target membership updates retain repeated ordered Product writes. */
export const productCollectionUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
/** Four rank-zero Category inserts can shift sixteen existing siblings. */
export const productCategoryCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
/** Four repeated native leaf requests can decrement fifteen siblings each. */
export const productCategoryDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
/** Four selected Category subtrees across a sixteen-Category native graph. */
export const productCategoryUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
/** Native Option workflows retain separate measured admission profiles. */
export const productOptionCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
export const productOptionUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128, eventMessages: 64 });
export const productOptionDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 64, eventMessages: 64 });
/** Native Image-to-Variants removal retains complete thumbnail preparation. */
export const productImageVariantResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const productShippingProfileResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Four native ShippingProfile roots and their genuine physical inverse. */
export const shippingProfileCreationResources = Object.freeze({ ...defaultCommerceResources });
/** One native Location–Fulfillment Set creation and its retained inverse. */
export const locationFulfillmentSetCreationResources = Object.freeze({ ...defaultCommerceResources });
/** Complete native Shipping Option creation and its retained callbacks. */
export const shippingOptionCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 128, commandBytes: 2_097_152 });
/** Complete Option/Pricing replacement and retained Rule reconstitution. */
export const shippingOptionUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 768, eventMessages: 256, commandBytes: 2_097_152 });
export const shippingOptionUpdateCommandMs = 30_000;
/** Native Option/Rule deletion, installed Pricing Link cascade and retained history. */
export const shippingOptionDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 256, commandBytes: 2_097_152 });
export const shippingOptionDeletionCommandMs = 30_000;
/** One native Fulfillment, its optional Address, four Items and four Labels. */
export const fulfillmentCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const fulfillmentCreationCommandMs = 30_000;
/** One native shipment replacement and its retained Label inverse. */
export const fulfillmentShipmentResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** One complete native update and its retained scalar/JSON/Label inverse. */
export const fulfillmentUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Complete installed Location/Link/Fulfillment deletion graph and retained inverse. */
export const stockLocationDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 256, commandBytes: 2_097_152 });
export const stockLocationDeletionCommandMs = 30_000;
/** Native Rule batch and retained callbacks share one scoped allowance. */
export const shippingOptionRuleBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Six native read services and three stored-Link owners, all logical. */
export const variantItemPricingParticipantLimit = 9;
/** Complete bounded read graph and four native Pricing contexts. */
export const variantItemPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Complete native Pricing graph followed by sixteen Inventory confirmations. */
export const variantInventoryConfirmationResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Complete finite Variant graph, including Inventory children and both Link families. */
export const productVariantInventoryResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Existing-variant edits with native base-price replacement and Link dismissal. */
export const productVariantUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Complete finite Product root; its maximum envelope has a distinct allowance. */
export const productCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 128 });
/** Existing Product graphs, including replacement links and removed Pricing descendants. */
export const productUpdateResources = Object.freeze({ ...defaultCommerceResources, catalogRows: 256, calls: 512, eventMessages: 256, commandBytes: 2_097_152 });
/** Pricing and Link participants retain the ordinary logical working set while
 * admitting the complete Product root's shared byte allowance. */
export const productUpdateParticipantResources = Object.freeze({ ...defaultCommerceResources, catalogRows: 128, commandBytes: 2_097_152 });
/** Native Product/Variant deletion, Inventory ownership reads and Link cascades. */
export const productDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 128, commandBytes: 2_097_152 });
export const productDeletionParticipantResources = Object.freeze({ ...defaultCommerceResources, commandBytes: 2_097_152 });
/** Combined native create/update/delete branches share one finite root. */
export const productBatchResources = Object.freeze({ ...defaultCommerceResources, catalogRows: 256, calls: 1024, eventMessages: 256, commandBytes: 2_097_152 });
export const productBatchParticipantResources = Object.freeze({ ...defaultCommerceResources, catalogRows: 128, commandBytes: 2_097_152 });
/** Four locations/addresses and eight native Inventory levels, one settlement. */
export const inventoryStockingResources = Object.freeze({ ...defaultCommerceResources });
/** Four native Stores, eight currencies/locales each and four raw preferences. */
export const storeCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Existing four-Store replacement graph and original-input Pricing branch. */
export const storeUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Four native Price List lifecycle roots and their retained callbacks. */
export const priceListDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Four native Price List Price entries with eight Prices and sixteen Rules. */
export const priceListPriceCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Native Price List Price updates and their complete retained graph inverse. */
export const priceListPriceUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Original Price removal and its current-graph inverse retain default limits. */
export const priceListPriceRemovalResources = Object.freeze({ ...defaultCommerceResources });
/** Original parallel Price List Price children retain the approved call allowance. */
export const priceListPriceBatchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Complete ServiceZone lifecycle graph and its genuine retained raw-ID inverse. */
export const serviceZoneDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 256, eventMessages: 128 });
/** Native ServiceZone geographic update; measured admission is selected independently. */
export const serviceZoneUpdateResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Complete Fulfillment Set lifecycle, installed Location Link routing and genuine
 * retained inverse share their measured, scoped admission allowance. */
export const fulfillmentSetDeletionResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 256, commandBytes: 2_097_152 });
export const fulfillmentSetDeletionCommandMs = 30_000;
/** One parent launch graph owns Pricing, Link, Product Tag and pending graph reads. */
export const productLaunchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** The finite launch workflow shares one bounded logical lifetime across both native children. */
export const productLaunchCommandMs = 30_000;
/** Native Tax Rule replacement retains the ordinary limits for both directions. */
export const taxRuleReplacementResources = Object.freeze({ ...defaultCommerceResources });
