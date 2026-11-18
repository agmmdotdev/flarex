import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { nullMembershipPhysicalScenario, nullMembershipScenario } from "./nullMembershipScenario";

describe.skipIf(postgresUrl === null)("positive SQL NULL membership through the neutral logical owner on ordinary-role PostgreSQL", () => {
  it("treats a NULL query operand separately from nonnullable row validation", async () => {
    await nullMembershipScenario("postgres");
  }, 240_000);
  it("preserves the same positive literals in physical compatibility without weakening writes", async () => {
    await nullMembershipPhysicalScenario("postgres");
  }, 240_000);
});
