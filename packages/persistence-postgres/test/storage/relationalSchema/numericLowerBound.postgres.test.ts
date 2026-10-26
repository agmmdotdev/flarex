import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { numericLowerBoundScenario } from "./numericLowerBoundScenario";
describe.skipIf(postgresUrl === null)("neutral logical exact numeric bound on ordinary PostgreSQL", () => {
  it("preserves exact comparison, null, pending writes, initialization, rollback and replay", () => numericLowerBoundScenario("postgres"), 240_000);
});
