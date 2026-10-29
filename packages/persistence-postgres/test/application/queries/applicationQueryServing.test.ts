import { describe, it } from "vitest";

import { constructApplicationQueryServing } from "../../../src/application/applicationQueryServing";
import { createApplicationNativeMutationPGliteFixture } from "../applicationNativeMutationTestFixture";
import { APPLICATION_QUERY_SERVING_OPTIONS, assertApplicationQueryServing } from "./applicationQueryServingScenario";

describe("Application query serving construction on PGlite", () => {
  it("issues fresh authentic selections and refuses another deployment before query reads", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture(APPLICATION_QUERY_SERVING_OPTIONS);
    await assertApplicationQueryServing(fixture, deploymentId => constructApplicationQueryServing({
      ...fixture.servingOwners,
      deploymentId,
    }));
  }, 120_000);
});
