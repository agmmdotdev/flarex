import { describe, expect, it } from "vitest";

import { isH05CloudflareHexId } from "../h05/cloudflareHexId";

describe("H05 Cloudflare lowercase hexadecimal ID representation", () => {
  it.each([
    "0".repeat(32),
    "0123456789abcdef0123456789abcdef",
    "f".repeat(32),
  ])("accepts %s", (value) => {
    expect(isH05CloudflareHexId(value)).toBe(true);
  });

  it.each([
    "",
    "a".repeat(31),
    "a".repeat(33),
    "A".repeat(32),
    `${"a".repeat(31)}g`,
    `${"a".repeat(31)} `,
  ])("rejects %j", (value) => {
    expect(isH05CloudflareHexId(value)).toBe(false);
  });
});
