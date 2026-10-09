/** Private composition facade. No public framework activation or raw SQL port. */
export { defineCommerceCommand, makeCommerceHost } from "./host";
export type { CommerceCommand, CommerceCommandContext, CommerceHost, CommerceHostInput } from "./host";
export { makeCommerceReadHost } from "./read/host";
export type { CommerceReadHost, CommerceReadHostInput } from "./read/host";
export { registerCommerceProfile, requireCommerceProfile } from "./profile";
export type { CommerceProfile } from "./profile";
export { makeCommerceBinding } from "../../installation/frameworkSchema/binding/commerceBinding";
export type { CommerceBinding } from "../../installation/frameworkSchema/binding/model";
export type { BoundedRequestContext } from "../../execution/preparation/boundedRequestLifetime";
export { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
export { captureRelationalPhysicalLayout } from "../../storage/relationalSchema/physical/canonical";
