import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadJoinScenario } from "./payloadJoinScenario";

describe.skipIf(postgresUrl === null)("native Payload reverse joins (ordinary-role PostgreSQL)", () => {
  it("preserves first-window ordering, source observations, lifetime and cold recovery", () => payloadJoinScenario("postgres"), 180_000);
});
