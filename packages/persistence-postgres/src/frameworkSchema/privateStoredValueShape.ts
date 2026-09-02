import { isCanonicalIsoInstant } from "@flarex/time/iso-instant";
import { isNonBlankString } from "@flarex/utils/strings";

import { hasExactOwnDataKeys } from "../exactOwnDataKeys";

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const NON_NEGATIVE_INT64 = /^(?:0|[1-9][0-9]{0,18})$/;
const POSITIVE_INT64 = /^[1-9][0-9]{0,18}$/;
const MAX_INT64_TEXT = "9223372036854775807";
const UTF8 = new TextEncoder();

export function isExactPrivateValueRecord(
  input: unknown,
  keys: readonly string[],
): input is Readonly<Record<string, unknown>> {
  try {
    return hasExactOwnDataKeys(input, keys);
  } catch {
    return false;
  }
}

export function isPrivateValueSha256(input: unknown): input is string {
  return typeof input === "string" && LOWERCASE_SHA256.test(input);
}

export function isBoundedPrivateValueIdentityText(
  input: unknown,
  maximumUtf8Bytes = 512,
): input is string {
  return isNonBlankString(input) &&
    !input.includes("\0") &&
    isWellFormedUtf16(input) &&
    UTF8.encode(input).byteLength <= maximumUtf8Bytes;
}

export function isPrivateValueText(input: unknown): input is string {
  return typeof input === "string" &&
    !input.includes("\0") &&
    isWellFormedUtf16(input);
}

export function isCanonicalPrivateValueNonNegativeInt64(
  input: unknown,
): input is string {
  return typeof input === "string" &&
    NON_NEGATIVE_INT64.test(input) &&
    (input.length < MAX_INT64_TEXT.length || input <= MAX_INT64_TEXT);
}

export function isCanonicalPrivateValuePositiveInt64(
  input: unknown,
): input is string {
  return typeof input === "string" &&
    POSITIVE_INT64.test(input) &&
    (input.length < MAX_INT64_TEXT.length || input <= MAX_INT64_TEXT);
}

export function isCanonicalPrivateValueInstant(input: unknown): input is string {
  return isCanonicalIsoInstant(input);
}

export function isPrivateValueStringArray(
  input: unknown,
  member: (value: string) => boolean = () => true,
): input is readonly string[] {
  if (!Array.isArray(input)) return false;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype ||
      Reflect.ownKeys(input).length !== input.length + 1) return false;
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        typeof descriptor.value !== "string" ||
        !member(descriptor.value)
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
