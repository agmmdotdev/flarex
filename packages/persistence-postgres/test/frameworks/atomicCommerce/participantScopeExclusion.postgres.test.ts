import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { participantScopeExclusionScenario } from "./participantScopeExclusionScenario";

describe.skipIf(postgresUrl === null)("issued participant scope exclusion on ordinary-role PostgreSQL", () => {
  it("authenticates live root and borrowed contexts and refuses copied, expired and unselected authority", async () => {
    await participantScopeExclusionScenario("postgres");
  }, 240_000);
});
