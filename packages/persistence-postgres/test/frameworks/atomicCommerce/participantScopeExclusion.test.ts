import { describe, it } from "vitest";
import { participantScopeExclusionScenario } from "./participantScopeExclusionScenario";

describe("issued participant scope exclusion on PGlite", () => {
  it("authenticates live root and borrowed contexts and refuses copied, expired and unselected authority", async () => {
    await participantScopeExclusionScenario("pglite");
  }, 240_000);
});
