import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { errorMessageFromUnknown } from "../src/errorMessage.ts";

describe("Flarex-dev unknown error messages", () => {
  it("projects native Error instances through their message", () => {
    expect(errorMessageFromUnknown(new Error("failed"))).toBe("failed");
  });

  it("uses ordinary String coercion for non-Error values", () => {
    expect(errorMessageFromUnknown("failed")).toBe("failed");
    expect(errorMessageFromUnknown({ message: "not trusted" })).toBe(
      "[object Object]",
    );
  });

  it("preserves fallback coercion for cross-realm Error instances", () => {
    const error: unknown = runInNewContext('new Error("failed")');
    expect(error).not.toBeInstanceOf(Error);
    expect(errorMessageFromUnknown(error)).toBe("Error: failed");
  });

  it("preserves caller-controlled coercion failures", () => {
    const failure = new Error("coercion failed");
    expect(() => errorMessageFromUnknown({
      toString(): string {
        throw failure;
      },
    })).toThrow(failure);
  });
});
