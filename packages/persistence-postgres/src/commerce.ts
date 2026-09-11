/** Private composition facade. No public framework activation or raw SQL port. */
export { defineCommerceCommand, makeCommerceHost } from "./commerceTransaction/host";
export type { CommerceCommand, CommerceCommandContext, CommerceHost, CommerceHostInput } from "./commerceTransaction/host";
export { registerCommerceProfile, requireCommerceProfile } from "./commerceTransaction/profile";
export type { CommerceProfile } from "./commerceTransaction/profile";
export { makeCommerceBinding } from "./frameworkSchema/binding/commerceBinding";
export type { CommerceBinding } from "./frameworkSchema/binding/model";
export type { BoundedRequestContext } from "./boundedRequestLifetime";
export { capturePrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
export { captureRelationalPhysicalLayout } from "./relationalSchema/physical/canonical";
