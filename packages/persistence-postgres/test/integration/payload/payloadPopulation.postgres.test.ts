import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadPopulationScenario } from "./payloadPopulationScenario";
describe.skipIf(postgresUrl === null)("native Payload population (ordinary-role PostgreSQL)", () => {
  it("populates bounded reads under the original native lifetime", () => payloadPopulationScenario("postgres"), 180_000);
});
