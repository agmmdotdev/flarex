import { describe, it } from "vitest";
import { numberMembershipScenario } from "./numberMembershipScenario";

describe("finite numeric membership through logical atomic commerce on PGlite", () => {
  it("preserves native numeric equality, bounded candidates, pending writes, rollback and replay", async () => {
    await numberMembershipScenario("pglite");
  }, 240_000);
});
