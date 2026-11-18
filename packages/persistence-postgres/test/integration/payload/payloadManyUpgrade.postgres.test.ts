import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { payloadManyUpgradeScenario } from "./payloadManyUpgradeScenario";

describe.skipIf(postgresUrl === null)("native many upgrade refusal (ordinary-role PostgreSQL)", () => {
  it("preserves retained empty ownership through scalar and optional-one stages", () => payloadManyUpgradeScenario("postgres"), 180_000);
});
