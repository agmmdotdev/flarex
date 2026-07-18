import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeH05CloudflareSuccessEnvelope,
  type H05CloudflareSuccessEnvelopeIssue,
} from "../scripts/cloudflareSuccessEnvelope";

describe("H05 Cloudflare success envelope", () => {
  it("projects owned result fields without validating endpoint payloads", () => {
    const body = {
      success: true,
      errors: [],
      result: { id: "worker" },
      result_info: { page: 1 },
    };
    const decoded = Result.getOrThrow(
      decodeH05CloudflareSuccessEnvelope(body),
    );
    expect(decoded.result).toEqual({ id: "worker" });
    expect(decoded.record).toBe(body);

    const resultInfoFailure = new Error("result_info must remain endpoint-owned");
    const accessorBody = Object.defineProperty(
      { success: true, errors: [], result: null },
      "result_info",
      {
        get() {
          throw resultInfoFailure;
        },
      },
    );
    expect(() => Result.getOrThrow(
      decodeH05CloudflareSuccessEnvelope(accessorBody),
    )).not.toThrow();
  });

  it("preserves validation order and requires an own result", () => {
    expect(failureReason(null)).toBe("nonObject");
    expect(failureReason([])).toBe("nonObject");
    expect(failureReason({
      success: false,
      errors: [{ message: "provider detail" }],
    })).toBe("invalidEnvelope");
    expect(failureReason({
      success: true,
      errors: "invalid",
      result: null,
    })).toBe("invalidEnvelope");
    expect(failureReason({
      success: true,
      errors: [{ message: "provider detail" }],
      result: null,
    })).toBe("reportedError");
    expect(failureReason({ success: true, errors: [] })).toBe("missingResult");

    const inheritedResult = Object.setPrototypeOf(
      { success: true, errors: [] },
      { result: "inherited" },
    );
    expect(failureReason(inheritedResult)).toBe("missingResult");
  });

  it("preserves inherited success and errors compatibility", () => {
    const inheritedControlFields = Object.setPrototypeOf(
      { result: "owned" },
      { success: true, errors: [] },
    );
    expect(Result.getOrThrow(
      decodeH05CloudflareSuccessEnvelope(inheritedControlFields),
    ).result).toBe("owned");
  });
});

function failureReason(value: unknown): H05CloudflareSuccessEnvelopeIssue["reason"] {
  return Result.match(decodeH05CloudflareSuccessEnvelope(value), {
    onFailure: issue => issue.reason,
    onSuccess: () => {
      throw new Error("Expected Cloudflare success envelope decoding to fail.");
    },
  });
}
