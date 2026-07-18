import { isPositiveSafeInteger } from "@flarex/utils/numbers";

import { isH05CloudflareApiToken } from "../h05/cloudflareApiToken";
import { isH05CloudflareHexId } from "../h05/cloudflareHexId";

export const cloudflareApiOrigin = "https://api.cloudflare.com";
export const cloudflareApiPrefix = "/client/v4";

export function cloudflareAccountId(value: string): string {
  if (!isH05CloudflareHexId(value)) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );
  }
  return value;
}

export function cloudflareApiToken(
  value: string,
  environmentName: string,
): string {
  if (!isH05CloudflareApiToken(value)) {
    throw new Error(`${environmentName} is invalid.`);
  }
  return value;
}

export function positiveSafeInteger(value: number, name: string): number {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return value;
}
