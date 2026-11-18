import { describe, it } from "vitest";
import { nullMembershipPhysicalScenario, nullMembershipScenario } from "./nullMembershipScenario";

describe("positive SQL NULL membership through the neutral logical owner on PGlite", () => {
  it("treats a NULL query operand separately from nonnullable row validation", async () => {
    await nullMembershipScenario("pglite");
  }, 240_000);
  it("preserves the same positive literals in physical compatibility without weakening writes", async () => {
    await nullMembershipPhysicalScenario("pglite");
  }, 240_000);
});
