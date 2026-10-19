/** Value-only adapter boundary; grants no installation, SQL or transaction authority. */
export { capturePrivateJsonData, capturePrivateJsonDataOmittingUndefined, capturePrivateIntermediateJsonData, useCapturedPrivateJsonData, inspectCapturedPrivateJsonData } from "../../values/privateJsonData";
export type { PrivateIntermediateJsonPath } from "../../values/privateJsonData";
export { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
export type { PrivateCanonicalValueSnapshot } from "../../installation/frameworkSchema/privateCanonicalValue";
export type { FrameworkSchemaArtifact } from "../../installation/frameworkSchema/artifact/model";
export { commerceError, commerceLimits, CommerceTransactionError } from "./model";
export type { Json, JsonObject } from "flarex-protocol/json";
export { isJsonObject } from "flarex-protocol/json";

export { captureCommerceResources, defaultCommerceResources, logicalCommerceBatchResources, type CommerceResources } from "./resources";

export type { StorageInsertionOrder } from "../../storage/documents/logicalDocuments/relationalQuery";
export { LogicalSetNullPolicy, LogicalReconstitutionPolicy } from "../../storage/documents/logicalDocuments/model";
