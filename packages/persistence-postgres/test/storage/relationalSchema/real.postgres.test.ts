import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { realScenario } from "./realScenario";

describe.skipIf(postgresUrl === null)("installed neutral SQL real on ordinary-role PostgreSQL", () => {
  it.each([false, true])("normalizes actual borrowed SQL values and preserves storage lifetime (finite capture %s)", async finite => {
    await realScenario("postgres", finite);
  }, 240_000);
});
