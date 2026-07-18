import { describe, expect, it } from "vitest";

import {
  cloudflareAccountId,
  cloudflareApiOrigin,
  cloudflareApiPrefix,
  cloudflareApiToken,
  positiveSafeInteger,
} from "../scripts/cloudflareApiConfiguration";

describe("H05 Cloudflare API configuration", () => {
  it("owns the Cloudflare v4 API location", () => {
    expect(cloudflareApiOrigin).toBe("https://api.cloudflare.com");
    expect(cloudflareApiPrefix).toBe("/client/v4");
  });

  it("validates shared account and token configuration", () => {
    expect(cloudflareAccountId("a".repeat(32))).toBe("a".repeat(32));
    expect(() => cloudflareAccountId("A".repeat(32))).toThrow(
      "CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters.",
    );

    expect(cloudflareApiToken("token-value", "TEST_API_TOKEN"))
      .toBe("token-value");
    expect(() => cloudflareApiToken("short", "TEST_API_TOKEN"))
      .toThrow("TEST_API_TOKEN is invalid.");
  });

  it("retains caller-owned positive safe integer messages", () => {
    expect(positiveSafeInteger(1, "timeoutMs")).toBe(1);
    expect(() => positiveSafeInteger(0, "timeoutMs")).toThrow(
      "timeoutMs must be a positive safe integer.",
    );
  });
});
