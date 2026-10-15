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
export const productShippingProfileResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
export const productVariantPricingResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
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
/** One parent launch graph owns Pricing, Link, Product Tag and pending graph reads. */
export const productLaunchResources = Object.freeze({ ...defaultCommerceResources, calls: 256 });
/** The finite launch workflow shares one bounded logical lifetime across both native children. */
export const productLaunchCommandMs = 30_000;
