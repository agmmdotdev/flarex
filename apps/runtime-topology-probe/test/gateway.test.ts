import { describe, expect, it } from "vitest";

import { probeRuntimeFailureRetryable } from "../src/gateway";

describe("runtime hop failure classification", () => {
  it("retries transport failures and selected server responses only", () => {
    expect(probeRuntimeFailureRetryable({ kind: "transport" })).toBe(true);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 500 }),
    ).toBe(true);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 503 }),
    ).toBe(true);
  });

  it("does not retry contract, identity, or client response failures", () => {
    expect(probeRuntimeFailureRetryable({ kind: "invalid-receipt" })).toBe(false);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 400 }),
    ).toBe(false);
    expect(
      probeRuntimeFailureRetryable({ kind: "response-status", status: 409 }),
    ).toBe(false);
  });
});
