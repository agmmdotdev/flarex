import { describe, expect, it } from "vitest";

import { isH05HttpsOriginUrl } from "../h05/httpsOrigin";

describe("H05 parsed HTTPS origin policy", () => {
  it.each([
    "https://example.com",
    "https://example.com:443/",
    "https://example.com/.",
    "https://example.com/?",
    "https://example.com/#",
  ])("accepts the normalized origin %s", (value) => {
    expect(isH05HttpsOriginUrl(new URL(value))).toBe(true);
  });

  it.each([
    "http://example.com/",
    "https://user@example.com/",
    "https://user:password@example.com/",
    "https://example.com/path",
    "https://example.com/?query=value",
    "https://example.com/#fragment",
  ])("rejects the non-origin %s", (value) => {
    expect(isH05HttpsOriginUrl(new URL(value))).toBe(false);
  });
});
