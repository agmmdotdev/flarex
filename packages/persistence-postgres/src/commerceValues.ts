/** Value-only adapter boundary; grants no installation, SQL or transaction authority. */
export { capturePrivateJsonData, useCapturedPrivateJsonData, inspectCapturedPrivateJsonData } from "./privateJsonData";
export { capturePrivateCanonicalValue } from "./frameworkSchema/privateCanonicalValue";
export type { PrivateCanonicalValueSnapshot } from "./frameworkSchema/privateCanonicalValue";
export type { FrameworkSchemaArtifact } from "./frameworkSchema/artifact/model";
export { commerceError, commerceLimits, CommerceTransactionError } from "./commerceTransaction/model";
export type { Json, JsonObject } from "flarex-protocol/json";
export { isJsonObject } from "flarex-protocol/json";

export { defaultCommerceResources, logicalCommerceBatchResources, type CommerceResources } from "./commerceTransaction/resources";
