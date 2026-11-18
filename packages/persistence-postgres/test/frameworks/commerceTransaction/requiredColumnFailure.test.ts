import { describe, it } from "vitest";
import { requiredColumnFailureScenario } from "./requiredColumnFailureScenario";

describe("required-column failure evidence through the neutral atomic host on PGlite", () => {
  it("retains exact rejected candidates, poisons caught failures and commits valid defaults", async () => {
    await requiredColumnFailureScenario("pglite");
  }, 240_000);
});
