import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadRelationScenario } from "./payloadRelationScenario";
describe.skipIf(postgresUrl === null)("native Payload relations (ordinary-role PostgreSQL)", () => {
  it("upgrades the populated scalar profile, builds, activates and rebinds native references", () => payloadRelationScenario("postgres"), 180_000);
});
