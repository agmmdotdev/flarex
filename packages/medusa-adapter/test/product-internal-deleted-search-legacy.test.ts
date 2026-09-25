import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { clearLegacyProductRunnerRows, getLegacyProductRunnerFixture, registerLegacyProductFixture } from "./support/legacy-product-runner";

registerLegacyProductFixture();

describe("Internal Product deleted search legacy boundary", () => {
  beforeEach(clearLegacyProductRunnerRows);

  it("includes deleted matches in an unanchored free-text query", async () => {
    const { fixture, runtime } = getLegacyProductRunnerFixture();
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(),
      runtime.commands.internalProductCreate, [
        { id: "active", title: "Needle", handle: "active" },
        { id: "deleted", title: "Needle", handle: "deleted" },
      ]));
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(),
      runtime.commands.internalProductSoftDelete, "deleted"));
    const input = { filters: { q: "needle" }, config: { select: ["id"], withDeleted: true } };
    expect(await Effect.runPromise(fixture.host.read(runtime.commands.internalProductList, input)))
      .toEqual([{ id: "active" }, { id: "deleted" }]);
  });
});
