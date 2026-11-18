import { describe, it } from "vitest";
import { referenceCheckpointScenario } from "./referenceCheckpointScenario";

describe("reference checkpoints through the neutral atomic owner on PGlite", () => {
  it("commits selected and deferred references, retains final checks and refuses unsafe admission", async () => {
    await referenceCheckpointScenario("pglite");
  }, 240_000);
});
