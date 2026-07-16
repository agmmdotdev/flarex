import { compareUtf16Strings } from "@flarex/utils/strings";
import type { Json, JsonObject } from "flarex-protocol/json";
import type {
  VerifiedTransactionGrantInspectionV1,
} from "../transactionGrantVerificationKernel";

export { bytesEqualFullScan as bytesEqual } from "@flarex/utils/bytes";

export function canonicalJson(
  value: Json,
  onMissingProperty: () => never,
): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => canonicalJson(item, onMissingProperty))
      .join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort(compareUtf16Strings)
      .map((key) => {
        const item = value[key];
        if (item === undefined) return onMissingProperty();
        return `${JSON.stringify(key)}:${
          canonicalJson(item, onMissingProperty)
        }`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function isJsonObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function detachVerifiedGrant(
  input: VerifiedTransactionGrantInspectionV1,
): VerifiedTransactionGrantInspectionV1 {
  return Object.freeze(structuredClone(input));
}
