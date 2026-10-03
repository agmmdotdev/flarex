import { describe, expect, it } from "vitest";
import { failureTokens, latencySummary } from "./measurement";

describe("core performance report", () => {
  it("omits P95 for short or incomplete measurements and preserves observations", () => {
    const values = [3, 1, 2];
    expect(latencySummary(values, false)).toEqual({ samples: 3, medianMs: 2, minMs: 1, maxMs: 3 });
    expect(latencySummary(values, true)).not.toHaveProperty("p95Ms");
    expect(latencySummary([], true)).toBeNull();
    expect(latencySummary(Array.from({ length: 20 }, (_, index) => index + 1), true)).toHaveProperty("p95Ms", 19);
    expect(values).toEqual([3, 1, 2]);
  });
  it("retains nested typed failures without exposing foreign error messages", () => {
    const cause = new Error("postgres://private:secret@example/db", {
      cause: { _tag: "CommerceTransactionError", reason: "rollbackOnly",
        error: { _tag: "LogicalParticipantAdmissionError", reason: "resourceFailure" } },
    });
    expect(failureTokens(cause)).toEqual(["Error", "CommerceTransactionError", "rollbackOnly",
      "LogicalParticipantAdmissionError", "resourceFailure"]);
    expect(JSON.stringify(failureTokens(cause))).not.toContain("secret");
  });
});
