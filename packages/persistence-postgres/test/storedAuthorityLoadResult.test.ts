import { describe, expect, it } from "vitest";

import {
  storedAuthorityCorruptionResult,
  storedAuthorityMismatchResult,
  type StoredAuthorityCorruptionResult,
  type StoredAuthorityMismatchResult,
} from "../src/storedAuthorityLoadResult";

describe("storedAuthorityMismatchResult", () => {
  it("returns a fresh frozen mismatch result", () => {
    const result: StoredAuthorityMismatchResult<"scopeChanged"> =
      storedAuthorityMismatchResult("scopeChanged");
    const second = storedAuthorityMismatchResult("scopeChanged");

    expect(result).toEqual({
      kind: "authorityMismatch",
      reason: "scopeChanged",
    });
    expect(second).not.toBe(result);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("storedAuthorityCorruptionResult", () => {
  it("returns a frozen corruption result and omits an undefined cause", () => {
    const result: StoredAuthorityCorruptionResult<"recordInvalid"> =
      storedAuthorityCorruptionResult("recordInvalid", undefined);
    const second = storedAuthorityCorruptionResult(
      "recordInvalid",
      undefined,
    );

    expect(result).toEqual({ kind: "corrupt", reason: "recordInvalid" });
    expect(second).not.toBe(result);
    expect(Object.hasOwn(result, "cause")).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("retains the exact caller-owned cause under the shallow freeze", () => {
    const cause = { detail: "before" };
    const result = storedAuthorityCorruptionResult("recordInvalid", cause);

    expect(result.cause).toBe(cause);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(cause)).toBe(false);
    cause.detail = "after";
    expect(result.cause).toEqual({ detail: "after" });
  });
});
