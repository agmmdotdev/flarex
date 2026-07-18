import { describe, expect, it } from "vitest";

import {
  storedAuthorityCorruptionResult,
  type StoredAuthorityCorruptionResult,
} from "../src/storedAuthorityLoadResult";

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
