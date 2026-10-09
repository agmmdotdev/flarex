/** Trusted private adapter composition; captures a descriptor without acquiring a host. */
export { registerCommerceProfile, registerCommerceSchemaProfile, requireCommerceProfile } from "./profile";
export { registerLocalCommerceProfile, type LocalCommerceTableAdmission } from "./profile";
export { decodeRelationalRowKey } from "../../commit/publication/relationalFacts";
export type { LocalCommerceEventPolicy } from "./host";
export type { CommerceProfile, CommerceSchemaProfile, CommerceInstallationProfile, CommerceProfileState } from "./profile";
export { captureRelationalPhysicalLayout } from "../../storage/relationalSchema/physical/canonical";
export type { CaptureRelationalPhysicalLayoutInput } from "../../storage/relationalSchema/physical/canonical";
export type { RelationalPhysicalLayout } from "../../storage/relationalSchema/physical/model";
export type { RelationalPhysicalValueError } from "../../storage/relationalSchema/physical/errors";

export { defaultCommerceResources, type CommerceResources } from "./resources";
