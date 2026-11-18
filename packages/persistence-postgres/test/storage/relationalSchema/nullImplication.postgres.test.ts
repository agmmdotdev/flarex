import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { nullImplicationScenario } from "./nullImplicationScenario";

describe.skipIf(postgresUrl === null)("installed neutral null implication and two-null membership on ordinary-role PostgreSQL", () => {
  it("preserves complete rows, lifecycle, initialization, membership, history and atomic refusal", async () => {
    await nullImplicationScenario("postgres");
  }, 240_000);
});
