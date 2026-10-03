import { Data } from "effect";
import { describe, expect, it, vi } from "vitest";
import { createPostgresPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import { compilePayloadLatencyCollections, preparePayloadLatencyHostInput } from "./payloadLatencyFixture";

class FixtureDriverFailure extends Data.TaggedError("FixtureDriverFailure")<{ readonly code: string }> {}

describe("Payload latency fixture Promise boundary", () => {
  it("preserves a classified driver refusal and an unexpected defect as their original rejections", async () => {
    // Construct the real facade without opening a connection. Only its first
    // driver query is injected; later fixture owners must never be entered.
    const persistence = await createPostgresPersistence({ connectionString: "postgresql://unused@localhost/unused" });
    const compiled = await runEffect(compilePayloadLatencyCollections());
    const query = vi.spyOn(persistence, "query");
    try {
      const expected = new FixtureDriverFailure({ code: "connectionRefused" });
      const defect = new TypeError("unexpected query implementation defect");
      for (const rejection of [expected, defect]) {
        query.mockRejectedValueOnce(rejection);
        await expect(preparePayloadLatencyHostInput(persistence, compiled)).rejects.toBe(rejection);
      }
      expect(query).toHaveBeenCalledTimes(2);
      expect(persistence.pool.totalCount).toBe(0);
    } finally { query.mockRestore(); await persistence.close(); }
  });
});
