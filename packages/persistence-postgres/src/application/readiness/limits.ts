import { isNonBlankString } from "@flarex/utils/strings";
import {
  MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import { isCanonicalCalendarDate } from "@flarex/time/calendar-date";

export const UTF8 = new TextEncoder();

export const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

export const MAX_FUNCTIONS = 4_096;

export const MAX_BINDING_BYTES = 1_048_576;

export const MAX_READINESS_BYTES = 16_777_216;

export function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    UTF8.encode(value).byteLength <= 1_024;
}

export function validRuntimeHostIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 &&
    isNulFreeScalarText(value);
}

function isNulFreeScalarText(value: string): boolean {
  if (value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

export function validCompatibilityDate(value: unknown): value is string {
  return isCanonicalCalendarDate(value);
}
