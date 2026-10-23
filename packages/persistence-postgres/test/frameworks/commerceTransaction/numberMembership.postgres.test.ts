import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { numberMembershipScenario } from "./numberMembershipScenario";

describe.skipIf(postgresUrl === null)("finite numeric membership through logical atomic commerce on ordinary-role PostgreSQL", () => {
  it("preserves native numeric equality, bounded candidates, pending writes, rollback and replay", async () => {
    await numberMembershipScenario("postgres");
  }, 240_000);
});
