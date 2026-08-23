import { describe, expect, it } from "vitest";

import {
  proveApplicationTaskSystemFreshHostTakeoverPGlite,
} from "../../support/applicationTaskSystemConnectedHarness";

describe("DTE06-F2 Application Task fresh-host takeover - PGlite", () => {
  it("recovers one expired attempt through a newly constructed host", async () => {
    await expect(proveApplicationTaskSystemFreshHostTakeoverPGlite())
      .resolves.toBeUndefined();
  }, 120_000);
});
