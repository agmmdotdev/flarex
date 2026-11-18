import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { jointApplicationRelationsScenario } from "./jointApplicationRelationsScenario";
describe.skipIf(postgresUrl === null)("joint App/Payload/Currency references (ordinary-role PostgreSQL)", () => {
  it("preserves native sources, atomic index/outcomes, recovery and installed cleanup transition", () => jointApplicationRelationsScenario("postgres"), 180_000);
});
