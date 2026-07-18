import type { H05DecodeFailure } from "./decodeFailure";
import { decodeNonEmptyH05String } from "./nonEmptyString";

export function isH05SupportedWranglerVersion(value: string): boolean {
  return /^4\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function decodeH05WranglerVersion(
  value: unknown,
  path: string,
  fail: H05DecodeFailure,
): string {
  const decoded = decodeNonEmptyH05String(value, path, fail);
  if (!isH05SupportedWranglerVersion(decoded)) {
    fail(`${path} has an invalid format.`);
  }
  return decoded;
}
