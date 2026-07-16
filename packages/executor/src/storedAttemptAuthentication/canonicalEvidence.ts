import { compareUtf16Strings } from "@flarex/utils/strings";
import type { Json, JsonObject } from "flarex-protocol/json";

import type {
  VerifiedTransactionGrantInspectionV1,
} from "../transactionGrantVerificationKernel";

export function bytesEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

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
