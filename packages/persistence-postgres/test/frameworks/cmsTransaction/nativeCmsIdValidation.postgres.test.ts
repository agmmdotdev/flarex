import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { nativeCmsIdValidationScenario } from "./nativeCmsIdValidationScenario";

describe.skipIf(postgresUrl === null)("actual Core CMS ID validation (ordinary-role PostgreSQL)", () => {
  it("refuses unknown-table empty batches, latches refusal and does not read bodies", () => nativeCmsIdValidationScenario("postgres"), 120_000);
});
