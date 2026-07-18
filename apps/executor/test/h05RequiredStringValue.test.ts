import { describe, expect, it } from "vitest";

import { requireH05StringValue } from "../h05/requiredStringValue";

function captureError(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("H05 required string validation threw a non-Error value.");
  }
  throw new Error("Expected H05 required string validation to fail.");
}

describe("H05 required string value policy", () => {
  it("returns the ECMAScript-trimmed nonblank spelling", () => {
    expect(requireH05StringValue("  value  ", "FIELD")).toBe("value");
    expect(requireH05StringValue("\u200b", "FIELD")).toBe("\u200b");
    expect(requireH05StringValue(" \u0000 ", "FIELD")).toBe("\u0000");
  });

  it.each([undefined, null, "", " \t\r\n", "\u00a0\ufeff"])(
    "rejects missing or blank input without leaking it: %j",
    (value) => {
      const error = captureError(() =>
        requireH05StringValue(value, "SECRET_FIELD")
      );
      expect(error.message).toBe("SECRET_FIELD is required.");
    },
  );
});
