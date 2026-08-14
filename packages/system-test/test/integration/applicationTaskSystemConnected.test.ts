import { describe, expect, it } from "vitest";

import { proveApplicationTaskSystemConnected } from
  "../../support/applicationTaskSystemConnectedHarness";

describe("AA-R6 checkpoint 5d3 Application Task System", () => {
  it("creates, durably replays, discovers, and accepts one Application Worker launch", async () => {
    await expect(proveApplicationTaskSystemConnected()).resolves.toBeUndefined();
  }, 120_000);
});
