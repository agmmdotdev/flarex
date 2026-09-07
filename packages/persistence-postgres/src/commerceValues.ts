/** Value-only adapter boundary; grants no installation, SQL or transaction authority. */
export { capturePrivateJsonData } from "./privateJsonData";
export { commerceError, commerceLimits, CommerceTransactionError } from "./commerceTransaction/model";
export type { Json, JsonObject } from "flarex-protocol/json";
export { isJsonObject } from "flarex-protocol/json";
