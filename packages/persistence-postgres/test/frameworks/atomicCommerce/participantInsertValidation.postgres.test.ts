import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { participantInsertValidationBorrowedScenario, participantInsertValidationScenario } from "./participantInsertValidationScenario";

describe.skipIf(postgresUrl === null)("participant insert validation on ordinary-role PostgreSQL", () => {
  it("binds the selected phase, preserves default ordering and rolls back complete poisoned roots", async () => {
    await participantInsertValidationScenario("postgres");
  }, 600_000);
  it("authenticates real journal sources before refusing selected combined borrowing", async () => {
    await participantInsertValidationBorrowedScenario("postgres");
  }, 600_000);
});
