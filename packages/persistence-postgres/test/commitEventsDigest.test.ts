import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { commitEventsDigest } from "../src/commitEvents/digest";
import type { CommittedEvent } from "../src/commitEvents/model";

describe("committed event digest budgets", () => {
  it("verifies an older committed family above the new publication ceiling", async () => {
    const event: CommittedEvent = {
      contract: "legacy.family", contractRevision: "a".repeat(64), producerRevision: "b".repeat(64),
      internal: false, group: "legacy", message: { data: "x".repeat(48_000) },
      subscribers: [{ id: "legacy-handler", revision: "c".repeat(64) }],
    };
    const family = Array.from({ length: 200 }, () => event);
    const verified = await Effect.runPromise(commitEventsDigest(family, "storedVerification"));
    expect(verified).toMatch(/^[0-9a-f]{64}$/);
    expect(await Effect.runPromise(Effect.result(commitEventsDigest(family))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });
});
