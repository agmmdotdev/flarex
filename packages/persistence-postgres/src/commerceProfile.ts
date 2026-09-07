/** Trusted private adapter composition; captures a descriptor without acquiring a host. */
export { registerCommerceProfile, requireCommerceProfile } from "./commerceTransaction/profile";
export type { CommerceProfile, CommerceProfileState } from "./commerceTransaction/profile";
export { capturePrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
export { captureRelationalPhysicalLayout } from "./relationalSchema/physical/canonical";
export type { CaptureRelationalPhysicalLayoutInput } from "./relationalSchema/physical/canonical";
export type { RelationalPhysicalLayout } from "./relationalSchema/physical/model";
export type { RelationalPhysicalValueError } from "./relationalSchema/physical/errors";
export type { FrameworkSchemaArtifact } from "./frameworkSchema/artifact/model";
