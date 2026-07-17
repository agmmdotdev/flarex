import { describe, expect, it } from "vitest";

import { isH05SupportedWranglerVersion } from "../h05/wranglerVersion";

describe("H05 supported Wrangler version format", () => {
  it.each([
    "4.0.0",
    "4.100.0",
    "4.100.0-beta.1",
    "4.100.0-rc-1",
    "4.100.0-...",
  ])("accepts %s", (value) => {
    expect(isH05SupportedWranglerVersion(value)).toBe(true);
  });

  it.each([
    "3.100.0",
    "5.0.0",
    "v4.100.0",
    "4.100",
    "4.100.0+build",
    "4.100.0 beta",
    "4.100.0-",
    "4.100.0-beta_1",
    "4.100.0-\u00e9",
    "",
  ])("rejects %s", (value) => {
    expect(isH05SupportedWranglerVersion(value)).toBe(false);
  });
});
