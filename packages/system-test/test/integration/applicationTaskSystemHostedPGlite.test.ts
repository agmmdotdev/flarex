import { describe, expect, it } from "vitest";

import { proveApplicationTaskSystemHostedPGlite } from
  "../../support/applicationTaskSystemConnectedHarness";

describe("DTE06-F1 hosted Application Task - PGlite", () => {
  it("drains one R2-backed Application Worker through the private event host", async () => {
    await expect(proveApplicationTaskSystemHostedPGlite())
      .resolves.toBeUndefined();
  }, 120_000);
});
