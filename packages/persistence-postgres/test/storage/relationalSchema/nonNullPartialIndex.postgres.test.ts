import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { nonNullPartialIndexScenario } from "./nonNullPartialIndexScenario";

describe.skipIf(postgresUrl === null)("installed neutral non-null ordered membership on ordinary-role PostgreSQL", () => {
  it("builds nonempty indexes and preserves lifecycle, replay, rollback and cold read eligibility", async () => {
    await nonNullPartialIndexScenario("postgres");
  }, 240_000);
});
