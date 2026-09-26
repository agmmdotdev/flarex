import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-profile";

/** Named trusted workflow selections. The core captures and caps these at
 * composition; business inputs cannot raise them. Keep distinct workload names
 * even when today's allowances are equal. */
export const productRelationshipsPolicy = Object.freeze({ calls: 128, queryRows: 256 });
export const productReferenceReplacementEventLimit = 256;
export const productShippingProfileResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
