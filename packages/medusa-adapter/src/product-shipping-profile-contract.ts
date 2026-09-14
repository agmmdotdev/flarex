import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-profile";

/** Trusted, private connected-profile contract. Business input cannot select it. */
export const productShippingProfileResources = Object.freeze({ ...defaultCommerceResources, calls: 128 });
