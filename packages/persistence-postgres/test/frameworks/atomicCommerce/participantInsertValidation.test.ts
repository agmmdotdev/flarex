import { describe, it } from "vitest";
import { participantInsertValidationBorrowedScenario, participantInsertValidationScenario } from "./participantInsertValidationScenario";

describe("participant insert validation on PGlite", () => {
  it("binds the selected phase, preserves default ordering and rolls back complete poisoned roots", async () => {
    await participantInsertValidationScenario("pglite");
  }, 600_000);
  it("authenticates real journal sources before refusing selected combined borrowing", async () => {
    await participantInsertValidationBorrowedScenario("pglite");
  }, 600_000);
});
