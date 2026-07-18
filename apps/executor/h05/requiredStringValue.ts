import { trimToNonBlankOrNull } from "@flarex/utils/strings";

export function requireH05StringValue(
  value: string | null | undefined,
  name: string,
): string {
  const normalized = trimToNonBlankOrNull(value ?? undefined);
  if (normalized !== null) return normalized;
  throw new Error(`${name} is required.`);
}
