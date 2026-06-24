import { describe, expect, it } from "vitest";
import { liveQueryDeliveryResultFromUnknown } from "../src/liveQueryDelivery";

describe("live query delivery result parsing", () => {
  it("normalizes legacy staleSkipped responses into skip reasons", () => {
    expect(liveQueryDeliveryResultFromUnknown(
      { delivered: 0, skipped: 1, staleSkipped: 1 },
      "connection:test:legacy",
    )).toEqual({
      delivered: 0,
      skipped: 1,
      staleSkipped: 1,
      skipReasons: { stale: 1 },
    });
  });

  it("merges staleSkipped into mixed skip reason responses", () => {
    expect(liveQueryDeliveryResultFromUnknown(
      {
        delivered: 0,
        skipped: 2,
        staleSkipped: 1,
        skipReasons: { missingQuery: 1 },
      },
      "connection:test:mixed",
    )).toEqual({
      delivered: 0,
      skipped: 2,
      staleSkipped: 1,
      skipReasons: { missingQuery: 1, stale: 1 },
    });
  });

  it("rejects mismatched staleSkipped and skipReasons.stale counts", () => {
    expect(() =>
      liveQueryDeliveryResultFromUnknown(
        {
          delivered: 0,
          skipped: 2,
          staleSkipped: 1,
          skipReasons: { stale: 2 },
        },
        "connection:test:mismatch",
      )
    ).toThrow(
      "connection:test:mismatch.staleSkipped must match connection:test:mismatch.skipReasons.stale when both are present.",
    );
  });
});
