import { describe, it } from "vitest";
import { relationalConstraintFailureScenario } from "./relationalConstraintFailureScenario";

describe("authentic logical constraint failure evidence through the atomic host on PGlite", () => {
  it("retains actual primary/partial/composite/CHECK failures, rollback and history semantics", async () => {
    await relationalConstraintFailureScenario("pglite");
  }, 240_000);
});
