import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";

/** Named trusted workflow selections. The core captures and caps these at
 * composition; business inputs cannot raise them. Keep distinct workload names
 * even when today's allowances are equal. */
export const productRelationshipsPolicy = Object.freeze({ calls: 128, queryRows: 256 });
export const productReferenceReplacementEventLimit = 256;
export const productShippingProfileResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
/** Complete finite Variant graph, including Inventory children and both Link families. */
export const productVariantInventoryResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** Complete finite Product root; its maximum envelope has a distinct allowance. */
export const productCreationResources = Object.freeze({ ...defaultCommerceResources, calls: 512, eventMessages: 128 });
/** Four locations/addresses and eight native Inventory levels, one settlement. */
export const inventoryStockingResources = Object.freeze({ ...defaultCommerceResources });
/** One parent launch graph owns Pricing, Link, Product Tag and pending graph reads. */
export const productLaunchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** The finite launch workflow shares one bounded logical lifetime across both native children. */
export const productLaunchCommandMs = 30_000;
