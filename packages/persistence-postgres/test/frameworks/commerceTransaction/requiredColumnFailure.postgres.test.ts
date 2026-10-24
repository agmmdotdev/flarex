import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { requiredColumnFailureScenario } from "./requiredColumnFailureScenario";

describe.skipIf(postgresUrl === null)("required-column failure evidence through the neutral atomic host on ordinary-role PostgreSQL", () => {
  it("retains exact rejected candidates, poisons caught failures and commits valid defaults", async () => {
    await requiredColumnFailureScenario("postgres");
  }, 240_000);
});
