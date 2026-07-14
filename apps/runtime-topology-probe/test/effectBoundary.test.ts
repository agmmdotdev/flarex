import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { protocolValueOrNull } from "../src/effectBoundary";

describe("Effect protocol boundary", () => {
  it("turns typed validation failures into null", async () => {
    await expect(protocolValueOrNull(Effect.fail("invalid"))).resolves.toBeNull();
  });

  it("does not disguise defects as protocol failures", async () => {
    await expect(
      protocolValueOrNull(Effect.die(new Error("decoder defect"))),
    ).rejects.toBeDefined();
  });
});
