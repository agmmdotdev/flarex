import { describe, expect, it, vi } from "vitest";

import {
  decodeH05WranglerVersion,
  isH05SupportedWranglerVersion,
} from "../h05/wranglerVersion";

function captureThrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected H05 Wrangler version decoding to fail.");
}

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

  it("decodes a supported version without normalization", () => {
    const fail = vi.fn<(message: string) => never>();

    expect(decodeH05WranglerVersion("4.100.0-rc.1", "version", fail)).toBe(
      "4.100.0-rc.1",
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it.each([
    ["", "version must be a non-empty string."],
    [4, "version must be a non-empty string."],
    ["5.0.0", "version has an invalid format."],
  ] as const)("delegates the exact failure for %j", (value, message) => {
    const failure = new Error("owned failure");
    const fail = vi.fn<(message: string) => never>(() => {
      throw failure;
    });

    expect(captureThrown(() =>
      decodeH05WranglerVersion(value, "version", fail)
    )).toBe(failure);
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(message);
  });
});
