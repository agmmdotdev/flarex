export const CANONICAL_UUID_TEXT_V1_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuidTextV1(value: string): boolean {
  return CANONICAL_UUID_TEXT_V1_PATTERN.test(value);
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
