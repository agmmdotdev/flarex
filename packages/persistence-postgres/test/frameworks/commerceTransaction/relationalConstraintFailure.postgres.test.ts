import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { relationalConstraintFailureScenario } from "./relationalConstraintFailureScenario";

describe.skipIf(postgresUrl === null)("authentic logical constraint failure evidence through the atomic host on ordinary-role PostgreSQL", () => {
  it("retains actual primary/partial/composite/CHECK failures, rollback and history semantics", async () => {
    await relationalConstraintFailureScenario("postgres");
  }, 240_000);
});
