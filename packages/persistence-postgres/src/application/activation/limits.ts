import { isNonBlankString } from "@flarex/utils/strings";

export const UTF8 = new TextEncoder();

export const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

export const MAX_IDENTITY_BYTES = 1_024;

export const MAX_FRAME_BYTES = 1_048_576;

export const MAX_SEQUENCE = 9_223_372_036_854_775_807n;

export function validIdentity(value: string): boolean {
  return isNonBlankString(value) && !value.includes("\0") &&
    value.length <= MAX_IDENTITY_BYTES &&
    UTF8.encode(value).byteLength <= MAX_IDENTITY_BYTES;
}
