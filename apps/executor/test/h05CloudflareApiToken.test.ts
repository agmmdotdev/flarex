import { describe, expect, it } from "vitest";

import { isH05CloudflareApiToken } from "../h05/cloudflareApiToken";

describe("H05 Cloudflare API token shape", () => {
  it.each([
    "a".repeat(10),
    "token-._~!value",
    "token\u00a0value",
    "token\u200bvalue",
  ])("accepts %j", (value) => {
    expect(isH05CloudflareApiToken(value)).toBe(true);
  });

  it.each([
    "a".repeat(9),
    " token-value",
    "token-value ",
    "\u00a0token-value",
    "token-value\u00a0",
    "token\0value",
    "token\tvalue",
    "token\nvalue",
    "token\u007fvalue",
  ])("rejects %j", (value) => {
    expect(isH05CloudflareApiToken(value)).toBe(false);
  });
});
