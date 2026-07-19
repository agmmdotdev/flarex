import { isLowercaseUuidText } from "@flarex/utils/strings";

export function isCanonicalUuidTextV1(value: string): boolean {
  return isLowercaseUuidText(value);
}

export function canonicalUuidTextV1ToHex(value: string): string {
  return value.replaceAll("-", "");
}

export function canonicalUuidTextV1FromHex(value: string): string {
  return (
    `${value.slice(0, 8)}-${value.slice(8, 12)}-` +
    `${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
  );
}
