import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { referenceCheckpointScenario } from "./referenceCheckpointScenario";

describe.skipIf(postgresUrl === null)("reference checkpoints through the neutral atomic owner on ordinary-role PostgreSQL", () => {
  it("commits selected and deferred references, retains final checks and refuses unsafe admission", async () => {
    await referenceCheckpointScenario("postgres");
  }, 240_000);
});
