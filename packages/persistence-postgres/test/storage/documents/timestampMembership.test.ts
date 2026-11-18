import { it } from "vitest";
import { timestampMembershipScenario } from "./timestampMembership.scenario";
it("preserves native canonical timestamp membership through real source reads, pending writes and history on PGlite", async () => {
  await timestampMembershipScenario("pglite");
}, 180_000);
