import { describe, expect, it } from "vitest";

import { probeSessionFailureRetryable } from "../src/gateway";

describe("ProbeSessionDO failure classification", () => {
  it("retries transport failures and selected server responses only", () => {
    expect(probeSessionFailureRetryable({ kind: "transport" })).toBe(true);
    expect(
      probeSessionFailureRetryable({ kind: "response-status", status: 500 }),
    ).toBe(true);
    expect(
      probeSessionFailureRetryable({ kind: "response-status", status: 503 }),
    ).toBe(true);
  });

  it("does not retry contract, identity, or client response failures", () => {
    expect(probeSessionFailureRetryable({ kind: "invalid-receipt" })).toBe(false);
    expect(
      probeSessionFailureRetryable({ kind: "response-status", status: 400 }),
    ).toBe(false);
    expect(
      probeSessionFailureRetryable({ kind: "response-status", status: 409 }),
    ).toBe(false);
  });
});
