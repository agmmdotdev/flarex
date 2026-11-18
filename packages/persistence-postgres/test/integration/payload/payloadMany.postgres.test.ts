import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadManyScenario, payloadManyCapacityScenario } from "./payloadManyScenario";

describe.skipIf(postgresUrl === null)("native Payload many (ordinary-role PostgreSQL)", () => {
  it("preserves CRUD, population, late races and cold uncertain recovery", () => payloadManyScenario("postgres"), 180_000);
  it("does not count private memberships as business identities", () => payloadManyCapacityScenario("postgres"), 180_000);
});
