/** Trusted private adapter composition; captures a descriptor without acquiring a host. */
export { registerCommerceProfile, registerCommerceSchemaProfile, requireCommerceProfile } from "./commerceTransaction/profile";
export { registerLocalCommerceProfile, type LocalCommerceTableAdmission } from "./commerceTransaction/profile";
export { decodeRelationalRowKey } from "./commitPublication/relationalFacts";
export type { LocalCommerceEventPolicy } from "./commerceTransaction/host";
export type { CommerceProfile, CommerceSchemaProfile, CommerceInstallationProfile, CommerceProfileState } from "./commerceTransaction/profile";
export { captureRelationalPhysicalLayout } from "./relationalSchema/physical/canonical";
export type { CaptureRelationalPhysicalLayoutInput } from "./relationalSchema/physical/canonical";
export type { RelationalPhysicalLayout } from "./relationalSchema/physical/model";
export type { RelationalPhysicalValueError } from "./relationalSchema/physical/errors";

export { defaultCommerceResources, type CommerceResources } from "./commerceTransaction/resources";
